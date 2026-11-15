# Money map: Coinjar

Storage: `users.balance` (one mutable REAL column, `db.mjs:8`). There is no ledger table. `orders`, `transactions` (offer postbacks), `purchases` and `payouts` each record one kind of movement; promo, referral, admin, transfer and webhook credits leave no row that explains the balance change.
Amount types: REAL (floating point) for `users.balance`, `orders.coins`, `transactions.reward`, `purchases.price`, `payouts.coins`, `payouts.usd`. Only `orders.price_cents` is an integer.
Constraints: `users.email` is UNIQUE and the tables have primary keys. Nothing else: no unique index on `transactions.tx_id`, no redemption table, no CHECK on any amount.
Concurrency: one Node process, `node:sqlite` (`DatabaseSync`, synchronous calls), default `:memory:` database. No handler uses a transaction (`BEGIN` does not appear in the code). Handlers that `await` a provider between the read and the write (`/api/spend`, `/api/payouts`, `/postback/offerly`) let other requests run in the gap.
Middleware: `lib/http.mjs` only parses the body and resolves the session token. No rate limit, no signature check, no gateway in front of the routes.
Value: 100 coins = 1 USD on payout (`config.mjs:8`). Coins leave as gift cards.

| # | Direction | Path | Handler | Caller | Verified by | Trusts | Writes | Repeat protection | Atomicity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | in | POST /webhooks/paylane | routes/webhooks.mjs:6 | Paylane (payment provider), reachable by anyone | HMAC of `t.body` in `Paylane-Signature`, only when the header is present (line 8); secret has a fallback (config.mjs:4); no timestamp window (lib/paylane.mjs:6) | `event.type`, `event.data.order_id`; `orders.coins` written earlier by the client (row 6) | `orders.status`, `users.balance` | none: no status check, event id not stored | two statements, no transaction |
| 2 | in | GET /postback/offerly (status 1) | routes/postback.mjs:11 | Offerly (offerwall), reachable by anyone | HMAC of `user_id:tx:reward:status` in `hash`, skipped when `debug=1` (line 17); key has a fallback (config.mjs:5); compared with `!==` | `user_id`, `tx`, `reward`, `status` from the query; any status other than `2` is treated as a credit | `transactions`, `users.balance`, notifier call | `SELECT` on `tx_id` then insert, no unique index | select, `await` notifier, insert, update |
| 3 | out (reversal) | GET /postback/offerly (status 2) | routes/postback.mjs:26 | Offerly | same as row 2 | `user_id`, `reward` from the message, not from the original credit | `users.balance`, `transactions` | none | two statements, no transaction |
| 4 | in | POST /api/promo | routes/promo.mjs:9 | signed-in user | session | `body.code` (looked up in `PROMOS`, config.mjs:19) | `users.balance` | none: no redemption record | one statement |
| 5 | in | POST /api/signup (referral bonus) | routes/auth.mjs:17 | anonymous | nothing; email format only, no verification | `body.ref` | `users` row, referrer's `users.balance` (+500, config.mjs:7) | `users.email` UNIQUE per address; nothing limits bonuses per referrer | insert, then update |
| 6 | in | POST /admin/grant | routes/admin.mjs:4 | support staff | shared `x-admin-key` (config.mjs:6 with fallback); the same key is in `public/admin.js:1`, served to everyone | `body.user_id`, `body.amount` (any finite number, negative allowed) | `users.balance` | none | one statement, no record |
| 7 | moves | POST /api/checkout | routes/checkout.mjs:8 | signed-in user | session | `body.pack` (price from `PACKS`), `body.coins` (line 16, overrides the pack's coin count) | `orders` (pending) | n/a | one statement |
| 8 | moves | POST /api/spend | routes/wallet.mjs:8 | signed-in user | session | `body.item` (price from `ITEMS`, config.mjs:17) | entitlement provider call, `users.balance` (absolute value), `purchases` | none | read, `await` grant, write stale value |
| 9 | moves | POST /api/transfer | routes/wallet.mjs:29 | signed-in user | session | `body.from` (line 34), `body.to`, `body.amount` (finite, sign not checked) | two `users.balance` updates | none | synchronous read, check and two updates; no transaction |
| 10 | out | POST /api/payouts | routes/payouts.mjs:7 | signed-in user | session | `body.amount` (> 0, no minimum, no cap, fractions allowed) | gift card provider call, `users.balance`, `payouts` (status `paid`) | none; no idempotency key to the provider | check, `await` provider, then deduct, then record |
| 11 | read | GET /api/me, GET /api/payouts | routes/auth.mjs:45, routes/payouts.mjs:29 | signed-in user | session; rows selected by the session's user id | nothing | nothing | n/a | n/a |
| 12 | static | GET /public/* | lib/http.mjs:33 | anonymous | nothing (`path.basename` keeps it inside `public/`) | path | nothing; serves `admin.html` and `admin.js` with the admin key | n/a | n/a |

## Rules these paths depend on

| Rule | Where | Can the client influence it? |
| --- | --- | --- |
| Pack prices and coin counts | `PACKS`, config.mjs:11 | Price no. Coin count yes, through `body.coins` (row 7). |
| Item prices | `ITEMS`, config.mjs:17 | No. |
| Promo values | `PROMOS`, config.mjs:19 | No, but there is no limit on how often a code is redeemed. |
| Referral bonus | `referralBonus: 500`, config.mjs:7 | No, but it is paid for any sign-up. |
| Payout rate | `coinsPerDollar: 100`, config.mjs:8 | No, but the result is rounded to the nearest cent, upward for 0.5 coins. |
| Payout limits, holds | none exist | n/a |

## Background work

None. No queue, cron job, scheduler or reconciliation job exists in the project.
