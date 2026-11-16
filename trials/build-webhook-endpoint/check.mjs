#!/usr/bin/env node
// Checker for the build-webhook-endpoint trial: Stripe Checkout webhooks credit paid orders.
//   node check.mjs <folder>
import { client, is4xx, notStarted, ok, race, refusesToStart, report, startTrialApp, statuses, stripeEvent, targetFolder } from '../lib/harness.mjs';
import { timestampedHeader } from '../../skills/build-webhook-endpoint/assets/sign-test-event.mjs';

const folder = targetFolder();
const SECRET = 'whsec_trial_secret_0123456789abcdef';
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  REWARDLY_POSTBACK_KEY: 'rewardly_trial_key_0123456789',
  ADMIN_KEY: 'trial_admin_key_0123456789abcdef0123456789',
};
const r = report('build-webhook-endpoint');

const CHECKS = [
  ['W01', 'the app refuses to start without STRIPE_WEBHOOK_SECRET'],
  ['W02', 'a genuine checkout.session.completed credits the pack once'],
];

if (!(await r.check(...CHECKS[0], async () => {
  const { STRIPE_WEBHOOK_SECRET, ...rest } = ENV;
  return (await refusesToStart(folder, rest)) || 'the app started without the secret';
}))) {
  // keep going: the remaining checks run with the secret set
}

