#!/usr/bin/env node
// Checker for the add-offerwall trial: Moonetix wall link, postbacks, reversals and the cash-out hold.
//   node check.mjs <folder>
import { createGiftly } from '../lib/fake-giftly.mjs';
import { client, hmacHex, is4xx, notStarted, ok, race, refusesToStart, report, sleep, startTrialApp, statuses, stripeEvent, targetFolder, trialSecret, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = trialSecret('whsec_');
const ADMIN = trialSecret('admin_');
const KEY = trialSecret('postback_');
const SALT = trialSecret('salt_');
const APP_ID = '7731';
const HOLD = 2;
const giftly = createGiftly();
const giftlyPort = await giftly.listen();
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  ADMIN_KEY: ADMIN,
  GIFTLY_API_URL: `http://127.0.0.1:${giftlyPort}`,
  GIFTLY_API_KEY: trialSecret('giftly_'),
  MOONETIX_APP_ID: APP_ID,
  MOONETIX_POSTBACK_KEY: KEY,
  MOONETIX_LINK_SALT: SALT,
  OFFER_HOLD_SECONDS: String(HOLD),
};
const r = report('add-offerwall');

await r.check('O01', 'the app refuses to start without MOONETIX_POSTBACK_KEY', async () => {
  const { MOONETIX_POSTBACK_KEY, ...rest } = ENV;
  return (await refusesToStart(folder, rest)) || 'the app started without the postback key';
});

