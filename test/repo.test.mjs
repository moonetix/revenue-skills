import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateAll } from '../scripts/validate-skills.mjs';
import { CLASSES } from '../skills/money-audit/scripts/validate-findings.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const key = JSON.parse(read('playground/answers.json'));

test('every skill passes validation', () => {
  const { names, errors } = validateAll();
  assert.deepEqual(errors, []);
  assert.ok(names.includes('money-audit'));
});

test('the shared probe script is identical in every skill that uses it', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-shared.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout);
});

test('the answer key, its table and the exploits list the same bugs', () => {
  const ids = key.bugs.map((b) => b.id);
  assert.equal(ids.length, 17);
  assert.equal(new Set(ids).size, 17);
  const table = [...read('playground/ANSWER-KEY.md').matchAll(/^\| (V\d\d) \| ([a-z-]+) \|/gm)];
  assert.deepEqual(table.map((m) => m[1]), ids);
  for (const [, id, cls] of table) assert.equal(key.bugs.find((b) => b.id === id).classes[0], cls, id);
  const exploits = [...read('test/playground.test.mjs').matchAll(/id: '(V\d\d)'/g)].map((m) => m[1]);
  assert.deepEqual(exploits, ids);
});

test('every class has a planted bug, a reference file and a row in the skill', () => {
  const skill = read('skills/money-audit/SKILL.md');
  for (const name of CLASSES) {
    assert.ok(key.bugs.some((b) => b.classes[0] === name), `no planted bug for ${name}`);
    assert.ok(existsSync(path.join(root, 'skills/money-audit/references', `${name}.md`)), `no reference for ${name}`);
    assert.ok(skill.includes(`\`${name}\``), `SKILL.md does not list ${name}`);
    assert.ok(read(`skills/money-audit/references/${name}.md`).includes(`**Class id:** \`${name}\``));
  }
  const schema = JSON.parse(read('skills/money-audit/assets/findings.schema.json'));
  assert.deepEqual(schema.$defs.class.enum, CLASSES);
});

test('answer key locations point at real lines', () => {
  for (const bug of key.bugs) {
    for (const loc of bug.locations) {
      if (loc.file === '*') continue;
      const lines = read(`playground/vulnerable/${loc.file}`).split('\n').length;
      assert.ok(loc.from >= 1 && loc.to <= lines && loc.from <= loc.to, `${bug.id} ${loc.file}:${loc.from}-${loc.to} (${lines} lines)`);
    }
  }
  for (const [, file, line] of read('playground/ANSWER-KEY.md').matchAll(/`((?:routes|lib|public)\/[\w.]+|config\.mjs|db\.mjs):(\d+)`/g)) {
    assert.ok(Number(line) <= read(`playground/vulnerable/${file}`).split('\n').length, `${file}:${line}`);
  }
});

test('the vulnerable app carries no hints and the skills carry no spoilers', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(path.join(root, 'playground', 'vulnerable'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(bug|vulnerab|exploit|insecure|unsafe|todo|fixme|V\d\d)\b/i, file);
  }
  for (const file of walk(path.join(root, 'skills'))) {
    if (!/\.(md|json)$/.test(file) || file.endsWith(path.join('money-audit', 'evals', 'evals.json'))) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /coinjar|paylane|offerly/i, file);
  }
});

test('public text follows the house style', () => {
  const files = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'playground/README.md', 'playground/ANSWER-KEY.md'];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /[–—]/, `${file} has an em or en dash`);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${file} has an emoji`);
    assert.doesNotMatch(text, /pay[- ]per[- ]result/i, file);
  }
});

test('versions agree', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('.claude-plugin/marketplace.json')).metadata.version, version);
  assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
  for (const name of readdirSync(path.join(root, 'skills'))) {
    assert.match(read(`skills/${name}/SKILL.md`), new RegExp(`version: "${version.replace(/\./g, '\\.')}"`), name);
  }
});