const app = await startTrialApp(folder, ENV);
if (!app.started) {
  r.skipAll([[CHECKS[1][0], 'all other checks']], notStarted(app));
  await r.finish(app.stop);
} else {
  const t = client(app.base);
  const session = (order, extra = {}) => ({
    id: `cs_test_${order.order_id}`,
    object: 'checkout.session',
    client_reference_id: order.order_id,
    payment_intent: `pi_${order.order_id}`,
    payment_status: 'paid',
    status: 'complete',
    mode: 'payment',
    amount_total: order.price_cents,
    amount_subtotal: order.price_cents,
    currency: 'usd',
    metadata: { order_id: order.order_id },
    ...extra,
  });
  const ev = (type, object, opts) => stripeEvent(app.base, SECRET, type, object, opts);
  const paid = (order, extra, opts) => ev('checkout.session.completed', session(order, extra), opts);
  const fresh = async (pack = 'small', body = {}) => {
    const user = await t.signup();
    const res = await t.api('/api/checkout', { token: user.token, body: { pack, ...body } });
    if (res.status !== 201 && res.status !== 200) throw new Error(`checkout answered ${res.status}`);
    return { user, order: res.json };
  };
  // Sends a request that must be refused, and reports a failure if it was accepted or credited.
  const refused = async (request, user) => {
    const res = await t.send(request);
    const balance = await t.balance(user);
    if (!is4xx(res.status)) return `answered ${res.status}, expected 4xx`;
    if (balance !== 0) return `balance moved to ${balance}`;
    return true;
  };

  await r.check(...CHECKS[1], async () => {
    const { user, order } = await fresh();
    const res = await t.send(paid(order));
    const balance = await t.balance(user);
    if (!ok(res.status)) return `answered ${res.status}: ${res.text.slice(0, 100)}`;
    return balance === order.coins || `balance ${balance}, expected ${order.coins}`;
  });

  await r.check('W03', 'an event without a Stripe-Signature header is refused and credits nothing', async () => {
    const { user, order } = await fresh();
    return refused(paid(order, {}, { sign: false }), user);
  });

  await r.check('W04', 'an event signed with another secret is refused', async () => {
    const { user, order } = await fresh();
    const request = stripeEvent(app.base, 'whsec_some_other_secret_000000000', 'checkout.session.completed', session(order));
    return refused(request, user);
  });

  await r.check('W05', 'a body changed by one byte under the original signature is refused', async () => {
    const { user, order } = await fresh();
    const request = paid(order);
    request.rawBody = request.rawBody.replace('"amount_total":499', '"amount_total":498');
    if (!request.rawBody.includes('498')) return 'test setup: body not changed';
    const res = await refused(request, user);
    if (res !== true) return res;
    // The original, untouched, must still work: the refusal stored nothing that blocks it.
    const genuine = await t.send(paid(order));
    return (ok(genuine.status) && (await t.balance(user)) === order.coins) || 'the genuine event was not applied afterwards';
  });

  await r.check('W06', 'a signature timestamp 10 minutes old is refused', async () => {
    const { user, order } = await fresh();
    return refused(paid(order, {}, { age: 600 }), user);
  });

  await r.check('W07', 'a signature timestamp 10 minutes in the future is refused', async () => {
    const { user, order } = await fresh();
    return refused(paid(order, {}, { age: -600 }), user);
  });

  await r.check('W08', 'the same event delivered three times credits once, every answer 2xx', async () => {
    const { user, order } = await fresh();
    const request = paid(order);
    const answers = [];
    for (let i = 0; i < 3; i += 1) answers.push((await t.send(request)).status);
    const balance = await t.balance(user);
    if (!answers.every(ok)) return `answers ${answers.join(',')}`;
    return balance === order.coins || `balance ${balance}, expected ${order.coins}`;
  });

  await r.check('W09', 'the same event ten times at once credits once, every answer 2xx', async () => {
    const { user, order } = await fresh();
    const request = paid(order);
    const results = await race(10, () => t.send(request));
    const balance = await t.balance(user);
    if (!results.every((x) => ok(x.status))) return `answers ${statuses(results)}`;
    return balance === order.coins || `balance ${balance}, expected ${order.coins}`;
  });

  await r.check('W10', 'two different events for the same order (completed, async_payment_succeeded) credit once', async () => {
    const { user, order } = await fresh();
    await t.send(paid(order));
    await t.send(ev('checkout.session.async_payment_succeeded', session(order)));
    await t.send(paid(order)); // a second event id for the same session
    const balance = await t.balance(user);
    return balance === order.coins || `balance ${balance}, expected ${order.coins}`;
  });

  await r.check('W11', 'an underpaid session credits nothing and the order can still be paid', async () => {
    const { user, order } = await fresh();
    const res = await t.send(paid(order, { amount_total: 1, amount_subtotal: 1 }));
    if (res.status >= 500) return `answered ${res.status}`;
    if ((await t.balance(user)) !== 0) return 'the underpaid event credited coins';
    await t.send(paid(order));
    const balance = await t.balance(user);
    return balance === order.coins || `after the correct payment the balance is ${balance}, expected ${order.coins}`;
  });

  await r.check('W12', 'a session in another currency credits nothing', async () => {
    const { user, order } = await fresh();
    const res = await t.send(paid(order, { currency: 'eur' }));
    if (res.status >= 500) return `answered ${res.status}`;
    const balance = await t.balance(user);
    return balance === 0 || `balance ${balance}`;
  });

  await r.check('W13', 'payment_status unpaid credits nothing; the later async_payment_succeeded credits once', async () => {
    const { user, order } = await fresh();
    await t.send(paid(order, { payment_status: 'unpaid' }));
    if ((await t.balance(user)) !== 0) return 'an unpaid session credited coins';
    await t.send(ev('checkout.session.async_payment_succeeded', session(order)));
    const balance = await t.balance(user);
    return balance === order.coins || `after async_payment_succeeded the balance is ${balance}, expected ${order.coins}`;
  });

  await r.check('W14', 'an event type the app does not handle answers 2xx and changes nothing', async () => {
    const { user, order } = await fresh();
    const res = await t.send(ev('customer.created', { id: 'cus_test_1', object: 'customer', metadata: { order_id: order.order_id } }));
    const balance = await t.balance(user);
    if (!ok(res.status)) return `answered ${res.status}`;
    return balance === 0 || `balance ${balance}`;
  });

  await r.check('W15', 'the grant is read from the order, not from the request or the event', async () => {
    const { user, order } = await fresh('small', { coins: 1_000_000 });
    await t.send(paid(order, { metadata: { order_id: order.order_id, coins: '99999' } }));
    const balance = await t.balance(user);
    return balance === 500 || `balance ${balance}, expected 500 for the small pack`;
  });

  await r.check('W16', 'an event for an unknown order credits nothing and does not answer 5xx', async () => {
    const { user, order } = await fresh();
    const res = await t.send(paid({ ...order, order_id: 'ord_does_not_exist' }));
    const balance = await t.balance(user);
    if (res.status >= 500) return `answered ${res.status}`;
    return balance === 0 || `balance ${balance}`;
  });

  await r.check('W17', 'a Stripe-Signature with a v0 entry and several v1 entries, one of them valid, is accepted', async () => {
    const { user, order } = await fresh();
    const request = paid(order);
    const header = timestampedHeader(SECRET, Math.floor(Date.now() / 1000), request.rawBody);
    const [tPart, v1Part] = header.split(',');
    request.headers['stripe-signature'] = `${tPart},v1=${'0'.repeat(64)},${v1Part},v0=${'f'.repeat(64)}`;
    const res = await t.send(request);
    const balance = await t.balance(user);
    if (!ok(res.status)) return `answered ${res.status}`;
    return balance === order.coins || `balance ${balance}`;
  });

  await r.check('W18', 'the signature is checked over the raw bytes (a body with unusual spacing is accepted)', async () => {
    const { user, order } = await fresh();
    const request = paid(order);
    const pretty = JSON.stringify(JSON.parse(request.rawBody), null, 3);
    const t0 = Math.floor(Date.now() / 1000);
    request.rawBody = pretty;
    request.headers['stripe-signature'] = timestampedHeader(SECRET, t0, pretty);
    const res = await t.send(request);
    const balance = await t.balance(user);
    if (!ok(res.status)) return `answered ${res.status}`;
    return balance === order.coins || `balance ${balance}`;
  });

  await r.check('W19', 'a refused (badly signed) delivery leaves nothing behind that blocks the genuine event with the same id', async () => {
    const { user, order } = await fresh();
    const id = `evt_test_same_${order.order_id}`;
    const forged = stripeEvent(app.base, 'whsec_wrong_wrong_wrong_wrong_00', 'checkout.session.completed', session(order), { id });
    const first = await t.send(forged);
    if (!is4xx(first.status)) return `the forged delivery answered ${first.status}`;
    await t.send(paid(order, {}, { id }));
    const balance = await t.balance(user);
    return balance === order.coins || `balance ${balance} after the genuine event, expected ${order.coins}`;
  });

  await r.check('W20', 'a successful order still credits after all the above (no state leaked between orders)', async () => {
    const { user, order } = await fresh('medium');
    const res = await t.send(paid(order));
    const balance = await t.balance(user);
    return (ok(res.status) && balance === 1200) || `answered ${res.status}, balance ${balance}`;
  });

  await r.finish(app.stop);
}
