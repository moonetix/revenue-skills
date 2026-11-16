#!/usr/bin/env node
// A skill can be installed without its siblings, so each skill that uses a shared file
// carries its own copy. Each entry below names the file and the skill that holds the source;
// every other skill whose SKILL.md mentions the file's path gets a copy.
// Usage: node scripts/sync-shared.mjs          copy
//        node scripts/sync-shared.mjs --check  fail when a copy is missing or differs
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skills = path.join(root, 'skills');
const SHARED = [
  { file: 'scripts/probe.mjs', source: 'money-audit', mode: 0o755 },
  { file: 'references/webhook-stacks.md', source: 'build-webhook-endpoint', mode: 0o644 },
];
const check = process.argv.includes('--check');

let stale = 0;
for (const { file, source: owner, mode } of SHARED) {
  const source = readFileSync(path.join(skills, owner, file), 'utf8');
  for (const name of readdirSync(skills).sort()) {
    if (name === owner) continue;
    const skillFile = path.join(skills, name, 'SKILL.md');
    if (!existsSync(skillFile) || !readFileSync(skillFile, 'utf8').includes(file)) continue;
    const target = path.join(skills, name, file);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === source) continue;
    if (check) {
      stale += 1;
      console.log(`out of sync: skills/${name}/${file} (source: skills/${owner}/${file})`);
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, { mode });
      console.log(`updated skills/${name}/${file}`);
    }
  }
}
if (check && stale) {
  console.log('\nRun "node scripts/sync-shared.mjs" and commit the result.');
  process.exitCode = 1;
}
