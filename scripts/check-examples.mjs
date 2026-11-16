#!/usr/bin/env node
// check-examples.mjs: check both example audits against the code they describe.
//
// examples/coinjar-audit/ was written inside a copy of playground/vulnerable, with its output in
// money-audit/. The check rebuilds that layout, runs the validator and scores it.
//
// examples/referral-engine-audit/ was written inside a copy of referral-engine whose library code
// is that of tag v1.0.0. The check exports v1.0.0, adds the tests the agent wrote, runs the
// validator, then runs those tests: they must fail on v1.0.0 and pass on v1.0.1, the release
// that fixed the findings.
//
// Usage: node scripts/check-examples.mjs [--referral-engine <git checkout>]
//        Without --referral-engine, the repository is cloned from GitHub into a temporary folder.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from '../playground/score.mjs';
import { SEVERITIES, validate } from '../skills/money-audit/scripts/validate-findings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERRAL_ENGINE = 'https://github.com/moonetix/referral-engine.git';
const TAGS = { audited: ['v1.0.0', 'fcd13a48eb8768b50da86b562157896913283ed6'], fixed: ['v1.0.1', '1a3c047591b6f39c22fd3103db10d9bc2fb21c66'] };
const AGENT_TESTS = ['test/payout-timestamps.test.js', 'test/store-without-lock.test.js'];

const work = mkdtempSync(join(tmpdir(), 'revenue-skills-examples-'));
let problems = 0;
const fail = (message) => {
  problems += 1;
  console.log(`  FAIL  ${message}`);
};
const ok = (message) => console.log(`  ok    ${message}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  return result;
}

function checkReport(report, project) {
  const { errors, warnings } = validate(report, project);
  for (const warning of warnings) console.log(`        warning: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.log(`        error: ${error}`);
    fail(`validator: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
    return;
  }
  const counts = SEVERITIES.map((s) => `${report.findings.filter((f) => f.severity === s).length} ${s}`).join(', ');
  ok(`validator: VALID, ${report.findings.length} findings (${counts})`);
}

function coinjar() {
  console.log('examples/coinjar-audit/ against playground/vulnerable/');
  const report = JSON.parse(readFileSync(join(root, 'examples', 'coinjar-audit', 'findings.json'), 'utf8'));
  const project = join(work, 'coinjar');
  cpSync(join(root, 'playground', 'vulnerable'), project, { recursive: true });
  cpSync(join(root, 'examples', 'coinjar-audit'), join(project, 'money-audit'), { recursive: true });
  checkReport(report, project);
  const key = JSON.parse(readFileSync(join(root, 'playground', 'answers.json'), 'utf8'));
  const result = score(report, key);
  const line = `scorer: ${result.found.length} of ${result.planted} planted bugs found, each by a different finding; ${result.onTarget} of ${result.findings} findings point at a planted bug`;
  if (result.missed.length) fail(`${line}; missed ${result.missed.map((b) => b.id).join(', ')}`);
  else ok(line);
}

function exportTag(repo, [tag, commit], into) {
  const resolved = run('git', ['-C', repo, 'rev-parse', `${tag}^{commit}`]).stdout.trim();
  if (resolved !== commit) throw new Error(`${tag} is ${resolved || 'missing'} in ${repo}, expected ${commit}`);
  const archive = run('git', ['-C', repo, 'archive', '--format=tar', tag], { encoding: 'buffer' });
  if (archive.status !== 0) throw new Error(`git archive ${tag} failed`);
  mkdirSync(into, { recursive: true });
  if (run('tar', ['-x', '-C', into], { input: archive.stdout }).status !== 0) throw new Error(`could not unpack ${tag}`);
}

function agentTests(project) {
  const result = run(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...AGENT_TESTS], { cwd: project });
  const count = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(result.stdout)?.[1] ?? NaN);
  return { pass: count('pass'), fail: count('fail') };
}

function referralEngine(checkout) {
  console.log('examples/referral-engine-audit/ against referral-engine');
  let repo = checkout;
  if (!repo) {
    repo = join(work, 'referral-engine.git');
    const clone = run('git', ['clone', '--quiet', '--bare', REFERRAL_ENGINE, repo]);
    if (clone.status !== 0) {
      fail(`could not clone ${REFERRAL_ENGINE}: ${clone.stderr.trim()}. Pass --referral-engine <checkout> to use a local copy.`);
      return;
    }
  }
  const example = join(root, 'examples', 'referral-engine-audit');
  const report = JSON.parse(readFileSync(join(example, 'findings.json'), 'utf8'));
  const audited = join(work, 'audited');
  const fixed = join(work, 'fixed');
  exportTag(repo, TAGS.audited, audited);
  exportTag(repo, TAGS.fixed, fixed);
  for (const project of [audited, fixed]) cpSync(join(example, 'project'), project, { recursive: true });
  cpSync(example, join(audited, 'money-audit'), { recursive: true });
  checkReport(report, audited);

  const before = agentTests(audited);
  const after = agentTests(fixed);
  const total = before.pass + before.fail;
  if (before.fail > 0 && before.pass === 0) ok(`the agent's tests fail on ${TAGS.audited[0]}: ${before.fail} of ${total} failing`);
  else fail(`the agent's tests should fail on ${TAGS.audited[0]}: ${before.pass} passing, ${before.fail} failing`);
  if (after.fail === 0 && after.pass === total) ok(`the same tests pass on ${TAGS.fixed[0]}: ${after.pass} of ${total} passing`);
  else fail(`the agent's tests should pass on ${TAGS.fixed[0]}: ${after.pass} passing, ${after.fail} failing`);
}

try {
  const at = process.argv.indexOf('--referral-engine');
  if (at >= 0 && !process.argv[at + 1]) {
    console.error('Usage: node scripts/check-examples.mjs [--referral-engine <git checkout>]');
    process.exitCode = 2;
  } else {
    coinjar();
    console.log('');
    referralEngine(at >= 0 ? resolve(process.argv[at + 1]) : null);
    console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}.` : '\nBoth examples hold.');
    process.exitCode = problems ? 1 : 0;
  }
} catch (err) {
  console.log(`  FAIL  ${err.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
