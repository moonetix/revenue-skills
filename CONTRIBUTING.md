# Contributing

Thank you for helping. A missed bug shape is as useful as code: if an audit missed something you have seen in production, [describe it in an issue](https://github.com/moonetix/revenue-skills/issues/new?template=missed-bug.yml). For a larger change, open an issue first so we can agree on the shape.

The rules behind every change are in [AGENTS.md](AGENTS.md). This page is the short version for people.

## Improve or add a skill

- A skill must work installed alone: link only to files inside its own folder, and name other skills instead of linking to them.
- Keep `SKILL.md` short. Detail goes in `references/`, one level deep, and every reference is mentioned in `SKILL.md`.
- Code in a skill must be correct. Syntax-check every snippet. A pattern a builder skill teaches should exist, tested, in `playground/fixed/`.
- `evals/evals.json` (tasks with assertions) and `evals/eval_queries.json` (messages that should and should not trigger the skill) follow the [Agent Skills eval format](https://agentskills.io/skill-creation/evaluating-skills). Nothing in this repository runs them; they are there for you to run with your agent.
- `probe.mjs` is edited only in `skills/money-audit/scripts/`. Run `npm run sync` to copy it into the other skills.
- A new skill also needs a row in the README table and a line in `CHANGELOG.md`. The steps are in [AGENTS.md](AGENTS.md#adding-a-skill).

## Add a bug to the practice app

A planted bug in `playground/vulnerable/` needs all of these, or the checks fail:

1. The bug, with no comment that hints at it.
2. An entry in `playground/answers.json` and a row in `playground/ANSWER-KEY.md`.
3. An exploit in `test/playground.test.mjs` that succeeds against `vulnerable/` and fails against `fixed/`.
4. The fix in `playground/fixed/`.
5. An attack in `scripts/build-site.mjs`, so the demo page shows it against both apps.

Nothing in `skills/` may quote the practice app or name its bugs. A test checks this.

A new bug class is a larger change: the class id in `validate-findings.mjs` and in `assets/findings.schema.json`, a reference file with its `**Class id:**` line, a row in the class table of `money-audit/SKILL.md`, a title and a question in `scripts/build-site.mjs`, and at least one planted bug. The tests list what is missing.

## Run the checks

```bash
npm run validate       # skill format, style rules, shared probe in sync
npm test               # exploits against both apps, the scripts, the repository rules
npm run check:example  # both example audits still hold (clones referral-engine)
npm run site           # builds the demo page into _site/
```

Node 22.13 or newer. There is nothing to install.

## Style

- US English, short sentences, plain words.
- No em or en dashes, no emojis, no superlatives, no filler words. `npm run validate` enforces part of this.
- Scripts in skills have no dependencies, run on Node 20, print usage when called without arguments and exit with 2 on a usage error.
- `examples/` holds outputs of real runs. Do not edit them by hand, apart from removing machine paths or secrets; replace them with a new run.
- Commit messages are imperative sentences without a prefix, such as "Add a payout hold check to the economy script".
