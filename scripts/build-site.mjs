// Assembles the GitHub Pages demo in _site/.
// The attack lab is not a simulation: this script starts playground/vulnerable and playground/fixed,
// sends every attack to both over HTTP and writes down what came back. The audit report on the page
// is examples/coinjar-audit/findings.json, checked here with the validator before it is published.
// Node built-ins only. Run: node scripts/build-site.mjs
import { createHmac } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { score } from '../playground/score.mjs';
import { CLASSES, validate } from '../skills/money-audit/scripts/validate-findings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

const SECRETS = { webhookSecret: 'whsec_test_not_secret', postbackKey: 'test_postback_key_not_secret' };
const FIXED = { ...SECRETS, adminKey: 'test_admin_key_not_secret_0123456789', payoutHoldSeconds: 0 };
const OLD_ADMIN_KEY = 'coinjar-admin';

const CLASS_TITLES = {
  'unverified-events': 'Unverified inbound events',
  'duplicate-credit': 'Duplicate credit',
  'balance-races': 'Races on a balance',
  'client-trust': 'Amounts trusted from the client',
  'money-arithmetic': 'Money arithmetic',
  'refunds-and-reversals': 'Refunds and reversals',
  'promo-and-referral-abuse': 'Promo, trial and referral abuse',
  'payout-controls': 'Payout controls',
  'secrets-and-access': 'Secrets and access on the money path',
  'ledger-and-audit-trail': 'Ledger and audit trail',
};

// A question a reader can put to their own agent about their own code, one per class.
const CLASS_ASKS = {
  'unverified-events': 'Audit our webhook and postback handlers: can any of them be called without a valid signature?',
  'duplicate-credit': 'Check whether any webhook or postback in this project can credit the same event twice.',
  'balance-races': 'Check every place where this project spends or pays out a balance for races under parallel requests.',
  'client-trust': 'Find every amount, price or account id that our server takes from the request instead of its own records.',
  'money-arithmetic': 'Audit how this project stores and rounds money: floats, negative amounts and fractions.',
  'refunds-and-reversals': 'Check what happens to credits when a payment is refunded or a conversion is reversed, also when the message arrives twice.',
  'promo-and-referral-abuse': 'Check whether promo codes, trials and referral bonuses in this project can be farmed with repeated or fake accounts.',
  'payout-controls': 'Audit our payout flow: minimums, daily caps, holds, and what happens when the provider times out.',
  'secrets-and-access': "Check the money paths in this project for secrets with default values and for endpoints that act on another user's account.",
  'ledger-and-audit-trail': 'Check whether every balance change in this project leaves a record that explains it.',
};

