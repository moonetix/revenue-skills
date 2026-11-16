import { safeEqual } from '../lib/signatures.mjs';

// Registered only when ADMIN_KEY is set. The key lives in the server environment and in the
// operator's password manager, never in a file the browser can load.
export default function adminRoutes(app) {
  const { db, ledger, config } = app;
  if (!config.adminKey) return;

  const allowed = (ctx) => safeEqual(ctx.req.headers['x-admin-key'] ?? '', config.adminKey);

  app.route('POST', '/admin/grant', (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    const { user_id: userId, amount, reason, request_id: requestId } = ctx.body ?? {};
    const inRange = Number.isSafeInteger(amount) && amount !== 0 && Math.abs(amount) <= config.adminGrantMaxCoins;
    if (!inRange || typeof reason !== 'string' || reason.length < 3 || !/^[\w-]{8,64}$/.test(requestId || '')) {
      return ctx.send(400, { error: 'invalid_input' });
    }
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return ctx.send(404, { error: 'user_not_found' });
    const posted = ledger.atomic(() =>
      ledger.entry({
        userId,
        amount,
        kind: 'admin_grant',
        ref: requestId,
        actor: `admin: ${reason.slice(0, 200)}`,
        allowDebt: true,
      }),
    );
    ctx.send(200, { granted: posted ? amount : 0, repeated: !posted });
  });

  app.route('POST', '/admin/payouts/resolve', async (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    ctx.send(200, await app.resolvePayouts());
  });

  app.route('GET', '/admin/reconcile', (ctx) => {
    if (!allowed(ctx)) return ctx.send(403, { error: 'forbidden' });
    ctx.send(200, { mismatches: ledger.mismatches() });
  });
}
