#!/usr/bin/env node
// score.mjs: compare a money-audit findings.json for playground/vulnerable with the answer key.
// A planted bug counts as found when a finding of a matching class points at its code
// (the finding's location or any step of its trace).
// Usage: node playground/score.mjs <findings.json> [--json]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SLACK = 3;
const here = path.dirname(fileURLToPath(import.meta.url));

export function score(report, key) {
  const spots = (finding) => [finding.location, ...(finding.proof?.steps ?? [])].filter(Boolean);
  const hits = (finding, bug) =>
    bug.classes.includes(finding.class) &&
    spots(finding).some((spot) =>
      bug.locations.some(
        (loc) => (loc.file === '*' || loc.file === spot.file) && spot.line >= loc.from - SLACK && spot.line <= loc.to + SLACK,
      ),
    );
  const found = [];
  const missed = [];
  const used = new Set();
  for (const bug of key.bugs) {
    const matches = report.findings.filter((finding) => hits(finding, bug));
    if (matches.length) {
      found.push({ id: bug.id, title: bug.title, by: matches.map((f) => f.id) });
      for (const f of matches) used.add(f.id);
    } else missed.push({ id: bug.id, title: bug.title });
  }
  const extra = report.findings.filter((f) => !used.has(f.id)).map((f) => ({ id: f.id, class: f.class, title: f.title }));
  return { planted: key.bugs.length, found, missed, extra };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node playground/score.mjs <findings.json> [--json]');
    process.exitCode = 2;
    return;
  }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const key = JSON.parse(readFileSync(path.join(here, 'answers.json'), 'utf8'));
  const result = score(report, key);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Found ${result.found.length} of ${result.planted} planted bugs.\n`);
  for (const bug of result.found) console.log(`  found   ${bug.id}  ${bug.title}  (${bug.by.join(', ')})`);
  for (const bug of result.missed) console.log(`  MISSED  ${bug.id}  ${bug.title}`);
  if (result.extra.length) {
    console.log('\nFindings that match no planted bug. Read them: some are real weaknesses the key does not list.');
    for (const f of result.extra) console.log(`  ${f.id}  [${f.class}]  ${f.title}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
