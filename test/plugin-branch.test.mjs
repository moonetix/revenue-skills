import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, check, MAX_FILES, pluginFiles } from '../scripts/build-plugin-branch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(mkdtempSync(path.join(tmpdir(), 'plugin-branch-')), 'plugin');
after(() => rmSync(path.dirname(out), { recursive: true, force: true }));

const walk = (dir, rel = '') =>
  readdirSync(path.join(dir, rel)).flatMap((name) => {
    const child = path.posix.join(rel, name);
    return statSync(path.join(dir, child)).isDirectory() ? walk(dir, child) : [child];
  });

test('the plugin branch holds fewer than 150 files and nothing from the practice app, trials, examples or site', () => {
  const files = pluginFiles();
  assert.ok(files.length < MAX_FILES, `${files.length} files`);
  assert.equal(MAX_FILES, 150);
  for (const file of files) {
    assert.match(file, /^(\.claude-plugin\/|skills\/|assets\/icon\.png$|README\.md$|LICENSE$|SECURITY\.md$)/, file);
    assert.doesNotMatch(file, /^(playground|trials|examples|site)\//, file);
  }
  for (const name of readdirSync(path.join(root, 'skills'))) assert.ok(files.includes(`skills/${name}/SKILL.md`), name);
  assert.deepEqual(check(files), []);
});

test('the build writes exactly the listed files, with a marketplace that installs from the branch root', () => {
  const listed = build(out);
  assert.deepEqual(walk(out).sort(), listed);
  const marketplace = JSON.parse(readFileSync(path.join(out, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.deepEqual(marketplace.plugins.map((p) => p.source), ['./']);
  assert.equal(JSON.parse(readFileSync(path.join(out, '.claude-plugin', 'plugin.json'), 'utf8')).name, marketplace.plugins[0].name);
  const readme = readFileSync(path.join(out, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /[–—]|\p{Extended_Pictographic}|pay[- ]per[- ]result/u);
  for (const [, target] of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (!/^https?:/.test(target)) assert.ok(existsSync(path.join(out, target)), target);
  }
  assert.ok(statSync(path.join(out, 'skills', 'money-audit', 'scripts', 'probe.mjs')).mode & 0o100, 'the probe stays executable');
});

test('check() names forbidden paths and a list that is too long', () => {
  const problems = check(['trials/add-payouts/check.mjs', ...Array.from({ length: MAX_FILES }, (_, i) => `skills/x/${i}.md`)]);
  assert.ok(problems.some((p) => p.includes('trials/add-payouts/check.mjs')));
  assert.ok(problems.some((p) => p.includes('the limit')));
});

test('the script prints usage and exits with 2 without arguments', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-plugin-branch.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /Usage/);
});

test('the workflow builds with the script and force-updates only the plugin branch', () => {
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'plugin-branch.yml'), 'utf8');
  assert.match(workflow, /tags: \['v\*'\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/build-plugin-branch\.mjs/);
  const pushes = [...workflow.matchAll(/git push[^\n]*/g)].map((m) => m[0]);
  assert.deepEqual(pushes, ['git push --force origin "$commit:refs/heads/plugin"']);
  assert.equal([...workflow.matchAll(/contents: write/g)].length, 1);
  for (const [, ref] of workflow.matchAll(/uses: [\w.-]+\/[\w.-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
});
