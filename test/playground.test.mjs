// Every planted bug in playground/ANSWER-KEY.md has one exploit here. Each exploit must work
// against playground/vulnerable and must fail against playground/fixed.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { runProbe } from '../skills/money-audit/scripts/probe.mjs';

const SECRETS = { webhookSecret: 'whsec_test_not_secret', postbackKey: 'test_postback_key_not_secret' };
const FIXED = { ...SECRETS, adminKey: 'test_admin_key_not_secret_0123456789', payoutHoldSeconds: 0 };

async function start(variant, config = {}) {
  const { createApp } = await import(`../playground/${variant}/app.mjs`);
  const app = createApp(variant === 'fixed' ? { ...FIXED, ...config } : {});
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  let users = 0;

  const t = {
    app,
    base,
    async api(path, { token, body, headers = {}, method } = {}) {
      const res = await fetch(base + path, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, text, json };
    },
    async signup(ref) {
      users += 1;
      const email = `user${users}@example.com`;
      const res = await t.api('/api/signup', { body: { email, password: 'correct horse battery', ref } });
      assert.equal(res.status, 201);
      return { id: res.json.user_id, token: res.json.token, email };
    },
    async balance(user) {
      return (await t.api('/api/me', { token: user.token })).json.balance;
    },
    me: (user) => ({ url: `${base}/api/me`, headers: { authorization: `Bearer ${user.token}` }, path: 'balance' }),
    postbackUrl({ user, tx, reward, status = 1, sign = true, extra = '' }) {
      const hash = createHmac('sha256', SECRETS.postbackKey).update(`${user.id}:${tx}:${reward}:${status}`).digest('hex');
      return `/postback/offerly?user_id=${user.id}&tx=${tx}&reward=${reward}&status=${status}${sign ? `&hash=${hash}` : ''}${extra}`;
    },
    async earn(user, reward, tx = `tx-${user.id}-${reward}-${Math.random().toString(36).slice(2)}`) {
      const res = await t.api(t.postbackUrl({ user, tx, reward }));
      assert.equal(res.status, 200);
      return tx;
    },
    webhook(type, data, { id = `evt_${Math.random().toString(36).slice(2)}`, sign = true } = {}) {
      const rawBody = JSON.stringify({ id, type, data });
      const time = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', SECRETS.webhookSecret).update(`${time}.${rawBody}`).digest('hex');
      return {
        method: 'POST',
        url: `${base}/webhooks/paylane`,
        headers: { 'content-type': 'application/json', ...(sign ? { 'paylane-signature': `t=${time},v1=${v1}` } : {}) },
        rawBody,
      };
    },
    async order(user, body = { pack: 'small' }) {
      const res = await t.api('/api/checkout', { token: user.token, body });
      assert.equal(res.status, 201);
      return res.json;
    },
    paid: (order, options) =>
      t.webhook('payment.succeeded', { order_id: order.order_id, amount_cents: order.price_cents, currency: 'usd' }, options),
    probe: (mode, request, extra = {}) =>
      runProbe({ mode, requestArg: JSON.stringify(request), edits: [], times: 2, parallel: 10, ...extra }),
    cardsSent: () => app.giftcards.sent.length,
  };
  return t;
}

