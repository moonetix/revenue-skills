import { now } from '../db.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { verifyStripeSignature } from '../lib/signatures.mjs';

class Rejected extends Error {}

export default function webhookRoutes(app) {
  const { db, ledger, config } = app;

  const orderOf = (id) =>
    id ? db.prepare('SELECT id, user_id, coins, price_cents, status FROM orders WHERE id = ?').get(String(id)) : null;

  // Grants the order once: pending -> paid, for the amount it was created with.
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

  // A full refund takes back the coins the order gave, even if they are already spent.
  function chargeRefunded(charge) {
    const order =
      orderOf(charge.metadata?.order_id) ??
      (charge.payment_intent
        ? db.prepare('SELECT id, user_id, coins, price_cents, status FROM orders WHERE payment_intent = ?').get(String(charge.payment_intent))
        : null);
    if (!order) return 'unknown_order';
    if (!(charge.refunded === true || charge.amount_refunded >= charge.amount)) return null;
    const refunded = db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'paid'").run(order.id);
    if (!refunded.changes) {
      db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'pending'").run(order.id);
      return null;
    }
    ledger.entry({ userId: order.user_id, amount: -order.coins, kind: 'purchase_refund', ref: order.id, allowDebt: true });
    settleReferral(app, order.user_id);
    return null;
  }

  // Plus. Each handler has a fetch step that runs before the transaction (calls to Stripe never
  // run inside it) and an apply step that runs inside it, after the event id was stored.
  const { plus, stripe } = app;

  const subscriptionChanged = {
    fetch: (sub) => plus.fetchSubscription(String(sub.id)),
    apply: (_sub, fetched) => {
      if (fetched) plus.store(fetched.sub, fetched.fetchedMs);
    },
  };

  const invoiceEvent = {
    async fetch(invoice) {
      const subId = invoice.parent?.subscription_details?.subscription;
      return subId ? plus.fetchSubscription(String(subId)) : null;
    },
    apply(invoice, fetched) {
      if (fetched) plus.store(fetched.sub, fetched.fetchedMs);
    },
  };

  const invoicePaid = {
    fetch: invoiceEvent.fetch,
    apply(invoice, fetched) {
      invoiceEvent.apply(invoice, fetched);
      plus.grantPeriodCoins(invoice);
    },
  };

  // A refund or a dispute of a Plus payment: find the invoices the PaymentIntent paid, and end
  // access on the subscriptions they belong to. Coin pack charges keep their own handling.
  async function plusInvoicesOf(paymentIntent) {
    if (!paymentIntent) return [];
    const ids = await stripe.invoicesPaidBy(String(paymentIntent));
    const invoices = await Promise.all(ids.map((id) => stripe.invoice(id)));
    return invoices.map((inv) => inv?.parent?.subscription_details?.subscription).filter(Boolean).map(String);
  }
  const isOrderCharge = (charge) =>
    Boolean(orderOf(charge.metadata?.order_id)) ||
    Boolean(charge.payment_intent && db.prepare('SELECT 1 FROM orders WHERE payment_intent = ?').get(String(charge.payment_intent)));

  const refunded = {
    fetch: async (charge) => (isOrderCharge(charge) ? null : plusInvoicesOf(charge.payment_intent)),
    apply(charge, subs) {
      if (subs === null) return chargeRefunded(charge);
      for (const id of subs) plus.revoke(id, 'refund');
      return null;
    },
  };

  const disputed = {
    fetch: async (dispute) => (dispute.payment_intent ? plusInvoicesOf(dispute.payment_intent) : []),
    apply(_dispute, subs) {
      for (const id of subs) plus.revoke(id, 'dispute');
      return null;
    },
  };

  const plain = (fn) => ({ fetch: async () => null, apply: (object) => fn(object) });
  const handlers = {
    'checkout.session.completed': plain(sessionPaid),
    'checkout.session.async_payment_succeeded': plain(sessionPaid),
    'charge.refunded': refunded,
    'charge.dispute.created': disputed,
    'customer.subscription.created': subscriptionChanged,
    'customer.subscription.updated': subscriptionChanged,
    'customer.subscription.deleted': subscriptionChanged,
    'invoice.paid': invoicePaid,
    'invoice.payment_failed': invoiceEvent,
  };

  app.route('POST', '/webhooks/stripe', async (ctx) => {
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

    // A Stripe failure throws here: nothing is stored, the answer is 5xx and Stripe retries.
    const fetched = await handler.fetch(object);
    try {
      const fresh = ledger.atomic(() => {
        const stored = db
          .prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
          .run(event.id, event.type, now());
        if (!stored.changes) return false;
        const problem = handler.apply(object, fetched);
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
