#!/usr/bin/env node
// validate-trials.mjs: show that every trial checker measures what it claims.
//
// For each skill in trials/expected.json, the checker runs against trials/<skill>/_reference/,
// which must pass every check, and against trials/<skill>/_naive/, which must fail exactly the
// checks listed in expected.json and pass the others. The checkers run one at a time.
//
// Usage: node scripts/validate-trials.mjs [skill ...]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trials = join(root, 'trials');
const expected = JSON.parse(readFileSync(join(trials, 'expected.json'), 'utf8'));
const wanted = process.argv.slice(2);
for (const name of wanted) {
  if (!expected[name]) {
    console.error(`usage: node scripts/validate-trials.mjs [skill ...]\nno trial named ${name}; known: ${Object.keys(expected).join(', ')}`);
    process.exit(2);
  }
}

const { TRIAL_EXTRA_ENV, ...env } = process.env;
const run = (skill, variant) => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(trials, skill, 'check.mjs'), join(trials, skill, variant)], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 240_000,
  });
  const lines = result.stdout.split('\n');
  const ids = (verdict) => lines.filter((l) => l.startsWith(`${verdict} `)).map((l) => l.split(' ')[1]);
  return { status: result.status, pass: ids('PASS'), fail: ids('FAIL'), seconds: Math.round((Date.now() - started) / 1000), output: result.stdout + result.stderr };
};

let problems = 0;
for (const [skill, { checks, naive_fails: naiveFails }] of Object.entries(expected)) {
  if (wanted.length && !wanted.includes(skill)) continue;

  const ref = run(skill, '_reference');
  const refOk = ref.status === 0 && ref.fail.length === 0 && ref.pass.length === checks;
  console.log(`${refOk ? 'ok  ' : 'BAD '} ${skill} _reference: ${ref.pass.length}/${checks} passed (${ref.seconds} s)`);

  const naive = run(skill, '_naive');
  const total = naive.pass.length + naive.fail.length;
  const unexpected = naive.fail.filter((id) => !naiveFails.includes(id));
  const missed = naiveFails.filter((id) => !naive.fail.includes(id));
  const naiveOk = naive.status === 1 && total === checks && unexpected.length === 0 && missed.length === 0;
  console.log(`${naiveOk ? 'ok  ' : 'BAD '} ${skill} _naive: fails ${naive.fail.join(' ') || 'nothing'} (${naive.seconds} s)`);

  if (!refOk) {
    problems += 1;
    console.log(`     _reference should pass all ${checks} checks and exit with 0 (exit ${ref.status}):\n${indent(ref.output)}`);
  }
  if (!naiveOk) {
    problems += 1;
    if (unexpected.length) console.log(`     _naive failed checks it should pass: ${unexpected.join(' ')}`);
    if (missed.length) console.log(`     _naive passed checks it should fail: ${missed.join(' ')}`);
    if (total !== checks || naive.status !== 1) console.log(`     _naive ran ${total} of ${checks} checks, exit ${naive.status}:\n${indent(naive.output)}`);
  }
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}.` : '\nEvery checker passes its reference and catches its naive solution as documented.');
process.exitCode = problems ? 1 : 0;

function indent(text) {
  return text
    .trim()
    .split('\n')
    .slice(-25)
    .map((line) => `       ${line}`)
    .join('\n');
}
