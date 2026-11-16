# Working in this repository

This file is for coding agents and people changing the repository itself. To use the skills, read [README.md](README.md).

## Layout

| Path | What it holds |
| --- | --- |
| `skills/<name>/` | One Agent Skill per folder: `SKILL.md`, `references/`, optional `assets/` and `scripts/`, and `evals/` with `evals.json` and `eval_queries.json` in the [Agent Skills eval format](https://agentskills.io/skill-creation/evaluating-skills). Nothing in the repository runs the evals. |
| `skills/money-audit/scripts/` | The three scripts: `probe.mjs`, `validate-findings.mjs`, `render-report.mjs`. `probe.mjs` here is the source of every other copy. |
| `skills/design-reward-economy/scripts/economy-check.mjs` | The economy check, with its tests in `test/economy-check.test.mjs`. |
| `playground/vulnerable/`, `playground/fixed/` | The practice app with 17 planted money bugs, and the same app with all of them closed. |
| `playground/answers.json`, `playground/score.mjs` | The answer key and the scorer for an audit of `playground/vulnerable/`. The scorer pairs findings and planted bugs one to one. |
| `playground/evals.json` | The `money-audit` eval cases that name planted bugs. They stay out of `skills/` so the skill carries no spoilers. |
| `test/` | `node --test` suites: exploits against both apps, the scripts, and the repository rules. |
| `examples/coinjar-audit/`, `examples/referral-engine-audit/` | The output of one audit each, of `playground/vulnerable/` and of referral-engine v1.0.0, kept as it was written apart from machine paths. Do not edit them by hand; replace them with a new run. Each has a README. |
| `scripts/` | `validate-skills.mjs`, `sync-shared.mjs`, `build-site.mjs`, and `check-examples.mjs`, which checks both example audits against the code they describe. |
| `plugin.json`, `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `gemini-extension.json` | Plugin manifests: Agent Plugins, Claude Code, Codex and Gemini CLI. Each carries the repository version. |
| `site/` | The demo page. `scripts/build-site.mjs` records every attack against both apps and writes `_site/`. |

## Commands

```bash
npm test            # all suites; needs Node 22.13 or newer for node:sqlite
npm run validate    # skill format, style rules, shared scripts in sync
npm run sync        # copy probe.mjs into every skill that uses it
npm run check:example  # validate both example audits; clones referral-engine unless --referral-engine <path> is given
npm run site        # record every attack and build the demo page into _site/
```

There are no dependencies to install.

## Rules for changes

- **A skill must work when installed alone.** Link only to files inside the same skill folder. Name other skills, do not link to them.
- **`SKILL.md` stays short.** It is loaded whole when the skill activates. Detail goes in `references/`, one level deep, and every reference file is mentioned in `SKILL.md`.
- **Code in a skill must be correct.** Syntax-check every snippet. A pattern shown in a builder skill should exist, tested, in `playground/fixed/`.
- **Scripts have no dependencies** and run on Node 20. They print usage when called without arguments and exit with 2 on a usage error.
- **Edit `probe.mjs` only in `skills/money-audit/scripts/`,** then run `npm run sync`.
- **The probe stays a proof tool.** Loopback targets by default, the caps on `--times` and `--parallel`, and no redirect following are deliberate. Do not add loops, scanning or anything that makes it useful against systems the user does not own.
- **Changing the practice app:** a new planted bug needs an entry in `playground/answers.json` and `playground/ANSWER-KEY.md`, an exploit in `test/playground.test.mjs` that succeeds on `vulnerable/` and fails on `fixed/`, and the fix in `fixed/`. Keep comments in `vulnerable/` free of hints.
- **Do not put spoilers in the skills.** Nothing in `skills/` may quote code from `playground/vulnerable/` or name its bugs, evals included, or the practice app stops measuring anything. `test/repo.test.mjs` checks the whole folder.
- **Severity rules live in one place each.** The table in `money-audit/SKILL.md` is the default; a class reference that sets its own rule says so, and `SKILL.md` points to it.
- **Writing style:** US English, short sentences, no em dashes, no emojis, no superlatives. `npm run validate` enforces part of this.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with the frontmatter the other skills use. The description says what the skill does and when to use it, in the words a user would type.
2. Add `references/` for patterns, `evals/evals.json` with three eval cases (prompt, expected output, assertions) and `evals/eval_queries.json` with at least five messages that should trigger the skill and three that should not.
3. If the skill verifies its work with the probe, mention `scripts/probe.mjs` in `SKILL.md` and run `npm run sync`.
4. If the skill runs a script, say in its Verify section that the path is relative to the skill folder.
5. Link the skill from the table in `README.md`, add a line to `CHANGELOG.md`, and run `npm run validate && npm test`.
