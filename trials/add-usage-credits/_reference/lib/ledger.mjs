import { now } from '../db.mjs';

export class InsufficientFunds extends Error {}

// Every balance change is one ledger row plus one balance update in the same transaction.
// UNIQUE (kind, ref) makes a repeated event a no-op: the second insert changes nothing,
// so the balance update is skipped.
export function createLedger(db) {
  const insert = db.prepare(
    'INSERT INTO ledger (user_id, amount, kind, ref, actor, created_at) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (kind, ref) DO NOTHING',
  );
  const add = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
  const take = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance - reserved >= ?');
  let open = false;

  return {
    atomic(work) {
      if (open) return work();
      db.exec('BEGIN IMMEDIATE');
      open = true;
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        open = false;
      }
    },

    // Returns true when the entry was posted, false when (kind, ref) was already there.
    // A debit that the balance cannot cover throws InsufficientFunds, which rolls the
    // surrounding atomic() back. Only reversals pass allowDebt.
    entry({ userId, amount, kind, ref, actor = 'system', allowDebt = false }) {
      if (!open) throw new Error('ledger.entry() must run inside ledger.atomic()');
      if (!Number.isSafeInteger(amount) || amount === 0) throw new TypeError('amount must be a non-zero integer');
      if (!insert.run(userId, amount, kind, String(ref), actor, now()).changes) return false;
      if (amount > 0 || allowDebt) {
        add.run(amount, userId);
      } else if (!take.run(-amount, userId, -amount).changes) {
        throw new InsufficientFunds();
      }
      return true;
    },

    sum(userId, kinds, before = Number.MAX_SAFE_INTEGER) {
      const marks = kinds.map(() => '?').join(', ');
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE user_id = ? AND kind IN (${marks}) AND created_at <= ?`,
        )
        .get(userId, ...kinds, before);
      return row.total;
    },

    mismatches() {
      return db
        .prepare(
          'SELECT u.id AS user_id, u.balance, COALESCE(SUM(l.amount), 0) AS ledger_total ' +
            'FROM users u LEFT JOIN ledger l ON l.user_id = u.id GROUP BY u.id HAVING u.balance <> ledger_total',
        )
        .all();
    },
  };
}
