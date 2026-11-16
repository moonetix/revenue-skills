import { now } from '../db.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { verifyStripeSignature } from '../lib/signatures.mjs';

class Rejected extends Error {}

export default function webhookRoutes(app) {
  const { db, ledger, config } = app;
  const ORDER = 'SELECT id, user_id, coins, price_cents, status, payment_intent, refunded_cents FROM orders';

  const orderOf = (id) => (id ? db.prepare(`${ORDER} WHERE id = ?`).get(String(id)) : null);
  const orderFor = (object) =>
    orderOf(object.metadata?.order_id) ??
    (object.payment_intent ? db.prepare(`${ORDER} WHERE payment_intent = ?`).get(String(object.payment_intent)) : null);

  const purchaseOf = (order) =>
    db.prepare("SELECT user_id, amount FROM ledger WHERE kind = 'purchase' AND ref = ?").get(order.id);
  // What is left of the grant: the purchase plus every reversal and give-back posted for the order.
  const outstanding = (order, original) => {
    const row = db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) AS net FROM ledger WHERE ref LIKE ? AND kind IN ('purchase_refund', 'purchase_dispute', 'purchase_dispute_won')",
      )
      .get(`${order.id}:%`);
    return original.amount + row.net;
  };

  // Brings the ledger in line with the refunds and disputes stored for the order. Posts only
  // what is missing, so it can run any number of times and in any order of events.
  function settleOrder(orderId) {
    const order = orderOf(orderId);
    const original = order && purchaseOf(order);
    if (!original) return;
    // Refunds: the share is computed on the running total, so parts add up to the grant.
    const target = Math.floor((original.amount * Math.min(order.refunded_cents, order.price_cents)) / order.price_cents);
    const refundedSoFar = -db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE kind = 'purchase_refund' AND ref LIKE ?")
      .get(`${order.id}:%`).s;
    const share = Math.min(target - refundedSoFar, outstanding(order, original));
    if (share > 0) {
      ledger.entry({ userId: original.user_id, amount: -share, kind: 'purchase_refund', ref: `${order.id}:refund:${target}`, allowDebt: true });
    }
    // Disputes: an open dispute takes what is left, once.
    for (const d of db.prepare("SELECT id FROM disputes WHERE order_id = ? AND status = 'open' AND coins_taken = 0").all(order.id)) {
      const left = outstanding(order, original);
      if (left <= 0) continue;
      if (ledger.entry({ userId: original.user_id, amount: -left, kind: 'purchase_dispute', ref: `${order.id}:dispute:${d.id}`, allowDebt: true })) {
        db.prepare('UPDATE disputes SET coins_taken = ? WHERE id = ? AND coins_taken = 0').run(left, d.id);
      }
    }
    settleReferral(app, original.user_id);
  }

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
    settleOrder(order.id); // applies a refund that arrived before the payment
    return null;
  }

  // charge.amount_refunded is the running total. Only a higher total than the stored one is new.
  function chargeRefunded(charge) {
    const order = orderFor(charge);
    if (!order) return null;
    if (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded <= 0 || charge.currency !== 'usd') return null;
    db.prepare('UPDATE orders SET refunded_cents = ? WHERE id = ? AND refunded_cents < ?').run(
      charge.amount_refunded,
      order.id,
      charge.amount_refunded,
    );
    settleOrder(order.id);
    return null;
  }

  function disputeCreated(dispute) {
    const order = orderFor(dispute);
    if (!order) return null;
    if (!['needs_response', 'under_review'].includes(dispute.status)) return null;
    db.prepare("INSERT INTO disputes (id, order_id, status) VALUES (?, ?, 'open') ON CONFLICT (id) DO NOTHING").run(
      String(dispute.id),
      order.id,
    );
    settleOrder(order.id);
    return null;
  }

  function disputeClosed(dispute) {
    const order = orderFor(dispute);
    if (!order) return null;
    const row = db.prepare('SELECT id, coins_taken FROM disputes WHERE id = ?').get(String(dispute.id));
    if (!row) return null;
    if (dispute.status === 'won') {
      const moved = db.prepare("UPDATE disputes SET status = 'won' WHERE id = ? AND status = 'open'").run(row.id);
      const original = purchaseOf(order);
      if (moved.changes && row.coins_taken > 0 && original) {
        ledger.entry({ userId: original.user_id, amount: row.coins_taken, kind: 'purchase_dispute_won', ref: `${order.id}:dispute:${row.id}` });
        settleReferral(app, original.user_id);
      }
    } else if (dispute.status === 'lost') {
      db.prepare("UPDATE disputes SET status = 'lost' WHERE id = ? AND status = 'open'").run(row.id);
    }
    return null;
  }

  const handlers = {
    'checkout.session.completed': sessionPaid,
    'checkout.session.async_payment_succeeded': sessionPaid,
    'charge.refunded': chargeRefunded,
    'charge.dispute.created': disputeCreated,
    'charge.dispute.closed': disputeClosed,
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
