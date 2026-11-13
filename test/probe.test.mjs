import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'money-audit', 'scripts', 'probe.mjs');
const dir = mkdtempSync(path.join(tmpdir(), 'probe-test-'));
let server;
let base;
let hits = [];

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (url.pathname === '/count') return res.end(JSON.stringify({ stats: { count: hits.length } }));
      if (url.pathname === '/list') return res.end(JSON.stringify({ items: hits.map((h) => h.method) }));
      if (url.pathname === '/login') return res.end(JSON.stringify({ user_id: 7, session: { token: 'tok_abc' } }));
      if (url.pathname === '/echo') return res.end(Buffer.concat(chunks).toString());
      if (url.pathname === '/away') {
        res.writeHead(302, { location: 'https://example.com/' });
        return res.end();
      }
      if (url.pathname === '/broken') {
        res.writeHead(500);
        return res.end('nope');
      }
      hits.push({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(url.pathname === '/created' ? 201 : 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});

function run(...args) {
  hits = [];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probe, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {}
      resolve({ status, stdout, stderr, json });
    });
  });
}

const request = (extra = {}) => JSON.stringify({ method: 'POST', url: `${base}/hit?a=1&b=2`, headers: { 'X-Token': 'abc' }, body: { item: 'boost', nested: { n: 1 } }, ...extra });
const observe = () => JSON.stringify({ url: `${base}/count`, path: 'stats.count' });

test('send: one request, the watched number before and after', async () => {
  const r = await run('send', request(), '--observe', observe());
  assert.equal(r.status, 0);
  assert.equal(r.json.probe, 'send');
  assert.equal(r.json.sent, 1);
  assert.deepEqual(r.json.statuses, { 200: 1 });
  assert.deepEqual(r.json.observed, { path: 'stats.count', before: 0, after: 1, delta: 1 });
  assert.deepEqual(r.json.samples, [{ status: 200, body: '{"ok":true}' }]);
  assert.equal(hits[0].headers['x-token'], 'abc');
  assert.equal(hits[0].headers['content-type'], 'application/json');
  assert.equal(hits[0].body, '{"item":"boost","nested":{"n":1}}');
});

test('replay sends in sequence, race sends at once', async () => {
  const replay = await run('replay', request(), '--times', '3', '--observe', observe());
  assert.equal(replay.json.sent, 3);
  assert.equal(replay.json.observed.delta, 3);
  const race = await run('race', request(), '--parallel', '12');
  assert.equal(race.json.sent, 12);
  assert.deepEqual(race.json.statuses, { 200: 12 });
  assert.equal(hits.length, 12);
});

test('edits change headers, query and body without touching the request file', async () => {
  const file = path.join(dir, 'request.json');
  writeFileSync(file, request());
  const r = await run(
    'send', file,
    '--set-header', 'x-extra=1', '--drop-header', 'X-Token',
    '--set-query', 'b=9', '--drop-query', 'a', '--set-query', 'c=x y',
    '--set-body', 'amount=-400', '--set-body', 'nested.deep.flag=true', '--set-body', 'note=hello', '--drop-body', 'item',
  );
  assert.equal(r.status, 0);
  assert.deepEqual(hits[0].query, { b: '9', c: 'x y' });
  assert.equal(hits[0].headers['x-extra'], '1');
  assert.equal(hits[0].headers['x-token'], undefined);
  assert.deepEqual(JSON.parse(hits[0].body), { nested: { n: 1, deep: { flag: true } }, amount: -400, note: 'hello' });
  assert.deepEqual(r.json.edits.slice(0, 2), ['set-header x-extra=1', 'drop-header X-Token']);
  assert.equal(readFileSync(file, 'utf8'), request());
});

test('rawBody is sent byte for byte, and can still be edited as JSON', async () => {
  const rawBody = '{"id":"evt_1",  "data":{"amount_cents":499}}';
  await run('send', request({ body: undefined, rawBody, headers: { 'content-type': 'application/json' } }));
  assert.equal(hits[0].body, rawBody);
  await run('send', request({ body: undefined, rawBody }), '--set-body', 'data.amount_cents=1');
  assert.equal(hits[0].body, '{"id":"evt_1","data":{"amount_cents":1}}');
});

test('GET requests carry no body', async () => {
  await run('send', JSON.stringify({ url: `${base}/hit?user=7` }));
  assert.equal(hits[0].method, 'GET');
  assert.equal(hits[0].body, '');
});

test('targets must be loopback unless the host is named', async () => {
  for (const url of ['https://example.com/pay', 'http://10.0.0.5/pay', 'http://127.0.0.1.example.com/pay']) {
    const r = await run('send', JSON.stringify({ url }));
    assert.equal(r.status, 2, url);
    assert.match(r.stderr, /Refusing to send to/);
  }
  const refusedObserve = await run('send', request(), '--observe', JSON.stringify({ url: 'https://example.com/me', path: 'balance' }));
  assert.equal(refusedObserve.status, 2);
  assert.equal(hits.length, 0, 'nothing is sent when any target is refused');
  const named = await run('send', JSON.stringify({ url: 'http://host.invalid/pay' }), '--allow-host', 'host.invalid');
  assert.equal(named.status, 0);
  assert.deepEqual(named.json.statuses, { 0: 1 });
  for (const url of ['http://localhost:1/x', 'http://[::1]:1/x']) {
    const r = await run('send', JSON.stringify({ url }));
    assert.equal(r.status, 0, url);
  }
});

