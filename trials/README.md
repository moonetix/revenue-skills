# Skill trials

A trial measures whether one builder skill makes a coding agent build money-handling code correctly. A fresh agent session gets a small starter app, a plain request as a user would type it, and the one skill. When the agent is done, an automated checker starts what it built and attacks it: retried and forged events, parallel requests, lost provider answers, wrong amounts. Each check prints PASS or FAIL.

Use the trials to measure your own agent and model, or to check that a change to a skill still produces working code.

## Results

Measured on 2026-11-16 with Claude Opus 5.5 running as a Claude Code agent: one non-interactive session per skill, one run per skill (two for `add-payouts`). Every checker ran three times on what the agent built, and each gave the same result all three times.

| Skill | Checks | First-run result | Notes |
| --- | --- | --- | --- |
| `build-webhook-endpoint` | 20 | 20/20 | |
| `handle-refunds-and-reversals` | 15 | 15/15 | |
| `add-offerwall` | 14 | 14/14 | |
| `guard-signups` | 14 | 14/14 once its newly required secret was supplied | The agent made a keyed-hash secret mandatory and flagged it as a deploy step. The task's environment did not include it, so the run with the task's environment alone did not start. |
| `build-ledger` | 12 | 12/12 | |
| `add-referral-program` | 12 | 12/12 | |
| `add-usage-credits` | 10 | 10/10 | |
| `design-reward-economy` | 8 | 8/8 | |
| `add-payouts` | 16 | 13/16 | The agent added a waiting window that stopped a manual resolve right after an unknown outcome (P11 to P13). The skill now says that lookups and repeats with the same key are safe and that a manual resolve must ask the provider right away. A second fresh run with the fixed skill: 16/16. |

What these numbers are and are not:

- One agent and one model, one run per skill. Another agent, another model or another run can do better or worse.
- The checks cover what can be seen from outside the app: HTTP answers, balances, the provider sandboxes and, for `build-ledger`, the database file. Each skill's `RUBRIC.md` lists the rules left to code review, such as no transaction held open during a provider call.
- The starter apps and tasks were written for this repository, alongside the skills.
- After these runs, check P06 of `add-payouts` was made stricter: the Giftly sandbox now takes 300 ms to answer during it, so a check-then-debit race shows every time. The second `add-payouts` run still passes all 16 checks with it.
- `money-audit` is not a builder skill and has no trial here. It is measured with the practice app and the two audits in [`examples/`](../examples/).

## Layout

```text
trials/
  README.md               this file
  expected.json           per skill: the number of checks and the checks the naive solution fails
  lib/                    shared checker code: start the app, sign events, race requests,
                          the Giftly and model provider sandboxes
  <skill>/
    TASK.md               the request, as a user would type it
    workspace/            the starter app the agent extends
    check.mjs             the checker: PASS or FAIL per check, a total, exit 1 on any FAIL
    RUBRIC.md             what each check covers, and the rules left to code review
    _reference/           a solution that passes every check
    _naive/               an obvious naive solution, to show what the checks catch
```

The starter app is Coinbarn, a small backend of a rewards app (Node 22.13 or newer, SQLite through `node:sqlite`, no packages). Each `workspace/` has a part removed or left out:

| Skill | What the starter lacks | Checks |
| --- | --- | --- |
| `build-webhook-endpoint` | `POST /webhooks/stripe`, its event table and its secret | 20 |
| `handle-refunds-and-reversals` | Refund handling in the Stripe webhook, Rewardly reversal postbacks, the referral take-back, the reversal term of the withdrawable amount | 15 |
| `add-offerwall` | The offer postback and its reversal table; payouts no longer know about offer earnings or a hold | 14 |
| `guard-signups` | The promo route (codes and caps) and any sign-up bonus or screening; the lists are in `data/` | 14 |
| `build-ledger` | The ledger: every route writes `users.balance` directly | 12 |
| `add-referral-program` | Codes, attribution, the referral settle function and every call to it | 12 |
| `add-usage-credits` | Credits for a free `/api/ask` assistant with a streaming model client | 10 |
| `design-reward-economy` | A small economy service with losing numbers and a float conversion; the owner's data is in `data/owner-notes.md` | 8 |
| `add-payouts` | The payouts route and table, the Giftly client, the payout limits and the resolve route | 16 |

## Run a trial

The agent must not be able to read the checker or the solutions, so it works in a copy of the starter outside this repository. Give it nothing but the copied `workspace/` and the skill folder: not `_reference/`, `_naive/`, `check.mjs`, `RUBRIC.md` or `lib/`.

