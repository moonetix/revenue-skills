#!/usr/bin/env node
// score.mjs: compare a money-audit findings.json for playground/vulnerable with the answer key.
// A finding points at a planted bug when its class is one of the bug's classes and its location,
// or any step of its trace, falls on the bug's code. Each finding counts for at most one bug:
// findings and bugs are paired with a maximum matching, so one broad finding cannot score
// several bugs at once.
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
  const candidates = key.bugs.map((bug) => report.findings.filter((finding) => hits(finding, bug)).map((f) => f.id));

  // Augmenting paths (Kuhn's algorithm): small enough here to need nothing faster.
  const owner = new Map();
  const assign = (b, seen) => {
    for (const id of candidates[b]) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!owner.has(id) || assign(owner.get(id), seen)) {
        owner.set(id, b);
        return true;
      }
    }
    return false;
  };
  key.bugs.forEach((_, b) => assign(b, new Set()));
  const matchedBy = new Map([...owner].map(([id, b]) => [b, id]));

  const found = [];
  const missed = [];
  key.bugs.forEach((bug, b) => {
    if (matchedBy.has(b)) {
      const by = matchedBy.get(b);
      found.push({ id: bug.id, title: bug.title, by, related: candidates[b].filter((id) => id !== by) });
    } else missed.push({ id: bug.id, title: bug.title });
  });
  const pointing = new Set(candidates.flat());
  const extra = report.findings.filter((f) => !pointing.has(f.id)).map((f) => ({ id: f.id, class: f.class, title: f.title }));
  return { planted: key.bugs.length, findings: report.findings.length, onTarget: pointing.size, found, missed, extra };
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
  console.log(`Found ${result.found.length} of ${result.planted} planted bugs, each by a different finding.`);
  console.log(`${result.onTarget} of ${result.findings} findings point at a planted bug.\n`);
  for (const bug of result.found) {
    const also = bug.related.length ? `, also ${bug.related.join(', ')}` : '';
    console.log(`  found   ${bug.id}  ${bug.title}  (${bug.by}${also})`);
  }
  for (const bug of result.missed) console.log(`  MISSED  ${bug.id}  ${bug.title}`);
  if (result.extra.length) {
    console.log('\nFindings that point at no planted bug. Read them: some are real weaknesses the key does not list.');
    for (const f of result.extra) console.log(`  ${f.id}  [${f.class}]  ${f.title}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