const shorten = (text) => String(text).replace(/[0-9a-f]{24,}/g, (hex) => `${hex.slice(0, 8)}...`);
const clip = (text, max = 150) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const maskBody = (text) =>
  clip(shorten(String(text).replace(/"(token|code)":"[^"]*"/g, '"$1":"***"').replace(/\s+/g, ' ').trim()));
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function start(variant, config = {}) {
  const { createApp } = await import(pathToFileURL(join(root, 'playground', variant, 'app.mjs')).href);
  const app = createApp(variant === 'fixed' ? { ...FIXED, ...config } : {});
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  const steps = [];
  let users = 0;

  async function raw(path, { token, body, rawBody, headers = {}, method } = {}) {
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const res = await fetch(base + path, {
      method: method || (payload === undefined ? 'GET' : 'POST'),
      headers: {
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: payload,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, text, json };
  }

  function record(what, path, options, results, mode) {
    const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const statuses = {};
    const samples = [];
    for (const r of results) {
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      const body = clip(maskBody(r.text), 120);
      if (!samples.some((s) => s.status === r.status && s.body === body)) samples.push({ status: r.status, body });
    }
    const shows = [...(options.show || [])];
    if (options.token) shows.unshift(`signed in as ${options.as || 'the user'}`);
    steps.push({
      kind: 'request',
      what,
      line: `${options.method || (payload === undefined ? 'GET' : 'POST')} ${shorten(path)}`,
      shows,
      body: payload === undefined ? null : maskBody(payload),
      n: results.length,
      mode,
      statuses,
      samples: samples.slice(0, 3),
    });
  }

  const t = {
    variant,
    app,
    steps,
    note: (text) => steps.push({ kind: 'note', text }),
    async send(what, path, options = {}) {
      const result = await raw(path, options);
      record(what, path, options, [result], 'once');
      return result;
    },
    async parallel(what, n, path, options = {}) {
      const results = await Promise.all(Array.from({ length: n }, () => raw(path, options)));
      record(what, path, options, results, 'parallel');
      return results;
    },
    async repeat(what, n, path, options = {}) {
      const results = [];
      for (let i = 0; i < n; i += 1) results.push(await raw(path, typeof options === 'function' ? options(i) : options));
      record(what, path, typeof options === 'function' ? options(0) : options, results, 'sequence');
      return results;
    },
    newEmail() {
      users += 1;
      return `user${users}@example.com`;
    },
    async signup(ref) {
      const email = t.newEmail();
      const res = await raw('/api/signup', { body: { email, password: 'correct horse battery', ref } });
      if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${res.text}`);
      return { id: res.json.user_id, token: res.json.token, email };
    },
    balance: async (user) => (await raw('/api/me', { token: user.token })).json.balance,
    refCode: async (user) => (await raw('/api/me', { token: user.token })).json.ref_code,
    postback({ user, tx, reward, status = 1, sign = true, extra = '' }) {
      const hash = createHmac('sha256', SECRETS.postbackKey).update(`${user.id}:${tx}:${reward}:${status}`).digest('hex');
      return `/postback/offerly?user_id=${user.id}&tx=${tx}&reward=${reward}&status=${status}${sign ? `&hash=${hash}` : ''}${extra}`;
    },
    // Setup, not part of the attack: a genuine, correctly signed offer credit.
    async earn(user, reward, tx = `tx-${user.id}-${reward}`) {
      const res = await raw(t.postback({ user, tx, reward }));
      if (res.status !== 200) throw new Error(`setup credit failed: ${res.status} ${res.text}`);
      return tx;
    },
    webhook(type, data, { id = `evt_${type.split('.')[1]}_${data.order_id}`, sign = true } = {}) {
      const rawBody = JSON.stringify({ id, type, data });
      const time = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', SECRETS.webhookSecret).update(`${time}.${rawBody}`).digest('hex');
      return {
        rawBody,
        headers: sign ? { 'paylane-signature': `t=${time},v1=${v1}` } : {},
        show: [sign ? 'paylane-signature: valid, made with the real secret' : 'paylane-signature: not sent'],
      };
    },
    paid: (order, options) =>
      t.webhook('payment.succeeded', { order_id: order.order_id, amount_cents: order.price_cents, currency: 'usd' }, options),
    async order(user, body = { pack: 'small' }, what = 'Create an order for the small coin pack') {
      const res = await t.send(what, '/api/checkout', { token: user.token, body });
      if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${res.text}`);
      return res.json;
    },
    // The first version records dollars as a float, the fixed one whole cents.
    cards: () => app.giftcards.sent.map((card) => ({ cents: card.cents ?? Math.round(card.usd * 100) })),
  };
  return t;
}

const move = (before, after) => (before === after ? `${after} coins, unchanged` : `${before} to ${after} coins`);

// One entry per planted bug in playground/ANSWER-KEY.md. run() performs the attack against whichever
// app it is given and reports what it measured. "lost" must come out true for vulnerable/ and false
// for fixed/, or the build stops.
const ATTACKS = [
  {
    id: 'V01',
    skill: 'build-webhook-endpoint',
    story: 'The attacker creates an order, does not pay, and tells the server it was paid. The message has no signature at all.',
    fixed: { file: 'routes/webhooks.mjs', anchor: "const signature = ctx.req.headers['paylane-signature'];", lines: 4 },
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user);
      const res = await t.send('Report the order as paid, without a signature header', '/webhooks/paylane', t.paid(order, { sign: false }));
      const after = await t.balance(user);
      return {
        lost: after > 0,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'Money received by the app', value: '$0.00' }],
        outcome: after > 0 ? `${after} coins credited for an order nobody paid.` : `Refused with ${res.status}. Nothing was credited.`,
      };
    },
  },
  {
    id: 'V02',
    skill: 'build-webhook-endpoint',
    story: 'The attacker calls the offer postback URL directly, with no hash, and adds debug=1 to the query.',
    fixed: { file: 'routes/postback.mjs', anchor: 'const expected = offerlyHash(', lines: 2 },
    async run(t) {
      const user = await t.signup();
      const path = t.postback({ user, tx: 'forged-1', reward: 100000, sign: false, extra: '&debug=1' });
      const res = await t.send('Send a postback for 100,000 coins with no hash and debug=1', path);
      const after = await t.balance(user);
      return {
        lost: after > 0,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'Offers completed', value: '0' }],
        outcome: after > 0 ? `${after.toLocaleString('en-US')} coins credited for an offer that never happened.` : `Refused with ${res.status}. Nothing was credited.`,
      };
    },
  },
  {
    id: 'V03',
    skill: 'build-webhook-endpoint',
    story: 'A genuine, correctly signed payment event is delivered three times. Providers do this on their own whenever an answer is slow, and anyone who captures one event can replay it.',
    fixed: { file: 'routes/webhooks.mjs', anchor: 'const fresh = ledger.atomic(() => {', lines: 9 },
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user);
      await t.repeat('Deliver the same signed payment.succeeded event three times', 3, '/webhooks/paylane', t.paid(order));
      const after = await t.balance(user);
      return {
        lost: after > order.coins,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'Paid for', value: `${order.coins} coins` }],
        outcome:
          after > order.coins
            ? `One payment, ${after} coins. Every delivery credited the order again.`
            : `Credited once: ${after} coins. The repeats were answered 200 and changed nothing.`,
      };
    },
  },
  {
    id: 'V04',
    skill: 'add-offerwall',
    story: 'One genuine offer postback for 200 coins arrives ten times at the same moment, as it does when a network retries or a user triggers the same click from several tabs.',
    fixed: { file: 'lib/ledger.mjs', anchor: 'const insert = db.prepare(', lines: 4 },
    async run(t) {
      const user = await t.signup();
      await t.parallel('Deliver one signed postback ten times at once', 10, t.postback({ user, tx: 'offer-77', reward: 200 }));
      const after = await t.balance(user);
      return {
        lost: after > 200,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'Earned', value: '200 coins' }],
        outcome: after > 200 ? `One completed offer paid ${after} coins.` : 'Credited once: 200 coins. The other nine were recognized as duplicates.',
      };
    },
  },
  {
    id: 'V05',
    skill: 'build-ledger',
    story: 'A user with 300 coins, the price of one theme, sends ten purchase requests at the same moment.',
    fixed: { file: 'lib/ledger.mjs', anchor: "const take = db.prepare('UPDATE users SET balance = balance - ?", lines: 1 },
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 300);
      t.note('The user has 300 coins: enough for one theme.');
      await t.parallel('Buy the 300-coin theme, ten requests at once', 10, '/api/spend', { token: user.token, body: { item: 'theme' } });
      const delivered = t.app.entitlements.delivered.length;
      const after = await t.balance(user);
      return {
        lost: delivered > 1,
        facts: [{ label: 'Balance', value: move(300, after) }, { label: 'Themes delivered', value: String(delivered) }],
        outcome: delivered > 1 ? `${delivered} themes delivered for the price of one.` : 'One theme delivered. The other nine requests were refused for lack of coins.',
      };
    },
  },
  {
    id: 'V06',
    skill: 'add-payouts',
    story: 'A user with 1,000 coins ($10.00) sends five cash-out requests for the full balance at the same moment.',
    fixed: { file: 'routes/payouts.mjs', anchor: '// The coins leave the balance before the provider is called.', lines: 9 },
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 1000);
      t.note(`The user has 1,000 coins, worth $10.00.${t.variant === 'fixed' ? ' The hold period is switched off for this run, so only the race is tested.' : ''}`);
      await t.parallel('Cash out 1,000 coins, five requests at once', 5, '/api/payouts', { token: user.token, body: { amount: 1000 } });
      const cards = t.cards();
      const cents = cards.reduce((sum, card) => sum + card.cents, 0);
      const after = await t.balance(user);
      return {
        lost: cards.length > 1,
        facts: [{ label: 'Balance', value: move(1000, after) }, { label: 'Gift cards sent', value: `${cards.length} (${dollars(cents)})` }],
        outcome: cards.length > 1 ? `${dollars(cents)} in gift cards paid against a $10.00 balance.` : 'One $10.00 card sent. The other four requests found nothing left to withdraw.',
      };
    },
  },
  {
    id: 'V07',
    skill: 'build-webhook-endpoint',
    story: 'The attacker buys the smallest pack for $4.99 and adds one extra field to the checkout request: the number of coins they would like.',
    fixed: { file: 'routes/checkout.mjs', anchor: 'const name = ctx.body?.pack;', lines: 7 },
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user, { pack: 'small', coins: 1_000_000 }, 'Create an order for the small pack, with coins: 1000000 added');
      await t.send('The payment provider confirms the $4.99 payment', '/webhooks/paylane', t.paid(order));
      const after = await t.balance(user);
      return {
        lost: after > 500,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'Paid', value: '$4.99' }],
        outcome: after > 500 ? `${after.toLocaleString('en-US')} coins for $4.99.` : 'The extra field was ignored: 500 coins for $4.99, as the pack says.',
      };
    },
  },
  {
    id: 'V08',
    skill: 'build-ledger',
    story: 'The attacker sends another user a transfer of minus 400 coins.',
    fixed: { file: 'lib/http.mjs', anchor: 'export const wholeCoins', lines: 1 },
    async run(t) {
      const thief = await t.signup();
      const victim = await t.signup();
      await t.earn(victim, 500);
      t.note('The attacker has 0 coins. The other user has 500.');
      const res = await t.send('Transfer -400 coins to the other user', '/api/transfer', {
        token: thief.token,
        as: 'the attacker',
        body: { to: victim.email, amount: -400 },
      });
      const mine = await t.balance(thief);
      const theirs = await t.balance(victim);
      return {
        lost: mine > 0,
        facts: [{ label: 'Attacker', value: move(0, mine) }, { label: 'Other user', value: move(500, theirs) }],
        outcome: mine > 0 ? `${mine} coins pulled out of an account the attacker does not own.` : `Refused with ${res.status}. Amounts must be whole numbers above zero.`,
      };
    },
  },
  {
    id: 'V09',
    skill: 'build-ledger',
    story: 'A user asks to cash out half a coin. Half a coin is worth half a cent, and gift cards come in whole cents.',
    fixed: { file: 'routes/payouts.mjs', anchor: 'const coins = wholeCoins(ctx.body?.amount', lines: 4 },
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 1000);
      t.note(`The user has 1,000 coins.${t.variant === 'fixed' ? ' The hold period is switched off for this run.' : ''}`);
      const res = await t.send('Cash out 0.5 coins', '/api/payouts', { token: user.token, body: { amount: 0.5 } });
      const cards = t.cards();
      const after = await t.balance(user);
      return {
        lost: res.status === 200,
        facts: [{ label: 'Balance', value: move(1000, after) }, { label: 'Gift cards sent', value: cards.length ? `${cards.length} (${dollars(cards[0].cents)})` : '0' }],
        outcome: res.status === 200 ? 'Half a cent of coins became a whole cent of gift card. Repeated, it doubles the value of every coin.' : `Refused with ${res.status}. Coins are whole numbers everywhere.`,
      };
    },
  },
  {
    id: 'V10',
    skill: 'handle-refunds-and-reversals',
    story: 'A user buys a coin pack and then gets the payment refunded. The provider reports both events, correctly signed.',
    fixed: { file: 'routes/webhooks.mjs', anchor: "'payment.refunded'(data) {", lines: 18 },
    async run(t) {
      const user = await t.signup();
      const order = await t.order(user);
      await t.send('The provider confirms the payment', '/webhooks/paylane', t.paid(order));
      await t.send('The provider reports the refund', '/webhooks/paylane', t.webhook('payment.refunded', { order_id: order.order_id }));
      const after = await t.balance(user);
      return {
        lost: after > 0,
        facts: [{ label: 'Balance after the refund', value: `${after} coins` }, { label: 'Money kept by the app', value: '$0.00' }],
        outcome: after > 0 ? `The money went back and ${after} coins stayed.` : 'The refund took back the 500 coins the order had granted.',
      };
    },
  },
  {
    id: 'V11',
    skill: 'handle-refunds-and-reversals',
    story: 'An advertiser takes back a 200-coin conversion. The offer network delivers the reversal twice.',
    fixed: { file: 'routes/postback.mjs', anchor: 'const takeBack = () => {', lines: 13 },
    async run(t) {
      const user = await t.signup();
      const tx = await t.earn(user, 200);
      t.note('The user earned 200 coins from one offer.');
      await t.repeat('Deliver the signed reversal for that offer twice', 2, t.postback({ user, tx, reward: 200, status: 2 }));
      const after = await t.balance(user);
      return {
        lost: after < 0,
        facts: [{ label: 'Balance', value: move(200, after) }, { label: 'Owed back', value: '200 coins' }],
        outcome: after < 0 ? `Charged twice: the user now owes ${-after} coins they never had.` : 'Taken back once. The second delivery was recognized as a duplicate.',
      };
    },
  },
  {
    id: 'V12',
    skill: 'guard-signups',
    story: 'One account redeems the WELCOME100 promo code five times in a row.',
    fixed: { file: 'routes/promo.mjs', anchor: 'const posted = ledger.entry({', lines: 7 },
    async run(t) {
      const user = await t.signup();
      await t.repeat('Redeem WELCOME100 five times', 5, '/api/promo', { token: user.token, body: { code: 'WELCOME100' } });
      const after = await t.balance(user);
      return {
        lost: after > 100,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'The code is worth', value: '100 coins, once' }],
        outcome: after > 100 ? `${after} coins from a 100-coin code. A script makes it any number.` : 'Redeemed once. The other four attempts were refused.',
      };
    },
  },
  {
    id: 'V13',
    skill: 'add-referral-program',
    story: 'The attacker registers three empty accounts with made-up email addresses, each with their own referral code.',
    fixed: { file: 'lib/referrals.mjs', anchor: 'const verified = ledger.sum(', lines: 5 },
    async run(t) {
      const farmer = await t.signup();
      const code = await t.refCode(farmer);
      await t.repeat('Sign up three new accounts with the referral code', 3, '/api/signup', () => ({
        body: { email: t.newEmail(), password: 'correct horse battery', ref: code },
        show: ['a new made-up email address each time'],
      }));
      const after = await t.balance(farmer);
      return {
        lost: after > 0,
        facts: [{ label: 'Referrer balance', value: move(0, after) }, { label: 'Earned or bought by the new accounts', value: '0 coins' }],
        outcome: after > 0 ? `${after} coins for three accounts that did nothing.` : 'No bonus. It is paid once the invited user has earned or bought 500 coins through verified events.',
      };
    },
  },
  {
    id: 'V14',
    skill: 'add-payouts',
    fixedConfig: { payoutHoldSeconds: 7 * 24 * 3600 },
    story: 'A user completes an offer for 600 coins and cashes out one second later. Offer conversions can still be reversed for days or weeks.',
    fixed: { file: 'routes/payouts.mjs', anchor: 'function withdrawable(userId, balance) {', lines: 6 },
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 600);
      t.note('The user earned 600 coins from an offer a moment ago.');
      const res = await t.send('Cash out 600 coins at once', '/api/payouts', { token: user.token, body: { amount: 600 } });
      const cards = t.cards();
      const after = await t.balance(user);
      return {
        lost: res.status === 200,
        facts: [{ label: 'Balance', value: move(600, after) }, { label: 'Gift cards sent', value: cards.length ? `${cards.length} (${dollars(cards[0].cents)})` : '0' }],
        outcome: res.status === 200 ? 'Paid out before the conversion could be confirmed. A reversal tomorrow has nothing left to take back.' : `Refused with ${res.status}: not withdrawable yet. Offer earnings are held for seven days.`,
      };
    },
  },
  {
    id: 'V15',
    skill: 'money-audit',
    story: 'The attacker opens a script that the support page loads in every visitor\'s browser, reads the admin key from it, and grants themselves coins.',
    fixed: { file: 'routes/admin.mjs', anchor: 'if (!config.adminKey) return;', lines: 3 },
    async run(t) {
      const user = await t.signup();
      const script = await t.send('Fetch the public support script', '/public/admin.js');
      const found = /ADMIN_KEY = '([^']+)'/.exec(script.text)?.[1];
      if (!found) t.note('No key in any public file. The attacker tries the key the first version shipped with.');
      const key = found || OLD_ADMIN_KEY;
      const res = await t.send('Grant 5,000 coins with that key', '/admin/grant', {
        headers: { 'x-admin-key': key },
        show: [`x-admin-key: ${key}`],
        body: { user_id: user.id, amount: 5000 },
      });
      const after = await t.balance(user);
      return {
        lost: after > 0,
        facts: [{ label: 'Balance', value: move(0, after) }, { label: 'Key found in a public file', value: found ? 'yes' : 'no' }],
        outcome: after > 0 ? `${after.toLocaleString('en-US')} coins granted by a visitor with no account rights.` : `Refused with ${res.status}. The key has no default and is in no file a browser can load.`,
      };
    },
  },
  {
    id: 'V16',
    skill: 'build-ledger',
    story: 'The attacker sends a transfer to themselves and adds a "from" field that names another user\'s account.',
    fixed: { file: 'routes/wallet.mjs', anchor: "ledger.entry({ userId: ctx.user.id, amount: -coins, kind: 'transfer_out'", lines: 2 },
    async run(t) {
      const thief = await t.signup();
      const victim = await t.signup();
      await t.earn(victim, 500);
      t.note('The attacker has 0 coins. The other user has 500.');
      const res = await t.send('Transfer 500 coins to yourself, from the other account', '/api/transfer', {
        token: thief.token,
        as: 'the attacker',
        body: { from: victim.id, to: thief.email, amount: 500 },
      });
      const mine = await t.balance(thief);
      const theirs = await t.balance(victim);
      return {
        lost: mine > 0,
        facts: [{ label: 'Attacker', value: move(0, mine) }, { label: 'Other user', value: move(500, theirs) }],
        outcome: mine > 0 ? 'The whole balance of another user moved to the attacker.' : `Refused with ${res.status}. The sender is always the signed-in user, so this was a transfer to oneself.`,
      };
    },
  },
  {
    id: 'V17',
    skill: 'build-ledger',
    story: 'No attacker this time. A user earns 300 coins, redeems a 100-coin promo code and buys a 100-coin avatar. Then support is asked: why is this balance what it is?',
    fixed: { file: 'lib/ledger.mjs', anchor: 'mismatches() {', lines: 8 },
    async run(t) {
      const user = await t.signup();
      await t.earn(user, 300);
      t.note('The user earned 300 coins from an offer.');
      await t.send('Redeem a 100-coin promo code', '/api/promo', { token: user.token, body: { code: 'WELCOME100' } });
      await t.send('Buy a 100-coin avatar', '/api/spend', { token: user.token, body: { item: 'avatar' } });
      const balance = await t.balance(user);
      let recorded;
      if (t.app.ledger) {
        recorded = t.app.db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE user_id = ?').get(user.id).total;
      } else {
        const one = (sql) => t.app.db.prepare(sql).get(user.id).total;
        recorded =
          one('SELECT COALESCE(SUM(CASE status WHEN 1 THEN reward ELSE -reward END), 0) AS total FROM transactions WHERE user_id = ?') -
          one('SELECT COALESCE(SUM(price), 0) AS total FROM purchases WHERE user_id = ?');
      }
      const key = t.variant === 'fixed' ? FIXED.adminKey : OLD_ADMIN_KEY;
      await t.send('Ask the app to compare every balance with its records', '/admin/reconcile', {
        headers: { 'x-admin-key': key },
        show: ['x-admin-key: the staff key'],
      });
      return {
        lost: recorded !== balance,
        facts: [{ label: 'Balance', value: `${balance} coins` }, { label: 'Sum of the stored records', value: `${recorded} coins` }],
        outcome:
          recorded !== balance
            ? `The records explain ${recorded} of ${balance} coins. Nothing says where the rest came from, and no check exists that would notice.`
            : 'Every coin is a ledger row. The balance equals the sum of its entries, and the app can prove it on request.',
      };
    },
  },
];

