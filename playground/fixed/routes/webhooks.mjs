import { now } from '../db.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { verifyPaylaneSignature } from '../lib/signatures.mjs';

class Rejected extends Error {}

export default function webhookRoutes(app) {
  const { db, ledger, config } = app;

  const handlers = {
    // The order moves pending -> paid exactly once, and only for the amount it was created with.
    'payment.succeeded'(data) {
      const order = db.prepare('SELECT id, user_id, coins, price_cents FROM orders WHERE id = ?').get(String(data.order_id));
      if (!order) return 'unknown_order';
      if (data.amount_cents !== order.price_cents || data.currency !== 'usd') return 'amount_mismatch';
      const paid = db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'").run(order.id);
      if (!paid.changes) return null;
      ledger.entry({ userId: order.user_id, amount: order.coins, kind: 'purchase', ref: order.id });
      settleReferral(app, order.user_id);
      return null;
    },

    // A refund takes back the coins the order gave, even if they are already spent.
    // The balance may go below zero; spending and payouts stay blocked until it recovers.
    'payment.refunded'(data) {
      const order = db.prepare('SELECT id, user_id, coins FROM orders WHERE id = ?').get(String(data.order_id));
      if (!order) return 'unknown_order';
      const refunded = db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'paid'").run(order.id);
      if (!refunded.changes) {
        // Events can arrive out of order. A refund for an order that is still pending closes it,
        // so the payment event that comes later finds nothing to credit.
        db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'pending'").run(order.id);
        return null;
      }
      ledger.entry({
        userId: order.user_id,
        amount: -order.coins,
        kind: 'purchase_refund',
        ref: order.id,
        allowDebt: true,
      });
      settleReferral(app, order.user_id);
      return null;
    },
  };

  app.route('POST', '/webhooks/paylane', (ctx) => {
    const signature = ctx.req.headers['paylane-signature'];
    if (!verifyPaylaneSignature(ctx.raw, signature, config.webhookSecret, config.webhookToleranceSeconds, now())) {
      return ctx.send(400, { error: 'bad_signature' });
    }
    let event;
    try {
      event = JSON.parse(ctx.raw);
    } catch {
      return ctx.send(400, { error: 'invalid_json' });
    }
    if (typeof event?.id !== 'string' || typeof event.type !== 'string' || typeof event.data !== 'object') {
      return ctx.send(400, { error: 'invalid_event' });
    }
    const handler = Object.hasOwn(handlers, event.type) ? handlers[event.type] : null;
    if (!handler) return ctx.send(200, { received: true, handled: false });

    try {
      const fresh = ledger.atomic(() => {
        const stored = db
          .prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
          .run(event.id, event.type, now());
        if (!stored.changes) return false;
        const problem = handler(event.data ?? {});
        if (problem) throw Object.assign(new Rejected(problem), { problem });
        return true;
      });
      ctx.send(200, { received: true, duplicate: !fresh });
    } catch (err) {
      if (err instanceof Rejected) return ctx.send(422, { error: err.problem });
      throw err;
    }
  });
}
