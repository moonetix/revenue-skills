#!/usr/bin/env node
// Checker for the add-referral-program trial.
//   node check.mjs <folder>
import { RUN_ID, client, notStarted, ok, race, report, rewardlyUrl, startTrialApp, stripeEvent, targetFolder, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = 'whsec_trial_secret_0123456789abcdef';
const KEY = 'rewardly_trial_key_0123456789';
const ADMIN = 'trial_admin_key_0123456789abcdef0123456789';
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, REWARDLY_POSTBACK_KEY: KEY, ADMIN_KEY: ADMIN };
const r = report('add-referral-program');
const app = await startTrialApp(folder, ENV);

if (!app.started) {
  r.skipAll([['F00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop);
} else {
  const t = client(app.base);
  const earn = async (user, reward, tx = uid('tx')) => {
    const res = await t.api(rewardlyUrl(KEY, { user, tx, reward }));
    if (!ok(res.status)) throw new Error(`postback answered ${res.status}`);
    return tx;
  };
  const reverse = (user, tx, reward) => t.api(rewardlyUrl(KEY, { user, tx, reward, status: 2 }));
  const buy = async (user, pack = 'small') => {
    const order = (await t.api('/api/checkout', { token: user.token, body: { pack } })).json;
    const object = {
      id: `cs_${order.order_id}`,
      object: 'checkout.session',
      client_reference_id: order.order_id,
      payment_intent: `pi_${order.order_id}`,
      payment_status: 'paid',
      amount_total: order.price_cents,
      currency: 'usd',
      metadata: { order_id: order.order_id },
    };
    await t.send(stripeEvent(app.base, SECRET, 'checkout.session.completed', object));
    return order;
  };
  const refundFull = (order) =>
    t.send(
      stripeEvent(app.base, SECRET, 'charge.refunded', {
        id: `ch_${order.order_id}`,
        object: 'charge',
        amount: order.price_cents,
        amount_refunded: order.price_cents,
        refunded: true,
        currency: 'usd',
        payment_intent: `pi_${order.order_id}`,
        metadata: { order_id: order.order_id },
      }),
    );
  const codeOf = async (user) => (await t.me(user)).ref_code;
  const referrals = async (user) => {
    const res = await t.api('/api/referrals', { token: user.token });
    if (res.status !== 200 || !Array.isArray(res.json?.referrals)) throw new Error(`GET /api/referrals answered ${res.status} ${res.text.slice(0, 80)}`);
    return res;
  };
  const referrerWithFriend = async () => {
    const referrer = await t.signup();
    const friend = await t.signup({ ref: await codeOf(referrer) });
    return { referrer, friend };
  };
  const expectBalance = async (user, want, what) => {
    const got = await t.balance(user);
    return got === want || `${what}: balance ${got}, expected ${want}`;
  };

  await r.check('F01', 'sign-ups with a code and nothing else pay nothing, and the referrer sees each of them', async () => {
    const referrer = await t.signup();
    const code = await codeOf(referrer);
    if (code === undefined || code === null || code === '') return `ref_code is ${JSON.stringify(code)}`;
    for (let i = 0; i < 3; i += 1) await t.signup({ ref: code });
    const list = (await referrals(referrer)).json.referrals;
    if (list.length !== 3) return `${list.length} referrals listed, expected 3`;
    return expectBalance(referrer, 0, 'after three empty sign-ups');
  });

  await r.check('F02', 'the code is not the user id, and the referral list shows no friend email', async () => {
    const referrer = await t.signup();
    const code = String(await codeOf(referrer));
    if (code === String(referrer.id) || /^\d{1,6}$/.test(code)) return `the code ${code} is the id or a counter`;
    const friend = await t.signup({ ref: code });
    const res = await referrals(referrer);
    return !res.text.includes(friend.email.split('@')[0]) || 'the referral list contains the friend email';
  });

  await r.check('F03', 'a sign-up naming the referrer by id instead of a code attributes nothing, and an unknown code still signs up', async () => {
    const referrer = await t.signup();
    const direct = await t.signup({ extra: { referrer_id: referrer.id, referred_by: referrer.id, referrer: referrer.id } });
    const unknown = await t.signup({ ref: 'NOSUCHCODE1' });
    const list = (await referrals(referrer)).json.referrals;
    if (!direct.id || !unknown.id) return 'a sign-up failed';
    if (list.length !== 0) return `${list.length} referrals attributed without a code`;
    await earn(direct, 600);
    return expectBalance(referrer, 0, 'after the directly named friend qualified');
  });

  await r.check('F04', 'the bonus is paid once when verified activity reaches 500, not before, and never twice', async () => {
    const { referrer, friend } = await referrerWithFriend();
    await earn(friend, 300);
    if ((await t.balance(referrer)) !== 0) return 'paid below the threshold';
    const tx = await earn(friend, 200);
    if ((await t.balance(referrer)) !== 500) return `balance ${await t.balance(referrer)} at the threshold, expected 500`;
    await t.api(rewardlyUrl(KEY, { user: friend, tx, reward: 200 }));
    await buy(friend);
    return expectBalance(referrer, 500, 'after a repeated postback and another purchase');
  });

  await r.check('F05', 'promo codes and coins received from others do not qualify', async () => {
    const { referrer, friend } = await referrerWithFriend();
    const sender = await t.signup();
    await earn(sender, 1000);
    const sent = await t.api('/api/transfer', { token: sender.token, body: { to: friend.email, amount: 400 } });
    if (!ok(sent.status)) return `setup transfer answered ${sent.status}`;
    await t.api('/api/promo', { token: friend.token, body: { code: 'WELCOME100' } });
    await earn(friend, 450);
    return expectBalance(referrer, 0, 'friend with 450 earned, 400 received, 100 promo');
  });

  await r.check('F06', 'a reversal below the threshold takes the bonus back, also when spent, and the referral never pays again', async () => {
    const { referrer, friend } = await referrerWithFriend();
    const tx = await earn(friend, 600);
    const spent = await t.api('/api/spend', { token: referrer.token, body: { item: 'theme' } });
    if (!ok(spent.status)) return `setup spend answered ${spent.status}`;
    await reverse(friend, tx, 600);
    await reverse(friend, tx, 600);
    const after = await t.balance(referrer);
    if (after !== -300) return `referrer balance ${after} after the reversal, expected -300`;
    await earn(friend, 700);
    return expectBalance(referrer, -300, 'after the friend earned again');
  });

  await r.check('F07', 'a reversal that leaves the friend above the threshold keeps the bonus', async () => {
    const { referrer, friend } = await referrerWithFriend();
    await earn(friend, 400);
    await earn(friend, 400);
    const tx = await earn(friend, 300);
    await reverse(friend, tx, 300);
    return expectBalance(referrer, 500, 'friend still at 800 verified');
  });

  await r.check('F08', 'two qualifying events at the same moment pay one bonus', async () => {
    const { referrer, friend } = await referrerWithFriend();
    await race(6, () => earn(friend, 500));
    return expectBalance(referrer, 500, 'after six parallel qualifying postbacks');
  });

  await r.check('F09', 'a full refund of the qualifying purchase takes the bonus back', async () => {
    const { referrer, friend } = await referrerWithFriend();
    const order = await buy(friend);
    if ((await t.balance(referrer)) !== 500) return `referrer has ${await t.balance(referrer)} after the purchase, expected 500`;
    await refundFull(order);
    return expectBalance(referrer, 0, 'after the refund');
  });

  await r.check('F10', 'a second account of the referrer (a Gmail dot and plus variant) never pays', async () => {
    const referrer = await t.signup({ email: `jane.doe.${RUN_ID}@gmail.com` });
    const code = await codeOf(referrer);
    const res = await t.api('/api/signup', { body: { email: `j.a.n.e.d.o.e${RUN_ID}+bonus@googlemail.com`, password: 'correct horse battery', ref: code } });
    if (res.status !== 201 && res.status !== 200) return true; // refused outright: nothing can be paid
    await earn({ id: res.json.user_id }, 800);
    return expectBalance(referrer, 0, 'after the second account qualified');
  });

  await r.check('F11', 'at most 20 bonuses per referrer in 30 days', async () => {
    const referrer = await t.signup();
    const code = await codeOf(referrer);
    for (let i = 0; i < 21; i += 1) {
      const friend = await t.signup({ ref: code });
      await earn(friend, 500);
    }
    return expectBalance(referrer, 10000, 'after 21 qualified friends');
  }, { timeoutMs: 90000 });

  await r.check('F12', 'reconciliation reports no mismatch after all of the above', async () => {
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop);
}
