# Rubric: build-ledger

Task: Coinbarn without a ledger (every route writes `users.balance` directly; spending checks the balance, delivers, then subtracts without a condition; support grants take any amount without a reason). Move every coin movement onto a ledger, keep `users.balance` as the cached balance in the SQLite file at `DB_PATH`, add `GET /api/history`, require `reason` and an idempotent `request_id` on `POST /admin/grant`, and add `GET /admin/reconcile`. The checker runs with `DB_PATH` in a temporary folder (`trials/.run/`, removed when it ends), `PAYOUT_HOLD_SECONDS=0` and a Giftly sandbox.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| L01 | Purchase, offer, promo, spend, transfer, cash-out, referral bonus and grant on one user: at least 8 entries, at least 6 distinct kinds, newest first, adding up to the balance (also for the friend) | Every change to a balance has exactly one ledger row; the history is read from the ledger, newest first; kinds name the cause |
| L02 | One payment event ten times at once and three more times: credited once, history consistent | Unique (kind, reference) from the event; the update runs only when the insert reported a row |
| L03 | One postback ten times at once: credited once | Same |
| L04 | Balance 300, ten parallel 150-coin purchases: exactly two succeed, balance 0 | A debit is a single conditional statement; funds are taken before an external effect (playground V05) |
| L05 | Balance 500, ten parallel transfers of 100: five succeed, receiver +500 | Debits cannot overdraw (the starter's transfer is synchronous and already safe; this guards against a regression) |
| L06 | Transfers of 0, -400, 1.5, "100", 10,001 and grants of 0, 1.5, "x", 100,001: refused, no entry for either user | Amounts are integers, non-zero, within range, validated before posting (playground V08) |
| L07 | Spend 300 with 100: refused, no entry | A failed debit leaves no ledger row |
| L08 | Spend, then the offer is reversed twice: -300, spend and transfer refused, history consistent | Only reversal paths may push a balance below zero |
| L09 | Giftly declines a cash-out, then a resolve run: balance back to 600 once, history consistent | Funds are given back by a new entry when the external effect fails |
| L10 | Grant without reason, without request_id: refused; the same request_id twice: granted once | Every entry made by a person carries a reason; the reference comes from the request id |
| L11 | Two reads of the history change nothing; a guest is refused | Nothing in the read path writes |
| L12 | Reconcile is empty; after a direct `UPDATE users SET balance = balance + 7` in the database file it lists exactly that user | The reconciliation check exists and catches a direct write |

The naive solution (a trigger that logs every balance change) passes L02, L03, L05 to L09 and L11, and fails L01, L04, L10 and L12.

## Rules reviewed by reading the code (not automated)

- The ledger has a unique constraint on (kind, reference) in the schema, not only a check in code.
- The balance column is written in one function and nowhere else: search for `balance =` and `balance +`/`balance -` outside the posting function.
- The reference comes from the event (order id, tx, payout id, request id), never a random value for an event that can arrive twice.
- Ledger rows are never updated or deleted; corrections are new entries. A trigger or permission that blocks UPDATE and DELETE on the ledger is a plus.
- Existing balances got opening-balance entries (the checker starts with an empty database, so only code review shows the migration).
- Grants record the staff identity (the app has one shared admin key; check that the reason and some actor are stored) and staff cannot adjust their own account.
- The reconciliation command is scheduled and fails loudly.
- No `CHECK (balance >= 0)` was added if reversals may create debt.
