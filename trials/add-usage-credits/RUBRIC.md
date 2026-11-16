# Rubric: add-usage-credits

Task: the free assistant at `POST /api/ask` (streams an Anthropic-compatible Messages answer) must cost coins: `ceil((input_tokens + 10 x output_tokens) / 100)` from the provider's usage, answers capped at 400 tokens, 402 without coins for the longest answer, free when the model fails before output, charged for what was delivered when it stops part way, retries with the same `Idempotency-Key` never asked or charged twice, `GET /api/me` balance is spendable coins. Coinbarn's coins are the credits; they already arrive through verified purchases and offers. The checker funds users with `POST /admin/grant` and runs its own model sandbox (`lib/fake-llm.mjs`, the same code as the workspace's `tools/llm-sandbox.mjs`, one token per word) with `LLM_TIMEOUT_MS=2000`. Prompt triggers drive the sandbox: `[sandbox:words=N]`, `slow`, `cut`, `error`, `hang`.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| U01 | 37-token answer: charged exactly the price of the reported usage | Priced from the provider's reported usage, rounded up once |
| U02 | Body with `max_tokens: 100000`, `cost: 0`, `credits: 0`, `price: 0`: the model gets at most 400, the charge is the real price | The cost comes from the server's price list; the same limit priced into the reservation is passed to the work |
| U03 | 30 coins, longest answer costs about 41: 402, the model is not called | Bound not affordable: refuse with 402; no path runs metered work first |
| U04 | 100 coins, ten slow questions at once with different keys: at most two model calls, balance never below zero | A reservation is one conditional statement on `balance - reserved`; credits reserved before the work starts |
| U05 | One key five times at once and once more after the answer: one model call, one charge | A retried request carries an idempotency key scoped to the account and is charged once; the retry answers with the stored state |
| U06 | Provider answers 529 before any output: no charge | Work that fails with nothing delivered: release |
| U07 | 86-token prompt, stream dropped after 5 tokens: charged between the price of 5 and of 20 output tokens | A cut stream is charged for what was delivered, at most the bound |
| U08 | Provider starts the stream and hangs: the request ends within 15 s, no charge | The work has a timeout below the reservation's lifetime; timeout before output: release |
| U09 | Client disconnects after about 5 tokens of a slow 60-token answer: the provider request is aborted, the charge is at least 1 and at most the full answer, nothing stays reserved | The user's connection closed: abort the provider request, then commit what was used; settle on every path, not in the client |
| U10 | `GET /admin/reconcile` reports no mismatch | Every change is a ledger row through one function |

## Rules reviewed by reading the code (not automated)

- No database transaction is held open across the model call (reserve commits first; the settle has its own transaction).
- A reservation is settled once by a guarded status change; a commit never charges more than was reserved.
- Every reservation has an expiry and a scheduled sweeper releases stale ones; `reserved` equals the sum of open reservations, and both reconcile queries are scheduled.
- Other debits (spending, transfers, cash-outs) respect `balance - reserved`, so they cannot spend coins held by a running question.
- The price list lives on the server in one place, with a version stored on the reservation if prices can change.
- Only reversal paths take a balance below zero.
- The metered work runs on the server; the client never sees the provider key.
