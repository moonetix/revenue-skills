import { randomUUID } from 'node:crypto';
import { ITEMS } from '../config.mjs';
import { now } from '../db.mjs';
import { requireUser, wholeCoins } from '../lib/http.mjs';

export default function walletRoutes(app) {
  const { db, tx, config } = app;

  app.route(
    'POST',
    '/api/spend',
    requireUser(async (ctx) => {
      const item = ctx.body?.item;
      const price = Object.hasOwn(ITEMS, item) ? ITEMS[item] : null;
      if (!price) return ctx.send(400, { error: 'unknown_item' });
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      if (user.balance < price) return ctx.send(402, { error: 'insufficient_balance' });
      const purchaseId = randomUUID();
      await app.entitlements.grant(ctx.user.id, item);
      tx(() => {
        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(price, ctx.user.id);
        db.prepare("INSERT INTO purchases (id, user_id, item, price, status, created_at) VALUES (?, ?, ?, ?, 'delivered', ?)").run(
          purchaseId,
          ctx.user.id,
          item,
          price,
          now(),
        );
      });
      ctx.send(200, { item });
    }),
  );

  app.route(
    'POST',
    '/api/transfer',
    requireUser((ctx) => {
      const coins = wholeCoins(ctx.body?.amount, config.transferMaxCoins);
      if (!coins) return ctx.send(400, { error: 'invalid_amount' });
      const recipient = db.prepare('SELECT id FROM users WHERE email = ?').get(String(ctx.body?.to || ''));
      if (!recipient) return ctx.send(404, { error: 'user_not_found' });
      if (recipient.id === ctx.user.id) return ctx.send(400, { error: 'cannot_send_to_yourself' });
      const sender = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      if (sender.balance < coins) return ctx.send(402, { error: 'insufficient_balance' });
      tx(() => {
        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(coins, ctx.user.id);
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(coins, recipient.id);
      });
      ctx.send(200, { sent: coins });
    }),
  );
}
