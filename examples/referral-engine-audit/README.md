# Example: an audit of referral-engine

This folder is the output of one `money-audit` run on [referral-engine](https://github.com/moonetix/referral-engine), a referral and commission library for JavaScript and PHP published by the same maintainer. It was not written for this repository and has no planted bugs.

The run used Claude Fable 5.2 in Claude Code on 2026-11-14, with the `money-audit` skill as it was before 1.0.0. The agent audited commit `174a132`. Its library code is identical to tag `v1.0.0`; the commits between the tag and it change only the CI configuration and one README sentence. It is a library with no server, so there was nothing to probe: the proofs are failing tests in the library's own test runner, small PHP scripts, and one code trace.

## What it found

Three ways for a payout to exceed the referrer's balance:

| ID | Severity | Finding | Proof |
| --- | --- | --- | --- |
| MA-03 | high | On MySQL and PostgreSQL, `PdoStore` lets parallel payouts for one referrer both pass the balance check. | Code trace. No database server could be run during the audit. |
| MA-01 | medium | A payout dated earlier than a payout or clawback already recorded passes the balance check, because the check reads the balance as of the payout's date. | Failing tests in JavaScript and a script for the PHP port. |
| MA-02 | medium | Payouts sent at the same moment all pass the balance check when a JavaScript store has no `withLock`, which the documentation called optional. | A failing test. |

The report also lists six notes that were not filed as findings, each with the reason.

The findings were fixed and released as referral-engine 1.0.1 through [pull request #1](https://github.com/moonetix/referral-engine/pull/1). Its CI runs a parallel payout test against real PostgreSQL 17, MySQL 8.4 and MariaDB 11.4 containers, which covers MA-03. The fixes are not part of this folder.

This is one run on one library. It shows what the skill produced on code it was not written next to; it is not a measurement of how often it finds such bugs.

## Files

| File | What it is |
| --- | --- |
| `findings.json` | The three findings, the notes, and the coverage of all ten classes. |
| `REPORT.md` | The report rendered from `findings.json`. |
| `money-map.md` | The public functions that move value, and what each expects from the app that calls it. |
| `evidence/` | Saved test output, the PHP scripts and their output, and the script behind the notes. |
| `project/test/` | The two test files the agent added to the library, at their paths in it. |

Two machine paths in the saved test output were replaced with `<project>`. Nothing else was changed.

## Check it

```bash
npm run check:example
```

The check exports `v1.0.0` and `v1.0.1` of referral-engine (it clones the repository, or uses a local checkout given with `--referral-engine <path>`), adds the agent's tests from `project/`, and then:

- runs the validator on `findings.json` against `v1.0.0`;
- runs the agent's tests on `v1.0.0`, where they must fail, and on `v1.0.1`, where they must pass.

Expected for this folder:

```console
examples/referral-engine-audit/ against referral-engine
        warning: finding MA-03: high severity rests on a code trace only. Run a probe or a test if the app can be started.
  ok    validator: VALID, 3 findings (0 critical, 1 high, 2 medium, 0 low)
  ok    the agent's tests fail on v1.0.0: 3 of 3 failing
  ok    the same tests pass on v1.0.1: 3 of 3 passing
```

The warning is expected: MA-03 is rated high on a trace, and the report says why.
