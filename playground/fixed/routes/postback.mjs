import { now } from '../db.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { offerlyHash, safeEqual } from '../lib/signatures.mjs';

// Offerly calls this URL when a user completes an offer (status 1) or the advertiser
// takes the conversion back (status 2):
//   /postback/offerly?user_id={user_id}&tx={transaction_id}&reward={reward}&status={status}&hash={hash}
// hash = HMAC-SHA256(postback key, "user_id:tx:reward:status"), hex.
export default function postbackRoutes(app) {
  const { db, ledger, config } = app;

  app.route('GET', '/postback/offerly', async (ctx) => {
    const q = ctx.query;
    const [userId, tx, reward, status] = ['user_id', 'tx', 'reward', 'status'].map((name) => q.get(name) ?? '');
    const expected = offerlyHash(config.postbackKey, userId, tx, reward, status);
    if (!safeEqual(q.get('hash') ?? '', expected)) return ctx.send(403, 'BAD HASH');
    if (!/^\d{1,12}$/.test(userId) || !/^[\w.:-]{1,128}$/.test(tx) || !/^[1-9]\d{0,8}$/.test(reward)) {
      return ctx.send(400, 'BAD REQUEST');
    }
    if (status !== '1' && status !== '2') return ctx.send(400, 'BAD STATUS');
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
    if (!user) return ctx.send(404, 'UNKNOWN USER');

    // Takes back what this transaction credited, from the account it credited, once.
    // The amount in the reversal request is not used.
    const takeBack = () => {
      const original = db.prepare("SELECT user_id, amount FROM ledger WHERE kind = 'offer' AND ref = ?").get(tx);
      if (!original) return false;
      const posted = ledger.entry({
        userId: original.user_id,
        amount: -original.amount,
        kind: 'offer_reversal',
        ref: tx,
        allowDebt: true,
      });
      if (posted) settleReferral(app, original.user_id);
      return posted;
    };
    const reversalKnown = () => Boolean(db.prepare('SELECT 1 FROM offer_reversals WHERE tx = ?').get(tx));

    if (status === '1') {
      const coins = Number(reward);
      const result = ledger.atomic(() => {
        if (!ledger.entry({ userId: user.id, amount: coins, kind: 'offer', ref: tx })) return 'DUPLICATE';
        // Networks do not promise an order. A reversal that came first is applied now,
        // so both entries are on record and the balance does not move.
        if (reversalKnown()) {
          takeBack();
          return 'REVERSED';
        }
        settleReferral(app, user.id);
        return 'OK';
      });
      if (result === 'OK') await app.notifier.rewardEarned(user.id, coins);
      return ctx.send(200, result);
    }

    // The reversal is stored as a fact before anything else, so it also holds when the
    // credit it belongs to has not arrived yet.
    const result = ledger.atomic(() => {
      db.prepare('INSERT INTO offer_reversals (tx, received_at) VALUES (?, ?) ON CONFLICT (tx) DO NOTHING').run(tx, now());
      const known = Boolean(db.prepare("SELECT 1 FROM ledger WHERE kind = 'offer' AND ref = ?").get(tx));
      if (!known) return 'RECORDED';
      return takeBack() ? 'OK' : 'DUPLICATE';
    });
    ctx.send(200, result);
  });
}
