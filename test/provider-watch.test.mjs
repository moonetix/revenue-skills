import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BASELINE_FILE, RECHECK, compare, parsePlayTypes, parseStripeApiVersion, report, stableVersion } from '../scripts/provider-watch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));

test('the watch baseline names the Stripe API version the skills name', () => {
  const billing = read('skills/add-subscriptions/references/provider-stripe-billing.md');
  assert.equal(billing.match(/The current version, on [\d-]+, is `([^`]+)`/)[1], baseline.stripeApiVersion);
  const stacks = read('skills/add-subscriptions/references/stacks.md');
  const pinned = [...stacks.matchAll(/(\d{4}-\d{2}-\d{2}\.[a-z]+)/g)].map((m) => m[1]);
  assert.ok(pinned.length >= 4);
  for (const version of pinned) assert.equal(version, baseline.stripeApiVersion);
});

test('the watch baseline covers the Google Play notification types the skills list, plus the deprecated type 8', () => {
  const table = read('skills/add-subscriptions/references/provider-google-play.md');
  const listed = new Set();
  for (const [, cell] of table.matchAll(/^\| ([\d, ]+)[ `]/gm)) for (const n of cell.split(',')) listed.add(Number(n));
  assert.deepEqual([...listed, 8].sort((a, b) => a - b), baseline.googlePlaySubscriptionTypes);
});

test('every watched item says what to re-check', () => {
  for (const key of ['stripeApiVersion', 'googlePlaySubscriptionTypes', ...Object.keys(baseline.packages)]) assert.ok(RECHECK[key], key);
});

test('parsers read the published formats', () => {
  assert.equal(parseStripeApiVersion("exports.ApiVersion = void 0;\nexports.ApiVersion = '2026-11-18.endive';"), '2026-11-18.endive');
  assert.deepEqual(parsePlayTypes('<li>(21) SUBSCRIPTION_PLAN_TRANSITION_UPDATED - x</li><li>(4) SUBSCRIPTION_PURCHASED</li><li>(4) SUBSCRIPTION_PURCHASED</li>'), [4, 21]);
  assert.equal(stableVersion(['v23.2.0-beta.1', 'v23.1.0', 'v23.0.0']), '23.1.0');
});

test('no change gives an empty report; a change names the old and new value and the file to re-check', () => {
  const same = structuredClone(baseline);
  assert.deepEqual(compare(baseline, same), []);
  assert.equal(report([], baseline.checked), '');
  const next = structuredClone(baseline);
  next.stripeApiVersion = '2027-01-01.fig';
  next.googlePlaySubscriptionTypes = [...baseline.googlePlaySubscriptionTypes, 23];
  next.packages['npm:@paddle/paddle-node-sdk'] = '3.13.0';
  const changes = compare(baseline, next);
  assert.deepEqual(changes.map((c) => c.key), ['stripeApiVersion', 'googlePlaySubscriptionTypes', 'npm:@paddle/paddle-node-sdk']);
  const text = report(changes, baseline.checked);
  assert.match(text, /`2026-11-18\.endive` \| `2027-01-01\.fig`/);
  assert.match(text, /provider-paddle\.md/);
  assert.doesNotMatch(text, /\u2014/);
});
