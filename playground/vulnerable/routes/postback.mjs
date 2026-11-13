import { createHmac } from 'node:crypto';
import { now } from '../db.mjs';

// Offerly calls this URL when a user completes an offer (status 1) or the advertiser
// takes the conversion back (status 2):
//   /postback/offerly?user_id={user_id}&tx={transaction_id}&reward={reward}&status={status}&hash={hash}
// hash = HMAC-SHA256(postback key, "user_id:tx:reward:status"), hex.
export default function postbackRoutes(app) {
  const { db, config } = app;

  app.route('GET', '/postback/offerly', async (ctx) => {
    const q = ctx.query;
    const userId = Number(q.get('user_id'));
    const tx = q.get('tx') || '';
    const reward = Number(q.get('reward'));
    const status = q.get('status') || '1';
    if (q.get('debug') !== '1') {
      const expected = createHmac('sha256', config.postbackKey)
        .update(`${q.get('user_id')}:${tx}:${q.get('reward')}:${status}`)
        .digest('hex');
      if (q.get('hash') !== expected) return ctx.send(403, 'BAD HASH');
    }
    if (!tx || !Number.isFinite(reward)) return ctx.send(400, 'BAD REQUEST');
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return ctx.send(404, 'UNKNOWN USER');

    if (status === '2') {
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(reward, userId);
      db.prepare('INSERT INTO transactions (user_id, tx_id, reward, status, created_at) VALUES (?, ?, ?, 2, ?)').run(
        userId,
        tx,
        reward,
        now(),
      );
      return ctx.send(200, 'OK');
    }

    const seen = db.prepare('SELECT id FROM transactions WHERE tx_id = ? AND status = 1').get(tx);
    if (seen) return ctx.send(200, 'DUPLICATE');
    await app.notifier.rewardEarned(userId, reward);
    db.prepare('INSERT INTO transactions (user_id, tx_id, reward, status, created_at) VALUES (?, ?, ?, 1, ?)').run(
      userId,
      tx,
      reward,
      now(),
    );
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(reward, userId);
    ctx.send(200, 'OK');
  });
}
