import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from '../skills/money-audit/scripts/render-report.mjs';
import { CLASSES, validate } from '../skills/money-audit/scripts/validate-findings.mjs';
import { score } from '../playground/score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', 'playground', 'vulnerable');
const fixture = path.join(here, 'fixtures', 'sample-findings.json');
const scripts = path.join(here, '..', 'skills', 'money-audit', 'scripts');
const sample = () => JSON.parse(readFileSync(fixture, 'utf8'));
const errorsOf = (change) => {
  const report = sample();
  change(report);
  return validate(report, root).errors;
};

test('the sample report is valid', () => {
  const { errors, warnings } = validate(sample(), root);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('a snippet that is not at the stated line is rejected, with the real line as a hint', () => {
  const errors = errorsOf((r) => {
    r.findings[0].location.line = 20;
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /snippet not found at routes\/webhooks\.mjs:20\. The text is at line 8\./);
});

test('a snippet two lines away still matches, whitespace is ignored', () => {
  assert.deepEqual(
    errorsOf((r) => {
      r.findings[0].location.line = 10;
      r.findings[0].location.snippet = 'if (signature   &&   !verifyPaylaneSignature(';
    }),
    [],
  );
});

test('invented code is rejected', () => {
  const errors = errorsOf((r) => {
    r.findings[0].location.snippet = 'if (!verifySignatureAtAll(request)) return;';
  });
  assert.match(errors[0], /The text is not in that file/);
});

test('files outside the project root are rejected', () => {
  for (const file of ['../fixed/routes/webhooks.mjs', '/etc/hostname', 'routes/missing.mjs']) {
    const errors = errorsOf((r) => {
      r.findings[0].location.file = file;
    });
    assert.match(errors[0], /does not exist under the project root/);
  }
});

test('a finding needs a proof of a known kind', () => {
  assert.match(errorsOf((r) => delete r.findings[0].proof)[0], /proof\.kind must be one of probe, test, trace/);
  assert.match(errorsOf((r) => (r.findings[0].proof.result = 'it works'))[0], /proof\.result must say what the run showed/);
  assert.match(errorsOf((r) => r.findings[1].proof.steps.pop())[0], /a trace needs at least two steps/);
  assert.match(
    errorsOf((r) => (r.findings[0].proof = { kind: 'test', file: 'test/none.test.mjs', command: 'node --test', result: 'The test fails: balance 1000, expected 500.' }))[0],
    /test file "test\/none\.test\.mjs" does not exist/,
  );
});

test('trace steps are checked like locations', () => {
  const errors = errorsOf((r) => {
    r.findings[1].proof.steps[0].snippet = 'balance INTEGER NOT NULL';
  });
  assert.match(errors[0], /trace step 1: snippet not found at db\.mjs:8/);
});

test('every class must be accounted for exactly once', () => {
  assert.match(errorsOf((r) => r.coverage.pop() && r.findings.pop())[0], /class "ledger-and-audit-trail" is not accounted for/);
  assert.match(errorsOf((r) => r.coverage.push(r.coverage[1]))[0], /listed twice/);
});

test('coverage must agree with the findings', () => {
  assert.match(errorsOf((r) => (r.coverage[0].status = 'clear'))[0], /there are findings in this class/);
  assert.match(errorsOf((r) => (r.coverage[1].status = 'finding'))[0], /no finding has this class/);
  assert.match(errorsOf((r) => (r.coverage[1].note = 'fine'))[0], /note must say why the class is clear/);
  assert.match(errorsOf((r) => (r.coverage[1].examined = []))[0], /examined must list the files/);
});

test('field rules', () => {
  assert.match(errorsOf((r) => (r.findings[1].id = 'MA-01'))[0], /duplicate id/);
  assert.match(errorsOf((r) => (r.findings[0].severity = 'severe'))[0], /severity must be one of/);
  assert.match(errorsOf((r) => (r.findings[0].class = 'xss'))[0], /unknown class "xss"/);
  assert.match(errorsOf((r) => (r.findings[0].impact = 'bad'))[0], /impact must say what is lost/);
  assert.match(errorsOf((r) => (r.date = 'yesterday'))[0], /date must be YYYY-MM-DD/);
});

test('a critical finding that was only traced gets a warning, not an error', () => {
  const report = sample();
  report.findings[0].proof = {
    kind: 'trace',
    steps: [
      { file: 'routes/webhooks.mjs', line: 7, snippet: "const signature = ctx.req.headers['paylane-signature'];", note: 'The header is read and may be absent.' },
      { file: 'routes/webhooks.mjs', line: 21, snippet: 'UPDATE users SET balance = balance + ?', note: 'The credit runs without a verified signature.' },
    ],
  };
  const { errors, warnings } = validate(report, root);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MA-01: critical severity rests on a code trace only/);
});

test('a missing ledger can only be traced, so it gets no warning', () => {
  const report = sample();
  report.findings[1].severity = 'high';
  assert.deepEqual(validate(report, root), { errors: [], warnings: [] });
});

test('unknown fields are rejected', () => {
  assert.match(errorsOf((r) => (r.summary = 'all good'))[0], /report: unknown field "summary"/);
  assert.match(errorsOf((r) => (r.findings[0].cvss = 9.8))[0], /finding MA-01: unknown field "cvss"/);
  assert.match(errorsOf((r) => (r.findings[0].location.column = 4))[0], /location: unknown field "column"/);
  assert.match(errorsOf((r) => (r.findings[0].proof.steps = []))[0], /proof: unknown field "steps"/);
  assert.match(errorsOf((r) => (r.coverage[1].confidence = 'high'))[0], /coverage duplicate-credit: unknown field "confidence"/);
});

test('environment and notes are optional and rendered', () => {
  const report = sample();
  report.environment = 'PORT=8842 node server.mjs, default test configuration, in-memory database.';
  report.notes = ['Outside this audit: the session token never expires.'];
  assert.deepEqual(validate(report, root).errors, []);
  const text = render(report);
  assert.match(text, /\*\*How the app was run\.\*\* PORT=8842 node server\.mjs/);
  assert.match(text, /## Notes\n\n- Outside this audit: the session token never expires\./);
  assert.match(errorsOf((r) => (r.notes = 'one string'))[0], /notes must be a list of sentences/);
});

test('command line: exit codes and messages', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(scripts, 'validate-findings.mjs'), ...args], { encoding: 'utf8' });
  const ok = run(fixture, '--root', root);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^VALID: 2 findings \(1 critical, 0 high, 1 medium, 0 low\), all 10 classes accounted for\.$/m);
  const wrongRoot = run(fixture, '--root', here);
  assert.equal(wrongRoot.status, 1);
  assert.match(wrongRoot.stdout, /INVALID: \d+ problems/);
  assert.equal(run().status, 2);
  assert.equal(run(path.join(here, 'missing.json')).status, 2);
});