const EXPLOITS = [
  {
    id: 'V01',
    title: 'a payment webhook without a signature is accepted',
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user);
      await t.probe('send', t.paid(order, { sign: false }));
      return (await t.balance(user)) > 0;
    },
  },
  {
    id: 'V02',
    title: 'debug=1 switches the postback hash check off',
    async run(t) {
      const user = await t.signup();
      await t.api(t.postbackUrl({ user, tx: 'forged-1', reward: 100000, sign: false, extra: '&debug=1' }));
      return (await t.balance(user)) > 0;
    },
  },
  {
    id: 'V03',
    title: 'a signed payment webhook credits again when it is delivered again',
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user);
      const result = await t.probe('replay', t.paid(order), { observe: JSON.stringify(t.me(user)) });
      return result.observed.delta > order.coins;
    },
  },
  {
    id: 'V04',
    title: 'the same postback sent in parallel credits more than once',
    async run(t) {
      const user = await t.signup();
      const request = { url: t.base + t.postbackUrl({ user, tx: 'offer-77', reward: 200 }) };
      const result = await t.probe('race', request, { observe: JSON.stringify(t.me(user)) });
      return result.observed.delta > 200;
    },
  },
  {
    id: 'V05',
    title: 'parallel purchases are all delivered for the price of one',
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 300);
      const request = {
        method: 'POST',
        url: `${t.base}/api/spend`,
        headers: { authorization: `Bearer ${user.token}` },
        body: { item: 'theme' },
      };
      await t.probe('race', request);
      return t.app.entitlements.delivered.length > 1;
    },
  },
  {
    id: 'V06',
    title: 'parallel payout requests pay out the same balance several times',
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 1000);
      const request = {
        method: 'POST',
        url: `${t.base}/api/payouts`,
        headers: { authorization: `Bearer ${user.token}` },
        body: { amount: 1000 },
      };
      await t.probe('race', request, { parallel: 5 });
      return t.cardsSent() > 1;
    },
  },
  {
    id: 'V07',
    title: 'the number of coins in an order comes from the request body',
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user, { pack: 'small', coins: 1_000_000 });
      await t.probe('send', t.paid(order));
      return (await t.balance(user)) > 500;
    },
  },
  {
    id: 'V08',
    title: 'a negative transfer pulls coins out of the other account',
    async run(t) {
      const thief = await t.signup();
      const victim = await t.signup();
      await t.earn(victim, 500);
      await t.api('/api/transfer', { token: thief.token, body: { to: victim.email, amount: -400 } });
      return (await t.balance(thief)) > 0;
    },
  },
  {
    id: 'V09',
    title: 'half a coin is paid out as a whole cent',
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 1000);
      const res = await t.api('/api/payouts', { token: user.token, body: { amount: 0.5 } });
      return res.status === 200;
    },
  },
  {
    id: 'V10',
    title: 'a refunded payment leaves the coins in the account',
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user);
      await t.probe('send', t.paid(order));
      await t.probe('send', t.webhook('payment.refunded', { order_id: order.order_id }));
      return (await t.balance(user)) > 0;
    },
  },
  {
    id: 'V11',
    title: 'a reversal that is delivered twice is charged twice',
    async run(t) {
      const user = await t.signup();
      const tx = await t.earn(user, 200);
      const request = { url: t.base + t.postbackUrl({ user, tx, reward: 200, status: 2 }) };
      await t.probe('replay', request);
      return (await t.balance(user)) < 0;
    },
  },
  {
    id: 'V12',
    title: 'one account redeems the same promo code again and again',
    async run(t) {
      const user = await t.signup();
      for (let i = 0; i < 3; i += 1) await t.api('/api/promo', { token: user.token, body: { code: 'WELCOME100' } });
      return (await t.balance(user)) > 100;
    },
  },
  {
    id: 'V13',
    title: 'empty sign-ups earn the referral bonus',
    async run(t) {
      const farmer = await t.signup();
      const code = (await t.api('/api/me', { token: farmer.token })).json.ref_code;
      for (let i = 0; i < 3; i += 1) await t.signup(code);
      return (await t.balance(farmer)) > 0;
    },
  },
  {
    id: 'V14',
    title: 'coins credited a second ago can be cashed out at once',
    fixedConfig: { payoutHoldSeconds: 7 * 24 * 3600 },
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 600);
      const res = await t.api('/api/payouts', { token: user.token, body: { amount: 600 } });
      return res.status === 200;
    },
  },
  {
    id: 'V15',
    title: 'the admin key can be read from a public script',
    async run(t) {
      const user = await t.signup();
      const script = await t.api('/public/admin.js');
      const key = /ADMIN_KEY = '([^']+)'/.exec(script.text)?.[1];
      if (!key) return false;
      await t.api('/admin/grant', { headers: { 'x-admin-key': key }, body: { user_id: user.id, amount: 5000 } });
      return (await t.balance(user)) > 0;
    },
  },
  {
    id: 'V16',
    title: 'a transfer can name another account as the sender',
    async run(t) {
      const thief = await t.signup();
      const victim = await t.signup();
      await t.earn(victim, 500);
      await t.api('/api/transfer', { token: thief.token, body: { from: victim.id, to: thief.email, amount: 500 } });
      return (await t.balance(thief)) > 0;
    },
  },
  {
    id: 'V17',
    title: 'the stored records do not add up to the balance',
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 300);
      await t.api('/api/promo', { token: user.token, body: { code: 'WELCOME100' } });
      await t.api('/api/spend', { token: user.token, body: { item: 'avatar' } });
      const balance = await t.balance(user);
      if (t.app.ledger) return t.app.ledger.mismatches().length > 0 || t.app.ledger.sum(user.id, ALL_KINDS) !== balance;
      const one = (sql) => t.app.db.prepare(sql).get(user.id).total;
      const recorded =
        one('SELECT COALESCE(SUM(CASE status WHEN 1 THEN reward ELSE -reward END), 0) AS total FROM transactions WHERE user_id = ?') -
        one('SELECT COALESCE(SUM(price), 0) AS total FROM purchases WHERE user_id = ?');
      return recorded !== balance;
    },
  },
];

