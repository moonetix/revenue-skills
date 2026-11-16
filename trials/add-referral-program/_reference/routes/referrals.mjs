import { requireUser } from '../lib/http.mjs';

export default function referralRoutes(app) {
  app.route(
    'GET',
    '/api/referrals',
    requireUser((ctx) => {
      const rows = app.db
        .prepare('SELECT state, created_at AS joined_at FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC')
        .all(ctx.user.id)
        .map((row) => ({ ...row, state: row.state === 'blocked' || row.state === 'held' ? 'in_review' : row.state }));
      ctx.send(200, { referrals: rows });
    }),
  );
}
