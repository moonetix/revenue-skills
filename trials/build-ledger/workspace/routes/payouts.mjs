import { randomUUID } from 'node:crypto';
import { now } from '../db.mjs';
import { requireUser, wholeCoins } from '../lib/http.mjs';

export default function payoutRoutes(app) {
  const { db, tx, config } = app;

  // Only coins earned from offers can be cashed out, and only after the hold period.
  // Bought, promo and referral coins are for spending.
  function withdrawable(userId, balance) {
    const matured = db
      .prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM offer_conversions WHERE user_id = ? AND status = 'credited' AND created_at <= ?")
      .get(userId, now() - config.payoutHoldSeconds).n;
    const paidOut = db.prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM payouts WHERE user_id = ? AND status <> 'failed'").get(userId).n;
    return Math.max(0, Math.min(balance, matured - paidOut));
  }

  // Calls the provider for a payout whose coins are already taken. The payout id is the
  // idempotency key, so sending again can never issue a second card. Only a definite
  // refusal gives the coins back. A timeout or a dropped connection says nothing about
  // whether the card was issued: the payout stays 'unknown' until resolvePayouts() asks again.
  async function send(payout) {
    try {
      const card = await app.giftcards.send({ userId: payout.user_id, cents: payout.cents, idempotencyKey: payout.id });
      db.prepare("UPDATE payouts SET status = 'paid' WHERE id = ? AND status IN ('pending', 'unknown')").run(payout.id);
      return { status: 'paid', code: card.code };
    } catch (err) {
      if (err?.code !== 'refused') {
        db.prepare("UPDATE payouts SET status = 'unknown' WHERE id = ? AND status = 'pending'").run(payout.id);
        return { status: 'unknown' };
      }
      tx(() => {
        const failed = db
          .prepare("UPDATE payouts SET status = 'failed' WHERE id = ? AND status IN ('pending', 'unknown')")
          .run(payout.id);
        if (failed.changes) db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout.coins, payout.user_id);
      });
      return { status: 'failed' };
    }
  }

  // Run on a schedule, and by staff through POST /admin/payouts/resolve.
  app.resolvePayouts = async () => {
    const counts = { paid: 0, failed: 0, unknown: 0 };
    const open = db.prepare("SELECT id, user_id, coins, cents FROM payouts WHERE status = 'unknown' ORDER BY created_at").all();
    for (const payout of open) counts[(await send(payout)).status] += 1;
    return counts;
  };

  app.route(
    'POST',
    '/api/payouts',
    requireUser(async (ctx) => {
      const coins = wholeCoins(ctx.body?.amount, config.payoutDailyMaxCoins);
      if (!coins || coins < config.payoutMinCoins) return ctx.send(400, { error: 'invalid_amount' });
      const cents = (coins * 100) / config.coinsPerDollar;
      if (!Number.isSafeInteger(cents)) return ctx.send(400, { error: 'invalid_amount' });
      const payoutId = randomUUID();

      const refusal = tx(() => {
        const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
        if (coins > withdrawable(ctx.user.id, user.balance)) return 'not_withdrawable_yet';
        const lastDay = db
          .prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM payouts WHERE user_id = ? AND status <> 'failed' AND created_at > ?")
          .get(ctx.user.id, now() - 24 * 3600).n;
        if (lastDay + coins > config.payoutDailyMaxCoins) return 'daily_limit_reached';
        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(coins, ctx.user.id);
        db.prepare(
          "INSERT INTO payouts (id, user_id, coins, cents, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        ).run(payoutId, ctx.user.id, coins, cents, now());
        return null;
      });
      if (refusal) return ctx.send(409, { error: refusal });

      const outcome = await send({ id: payoutId, user_id: ctx.user.id, coins, cents });
      if (outcome.status === 'paid') return ctx.send(200, { payout_id: payoutId, cents, code: outcome.code });
      if (outcome.status === 'failed') return ctx.send(502, { error: 'payout_failed_coins_returned' });
      ctx.send(202, { payout_id: payoutId, status: 'processing' });
    }),
  );

  app.route(
    'GET',
    '/api/payouts',
    requireUser((ctx) => {
      const rows = db
        .prepare('SELECT id, coins, cents, status, created_at FROM payouts WHERE user_id = ? ORDER BY created_at DESC')
        .all(ctx.user.id);
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      ctx.send(200, { withdrawable: withdrawable(ctx.user.id, user.balance), payouts: rows });
    }),
  );
}
