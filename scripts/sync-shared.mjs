#!/usr/bin/env node
// A skill can be installed without its siblings, so each skill that tells the agent to run
// scripts/probe.mjs carries its own copy. The copy in skills/money-audit is the source.
// Usage: node scripts/sync-shared.mjs          copy
//        node scripts/sync-shared.mjs --check  fail when a copy is missing or differs
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skills = path.join(root, 'skills');
const SHARED = 'scripts/probe.mjs';
const source = readFileSync(path.join(skills, 'money-audit', SHARED), 'utf8');
const check = process.argv.includes('--check');

let stale = 0;
for (const name of readdirSync(skills).sort()) {
  if (name === 'money-audit') continue;
  const skillFile = path.join(skills, name, 'SKILL.md');
  if (!existsSync(skillFile) || !readFileSync(skillFile, 'utf8').includes(SHARED)) continue;
  const target = path.join(skills, name, SHARED);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === source) continue;
  if (check) {
    stale += 1;
    console.log(`out of sync: skills/${name}/${SHARED}`);
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, { mode: 0o755 });
    console.log(`updated skills/${name}/${SHARED}`);
  }
}
if (check && stale) {
  console.log('\nRun "node scripts/sync-shared.mjs" and commit the result.');
  process.exitCode = 1;
}
