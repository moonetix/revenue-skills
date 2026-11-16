// The provider references show verification code, and the signing helper produces provider-style
// test events. These tests run the code as it stands in the references against the helper's
// output and against the test vectors published in Paddle's official SDK test suites.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills', 'build-webhook-endpoint');
const helperPath = path.join(skill, 'assets', 'sign-test-event.mjs');
const helper = await import(pathToFileURL(helperPath).href);
const dir = mkdtempSync(path.join(tmpdir(), 'provider-signing-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// Writes the JavaScript block of a reference that contains `marker` to a module and imports it.
async function loadBlock(reference, marker) {
  const text = readFileSync(path.join(skill, 'references', reference), 'utf8');
  const block = [...text.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).find((code) => code.includes(marker));
  assert.ok(block, `${reference} has a js block with ${marker}`);
  const file = path.join(dir, `${path.basename(reference, '.md')}-${marker.replace(/\W+/g, '')}.mjs`);
  writeFileSync(file, block);
  return import(pathToFileURL(file).href);
}

function runHelper(args, env) {
  return spawnSync(process.execPath, [helperPath, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

const SECRET = `whsec_${randomBytes(18).toString('hex')}`;

test('Paddle: the helper and the reference reproduce the vectors of the official SDK tests', async () => {
  // paddle-node-sdk, src/__tests__/notifications/webhooks-validator.node.test.ts
  const nodeHeader = 'ts=1698796800;h1=a300428748dce5c70e4da19bffd60769591ea969c99dea3105d0ec9612cf43f9';
  assert.equal(helper.paddleHeader('VALID_SECRET', 1698796800, '{"data": ["1", "2"]}'), nodeHeader);
  // paddle-python-sdk, tests/Unit/Notification/test_Verifier.py: two h1 entries, the second one valid
  const pySecret = 'pdl_ntf_01hbpjmytsa32fhr36nqgc3kgb_WvRO0eL4Bj9rgYYIBZY6wZhG4EHy9jzh';
  const pyHeader = 'ts=1696195954;h1=dummy;h1=d96299976a6eb066f484d7fde011ac56fc32b38fc9940bc419d6e537fdc6ef02';
  assert.equal(helper.paddleHeader(pySecret, 1696195954, 'hello-world'), `ts=1696195954;h1=${pyHeader.split('h1=')[2]}`);

  const { verifyPaddle } = await loadBlock('provider-paddle.md', 'export function verifyPaddle');
  const body = (text) => Buffer.from(text);
  assert.equal(verifyPaddle(body('{"data": ["1", "2"]}'), nodeHeader, ['VALID_SECRET'], 5, 1698796805), true);
  assert.equal(verifyPaddle(body('{"data": ["1", "2"]}'), nodeHeader, ['VALID_SECRET'], 5, 1698796806), false, 'six seconds late');
  assert.equal(verifyPaddle(body('{"data": ["1", "2"]}'), nodeHeader, ['VALID_SECRET'], 5, 1698796794), false, 'six seconds early');
  assert.equal(verifyPaddle(body('{ "data": [ "1", "2" ]}'), nodeHeader, ['VALID_SECRET'], 5, 1698796800), false, 'whitespace changed');
  assert.equal(verifyPaddle(body('hello-world'), pyHeader, ['wrong-one', 'wrong-two', pySecret], 5, 1696195954), true, 'second h1, third secret');
  assert.equal(verifyPaddle(body('hello-world'), pyHeader, ['wrong-one'], 5, 1696195954), false);
});

test('Paddle: a request from the helper verifies with the reference code', async () => {
  const { verifyPaddle } = await loadBlock('provider-paddle.md', 'export function verifyPaddle');
  const run = runHelper(['paddle', 'transaction.completed', '{"id":"txn_1"}'], { WEBHOOK_TEST_SECRET: SECRET });
  assert.equal(run.status, 0, run.stderr);
  const request = JSON.parse(run.stdout);
  assert.equal(JSON.parse(request.rawBody).event_type, 'transaction.completed');
  assert.equal(verifyPaddle(Buffer.from(request.rawBody), request.headers['paddle-signature'], [SECRET]), true);
  assert.equal(verifyPaddle(Buffer.from(`${request.rawBody} `), request.headers['paddle-signature'], [SECRET]), false);
});

test('Stripe and RevenueCat: helper requests verify with the timestamped verifier of verify-signatures.md', async () => {
  const { verifyTimestamped } = await loadBlock('verify-signatures.md', 'export function verifyTimestamped');
  for (const [mode, header] of [['stripe', 'stripe-signature'], ['revenuecat', 'x-revenuecat-webhook-signature']]) {
    const run = runHelper([mode, 'test.event', '{"amount":499}'], { WEBHOOK_TEST_SECRET: SECRET, EVENT_ID: 'evt_fixed' });
    assert.equal(run.status, 0, run.stderr);
    const request = JSON.parse(run.stdout);
    const value = request.headers[header];
    assert.match(value, /^t=\d+,v1=[a-f0-9]{64}$/);
    assert.equal(verifyTimestamped(Buffer.from(request.rawBody), value, [SECRET]), true, mode);
    assert.equal(verifyTimestamped(Buffer.from(request.rawBody.replace('499', '1')), value, [SECRET]), false, mode);
    const event = JSON.parse(request.rawBody);
    assert.equal(mode === 'stripe' ? event.id : event.event.id, 'evt_fixed');
  }
  // A Stripe header with a sandbox v0 entry and debug entries still verifies on its v1 entry.
  const t = Math.floor(Date.now() / 1000);
  const v1 = helper.timestampedHeader(SECRET, t, '{}').split(',')[1];
  const header = `t=${t},${v1},v0=${'0'.repeat(64)},secret=whsec_****abcd,destination=we_1,payload=a25aefc6`;
  assert.equal(verifyTimestamped(Buffer.from('{}'), header, [SECRET]), true);
  assert.equal(verifyTimestamped(Buffer.from('{}'), `t=${t},v0=${v1.slice(3)}`, [SECRET]), false, 'v0 alone is refused');
  const stale = runHelper(['stripe', 'test.event', '{}', '600'], { WEBHOOK_TEST_SECRET: SECRET });
  const staleRequest = JSON.parse(stale.stdout);
  assert.equal(verifyTimestamped(Buffer.from(staleRequest.rawBody), staleRequest.headers['stripe-signature'], [SECRET]), false);
});

test('Lemon Squeezy: a request from the helper verifies with the reference code', async () => {
  const { verifyLemonSqueezy } = await loadBlock('provider-lemonsqueezy.md', 'export function verifyLemonSqueezy');
  const run = runHelper(['lemonsqueezy', 'order_created', '{"type":"orders","id":"1"}', '{"order_id":"42"}'], { WEBHOOK_TEST_SECRET: SECRET });
  assert.equal(run.status, 0, run.stderr);
  const request = JSON.parse(run.stdout);
  assert.equal(request.headers['x-event-name'], 'order_created');
  assert.deepEqual(JSON.parse(request.rawBody).meta, { event_name: 'order_created', custom_data: { order_id: '42' } });
  assert.equal(verifyLemonSqueezy(Buffer.from(request.rawBody), request.headers['x-signature'], ['old-secret', SECRET]), true);
  assert.equal(verifyLemonSqueezy(Buffer.from(request.rawBody), request.headers['x-signature'].toUpperCase(), [SECRET]), true);
  assert.equal(verifyLemonSqueezy(Buffer.from(request.rawBody), undefined, [SECRET]), false, 'a missing header is refused, not thrown');
  assert.equal(verifyLemonSqueezy(Buffer.from(request.rawBody), 'abc', [SECRET]), false);
});

test('RevenueCat: the authorization check compares in constant time without throwing on length', async () => {
  const { authorizationMatches } = await loadBlock('provider-revenuecat.md', 'export function authorizationMatches');
  assert.equal(authorizationMatches('Bearer s3cret-value', 'Bearer s3cret-value'), true);
  assert.equal(authorizationMatches('Bearer s3cret', 'Bearer s3cret-value'), false);
  assert.equal(authorizationMatches(undefined, 'Bearer s3cret-value'), false);
});

const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

test('PayPal: the self-verification code checks the CRC32 string, the signature and the certificate host', { skip: !openssl && 'openssl is not installed' }, async () => {
  assert.equal(crc32('123456789'), 0xcbf43926, 'the CRC-32 check value');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(dir, 'paypal-test.key');
  const certFile = path.join(dir, 'paypal-test.crt');
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const made = spawnSync('openssl', ['req', '-x509', '-key', keyFile, '-out', certFile, '-days', '2', '-subj', '/CN=test-only'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const certPem = readFileSync(certFile, 'utf8');

  const { verifyPayPal } = await loadBlock('provider-paypal.md', 'export async function verifyPayPal');
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(certPem, { status: 200 });
  };
  try {
    const rawBody = Buffer.from('{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED"}');
    const config = { webhookId: '0NH55953DH663215D', certHosts: ['api.sandbox.paypal.com'] };
    const transmission = { id: 'db49fb10-1343-11ef-ac58-e32457403f67', time: '2024-05-16T05:19:23Z' };
    const message = `${transmission.id}|${transmission.time}|${config.webhookId}|${crc32(rawBody)}`;
    const headers = {
      'paypal-transmission-id': transmission.id,
      'paypal-transmission-time': transmission.time,
      'paypal-transmission-sig': sign('sha256', Buffer.from(message), privateKey).toString('base64'),
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test',
      'paypal-auth-algo': 'SHA256withRSA',
    };
    assert.equal(await verifyPayPal(rawBody, headers, config), true);
    assert.equal(await verifyPayPal(Buffer.from(`${rawBody} `), headers, config), false, 'body changed');
    assert.equal(await verifyPayPal(rawBody, headers, { ...config, webhookId: 'OTHER' }), false, 'another webhook id');
    const before = fetched.length;
    for (const url of ['https://attacker.example/v1/notifications/certs/CERT-x', 'http://api.sandbox.paypal.com/v1/notifications/certs/CERT-x', 'https://api.sandbox.paypal.com/other']) {
      assert.equal(await verifyPayPal(rawBody, { ...headers, 'paypal-cert-url': url }, config), false, url);
    }
    assert.equal(fetched.length, before, 'an untrusted certificate URL is never fetched');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('PayPal: the verify API request carries the raw event and refuses a body that injects fields', async () => {
  const { verifyRequestBody } = await loadBlock('provider-paypal.md', 'export function verifyRequestBody');
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-id': 'id-1' };
  const raw = Buffer.from('{"id":"WH-1", "resource":{"amount":{"value":"10.50"}}}');
  const request = verifyRequestBody(raw, headers, 'WEBHOOK-1');
  assert.ok(request.endsWith(`"webhook_event":${raw.toString('utf8')}}`), 'the event text is sent as received');
  assert.equal(JSON.parse(request).webhook_id, 'WEBHOOK-1');
  assert.throws(() => verifyRequestBody(Buffer.from('{"id":"WH-1"},"webhook_id":"OTHER"'), headers, 'WEBHOOK-1'));
  assert.throws(() => verifyRequestBody(Buffer.from('[1]'), headers, 'WEBHOOK-1'));
});

test('the signing helper prints usage and exits with 2 on a usage error', () => {
  const none = runHelper([], {});
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage: sign-test-event\.mjs/);
  const noSecret = runHelper(['stripe', 'x', '{}'], { WEBHOOK_TEST_SECRET: '' });
  assert.equal(noSecret.status, 2);
  assert.match(noSecret.stderr, /WEBHOOK_TEST_SECRET is not set/);
  assert.equal(runHelper(['stripe', 'x', '[1]'], { WEBHOOK_TEST_SECRET: SECRET }).status, 2);
  assert.equal(runHelper(['unknown'], { WEBHOOK_TEST_SECRET: SECRET }).status, 2);
});