test('redirects are reported, not followed', async () => {
  const r = await run('send', JSON.stringify({ url: `${base}/away` }));
  assert.deepEqual(r.json.statuses, { 302: 1 });
});

test('volume is capped', async () => {
  assert.equal((await run('replay', request(), '--times', '21')).status, 2);
  assert.equal((await run('race', request(), '--parallel', '51')).status, 2);
  assert.equal((await run('race', request(), '--parallel', '1')).status, 2);
  assert.equal(hits.length, 0);
});

test('usage errors exit with 2 and say what is wrong', async () => {
  assert.match((await run()).stderr, /Usage:/);
  assert.match((await run('flood', request())).stderr, /Usage:/);
  assert.match((await run('send', path.join(dir, 'missing.json'))).stderr, /Cannot read the request file/);
  assert.match((await run('send', '{not json')).stderr, /not valid JSON/);
  assert.match((await run('send', request(), '--frobnicate', '1')).stderr, /Unknown option --frobnicate/);
  assert.match((await run('send', request({ rawBody: 'x' }))).stderr, /both "body" and "rawBody"/);
  assert.match((await run('send', JSON.stringify({ url: `${base}/hit`, rawBody: 'plain text' }), '--set-body', 'a=1')).stderr, /Body edits need a JSON body/);
  assert.match((await run('send', request(), '--observe', JSON.stringify({ url: `${base}/broken`, path: 'x' }))).stderr, /--observe request answered 500/);
  assert.match((await run('send', request(), '--observe', JSON.stringify({ url: `${base}/count`, path: 'stats.missing' }))).stderr, /No number at "stats.missing"/);
});

test('several numbers can be watched, and a list can be counted', async () => {
  const second = JSON.stringify({ name: 'hits seen', url: `${base}/list`, path: 'items.length' });
  const r = await run('replay', request(), '--times', '2', '--observe', observe(), '--observe', second);
  assert.deepEqual(r.json.observed, [
    { path: 'stats.count', before: 0, after: 2, delta: 2 },
    { name: 'hits seen', path: 'items.length', before: 0, after: 2, delta: 2 },
  ]);
});

test('--var fills {{NAME}} and keeps the value out of the output', async () => {
  const spec = JSON.stringify({
    method: 'POST',
    url: `${base}/hit?hash={{HASH}}`,
    headers: { authorization: 'Bearer {{TOKEN}}' },
    body: { note: 'say "{{WORD}}"' },
  });
  const r = await run('send', spec, '--var', 'TOKEN=tok_secret_123', '--var', 'HASH=a b&c', '--var', 'WORD=q"uote', '--set-header', 'x-admin-key=topsecretvalue', '--set-header', 'x-plain=tok_secret_123');
  assert.equal(r.status, 0);
  assert.equal(hits[0].headers.authorization, 'Bearer tok_secret_123');
  assert.equal(hits[0].query.hash, 'a b&c');
  assert.equal(JSON.parse(hits[0].body).note, 'say "q"uote"');
  assert.doesNotMatch(r.stdout, /tok_secret_123|topsecretvalue|a%20b%26c/);
  assert.equal(r.json.request, `POST ${base}/hit?hash={{HASH}}`);
  assert.deepEqual(r.json.edits, ['set-header x-admin-key=***', 'set-header x-plain={{TOKEN}}']);
  const missing = await run('send', spec, '--var', 'TOKEN=x');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /uses \{\{HASH\}\}\. Pass --var HASH=value/);
});

test('a response that echoes a variable is masked in the samples', async () => {
  const r = await run('send', JSON.stringify({ method: 'POST', url: `${base}/echo`, rawBody: 'token={{TOKEN}}' }), '--var', 'TOKEN=tok_secret_123');
  assert.deepEqual(r.json.samples, [{ status: 200, body: 'token={{TOKEN}}' }]);
});

test('a token in a response is masked in the samples and still readable with --extract', async () => {
  const r = await run('send', JSON.stringify({ url: `${base}/login` }));
  assert.deepEqual(r.json.samples, [{ status: 200, body: '{"user_id":7,"session":{"token":"***"}}' }]);
});

test('a signature in the query string is not echoed', async () => {
  const r = await run('send', JSON.stringify({ url: `${base}/hit?tx=7&hash=abcdef0123456789` }), '--set-query', 'reward=5', '--set-query', 'hash=ffff0000');
  assert.equal(hits.at(-1).query.hash, 'ffff0000');
  assert.equal(r.json.request, `GET ${base}/hit?tx=7&hash=***&reward=5`);
  assert.deepEqual(r.json.edits, ['set-query reward=5', 'set-query hash=***']);
  assert.doesNotMatch(r.stdout, /abcdef0123456789|ffff0000/);
});

test('--extract prints one value from the response', async () => {
  const text = await run('send', JSON.stringify({ url: `${base}/login` }), '--extract', 'session.token');
  assert.equal(text.stdout, 'tok_abc\n');
  const number = await run('send', JSON.stringify({ url: `${base}/login` }), '--extract', 'user_id');
  assert.equal(number.stdout, '7\n');
  const absent = await run('send', JSON.stringify({ url: `${base}/login` }), '--extract', 'session.missing');
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /No value at "session.missing" in the response \(status 200\)/);
});

test('--out saves the result', async () => {
  const out = path.join(dir, 'result.json');
  const r = await run('send', request({ url: `${base}/created` }), '--out', out);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), r.json);
  assert.deepEqual(r.json.statuses, { 201: 1 });
});