// --- answer key and code excerpts

const key = JSON.parse(read('playground', 'answers.json'));
const keyRows = new Map();
for (const line of read('playground', 'ANSWER-KEY.md').split('\n')) {
  const cells = line.split('|').map((cell) => cell.trim());
  if (/^V\d\d$/.test(cells[1] || '')) keyRows.set(cells[1], { wrong: cells[4], fix: cells[5] });
}

function excerpt(variant, file, from, to, mark) {
  const lines = read('playground', variant, file).split('\n').slice(from - 1, to);
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return { file, from, mark: mark ?? null, lines: lines.map((l) => l.slice(indent)) };
}

function fixedExcerpt({ file, anchor, lines }) {
  const all = read('playground', 'fixed', file).split('\n');
  const at = all.findIndex((line) => line.includes(anchor));
  if (at < 0) throw new Error(`fixed/${file}: anchor not found: ${anchor}`);
  return excerpt('fixed', file, at + 1, at + lines);
}

function vulnerableExcerpt(bug) {
  const loc = bug.locations.find((l) => l.file !== '*') ?? { file: 'db.mjs', from: 4, to: 12 };
  const to = Math.min(loc.to, loc.from + 13);
  const where = /`([\w/.]+):(\d+)`/.exec(keyRows.get(bug.id).whereCell || '');
  const mark = where && where[1] === loc.file && Number(where[2]) >= loc.from && Number(where[2]) <= to ? Number(where[2]) : null;
  return excerpt('vulnerable', loc.file, loc.from, to, mark);
}
for (const line of read('playground', 'ANSWER-KEY.md').split('\n')) {
  const cells = line.split('|').map((cell) => cell.trim());
  if (keyRows.has(cells[1])) keyRows.get(cells[1]).whereCell = cells[3];
}