const ALL_KINDS = [
  'purchase', 'purchase_refund', 'offer', 'offer_reversal', 'spend', 'spend_refund', 'transfer_in',
  'transfer_out', 'promo', 'referral', 'payout', 'payout_refund', 'admin_grant',
];

for (const exploit of EXPLOITS) {
  test(`${exploit.id} vulnerable: ${exploit.title}`, async () => {
    const t = await start('vulnerable');
    try {
      assert.equal(await exploit.run(t), true);
    } finally {
      await t.app.close();
    }
  });
  test(`${exploit.id} fixed: blocked`, async () => {
    const t = await start('fixed', exploit.fixedConfig);
    try {
      assert.equal(await exploit.run(t), false);
    } finally {
      await t.app.close();
    }
  });
}

test('fixed: the normal paths still work', async () => {
  const t = await start('fixed');
  try {
    const buyer = await t.signup();
    const order = await t.order(buyer);
    await t.probe('send', t.paid(order));
    assert.equal(await t.balance(buyer), 500);
    assert.equal((await t.api('/api/spend', { token: buyer.token, body: { item: 'theme' } })).status, 200);
    assert.equal(await t.balance(buyer), 200);

    const earner = await t.signup((await t.api('/api/me', { token: buyer.token })).json.ref_code);
    const tx = await t.earn(earner, 800);
    assert.equal(await t.balance(earner), 800);
    assert.equal(await t.balance(buyer), 700, 'the referrer is paid once the invited user has earned enough');
    assert.equal((await t.api('/api/payouts', { token: earner.token, body: { amount: 600 } })).status, 200);
    assert.equal(await t.balance(earner), 200);
    assert.equal(t.app.giftcards.sent[0].cents, 600);

    await t.api(t.postbackUrl({ user: earner, tx, reward: 800, status: 2 }));
    assert.equal(await t.balance(earner), -600, 'a reversal after a payout leaves a debt');
    assert.equal(await t.balance(buyer), 200, 'the referral bonus goes back with the earnings that qualified it');
    assert.equal((await t.api('/api/spend', { token: earner.token, body: { item: 'avatar' } })).status, 402);

    assert.equal((await t.api('/api/transfer', { token: buyer.token, body: { to: earner.email, amount: 100 } })).status, 200);
    const reconcile = await t.api('/admin/reconcile', { headers: { 'x-admin-key': FIXED.adminKey } });
    assert.deepEqual(reconcile.json, { mismatches: [] });
  } finally {
    await t.app.close();
  }
});

