#!/usr/bin/env node
// Checker for the add-subscriptions trial: Coinbarn Plus on Stripe Billing.
//   node check.mjs <folder>
import { randomBytes } from 'node:crypto';
import { createStripe } from '../lib/fake-stripe.mjs';
import { client, is4xx, notStarted, ok, race, report, sleep, startTrialApp, statuses, targetFolder, trialSecret, uid } from '../lib/harness.mjs';
import { timestampedHeader } from '../../skills/add-subscriptions/assets/sign-test-event.mjs';

const folder = targetFolder();
const SECRET = trialSecret('whsec_');
const API_KEY = trialSecret('sk_test_');
const ADMIN = trialSecret('admin_');
const GRACE = 3;
const MONTH = 30 * 24 * 3600;
const stripe = createStripe({ key: API_KEY });
const stripePort = await stripe.listen();
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: API_KEY,
  STRIPE_API_URL: `http://127.0.0.1:${stripePort}`,
  PLUS_GRACE_SECONDS: String(GRACE),
  REWARDLY_POSTBACK_KEY: trialSecret('rewardly_'),
  ADMIN_KEY: ADMIN,
};
const r = report('add-subscriptions');
const app = await startTrialApp(folder, ENV);
const nowS = () => Math.floor(Date.now() / 1000);
const waitUntil = async (unixSeconds) => {
  const ms = unixSeconds * 1000 - Date.now();
  if (ms > 0) await sleep(ms);
};

