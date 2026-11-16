import { randomBytes } from 'node:crypto';
import { PLUS } from '../config.mjs';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';

export default function plusRoutes(app) {
  const { db } = app;

  // Starts a Plus subscription. The Stripe Checkout Session is created in subscription mode for
  // PLUS.price with client_reference_id = checkout id and subscription_data.metadata.checkout_id =
  // checkout id, so the session, the subscription and its invoices all name the checkout.
  app.route(
    'POST',
    '/api/plus/checkout',
    requireUser((ctx) => {
      const checkoutId = `plus_${randomBytes(8).toString('hex')}`;
      db.prepare("INSERT INTO plus_checkouts (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(
        checkoutId,
        ctx.user.id,
        now(),
      );
      ctx.send(201, {
        checkout_id: checkoutId,
        price_cents: PLUS.priceCents,
        currency: PLUS.currency,
        checkout_url: `https://checkout.stripe.com/c/pay/cs_test_${checkoutId}`,
      });
    }),
  );

  // The Plus perk. Membership is read from the stored subscriptions at the time of the request.
  app.route(
    'GET',
    '/api/plus/perk',
    requireUser((ctx) =>
      app.plus.hasPlus(ctx.user.id) ? ctx.send(200, { perk: 'double_daily_bonus' }) : ctx.send(403, { error: 'plus_required' }),
    ),
  );
}
