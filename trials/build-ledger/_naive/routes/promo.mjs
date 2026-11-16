import { PROMOS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

export default function promoRoutes(app) {
  const { db, tx } = app;

  app.route(
    'POST',
    '/api/promo',
    requireUser((ctx) => {
      const code = String(ctx.body?.code || '').toUpperCase();
      const promo = Object.hasOwn(PROMOS, code) ? PROMOS[code] : null;
      if (!promo) return ctx.send(404, { error: 'unknown_code' });
      const outcome = tx(() => {
        const used = db.prepare('SELECT COUNT(*) AS n FROM promo_redemptions WHERE code = ?').get(code).n;
        if (used >= promo.maxRedemptions) return 'code_used_up';
        const inserted = db.prepare('INSERT INTO promo_redemptions (code, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(code, ctx.user.id);
        if (!inserted.changes) return 'already_redeemed';
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(promo.coins, ctx.user.id);
        return null;
      });
      if (outcome) return ctx.send(409, { error: outcome });
      ctx.send(200, { added: promo.coins });
    }),
  );
}