if (!app.started) {
  r.skipAll([['S00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop, () => stripe.close());
} else {
  const t = client(app.base);

  // A Stripe event as the webhook endpoint receives it, signed like Stripe-Signature.
  const event = (type, object, { id, age = 0, secret = SECRET, sign = true } = {}) => {
    const ts = nowS() - age;
    const rawBody = JSON.stringify({
      id: id || `evt_test_${randomBytes(8).toString('hex')}`,
      object: 'event',
      type,
      created: ts,
      livemode: false,
      api_version: '2026-10-28.endive',
      data: { object },
    });
    return {
      method: 'POST',
      url: `${app.base}/webhooks/stripe`,
      headers: { 'content-type': 'application/json', ...(sign ? { 'stripe-signature': timestampedHeader(secret, ts, rawBody) } : {}) },
      rawBody,
    };
  };
  // The same event delivered again: Stripe signs every attempt with a fresh timestamp.
  const resign = (request) => {
    const ts = nowS();
    return { ...request, headers: { ...request.headers, 'stripe-signature': timestampedHeader(SECRET, ts, request.rawBody) } };
  };
  const deliver = async (request) => {
    const res = await t.send(request);
    if (!ok(res.status)) throw new Error(`${JSON.parse(request.rawBody).type} answered ${res.status}: ${res.text.slice(0, 120)}`);
    return res;
  };

  // A Plus checkout and the Stripe ids that belong to it.
  const subscribe = async (user) => {
    const owner = user || (await t.signup());
    const res = await t.api('/api/plus/checkout', { token: owner.token, body: {} });
    if (res.status !== 201 && res.status !== 200) throw new Error(`plus checkout answered ${res.status}`);
    const tag = randomBytes(6).toString('hex');
    return { user: owner, checkoutId: res.json.checkout_id, id: `sub_${tag}`, customer: `cus_${tag}`, item: `si_${tag}`, created: nowS(), invoices: 0 };
  };
  // Puts the subscription into the Stripe sandbox and returns the object, as an event would carry it.
  const subState = (s, status, start, end, extra = {}) =>
    stripe.put({
      id: s.id,
      object: 'subscription',
      status,
      customer: s.customer,
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      created: s.created,
      livemode: false,
      latest_invoice: s.latest ?? null,
      metadata: { checkout_id: s.checkoutId },
      items: {
        object: 'list',
        data: [
          {
            id: s.item,
            object: 'subscription_item',
            price: { id: 'price_plus_monthly', recurring: { interval: 'month', interval_count: 1 } },
            quantity: 1,
            current_period_start: start,
            current_period_end: end,
          },
        ],
      },
      ...extra,
    });
  const invoiceState = (s, { status, reason, start, end }) => {
    s.invoices += 1;
    const id = `in_${s.id.slice(4)}_${s.invoices}`;
    const pi = `pi_${s.id.slice(4)}_${s.invoices}`;
    s.latest = id;
    const invoice = stripe.put({
      id,
      object: 'invoice',
      status,
      billing_reason: reason,
      customer: s.customer,
      currency: 'usd',
      amount_due: 499,
      amount_paid: status === 'paid' ? 499 : 0,
      attempt_count: 1,
      livemode: false,
      parent: { type: 'subscription_details', subscription_details: { subscription: s.id, metadata: { checkout_id: s.checkoutId } } },
      lines: {
        object: 'list',
        data: [
          {
            id: `il_${id.slice(3)}`,
            object: 'line_item',
            amount: 499,
            currency: 'usd',
            period: { start, end },
            parent: { type: 'subscription_item_details', subscription_item_details: { subscription: s.id, subscription_item: s.item, proration: false } },
          },
        ],
      },
      status_transitions: { paid_at: status === 'paid' ? nowS() : null },
    });
    if (status === 'paid') stripe.link(id, pi);
    return { invoice, pi };
  };
  const payInvoice = (s, invoice, pi) => {
    const paid = stripe.put({ ...invoice, status: 'paid', amount_paid: invoice.amount_due, status_transitions: { paid_at: nowS() } });
    stripe.link(paid.id, pi);
    return paid;
  };

  // The usual first month: created while incomplete, then the first invoice is paid.
  const activate = async (s, start, end) => {
    await deliver(event('customer.subscription.created', subState(s, 'incomplete', start, end)));
    const { invoice, pi } = invoiceState(s, { status: 'paid', reason: 'subscription_create', start, end });
    const active = subState(s, 'active', start, end);
    const paidEvent = event('invoice.paid', invoice);
    await deliver(paidEvent);
    await deliver(event('customer.subscription.updated', active));
    return { invoice, pi, paidEvent, active };
  };
  const cancelNow = async (s, start, end) => {
    const ended = subState(s, 'canceled', start, end, { canceled_at: nowS(), ended_at: nowS() });
    await deliver(event('customer.subscription.deleted', ended));
  };

  const perk = async (user) => (await t.api('/api/plus/perk', { token: user.token })).status;
  const hasPlus = async (user, what) => {
    const status = await perk(user);
    return status === 200 || `${what}: GET /api/plus/perk answered ${status}, expected 200`;
  };
  const noPlus = async (user, what) => {
    const status = await perk(user);
    return status === 402 || status === 403 || `${what}: GET /api/plus/perk answered ${status}, expected 402 or 403`;
  };
  const coins = async (user, want, what) => {
    const got = await t.balance(user);
    return got === want || `${what}: balance ${got}, expected ${want}`;
  };
  const all = async (...results) => {
    for (const result of results) {
      const value = await result;
      if (value !== true) return value;
    }
    return true;
  };

  const first = await subscribe();
  const t1 = nowS();
  await r.check('S01', 'an incomplete subscription and a failed first payment give no Plus and no coins', async () => {
    await deliver(event('customer.subscription.created', subState(first, 'incomplete', t1, t1 + MONTH)));
    const { invoice } = invoiceState(first, { status: 'open', reason: 'subscription_create', start: t1, end: t1 + MONTH });
    await deliver(event('invoice.payment_failed', invoice));
    return all(noPlus(first.user, 'before payment'), coins(first.user, 0, 'before payment'));
  });

  await r.check('S02', 'the first paid invoice gives Plus and 300 coins', async () => {
    const paid = payInvoice(first, stripe.invoice(first.latest), `pi_${first.id.slice(4)}_1`);
    const active = subState(first, 'active', t1, t1 + MONTH);
    await deliver(event('invoice.paid', paid));
    await deliver(event('customer.subscription.updated', active));
    return all(hasPlus(first.user, 'after the first payment'), coins(first.user, 300, 'after the first payment'));
  });

  await r.check('S03', 'invoice.paid delivered again, ten times at once and under a new event id grants the month once', async () => {
    const s = await subscribe();
    const start = nowS();
    const { invoice, paidEvent } = await activate(s, start, start + MONTH);
    await deliver(resign(paidEvent));
    const results = await race(10, () => t.send(resign(paidEvent)));
    if (!results.every((x) => ok(x.status))) return `parallel deliveries answered ${statuses(results)}`;
    await deliver(event('invoice.paid', invoice)); // a second event for the same invoice
    return all(hasPlus(s.user, 'after the repeats'), coins(s.user, 300, 'after the repeats'));
  });

  // S04 to S08 share one wait: the first month of both subscriptions ends a second from now.
  const renewed = await subscribe();
  const failing = await subscribe();
  const t2 = nowS();
  const monthEnd = t2 + 1;
  await r.check('S04', 'a paid renewal, delivered twice, grants 300 coins for the new month once', async () => {
    await activate(renewed, t2 - 1000, monthEnd);
    await activate(failing, t2 - 1000, monthEnd);
    const { invoice } = invoiceState(renewed, { status: 'paid', reason: 'subscription_cycle', start: monthEnd, end: monthEnd + MONTH });
    const paid = event('invoice.paid', invoice);
    await deliver(paid);
    await deliver(resign(paid));
    await deliver(event('customer.subscription.updated', subState(renewed, 'active', monthEnd, monthEnd + MONTH)));
    return coins(renewed.user, 600, 'after the renewal');
  });

  await r.check('S05', 'a failed renewal keeps Plus during the grace period', async () => {
    const { invoice } = invoiceState(failing, { status: 'open', reason: 'subscription_cycle', start: monthEnd, end: monthEnd + MONTH });
    await deliver(event('invoice.payment_failed', invoice));
    await deliver(event('customer.subscription.updated', subState(failing, 'past_due', monthEnd, monthEnd + MONTH)));
    if (nowS() >= monthEnd + GRACE) return 'setup took longer than the grace period';
    return all(hasPlus(failing.user, 'right after the failed renewal'), coins(failing.user, 300, 'after the failed renewal'));
  });

  await waitUntil(monthEnd + GRACE + 1.5);
  await r.check('S06', 'a paid renewal keeps Plus after the first month and its grace period have passed', async () =>
    hasPlus(renewed.user, 'the renewed subscription after the first month'),
  );

  await r.check('S07', 'after the grace period Plus ends while the renewal stays unpaid', async () =>
    noPlus(failing.user, 'past the grace period with the renewal unpaid'),
  );

  await r.check('S08', 'a renewal paid after the grace period gives Plus back, with the coins for that month once', async () => {
    const paid = payInvoice(failing, stripe.invoice(failing.latest), `pi_${failing.id.slice(4)}_2`);
    await deliver(event('invoice.paid', paid));
    await deliver(event('customer.subscription.updated', subState(failing, 'active', monthEnd, monthEnd + MONTH)));
    await deliver(event('invoice.paid', paid)); // a second event for the same invoice
    return all(hasPlus(failing.user, 'after the late payment'), coins(failing.user, 600, 'after the late payment'));
  });

  await r.check('S09', 'canceling at the period end keeps Plus until the end of the paid month, then it ends', async () => {
    const s = await subscribe();
    const start = nowS() - 1000;
    const end = nowS() + 2;
    await activate(s, start, end);
    await deliver(event('customer.subscription.updated', subState(s, 'active', start, end, { cancel_at_period_end: true, canceled_at: nowS() })));
    const during = await hasPlus(s.user, 'after canceling, before the period end');
    if (during !== true) return during;
    await waitUntil(end + 1);
    await deliver(event('customer.subscription.deleted', subState(s, 'canceled', start, end, { cancel_at_period_end: true, canceled_at: end - 3, ended_at: end })));
    return noPlus(s.user, 'after the period end');
  });

  await r.check('S10', 'an immediate cancel ends Plus at once', async () => {
    const s = await subscribe();
    const start = nowS();
    await activate(s, start, start + MONTH);
    await cancelNow(s, start, start + MONTH);
    return noPlus(s.user, 'after the immediate cancel');
  });

  await r.check('S11', 'a refund of a Plus payment ends Plus at once', async () => {
    const s = await subscribe();
    const start = nowS();
    const { pi } = await activate(s, start, start + MONTH);
    const charge = { id: `ch_${pi.slice(3)}`, object: 'charge', amount: 499, amount_captured: 499, amount_refunded: 499, refunded: true, currency: 'usd', paid: true, status: 'succeeded', payment_intent: pi, metadata: {} };
    await deliver(event('charge.refunded', charge));
    return noPlus(s.user, 'after the refund');
  });

  await r.check('S12', 'a dispute of a Plus payment ends Plus at once', async () => {
    const s = await subscribe();
    const start = nowS();
    const { pi } = await activate(s, start, start + MONTH);
    const dispute = { id: uid('dp'), object: 'dispute', amount: 499, currency: 'usd', charge: `ch_${pi.slice(3)}`, payment_intent: pi, reason: 'fraudulent', status: 'needs_response' };
    await deliver(event('charge.dispute.created', dispute));
    return noPlus(s.user, 'after the dispute');
  });

  await r.check('S13', 'a late customer.subscription.updated with an older state does not undo a cancellation', async () => {
    const s = await subscribe();
    const start = nowS();
    const { active } = await activate(s, start, start + MONTH);
    await cancelNow(s, start, start + MONTH);
    await deliver(event('customer.subscription.updated', active, { age: 30 }));
    return noPlus(s.user, 'after the stale update');
  });

  await r.check('S14', 'invoice.paid that arrives before customer.subscription.created still ends with Plus and 300 coins', async () => {
    const s = await subscribe();
    const start = nowS();
    const created = { ...subState(s, 'incomplete', start, start + MONTH) };
    const { invoice } = invoiceState(s, { status: 'paid', reason: 'subscription_create', start, end: start + MONTH });
    subState(s, 'active', start, start + MONTH);
    await deliver(event('invoice.paid', invoice));
    await deliver(event('customer.subscription.created', created, { age: 5 }));
    return all(hasPlus(s.user, 'after both events'), coins(s.user, 300, 'after both events'));
  });

  await r.check('S15', 'forged, unsigned and stale-signed events are refused and change nothing', async () => {
    const s = await subscribe();
    const start = nowS();
    subState(s, 'incomplete', start, start + MONTH);
    const { invoice } = invoiceState(s, { status: 'open', reason: 'subscription_create', start, end: start + MONTH });
    const claimed = { ...invoice, status: 'paid', amount_paid: 499 };
    const active = { ...stripe.subscription(s.id), status: 'active' };
    const attempts = [
      event('invoice.paid', claimed, { secret: trialSecret('whsec_') }),
      event('invoice.paid', claimed, { sign: false }),
      event('invoice.paid', claimed, { age: 600 }),
      event('customer.subscription.updated', active, { secret: trialSecret('whsec_') }),
    ];
    for (const request of attempts) {
      const res = await t.send(request);
      if (!is4xx(res.status)) return `${JSON.parse(request.rawBody).type} answered ${res.status}, expected 4xx`;
    }
    return all(noPlus(s.user, 'after forged events'), coins(s.user, 0, 'after forged events'));
  });

  await r.check('S16', 'an earlier genuine invoice.paid delivered again after a cancellation changes nothing', async () => {
    const s = await subscribe();
    const start = nowS();
    const { paidEvent } = await activate(s, start, start + MONTH);
    await cancelNow(s, start, start + MONTH);
    await deliver(resign(paidEvent));
    return all(noPlus(s.user, 'after the replay'), coins(s.user, 300, 'after the replay'));
  });

  await r.check('S17', 'plan, status or period fields sent by the client grant nothing', async () => {
    const user = await t.signup();
    const body = { plan: 'plus', status: 'active', plus: true, paid: true, current_period_end: nowS() + MONTH, coins: 1000 };
    const res = await t.api('/api/plus/checkout', { token: user.token, body });
    if (res.status !== 201 && res.status !== 200) return `checkout answered ${res.status}`;
    await t.api('/api/plus/perk?status=active&plus=1', { token: user.token });
    return all(noPlus(user, 'after a checkout that claims Plus'), coins(user, 0, 'after a checkout that claims Plus'));
  });

  await r.check('S18', 'a user with two subscriptions keeps Plus until both have ended', async () => {
    const a = await subscribe();
    const b = await subscribe(a.user);
    const start = nowS();
    await activate(a, start, start + MONTH);
    await activate(b, start, start + MONTH);
    await cancelNow(a, start, start + MONTH);
    const one = await hasPlus(a.user, 'with one of two subscriptions canceled');
    if (one !== true) return one;
    await cancelNow(b, start, start + MONTH);
    return noPlus(a.user, 'with both canceled');
  });

  const sync = async () => {
    const res = await t.api('/admin/plus/sync', { method: 'POST', headers: { 'x-admin-key': ADMIN } });
    if (!ok(res.status)) throw new Error(`POST /admin/plus/sync answered ${res.status}`);
  };

  await r.check('S19', 'the sync finds a cancellation whose webhooks were lost', async () => {
    const s = await subscribe();
    const start = nowS();
    await activate(s, start, start + MONTH);
    subState(s, 'canceled', start, start + MONTH, { canceled_at: nowS(), ended_at: nowS() }); // no event
    await sync();
    return noPlus(s.user, 'after the sync');
  });

  await r.check('S20', 'the sync finds a paid subscription whose webhooks were lost', async () => {
    const s = await subscribe();
    const start = nowS();
    invoiceState(s, { status: 'paid', reason: 'subscription_create', start, end: start + MONTH });
    subState(s, 'active', start, start + MONTH); // no event
    await sync();
    return hasPlus(s.user, 'after the sync');
  });

  await r.check('S21', 'reconciliation reports no mismatch after all of the above', async () => {
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop, () => stripe.close());
}