// --- the audit report

const report = JSON.parse(read('examples', 'coinjar-audit', 'findings.json'));
const scratch = mkdtempSync(join(tmpdir(), 'coinjar-audit-'));
try {
  cpSync(join(root, 'playground', 'vulnerable'), scratch, { recursive: true });
  cpSync(join(root, 'examples', 'coinjar-audit'), join(scratch, 'money-audit'), { recursive: true });
  const { errors } = validate(report, scratch);
  if (errors.length) throw new Error(`examples/coinjar-audit/findings.json is not valid:\n${errors.join('\n')}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const scored = score(report, key);
if (scored.missed.length) throw new Error(`the example audit misses planted bugs: ${scored.missed.map((b) => b.id).join(', ')}`);
const foundBy = new Map(scored.found.map((entry) => [entry.id, [entry.by, ...entry.related]]));

// --- run every attack against both apps

const attacks = [];
for (const attack of ATTACKS) {
  const bug = key.bugs.find((b) => b.id === attack.id);
  const runs = {};
  for (const variant of ['vulnerable', 'fixed']) {
    const t = await start(variant, attack.fixedConfig);
    try {
      const result = await attack.run(t);
      runs[variant] = { ...result, steps: t.steps };
    } finally {
      await t.app.close();
    }
  }
  if (runs.vulnerable.lost !== true) throw new Error(`${attack.id}: the attack did not work against vulnerable/`);
  if (runs.fixed.lost !== false) throw new Error(`${attack.id}: the attack worked against fixed/`);
  attacks.push({
    id: attack.id,
    class: bug.classes[0],
    title: bug.title,
    story: attack.story,
    wrong: keyRows.get(attack.id).wrong,
    fix: keyRows.get(attack.id).fix.replaceAll('`', ''),
    skill: attack.skill,
    ask: CLASS_ASKS[bug.classes[0]],
    findings: foundBy.get(attack.id) || [],
    code: { vulnerable: vulnerableExcerpt(bug), fixed: fixedExcerpt(attack.fixed) },
    runs,
  });
}
if (attacks.length !== key.bugs.length) throw new Error('every planted bug needs an attack');

