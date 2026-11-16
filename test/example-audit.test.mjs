// The audit in examples/coinjar-audit/ is published as it was written. It has to stay a valid
// report of playground/vulnerable: every quoted line still where it says, every planted bug found.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { score } from '../playground/score.mjs';
import { validate } from '../skills/money-audit/scripts/validate-findings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(readFileSync(join(root, 'examples', 'coinjar-audit', 'findings.json'), 'utf8'));

test('the example audit passes the validator against the app it describes', () => {
  // The audit ran inside a copy of the app, with its output in money-audit/. Rebuild that layout.
  const project = mkdtempSync(join(tmpdir(), 'coinjar-audit-'));
  try {
    cpSync(join(root, 'playground', 'vulnerable'), project, { recursive: true });
    cpSync(join(root, 'examples', 'coinjar-audit'), join(project, 'money-audit'), { recursive: true });
    assert.deepEqual(validate(report, project).errors, []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the example audit finds every planted bug', () => {
  const key = JSON.parse(readFileSync(join(root, 'playground', 'answers.json'), 'utf8'));
  const result = score(report, key);
  assert.deepEqual(result.missed, []);
  assert.equal(result.found.length, key.bugs.length);
  assert.equal(new Set(result.found.map((bug) => bug.by)).size, key.bugs.length);
});
