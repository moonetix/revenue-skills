import { safeEqual } from '../lib/signatures.mjs';

// Registered only when ADMIN_KEY is set.
export default function adminRoutes(app) {
  const { db, config } = app;
  if (!config.adminKey) return;

  const allowed = (ctx) => safeEqual(ctx.req.headers['x-admin-key'] ?? '', config.adminKey);

  app.route('POST', '/admin/grant', (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    const { user_id: userId, amount } = ctx.body ?? {};
    if (!Number.isSafeInteger(amount) || amount === 0) return ctx.send(400, { error: 'invalid_input' });
    const changed = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
    if (!changed.changes) return ctx.send(404, { error: 'user_not_found' });
    ctx.send(200, { granted: amount });
  });

  app.route('POST', '/admin/payouts/resolve', async (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    ctx.send(200, await app.resolvePayouts());
  });
}
