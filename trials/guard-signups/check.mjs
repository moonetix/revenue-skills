#!/usr/bin/env node
// Checker for the guard-signups trial: welcome bonus, duplicate and throwaway sign-ups, promo codes.
//   node check.mjs <folder>
//   TRIAL_EXTRA_ENV="SIGNUP_KEY_SECRET=<value>" node check.mjs <folder>
// The second form is for an app that added a required setting of its own (a keyed-hash secret,
// for example): the checker first tries the task's environment and reports the result apart.
import { client, is4xx, notStarted, ok, race, report, rewardlyUrl, RUN_ID, startTrialApp, statuses, targetFolder, trialSecret, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = trialSecret('whsec_');
const KEY = trialSecret('rewardly_');
const ADMIN = trialSecret('admin_');
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, REWARDLY_POSTBACK_KEY: KEY, ADMIN_KEY: ADMIN };
const r = report('guard-signups');
const app = await startTrialApp(folder, ENV);

if (!app.started) {
  r.skipAll([['G00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop);
} else {
  const t = client(app.base);
  let host = 10;
  const homeIp = () => {
    host += 1;
    return `81.2.${Math.floor(host / 250) + 60}.${(host % 250) + 1}`;
  };
  const CLOUD_IP = '3.5.140.77';
  const signupRaw = (email, ip = homeIp(), extra = {}) =>
    t.api('/api/signup', { body: { email, password: 'correct horse battery', ...extra }, headers: { 'x-forwarded-for': ip } });
  const signup = async (email = t.nextEmail(), ip) => {
    const res = await signupRaw(email, ip);
    if (!ok(res.status)) throw new Error(`sign-up of ${email} answered ${res.status} ${res.text.slice(0, 100)}`);
    return { id: res.json.user_id, token: res.json.token, email };
  };
  const login = (email) => t.api('/api/login', { body: { email, password: 'correct horse battery' } });
  const promo = (user, code, extra = {}) => t.api('/api/promo', { token: user.token, body: { code, ...extra } });
  const earn = (user, reward) => t.api(rewardlyUrl(KEY, { user, tx: uid('tx'), reward }));
  const hintOnly = (res) => !/score|threshold|points|\.txt|mailinator/i.test(res.text);

  await r.check('G01', 'Gmail dot, plus and googlemail variants of an existing address are refused as duplicates', async () => {
    await signup(`jane.doe.${RUN_ID}@gmail.com`);
    const plus = await signupRaw(`janedoe${RUN_ID}+1@gmail.com`);
    const dots = await signupRaw(`J.A.N.E.D.O.E.${RUN_ID}@googlemail.com`);
    if (!is4xx(plus.status) || !is4xx(dots.status)) return `answers ${plus.status}, ${dots.status}`;
    const logins = [await login(`janedoe${RUN_ID}+1@gmail.com`), await login(`J.A.N.E.D.O.E.${RUN_ID}@googlemail.com`)];
    return logins.every((x) => !ok(x.status)) || 'a duplicate account exists';
  });

  await r.check('G02', 'an Outlook plus tag and a custom-domain dot stay separate people', async () => {
    const answers = [
      await signupRaw(`erin${RUN_ID}@outlook.com`),
      await signupRaw(`erin${RUN_ID}+tag@outlook.com`),
      await signupRaw(`first.last${RUN_ID}@example.org`),
      await signupRaw(`firstlast${RUN_ID}@example.org`),
    ];
    return answers.every((x) => ok(x.status)) || `answers ${statuses(answers)}`;
  });

  await r.check('G03', 'throwaway addresses, also on subdomains, are refused with a hint only and leave no account', async () => {
    for (const email of [`x${RUN_ID}@mailinator.com`, `y${RUN_ID}@eu.mailinator.com`, `z${RUN_ID}@YOPMAIL.com`]) {
      const res = await signupRaw(email);
      if (!is4xx(res.status)) return `${email} answered ${res.status}`;
      if (!hintOnly(res)) return `the refusal reveals the rule: ${res.text.slice(0, 120)}`;
      if (ok((await login(email)).status)) return `${email} can sign in`;
    }
    return true;
  });

  await r.check('G04', 'malformed addresses are refused', async () => {
    for (const email of ['kim@@example.org', 'kim@example', `+tag${RUN_ID}@gmail.com`]) {
      const res = await signupRaw(email);
      if (!is4xx(res.status)) return `${email} answered ${res.status}`;
    }
    return true;
  });

  await r.check('G05', 'a clean sign-up gets the 100-coin welcome bonus, once', async () => {
    const user = await signup();
    const balance = await t.balance(user);
    return balance === 100 || `balance ${balance}`;
  });

  await r.check('G06', 'a sign-up from a cloud address gets a working account with the bonus held', async () => {
    const user = await signup(t.nextEmail('dc'), CLOUD_IP);
    const me = await t.api('/api/me', { token: user.token });
    if (me.status !== 200) return `GET /api/me answered ${me.status}`;
    return me.json.balance === 0 || `balance ${me.json.balance}, expected 0 while held`;
  });

  await r.check('G07', 'the held bonus is released by the first earning, once', async () => {
    const user = await signup(t.nextEmail('dc'), CLOUD_IP);
    await earn(user, 50);
    await earn(user, 50);
    const balance = await t.balance(user);
    return balance === 200 || `balance ${balance}, expected 200 (100 earned + 100 bonus)`;
  });

  await r.check('G08', 'the client address is the rightmost one the proxy added, not one the client wrote', async () => {
    const user = await signup(t.nextEmail('spoof'), `81.2.1.9, ${CLOUD_IP}`);
    const balance = await t.balance(user);
    return balance === 0 || `balance ${balance}: the cloud address the proxy added was not treated as suspicious (leftmost entry trusted, or no address check)`;
  });

  await r.check('G09', 'twelve sign-ups with different emails from one home address are all created', async () => {
    const answers = [];
    for (let i = 0; i < 12; i += 1) answers.push(await signupRaw(t.nextEmail('house'), '81.200.1.1'));
    return answers.every((x) => ok(x.status)) || `answers ${statuses(answers)}`;
  });

  await r.check('G10', 'the same email eight times gives one account', async () => {
    const email = t.nextEmail('again');
    const answers = [];
    for (let i = 0; i < 8; i += 1) answers.push((await signupRaw(email)).status);
    return (ok(answers[0]) && answers.slice(1).every(is4xx)) || `answers ${answers.join(',')}`;
  });

  await r.check('G11', 'a promo code works once per account, in sequence and at the same moment; the amount comes from the code', async () => {
    const user = await signup();
    const start = await t.balance(user);
    for (let i = 0; i < 3; i += 1) await promo(user, 'WELCOME100', { coins: 99999, amount: 99999 });
    const seq = (await t.balance(user)) - start;
    const other = await signup();
    const otherStart = await t.balance(other);
    const results = await race(10, () => promo(other, 'WELCOME100'));
    const par = (await t.balance(other)) - otherStart;
    if (seq !== 100) return `three redemptions added ${seq}`;
    return par === 100 || `ten parallel redemptions added ${par} (answers ${statuses(results)})`;
  });

  await r.check('G12', 'a code capped at 5 is redeemed exactly 5 times by 7 accounts at once', async () => {
    const users = [];
    for (let i = 0; i < 7; i += 1) users.push(await signup());
    const starts = [];
    for (const u of users) starts.push(await t.balance(u));
    const results = await race(7, (i) => promo(users[i], 'LAUNCH5'));
    let added = 0;
    for (const [i, u] of users.entries()) added += (await t.balance(u)) - starts[i];
    return added === 1250 || `added ${added} coins in total, expected 1250 (answers ${statuses(results)})`;
  });

  await r.check('G13', 'an unknown code is refused', async () => {
    const user = await signup();
    const before = await t.balance(user);
    const res = await promo(user, 'FREE1000');
    return (is4xx(res.status) && (await t.balance(user)) === before) || `answered ${res.status}`;
  });

  await r.check('G14', 'reconciliation reports no mismatch after all of the above', async () => {
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop);
}
