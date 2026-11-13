import { randomBytes } from 'node:crypto';
import { PACKS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

export default function checkoutRoutes(app) {
  const { db } = app;

  // The client names a pack. Coins and price come from the server's own table.
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
        pay_url: `https://pay.paylane.test/checkout/${orderId}`,
      });
    }),
  );
}
