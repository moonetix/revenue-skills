#!/usr/bin/env node
// Checker for the add-usage-credits trial: the assistant charges coins by reported token usage.
//   node check.mjs <folder>
import { createLlm } from '../lib/fake-llm.mjs';
import { client, notStarted, ok, race, report, sleep, startTrialApp, statuses, targetFolder, uid } from '../lib/harness.mjs';

const folder = targetFolder();
const SECRET = 'whsec_trial_secret_0123456789abcdef';
const KEY = 'rewardly_trial_key_0123456789';
const ADMIN = 'trial_admin_key_0123456789abcdef0123456789';
const llm = createLlm();
const llmPort = await llm.listen();
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  REWARDLY_POSTBACK_KEY: KEY,
  ADMIN_KEY: ADMIN,
  LLM_API_URL: `http://127.0.0.1:${llmPort}`,
  LLM_API_KEY: 'llm_trial_key',
  LLM_TIMEOUT_MS: '2000',
};
const cost = (input, output) => Math.ceil((input + 10 * output) / 100);
const r = report('add-usage-credits');
const app = await startTrialApp(folder, ENV);

if (!app.started) {
  r.skipAll([['U00', 'the app starts with the trial configuration']], notStarted(app));
  await r.finish(app.stop, () => llm.close());
} else {
  const t = client(app.base);
  const funded = async (coins) => {
    const user = await t.signup();
    const res = await t.api('/admin/grant', {
      headers: { 'x-admin-key': ADMIN },
      body: { user_id: user.id, amount: coins, reason: 'trial funding', request_id: uid('req') },
    });
    if (!ok(res.status)) throw new Error(`grant answered ${res.status}`);
    return user;
  };
  // Sends a question and reads the whole answer. abortAfter: close the connection after that many characters.
  const ask = async (user, prompt, { key, extra = {}, abortAfter } = {}) => {
    const controller = new AbortController();
    try {
      const res = await fetch(`${app.base}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}`, ...(key ? { 'idempotency-key': key } : {}) },
        body: JSON.stringify({ prompt, ...extra }),
        signal: controller.signal,
      });
      let text = '';
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        text += decoder.decode(chunk, { stream: true });
        if (abortAfter && text.length >= abortAfter) {
          controller.abort();
          return { status: res.status, text, aborted: true };
        }
      }
      return { status: res.status, text };
    } catch (err) {
      return { status: 'ERR', text: String(err.message) };
    }
  };
  const callsFor = (marker) => llm.calls.filter((c) => c.prompt.includes(marker));
  const settled = async (user, test, ms = 6000) => {
    const until = Date.now() + ms;
    let balance = await t.balance(user);
    while (Date.now() < until && !test(balance)) {
      await sleep(200);
      balance = await t.balance(user);
    }
    return balance;
  };

  await r.check('U01', 'a question is charged the price of the reported usage, rounded up once', async () => {
    const user = await funded(500);
    const marker = uid('q');
    const res = await ask(user, `How do coin packs work? ${marker} [sandbox:words=37]`);
    if (!ok(res.status) || !res.text.includes('word37')) return `answered ${res.status}: ${res.text.slice(0, 80)}`;
    const [call] = callsFor(marker);
    const want = 500 - cost(call.input_tokens, 37);
    const balance = await settled(user, (b) => b === want);
    return balance === want || `balance ${balance}, expected ${want}`;
  });

  await r.check('U02', 'cost, credit and limit fields in the request change neither the price nor the model limit', async () => {
    const user = await funded(500);
    const marker = uid('q');
    await ask(user, `Tell me a story ${marker} [sandbox:words=50]`, { extra: { max_tokens: 100000, maxTokens: 100000, cost: 0, credits: 0, price: 0 } });
    const [call] = callsFor(marker);
    if (!call) return 'the model was not called';
    if (call.max_tokens > 400) return `the model was called with max_tokens ${call.max_tokens}`;
    const want = 500 - cost(call.input_tokens, 50);
    const balance = await settled(user, (b) => b === want);
    return balance === want || `balance ${balance}, expected ${want}`;
  });

  await r.check('U03', 'without coins for the longest answer the user gets 402 and the model is not called', async () => {
    const user = await funded(30);
    const marker = uid('q');
    const res = await ask(user, `Short question ${marker} [sandbox:words=2]`);
    const balance = await t.balance(user);
    if (callsFor(marker).length) return `the model was called (answered ${res.status})`;
    if (res.status !== 402) return `answered ${res.status}`;
    return balance === 30 || `balance ${balance}`;
  });

  await r.check('U04', 'ten questions at once against coins for two: at most two reach the model, the balance stays above zero', async () => {
    const user = await funded(100);
    const marker = uid('q');
    const results = await race(10, (i) => ask(user, `Question ${i} ${marker} [sandbox:words=10] [sandbox:slow=100]`, { key: uid(`k${i}`) }));
    const calls = callsFor(marker).length;
    const balance = await settled(user, (b) => b >= 0 && b <= 100, 3000);
    if (calls > 2 || calls < 1) return `${calls} model calls (answers ${statuses(results)})`;
    if (results.some((x) => typeof x.status !== 'number' || x.status >= 500)) return `answers ${statuses(results)}`;
    return balance >= 0 || `balance ${balance}`;
  });

  await r.check('U05', 'the same Idempotency-Key five times at once and once more later asks the model once and charges once', async () => {
    const user = await funded(500);
    const marker = uid('q');
    const key = uid('idem');
    const prompt = `Repeatable question ${marker} [sandbox:words=20] [sandbox:slow=40]`;
    const results = await race(5, () => ask(user, prompt, { key }));
    const first = callsFor(marker);
    if (first.length !== 1) return `${first.length} model calls (answers ${statuses(results)})`;
    const want = 500 - cost(first[0].input_tokens, 20);
    await settled(user, (b) => b === want);
    const later = await ask(user, prompt, { key });
    const balance = await t.balance(user);
    if (callsFor(marker).length !== 1) return 'the repeat later asked the model again';
    if (typeof later.status !== 'number' || later.status >= 500) return `the later repeat answered ${later.status}`;
    return balance === want || `balance ${balance}, expected ${want}`;
  });

  await r.check('U06', 'a model error before any output costs nothing', async () => {
    const user = await funded(500);
    const res = await ask(user, `Failing question ${uid('q')} [sandbox:error]`);
    const balance = await settled(user, (b) => b === 500);
    return balance === 500 || `balance ${balance} (answered ${res.status})`;
  });

  await r.check('U07', 'an answer cut after five tokens is charged for what was delivered, not for nothing and not for the limit', async () => {
    const user = await funded(500);
    const marker = uid('q');
    const context = Array.from({ length: 80 }, (_, i) => `context${i}`).join(' ');
    await ask(user, `Cut question ${marker} ${context} [sandbox:words=60] [sandbox:cut=5]`);
    const [call] = callsFor(marker);
    const least = cost(call.input_tokens, 5);
    const most = cost(call.input_tokens, 5 * 4);
    const balance = await settled(user, (b) => b <= 500 - least && b >= 500 - most);
    const charged = 500 - balance;
    return (charged >= least && charged <= most) || `charged ${charged}, expected ${least} to ${most}`;
  });

  await r.check('U08', 'a model that never answers times out and costs nothing', async () => {
    const user = await funded(500);
    const started = Date.now();
    const res = await ask(user, `Stuck question ${uid('q')} [sandbox:hang]`);
    const took = Date.now() - started;
    if (took > 15000) return `the request took ${took} ms`;
    const balance = await settled(user, (b) => b === 500);
    return balance === 500 || `balance ${balance} (answered ${res.status})`;
  }, { timeoutMs: 40000 });

  await r.check('U09', 'when the user disconnects mid-answer the model call is stopped and only what was used is charged', async () => {
    const user = await funded(500);
    const marker = uid('q');
    await ask(user, `Long question ${marker} [sandbox:words=60] [sandbox:slow=100]`, { abortAfter: 30 });
    await sleep(1500);
    const [call] = callsFor(marker);
    const most = cost(call.input_tokens, 60);
    const balance = await settled(user, (b) => b < 500 && b >= 500 - most, 8000);
    if (!call.aborted || call.sent >= 60) return `the model call was not stopped (${call.sent} tokens sent)`;
    const charged = 500 - balance;
    return (charged >= 1 && charged <= most) || `charged ${charged}, expected 1 to ${most} (coins left reserved, or nothing charged)`;
  });

  await r.check('U10', 'reconciliation reports no mismatch after all of the above', async () => {
    await sleep(500);
    const res = await t.api('/admin/reconcile', { headers: { 'x-admin-key': ADMIN } });
    if (res.status !== 200) return `answered ${res.status}`;
    return (Array.isArray(res.json?.mismatches) && res.json.mismatches.length === 0) || `mismatches: ${res.text.slice(0, 200)}`;
  });

  await r.finish(app.stop, () => llm.close());
}
