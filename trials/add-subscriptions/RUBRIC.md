# Rubric: add-subscriptions

Task: Coinbarn Plus, a monthly Stripe Billing subscription. `GET /api/plus/perk` answers 200 only while the user has Plus and 402 or 403 otherwise; every paid month grants 300 coins; Plus starts with the first payment, survives a failed renewal for `PLUS_GRACE_SECONDS` after the last paid month, lasts until the end of the paid month after a cancel, and ends at once on a refund or a dispute; `POST /admin/plus/sync` repairs what lost webhooks left behind. The checker runs its own Stripe API sandbox (`lib/fake-stripe.mjs`, the same code as the workspace's `tools/stripe-sandbox.mjs`) with `PLUS_GRACE_SECONDS=3`, and keeps the sandbox's subscriptions and invoices in step with the events it signs, as Stripe does. Events use API version `2026-10-28.endive`: the period is on the subscription items, an invoice names its subscription in `parent.subscription_details`, and a charge is linked to its invoice through `GET /v1/invoice_payments`.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| S01 | `customer.subscription.created` while `incomplete`, then `invoice.payment_failed` for the first invoice: no Plus, no coins | Access starts with the first paid invoice; an incomplete subscription grants nothing |
| S02 | The first invoice paid (`invoice.paid`, then the subscription `active`): Plus and 300 coins | Entitlements come from the provider's state after a verified event |
| S03 | The same `invoice.paid` again, ten times at once, and as a second event id for the same invoice: 300 coins, Plus | The event id is stored under a unique key; per-period credits are keyed by subscription and period, not by event |
| S04 | A renewal invoice (`subscription_cycle`) delivered twice: 600 coins | Per-period credits granted once per period, again for the next period |
| S05 | Renewal fails (`invoice.payment_failed`, subscription `past_due`): still Plus within the grace period | Past due keeps access until the end of the last paid period plus the grace period |
| S06 | Past the first month and the grace period, the renewed subscription still has Plus | A renewal extends access to the new period end |
| S07 | Past the grace period, with no further event, the unpaid subscription has no Plus | Access is computed from stored dates at the time of use; time alone ends the grace period |
| S08 | The late renewal paid after the grace period, and its invoice sent again under a new event id: Plus back, 600 coins | A recovered payment restores access; the period's credits are granted once |
| S09 | `cancel_at_period_end` with the period ending in 2 s: Plus until then; after the end and `customer.subscription.deleted`, none | Cancel at period end keeps access until the paid period ends |
| S10 | `customer.subscription.deleted` in the middle of a month: no Plus at once | An immediate cancel ends access at once |
| S11 | `charge.refunded` for the first invoice's PaymentIntent while Stripe still shows the subscription `active`: no Plus at once | A refund of a subscription payment ends access as decided, linked through the provider's records |
| S12 | `charge.dispute.created` for the same kind of payment: no Plus at once | A chargeback ends access at once |
| S13 | After a cancellation, an older `customer.subscription.updated` snapshot (status `active`) arrives: still no Plus | Order-independent handling: the stored state is the provider's latest object, not the last event to arrive |
| S14 | `invoice.paid` arrives before `customer.subscription.created`, whose snapshot still says `incomplete`: Plus and 300 coins | Same as S13, for an event that arrives before the object it refers to |
| S15 | `invoice.paid` signed with another secret, unsigned and signed 600 s ago, and a forged `customer.subscription.updated`: each 4xx, no Plus, no coins | Every event is verified like a payment event before anything is read from it |
| S16 | After a cancellation, the first genuine `invoice.paid` is delivered again (same event id, new signature): no Plus, coins unchanged | A replayed event changes nothing; the event id is stored with its effect |
| S17 | A checkout that sends `plan`, `status`, `plus`, `paid`, `current_period_end` and `coins`, and a perk request with `?status=active&plus=1`: no Plus, no coins | No client field grants or extends access |
| S18 | One user, two active subscriptions: cancel one, Plus stays; cancel both, Plus ends | One entitlement row per subscription; the user's access is the union of their subscriptions |
| S19 | The subscription is canceled in Stripe with no event delivered; `POST /admin/plus/sync`: no Plus | Reconciliation compares stored entitlements with the provider's list and repairs them through the same code |
| S20 | A paid, active subscription exists in Stripe but no event was delivered; sync: Plus | Same, for a lost activation |
| S21 | `GET /admin/reconcile` reports no mismatch at the end | Credits go through the ledger's one posting function |

## Rules reviewed by reading the code (not automated)

- No call to Stripe runs inside a database transaction. A failed Stripe call answers 5xx so that Stripe delivers the event again, and stores nothing.
- A fetched state cannot overwrite a newer one: the code keeps the time it fetched, or the provider's own ordering field, and writes only newer states. Two deliveries racing each other end in Stripe's current state.
- Subscriptions are stored under a unique provider subscription id, linked to the user through the app's own checkout record, never through a user id or email from the event.
- The webhook, the sync job and any admin action call the same function that stores a subscription and the same function that grants a period's coins.
- `invoice.paid` for a plan change or a manual invoice (`billing_reason` other than `subscription_create` and `subscription_cycle`) grants no second set of monthly coins for a period that already has them.
- `unpaid`, `paused`, `incomplete_expired` and any status the code does not know give no access.
- The sync job pages through the whole list (`has_more`, `starting_after`) and is scheduled, not only callable; its failures reach a person.
- `STRIPE_SECRET_KEY` has no default and appears in no log line.
- A trial, if the agent added one, is limited to one per identity (not part of the task).
