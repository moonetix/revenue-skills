#!/usr/bin/env node
// Prints a request file for scripts/probe.mjs that carries one correctly signed test event.
// The two formulas below are examples. Replace them with the scheme the endpoint under
// test verifies, and keep the secret in the environment: it must be the test secret from
// the local configuration, never a live one.
//
//   WEBHOOK_TEST_SECRET=... node sign-test-event.mjs webhook <type> '<data json>' [age in seconds]
//   POSTBACK_TEST_KEY=...   node sign-test-event.mjs postback user_id=42 tx=tx-1001 reward=200 status=1
//
// WEBHOOK_URL, POSTBACK_URL and SIGNATURE_HEADER override the defaults.
import { createHmac, randomUUID } from 'node:crypto';

const [mode, ...args] = process.argv.slice(2);

function need(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

function fail(message) {
  console.error(`sign-test-event: ${message}`);
  console.error('usage: sign-test-event.mjs webhook <type> <data json> [age in seconds]');
  console.error('       sign-test-event.mjs postback name=value [name=value ...]');
  process.exit(1);
}

// Timestamped header scheme: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">.
function webhook([type, dataJson, age = '0']) {
  if (!type || !dataJson) fail('webhook needs a type and a data object');
  let data;
  try {
    data = JSON.parse(dataJson);
  } catch {
    fail('the data argument is not JSON');
  }
  const rawBody = JSON.stringify({ id: `evt_test_${randomUUID()}`, type, data });
  const t = Math.floor(Date.now() / 1000) - Number(age);
  const v1 = createHmac('sha256', need('WEBHOOK_TEST_SECRET')).update(`${t}.${rawBody}`).digest('hex');
  return {
    method: 'POST',
    url: process.env.WEBHOOK_URL ?? 'http://127.0.0.1:3000/webhooks/payments',
    headers: {
      'content-type': 'application/json',
      [process.env.SIGNATURE_HEADER ?? 'x-signature']: `t=${t},v1=${v1}`,
    },
    rawBody,
  };
}

// Query hash scheme: hash=<hex HMAC-SHA256 of the values, in the order given, joined by ":">.
function postback(pairs) {
  if (pairs.length === 0) fail('postback needs at least one name=value pair');
  const url = new URL(process.env.POSTBACK_URL ?? 'http://127.0.0.1:3000/postback');
  const values = [];
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) fail(`"${pair}" is not name=value`);
    url.searchParams.set(pair.slice(0, at), pair.slice(at + 1));
    values.push(pair.slice(at + 1));
  }
  url.searchParams.set('hash', createHmac('sha256', need('POSTBACK_TEST_KEY')).update(values.join(':')).digest('hex'));
  return { method: 'GET', url: url.toString() };
}

if (mode === 'webhook') console.log(JSON.stringify(webhook(args)));
else if (mode === 'postback') console.log(JSON.stringify(postback(args)));
else fail('the first argument must be "webhook" or "postback"');
