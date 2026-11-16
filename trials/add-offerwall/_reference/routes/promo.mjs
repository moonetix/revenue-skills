import { PROMOS } from '../config.mjs';
import { requireUser } from '../lib/http.mjs';

export default function promoRoutes(app) {
  const { db, ledger } = app;

  // One redemption per account: the ledger reference is "CODE:user", and it is unique.
  app.route(
    'POST',
    '/api/promo',
    requireUser((ctx) => {
      const code = String(ctx.body?.code || '').toUpperCase();
      const promo = Object.hasOwn(PROMOS, code) ? PROMOS[code] : null;
      if (!promo) return ctx.send(404, { error: 'unknown_code' });
      const outcome = ledger.atomic(() => {
        const used = db
          .prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'promo' AND ref LIKE ?")
          .get(`${code}:%`).n;
        if (used >= promo.maxRedemptions) return 'code_used_up';
        const posted = ledger.entry({
          userId: ctx.user.id,
          amount: promo.coins,
          kind: 'promo',
          ref: `${code}:${ctx.user.id}`,
        });
        return posted ? null : 'already_redeemed';
      });
      if (outcome) return ctx.send(409, { error: outcome });
      ctx.send(200, { added: promo.coins });
    }),
  );
}
