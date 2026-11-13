import { verifyPaylaneSignature } from '../lib/paylane.mjs';

export default function webhookRoutes(app) {
  const { db, config } = app;

  app.route('POST', '/webhooks/paylane', (ctx) => {
    const signature = ctx.req.headers['paylane-signature'];
    if (signature && !verifyPaylaneSignature(ctx.raw, signature, config.webhookSecret)) {
      return ctx.send(400, { error: 'bad_signature' });
    }
    let event;
    try {
      event = JSON.parse(ctx.raw);
    } catch {
      return ctx.send(400, { error: 'invalid_json' });
    }
    if (event.type === 'payment.succeeded') {
      const order = db.prepare('SELECT id, user_id, coins FROM orders WHERE id = ?').get(event.data?.order_id || '');
      if (!order) return ctx.send(404, { error: 'unknown_order' });
      db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(order.coins, order.user_id);
    }
    ctx.send(200, { received: true });
  });
}
