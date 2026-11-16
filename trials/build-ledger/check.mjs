#!/usr/bin/env node
// Checker for the build-ledger trial: every coin movement on a ledger, history, grants, reconciliation.
//   node check.mjs <folder>
import path from 'node:path';
import { createGiftly } from '../lib/fake-giftly.mjs';
import { client, is4xx, notStarted, ok, race, report, rewardlyUrl, runDir, startTrialApp, statuses, stripeEvent, targetFolder, trialSecret, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = trialSecret('whsec_');
const KEY = trialSecret('rewardly_');
const ADMIN = trialSecret('admin_');
const dbPath = path.join(runDir(), 'coinbarn.db');
const giftly = createGiftly();
const giftlyPort = await giftly.listen();
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  REWARDLY_POSTBACK_KEY: KEY,
  ADMIN_KEY: ADMIN,
  GIFTLY_API_URL: `http://127.0.0.1:${giftlyPort}`,
  GIFTLY_API_KEY: 'giftly_trial_key',
  PAYOUT_HOLD_SECONDS: '0',
  DB_PATH: dbPath,
};
const r = report('build-ledger');
const app = await startTrialApp(folder, ENV);

if (!app.started) {
  r.skipAll([['L00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop, () => giftly.close());
} else {
  const t = client(app.base);
  const admin = { 'x-admin-key': ADMIN };
  const earn = async (user, reward, tx = uid('tx')) => {
    const res = await t.api(rewardlyUrl(KEY, { user, tx, reward }));
    if (!ok(res.status)) throw new Error(`postback answered ${res.status}`);
    return tx;
  };
  const paidEvent = (order) =>
    stripeEvent(app.base, SECRET, 'checkout.session.completed', {
      id: `cs_${order.order_id}`,
      object: 'checkout.session',
      client_reference_id: order.order_id,
      payment_intent: `pi_${order.order_id}`,
      payment_status: 'paid',
      amount_total: order.price_cents,
      currency: 'usd',
      metadata: { order_id: order.order_id },
    });
  const order = async (user, pack = 'small') => (await t.api('/api/checkout', { token: user.token, body: { pack } })).json;
  const history = async (user) => {
    const res = await t.api('/api/history', { token: user.token });
    if (res.status !== 200 || !Array.isArray(res.json?.entries)) throw new Error(`GET /api/history answered ${res.status} ${res.text.slice(0, 80)}`);
    return res.json.entries;
  };
  const sum = (entries) => entries.reduce((total, e) => total + Number(e.amount), 0);
  // The history explains the balance: signed amounts add up to it.
  const explained = async (user, what) => {
    const entries = await history(user);
    const balance = await t.balance(user);
    return sum(entries) === balance || `${what}: history adds up to ${sum(entries)}, balance is ${balance}`;
  };
  const grant = (body) => t.api('/admin/grant', { headers: admin, body });
  const reconcile = async () => {
    const res = await t.api('/admin/reconcile', { headers: admin });
    if (res.status !== 200 || !Array.isArray(res.json?.mismatches)) throw new Error(`GET /admin/reconcile answered ${res.status} ${res.text.slice(0, 80)}`);
    return res.json.mismatches;
  };

  await r.check('L01', 'every money path leaves history entries, named by cause, that add up to the balance, newest first', async () => {
    const a = await t.signup();
    const b = await t.signup({ ref: (await t.me(a)).ref_code });
    await t.send(paidEvent(await order(a)));
    await earn(a, 600);
    await t.api('/api/promo', { token: a.token, body: { code: 'WELCOME100' } });
    await t.api('/api/spend', { token: a.token, body: { item: 'avatar' } });
    await t.api('/api/transfer', { token: a.token, body: { to: b.email, amount: 50 } });
    const cash = await t.api('/api/payouts', { token: a.token, body: { amount: 500 } });
    if (!ok(cash.status)) return `setup payout answered ${cash.status}`;
    await earn(b, 600); // qualifies a for the referral bonus
    await grant({ user_id: a.id, amount: 25, reason: 'goodwill after a support ticket', request_id: uid('req') });
    const entries = await history(a);
    if (entries.length < 8) return `${entries.length} history entries for 8 coin movements`;
    const times = entries.map((e) => (typeof e.created_at === 'number' ? e.created_at : Date.parse(e.created_at)));
    if (times.some((x, i) => i > 0 && x > times[i - 1])) return 'history is not newest first';
    const kinds = new Set(entries.map((e) => e.kind));
    if (kinds.size < 6) return `only ${kinds.size} distinct kinds for 8 different causes: ${[...kinds].join(',')}`;
    const first = await explained(a, 'user a');
    return first === true ? explained(b, 'user b') : first;
  });

  await r.check('L02', 'a payment event delivered three times and ten times at once credits once', async () => {
    const user = await t.signup();
    const request = paidEvent(await order(user));
    await race(10, () => t.send(request));
    for (let i = 0; i < 3; i += 1) await t.send(request);
    const balance = await t.balance(user);
    if (balance !== 500) return `balance ${balance}`;
    return explained(user, 'after repeated deliveries');
  });

  await r.check('L03', 'a postback sent ten times at once credits once', async () => {
    const user = await t.signup();
    const url = rewardlyUrl(KEY, { user, tx: uid('race'), reward: 200 });
    await race(10, () => t.api(url));
    const balance = await t.balance(user);
    if (balance !== 200) return `balance ${balance}`;
    return explained(user, 'after a postback race');
  });

  await r.check('L04', 'ten parallel purchases against a balance that covers two: two succeed, the balance never goes below zero', async () => {
    const user = await t.signup();
    await earn(user, 300);
    const results = await race(10, () => t.api('/api/spend', { token: user.token, body: { item: 'boost' } }));
    const wins = results.filter((x) => ok(x.status)).length;
    const balance = await t.balance(user);
    if (wins !== 2 || balance !== 0) return `${wins} purchases succeeded, balance ${balance} (answers ${statuses(results)})`;
    return explained(user, 'after the spend race');
  });

  await r.check('L05', 'ten parallel transfers against a balance that covers five: five succeed, no overdraw', async () => {
    const sender = await t.signup();
    const receiver = await t.signup();
    await earn(sender, 500);
    const results = await race(10, () => t.api('/api/transfer', { token: sender.token, body: { to: receiver.email, amount: 100 } }));
    const s = await t.balance(sender);
    const rcv = await t.balance(receiver);
    if (s !== 0 || rcv !== 500) return `sender ${s}, receiver ${rcv} (answers ${statuses(results)})`;
    const a = await explained(sender, 'sender');
    return a === true ? explained(receiver, 'receiver') : a;
  });

  await r.check('L06', 'zero, negative, fractional, string and too large amounts are refused and leave no entry', async () => {
    const user = await t.signup();
    const other = await t.signup();
    await earn(user, 500);
    for (const amount of [0, -400, 1.5, '100', 10_001]) {
      const res = await t.api('/api/transfer', { token: user.token, body: { to: other.email, amount } });
      if (ok(res.status)) return `transfer of ${JSON.stringify(amount)} answered ${res.status}`;
    }
    for (const amount of [0, 1.5, 'x', 100_001]) {
      const res = await grant({ user_id: user.id, amount, reason: 'test of a bad amount', request_id: uid('req') });
      if (ok(res.status)) return `grant of ${JSON.stringify(amount)} answered ${res.status}`;
    }
    const entries = await history(user);
    if (entries.length !== 1 || (await t.balance(user)) !== 500) return `${entries.length} entries, balance ${await t.balance(user)}`;
    return (await history(other)).length === 0 || 'the other user has entries';
  });

  await r.check('L07', 'a debit larger than the balance is refused and leaves no entry', async () => {
    const user = await t.signup();
    await earn(user, 100);
    const res = await t.api('/api/spend', { token: user.token, body: { item: 'theme' } });
    const entries = await history(user);
    if (ok(res.status)) return `answered ${res.status}`;
    return (entries.length === 1 && (await t.balance(user)) === 100) || `${entries.length} entries after a refused spend`;
  });

  await r.check('L08', 'only a reversal can make a balance negative; spending and transfers are then refused', async () => {
    const user = await t.signup();
    const other = await t.signup();
    const tx = await earn(user, 300);
    await t.api('/api/spend', { token: user.token, body: { item: 'theme' } });
    await t.api(rewardlyUrl(KEY, { user, tx, reward: 300, status: 2 }));
    await t.api(rewardlyUrl(KEY, { user, tx, reward: 300, status: 2 }));
    const balance = await t.balance(user);
    if (balance !== -300) return `balance ${balance} after the reversal, expected -300`;
    const spend = await t.api('/api/spend', { token: user.token, body: { item: 'avatar' } });
    const send = await t.api('/api/transfer', { token: user.token, body: { to: other.email, amount: 1 } });
    if (ok(spend.status) || ok(send.status)) return `spend ${spend.status}, transfer ${send.status}`;
    return explained(user, 'after the reversal');
  });

  await r.check('L09', 'a cash-out the provider refuses gives the coins back once, with the history explaining it', async () => {
    const user = await t.signup();
    await earn(user, 600);
    giftly.setMode('decline');
    await t.api('/api/payouts', { token: user.token, body: { amount: 500 } });
    giftly.setMode('ok');
    await t.api('/admin/payouts/resolve', { method: 'POST', headers: admin });
    const balance = await t.balance(user);
    if (balance !== 600) return `balance ${balance}, expected 600`;
    return explained(user, 'after the refused cash-out');
  });

  await r.check('L10', 'a support grant needs a reason and a request_id, and a repeated request_id grants once', async () => {
    const user = await t.signup();
    const noReason = await grant({ user_id: user.id, amount: 100, request_id: uid('req') });
    const noId = await grant({ user_id: user.id, amount: 100, reason: 'missing coins after a crash' });
    if (ok(noReason.status) || ok(noId.status)) return `without reason ${noReason.status}, without request_id ${noId.status}`;
    const body = { user_id: user.id, amount: 100, reason: 'missing coins after a crash', request_id: uid('req') };
    const first = await grant(body);
    await grant(body);
    const balance = await t.balance(user);
    if (!ok(first.status)) return `the valid grant answered ${first.status}`;
    if (balance !== 100) return `balance ${balance}, expected 100`;
    return explained(user, 'after the grants');
  });

  await r.check('L11', 'history is per user and reading it changes nothing', async () => {
    const user = await t.signup();
    await earn(user, 70);
    const one = await history(user);
    const two = await history(user);
    const guest = await t.api('/api/history');
    if (!is4xx(guest.status)) return `a guest got ${guest.status}`;
    return (one.length === 1 && two.length === 1 && (await t.balance(user)) === 70) || `entries ${one.length}/${two.length}`;
  });

  await r.check('L12', 'reconciliation is clean, and catches a balance edited directly in the database', async () => {
    const before = await reconcile();
    if (before.length) return `mismatches before tampering: ${JSON.stringify(before).slice(0, 200)}`;
    const victim = await t.signup();
    await earn(victim, 40);
    process.removeAllListeners('warning');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('UPDATE users SET balance = balance + 7 WHERE id = ?').run(victim.id);
    db.close();
    const after = await reconcile();
    const ids = after.map((m) => Number(m.user_id ?? m.userId ?? m.id));
    return (ids.includes(Number(victim.id)) && after.length === 1) || `mismatches after tampering: ${JSON.stringify(after).slice(0, 200)}`;
  });

  await r.finish(app.stop, () => giftly.close());
}