// --- skills

const skills = readdirSync(join(root, 'skills'))
  .sort()
  .map((name) => {
    const text = read('skills', name, 'SKILL.md');
    const description = /^description: (.*)$/m.exec(text)[1].trim();
    const cut = description.indexOf(' Use when ');
    return {
      name,
      does: (cut > 0 ? description.slice(0, cut) : description).split(/(?<=\.)\s/)[0],
      when: cut > 0 ? description.slice(cut + 1) : '',
    };
  });

// --- write the site

const counts = Object.fromEntries(['critical', 'high', 'medium', 'low'].map((s) => [s, report.findings.filter((f) => f.severity === s).length]));
const live = report.findings.filter((f) => f.proof.kind !== 'trace').length;
const data = {
  built: {
    date: new Date().toISOString().slice(0, 10),
    commit: (process.env.GITHUB_SHA || '').slice(0, 7),
    node: process.version,
  },
  classes: CLASSES.map((id) => ({ id, title: CLASS_TITLES[id] })),
  attacks,
  report: {
    project: report.project,
    date: report.date,
    environment: report.environment,
    findings: report.findings,
    coverage: report.coverage,
    notes: report.notes || [],
    counts,
    live,
    planted: scored.planted,
    found: scored.found.length,
    onTarget: scored.onTarget,
    extra: scored.extra,
  },
  skills,
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of readdirSync(join(root, 'site')).sort()) {
  if (name === 'index.html') continue;
  cpSync(join(root, 'site', name), join(out, name), { recursive: true });
}
writeFileSync(join(out, 'data.json'), JSON.stringify(data));

const fill = {
  ATTACKS: attacks.length,
  FINDINGS: report.findings.length,
  CRITICAL: counts.critical,
  LIVE: live,
  PLANTED: scored.planted,
  FOUND: scored.found.length,
  ON_TARGET: scored.onTarget,
  SKILLS: skills.length,
  BUILDERS: skills.length - 1,
  CLASSES: CLASSES.length,
  AUDIT_DATE: report.date,
  BUILT: data.built.date,
  NODE: data.built.node,
  COMMIT: data.built.commit || 'local build',
};
let html = read('site', 'index.html');
for (const [name, value] of Object.entries(fill)) html = html.replaceAll(`{{${name}}}`, String(value));
const left = html.match(/\{\{[A-Z_]+\}\}/g);
if (left) throw new Error(`site/index.html: unknown placeholders ${[...new Set(left)].join(', ')}`);
writeFileSync(join(out, 'index.html'), html);

console.log(
  `_site built: ${attacks.length} attacks recorded against both apps, ${plural(report.findings.length, 'finding')} in the report, ${skills.length} skills`,
);
