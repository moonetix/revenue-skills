import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = mkdtempSync(path.join(tmpdir(), 'sync-shared-'));
after(() => rmSync(copy, { recursive: true, force: true }));

// A copy of the script and the skills, so the test can break and repair files freely.
mkdirSync(path.join(copy, 'scripts'));
cpSync(path.join(root, 'scripts', 'sync-shared.mjs'), path.join(copy, 'scripts', 'sync-shared.mjs'));
cpSync(path.join(root, 'skills'), path.join(copy, 'skills'), { recursive: true });

const sync = (...args) => spawnSync(process.execPath, [path.join(copy, 'scripts', 'sync-shared.mjs'), ...args], { encoding: 'utf8' });
const shared = [
  ['scripts/probe.mjs', 'money-audit'],
  ['references/webhook-stacks.md', 'build-webhook-endpoint'],
  ['assets/sign-test-event.mjs', 'build-webhook-endpoint'],
];

test('every shared file has its source and at least one copy, and the copies are in sync', () => {
  for (const [file, owner] of shared) {
    assert.ok(existsSync(path.join(root, 'skills', owner, file)), `${owner}/${file}`);
  }
  const stacks = path.join(root, 'skills', 'handle-refunds-and-reversals', 'references', 'webhook-stacks.md');
  assert.equal(readFileSync(stacks, 'utf8'), readFileSync(path.join(root, 'skills', 'build-webhook-endpoint', 'references', 'webhook-stacks.md'), 'utf8'));
  assert.equal(sync('--check').status, 0);
});

test('--check reports a changed or missing copy, and a sync repairs both', () => {
  const changed = path.join(copy, 'skills', 'handle-refunds-and-reversals', 'references', 'webhook-stacks.md');
  const missing = path.join(copy, 'skills', 'build-webhook-endpoint', 'scripts', 'probe.mjs');
  writeFileSync(changed, 'edited by hand\n');
  rmSync(missing);

  const stale = sync('--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /out of sync: skills\/handle-refunds-and-reversals\/references\/webhook-stacks\.md \(source: skills\/build-webhook-endpoint\//);
  assert.match(stale.stdout, /out of sync: skills\/build-webhook-endpoint\/scripts\/probe\.mjs \(source: skills\/money-audit\//);

  const fixed = sync();
  assert.equal(fixed.status, 0);
  assert.equal(readFileSync(changed, 'utf8'), readFileSync(path.join(copy, 'skills', 'build-webhook-endpoint', 'references', 'webhook-stacks.md'), 'utf8'));
  assert.equal(readFileSync(missing, 'utf8'), readFileSync(path.join(copy, 'skills', 'money-audit', 'scripts', 'probe.mjs'), 'utf8'));
  assert.equal(sync('--check').status, 0);
});

test('a skill that does not mention a shared file gets no copy', () => {
  assert.equal(existsSync(path.join(copy, 'skills', 'money-audit', 'references', 'webhook-stacks.md')), false);
  assert.equal(existsSync(path.join(copy, 'skills', 'design-reward-economy', 'scripts', 'probe.mjs')), false);
});
