# Working in this repository

This file is for coding agents and people changing the repository itself. To use the skills, read [README.md](README.md).

## Layout

| Path | What it holds |
| --- | --- |
| `skills/<name>/` | One Agent Skill per folder: `SKILL.md`, `references/`, optional `assets/` and `scripts/`, and `evals/evals.json`. |
| `skills/money-audit/scripts/` | The three scripts: `probe.mjs`, `validate-findings.mjs`, `render-report.mjs`. `probe.mjs` here is the source of every other copy. |
| `skills/design-reward-economy/scripts/economy-check.mjs` | The economy check, with its tests in `test/economy-check.test.mjs`. |
| `playground/vulnerable/`, `playground/fixed/` | The practice app with 17 planted money bugs, and the same app with all of them closed. |
| `playground/answers.json`, `playground/score.mjs` | The answer key and the scorer for an audit of `playground/vulnerable/`. |
| `test/` | `node --test` suites: exploits against both apps, the scripts, and the repository rules. |
| `examples/coinjar-audit/` | The output of one audit of `playground/vulnerable/`, kept as it was written. Do not edit it by hand; replace it with a new run. |
| `scripts/` | `validate-skills.mjs`, `sync-shared.mjs` and `build-site.mjs`. |
| `site/` | The demo page. `scripts/build-site.mjs` records every attack against both apps and writes `_site/`. |

## Commands

```bash
npm test            # all suites; needs Node 22.13 or newer for node:sqlite
npm run validate    # skill format, style rules, shared scripts in sync
npm run sync        # copy probe.mjs into every skill that uses it
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
- **Do not put spoilers in the skills.** Examples in `skills/` must not quote code from `playground/vulnerable/`, or the practice app stops measuring anything.
- **Writing style:** US English, short sentences, no em dashes, no emojis, no superlatives. `npm run validate` enforces part of this.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with the frontmatter the other skills use. The description says what the skill does and when to use it, in the words a user would type.
2. Add `references/` for patterns and `evals/evals.json` with trigger messages and three tasks.
3. If the skill verifies its work with the probe, mention `scripts/probe.mjs` in `SKILL.md` and run `npm run sync`.
4. Link the skill from the table in `README.md`, add a line to `CHANGELOG.md`, and run `npm run validate && npm test`.
