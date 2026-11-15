# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every skill carries the repository version in its `metadata.version`.

## [Unreleased]

### Added

- A [demo page](https://moonetix.github.io/revenue-skills/). Its build starts both versions of Coinjar, sends every attack to each over HTTP and records the requests and the answers, so the page shows what the apps did and not a description of it.
- `examples/coinjar-audit/`: the findings, the report and the saved probe outputs of a `money-audit` run on the first version of Coinjar. A test checks the findings with the validator and the scorer.

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

[1.0.0]: https://github.com/moonetix/revenue-skills/releases/tag/v1.0.0
