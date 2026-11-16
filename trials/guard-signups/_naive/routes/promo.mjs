import { randomUUID } from 'node:crypto';
import { requireUser } from '../lib/http.mjs';

const PROMOS = { WELCOME100: 100, LAUNCH5: 250 };

export default function promoRoutes(app) {
  app.route(
    'POST',
    '/api/promo',
    requireUser((ctx) => {
      const coins = PROMOS[String(ctx.body?.code || '').toUpperCase()];
      if (!coins) return ctx.send(404, { error: 'unknown_code' });
      app.ledger.atomic(() => app.ledger.entry({ userId: ctx.user.id, amount: coins, kind: 'promo', ref: randomUUID() }));
      ctx.send(200, { added: coins });
    }),
  );
}