const app = await startTrialApp(folder, ENV);
if (!app.started) {
  r.skipAll([['O02', 'all other checks']], notStarted(app));
  await r.finish(app.stop, () => giftly.close());
} else {
  const t = client(app.base);
  // Moonetix postback: hash = hex HMAC-SHA256 of "transaction_id:user_id:reward:status" with the postback key.
  const mx = ({ user, userId, tx, reward, status = 1, payout = '0.85', event = 'e1', key = KEY, sign = true, extra = '', hashFor }) => {
    const id = String(userId ?? user.id);
    const h = hmacHex(key, hashFor ?? `${tx}:${id}:${reward}:${status}`);
    const q = new URLSearchParams({ user: id, tx, event, status: String(status), reward: String(reward), payout: String(payout) });
    return `/postback/moonetix?${q}${sign ? `&hash=${h}` : ''}${extra}`;
  };
  const earn = async (user, reward, tx = uid('mx')) => {
    const res = await t.api(mx({ user, tx, reward }));
    if (!ok(res.status)) throw new Error(`postback answered ${res.status}: ${res.text.slice(0, 80)}`);
    return tx;
  };
  const expectBalance = async (user, want, what) => {
    const got = await t.balance(user);
    return got === want || `${what}: balance ${got}, expected ${want}`;
  };
  const payout = (user, amount) => t.api('/api/payouts', { token: user.token, body: { amount } });
  const withdrawable = async (user) => (await t.api('/api/payouts', { token: user.token })).json?.withdrawable;

  // Earnings that mature during the wait. A failure here is reported by the checks that need them.
  const matured = await t.signup();
  const reduced = await t.signup();
  let reducedTx = 'none';
  try {
    await earn(matured, 600);
    reducedTx = await earn(reduced, 600);
    await earn(reduced, 700);
  } catch (err) {
    console.log(`# setup: ${err.message}`);
  }
  const order = (await t.api('/api/checkout', { token: reduced.token, body: { pack: 'large' } })).json;
  await t.send(
    stripeEvent(app.base, SECRET, 'checkout.session.completed', {
      id: `cs_${order.order_id}`,
      object: 'checkout.session',
      client_reference_id: order.order_id,
      payment_intent: `pi_${order.order_id}`,
      payment_status: 'paid',
      amount_total: order.price_cents,
      currency: 'usd',
    }),
  );
  await sleep((HOLD + 1.2) * 1000);

  await r.check('O02', 'the wall link is built on the server for the session user, signed with the salt, and leaks no secret', async () => {
    const user = await t.signup();
    const res = await t.api(`/api/offerwall?user_id=1&user=1`, { token: user.token });
    const guest = await t.api('/api/offerwall');
    if (res.status !== 200) return `answered ${res.status}`;
    if (!is4xx(guest.status)) return `a guest got ${guest.status}`;
    if (res.text.includes(KEY) || res.text.includes(SALT)) return 'the response contains a secret';
    let url;
    try {
      url = new URL(res.json?.url);
    } catch {
      return `url is ${JSON.stringify(res.json?.url)}`;
    }
    if (url.hostname !== 'wall.moonetix.com' || url.pathname !== `/${APP_ID}`) return `link ${url.origin}${url.pathname}`;
    if (url.searchParams.get('user_id') !== String(user.id)) return `user_id ${url.searchParams.get('user_id')}, expected ${user.id}`;
    return url.searchParams.get('hash') === hmacHex(SALT, String(user.id)) || 'the hash is not HMAC-SHA256 of the user id with the link salt';
  });

  await r.check('O03', 'a genuine postback credits the reward and answers 2xx', async () => {
    const user = await t.signup();
    const res = await t.api(mx({ user, tx: uid('mx'), reward: 150 }));
    if (!ok(res.status)) return `answered ${res.status}: ${res.text.slice(0, 80)}`;
    return expectBalance(user, 150, 'after one credit');
  });

  await r.check('O04', 'the same postback three times and ten times at once credits once, every answer 2xx', async () => {
    const user = await t.signup();
    const one = mx({ user, tx: uid('mx'), reward: 200 });
    const seq = [];
    for (let i = 0; i < 3; i += 1) seq.push((await t.api(one)).status);
    const two = mx({ user, tx: uid('mx'), reward: 200 });
    const results = await race(10, () => t.api(two));
    if (!seq.every(ok) || !results.every((x) => ok(x.status))) return `answers ${seq.join(',')} / ${statuses(results)}`;
    return expectBalance(user, 400, 'after the repeats');
  });

  await r.check('O05', 'forged postbacks are refused: no hash, wrong key, changed reward, user or status, repeated parameter, debug switch', async () => {
    const user = await t.signup();
    const victim = await t.signup();
    const tx = uid('mx');
    const good = mx({ user, tx, reward: 100 });
    const hash = new URL(good, app.base).searchParams.get('hash');
    const attempts = {
      'no hash': mx({ user, tx, reward: 100, sign: false }),
      'wrong key': mx({ user, tx, reward: 100, key: 'wrong_key_wrong_key_000000' }),
      'changed reward': mx({ user, tx, reward: 99999, sign: false, extra: `&hash=${hash}` }),
      'changed user': mx({ userId: victim.id, tx, reward: 100, sign: false, extra: `&hash=${hash}` }),
      'changed status': mx({ user, tx, reward: 100, status: 2, sign: false, extra: `&hash=${hash}` }),
      'repeated reward': `${good}&reward=99999`,
      'debug switch': mx({ user, tx, reward: 100, sign: false, extra: '&debug=1&test=1' }),
    };
    for (const [name, url] of Object.entries(attempts)) {
      const res = await t.api(url);
      if (!is4xx(res.status)) return `${name}: answered ${res.status}`;
    }
    const mine = await t.balance(user);
    const theirs = await t.balance(victim);
    return (mine === 0 && theirs === 0) || `balances ${mine} and ${theirs} after forged postbacks`;
  });

  await r.check('O06', 'the credited amount comes from the signed reward, not the unsigned payout or event', async () => {
    const user = await t.signup();
    await t.api(mx({ user, tx: uid('mx'), reward: 80, payout: '999.00', event: 'bonus-999' }));
    return expectBalance(user, 80, 'after a postback with an unsigned payout of 999');
  });

  await r.check('O07', 'a reversal takes the stored credit back once, whatever reward it names', async () => {
    const user = await t.signup();
    const tx = await earn(user, 300);
    const a = await t.api(mx({ user, tx, reward: 300, status: 2 }));
    const b = await t.api(mx({ user, tx, reward: 300, status: 2 }));
    if (!ok(a.status) || !ok(b.status)) return `answers ${a.status},${b.status}`;
    if ((await t.balance(user)) !== 0) return `balance ${await t.balance(user)} after two reversals`;
    const tx2 = await earn(user, 250);
    await t.api(mx({ user, tx: tx2, reward: 10, status: 2 }));
    return expectBalance(user, 0, 'a signed reversal naming 10 for a credit of 250');
  });

  await r.check('O08', 'a reversal for an unknown transaction changes nothing, and the later credit pays nothing', async () => {
    const user = await t.signup();
    const tx = uid('late');
    const early = await t.api(mx({ user, tx, reward: 500, status: 2 }));
    if (!ok(early.status)) return `the early reversal answered ${early.status}`;
    if ((await t.balance(user)) !== 0) return 'the early reversal changed the balance';
    await t.api(mx({ user, tx, reward: 500 }));
    return expectBalance(user, 0, 'after the late credit');
  });

  await r.check('O09', 'a reversal after the coins were spent leaves a debt and blocks spending', async () => {
    const user = await t.signup();
    const tx = await earn(user, 300);
    const spent = await t.api('/api/spend', { token: user.token, body: { item: 'theme' } });
    if (!ok(spent.status)) return `setup spend answered ${spent.status}`;
    await t.api(mx({ user, tx, reward: 300, status: 2 }));
    const balance = await t.balance(user);
    if (balance !== -300) return `balance ${balance}, expected -300`;
    const again = await t.api('/api/spend', { token: user.token, body: { item: 'avatar' } });
    return !ok(again.status) || `a spend at -300 answered ${again.status}`;
  });

  await r.check('O10', 'fresh offer coins cannot be cashed out; matured ones can', async () => {
    const user = await t.signup();
    await earn(user, 600);
    const before = giftly.issued.length;
    const fresh = await payout(user, 500);
    const freshView = await withdrawable(user);
    if (ok(fresh.status) || giftly.issued.length !== before) return `a fresh payout answered ${fresh.status}`;
    if (freshView !== 0) return `withdrawable ${freshView} right after earning`;
    const old = await payout(matured, 500);
    return (ok(old.status) && giftly.issued.length === before + 1) || `a matured payout answered ${old.status}`;
  });

  await r.check('O11', 'a reversal lowers what can be cashed out at once; bought coins never count', async () => {
    await t.api(mx({ user: reduced, tx: reducedTx, reward: 600, status: 2 }));
    const view = await withdrawable(reduced);
    const res = await payout(reduced, 800);
    if (ok(res.status)) return `a payout of 800 with 700 cashable answered ${res.status}`;
    return view === 700 || `withdrawable ${view}, expected 700 (600 reversed, 700 left, 3000 bought)`;
  });

  await r.check('O12', 'a postback for an unknown user is answered 2xx and credits no one', async () => {
    const res = await t.api(mx({ userId: 987654, tx: uid('mx'), reward: 100 }));
    return ok(res.status) || `answered ${res.status}`;
  });

  await r.check('O13', 'a decimal reward is credited rounded down, once', async () => {
    const user = await t.signup();
    const res = await t.api(mx({ user, tx: uid('mx'), reward: '120.75' }));
    if (!ok(res.status)) return `answered ${res.status}`;
    return expectBalance(user, 120, 'after a reward of 120.75');
  });

  await r.check('O14', 'reconciliation reports no mismatch after all of the above', async () => {
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop, () => giftly.close());
}
