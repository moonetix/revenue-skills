// Shared helpers for the trial checkers: start the built app, talk to it, race requests,
// and print one PASS or FAIL line per rule.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { timestampedHeader } from '../../skills/build-webhook-endpoint/assets/sign-test-event.mjs';

// A fresh value per run for each secret the checker hands to the app, so no key-like literal
// sits in the repository and nothing can depend on a fixed test value.
export const trialSecret = (prefix) => `${prefix}${randomBytes(18).toString('hex')}`;

export { sleep };
export const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const RUN_ID = randomBytes(3).toString('hex');

const children = new Set();
const cleanups = [];
const killAll = () => {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
};
process.on('exit', killAll);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killAll();
    process.exit(130);
  });
}

export function targetFolder() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(`usage: [TRIAL_EXTRA_ENV="NAME=value ..."] node ${path.basename(process.argv[1])} <folder with server.mjs>`);
    process.exit(2);
  }
  const folder = path.resolve(arg);
  if (!existsSync(path.join(folder, 'server.mjs'))) {
    console.error(`no server.mjs in ${folder}`);
    process.exit(2);
  }
  return folder;
}

// A temporary directory next to the harness (trials/.run/), removed when the checker ends.
export function runDir() {
  const dir = path.join(LIB_DIR, '..', '.run', `${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
    try {
      rmdirSync(path.dirname(dir)); // only succeeds when no other checker is using it
    } catch {}
  });
  return dir;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

// Starts `node server.mjs` in the folder with only the given environment (plus PATH).
export async function startApp(folder, env = {}, { waitMs = 20000 } = {}) {
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, [path.join(folder, 'server.mjs')], {
    cwd: folder,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1', ...env, PORT: String(port) },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
    children.delete(child);
  });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const app = {
    port,
    base: `http://127.0.0.1:${port}`,
    logs: () => logs.join(''),
    get exited() {
      return exited;
    },
    async stop() {
      if (exited) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      for (let i = 0; i < 30 && !exited; i += 1) await sleep(100);
      if (!exited) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
        for (let i = 0; i < 20 && !exited; i += 1) await sleep(50);
      }
    },
  };
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (exited) return { ...app, started: false };
    if (await canConnect(port)) return { ...app, started: true };
    await sleep(100);
  }
  await app.stop();
  return { ...app, started: false };
}