test('the report renders every finding and all ten classes', () => {
  const text = render(sample());
  assert.match(text, /^# Money audit: coinjar$/m);
  assert.match(text, /\*\*2 findings:\*\* 1 critical, 0 high, 1 medium, 0 low\./);
  assert.ok(text.indexOf('### MA-01') < text.indexOf('### MA-02'), 'findings are ordered by severity');
  assert.match(text, /Traced in code, not run/);
  assert.equal(text.split('\n').filter((line) => /^\| (Unverified|Duplicate|Races|Amounts|Money|Refunds|Promo|Payout|Secrets|Ledger)/.test(line)).length, CLASSES.length);
  const cli = execFileSync(process.execPath, [path.join(scripts, 'render-report.mjs'), fixture, '--root', root], { encoding: 'utf8' });
  assert.equal(cli, text);
});

test('the renderer refuses an invalid file', () => {
  const run = spawnSync(process.execPath, [path.join(scripts, 'render-report.mjs'), fixture, '--root', here], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Not rendering/);
});

test('scoring against the answer key', () => {
  const key = JSON.parse(readFileSync(path.join(here, '..', 'playground', 'answers.json'), 'utf8'));
  const result = score(sample(), key);
  assert.equal(result.planted, 17);
  assert.deepEqual(result.found.map((b) => b.id), ['V01', 'V17']);
  assert.equal(result.missed.length, 15);
  assert.deepEqual(result.extra, []);
  const offKey = sample();
  offKey.findings[0].class = 'payout-controls';
  assert.deepEqual(score(offKey, key).extra.map((f) => f.id), ['MA-01']);
});
