# Rubric: add-payouts

Task: Giftly gift card cash-outs at `POST /api/payouts`, `GET /api/payouts` and `POST /admin/payouts/resolve`, 1,000 coins = $1, minimum 5,000, 50,000 coins and 3 cash-outs per 24 hours, offer earnings only, hold from `PAYOUT_HOLD_SECONDS`. The checker runs the app with a 2 second hold and its own Giftly sandbox (`lib/fake-giftly.mjs`, the same code as the workspace's `tools/giftly-sandbox.mjs` plus a `slow` mode), whose mode it switches between `ok`, `slow`, `decline`, `lost`, `error` and `hang`.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| P01 | Amounts 0, -5000, 5000.5, "5000", 4999, null: all refused, no card, balance unchanged | The amount is a whole number, at least the minimum (playground V09) |
| P02 | 6,000 coins earned a moment ago, cash-out of 5,000: refused | Only matured earned value is withdrawable (playground V14) |
| P03 | 6,000 bought coins plus a promo: refused, `withdrawable` 0 | Only earned value is withdrawable, computed from the ledger |
| P04 | Matured 6,000, cash-out 5,000: one card of 500 cents, balance 1,000, status `paid` | Baseline, and conversion to whole minor units |
| P05 | Cash-out of 5,005 coins: refused, or paid without rounding up | The amount converts to whole minor units |
| P06 | Five parallel requests with different keys, balance covers one, while Giftly takes 300 ms to answer: one card, balance 1,000 | Funds taken in one transaction before the provider is called; conditional debit (playground V06) |
| P07 | One `Idempotency-Key` five times at once and once more later: one card, one debit, one payout id | Every request key returns the earlier payout; the provider call carries the payout id as idempotency key |
| P08 | Four cash-outs of 5,000 in a row: the fourth refused | Limits are server-side constants; count limit |
| P09 | 30,000 then 25,000 refused; two parallel 30,000 requests: one card | Daily amount limit, checked one request at a time per account |
| P10 | Giftly declines: status `failed`, coins back once, also after a resolve run | Funds return only on `failed`, in the same transaction, once per payout |
| P11 | Giftly issues the card and drops the connection: coins stay taken, status neither paid nor failed, one card; resolve: `paid`, still one card | `sending` is left only on a definite answer; a timeout is not a failure; resolve asks or repeats with the same key |
| P12 | Giftly answers 500 and issues nothing: coins stay taken; resolve pays once | Same; a repeat uses the same key |
| P13 | Giftly never answers: the request ends (timeout), coins stay taken; resolve pays once | The adapter sets a timeout; unknown is resolved, never refunded blindly |
| P14 | 6,000 offer coins reversed, 6,000 bought coins left: cash-out refused, no card | Only matured earned value, net of reversals, is withdrawable |
| P15 | 7,000 matured, 2,000 fresh, 3,000 bought: `withdrawable` is 7,000 | Show the user the truth: the withdrawable amount |
| P16 | `GET /admin/reconcile` reports no mismatch at the end | Payouts post `payout` and `payout_refund` entries through the ledger |

## Rules reviewed by reading the code (not automated)

- No database transaction is held open while Giftly is called.
- Every write to the payout status names the status it expects; a final status never changes; a conflicting provider answer is reported, not applied.
- The adapter's list of final failure codes is taken from `docs/giftly-api.md` and says so.
- Account state (banned, flagged) is checked at request and at send time. Coinbarn has no ban flag; check that the agent did not invent a path that skips it later.
- Destinations and their cool-down: the task pays to the account itself, so there is no destination change flow. Note whether the agent raised it.
- Staff decisions carry the staff member's identity; nobody approves their own payout (the task has no review queue; note whether one was added and how it is protected).
- The resolver, the reconcile queries and a provider comparison are scheduled, and their failures reach a person.
- A payout key past Giftly's 30-day lifetime is not repeated, and is reported.
