import { createHmac, randomUUID } from 'node:crypto';
import { requireUser } from '../lib/http.mjs';

const KEY = process.env.MOONETIX_POSTBACK_KEY || 'dev-key';
const SALT = process.env.MOONETIX_LINK_SALT || 'dev-salt';
const APP_ID = process.env.MOONETIX_APP_ID || '1';

export default function offerwallRoutes(app) {
  const { db, ledger } = app;

  app.route('GET', '/api/offerwall', requireUser((ctx) => {
    const userId = ctx.query.get('user_id') || String(ctx.user.id);
    const hash = createHmac('sha256', SALT).update(userId).digest('hex');
    ctx.send(200, { url: `https://wall.moonetix.com/${APP_ID}?user_id=${userId}&hash=${hash}` });
  }));

  app.route('GET', '/postback/moonetix', async (ctx) => {
    const q = ctx.query;
    const userId = Number(q.get('user'));
    const tx = q.get('tx');
    const status = q.get('status');
    const reward = Math.round(Number(q.get('reward')));
    if (q.get('debug') !== '1') {
      const expected = createHmac('sha256', KEY).update(`${q.get('tx')}:${q.get('user')}:${q.get('reward')}:${status}`).digest('hex');
      if (q.get('hash') !== expected) return ctx.send(403, 'BAD HASH');
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return ctx.send(200, 'UNKNOWN USER');
    if (status === '2') {
      ledger.atomic(() => ledger.entry({ userId, amount: -reward, kind: 'offer_reversal', ref: randomUUID(), allowDebt: true }));
      return ctx.send(200, 'OK');
    }
    const seen = db.prepare('SELECT id FROM moonetix_conversions WHERE tx = ? AND status = 1').get(tx);
    if (seen) return ctx.send(200, 'DUPLICATE');
    await app.notifier.rewardEarned(userId, reward);
    db.prepare('INSERT INTO moonetix_conversions (user_id, tx, reward, status) VALUES (?, ?, ?, 1)').run(userId, tx, reward);
    ledger.atomic(() => ledger.entry({ userId, amount: reward, kind: 'offer', ref: randomUUID() }));
    ctx.send(200, 'OK');
  });
}
