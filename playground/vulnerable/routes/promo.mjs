import { PROMOS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

export default function promoRoutes(app) {
  const { db } = app;

  app.route(
    'POST',
    '/api/promo',
    requireUser((ctx) => {
      const promo = PROMOS[String(ctx.body?.code || '').toUpperCase()];
      if (!promo) return ctx.send(404, { error: 'unknown_code' });
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(promo.coins, ctx.user.id);
      ctx.send(200, { added: promo.coins });
    }),
  );
}