// TRIAL_EXTRA_ENV names settings that the built app added and now requires, as NAME=value
// pairs separated by spaces or new lines, for example TRIAL_EXTRA_ENV="SIGNUP_KEY_SECRET=abc123".
export function extraEnv(text = process.env.TRIAL_EXTRA_ENV || '') {
  const env = {};
  for (const pair of text.split(/\s+/).filter(Boolean)) {
    const at = pair.indexOf('=');
    if (at < 1) {
      console.error(`TRIAL_EXTRA_ENV: "${pair}" is not NAME=value`);
      process.exit(2);
    }
    env[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return env;
}

// How the app under test was started: with the task's environment alone ('task'), only with
// TRIAL_EXTRA_ENV added ('extra'), or not at all ('none'). report().finish() prints it.
const start = { how: null, names: [] };

// Starts the app with the task's environment. When it does not start and TRIAL_EXTRA_ENV is set,
// starts it again with those settings added, so the attacks can still run; the result is
// reported apart from the attack results.
export async function startTrialApp(folder, env, options) {
  const app = await startApp(folder, env, options);
  if (app.started) {
    start.how = 'task';
    return app;
  }
  const extra = extraEnv();
  start.names = Object.keys(extra);
  if (!start.names.length) {
    start.how = 'none';
    return app;
  }
  await app.stop();
  console.log(`START the app did not start with the task's environment; starting it again with TRIAL_EXTRA_ENV (${start.names.join(', ')})`);
  const retry = await startApp(folder, { ...env, ...extra }, options);
  start.how = retry.started ? 'extra' : 'none';
  return retry;
}

// The reason given for every check skipped because the app did not start.
export const notStarted = (app) =>
  `the app did not start: ${app.logs().slice(-300).trim()}${start.names.length ? '' : ' (if it now requires a setting of its own, pass it in TRIAL_EXTRA_ENV)'}`;

// True when the app does not come up (exits or never listens) with this environment.
export async function refusesToStart(folder, env, waitMs = 4000) {
  const app = await startApp(folder, env, { waitMs });
  const refused = !app.started;
  await app.stop();
  return refused;
}

export function client(base) {
  let users = 0;
  const t = {
    base,
    async api(pathname, { token, body, headers = {}, method, raw } = {}) {
      const hasBody = body !== undefined || raw !== undefined;
      const res = await fetch(base + pathname, {
        method: method || (hasBody ? 'POST' : 'GET'),
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: raw !== undefined ? raw : body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, text, json, headers: res.headers };
    },
    nextEmail(prefix = 'user') {
      users += 1;
      return `${prefix}${users}-${RUN_ID}@example.com`;
    },
    async signup({ email, ref, headers, extra = {} } = {}) {
      const address = email || t.nextEmail();
      const res = await t.api('/api/signup', {
        body: { email: address, password: 'correct horse battery', ...(ref ? { ref } : {}), ...extra },
        headers,
      });
      if (res.status !== 201 && res.status !== 200) throw new Error(`signup ${address} answered ${res.status} ${res.text.slice(0, 120)}`);
      return { id: res.json.user_id, token: res.json.token, email: address, res };
    },
    async me(user) {
      const res = await t.api('/api/me', { token: user.token });
      if (res.status !== 200) throw new Error(`GET /api/me answered ${res.status}`);
      return res.json;
    },
    async balance(user) {
      const value = (await t.me(user)).balance;
      if (typeof value !== 'number') throw new Error(`GET /api/me balance is ${JSON.stringify(value)}`);
      return value;
    },
    async send(request) {
      const res = await fetch(request.url.startsWith('http') ? request.url : base + request.url, {
        method: request.method || 'GET',
        headers: request.headers,
        body: request.rawBody,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, text, json };
    },
  };
  return t;
}

// Fires n calls at the same moment and returns their results (errors are returned, not thrown).
export async function race(n, fn) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = Array.from({ length: n }, (_, i) =>
    gate.then(() => fn(i)).then(
      (value) => value,
      (error) => ({ error }),
    ),
  );
  release();
  return Promise.all(calls);
}

export const ok = (status) => status >= 200 && status < 300;
export const is4xx = (status) => status >= 400 && status < 500;
export const statuses = (results) => results.map((r) => r.status ?? 'ERR').join(',');

// Stripe-shaped event, signed with the scheme of the skill's sign-test-event.mjs (stripe mode).
export function stripeEvent(base, secret, type, object, { id, age = 0, sign = true, header, path: route = '/webhooks/stripe' } = {}) {
  const t = Math.floor(Date.now() / 1000) - age;
  const rawBody = JSON.stringify({
    id: id || `evt_test_${randomBytes(8).toString('hex')}`,
    object: 'event',
    type,
    created: t,
    livemode: false,
    api_version: '2026-10-28.endive',
    data: { object },
  });
  const signature = header ?? timestampedHeader(secret, t, rawBody);
  return {
    method: 'POST',
    url: base + route,
    headers: { 'content-type': 'application/json', ...(sign ? { 'stripe-signature': signature } : {}) },
    rawBody,
  };
}

export const hmacHex = (key, text) => createHmac('sha256', key).update(text).digest('hex');

export function rewardlyUrl(key, { user, userId, tx, reward, status = 1, sign = true, extra = '' }) {
  const id = userId ?? user.id;
  const hash = hmacHex(key, `${id}:${tx}:${reward}:${status}`);
  return `/postback/rewardly?user_id=${id}&tx=${encodeURIComponent(tx)}&reward=${reward}&status=${status}${sign ? `&hash=${hash}` : ''}${extra}`;
}

export const uid = (prefix = 'x') => `${prefix}_${randomBytes(6).toString('hex')}`;

// Collects PASS/FAIL lines. A check returns true for PASS, or a string (the reason) for FAIL.
export function report(title) {
  const results = [];
  console.log(`# ${title}`);
  // A crash outside a check (for example in setup) still ends with a FAIL line, a total and exit 1.
  const crash = (err) => {
    console.log(`FAIL CRASH the checker stopped outside a check - ${String(err?.message ?? err).slice(0, 300)}`);
    const failed = results.filter((r) => !r.pass).length + 1;
    console.log(`TOTAL ${results.length + 1 - failed}/${results.length + 1} passed, ${failed} failed`);
    killAll();
    process.exit(1);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  return {
    results,
    async check(id, rule, fn, { timeoutMs = 45000 } = {}) {
      let verdict;
      let timer;
      try {
        verdict = await Promise.race([
          fn(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
          }),
        ]);
      } catch (err) {
        verdict = `error: ${err.message}`;
      } finally {
        clearTimeout(timer);
      }
      const pass = verdict === true;
      results.push({ id, rule, pass, reason: pass ? '' : String(verdict) });
      console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${rule}${pass ? '' : ` - ${String(verdict).replace(/\s+/g, ' ').slice(0, 300)}`}`);
      return pass;
    },
    skipAll(ids, reason) {
      for (const [id, rule] of ids) {
        results.push({ id, rule, pass: false, reason });
        console.log(`FAIL ${id} ${rule} - ${reason}`);
      }
    },
    async finish(...stoppers) {
      for (const stop of stoppers) {
        try {
          await stop();
        } catch {}
      }
      for (const fn of cleanups) fn();
      const failed = results.filter((r) => !r.pass).length;
      console.log(`TOTAL ${results.length - failed}/${results.length} passed${failed ? `, ${failed} failed` : ''}`);
      if (start.how === 'extra') {
        console.log(`START FAIL the app did not start with the task's environment; the checks above ran with TRIAL_EXTRA_ENV (${start.names.join(', ')})`);
      }
      // 0: every check passed with the task's environment; 1: a check failed; 3: every check
      // passed, but only with TRIAL_EXTRA_ENV.
      process.exitCode = failed ? 1 : start.how === 'extra' ? 3 : 0;
      setTimeout(() => process.exit(process.exitCode), 200).unref();
    },
  };
}

// Waits until fn() returns a truthy value or the time is up; returns the last value.
export async function eventually(fn, ms = 3000, step = 100) {
  const until = Date.now() + ms;
  let value;
  while (Date.now() < until) {
    value = await fn();
    if (value) return value;
    await sleep(step);
  }
  return fn();
}
