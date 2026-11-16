#!/usr/bin/env node
// validate-skills.mjs: check every skill folder against the Agent Skills specification
// (https://agentskills.io/specification) and against this repository's own rules.
// Usage: node scripts/validate-skills.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SKILL_LINES = 500;
const TEXT_FILES = /\.(md|json|mjs|js|sql|py|php|txt|ya?ml)$/;
const BANNED = [
  ['an em dash or en dash', /[–—]/],
  ['an emoji or pictograph', /\p{Extended_Pictographic}/u],
  ['a filler word', /\b(seamless(ly)?|robust|leverag(e|es|ing)|empower(s|ing)?|elevate(s)?|delve(s)?|cutting-edge)\b/i],
  ['the phrase "pay-per-result"', /pay[- ]per[- ]result/i],
];

function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const data = {};
  let parent = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = /^ {2}([\w-]+):\s*(.*)$/.exec(line);
    const top = /^([\w-]+):\s*(.*)$/.exec(line);
    const unquote = (v) => v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    // A plain (unquoted) YAML scalar may not contain ": " or " #"; strict parsers reject the first and
    // cut the value at the second, so the skill would fail to load in some agents.
    const plain = (v) => !/^["']/.test(v) && (/: /.test(v) || / #/.test(v) || /:$/.test(v));
    if ((nested && plain(nested[2])) || (top && plain(top[2]))) return null;
    if (nested && parent) data[parent][nested[1]] = unquote(nested[2]);
    else if (top && top[2] === '') data[(parent = top[1])] = {};
    else if (top) {
      data[top[1]] = unquote(top[2]);
      parent = null;
    } else return null;
  }
  return { data, body: text.slice(match[0].length) };
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function validateSkill(dir) {
  const errors = [];
  const name = path.basename(dir);
  const fail = (message) => errors.push(`${name}: ${message}`);
  const skillFile = path.join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return [`${name}: SKILL.md is missing`];
  const text = readFileSync(skillFile, 'utf8');
  const parsed = parseFrontmatter(text);
  if (!parsed) return [`${name}: SKILL.md has no readable frontmatter (a value with ": " or " #" must be quoted)`];
  const { data, body } = parsed;

  if (data.name !== name) fail(`frontmatter name "${data.name}" must equal the folder name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) fail('name must be lowercase letters, digits and single hyphens, 64 characters at most');
  if (typeof data.description !== 'string' || data.description.length < 120 || data.description.length > 1024) {
    fail('description must be 120 to 1024 characters and say what the skill does and when to use it');
  } else if (!/\buse (it |this )?(when|to|for|before|after)\b/i.test(data.description)) {
    fail('description must say when to use the skill ("Use when ...")');
  }
  if (data.license !== 'MIT') fail('license must be MIT');
  if (data.metadata?.author !== 'moonetix') fail('metadata.author must be moonetix');
  if (!/^\d+\.\d+\.\d+$/.test(data.metadata?.version ?? '')) fail('metadata.version must look like 1.0.0');
  if (data.compatibility !== undefined && data.compatibility.length > 500) fail('compatibility is longer than 500 characters');
  if (text.split('\n').length > MAX_SKILL_LINES) fail(`SKILL.md is longer than ${MAX_SKILL_LINES} lines; move detail into references/`);
  if (!/^# \S/m.test(body)) fail('SKILL.md needs a top-level heading');

  const files = walk(dir);
  for (const file of files) {
    const rel = path.relative(dir, file);
    if (!TEXT_FILES.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const [what, pattern] of BANNED) {
      const line = content.split('\n').findIndex((l) => pattern.test(l));
      if (line >= 0) fail(`${rel}:${line + 1} contains ${what}`);
    }
    if (!file.endsWith('.md')) continue;
    const prose = content.replace(/```[\s\S]*?```/g, '');
    for (const [, target] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
      if (!resolved.startsWith(dir + path.sep)) fail(`${rel} links outside the skill folder: ${target}`);
      else if (!existsSync(resolved)) fail(`${rel} links to a missing file: ${target}`);
    }
  }
  for (const [, script] of text.matchAll(/`(scripts\/[\w.-]+)`/g)) {
    if (!existsSync(path.join(dir, script))) fail(`SKILL.md mentions ${script}, which does not exist`);
  }
  const refs = path.join(dir, 'references');
  if (existsSync(refs)) {
    for (const entry of readdirSync(refs)) {
      if (statSync(path.join(refs, entry)).isDirectory()) fail('references/ must stay one level deep');
      else if (!text.includes(`references/${entry}`)) fail(`references/${entry} is never mentioned in SKILL.md`);
    }
  }

  // The two files follow https://agentskills.io/skill-creation/evaluating-skills (evals.json)
  // and https://agentskills.io/skill-creation/optimizing-descriptions (eval_queries.json).
  const readJson = (rel) => {
    const file = path.join(dir, rel);
    if (!existsSync(file)) {
      fail(`${rel} is missing`);
      return null;
    }
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      fail(`${rel} is not valid JSON: ${err.message}`);
      return null;
    }
  };
  const filled = (value, min = 11) => typeof value === 'string' && value.length >= min;
  const evals = readJson('evals/evals.json');
  if (evals) {
    if (evals.skill_name !== name) fail('evals.json "skill_name" must equal the folder name');
    const cases = Array.isArray(evals.evals) ? evals.evals : [];
    if (cases.length < 3) fail('evals.json needs at least three evals');
    cases.forEach((item, i) => {
      const ok = item.id === i + 1 && filled(item.prompt) && filled(item.expected_output) && Array.isArray(item.assertions) && item.assertions.length >= 2 && item.assertions.every((a) => filled(a));
      if (!ok) fail(`evals.json eval ${i + 1} needs id ${i + 1}, a prompt, an expected_output and at least two assertions`);
    });
  }
  const queries = readJson('evals/eval_queries.json');
  if (queries) {
    const valid = Array.isArray(queries) && queries.every((q) => filled(q.query) && typeof q.should_trigger === 'boolean');
    if (!valid) fail('eval_queries.json must be a list of { "query", "should_trigger" }');
    else {
      if (queries.filter((q) => q.should_trigger).length < 5) fail('eval_queries.json needs at least five queries that should trigger');
      if (queries.filter((q) => !q.should_trigger).length < 3) fail('eval_queries.json needs at least three queries that should not trigger');
    }
  }
  return errors;
}

export function validateAll() {
  const skillsDir = path.join(root, 'skills');
  const names = readdirSync(skillsDir).filter((n) => statSync(path.join(skillsDir, n)).isDirectory()).sort();
  const errors = names.flatMap((name) => validateSkill(path.join(skillsDir, name)));

  const readme = existsSync(path.join(root, 'README.md')) ? readFileSync(path.join(root, 'README.md'), 'utf8') : '';
  for (const name of names) {
    if (!readme.includes(`skills/${name}/`)) errors.push(`README.md does not link skills/${name}/`);
  }
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  for (const manifest of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'gemini-extension.json']) {
    const file = path.join(root, manifest);
    if (!existsSync(file)) errors.push(`${manifest} is missing`);
    else if (JSON.parse(readFileSync(file, 'utf8')).version !== version) errors.push(`${manifest} version must equal package.json (${version})`);
  }
  return { names, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { names, errors } = validateAll();
  for (const error of errors) console.log(`error: ${error}`);
  console.log(errors.length ? `\n${errors.length} problem${errors.length === 1 ? '' : 's'} in ${names.length} skills.` : `${names.length} skills valid: ${names.join(', ')}`);
  process.exitCode = errors.length ? 1 : 0;
}
