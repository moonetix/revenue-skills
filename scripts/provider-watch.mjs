#!/usr/bin/env node
// Compares the provider facts the skills rely on with what the providers publish now.
// Usage: node scripts/provider-watch.mjs [--out report.md]
// Prints a Markdown report of what changed since scripts/provider-watch.json was last updated.
// Exit 0: checked (report may be empty). Exit 1: a source could not be read.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_FILE = path.join(root, 'scripts', 'provider-watch.json');
const PLAY_RTDN_URL = 'https://developer.android.com/google/play/billing/rtdn-reference?hl=en';
const UA = { 'user-agent': 'revenue-skills-provider-watch (+https://github.com/moonetix/revenue-skills)', 'accept-language': 'en' };

export const RECHECK = {
  stripeApiVersion: 'skills/add-subscriptions/references/provider-stripe-billing.md and the Stripe snippets in skills/add-subscriptions/references/stacks.md. Read https://docs.stripe.com/changelog for breaking changes to Billing and webhooks.',
  googlePlaySubscriptionTypes: 'the notification table in skills/add-subscriptions/references/provider-google-play.md and skills/build-webhook-endpoint/references/provider-google-play.md. Source: ' + PLAY_RTDN_URL,
  'npm:stripe': 'the signature tolerance notes in skills/build-webhook-endpoint/references/provider-stripe.md (they name stripe-node versions).',
  'pypi:stripe': 'the stripe-python notes in skills/build-webhook-endpoint/references/provider-stripe.md.',
  'packagist:stripe/stripe-php': 'the stripe-php notes in skills/build-webhook-endpoint/references/provider-stripe.md.',
  'npm:@paddle/paddle-node-sdk': 'the Node SDK notes in skills/build-webhook-endpoint/references/provider-paddle.md (time window, h1 handling).',
  'pypi:paddle-python-sdk': 'the Python SDK notes in skills/build-webhook-endpoint/references/provider-paddle.md (TEST_MODE).',
  'packagist:paddlehq/paddle-php-sdk': 'the PHP SDK notes in skills/build-webhook-endpoint/references/provider-paddle.md (maximumVariance).',
  'npm:@apple/app-store-server-library': 'skills/build-webhook-endpoint/references/provider-apple-app-store.md and skills/add-subscriptions/references/provider-app-store.md.',
  'pypi:app-store-server-library': 'skills/build-webhook-endpoint/references/provider-apple-app-store.md.',
};

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

export function stableVersion(versions) {
  return versions.map((v) => v.replace(/^v/, '')).find((v) => /^\d+\.\d+\.\d+$/.test(v));
}

export async function latestVersion(id) {
  const [eco, name] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (eco === 'npm') return (await get(`https://registry.npmjs.org/${name}/latest`)).version;
  if (eco === 'pypi') return (await get(`https://pypi.org/pypi/${name}/json`)).info.version;
  if (eco === 'packagist') {
    const data = await get(`https://repo.packagist.org/p2/${name}.json`);
    return stableVersion(data.packages[name].map((p) => p.version));
  }
  throw new Error(`unknown ecosystem in ${id}`);
}

export function parseStripeApiVersion(source) {
  return source.match(/ApiVersion\s*=\s*['"]([^'"]+)['"]/)?.[1];
}

export function parsePlayTypes(html) {
  const types = new Set();
  for (const m of html.matchAll(/\((\d+)\)\s*SUBSCRIPTION_[A-Z_]+/g)) types.add(Number(m[1]));
  return [...types].sort((a, b) => a - b);
}

export function compare(baseline, current) {
  const changes = [];
  if (current.stripeApiVersion !== baseline.stripeApiVersion) {
    changes.push({ key: 'stripeApiVersion', what: 'Stripe API version (default of the latest stripe-node)', was: baseline.stripeApiVersion, now: current.stripeApiVersion });
  }
  const was = baseline.googlePlaySubscriptionTypes.join(', ');
  const now = current.googlePlaySubscriptionTypes.join(', ');
  if (was !== now) changes.push({ key: 'googlePlaySubscriptionTypes', what: 'Google Play subscription notification types', was, now });
  for (const [id, version] of Object.entries(baseline.packages)) {
    if (current.packages[id] !== version) changes.push({ key: id, what: `${id.replace(':', ' ')}`, was: version, now: current.packages[id] });
  }
  return changes;
}

export function report(changes, checked) {
  if (!changes.length) return '';
  const lines = [
    `The providers changed something the skills describe. The skills were last checked against them on ${checked}.`,
    '',
    '| What | Skills checked | Now |',
    '| --- | --- | --- |',
    ...changes.map((c) => `| ${c.what} | \`${c.was}\` | \`${c.now}\` |`),
    '',
    'Re-check:',
    '',
    ...changes.map((c) => `- ${c.what}: ${RECHECK[c.key]}`),
    '',
    'When the skills are right for the new version (or have been fixed), update `scripts/provider-watch.json` and close this issue.',
  ];
  return lines.join('\n') + '\n';
}

export async function current(baseline) {
  const packages = {};
  for (const id of Object.keys(baseline.packages)) packages[id] = await latestVersion(id);
  const stripeSource = await get(`https://cdn.jsdelivr.net/npm/stripe@${packages['npm:stripe']}/cjs/apiVersion.js`, 'text');
  const stripeApiVersion = parseStripeApiVersion(stripeSource);
  if (!stripeApiVersion) throw new Error('no ApiVersion in stripe-node');
  const googlePlaySubscriptionTypes = parsePlayTypes(await get(PLAY_RTDN_URL, 'text'));
  if (googlePlaySubscriptionTypes.length < 10) throw new Error(`only ${googlePlaySubscriptionTypes.length} notification types found on ${PLAY_RTDN_URL}`);
  return { stripeApiVersion, googlePlaySubscriptionTypes, packages };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  try {
    const text = report(compare(baseline, await current(baseline)), baseline.checked);
    process.stdout.write(text || 'No changes since ' + baseline.checked + '.\n');
    if (out) writeFileSync(out, text);
  } catch (err) {
    console.error(`provider-watch: ${err.message}`);
    process.exit(1);
  }
}