test('fixed: a reversal that arrives before its credit still holds', async () => {
  const t = await start('fixed');
  try {
    const referrer = await t.signup();
    const user = await t.signup((await t.api('/api/me', { token: referrer.token })).json.ref_code);
    const early = await t.api(t.postbackUrl({ user, tx: 'late-credit', reward: 900, status: 2 }));
    assert.equal(early.text, 'RECORDED');
    const credit = await t.api(t.postbackUrl({ user, tx: 'late-credit', reward: 900 }));
    assert.equal(credit.text, 'REVERSED');
    assert.equal(await t.balance(user), 0);
    assert.equal(await t.balance(referrer), 0, 'a reversed conversion qualifies nobody');
    await t.api(t.postbackUrl({ user, tx: 'late-credit', reward: 900 }));
    await t.api(t.postbackUrl({ user, tx: 'late-credit', reward: 900, status: 2 }));
    assert.equal(await t.balance(user), 0);
    const reconcile = await t.api('/admin/reconcile', { headers: { 'x-admin-key': FIXED.adminKey } });
    assert.deepEqual(reconcile.json, { mismatches: [] });
  } finally {
    await t.app.close();
  }
});

test('fixed: a refund that arrives before its payment leaves no coins', async () => {
  const t = await start('fixed');
  try {
    const buyer = await t.signup();
    const order = await t.order(buyer);
    const refund = await t.probe('send', t.webhook('payment.refunded', { order_id: order.order_id }));
    assert.deepEqual(refund.statuses, { 200: 1 });
    await t.probe('send', t.paid(order));
    assert.equal(await t.balance(buyer), 0);
    await t.probe('send', t.webhook('payment.refunded', { order_id: order.order_id }));
    assert.equal(await t.balance(buyer), 0);
  } finally {
    await t.app.close();
  }
});

test('fixed: a payout with an unknown outcome is resolved, never refunded blindly', async () => {
  const t = await start('fixed');
  try {
    const admin = { headers: { 'x-admin-key': FIXED.adminKey }, method: 'POST' };
    const user = await t.signup();
    await t.earn(user, 2000);
    const realSend = t.app.giftcards.send;

    // The provider issues the card but the answer is lost on the way back.
    t.app.giftcards.send = async (request) => {
      await realSend(request);
      throw new Error('socket hang up');
    };
    const lost = await t.api('/api/payouts', { token: user.token, body: { amount: 600 } });
    assert.equal(lost.status, 202);
    assert.equal(await t.balance(user), 1400, 'the coins stay taken while the outcome is unknown');
    assert.deepEqual((await t.api('/admin/payouts/resolve', admin)).json, { paid: 0, failed: 0, unknown: 1 });

    t.app.giftcards.send = realSend;
    assert.deepEqual((await t.api('/admin/payouts/resolve', admin)).json, { paid: 1, failed: 0, unknown: 0 });
    assert.equal(await t.balance(user), 1400);
    assert.equal(t.cardsSent(), 1, 'asking again with the same key issues no second card');

    // A definite refusal gives the coins back, once.
    t.app.giftcards.send = async () => {
      throw Object.assign(new Error('declined'), { code: 'refused' });
    };
    const refused = await t.api('/api/payouts', { token: user.token, body: { amount: 500 } });
    assert.equal(refused.status, 502);
    assert.equal(await t.balance(user), 1400);
    assert.deepEqual((await t.api('/admin/payouts/resolve', admin)).json, { paid: 0, failed: 0, unknown: 0 });
    const reconcile = await t.api('/admin/reconcile', { headers: { 'x-admin-key': FIXED.adminKey } });
    assert.deepEqual(reconcile.json, { mismatches: [] });
  } finally {
    await t.app.close();
  }
});

test('fixed: refuses to start without secrets', async () => {
  const { createApp } = await import('../playground/fixed/app.mjs');
  assert.throws(() => createApp({ webhookSecret: undefined, postbackKey: SECRETS.postbackKey }), /webhookSecret is not set/);
  assert.throws(() => createApp({ ...SECRETS, adminKey: 'short' }), /adminKey must be at least 32/);
});
