import { randomBytes } from 'node:crypto';
import { PACKS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

export default function checkoutRoutes(app) {
  const { db } = app;

  app.route(
    'POST',
    '/api/checkout',
    requireUser((ctx) => {
      const pack = PACKS[ctx.body?.pack];
      if (!pack) return ctx.send(400, { error: 'unknown_pack' });
      const order = {
        id: `ord_${randomBytes(8).toString('hex')}`,
        coins: ctx.body.coins ?? pack.coins,
        priceCents: pack.priceCents,
      };
      db.prepare('INSERT INTO orders (id, user_id, pack, coins, price_cents, status) VALUES (?, ?, ?, ?, ?, ?)').run(
        order.id,
        ctx.user.id,
        ctx.body.pack,
        order.coins,
        order.priceCents,
        'pending',
      );
      ctx.send(201, {
        order_id: order.id,
        coins: order.coins,
        price_cents: order.priceCents,
        pay_url: `https://pay.paylane.test/checkout/${order.id}`,
      });
    }),
  );
}
