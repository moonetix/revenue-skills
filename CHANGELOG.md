# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every skill carries the repository version in its `metadata.version`.

## [Unreleased]

## [1.1.0] - 2026-11-16

### Added

- A [demo page](https://moonetix.github.io/revenue-skills/). Its build starts both versions of Coinjar, sends every attack to each over HTTP and records the requests and the answers, so the page shows what the apps did and not a description of it.
- `examples/coinjar-audit/`: the findings, the report and the saved probe outputs of a `money-audit` run on the first version of Coinjar. A test checks the findings with the validator and the scorer.
- `examples/referral-engine-audit/`: a `money-audit` run on referral-engine v1.0.0, a published library. Its three findings were fixed in referral-engine 1.0.1.
- `npm run check:example`: validates both example audits against the code they describe, scores the Coinjar audit, and runs the tests the agent wrote for referral-engine, which must fail on 1.0.0 and pass on 1.0.1. CI runs it.
- `probe.mjs`: `{{i}}` in the request or an edit is replaced with the number of each request (1 to N), so the copies sent by `race` and `replay` can carry their own idempotency key or account.
- `money-audit` guidance for auditing a library instead of a running app, for rating a finding whose loss depends on how the code is deployed, and for a payout checked against an as-of balance that misses later-dated debits.
- `proving-findings.md` and the README list what the probe cannot do, and when a test proof is needed instead.
- A portable `plugin.json` for the Agent Plugins format and a `gemini-extension.json` for Gemini CLI.
- `SECURITY.md` and `CONTRIBUTING.md`.

### Changed

- The scorer pairs findings and planted bugs one to one, so one broad finding can no longer count for several bugs, and it prints how many findings point at a planted bug.
- `evals/evals.json` follows the Agent Skills eval format (`skill_name`, `evals` with `expected_output` and `assertions`), and the trigger messages moved to `evals/eval_queries.json`.
- The `money-audit` evals that name Coinjar bugs moved to `playground/evals.json`, and the reference that probed for a named bypass switch now describes it in general terms. The spoiler test covers the whole `skills/` folder.
- One severity rule for missing records and unattributed manual balance changes, in `ledger-and-audit-trail.md`. The severity table in `SKILL.md` points to it instead of rating them low.
- `findings.schema.json` closes every proof object and trace step and allows `output_file` on test proofs, as the validator does. A test keeps the two in step.
- The builder skills say that `scripts/probe.mjs` is relative to the skill folder, and use `{{i}}` instead of shell loops.
- The README states exactly what the validator checks, gives the skill folders for each agent and the Node version the installer needs, and links the class table in the skill instead of repeating it.
- The README links moonetix.com instead of the sign-up page, and the demo page has no sign-up button or band: one line names the maintainer.
- GitHub Actions are pinned to commit SHAs.

### Fixed

- `probe.mjs` crashed with a stack trace on a URL that starts with a `{{VAR}}` placeholder, such as `{{BASE}}/api/me`, and on any URL it could not parse. A placeholder at the start is now used as written, and a bad URL exits with 2 and one line.
- `.claude-plugin/marketplace.json` had a `metadata.repository` field that Claude Code does not define, and `.claude-plugin/plugin.json` listed `./skills`, which Claude Code scans anyway.

## [1.0.0] - 2026-11-15

### Added

- `money-audit`: a five-step audit of the code paths that handle money, credits, points or rewards, across ten bug classes, each with its own reference: unverified events, duplicate credit, balance races, client trust, money arithmetic, refunds and reversals, promo and referral abuse, payout controls, secrets and access, ledger and audit trail.
- `probe.mjs`: sends one request once, in sequence or in parallel, edits headers, query and body on the way, and reports the change in a watched number. Loopback targets only unless a host is named, with caps on volume.
- `validate-findings.mjs`: rejects a finding whose quoted code is not at the stated file and line, a finding without a proof, and a report that does not account for all ten classes. `render-report.mjs` turns a valid file into a Markdown report.
- Builder skills: `build-ledger`, `build-webhook-endpoint`, `handle-refunds-and-reversals`, `add-usage-credits`, `add-payouts`, `add-referral-program`, `guard-signups`, `add-offerwall`, `design-reward-economy`.
- `economy-check.mjs` in `design-reward-economy`: reads the numbers of a rewards currency from a JSON file and prints the margin, the break-even points and every rule they break.
- Coinjar, a practice app with 17 planted money bugs, the same app with all of them closed, an answer key, and a scorer for audits of it.
- One exploit per planted bug, run in CI against both versions of the app.
- Plugin manifests for Claude Code and Codex, and `evals/evals.json` for every skill.

[Unreleased]: https://github.com/moonetix/revenue-skills/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/moonetix/revenue-skills/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/moonetix/revenue-skills/releases/tag/v1.0.0
