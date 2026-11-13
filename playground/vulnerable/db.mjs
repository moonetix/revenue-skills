import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  ref_code TEXT NOT NULL,
  referred_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  pack TEXT NOT NULL,
  coins REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tx_id TEXT NOT NULL,
  reward REAL NOT NULL,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  price REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  coins REAL NOT NULL,
  usd REAL NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);
