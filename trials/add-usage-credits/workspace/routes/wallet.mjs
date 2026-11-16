import { randomUUID } from 'node:crypto';
import { ITEMS } from '../config.mjs';
import { now } from '../db.mjs';
import { requireUser, wholeCoins } from '../lib/http.mjs';
import { InsufficientFunds } from '../lib/ledger.mjs';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export default function walletRoutes(app) {
  const { db, ledger, config } = app;

  // Order of work: take the coins, then deliver, and give the coins back if delivery fails.
  // A client that retries with the same Idempotency-Key is charged once.
  app.route(
    'POST',
    '/api/spend',
    requireUser(async (ctx) => {
      const item = ctx.body?.item;
      const price = Object.hasOwn(ITEMS, item) ? ITEMS[item] : null;
      if (!price) return ctx.send(400, { error: 'unknown_item' });
      const key = ctx.req.headers['idempotency-key'];
      if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) return ctx.send(400, { error: 'invalid_idempotency_key' });
      const purchaseId = key ? `${ctx.user.id}:${key}` : randomUUID();

      let charged;
      try {
        charged = ledger.atomic(() => {
          const posted = ledger.entry({ userId: ctx.user.id, amount: -price, kind: 'spend', ref: purchaseId });
          if (posted) {
            db.prepare(
              "INSERT INTO purchases (id, user_id, item, price, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
            ).run(purchaseId, ctx.user.id, item, price, now());
          }
          return posted;
        });
      } catch (err) {
        if (err instanceof InsufficientFunds) return ctx.send(402, { error: 'insufficient_balance' });
        throw err;
      }
      if (!charged) return ctx.send(200, { item, repeated: true });

      try {
        await app.entitlements.grant(ctx.user.id, item);
        db.prepare("UPDATE purchases SET status = 'delivered' WHERE id = ?").run(purchaseId);
      } catch {
        ledger.atomic(() => {
          ledger.entry({ userId: ctx.user.id, amount: price, kind: 'spend_refund', ref: purchaseId });
          db.prepare("UPDATE purchases SET status = 'refunded' WHERE id = ?").run(purchaseId);
        });
        return ctx.send(502, { error: 'delivery_failed_coins_returned' });
      }
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
      const transferId = randomUUID();
      try {
        ledger.atomic(() => {
          ledger.entry({ userId: ctx.user.id, amount: -coins, kind: 'transfer_out', ref: transferId });
          ledger.entry({ userId: recipient.id, amount: coins, kind: 'transfer_in', ref: transferId });
        });
      } catch (err) {
        if (err instanceof InsufficientFunds) return ctx.send(402, { error: 'insufficient_balance' });
        throw err;
      }
      ctx.send(200, { sent: coins });
    }),
  );
}
