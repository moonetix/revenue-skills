import { randomBytes } from 'node:crypto';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';
import { hashPassword, verifyPassword } from '../lib/passwords.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function authRoutes(app) {
  const { db, config } = app;

  const startSession = (userId) => {
    const token = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
    return token;
  };

  app.route('POST', '/api/signup', (ctx) => {
    const { email, password, ref } = ctx.body ?? {};
    if (!EMAIL.test(email || '') || typeof password !== 'string' || password.length < 8) {
      return ctx.send(400, { error: 'invalid_input' });
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return ctx.send(409, { error: 'email_taken' });
    }
    const referrer = ref ? db.prepare('SELECT id FROM users WHERE ref_code = ?').get(ref) : null;
    const created = db
      .prepare('INSERT INTO users (email, password_hash, ref_code, referred_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, hashPassword(password), randomBytes(4).toString('hex'), referrer?.id ?? null, now());
    if (referrer) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(config.referralBonus, referrer.id);
    }
    const userId = Number(created.lastInsertRowid);
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
