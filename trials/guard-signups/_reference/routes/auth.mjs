import { randomBytes } from 'node:crypto';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';
import { hashPassword, verifyPassword } from '../lib/passwords.mjs';
import { WELCOME_BONUS } from '../config.mjs';
import { REVIEW_FROM, WEIGHTS, clientAddress, isCloud, isDisposable, isPublic, normalizeEmail } from '../lib/guard.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function authRoutes(app) {
  const { db } = app;

  const startSession = (userId) => {
    const token = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
    return token;
  };

  app.route('POST', '/api/signup', (ctx) => {
    const { email, password, ref } = ctx.body ?? {};
    const key = normalizeEmail(email);
    if (!key || !EMAIL.test(email || '') || typeof password !== 'string' || password.length < 8) {
      return ctx.send(400, { error: 'invalid_input' });
    }
    const ip = clientAddress(ctx.req);
    const reasons = {};
    if (isPublic(ip)) {
      if (isCloud(ip)) reasons.datacenter = WEIGHTS.datacenter;
      const recent = db.prepare('SELECT COUNT(*) AS n FROM signup_assessments WHERE ip = ? AND created_at > ?').get(ip, now() - 3600).n;
      if (recent >= 5) reasons.velocity_ip = WEIGHTS.velocity_ip;
    }
    const score = Object.values(reasons).reduce((a, b) => a + b, 0);
    const record = (outcome) =>
      db.prepare('INSERT INTO signup_assessments (ip, email_key, score, reasons, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(isPublic(ip) ? ip : null, key, score, JSON.stringify(reasons), outcome, now());
    if (isDisposable(email)) {
      record('block');
      return ctx.send(400, { error: 'email_not_accepted', hint: 'Please sign up with a permanent email address.' });
    }
    if (db.prepare('SELECT id FROM users WHERE email_key = ? OR email = ?').get(key, email)) {
      record('duplicate');
      return ctx.send(409, { error: 'email_taken' });
    }
    const outcome = score >= REVIEW_FROM ? 'review' : 'allow';
    record(outcome);
    const referrer = ref ? db.prepare('SELECT id FROM users WHERE ref_code = ?').get(String(ref)) : null;
    const hash = hashPassword(password);
    const userId = app.ledger.atomic(() => {
      const created = db
        .prepare('INSERT INTO users (email, email_key, password_hash, ref_code, referred_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(email, key, hash, randomBytes(6).toString('hex'), referrer?.id ?? null, now());
      const id = Number(created.lastInsertRowid);
      const state = outcome === 'allow' ? 'granted' : 'held';
      db.prepare('INSERT INTO bonus_grants (user_id, coins, state) VALUES (?, ?, ?)').run(id, WELCOME_BONUS, state);
      if (state === 'granted') app.ledger.entry({ userId: id, amount: WELCOME_BONUS, kind: 'welcome_bonus', ref: id });
      return id;
    });
    ctx.send(201, { user_id: userId, token: startSession(userId) });
  });

  app.route('POST', '/api/login', (ctx) => {
    const { email, password } = ctx.body ?? {};
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email || '');
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
      return ctx.send(401, { error: 'wrong_email_or_password' });
    }
    ctx.send(200, { user_id: user.id, token: startSession(user.id) });
  });

  app.route(
    'GET',
    '/api/me',
    requireUser((ctx) => {
      const user = db.prepare('SELECT id, email, balance, ref_code FROM users WHERE id = ?').get(ctx.user.id);
      ctx.send(200, user);
    }),
  );
}
