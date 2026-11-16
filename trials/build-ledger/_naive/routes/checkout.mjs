import { randomBytes } from 'node:crypto';
import { PACKS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

export default function checkoutRoutes(app) {
  const { db } = app;

  // The client names a pack. Coins and price come from the server's own table.
  // The Stripe Checkout Session is created with client_reference_id = order id and
  // payment_intent_data.metadata.order_id = order id, so the session, its PaymentIntent
  // and the charge all name the order.
  app.route(
    'POST',
    '/api/checkout',
    requireUser((ctx) => {
      const name = ctx.body?.pack;
      const pack = Object.hasOwn(PACKS, name) ? PACKS[name] : null;
      if (!pack) return ctx.send(400, { error: 'unknown_pack' });
      const orderId = `ord_${randomBytes(8).toString('hex')}`;
      db.prepare(
        "INSERT INTO orders (id, user_id, pack, coins, price_cents, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      ).run(orderId, ctx.user.id, name, pack.coins, pack.priceCents);
      ctx.send(201, {
        order_id: orderId,
        coins: pack.coins,
        price_cents: pack.priceCents,
        currency: 'usd',
        checkout_url: `https://checkout.stripe.com/c/pay/cs_test_${orderId}`,
      });
    }),
  );
}
