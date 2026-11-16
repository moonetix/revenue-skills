#!/usr/bin/env node
// Writes the contents of the `plugin` branch: only what an installed plugin needs.
// The repository root also holds the practice app, the trials, the examples and the demo page,
// which a plugin must not ship. The plugin workflow runs this on every release tag and pushes
// the result to the `plugin` branch.
// Usage: node scripts/build-plugin-branch.mjs <out-dir>   write the files into an empty or new folder
//        node scripts/build-plugin-branch.mjs --list      print the file list
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_FILES = 150;
export const COPIED = ['plugin.json', '.claude-plugin', 'skills', 'assets/icon.png', 'LICENSE', 'SECURITY.md'];
export const FORBIDDEN = /^(playground|trials|examples|site|test|scripts|docs|_site)\//;

function walk(rel) {
  const full = path.join(root, rel);
  if (!statSync(full).isDirectory()) return [rel];
  return readdirSync(full)
    .filter((name) => name !== '.DS_Store')
    .flatMap((name) => walk(path.posix.join(rel, name)));
}

// The paths of the plugin branch, relative to its root. README.md is written by readme().
export function pluginFiles() {
  return [...COPIED.flatMap(walk), 'README.md'].sort();
}

export function readme() {
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const rows = readdirSync(path.join(root, 'skills'))
    .sort()
    .map((name) => {
      const text = readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
      const description = /^description: (.*)$/m.exec(text)[1].trim().replace(/^"(.*)"$/, '$1');
      const cut = description.indexOf(' Use when ');
      const does = (cut > 0 ? description.slice(0, cut) : description).split(/(?<=\.)\s/)[0];
      return `| [\`${name}\`](skills/${name}/) | ${does} |`;
    });
  return `# revenue-skills plugin

Agent skills that find and fix the bugs that cost an app money. This branch holds only the files of the plugin, version ${version}: the plugin manifests, the skills, the license and the security policy. The source, the tests, the practice app, the trials and the demo page are on the main branch of [moonetix/revenue-skills](https://github.com/moonetix/revenue-skills). A workflow rebuilds this branch from each release tag, so changes go to the main branch.

## Install in Claude Code

\`\`\`
/plugin marketplace add moonetix/revenue-skills@plugin
/plugin install revenue-skills@revenue-skills
\`\`\`

## The skills

| Skill | What it does |
| --- | --- |
${rows.join('\n')}

Maintained by [Moonetix](https://moonetix.com), an affiliate network. MIT licensed, see [LICENSE](LICENSE). To report a vulnerability, see [SECURITY.md](SECURITY.md).
`;
}

export function check(files) {
  const problems = [];
  if (files.length >= MAX_FILES) problems.push(`${files.length} files, the limit is fewer than ${MAX_FILES}`);
  for (const file of files) if (FORBIDDEN.test(file)) problems.push(`${file} must not be in the plugin branch`);
  for (const file of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'README.md', 'LICENSE', 'SECURITY.md']) {
    if (!files.includes(file)) problems.push(`${file} is missing`);
  }
  const marketplace = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  for (const plugin of marketplace.plugins) {
    if (plugin.source !== './') problems.push(`marketplace plugin ${plugin.name} must have the source "./", the branch root`);
  }
  return problems;
}

export function build(out) {
  const files = pluginFiles();
  const problems = check(files);
  if (problems.length) throw new Error(`plugin branch: ${problems.join('; ')}`);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  for (const name of COPIED) cpSync(path.join(root, name), path.join(out, name), { recursive: true, filter: (src) => path.basename(src) !== '.DS_Store' });
  writeFileSync(path.join(out, 'README.md'), readme());
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [arg] = process.argv.slice(2);
  if (!arg) {
    console.log('Usage: node scripts/build-plugin-branch.mjs <out-dir>\n       node scripts/build-plugin-branch.mjs --list');
    process.exit(2);
  }
  if (arg === '--list') {
    const files = pluginFiles();
    const problems = check(files);
    console.log(files.join('\n'));
    for (const problem of problems) console.log(`error: ${problem}`);
    process.exitCode = problems.length ? 1 : 0;
  } else {
    const files = build(path.resolve(arg));
    console.log(`plugin branch: ${files.length} files written to ${arg}`);
  }
}
