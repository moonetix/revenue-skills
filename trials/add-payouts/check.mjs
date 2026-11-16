#!/usr/bin/env node
// Checker for the add-payouts trial: Giftly gift card cash-outs.
//   node check.mjs <folder>
import { createGiftly } from '../lib/fake-giftly.mjs';
import { client, notStarted, ok, race, report, rewardlyUrl, sleep, startTrialApp, statuses, stripeEvent, targetFolder, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = 'whsec_trial_secret_0123456789abcdef';
const KEY = 'rewardly_trial_key_0123456789';
const ADMIN = 'trial_admin_key_0123456789abcdef0123456789';
const HOLD = 2;
const giftly = createGiftly();
const giftlyPort = await giftly.listen();
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  REWARDLY_POSTBACK_KEY: KEY,
  ADMIN_KEY: ADMIN,
  GIFTLY_API_URL: `http://127.0.0.1:${giftlyPort}`,
  GIFTLY_API_KEY: 'giftly_trial_key',
  PAYOUT_HOLD_SECONDS: String(HOLD),
};
const r = report('add-payouts');
const app = await startTrialApp(folder, ENV);

if (!app.started) {
  r.skipAll([['P00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop, () => giftly.close());
} else {
  const t = client(app.base);
  const earn = async (user, reward, tx = uid('tx')) => {
    const res = await t.api(rewardlyUrl(KEY, { user, tx, reward }));
    if (!ok(res.status)) throw new Error(`postback answered ${res.status}`);
    return tx;
  };
  const buy = async (user, pack) => {
    const order = (await t.api('/api/checkout', { token: user.token, body: { pack } })).json;
    await t.send(
      stripeEvent(app.base, SECRET, 'checkout.session.completed', {
        id: `cs_${order.order_id}`,
        object: 'checkout.session',
        client_reference_id: order.order_id,
        payment_intent: `pi_${order.order_id}`,
        payment_status: 'paid',
        amount_total: order.price_cents,
        currency: 'usd',
        metadata: { order_id: order.order_id },
      }),
    );
  };
  const payout = (user, amount, key) =>
    t.api('/api/payouts', { token: user.token, body: { amount }, headers: key ? { 'idempotency-key': key } : {} });
  const idOf = (res) => res.json?.payout_id ?? res.json?.id ?? res.json?.payout?.id ?? null;
  const list = async (user) => (await t.api('/api/payouts', { token: user.token })).json ?? {};
  const statusOf = async (user, id) => (await list(user)).payouts?.find((p) => String(p.id) === String(id))?.status;
  const resolve = () => t.api('/admin/payouts/resolve', { method: 'POST', headers: { 'x-admin-key': ADMIN } });
  const cards = () => giftly.issued.length;

  // Setup: earnings that mature during the wait below.
  const users = {};
  for (const name of ['amounts', 'main', 'round', 'race', 'idem', 'count', 'cap', 'capRace', 'decline', 'lost', 'error', 'hang', 'reversal', 'view', 'bought']) {
    users[name] = await t.signup();
  }
  const setup = { amounts: 10000, main: 6000, round: 6000, race: 6000, idem: 20000, count: 30000, cap: 60000, capRace: 70000, decline: 6000, lost: 6000, error: 6000, hang: 6000, view: 7000 };
  let reversedTx = 'none';
  try {
    for (const [name, coins] of Object.entries(setup)) await earn(users[name], coins);
    reversedTx = await earn(users.reversal, 6000);
    await buy(users.reversal, 'large');
    await buy(users.reversal, 'large');
    await buy(users.bought, 'large');
    await buy(users.bought, 'large');
    await t.api('/api/promo', { token: users.bought.token, body: { code: 'WELCOME100' } });
    await buy(users.view, 'large');
  } catch (err) {
    console.log(`# setup: ${err.message}`); // the checks that need this setup fail with their own reason
  }
  await sleep((HOLD + 1.2) * 1000);

  await r.check('P01', 'zero, negative, fractional, string and below-minimum amounts are refused and change nothing', async () => {
    const u = users.amounts;
    const before = cards();
    for (const amount of [0, -5000, 5000.5, '5000', 4999, null]) {
      const res = await payout(u, amount);
      if (ok(res.status)) return `amount ${JSON.stringify(amount)} answered ${res.status}`;
    }
    const balance = await t.balance(u);
    if (cards() !== before) return 'a gift card was issued';
    return balance === 10000 || `balance ${balance}`;
  });

  await r.check('P02', 'fresh offer earnings cannot be cashed out before the hold', async () => {
    const u = await t.signup();
    await earn(u, 6000);
    const before = cards();
    const res = await payout(u, 5000);
    const balance = await t.balance(u);
    if (cards() !== before) return `a gift card was issued (answered ${res.status})`;
    return (!ok(res.status) && balance === 6000) || `answered ${res.status}, balance ${balance}`;
  });

  await r.check('P03', 'bought and promo coins cannot be cashed out', async () => {
    const u = users.bought;
    const before = cards();
    const res = await payout(u, 5000);
    const view = await list(u);
    if (cards() !== before) return `a gift card was issued (answered ${res.status})`;
    if (ok(res.status)) return `answered ${res.status}`;
    return view.withdrawable === 0 || `withdrawable ${view.withdrawable}, expected 0`;
  });

  await r.check('P04', 'matured offer coins are paid: one card of the right value, coins taken, status paid', async () => {
    const u = users.main;
    const before = cards();
    const res = await payout(u, 5000);
    const id = idOf(res);
    const balance = await t.balance(u);
    const card = giftly.issued[giftly.issued.length - 1];
    if (!ok(res.status)) return `answered ${res.status}: ${res.text.slice(0, 120)}`;
    if (cards() !== before + 1) return `${cards() - before} cards issued`;
    if (card.amount_cents !== 500) return `card of ${card.amount_cents} cents, expected 500`;
    if (balance !== 1000) return `balance ${balance}, expected 1000`;
    const status = await statusOf(u, id);
    return status === 'paid' || `status ${status}`;
  });

  await r.check('P05', 'an amount that is not a whole number of cents is never paid out rounded up', async () => {
    const u = users.round;
    const before = cards();
    const res = await payout(u, 5005);
    const after = await t.balance(u);
    if (!ok(res.status)) return after === 6000 || `refused but balance moved to ${after}`;
    const card = giftly.issued[giftly.issued.length - 1];
    if (cards() !== before + 1) return `${cards() - before} cards issued`;
    return card.amount_cents * 10 <= 6000 - after || `paid ${card.amount_cents} cents for ${6000 - after} coins`;
  });

  await r.check('P06', 'five parallel requests against a balance that covers one: one card, one debit', async () => {
    const u = users.race;
    const before = cards();
    giftly.setMode('slow'); // a provider that takes 300 ms to answer, so a check-then-debit race shows every time
    let results;
    try {
      results = await race(5, (i) => payout(u, 5000, `race-${i}-${uid('k')}`));
    } finally {
      giftly.setMode('ok');
    }
    const balance = await t.balance(u);
    if (cards() - before !== 1) return `${cards() - before} cards issued (answers ${statuses(results)})`;
    return balance === 1000 || `balance ${balance}, expected 1000`;
  });

  await r.check('P07', 'the same Idempotency-Key five times at once and again later is one payout', async () => {
    const u = users.idem;
    const key = uid('idem');
    const before = cards();
    const results = await race(5, () => payout(u, 5000, key));
    const again = await payout(u, 5000, key);
    const ids = new Set([...results, again].filter((x) => ok(x.status)).map(idOf));
    const balance = await t.balance(u);
    if (cards() - before !== 1) return `${cards() - before} cards issued (answers ${statuses(results)})`;
    if (balance !== 15000) return `balance ${balance}, expected 15000`;
    if (!ok(again.status)) return `the repeated request answered ${again.status}`;
    return (ids.size === 1 && !ids.has(null)) || `payout ids in the answers: ${[...ids].join(',')}`;
  });

  await r.check('P08', 'a fourth cash-out within 24 hours is refused', async () => {
    const u = users.count;
    const answers = [];
    for (let i = 0; i < 4; i += 1) answers.push((await payout(u, 5000, uid('count'))).status);
    const balance = await t.balance(u);
    if (!answers.slice(0, 3).every(ok)) return `answers ${answers.join(',')}`;
    if (ok(answers[3])) return `the fourth answered ${answers[3]}`;
    return balance === 15000 || `balance ${balance}, expected 15000`;
  });

  await r.check('P09', 'more than 50,000 coins in 24 hours is refused, also when requested in parallel', async () => {
    const u = users.cap;
    const first = await payout(u, 30000, uid('cap'));
    const second = await payout(u, 25000, uid('cap'));
    if (!ok(first.status) || ok(second.status)) return `answers ${first.status},${second.status}`;
    const v = users.capRace;
    const before = cards();
    const results = await race(2, () => payout(v, 30000, uid('capr')));
    const issued = cards() - before;
    const balance = await t.balance(v);
    return (issued === 1 && balance === 40000) || `parallel: ${issued} cards, balance ${balance} (answers ${statuses(results)})`;
  });

  await r.check('P10', 'a refusal by Giftly fails the payout and returns the coins once', async () => {
    const u = users.decline;
    giftly.setMode('decline');
    const res = await payout(u, 5000, uid('dec'));
    giftly.setMode('ok');
    const payouts = (await list(u)).payouts ?? [];
    const status = payouts[0]?.status;
    await resolve();
    const balance = await t.balance(u);
    if (payouts.length !== 1) return `${payouts.length} payouts listed (answered ${res.status})`;
    if (status !== 'failed') return `status ${status}`;
    return balance === 6000 || `balance ${balance}, expected 6000 after the refusal and a resolve run`;
  });

  const unknownThenResolve = async (u, mode, issuedDuring) => {
    const before = cards();
    giftly.setMode(mode);
    const res = await payout(u, 5000, uid(mode));
    giftly.setMode('ok');
    const during = await t.balance(u);
    const payouts = (await list(u)).payouts ?? [];
    const status = payouts[0]?.status;
    if (during !== 1000) return `balance ${during} while the outcome is unknown, expected 1000 (answered ${res.status})`;
    if (status === 'paid' || status === 'failed') return `status ${status} before anyone knew the outcome`;
    if (cards() - before !== issuedDuring) return `${cards() - before} cards after the first attempt`;
    const resolved = await resolve();
    if (!ok(resolved.status)) return `resolve answered ${resolved.status}`;
    const final = (await list(u)).payouts?.[0]?.status;
    const balance = await t.balance(u);
    if (cards() - before !== 1) return `${cards() - before} cards after resolving, expected exactly 1`;
    if (balance !== 1000) return `balance ${balance} after resolving, expected 1000`;
    return final === 'paid' || `status ${final} after resolving`;
  };

  await r.check('P11', 'Giftly issues the card but the answer is lost: coins stay taken, resolve marks it paid, one card', () =>
    unknownThenResolve(users.lost, 'lost', 1),
  );
  await r.check('P12', 'Giftly answers 500 without issuing: coins stay taken, resolve pays once', () =>
    unknownThenResolve(users.error, 'error', 0),
  );
  await r.check('P13', 'Giftly never answers: the request times out, coins stay taken, resolve pays once', () =>
    unknownThenResolve(users.hang, 'hang', 0),
  );

  await r.check('P14', 'a reversal of offer earnings leaves only bought coins, which cannot be cashed out', async () => {
    const u = users.reversal;
    await t.api(rewardlyUrl(KEY, { user: u, tx: reversedTx, reward: 6000, status: 2 }));
    const before = cards();
    const res = await payout(u, 5000, uid('rev'));
    if (cards() !== before) return `a gift card was issued (answered ${res.status})`;
    return !ok(res.status) || `answered ${res.status}`;
  });

  await r.check('P15', 'GET /api/payouts shows only matured offer earnings as withdrawable', async () => {
    await earn(users.view, 2000); // fresh
    const view = await list(users.view);
    return view.withdrawable === 7000 || `withdrawable ${view.withdrawable}, expected 7000 (7000 matured, 2000 fresh, 3000 bought)`;
  });

  await r.check('P16', 'reconciliation reports no mismatch after all of the above', async () => {
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop, () => giftly.close());
}
