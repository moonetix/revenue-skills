import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  ref_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES users (id),
  referral_state TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  pack TEXT NOT NULL,
  coins INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  payment_intent TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded'))
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS offer_conversions (
  tx TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users (id),
  coins INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('credited', 'reversed', 'reversed_before_credit')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_redemptions (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users (id),
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  item TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('delivered', 'pending', 'refunded')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  coins INTEGER NOT NULL,
  cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'unknown', 'paid', 'failed')),
  created_at INTEGER NOT NULL
);
`;

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);

// Runs work() inside one transaction. Nested calls join the open one.
export function createTx(db) {
  let open = false;
  return (work) => {
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
  };
}
