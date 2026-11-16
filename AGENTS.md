# Working in this repository

This file is for coding agents and people changing the repository itself. To use the skills, read [README.md](README.md).

## Layout

| Path | What it holds |
| --- | --- |
| `skills/<name>/` | One Agent Skill per folder: `SKILL.md`, `references/`, optional `assets/` and `scripts/`, and `evals/` with `evals.json` and `eval_queries.json` in the [Agent Skills eval format](https://agentskills.io/skill-creation/evaluating-skills). Nothing in the repository runs the evals. |
| `skills/money-audit/scripts/` | The three scripts: `probe.mjs`, `validate-findings.mjs`, `render-report.mjs`. |
| Shared files | Files that several skills carry, each with one source skill. The list is at the top of `scripts/sync-shared.mjs`: `scripts/probe.mjs` (source: `money-audit`) and `references/webhook-stacks.md` (source: `build-webhook-endpoint`). |
| `skills/design-reward-economy/scripts/economy-check.mjs` | The economy check, with its tests in `test/economy-check.test.mjs`. |
| `playground/vulnerable/`, `playground/fixed/` | The practice app with 17 planted money bugs, and the same app with all of them closed. |
| `playground/answers.json`, `playground/score.mjs` | The answer key and the scorer for an audit of `playground/vulnerable/`. The scorer pairs findings and planted bugs one to one. |
| `playground/evals.json` | The `money-audit` eval cases that name planted bugs. They stay out of `skills/` so the skill carries no spoilers. |
| `test/` | `node --test` suites: exploits against both apps, the scripts, and the repository rules. |
| `trials/` | One trial per builder skill: `TASK.md`, the starter app in `workspace/`, `check.mjs`, `RUBRIC.md`, `_reference/` and `_naive/`, with the shared checker code in `lib/`. `expected.json` lists the checks each naive solution fails. `trials/README.md` explains how to run a trial with an agent and has the published results. |
| `examples/coinjar-audit/`, `examples/referral-engine-audit/` | The output of one audit each, of `playground/vulnerable/` and of referral-engine v1.0.0, kept as it was written apart from machine paths. Do not edit them by hand; replace them with a new run. Each has a README. |
| `scripts/` | `validate-skills.mjs`, `sync-shared.mjs`, `build-site.mjs`, `validate-trials.mjs`, and `check-examples.mjs`, which checks both example audits against the code they describe. |
| `plugin.json`, `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `gemini-extension.json` | Plugin manifests: Agent Plugins, Claude Code, Codex and Gemini CLI. Each carries the repository version. The Codex manifest's `interface` points at `assets/icon.svg`, a copy of `site/favicon.svg`. |
| `package-lock.json`, `.codexignore` | The lockfile of this zero-dependency package, and the folders left out of the Codex package. Both are scored by the awesome-codex-plugins scanner that CI runs. |
| `scripts/build-plugin-branch.mjs`, `.github/workflows/plugin-branch.yml` | The `plugin` branch: on every `v*` tag the workflow writes `.claude-plugin/`, `skills/`, a short README, `LICENSE` and `SECURITY.md` and pushes them to that branch only. `test/plugin-branch.test.mjs` keeps the list under 150 files and free of `playground/`, `trials/`, `examples/` and `site/`. |
| `site/` | The demo page. `scripts/build-site.mjs` records every attack against both apps and writes `_site/`. |
| `docs/demo.png` | The screenshot of the demo page at the top of the README, 1440 by 900, light theme. Retake it when the top of the page changes. |
| `docs/social-preview.png`, `docs/social-preview.html` | The repository's social preview, 1280 by 640, uploaded by hand in the repository settings, and the page it is screenshotted from. `npm run site` copies the image into `_site/` as the demo's `og:image`. |

## Commands

```bash
npm test            # all suites; needs Node 22.13 or newer for node:sqlite
npm run validate    # skill format, style rules, shared scripts in sync
npm run sync        # copy each shared file from its source skill into every skill that mentions it
npm run trials:validate  # every trial checker against its reference and naive solutions, about two minutes
npm run check:example  # validate both example audits; clones referral-engine unless --referral-engine <path> is given
npm run site        # record every attack and build the demo page into _site/
```

There are no dependencies to install.

## Rules for changes

- **A skill must work when installed alone.** Link only to files inside the same skill folder. Name other skills, do not link to them.
- **`SKILL.md` stays short.** It is loaded whole when the skill activates. Detail goes in `references/`, one level deep, and every reference file is mentioned in `SKILL.md`.
- **Code in a skill must be correct.** Syntax-check every snippet in a language you can run, and say in the change which ones you could not check. Where each kind of code is tested: the patterns that close the practice app's planted bugs (verified events, credits applied once, conditional debits, reversals, payout controls, once-only promo codes and referral rewards) are in `playground/fixed/`, under the exploits of `test/playground.test.mjs`; the provider verification code in the references runs in `test/provider-signing.test.mjs`; the provider, AI and framework snippets that are not in the playground are syntax-checked; and the trials check that an agent following a skill builds code that holds under attack.
- **Scripts have no dependencies** and run on Node 20. They print usage when called without arguments and exit with 2 on a usage error.
- **Edit a shared file only in its source skill,** then run `npm run sync`. A shared file is copied into every skill whose `SKILL.md` mentions its path, so never give a skill's own file the path of a shared one. That is why the shared webhook file is `references/webhook-stacks.md` and the per-skill files are `references/stacks.md`.
- **The probe stays a proof tool.** Loopback targets by default, the caps on `--times` and `--parallel`, and no redirect following are deliberate. Do not add loops, scanning or anything that makes it useful against systems the user does not own.
- **Changing the practice app:** a new planted bug needs an entry in `playground/answers.json` and `playground/ANSWER-KEY.md`, an exploit in `test/playground.test.mjs` that succeeds on `vulnerable/` and fails on `fixed/`, and the fix in `fixed/`. Keep comments in `vulnerable/` free of hints.
- **Keep the trials honest.** A builder skill change that affects what an agent builds is worth a fresh trial run (steps in `trials/README.md`). A change to a checker, a starter, a reference solution, `assets/sign-test-event.mjs` or `economy-check.mjs` (the checkers import both from the skills) needs `npm run trials:validate`. Never give the trial agent `_reference/`, `_naive/`, `check.mjs`, `RUBRIC.md` or `lib/`, and keep `trials/` free of machine paths; `test/repo.test.mjs` checks it.
- **Do not put spoilers in the skills.** Nothing in `skills/` may quote code from `playground/vulnerable/` or name its bugs, evals included, or the practice app stops measuring anything. `test/repo.test.mjs` checks the whole folder.
- **Severity rules live in one place each.** The table in `money-audit/SKILL.md` is the default; a class reference that sets its own rule says so, and `SKILL.md` points to it.
- **Writing style:** US English, short sentences, no em dashes, no emojis, no superlatives. `npm run validate` enforces part of this.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with the frontmatter the other skills use. The description says what the skill does and when to use it, in the words a user would type.
2. Add `references/` for patterns, `evals/evals.json` with three eval cases (prompt, expected output, assertions) and `evals/eval_queries.json` with at least five messages that should trigger the skill and three that should not.
3. If the skill verifies its work with the probe, mention `scripts/probe.mjs` in `SKILL.md` and run `npm run sync`.
4. If the skill runs a script, its Verify commands run from the project directory and name the script by the skill folder: the probe as `PROBE=<skill directory>/scripts/probe.mjs` on the first line, then `node "$PROBE" ...`.
5. For a builder skill, add a trial under `trials/<name>/` with `TASK.md`, `workspace/`, `check.mjs`, `RUBRIC.md`, `_reference/` and `_naive/`, and its entry in `trials/expected.json`. The steps are in [trials/README.md](trials/README.md#add-a-trial-for-a-new-skill); `test/repo.test.mjs` fails until the trial exists.
6. Link the skill from the skill tables and the situation table in `README.md`, add a line to `CHANGELOG.md`, and run `npm run validate && npm test && npm run trials:validate`.
