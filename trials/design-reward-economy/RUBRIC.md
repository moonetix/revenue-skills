# Rubric: design-reward-economy

Task: the owner's measured numbers and targets are in `data/owner-notes.md`; the current settings (rate 1,000, share 85%, sign-up bonus 1,000 coins credited at once, daily 25, minimum $1, no hold) break seven rules of the skill's check. The agent writes `config/economy.json`, makes it pass, and makes the small economy service (`config/settings.mjs`, `GET /api/economy`, `GET /api/reward-preview`, the cash-out page at `/`) use exactly those numbers. The checker runs the skill's `scripts/economy-check.mjs` from `skills/design-reward-economy/` in this repository, not the copy in the agent's folder.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| E01 | `checkEconomy()` on `config/economy.json` returns ok | The check exits with 0 on the committed economy file |
| E02 | Revenue, users, reversal rate and arrival curve, late recovery, fees, average payout, redemption, costs, cash, take-up and coverage equal the owner's numbers or are more cautious; outstanding coins keep their dollar value at the chosen rate | Every number has a stated source; never an industry average or a guess; measured inputs, not tuned ones |
| E03 | `minMarginPct >= 15`, `minReversalsInsideHoldPct >= 90`, `maxDaysToMinimumPayout <= 30`, `maxBonusPctOfRevenue <= 10` | Do not loosen a target to make the check pass |
| E04 | The same file with every bonus take-up at 100, redemption 100 and the average payout at the minimum also passes | The worst case exits 0 (the owner cannot confirm an exception in a trial) |
| E05 | Each section (currency, earning, volume, payout, reversals, costs, targets) has a `_` note key | Record the source of each number in a note |
| E06 | `GET /api/economy` equals the file: rate, share, the three bonus amounts, minimum in coins, hold days | Each number exists once in the code; the configuration module equals the economy file |
| E07 | `GET /api/reward-preview` for 0.05, 0.37, 1.15, 2.675, 0.0005, 3.333333 and 12.5 dollars equals the exact floor of payout x rate x share | One conversion function, integer arithmetic, credits round down once |
| E08 | The cash-out page shows the new minimum, the bonus amounts and the hold, and no longer says coins can be cashed out right away | Each number exists once; user-facing text states what the app does |

## Rules reviewed by reading the code (not automated)

- Bonuses alone cannot reach the payout minimum (enforced by the check's `bonus-only-payout` rule inside E01; review that the sign-up bonus really waits for a first earning if `requiresEarning` is set).
- The redeem rate equals the rate, or the difference is recorded and checked.
- A reversal takes back the coins stored with the credit, never a recomputed amount (no reversal code in this service; check any code the agent added).
- Each bonus is a ledger entry whose unique reference enforces its frequency (no ledger in this service; note whether the agent said so).
- Boosts do not stack.
- A test runs the check on the committed file and asserts the configuration equals the file; a monthly comparison with actuals is scheduled.
- `economy.worst.json` exists and the report was shown to the owner; warnings are fixed or noted as accepted.
- Text shown to users states what an offer pays, not what a user will earn.
- The rate change converts existing balances (the file says so; a migration or a written step exists).
