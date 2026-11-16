import { settleReferral } from '../lib/referrals.mjs';
import { rewardlyHash, safeEqual } from '../lib/signatures.mjs';

// Rewardly calls this URL when a user completes an offer:
//   /postback/rewardly?user_id={user_id}&tx={transaction_id}&reward={reward}&status={status}&hash={hash}
// hash = HMAC-SHA256(postback key, "user_id:tx:reward:status"), hex.
export default function postbackRoutes(app) {
  const { db, ledger, config } = app;

  app.route('GET', '/postback/rewardly', async (ctx) => {
    const q = ctx.query;
    const [userId, tx, reward, status] = ['user_id', 'tx', 'reward', 'status'].map((name) => q.get(name) ?? '');
    const expected = rewardlyHash(config.postbackKey, userId, tx, reward, status);
    if (!safeEqual(q.get('hash') ?? '', expected)) return ctx.send(403, 'BAD HASH');
    if (!/^\d{1,12}$/.test(userId) || !/^[\w.:-]{1,128}$/.test(tx) || !/^[1-9]\d{0,8}$/.test(reward)) {
      return ctx.send(400, 'BAD REQUEST');
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
    if (!user) return ctx.send(404, 'UNKNOWN USER');
    if (status === '2') {
      ledger.atomic(() =>
        ledger.entry({ userId: user.id, amount: -Number(reward), kind: 'offer_reversal', ref: `${tx}:${Date.now()}:${Math.random()}`, allowDebt: true }),
      );
      return ctx.send(200, 'OK');
    }
    if (status !== '1') return ctx.send(200, 'IGNORED');

    const coins = Number(reward);
    const result = ledger.atomic(() => {
      if (!ledger.entry({ userId: user.id, amount: coins, kind: 'offer', ref: tx })) return 'DUPLICATE';
      settleReferral(app, user.id);
      return 'OK';
    });
    if (result === 'OK') await app.notifier.rewardEarned(user.id, coins);
    ctx.send(200, result);
  });
}
