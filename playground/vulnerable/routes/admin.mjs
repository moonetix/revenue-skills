export default function adminRoutes(app) {
  const { db, config } = app;

  app.route('POST', '/admin/grant', (ctx) => {
    if (ctx.req.headers['x-admin-key'] !== config.adminKey) return ctx.send(403, { error: 'forbidden' });
    const userId = Number(ctx.body?.user_id);
    const coins = Number(ctx.body?.amount);
    if (!Number.isFinite(coins)) return ctx.send(400, { error: 'invalid_amount' });
    const changed = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(coins, userId);
    if (!changed.changes) return ctx.send(404, { error: 'user_not_found' });
    ctx.send(200, { granted: coins });
  });
}
