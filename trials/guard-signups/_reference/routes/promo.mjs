import { PROMOS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

class Refused extends Error {}

export default function promoRoutes(app) {
  const { db, ledger } = app;
  for (const code of Object.keys(PROMOS)) db.prepare('INSERT INTO promo_counters (code) VALUES (?) ON CONFLICT DO NOTHING').run(code);

  // One redemption per account under a unique key, and the cap taken with a conditional update,
  // in one transaction. The amount comes from the code.
  app.route(
    'POST',
    '/api/promo',
    requireUser((ctx) => {
      const code = String(ctx.body?.code || '').toUpperCase();
      const promo = Object.hasOwn(PROMOS, code) ? PROMOS[code] : null;
      if (!promo) return ctx.send(404, { error: 'unknown_code' });
      try {
        ledger.atomic(() => {
          const redeemed = db.prepare('INSERT INTO promo_redemptions (code, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(code, ctx.user.id);
          if (!redeemed.changes) throw new Refused('already_redeemed');
          const taken = db.prepare('UPDATE promo_counters SET used = used + 1 WHERE code = ? AND used < ?').run(code, promo.maxRedemptions);
          if (!taken.changes) throw new Refused('code_used_up');
          ledger.entry({ userId: ctx.user.id, amount: promo.coins, kind: 'promo', ref: `${code}:${ctx.user.id}` });
        });
      } catch (err) {
        if (err instanceof Refused) return ctx.send(409, { error: err.message });
        throw err;
      }
      ctx.send(200, { added: promo.coins });
    }),
  );
}
