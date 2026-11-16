# Rubric: build-webhook-endpoint

Task: Stripe Checkout webhooks at `POST /webhooks/stripe` credit paid orders. Events are signed the way the skill's `assets/sign-test-event.mjs` signs them in `stripe` mode; the checker imports that file from `skills/build-webhook-endpoint/` in this repository.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| W01 | Starts the app without `STRIPE_WEBHOOK_SECRET` and expects it not to listen | The secret has no default and no fallback. The process fails at start-up without it |
| W02 | One genuine `checkout.session.completed` credits the pack | Baseline: a correctly signed event is accepted |
| W03 | No `Stripe-Signature` header: 4xx, no credit | Verification runs on every request; no header skips it (playground V01) |
| W04 | Signed with another secret: 4xx, no credit | Verification before anything else |
| W05 | One byte of the body changed under the old signature: 4xx; the untouched event still works afterwards | Signature over the raw body; refusal writes nothing |
| W06, W07 | Timestamp 600 s in the past, 600 s in the future: 4xx | A timestamped signature outside the tolerance is refused, in the past and in the future |
| W08 | The same event three times in sequence: credit once, every answer 2xx | Event id under a unique key; a duplicate is answered 2xx (playground V03) |
| W09 | The same event ten times at once: credit once, every answer 2xx | No SELECT decides whether an event is new; conditional state change |
| W10 | `completed`, `async_payment_succeeded` and a second `completed` (three event ids, one order): credit once | Every state change is a conditional update; two events for one order give one effect |
| W11 | `amount_total` of 1 cent: no credit, and the correct event afterwards still credits | Amount compared with the order before anything is granted; the order stays pending |
| W12 | Currency `eur`: no credit | Currency compared with the order |
| W13 | `payment_status: unpaid`: no credit; the later `async_payment_succeeded` credits | Only the type that means settled money grants (Stripe reference: grant only when not unpaid) |
| W14 | `customer.created`: 2xx, nothing changes | An event type the app does not handle is acknowledged and changes nothing |
| W15 | Checkout body with `coins: 1000000` and event metadata with coins: credit is the pack's 500 | The grant is read from the order (playground V07) |
| W16 | Event for an unknown order: no credit, not 5xx | Content checks; a genuine event that does not match must not make Stripe retry forever |
| W17 | Header with `v1=<wrong>`, `v1=<right>`, `v0=...`: accepted | Provider scheme as documented (Stripe reference: accept when any v1 matches, ignore other schemes) |
| W18 | Body pretty-printed and signed as sent: accepted | The signature is computed over the raw bytes, not a re-serialized object |
| W19 | A badly signed delivery with an event id, then the genuine event with the same id: credited | Verification before any database work; a refused request leaves no event row |
| W20 | A fresh order still credits at the end | Regression guard |

## Rules reviewed by reading the code (not automated)

- Signatures are compared with a constant-time function.
- The event id is stored in the same transaction as the effect, and the response is sent after the commit. A failure before the commit leaves no event row and answers 5xx. (Cannot force a mid-handler failure from outside.)
- No external call, mail or slow job runs inside the transaction.
- Reversing events (`charge.refunded`, disputes) are applied or stored, never acknowledged and dropped. The task does not ask for them; check whether the agent stored or routed them, or told the user.
- The secret appears in no log line, error message or client bundle; rotation (two secrets at once) is supported and written down in a runbook.
- Every value the handler acts on is covered by the signature or comes from the app's own records (W15 covers the coins; review the rest).
- A test file exists in the project's framework covering the skill's Verify list, and the agent probed the endpoint.
