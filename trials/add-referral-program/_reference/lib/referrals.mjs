import { now } from '../db.mjs';

// Gmail ignores dots and plus tags, and googlemail.com is gmail.com. Other domains: lowercase only.
export function emailKey(email) {
  const [local, domain] = String(email).toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.split('+')[0].replaceAll('.', '')}@gmail.com`;
  return `${local}@${domain}`;
}

// Written once, inside the sign-up transaction. A second account of the referrer is blocked.
export function attachReferral(app, userId, email, code) {
  const { db } = app;
  const referrer = db.prepare('SELECT id, email FROM users WHERE ref_code = ?').get(code);
  if (!referrer || referrer.id === userId) return;
  const state = emailKey(referrer.email) === emailKey(email) ? 'blocked' : 'pending';
  db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL').run(referrer.id, userId);
  db.prepare('INSERT INTO referrals (referred_id, referrer_id, state, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(
    userId,
    referrer.id,
    state,
    now(),
  );
}

// Call inside the transaction of every verified credit and every reversal of the referred user.
export function settleReferral(app, userId) {
  const { db, ledger, config } = app;
  const referral = db.prepare('SELECT referrer_id, state FROM referrals WHERE referred_id = ?').get(userId);
  if (!referral) return;
  const verified = ledger.sum(userId, ['purchase', 'purchase_refund', 'offer', 'offer_reversal']);
  if (verified >= config.referralQualifyingCoins) {
    if (referral.state !== 'pending') return;
    const recent = db
      .prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ? AND state IN ('rewarded', 'reversed') AND rewarded_at > ?")
      .get(referral.referrer_id, now() - 30 * 24 * 3600).n;
    if (recent >= config.referralCapPer30Days) {
      db.prepare("UPDATE referrals SET state = 'held' WHERE referred_id = ? AND state = 'pending'").run(userId);
      return;
    }
    const moved = db
      .prepare("UPDATE referrals SET state = 'rewarded', rewarded_at = ? WHERE referred_id = ? AND state = 'pending'")
      .run(now(), userId);
    if (moved.changes) ledger.entry({ userId: referral.referrer_id, amount: config.referralBonus, kind: 'referral', ref: userId });
    return;
  }
  if (referral.state !== 'rewarded') return;
  const paid = db.prepare("SELECT user_id, amount FROM ledger WHERE kind = 'referral' AND ref = ?").get(String(userId));
  db.prepare("UPDATE referrals SET state = 'reversed' WHERE referred_id = ? AND state = 'rewarded'").run(userId);
  if (paid) ledger.entry({ userId: paid.user_id, amount: -paid.amount, kind: 'referral_reversal', ref: userId, allowDebt: true });
}
