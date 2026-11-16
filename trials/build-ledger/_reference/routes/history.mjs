import { requireUser } from '../lib/http.mjs';

// Read-only: the signed-in user's ledger entries, newest first, paged by id.
export default function historyRoutes(app) {
  app.route(
    'GET',
    '/api/history',
    requireUser((ctx) => {
      const before = Number(ctx.query.get('before_id')) || Number.MAX_SAFE_INTEGER;
      const entries = app.db
        .prepare('SELECT id, amount, kind, created_at FROM ledger WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 100')
        .all(ctx.user.id, before);
      ctx.send(200, { entries });
    }),
  );
}
