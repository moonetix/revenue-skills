import { createHmac } from 'node:crypto';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';
import { settleReferral } from '../lib/referrals.mjs';
import { safeEqual } from '../lib/signatures.mjs';

const hmacHex = (key, text) => createHmac('sha256', key).update(text).digest('hex');

// Moonetix postback: user, tx, event, status (1 credited, 2 reversed), reward (our coins),
// payout (USD, unsigned), hash = hex HMAC-SHA256 of "transaction_id:user_id:reward:status".
export default function offerwallRoutes(app) {
  const { db, ledger, config } = app;

  app.route(
    'GET',
    '/api/offerwall',
    requireUser((ctx) => {
      const userId = String(ctx.user.id);
      const url = new URL(`https://wall.moonetix.com/${encodeURIComponent(config.moonetixAppId)}`);
      url.searchParams.set('user_id', userId);
      url.searchParams.set('hash', hmacHex(config.moonetixLinkSalt, userId));
      ctx.send(200, { url: url.toString() });
    }),
  );

  app.route('GET', '/postback/moonetix', async (ctx) => {
    const q = ctx.query;
    for (const name of ['user', 'tx', 'reward', 'status', 'hash']) {
      if (q.getAll(name).length !== 1) return ctx.send(400, 'BAD REQUEST');
    }
    const [userId, tx, reward, status] = ['user', 'tx', 'reward', 'status'].map((name) => q.get(name));
    const expected = hmacHex(config.moonetixPostbackKey, `${tx}:${userId}:${reward}:${status}`);
    if (!safeEqual(q.get('hash'), expected)) return ctx.send(403, 'BAD HASH');
    if (!/^\d{1,12}$/.test(userId) || !/^[\w.:-]{1,128}$/.test(tx) || !/^\d{1,9}(\.\d{1,6})?$/.test(reward)) {
      return ctx.send(400, 'BAD REQUEST');
    }
    if (status !== '1' && status !== '2') return ctx.send(400, 'BAD STATUS');
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
    if (!user) {
      console.log(`moonetix postback for unknown user ${userId}: ${ctx.req.url}`);
      return ctx.send(200, 'UNKNOWN USER');
    }
    const ref = `moonetix:${tx}`;
    const coins = Number(reward.split('.')[0]); // rounded down, once

    const takeBack = () => {
      const original = db.prepare("SELECT user_id, amount FROM ledger WHERE kind = 'offer' AND ref = ?").get(ref);
      if (!original) return false;
      const posted = ledger.entry({ userId: original.user_id, amount: -original.amount, kind: 'offer_reversal', ref, allowDebt: true });
      if (posted) settleReferral(app, original.user_id);
      return posted;
    };
    const reversalKnown = () => Boolean(db.prepare('SELECT 1 FROM offer_reversals WHERE tx = ?').get(ref));

    if (status === '1') {
      if (coins < 1) return ctx.send(200, 'ZERO');
      const result = ledger.atomic(() => {
        if (!ledger.entry({ userId: user.id, amount: coins, kind: 'offer', ref })) return 'DUPLICATE';
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

    const result = ledger.atomic(() => {
      db.prepare('INSERT INTO offer_reversals (tx, received_at) VALUES (?, ?) ON CONFLICT (tx) DO NOTHING').run(ref, now());
      const known = Boolean(db.prepare("SELECT 1 FROM ledger WHERE kind = 'offer' AND ref = ?").get(ref));
      if (!known) return 'RECORDED';
      return takeBack() ? 'OK' : 'DUPLICATE';
    });
    ctx.send(200, result);
  });
}
