import { DatabaseSync } from 'node:sqlite';

// Coins are whole numbers everywhere. users.balance is a cache of SUM(ledger.amount)
// and only lib/ledger.mjs writes it.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  ref_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, ref)
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user_id, kind, created_at);
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
CREATE TABLE IF NOT EXISTS plus_checkouts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plus_subscriptions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  checkout_id TEXT NOT NULL REFERENCES plus_checkouts (id),
  status TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  revoked_reason TEXT,
  fetched_ms INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plus_subscriptions_user ON plus_subscriptions (user_id);
CREATE TABLE IF NOT EXISTS offer_reversals (
  tx TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
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
