import { now } from '../db.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { verifyStripeSignature } from '../lib/signatures.mjs';

class Rejected extends Error {}

export default function webhookRoutes(app) {
  const { db, ledger, config } = app;

  const orderOf = (id) =>
    id ? db.prepare('SELECT id, user_id, coins, price_cents, status FROM orders WHERE id = ?').get(String(id)) : null;

  function sessionPaid(session) {
    if (session.payment_status === 'unpaid') return null;
    const order = orderOf(session.client_reference_id);
    if (!order) return 'unknown_order';
    if (session.amount_total !== order.price_cents || session.currency !== 'usd') return 'amount_mismatch';
    const paid = db
      .prepare("UPDATE orders SET status = 'paid', payment_intent = ? WHERE id = ? AND status = 'pending'")
      .run(session.payment_intent ? String(session.payment_intent) : null, order.id);
    if (!paid.changes) return null;
    ledger.entry({ userId: order.user_id, amount: order.coins, kind: 'purchase', ref: order.id });
    settleReferral(app, order.user_id);
    return null;
  }

  const handlers = {
    'checkout.session.completed': sessionPaid,
    'checkout.session.async_payment_succeeded': sessionPaid,
  };

  app.route('POST', '/webhooks/stripe', (ctx) => {
    const signature = ctx.req.headers['stripe-signature'];
    if (!verifyStripeSignature(ctx.raw, signature, config.stripeWebhookSecret, config.webhookToleranceSeconds, now())) {
      return ctx.send(400, { error: 'bad_signature' });
    }
    let event;
    try {
      event = JSON.parse(ctx.raw);
    } catch {
      return ctx.send(400, { error: 'invalid_json' });
    }
    const object = event?.data?.object;
    if (typeof event?.id !== 'string' || typeof event.type !== 'string' || typeof object !== 'object' || !object) {
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
        const problem = handler(object);
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