1. Copy the starter to a fresh folder outside the repository and install the one skill in it. From the root of this repository:

   ```bash
   SKILL=add-payouts
   TRIAL=../trial-$SKILL
   mkdir -p "$TRIAL/.agents/skills"
   cp -r "trials/$SKILL/workspace/." "$TRIAL/"
   cp -r "skills/$SKILL" "$TRIAL/.agents/skills/$SKILL"
   ```

   The prompt below names this folder, so any agent can find the skill there; the results above were measured with this layout. To test discovery as well, use your agent's own project folder instead (`.claude/skills/` for Claude Code, `.goose/skills/` for Goose) and change the path in the prompt to match.

2. Start a new agent session in that folder with this prompt: the contents of `trials/<skill>/TASK.md`, an empty line, then two fixed lines.

   ```text
   <contents of trials/<skill>/TASK.md>

   Use the <skill> skill in .agents/skills/<skill>. Work only inside this folder.
   This is a non-interactive session: do not stop to ask questions; where the request is silent, choose the safe default and say which one you chose.
   ```

   The second fixed line is there because every skill tells the agent to ask the user once; without it, an agent may stop and wait. Do not add hints about attacks, the checker or the rubric.

3. When the agent says it is done, run the checker on its folder, from the root of this repository:

   ```bash
   node "trials/$SKILL/check.mjs" "$TRIAL"
   ```

   Run it three times. A check that flips between runs is a finding about the agent's code (a race it did not close), not noise: the checkers give the same result every time on `_reference/` and `_naive/`.

4. Read the agent's code against the rules under "Rules reviewed by reading the code" in `trials/<skill>/RUBRIC.md`, and record the total, the failed checks with their reasons, and your verdicts on those rules.

The checker starts `node server.mjs` in the folder on a free port on 127.0.0.1, with only the environment variables the task names (plus `PATH` and `HOME`), and runs its own Stripe signing, Giftly sandbox and model provider sandbox in the same process. It stops everything when it ends, and writes only to `trials/.run/` (the SQLite file of `build-ledger`), which it removes again. A run takes 2 to 60 seconds; `add-payouts` and `add-usage-credits` are the slowest because they wait for holds and timeouts.

### When the app needs a setting of its own

An agent may add a required setting, such as a secret for a keyed hash, and refuse to start without it. That can be the right call, but the task's environment does not have it, so the app does not start and every check fails. Pass the new settings in `TRIAL_EXTRA_ENV`, as `NAME=value` pairs separated by spaces:

```bash
TRIAL_EXTRA_ENV="SIGNUP_KEY_SECRET=any-long-random-value" node trials/guard-signups/check.mjs "$TRIAL"
```

The checker first tries the task's environment. Only when the app does not start does it start it again with the extra settings, and it reports that apart from the attacks: a `START` line before the checks, and one after the total.

| Exit code | Meaning |
| --- | --- |
| 0 | Every check passed, with the task's environment |
| 1 | At least one check failed |
| 2 | Usage error |
| 3 | Every check passed, but only with `TRIAL_EXTRA_ENV` |

`TRIAL_EXTRA_ENV` works with every checker. It is how the `guard-signups` result above was measured.

## Validate the checkers

A checker is only useful if it passes a correct solution and fails a broken one. `_reference/` is a solution that should pass every check, and `_naive/` the obvious solution a developer might write first, which should fail exactly the checks listed in [`expected.json`](expected.json):

```bash
npm run trials:validate
```

```bash
npm run trials:validate -- add-payouts
```

It runs every checker against both, one at a time, and takes about two minutes. CI runs it on every commit. Run it after changing a checker, a starter or a reference. To see a starter fail the feature checks, run a checker on its `workspace/`.

## Add a trial for a new skill

1. Copy a trial folder that is close to the new skill. Change `workspace/` so it lacks the feature the skill builds, and write `TASK.md` as a user would ask for it: what the feature must do, the routes and settings, and no hints about how to make it safe.
2. Write `check.mjs` with `lib/harness.mjs`: start the app with `startTrialApp`, one `r.check(id, rule, fn)` per rule that can be seen from outside, and `r.finish()`.
3. Write `RUBRIC.md`: one row per check with the skill rule it covers, and the rules that only code review can judge.
4. Build `_reference/` until every check passes, and `_naive/` as the solution a developer would write first. Add the skill to `expected.json` with the number of checks and the checks `_naive/` fails.
5. Run `npm run trials:validate -- <skill>` three times and `npm test`. `test/repo.test.mjs` checks that every builder skill has a trial.
