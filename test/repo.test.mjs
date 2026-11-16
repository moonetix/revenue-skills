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
    if (!/\.(md|json|mjs)$/.test(file)) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /coinjar|paylane|offerly|debug=1/i, file);
  }
});

test('public text follows the house style', () => {
  const files = [
    'README.md',
    'AGENTS.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'playground/README.md',
    'playground/ANSWER-KEY.md',
    'examples/coinjar-audit/README.md',
    'examples/referral-engine-audit/README.md',
    'site/index.html',
    'docs/social-preview.html',
    'trials/README.md',
  ];
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
  for (const manifest of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'gemini-extension.json']) {
    assert.equal(JSON.parse(read(manifest)).version, version, manifest);
  }
  assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
  for (const name of readdirSync(path.join(root, 'skills'))) {
    assert.match(read(`skills/${name}/SKILL.md`), new RegExp(`version: "${version.replace(/\./g, '\\.')}"`), name);
  }
});

test('plugin manifests use only the fields their formats define', () => {
  const portable = JSON.parse(read('plugin.json'));
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  const allowed = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  for (const key of Object.keys(portable)) assert.ok(allowed.includes(key), `plugin.json: ${key}`);
  assert.match(portable.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  for (const key of Object.keys(marketplace.metadata)) assert.ok(['description', 'version', 'pluginRoot'].includes(key), `marketplace metadata: ${key}`);
  // Claude Code: https://code.claude.com/docs/en/plugins-reference (fields table).
  const claude = JSON.parse(read('.claude-plugin/plugin.json'));
  // The directory listing fields are read by Anthropic's plugin directory and ignored by Claude Code at load.
  const claudeFields = ['name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];
  const listingFields = ['icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl'];
  for (const key of Object.keys(claude)) assert.ok([...claudeFields, ...listingFields].includes(key), `.claude-plugin/plugin.json: ${key}`);
  assert.ok(existsSync(path.join(root, claude.icon)), 'the icon is in the repository');
  for (const key of listingFields.filter((k) => k.endsWith('Url') && claude[k])) assert.match(claude[key], /^https:\/\//, key);
  assert.equal(claude.skills, undefined, 'skills/ is scanned by default');
  assert.equal(claude.name, portable.name);
  assert.equal(claude.displayName, 'Revenue Skills');
  for (const plugin of marketplace.plugins) assert.equal(plugin.source, './', 'the plugin branch reuses this marketplace file');
  // Codex: https://developers.openai.com/plugins/deploy/submission (listing metadata, Codex format).
  const codex = JSON.parse(read('.codex-plugin/plugin.json'));
  const codexFields = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'skills', 'interface'];
  for (const key of Object.keys(codex)) assert.ok(codexFields.includes(key), `.codex-plugin/plugin.json: ${key}`);
  assert.equal(codex.name, portable.name);
  assert.equal(codex.skills, './skills/');
  const ui = codex.interface;
  const uiFields = ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'capabilities', 'websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL', 'defaultPrompt', 'brandColor', 'brandColorDark', 'composerIcon', 'composerIconDark', 'logo', 'logoDark', 'screenshots'];
  for (const key of Object.keys(ui)) assert.ok(uiFields.includes(key), `.codex-plugin/plugin.json interface: ${key}`);
  for (const key of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'capabilities', 'composerIcon', 'logo']) {
    assert.ok(ui[key] !== undefined, `interface.${key} is required in the Codex format`);
  }
  assert.equal(ui.displayName, claude.displayName);
  assert.ok(ui.displayName.length <= 30 && ui.shortDescription.length <= 30, 'displayName and shortDescription: 30 characters at most');
  assert.ok(ui.longDescription.length <= 4000 && ui.developerName.length <= 80);
  assert.ok(Array.isArray(ui.capabilities) && ui.capabilities.length <= 20 && ui.capabilities.every((c) => c.length <= 120));
  assert.ok(Array.isArray(ui.defaultPrompt) && ui.defaultPrompt.length >= 1 && ui.defaultPrompt.length <= 3);
  assert.equal(new Set(ui.defaultPrompt).size, ui.defaultPrompt.length);
  for (const prompt of ui.defaultPrompt) assert.ok(prompt.length <= 128 && !prompt.includes('@'), prompt);
  for (const key of ['brandColor', 'brandColorDark']) if (ui[key]) assert.match(ui[key], /^#[0-9a-f]{6}$/i, key);
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) if (ui[key]) assert.match(ui[key], /^https:\/\//, key);
  for (const key of ['composerIcon', 'composerIconDark', 'logo', 'logoDark']) {
    if (!ui[key]) continue;
    assert.match(ui[key], /^\.\/[\w./-]+\.(png|jpe?g|webp|svg)$/, key);
    assert.ok(existsSync(path.join(root, ui[key])), `${key}: ${ui[key]} is missing`);
    if (ui[key].endsWith('.svg')) {
      const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(read(ui[key])) || [];
      assert.ok(w === h && Number(w) >= 48, `${key} needs a square viewBox of at least 48`);
    }
  }
  const gemini = JSON.parse(read('gemini-extension.json'));
  assert.equal(gemini.name, portable.name);
});

test('the Codex package has a lockfile and leaves the repository tooling out', () => {
  const lock = JSON.parse(read('package-lock.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version, 'run npm install --package-lock-only after a version change');
  assert.deepEqual(Object.keys(lock.packages), [''], 'no dependencies');
  const ignored = read('.codexignore').split('\n').filter(Boolean);
  for (const dir of ['playground/', 'trials/', 'examples/', 'site/', 'test/']) assert.ok(ignored.includes(dir), dir);
  assert.ok(!ignored.some((line) => /^(skills|assets|\.codex-plugin)\b/.test(line)), 'the package keeps skills, assets and its manifest');
});

test('the demo page has a link preview, and the social preview image is 1280 by 640 and under 1 MB', () => {
  const html = read('site/index.html');
  assert.match(html, /<meta property="og:image" content="\{\{PAGE_URL\}\}\{\{OG_IMAGE\}\}">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  const build = read('scripts/build-site.mjs');
  assert.match(build, /const PAGE_URL = 'https:\/\/moonetix\.github\.io\/revenue-skills\/';/);
  assert.match(build, /const OG_IMAGE = 'social-preview\.png';/);
  const png = readFileSync(path.join(root, 'docs', 'social-preview.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 640]);
  assert.ok(png.length < 1024 * 1024, `${png.length} bytes`);
  assert.equal(html.match(/Moonetix<\/a>, an affiliate network/g).length, 1, 'one maintainer credit');
  assert.doesNotMatch(html, /Made by/);
});

test('the CI scanner job uses the pinned action and threshold from the awesome-codex-plugins guide', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /uses: hashgraph-online\/ai-plugin-scanner-action@caba2e96aa8ad2feb6cf6fca52442b52e22e779f # v1\.2\.635/);
  assert.match(ci, /min_score: 75\n/);
  for (const file of ['ci.yml', 'pages.yml', 'plugin-branch.yml']) {
    for (const [, ref] of read(`.github/workflows/${file}`).matchAll(/uses: [\w.-]+\/[\w.-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/, file);
  }
});

test('every builder skill has a trial, and the trials are listed in expected.json', () => {
  const builders = readdirSync(path.join(root, 'skills')).filter((name) => name !== 'money-audit').sort();
  for (const name of builders) {
    for (const part of ['TASK.md', 'check.mjs', 'RUBRIC.md', 'workspace/server.mjs', '_reference/server.mjs', '_naive/server.mjs']) {
      assert.ok(existsSync(path.join(root, 'trials', name, part)), `trials/${name}/${part} is missing`);
    }
  }
  const expected = JSON.parse(read('trials/expected.json'));
  assert.deepEqual(Object.keys(expected).sort(), builders);
  for (const [name, { checks, naive_fails: fails }] of Object.entries(expected)) {
    const rows = [...read(`trials/${name}/RUBRIC.md`).matchAll(/^\| ([A-Z]\d\d(?:, [A-Z]\d\d)*) \|/gm)];
    const ids = new Set(rows.flatMap((m) => m[1].split(', ')));
    assert.equal(ids.size, checks, `trials/${name}/RUBRIC.md lists ${ids.size} checks, expected.json says ${checks}`);
    for (const id of fails) assert.ok(ids.has(id), `${name}: ${id} is not a check in RUBRIC.md`);
  }
});

test('trials/ holds no machine paths', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? (name === '.run' ? [] : walk(full)) : [full];
    });
  for (const file of walk(path.join(root, 'trials'))) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /(?<![\w.])\/(?:root|home|tmp|Users|var|opt|private|mnt|srv)\//, file);
    assert.doesNotMatch(text, /\b[A-Z]:\\/, file);
    assert.doesNotMatch(text, /\bflock\b|heavy\.lock|\.scratch/, file);
  }
});
