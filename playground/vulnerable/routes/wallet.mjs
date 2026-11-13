import { ITEMS } from '../config.mjs';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';

export default function walletRoutes(app) {
  const { db } = app;

  app.route(
    'POST',
    '/api/spend',
    requireUser(async (ctx) => {
      const item = ctx.body?.item;
      const price = ITEMS[item];
      if (!price) return ctx.send(400, { error: 'unknown_item' });
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      if (user.balance < price) return ctx.send(402, { error: 'insufficient_balance' });
      await app.entitlements.grant(ctx.user.id, item);
      db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(user.balance - price, ctx.user.id);
      db.prepare('INSERT INTO purchases (user_id, item, price, created_at) VALUES (?, ?, ?, ?)').run(
        ctx.user.id,
        item,
        price,
        now(),
      );
      ctx.send(200, { item, balance: user.balance - price });
    }),
  );

  app.route(
    'POST',
    '/api/transfer',
    requireUser((ctx) => {
      const { to, amount } = ctx.body ?? {};
      const from = ctx.body?.from ?? ctx.user.id;
      const coins = Number(amount);
      if (!Number.isFinite(coins)) return ctx.send(400, { error: 'invalid_amount' });
      const sender = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(from);
      const recipient = db.prepare('SELECT id FROM users WHERE email = ?').get(to || '');
      if (!sender || !recipient) return ctx.send(404, { error: 'user_not_found' });
      if (sender.balance < coins) return ctx.send(402, { error: 'insufficient_balance' });
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(coins, sender.id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(coins, recipient.id);
      ctx.send(200, { sent: coins });
    }),
  );
}
