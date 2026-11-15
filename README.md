# revenue-skills

**Agent skills that find and fix the bugs that cost your app money: a money-path audit where every finding carries a proof, and skills that build ledgers, webhook endpoints, credits, refunds, referrals and payouts correctly.**

[![CI](https://github.com/moonetix/revenue-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/moonetix/revenue-skills/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-1f6feb)](https://agentskills.io)
[![Skills: 10](https://img.shields.io/badge/skills-10-brightgreen)](#the-skills)
[![Zero dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen)](package.json)

Maintained by [Moonetix](https://moonetix.com).

An app that sells credits, grants points or pays out rewards tends to lose money in the same few ways. A webhook nobody verifies. A credit that lands twice when the provider retries. A balance that two requests spend at the same moment. A refund that leaves the goods behind. None of it shows up in a demo, and all of it shows up in production.

These skills teach a coding agent to find those flaws in your code and to build the replacement. They work with Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, OpenCode, Goose, Amp and any other agent that reads the [Agent Skills](https://agentskills.io) format.

- **Findings you can check.** The audit names the file and line, quotes the code that is there, and attaches a proof: a live request against your local app, a failing test, or a step by step trace. A bundled validator rejects a finding whose quoted code is not where it says.
- **Tools, not only instructions.** The skills ship a request probe that replays, races and tampers with requests against an app on your own machine, and reports how a balance moved.
- **Measured on a real target.** The repository contains a practice app with 17 planted money bugs, the same app with all of them closed, and one exploit per bug that CI runs against both.

## Install

With the [skills installer](https://github.com/vercel-labs/skills), into whichever agent you use:

```bash
npx skills add moonetix/revenue-skills
```

One skill only, or see what is available first:

```bash
npx skills add moonetix/revenue-skills --skill money-audit
```

```bash
npx skills add moonetix/revenue-skills --list
```

As a Claude Code plugin:

```
/plugin marketplace add moonetix/revenue-skills
/plugin install revenue-skills@revenue-skills
```

As a Codex plugin: `codex plugin marketplace add moonetix/revenue-skills`, then pick it under `/plugins`.

Or copy any folder under [`skills/`](skills/) into your agent's skills directory. Each skill is self-contained.

Then ask in plain words:

> Audit this project for ways users could get free credits.

> Our payment webhook sometimes credits an order twice. Find out why and fix it.

> Add a referral program that cannot be farmed with fake sign-ups.

## The skills

**Find**

| Skill | What it does |
| --- | --- |
| [`money-audit`](skills/money-audit/) | Maps every path where value enters, moves or leaves, hunts ten classes of money bugs, proves each finding, and writes a validated report. Also answers focused questions about one handler or one change. |

**Build, for any app that charges, credits or pays out**

| Skill | What it does |
| --- | --- |
| [`build-ledger`](skills/build-ledger/) | An append-only ledger with a cached balance: idempotent entries, debits that cannot overdraw, reconciliation, and a migration path from a mutable balance column. |
| [`build-webhook-endpoint`](skills/build-webhook-endpoint/) | An endpoint for signed server-to-server events: raw-body verification, replay protection, content checks, and exactly-once effects. |
| [`handle-refunds-and-reversals`](skills/handle-refunds-and-reversals/) | Refunds, chargebacks and reversed conversions take back what the original granted, exactly once, with an explicit rule for balances already spent. |
| [`add-usage-credits`](skills/add-usage-credits/) | Prepaid credits for metered features such as AI generations or API calls, with reserve, commit and release for work whose cost is known only afterwards. |
| [`add-payouts`](skills/add-payouts/) | Withdrawals as a state machine: funds reserved first, the provider called with an idempotency key, limits, holds and reconciliation. |
| [`add-referral-program`](skills/add-referral-program/) | Referral rewards that are paid once, after a verified qualifying event, and taken back when that event is reversed. |
| [`guard-signups`](skills/guard-signups/) | Bonuses, trials and promo codes protected from fake and duplicate accounts, with an explainable score and a review outcome that does not lock real users out. |

**Build, for rewards apps and sites**

| Skill | What it does |
| --- | --- |
| [`add-offerwall`](skills/add-offerwall/) | An offerwall in a website, app, game or community: a server-built signed link, and a postback endpoint that credits each transaction once and honors reversals. |
| [`design-reward-economy`](skills/design-reward-economy/) | The numbers behind a rewards currency: rate, user share, bonus budget, payout threshold and hold periods, checked by a bundled script that prints the margin, the break-even points and every rule the numbers break. |

Every builder skill ends with a verification step: tests in your project's own framework, and probe commands with the result to expect. `design-reward-economy` verifies with its economy check instead.

## What the audit looks for

| Class | The question it answers |
| --- | --- |
| Unverified inbound events | Can someone outside make the app believe a payment or conversion happened? |
| Duplicate credit | Does a genuine event credit more than once when it arrives again? |
| Races on a balance | Can two requests at the same moment spend or withdraw the same funds? |
| Amounts trusted from the client | Does the server take a price, amount, plan or account from the request? |
| Money arithmetic | Can rounding, sign or range be bent? |
| Refunds and reversals | When money goes back, does what it bought go back too, exactly once? |
| Promo, trial and referral abuse | Can free value be claimed repeatedly, by one person or by a script? |
| Payout controls | Is every withdrawal limited, held and paid exactly once? |
| Secrets and access | Are the keys and the endpoints that move money out of ordinary users' reach? |
| Ledger and audit trail | Can every balance be explained from stored records? |

Each class has a reference with the code shapes to look for, how to prove them, and the cases that look like bugs but are not: [`skills/money-audit/references/`](skills/money-audit/references/).

## A finding has to prove itself

The audit writes `money-audit/findings.json` and runs the validator on it before it reports anything. This is what happens when a finding cites code that is not there:

```console
$ node skills/money-audit/scripts/validate-findings.mjs money-audit/findings.json --root .
error: finding MA-03 location: snippet not found at routes/webhooks.mjs:20. The text is at line 8.
error: finding MA-07: proof.result must say what the run showed
error: coverage: class "payout-controls" is not accounted for

INVALID: 3 problems. Fix the report, do not delete the check.
```

A proof made with the probe looks like this. Ten purchases at once, against an account that can afford one:

```console
$ node skills/money-audit/scripts/probe.mjs race spend.json --parallel 10 --observe me.json
{
  "probe": "race",
  "request": "POST http://127.0.0.1:3000/api/spend",
  "edits": [],
  "sent": 10,
  "statuses": {
    "200": 10
  },
  "samples": [
    {
      "status": 200,
      "body": "{\"item\":\"theme\",\"balance\":0}"
    }
  ],
  "ms": 38,
  "observed": {
    "path": "balance",
    "before": 300,
    "after": 0,
    "delta": -300
  }
}
```

All ten succeeded, ten items were delivered, and the balance fell by the price of one. This is real output from the practice app in this repository.

## Measured

Before a release we run the audit the way a user would: a fresh agent session, a copy of the app with nothing else from this repository, and `money-audit` as its only guidance. One run each, with Claude Code:

| Target | Result |
| --- | --- |
| [`playground/vulnerable/`](playground/vulnerable/) | 17 of 17 planted bugs found. 24 findings, all accepted by the validator, 20 of them proved with live requests. The one finding outside the answer key was a real weakness. |
| [`playground/fixed/`](playground/fixed/) | 1 finding, nine classes clear. The finding was real: a refund that arrived before its payment left the coins in the account. It is fixed now, and has a test. |

The practice app was written for this repository, so read this as an end to end check and not as a benchmark on unfamiliar code. Results vary with the agent and the model. Measure your own with the scorer below.

## The practice app

[`playground/`](playground/) holds Coinjar, a small backend that sells, grants, moves and pays out virtual coins, in two versions:

- [`playground/vulnerable/`](playground/vulnerable/) works, and loses money in 17 ways.
- [`playground/fixed/`](playground/fixed/) has the same features with every one of those ways closed. It is also the tested reference for the patterns the builder skills describe.

[`test/playground.test.mjs`](test/playground.test.mjs) contains one exploit per planted bug. Each must succeed against the vulnerable app and fail against the fixed one, on every commit.

To measure your own agent, copy `playground/vulnerable/` out of the repository, have the agent audit the copy, and score the result:

```bash
node playground/score.mjs path/to/copy/money-audit/findings.json
```

Details are in the [playground README](playground/README.md). The [answer key](playground/ANSWER-KEY.md) is a spoiler.

## Safety

- The audit reads code and probes only an app running on your machine. It does not change application code unless you ask for fixes.
- The probe refuses any target that is not a loopback address unless you name the host with `--allow-host`. It sends at most 20 requests in sequence or 50 at once, and does not follow redirects. It is a proof tool, not a load or scanning tool.
- Findings never contain secret values. When a live secret is found in code, the report says where it is and what it opens.
- Test only systems you own or are authorized to test.

## Repository

```
skills/        ten skills, one folder each: SKILL.md, references/, scripts/, evals/
playground/    the practice app (vulnerable and fixed), answer key, scorer
test/          exploits against both apps, tests for the scripts, repository rules
scripts/       skill validation and shared-script sync
```

```bash
npm test
```

```bash
npm run validate
```

Node 22.13 or newer for the tests and the practice app, Node 20 or newer for the scripts inside the skills. Nothing to install. [AGENTS.md](AGENTS.md) describes the rules for changes and how to add a skill. If the audit missed a bug you have seen in the wild, [tell us the shape of it](https://github.com/moonetix/revenue-skills/issues/new?template=missed-bug.yml).

## Further reading

- Moonetix Academy: [Ad fraud and bot traffic](https://moonetix.com/academy/strategy/ad-fraud-and-bot-traffic), [How to stop fake signups](https://moonetix.com/academy/traffic-quality/stop-fake-signups-rewards-site), [How to prevent referral fraud](https://moonetix.com/academy/traffic-quality/prevent-referral-fraud), [Virtual economy design](https://moonetix.com/academy/monetization/virtual-economy-design), [What are postback macros?](https://moonetix.com/academy/glossary/what-are-postback-macros)
- Libraries and data the builder skills can lean on: [referral-engine](https://github.com/moonetix/referral-engine), [signup-guard](https://github.com/moonetix/signup-guard), [reward-economy-kit](https://github.com/moonetix/reward-economy-kit), [affiliate-postback-macros](https://github.com/moonetix/affiliate-postback-macros), [datacenter-ip-ranges](https://github.com/moonetix/datacenter-ip-ranges), [offerwall-postback-handlers](https://github.com/moonetix/offerwall-postback-handlers), [offerwall-fraud-playbook](https://github.com/moonetix/offerwall-fraud-playbook)

## About Moonetix

Moonetix is an affiliate network. Publishers add its offerwall to an app, game, website, bot or community, and users earn the publisher's own currency by completing offers. Publisher accounts: [moonetix.com/register](https://moonetix.com/register?from=github-revenue-skills).

## License

MIT. See [LICENSE](LICENSE).
