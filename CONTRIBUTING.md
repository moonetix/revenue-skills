# Contributing

Thank you for helping. A missed bug shape is as useful as code: if an audit missed something you have seen in production, [describe it in an issue](https://github.com/moonetix/revenue-skills/issues/new?template=missed-bug.yml). For a larger change, open an issue first so we can agree on the shape.

The rules behind every change are in [AGENTS.md](AGENTS.md). This page is the short version for people.

## Improve or add a skill

- A skill must work installed alone: link only to files inside its own folder, and name other skills instead of linking to them.
- Keep `SKILL.md` short. Detail goes in `references/`, one level deep, and every reference is mentioned in `SKILL.md`.
- Code in a skill must be correct. Syntax-check every snippet you can run, and say which ones you could not. The patterns that close the practice app's planted bugs are tested in `playground/fixed/`; the provider verification code runs in `test/provider-signing.test.mjs`; other provider, AI and framework snippets are syntax-checked; and the trials check what an agent builds with the skill. [AGENTS.md](AGENTS.md#rules-for-changes) has the details.
- `evals/evals.json` (tasks with assertions) and `evals/eval_queries.json` (messages that should and should not trigger the skill) follow the [Agent Skills eval format](https://agentskills.io/skill-creation/evaluating-skills). Nothing in this repository runs them; they are there for you to run with your agent.
- A builder skill runs the probe from the project directory: the first line of its Verify commands is `PROBE=<skill directory>/scripts/probe.mjs`, and every call is `node "$PROBE" ...`.
- Shared files are edited only in their source skill: `scripts/probe.mjs` in `money-audit` and `references/webhook-stacks.md` in `build-webhook-endpoint`. The list is at the top of `scripts/sync-shared.mjs`. Run `npm run sync` to copy them into the other skills.
- A new skill also needs a row in the README tables and a line in `CHANGELOG.md`, and a new builder skill needs a trial. The steps are in [AGENTS.md](AGENTS.md#adding-a-skill).

## Add or change a trial

Each builder skill has a trial in `trials/<skill>/`: the request in `TASK.md`, a starter app in `workspace/`, a checker in `check.mjs`, the rules it covers in `RUBRIC.md`, and two solutions that prove the checker, `_reference/` (passes every check) and `_naive/` (fails the checks listed in `trials/expected.json`). [trials/README.md](trials/README.md#add-a-trial-for-a-new-skill) has the steps for a new one. After changing a checker, a starter or a solution, run `npm run trials:validate`.

If you measured your own agent with a trial, an issue with the agent, the model, the checker output and the rules you reviewed by hand is welcome.

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
npm run validate       # skill format, style rules, shared files in sync
npm test               # exploits against both apps, the scripts, the repository rules
npm run check:example  # both example audits still hold (clones referral-engine)
npm run site           # builds the demo page into _site/
npm run trials:validate  # every trial checker against its reference and naive solutions
```

Node 22.13 or newer. There is nothing to install.

## Releases and the plugin branch

A release bumps the version in `package.json`, `package-lock.json`, every manifest and every skill's `metadata.version` (`test/repo.test.mjs` checks that they agree), and pushes a `v*` tag. The tag starts `.github/workflows/plugin-branch.yml`, which runs `npm run validate`, writes the plugin files with `node scripts/build-plugin-branch.mjs <folder>` and commits them onto the `plugin` branch: `.claude-plugin/`, `skills/`, a short README, `LICENSE` and `SECURITY.md`, nothing else. That keeps the practice app, the trials and their test secrets out of an installed plugin. The workflow can also be started by hand; it pushes only when the files changed and writes no other branch and no tag. Run `node scripts/build-plugin-branch.mjs --list` to see the file list, and never edit the `plugin` branch by hand.

## Related repositories

Libraries and data by the same maintainer that the builder skills can lean on: [referral-engine](https://github.com/moonetix/referral-engine), [signup-guard](https://github.com/moonetix/signup-guard), [reward-economy-kit](https://github.com/moonetix/reward-economy-kit), [affiliate-postback-macros](https://github.com/moonetix/affiliate-postback-macros), [datacenter-ip-ranges](https://github.com/moonetix/datacenter-ip-ranges), [offerwall-postback-handlers](https://github.com/moonetix/offerwall-postback-handlers), [offerwall-fraud-playbook](https://github.com/moonetix/offerwall-fraud-playbook).

## Style

- US English, short sentences, plain words.
- No em or en dashes, no emojis, no superlatives, no filler words. `npm run validate` enforces part of this.
- Scripts in skills have no dependencies, run on Node 20, print usage when called without arguments and exit with 2 on a usage error.
- `examples/` holds outputs of real runs. Do not edit them by hand, apart from removing machine paths or secrets; replace them with a new run.
- Commit messages are imperative sentences without a prefix, such as "Add a payout hold check to the economy script".
