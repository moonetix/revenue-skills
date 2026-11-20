# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every skill carries the repository version in its `metadata.version`.

## [Unreleased]

## [1.3.6] - 2026-11-20

### Changed

- `add-subscriptions` names Stripe API version `2026-11-18.endive`, released on 2026-11-18 with no breaking change to Billing, as the current version, and its Stripe client snippets pin it. The trials keep `2026-10-28.endive`, the version their task fixes.
- The Google Play notification table in `add-subscriptions` lists type 21, `SUBSCRIPTION_PLAN_TRANSITION_UPDATED`, which the RTDN reference now documents. Like the other rare types, the handler reads the current state from the API.

## [1.3.5] - 2026-11-16

### Added

- `privacyPolicyUrl` (the README's safety and privacy section; the plugin collects no data) and `termsOfServiceUrl` (the MIT license) in `.claude-plugin/plugin.json`, the two listing links Anthropic's plugin directory showed as missing.

## [1.3.4] - 2026-11-16

### Changed

- Clearer wording where a skill sentence read like an instruction to override the agent's judgement out of context: "ask the user only what the code cannot tell you" in seven builder skills, "accept" instead of "do not refuse" for fractional offerwall rewards and old App Store notifications, and a few similar phrases. NVIDIA SkillSpector, which a plugin catalog runs on submissions, flagged them. No rule changed.

## [1.3.3] - 2026-11-16

### Fixed

- The `money-audit` description had an unquoted ": " in its frontmatter, which strict YAML parsers reject, so agents that parse SKILL.md strictly could not load the skill. The description is reworded, and `npm run validate` now rejects any unquoted frontmatter value with ": " or " #", with a test.

## [1.3.2] - 2026-11-16

### Added

- An issue form for a builder skill that produced code that can lose money or missed a provider or framework, and a link to the private vulnerability report on the new issue page.
- `privacyPolicyURL` (the README's safety and privacy section), `termsOfServiceURL` (the license) and `screenshots` (`docs/demo.png`) in the Codex `interface` block.

### Changed

- The remaining fixed test values in the trial checkers (the Giftly and model provider keys and the wrong signing secret of the forgery checks) are generated per run as well. The only key-like literal left is the Paddle Python SDK's published test secret in `test/provider-signing.test.mjs`, which the test needs to reproduce that SDK's own vector.

## [1.3.1] - 2026-11-16

### Changed

- The trial checkers, the practice app tests, the provider signing tests and the demo page build no longer hold key-like test values in the source: the checkers and the signing tests generate a fresh secret per run, and the practice app tests take the app's own built-in test values. The HOL AI Plugin Scanner reported 36 hardcoded secret findings for those test constants; none was a real secret.
- The `plugin` branch also carries the root `plugin.json` (Agent Plugins 1.0.0), so plugin hosts that read it, such as the GitHub Copilot CLI marketplace, can install from the branch without the practice app and the trials.
- `.codex-plugin/plugin.json` lists the same keywords as the root manifest.

## [1.3.0] - 2026-11-16

### Added

- The `plugin` branch: `.github/workflows/plugin-branch.yml` rebuilds it on every `v*` tag with `scripts/build-plugin-branch.mjs`, holding only `.claude-plugin/`, `skills/`, a short README, `LICENSE` and `SECURITY.md`, so an installed plugin carries no practice app, trials or test secrets. `/plugin marketplace add moonetix/revenue-skills@plugin` installs from it. `test/plugin-branch.test.mjs` keeps it under 150 files.
- `displayName` in `.claude-plugin/plugin.json`, and the `interface` block in `.codex-plugin/plugin.json` (display name, descriptions, developer, category, capabilities, links, three starter prompts, brand colors and `assets/icon.svg`).
- A CI job that runs the HOL AI Plugin Scanner with `min_score: 75`, as the awesome-codex-plugins guide shows, plus `package-lock.json` and `.codexignore`.
- `docs/social-preview.png`, built from `docs/social-preview.html`. The demo page uses it as its `og:image`, with a `twitter:card`, and shows the skills version in its facts.
- `add-subscriptions`, the eleventh skill: subscription access derived on the server from the provider's state through the whole life cycle (trial, past due with a grace period, cancel at period end or now, pause, plan changes, refunds, chargebacks and revocations), events handled once and in any order by fetching the latest object, one entitlement per subscription, credits granted once per paid period, one trial per person and a reconciliation job. References for Stripe Billing, the App Store, Google Play, Paddle Billing and RevenueCat, checked against their documentation on 2026-11-16, and the pattern in Next.js, Express, Django, Laravel and Rails. `assets/sign-test-event.mjs` is now a shared file, copied from `build-webhook-endpoint` by `npm run sync`. `build-webhook-endpoint`, `handle-refunds-and-reversals`, `add-usage-credits` and `guard-signups` point to it.
- `trials/add-subscriptions/`: Coinbarn Plus on Stripe Billing, with a Stripe API sandbox (`trials/lib/fake-stripe.mjs`) and 21 checks, from the first paid invoice to a lost cancellation found by the sync route.
- Trial results without the skill, and with Claude Sonnet 5.5 as well as Claude Opus 5.5, in the README and `trials/README.md`, with every failed check explained.
- Directory listing fields in `.claude-plugin/plugin.json`: `icon` (`assets/icon.png`, now also on the `plugin` branch), `documentationUrl` and `supportUrl`.

### Changed

- The README is about a third shorter, with one install section.
- The Verify commands of the eight builder skills that use the probe set `PROBE=<skill directory>/scripts/probe.mjs` first and call `node "$PROBE"`, so the path is unambiguous when run from the project directory.
- `build-webhook-endpoint`, `add-offerwall` and `handle-refunds-and-reversals` each say when to use which of the three.
- `add-offerwall` lists its networks in alphabetical order.
- The demo page has one maintainer credit.
- `add-offerwall`: a postback reward with a fraction, such as `12.75`, is rounded down once to whole units after the hash check, never refused. A Sonnet trial run refused one.
- `guard-signups`: the sources on plus addressing for consumer Outlook.com conflict; the reference says so and keeps the tag by default, with `plusTagDomains` for operators who see `+` variants farming one mailbox.
- Trial check P11 of `add-payouts` also accepts an app that finds the issued card with a lookup by the same key and marks it paid at once. The Opus run without the skill did exactly that and now passes 16/16.
- The trial harness signs Stripe test events with API version `2026-10-28.endive`, as the subscription trial does.

## [1.2.0] - 2026-11-16

### Added

- `trials/`: one trial per builder skill. A fresh agent gets a starter app, a plain request and the one skill; a checker then attacks what it built and prints PASS or FAIL per check. Each trial has `TASK.md`, the starter in `workspace/`, `check.mjs`, `RUBRIC.md` with the rules left to code review, a reference solution that passes every check and a naive one. `trials/README.md` explains how to measure your own agent and has the first results, measured with Claude Opus 5.5 in Claude Code: eight skills passed every check on the first run, and `add-payouts` passed 13 of 16, then 16 of 16 after the fix below.
- `npm run trials:validate`: runs every checker against its reference solution, which must pass every check, and its naive solution, which must fail exactly the checks listed in `trials/expected.json`. CI runs it.
- `TRIAL_EXTRA_ENV` for the checkers: settings the built app added and now requires, such as a keyed-hash secret. The checker tries the task's environment first and reports a start that needed the extra settings apart from the attack results, with exit code 3.
- `build-webhook-endpoint`: one reference per provider, checked against the providers' documentation on 2026-11-15, each with a Sources list: Stripe, Paddle Billing, Lemon Squeezy, PayPal, RevenueCat, App Store Server Notifications V2 and Google Play real-time developer notifications. Each covers authentication, the secret or key and its rotation, the raw body, timestamp and replay, retries and order, the id to deduplicate on, the events that move money, payload versus API, local testing and the bugs that ship. A provider table in `SKILL.md` links them.
- `build-webhook-endpoint`: `references/webhook-stacks.md`, the same webhook route in Next.js App Router, Express, Django, Laravel and Rails: the raw body, a CSRF exemption for that route only, verifying before parsing, a transaction with a unique key, the answer after the commit, and where the secret lives. `handle-refunds-and-reversals` carries a copy, kept in sync by `npm run sync`.
- `build-webhook-endpoint`: `assets/sign-test-event.mjs` gains `stripe`, `paddle`, `lemonsqueezy` and `revenuecat` modes that sign test events the way those providers do. `EVENT_ID` signs the same event again with a fresh timestamp.
- `handle-refunds-and-reversals`: `references/provider-reversal-events.md`, the refund, dispute and revocation events of the same seven providers, with the amount field, how a partial reversal shows, the link to the original credit and what to do when the reversal arrives first.
- `money-audit`: `references/payment-providers.md`, the code shapes to look for in each provider integration, linked from `SKILL.md`, `unverified-events.md`, `duplicate-credit.md` and `refunds-and-reversals.md`.
- `add-usage-credits` covers apps that sell credits for LLM calls. `ai-pricing.md`: a versioned price table in integer micro-units per million tokens (input, cached input, cache writes, output with reasoning and thinking tokens, per-call tool charges), the mapping of OpenAI, Anthropic and Google Gemini usage fields onto it, one rounding up after the markup, and the upper bound to reserve. `ai-calls-and-streams.md`: what to settle when a call finishes, fails, times out, is cut mid-stream or the user disconnects, where each provider reports usage in a stream, retries without a second charge, budgets and step limits for multi-step agent runs, and parallel requests from one user. `ai-worked-example.md`: the reserve, call and settle flow in TypeScript and Python with the ledger writes, and the tests to write. Each file lists its sources, read on 2026-11-15.
- `references/stacks.md` in `build-ledger`, `add-usage-credits`, `add-payouts`, `add-referral-program`, `guard-signups` and `add-offerwall`: each skill's core pattern in Next.js App Router with Prisma, Express with SQL, Django, Laravel and Rails, with the transaction boundary, the row lock or conditional update, the unique key that makes a retry safe, and a table of where each check sits.
- Evals for providers, for AI credits (a streamed OpenAI call with a disconnecting user, a capped Anthropic agent run) and one framework eval per builder skill above, with new trigger and non-trigger messages.
- Tests: `test/provider-signing.test.mjs` runs the verification code from the references against the signing helper's output, against the test vectors of Paddle's official SDK tests, and against a throwaway PayPal-style certificate. `test/sync-shared.test.mjs` covers the shared-file sync. `test/repo.test.mjs` checks that every builder skill has a trial and that `trials/` holds no machine paths.
- `docs/demo.png`, a screenshot of the demo page, at the top of the README.

### Changed

- The README starts with what the skills catch, a one-minute start, a table that picks a skill and a prompt by situation, the skill folder for each agent, and the measured results of the trials and the two audits, followed by the reference sections and a short FAQ.
- The demo page has a plain technical layout in the Moonetix colors: a title, the facts of the build (attacks, findings, planted bugs found, the audit date, the build date, the Node version and the commit), one recorded attack as a sample, then the attack lab, the report and the skills. It has no sign-up.
- `build-webhook-endpoint`: the Stripe reference says that a handler which checks `livemode` against a setting needs the matching value in production, listed as a visible deploy step.
- `guard-signups`: the keyed hashes need a server-side secret; if the project has none suitable, the skill names the new setting as the first deploy step and makes the app refuse to start without it.
- `add-usage-credits`: the description and the Build steps point to the AI references, and `expiry-and-display.md` has a section on showing AI usage (the bound before a call, the charge after it, cut streams, price changes).
- The descriptions of `build-webhook-endpoint`, `handle-refunds-and-reversals` and `money-audit` name the providers, and those of the six builder skills with a `stacks.md` name the frameworks, so that they trigger on requests such as "stripe webhook idempotency" or "Our Laravel cash-out endpoint sometimes pays users twice".
- `scripts/sync-shared.mjs` syncs a list of shared files, not only `probe.mjs`. Each entry names a file and the skill that holds its source, and `--check` names the source of every stale copy.
- `assets/sign-test-event.mjs` exports its signing functions, prints usage without arguments and exits with 2 on a usage error. The `webhook` and `postback` modes are unchanged.
- AGENTS.md and CONTRIBUTING.md describe the shared-file list, the trials and how to add one, and where each kind of code example is tested.

### Fixed

- `add-payouts`: the skill now says that asking the provider and repeating a call with the same idempotency key are always safe, that no quiet period may hold a payout back from the resolver, and that a manual resolve asks the provider right away (scheduled backoff does not apply to it). In the trial, the agent had added a waiting window that stopped a manual resolve right after an unknown outcome.

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

[Unreleased]: https://github.com/moonetix/revenue-skills/compare/v1.3.6...HEAD
[1.3.6]: https://github.com/moonetix/revenue-skills/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/moonetix/revenue-skills/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/moonetix/revenue-skills/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/moonetix/revenue-skills/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/moonetix/revenue-skills/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/moonetix/revenue-skills/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/moonetix/revenue-skills/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/moonetix/revenue-skills/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/moonetix/revenue-skills/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/moonetix/revenue-skills/releases/tag/v1.0.0
