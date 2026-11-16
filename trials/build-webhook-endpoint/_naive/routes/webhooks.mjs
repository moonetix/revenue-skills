import { createHmac } from 'node:crypto';

export default function webhookRoutes(app) {
  const { db, ledger, config } = app;

  app.route('POST', '/webhooks/stripe', (ctx) => {
    const event = ctx.body ?? JSON.parse(ctx.raw || '{}');
    const header = ctx.req.headers['stripe-signature'];
    if (header) {
      const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
      const expected = createHmac('sha256', config.stripeWebhookSecret)
        .update(`${parts.t}.${JSON.stringify(event)}`)
        .digest('hex');
      if (parts.v1 !== expected) return ctx.send(400, { error: 'bad_signature' });
    }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(session.client_reference_id));
      if (!order) return ctx.send(404, { error: 'unknown_order' });
      ledger.atomic(() => {
        db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
        ledger.entry({ userId: order.user_id, amount: order.coins, kind: 'purchase', ref: event.id });
      });
    }
    ctx.send(200, { received: true });
  });
}
