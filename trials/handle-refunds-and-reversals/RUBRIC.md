# Rubric: handle-refunds-and-reversals

Task: Stripe `charge.refunded` (running total in `amount_refunded`), `charge.dispute.created` and `charge.dispute.closed` on `POST /webhooks/stripe`, and Rewardly reversal postbacks (`status=2`), take back what the original credit granted. The checker runs the app with `PAYOUT_HOLD_SECONDS=0` and a Giftly sandbox.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| R01 | Pay 499 cents for 500 coins, full refund: balance 0 | A refund takes back the grant (playground V10) |
| R02 | The same refund event ten times at once, again in sequence, and as a new event id with the same running total: taken once | Each refund stored under a unique key; duplicates answered 2xx; all reversals of one order serialized |
| R03 | Running totals 166, 332, 499 cents: balances 334, 168, 0 | A full refund in parts takes back exactly the grant; shares computed on the running total |
| R04 | Spend 300, full refund: balance -300; spend and transfer refused; a new credit of 200 gives -100 | A reversal never fails for a low balance; nothing clamps at zero; while below zero no spend or transfer succeeds |
| R05 | Refund before the Checkout event, then the payment, then the refund again: balance 0 | A reversal whose original is not there yet is stored, and the code that credits the original applies it |
| R06 | Offer credit 200, reversal twice: balance 0 | A reversal is applied once (playground V11) |
| R07 | Reversal signed with reward 50 for a 200 credit takes 200; reversal signed for another user takes from the owner only | No amount or user id from a reversal message reaches a balance update; the entry goes to the account the original credited |
| R08 | Reversal of an unknown tx: 2xx, no change; the credit afterwards (twice) and another reversal: balance 0 | A reversal before its original is stored, not dropped and not subtracted |
| R09 | Dispute opened (twice), then won (twice): 0 while open, 500 after | A dispute takes once at opening and gives back, when won, the amount it took; closing is a conditional move |
| R10 | Dispute opened then lost (twice): stays taken | Dispute life cycle |
| R11 | Refund 250 cents, then a dispute, then won: 250, 0, 250 | Everything taken back for one original never adds up to more than it granted; a win restores only what the dispute took |
| R12 | Friend's purchase qualifies the referrer for 500; full refund takes the referrer's 500 back | Dependent rewards go back with the original |
| R13 | 500 bought coins plus 600 offer coins, offer reversed: a 500 payout is refused and no gift card is issued | Check every way value leaves an account after a reversal (payouts); a reversal reduces what can be cashed out |
| R14 | Forged and unsigned `charge.refunded`, forged reversal postback: 4xx, no change | Reversal handlers sit behind the same verification as the handlers that credit |
| R15 | `GET /admin/reconcile` reports no mismatch at the end | After every test, the reconciliation query returns no rows |

The naive solution passes R02 only because it clamps at zero; a naive handler that does not clamp fails it.

## Rules reviewed by reading the code (not automated)

- Every reversal entry points at the entry it reverses (a reference to the original row, not just the same order id).
- Each refund and each dispute is stored under a unique (provider, id) key in the schema.
- All reversals of one order run under a lock on that order (SQLite's `BEGIN IMMEDIATE` serializes; check the agent did not open a second connection or read outside the transaction).
- Forgiven debt is an entry of its own with an actor and a reason (no write-off path is required by the task).
- Access checks read the grant at the time of use (the app grants only coins; check that nothing else was granted without a revoke path).
- A dispute in a `warning_*` status (an inquiry) is not treated as a chargeback without a decision; unknown statuses go to a person.
- The webhook, an admin refund and a reconciliation job call the same functions (the task has no admin refund; check none was built twice).
- Reports of reversals and debt exist, and the reconciliation job is scheduled.
