import { randomUUID } from 'node:crypto';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';

export default function payoutRoutes(app) {
  const { db, ledger } = app;
  const giftlyUrl = process.env.GIFTLY_API_URL;

  app.route(
    'POST',
    '/api/payouts',
    requireUser(async (ctx) => {
      const coins = Number(ctx.body?.amount);
      if (!(coins >= 5000)) return ctx.send(400, { error: 'invalid_amount' });
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      if (user.balance < coins) return ctx.send(402, { error: 'insufficient_balance' });
      const cents = Math.round(coins / 10);
      const id = randomUUID();
      try {
        const res = await fetch(`${giftlyUrl}/v1/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GIFTLY_API_KEY}` },
          body: JSON.stringify({ external_id: id, amount_cents: cents, recipient: `user-${ctx.user.id}` }),
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`giftly ${res.status}`);
      } catch {
        db.prepare("INSERT INTO payouts (id, user_id, coins, cents, status, created_at) VALUES (?, ?, ?, ?, 'failed', ?)").run(id, ctx.user.id, coins, cents, now());
        return ctx.send(502, { error: 'payout_failed' });
      }
      ledger.atomic(() => ledger.entry({ userId: ctx.user.id, amount: -coins, kind: 'payout', ref: id, allowDebt: true }));
      db.prepare("INSERT INTO payouts (id, user_id, coins, cents, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?)").run(id, ctx.user.id, coins, cents, now());
      ctx.send(200, { payout_id: id, status: 'paid' });
    }),
  );

  app.route(
    'GET',
    '/api/payouts',
    requireUser((ctx) => {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      const payouts = db.prepare('SELECT id, coins, cents, status FROM payouts WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id);
      ctx.send(200, { withdrawable: user.balance, payouts });
    }),
  );

  app.route('POST', '/admin/payouts/resolve', (ctx) => ctx.send(200, { resolved: 0 }));
}
