#!/usr/bin/env node
// Checker for the handle-refunds-and-reversals trial: Stripe refunds and disputes, Rewardly reversals.
//   node check.mjs <folder>
import { createGiftly } from '../lib/fake-giftly.mjs';
import { client, is4xx, notStarted, ok, race, report, rewardlyUrl, startTrialApp, statuses, stripeEvent, targetFolder, trialSecret, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = trialSecret('whsec_');
const KEY = trialSecret('rewardly_');
const ADMIN = trialSecret('admin_');
const giftly = createGiftly();
const giftlyPort = await giftly.listen();
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  REWARDLY_POSTBACK_KEY: KEY,
  ADMIN_KEY: ADMIN,
  GIFTLY_API_URL: `http://127.0.0.1:${giftlyPort}`,
  GIFTLY_API_KEY: 'giftly_trial_key',
  PAYOUT_HOLD_SECONDS: '0',
};
const r = report('handle-refunds-and-reversals');
const app = await startTrialApp(folder, ENV);

if (!app.started) {
  r.skipAll([['R00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop, () => giftly.close());
} else {
  const t = client(app.base);
  const ev = (type, object, opts) => t.send(stripeEvent(app.base, SECRET, type, object, opts));
  const buy = async (user, pack = 'small', { pay = true } = {}) => {
    const res = await t.api('/api/checkout', { token: user.token, body: { pack } });
    if (res.status !== 201 && res.status !== 200) throw new Error(`checkout answered ${res.status}`);
    const order = { ...res.json, pi: `pi_${res.json.order_id}`, ch: `ch_${res.json.order_id}` };
    if (pay) await payOrder(order);
    return order;
  };
  const payOrder = (order) =>
    ev('checkout.session.completed', {
      id: `cs_${order.order_id}`,
      object: 'checkout.session',
      client_reference_id: order.order_id,
      payment_intent: order.pi,
      payment_status: 'paid',
      status: 'complete',
      amount_total: order.price_cents,
      currency: 'usd',
      metadata: { order_id: order.order_id },
    });
  const charge = (order, refundedCents) => ({
    id: order.ch,
    object: 'charge',
    amount: order.price_cents,
    amount_captured: order.price_cents,
    amount_refunded: refundedCents,
    refunded: refundedCents >= order.price_cents,
    currency: 'usd',
    paid: true,
    status: 'succeeded',
    payment_intent: order.pi,
    metadata: { order_id: order.order_id },
  });
  const refund = (order, runningTotal, opts) => ev('charge.refunded', charge(order, runningTotal), opts);
  const dispute = (order, id, type, status, amount = order.price_cents) =>
    ev(type, { id, object: 'dispute', amount, currency: 'usd', charge: order.ch, payment_intent: order.pi, reason: 'fraudulent', status });
  const earn = async (user, reward, tx = uid('tx')) => {
    const res = await t.api(rewardlyUrl(KEY, { user, tx, reward }));
    if (!ok(res.status)) throw new Error(`postback answered ${res.status}`);
    return tx;
  };
  const reverse = (user, tx, reward, opts = {}) => t.api(rewardlyUrl(KEY, { user, tx, reward, status: 2, ...opts }));
  const expectBalance = async (user, want, what) => {
    const got = await t.balance(user);
    return got === want || `${what}: balance ${got}, expected ${want}`;
  };

  await r.check('R01', 'a full refund takes back the coins the order granted', async () => {
    const user = await t.signup();
    const order = await buy(user);
    const res = await refund(order, 499);
    if (!ok(res.status)) return `refund answered ${res.status}`;
    return expectBalance(user, 0, 'after the refund');
  });

  await r.check('R02', 'the same refund delivered again, ten times at once and as a new event id takes nothing more', async () => {
    const user = await t.signup();
    const order = await buy(user, 'medium');
    const request = stripeEvent(app.base, SECRET, 'charge.refunded', charge(order, 999));
    const results = await race(10, () => t.send(request));
    if (!results.every((x) => ok(x.status))) return `parallel answers ${statuses(results)}`;
    await t.send(request);
    await refund(order, 999); // Stripe can send a second event for the same refund state
    return expectBalance(user, 0, 'after repeated refunds');
  });

  await r.check('R03', 'partial refunds of 166, 166 and 167 cents take back 166, 166 and 168 coins', async () => {
    const user = await t.signup();
    const order = await buy(user);
    const steps = [];
    for (const total of [166, 332, 499]) {
      await refund(order, total);
      steps.push(await t.balance(user));
    }
    const want = [334, 168, 0];
    return steps.every((v, i) => v === want[i]) || `balances ${steps.join(',')}, expected ${want.join(',')}`;
  });

  await r.check('R04', 'a refund after the coins were spent leaves a debt; spending and transfers are refused until it is repaid', async () => {
    const user = await t.signup();
    const friend = await t.signup();
    const order = await buy(user);
    const spent = await t.api('/api/spend', { token: user.token, body: { item: 'theme' } });
    if (!ok(spent.status)) return `setup spend answered ${spent.status}`;
    await refund(order, 499);
    const debt = await t.balance(user);
    if (debt !== -300) return `after the refund the balance is ${debt}, expected -300 (no clamping at zero)`;
    const spend = await t.api('/api/spend', { token: user.token, body: { item: 'avatar' } });
    const send = await t.api('/api/transfer', { token: user.token, body: { to: friend.email, amount: 1 } });
    if (ok(spend.status) || ok(send.status)) return `spend answered ${spend.status}, transfer ${send.status}`;
    await earn(user, 200);
    return expectBalance(user, -100, 'a new credit raises the balance toward zero');
  });

  await r.check('R05', 'a refund that arrives before the payment event leaves no coins once the payment arrives', async () => {
    const user = await t.signup();
    const order = await buy(user, 'small', { pay: false });
    const early = await refund(order, 499);
    if (early.status >= 500) return `the early refund answered ${early.status}`;
    if ((await t.balance(user)) !== 0) return 'the early refund changed the balance';
    await payOrder(order);
    await refund(order, 499);
    return expectBalance(user, 0, 'after the payment and the refund again');
  });

  await r.check('R06', 'an offer reversal takes the credit back once, also when delivered twice', async () => {
    const user = await t.signup();
    const tx = await earn(user, 200);
    const a = await reverse(user, tx, 200);
    const b = await reverse(user, tx, 200);
    if (!ok(a.status) || !ok(b.status)) return `answers ${a.status},${b.status}`;
    return expectBalance(user, 0, 'after two reversals');
  });

  await r.check('R07', 'a reversal takes the stored amount from the stored account, not what the message names', async () => {
    const user = await t.signup();
    const other = await t.signup();
    await earn(other, 300);
    const tx = await earn(user, 200);
    await reverse(user, tx, 50); // a smaller amount, signed
    const afterAmount = await t.balance(user);
    const tx2 = await earn(user, 120);
    await reverse(other, tx2, 120); // the right tx, signed for another user
    const mine = await t.balance(user);
    const theirs = await t.balance(other);
    if (afterAmount !== 0) return `reversal naming 50 left the balance at ${afterAmount}, expected 0`;
    if (theirs !== 300) return `the other user's balance moved to ${theirs}`;
    return mine === 0 || `reversal naming another user left the owner at ${mine}, expected 0`;
  });

  await r.check('R08', 'a reversal before its credit is acknowledged; the credit that follows pays nothing', async () => {
    const user = await t.signup();
    const tx = uid('late');
    const early = await reverse(user, tx, 900);
    if (!ok(early.status)) return `the early reversal answered ${early.status}`;
    if ((await t.balance(user)) !== 0) return 'the early reversal changed the balance';
    await t.api(rewardlyUrl(KEY, { user, tx, reward: 900 }));
    await t.api(rewardlyUrl(KEY, { user, tx, reward: 900 }));
    await reverse(user, tx, 900);
    return expectBalance(user, 0, 'after the late credit and repeats');
  });

  await r.check('R09', 'a dispute takes the coins once when opened and gives the same amount back once when won', async () => {
    const user = await t.signup();
    const order = await buy(user);
    const id = uid('dp');
    await dispute(order, id, 'charge.dispute.created', 'needs_response');
    await dispute(order, id, 'charge.dispute.created', 'needs_response');
    const open = await t.balance(user);
    await dispute(order, id, 'charge.dispute.closed', 'won');
    await dispute(order, id, 'charge.dispute.closed', 'won');
    const won = await t.balance(user);
    return (open === 0 && won === 500) || `balance ${open} while open (expected 0), ${won} after the win (expected 500)`;
  });

  await r.check('R10', 'a lost dispute keeps the coins taken, once', async () => {
    const user = await t.signup();
    const order = await buy(user, 'medium');
    const id = uid('dp');
    await dispute(order, id, 'charge.dispute.created', 'needs_response');
    await dispute(order, id, 'charge.dispute.closed', 'lost');
    await dispute(order, id, 'charge.dispute.closed', 'lost');
    return expectBalance(user, 0, 'after a lost dispute');
  });

  await r.check('R11', 'refunds and a dispute on one order never take more than it granted; a win gives back only what the dispute took', async () => {
    const user = await t.signup();
    const order = await buy(user);
    await refund(order, 250); // takes 250 of 500
    const afterRefund = await t.balance(user);
    const id = uid('dp');
    await dispute(order, id, 'charge.dispute.created', 'needs_response');
    const open = await t.balance(user);
    await dispute(order, id, 'charge.dispute.closed', 'won');
    const won = await t.balance(user);
    const want = [250, 0, 250];
    const got = [afterRefund, open, won];
    return got.every((v, i) => v === want[i]) || `balances ${got.join(',')}, expected ${want.join(',')}`;
  });

  await r.check('R12', 'the referral bonus a refunded purchase qualified is taken back with it', async () => {
    const referrer = await t.signup();
    const code = (await t.me(referrer)).ref_code;
    const friend = await t.signup({ ref: code });
    const order = await buy(friend);
    const paidBonus = await t.balance(referrer);
    if (paidBonus !== 500) return `setup: the referrer has ${paidBonus} after the friend's purchase, expected 500`;
    await refund(order, 499);
    return expectBalance(referrer, 0, 'the referrer after the refund');
  });

  await r.check('R13', 'an offer reversal also lowers what can be cashed out (bought coins stay non-withdrawable)', async () => {
    const user = await t.signup();
    await buy(user); // 500 bought coins, not withdrawable
    const tx = await earn(user, 600);
    await reverse(user, tx, 600);
    const before = giftly.issued.length;
    const res = await t.api('/api/payouts', { token: user.token, body: { amount: 500 } });
    if (giftly.issued.length !== before) return `a gift card was issued (payout answered ${res.status})`;
    return !ok(res.status) || `payout answered ${res.status}`;
  });

  await r.check('R14', 'refund and dispute events are verified like payment events', async () => {
    const user = await t.signup();
    const order = await buy(user);
    const forged = await t.send(stripeEvent(app.base, 'whsec_wrong_wrong_wrong_0000000', 'charge.refunded', charge(order, 499)));
    const unsigned = await t.send(stripeEvent(app.base, SECRET, 'charge.refunded', charge(order, 499), { sign: false }));
    const forgedPostback = await t.api(rewardlyUrl('not-the-key-000000000', { user, tx: uid('f'), reward: 100, status: 2 }));
    if (!is4xx(forged.status) || !is4xx(unsigned.status)) return `forged ${forged.status}, unsigned ${unsigned.status}`;
    if (!is4xx(forgedPostback.status)) return `forged reversal postback answered ${forgedPostback.status}`;
    return expectBalance(user, 500, 'after forged reversals');
  });

  await r.check('R15', 'reconciliation reports no mismatch after all of the above', async () => {
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop, () => giftly.close());
}
