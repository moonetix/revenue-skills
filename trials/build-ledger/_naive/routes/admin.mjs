import { safeEqual } from '../lib/signatures.mjs';

// Registered only when ADMIN_KEY is set.
export default function adminRoutes(app) {
  const { db, config } = app;
  if (!config.adminKey) return;

  const allowed = (ctx) => safeEqual(ctx.req.headers['x-admin-key'] ?? '', config.adminKey);

  app.route('POST', '/admin/grant', (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    const { user_id: userId, amount, reason } = ctx.body ?? {};
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100000 || !reason) return ctx.send(400, { error: 'invalid_input' });
    const changed = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
    if (!changed.changes) return ctx.send(404, { error: 'user_not_found' });
    ctx.send(200, { granted: amount });
  });

  app.route('GET', '/admin/reconcile', (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    const mismatches = db
      .prepare('SELECT u.id AS user_id FROM users u LEFT JOIN history h ON h.user_id = u.id GROUP BY u.id HAVING u.balance <> COALESCE(SUM(h.amount), 0)')
      .all();
    ctx.send(200, { mismatches });
  });

  app.route('GET', '/api/history', (ctx) => {
    if (!ctx.user) return ctx.send(401, { error: 'sign_in_required' });
    ctx.send(200, { entries: db.prepare('SELECT amount, kind, created_at FROM history WHERE user_id = ? ORDER BY id DESC').all(ctx.user.id) });
  });

  app.route('POST', '/admin/payouts/resolve', async (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    ctx.send(200, await app.resolvePayouts());
  });
}
