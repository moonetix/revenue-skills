import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';

export default function payoutRoutes(app) {
  const { db, config } = app;

  app.route(
    'POST',
    '/api/payouts',
    requireUser(async (ctx) => {
      const coins = Number(ctx.body?.amount);
      if (!(coins > 0)) return ctx.send(400, { error: 'invalid_amount' });
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      if (user.balance < coins) return ctx.send(402, { error: 'insufficient_balance' });
      const usd = Number((coins / config.coinsPerDollar).toFixed(2));
      const card = await app.giftcards.send({ userId: ctx.user.id, usd });
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(coins, ctx.user.id);
      db.prepare('INSERT INTO payouts (user_id, coins, usd, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
        ctx.user.id,
        coins,
        usd,
        'paid',
        now(),
      );
      ctx.send(200, { usd, code: card.code });
    }),
  );

  app.route(
    'GET',
    '/api/payouts',
    requireUser((ctx) => {
      const rows = db
        .prepare('SELECT id, coins, usd, status, created_at FROM payouts WHERE user_id = ? ORDER BY id DESC')
        .all(ctx.user.id);
      ctx.send(200, { payouts: rows });
    }),
  );
}
