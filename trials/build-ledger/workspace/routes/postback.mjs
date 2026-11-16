import { now } from '../db.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { rewardlyHash, safeEqual } from '../lib/signatures.mjs';

// Rewardly calls this URL when a user completes an offer (status 1) or the advertiser
// takes the conversion back (status 2):
//   /postback/rewardly?user_id={user_id}&tx={transaction_id}&reward={reward}&status={status}&hash={hash}
// hash = HMAC-SHA256(postback key, "user_id:tx:reward:status"), hex.
export default function postbackRoutes(app) {
  const { db, tx: transaction, config } = app;

  app.route('GET', '/postback/rewardly', async (ctx) => {
    const q = ctx.query;
    const [userId, tx, reward, status] = ['user_id', 'tx', 'reward', 'status'].map((name) => q.get(name) ?? '');
    const expected = rewardlyHash(config.postbackKey, userId, tx, reward, status);
    if (!safeEqual(q.get('hash') ?? '', expected)) return ctx.send(403, 'BAD HASH');
    if (!/^\d{1,12}$/.test(userId) || !/^[\w.:-]{1,128}$/.test(tx) || !/^[1-9]\d{0,8}$/.test(reward)) {
      return ctx.send(400, 'BAD REQUEST');
    }
    if (status !== '1' && status !== '2') return ctx.send(400, 'BAD STATUS');
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
    if (!user) return ctx.send(404, 'UNKNOWN USER');

    if (status === '1') {
      const coins = Number(reward);
      const result = transaction(() => {
        const inserted = db
          .prepare("INSERT INTO offer_conversions (tx, user_id, coins, status, created_at) VALUES (?, ?, ?, 'credited', ?) ON CONFLICT (tx) DO NOTHING")
          .run(tx, user.id, coins, now());
        if (!inserted.changes) return 'DUPLICATE';
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(coins, user.id);
        settleReferral(app, user.id);
        return 'OK';
      });
      if (result === 'OK') await app.notifier.rewardEarned(user.id, coins);
      return ctx.send(200, result);
    }

    // The reversal takes back what the conversion credited, from the account it credited, once.
    const result = transaction(() => {
      const conversion = db.prepare('SELECT user_id, coins FROM offer_conversions WHERE tx = ?').get(tx);
      if (!conversion) {
        db.prepare("INSERT INTO offer_conversions (tx, user_id, coins, status, created_at) VALUES (?, NULL, 0, 'reversed_before_credit', ?)").run(tx, now());
        return 'RECORDED';
      }
      const reversed = db.prepare("UPDATE offer_conversions SET status = 'reversed' WHERE tx = ? AND status = 'credited'").run(tx);
      if (!reversed.changes) return 'DUPLICATE';
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(conversion.coins, conversion.user_id);
      settleReferral(app, conversion.user_id);
      return 'OK';
    });
    ctx.send(200, result);
  });
}
