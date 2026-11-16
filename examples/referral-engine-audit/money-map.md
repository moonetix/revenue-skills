# Money map: referral-engine

referral-engine is a library, not a running service. It has no HTTP surface, no secrets and no clock: the integrating server calls it with IDs, integer amounts and Unix timestamps (`at`) after doing its own verification of postbacks and sessions. The money paths are therefore the public methods of `ReferralEngine`, in JavaScript (`src/`) and in the PHP port (`php/src/`), plus the stores that persist them. The examples in `examples/` call these methods from scripts and expose nothing to a network.

Storage: an append-only ledger, one row per change (`referral_ledger` in `schema/*.sql`: unique `entry_key`, BIGINT amounts, triggers that refuse UPDATE and DELETE). No mutable balance column: `balance()` replays the entries. Referrals live in `referrals`, keyed by referee.

Amount types: integers in the caller's smallest unit, limited to safe integers (2^53 - 1) in both languages. Rates are basis points; products go through `mulDiv` (BigInt in JavaScript, split multiplication in PHP), rounded down once.

Concurrency: decided by the store.

| Store | What `withLock(key, fn)` does |
| --- | --- |
| `MemoryStore` (JavaScript) | a promise queue per key, inside one process |
| `MemoryStore` (PHP) | runs `fn` directly, one request at a time |
| `SqliteStore` (JavaScript) | one queue for all keys plus `BEGIN IMMEDIATE` |
| `PdoStore` (PHP) | one PDO transaction per call at the default isolation level; the key is not used |
| a store of your own | `withLock` is documented as optional in JavaScript; without it the engine calls `fn` directly |

| # | Direction | Path | Handler | Caller | Verified by | Trusts | Writes | Repeat protection | Atomicity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | in | `recordEarning` (commission accrues) | src/engine.js:104 and :123, php/src/ReferralEngine.php:146 and :173 | integrating server, after it confirmed the referee's reward | nothing inside the library; arguments are type and range checked | earningId, refereeId, amount, at | accrual entries: level 1, plus one per upline when multi-level is on | entry key `accrual:<level>:<earningId>` (unique), plus a duplicate check first | lock `earning:<id>`, then `referrer:<id>`; `appendEntries` is all or nothing |
| 2 | in (reversal) | `reverseEarning` (clawback) | src/engine.js:183, php/src/ReferralEngine.php:258 | integrating server | as above | earningId, reversalId, the reversed part, at. The clawed amount is computed from the stored accrual | clawback entries for every level of that earning | entry key per reversal ID; the cumulative share can never exceed the accrued commission | lock `earning:<id>` |
| 3 | out | `recordPayout` | src/engine.js:228, php/src/ReferralEngine.php:320 | integrating server, when it pays a referrer | as above | payoutId, referrerId, amount, at | one payout entry (negative amount) | entry key `payout:<id>` | lock `referrer:<id>`: duplicate check, balance check, append |
| 4 | moves | `recordAdjustment` (manual correction, either sign) | src/engine.js:239, php/src/ReferralEngine.php:335 | integrating server, for staff | as above | adjustmentId, referrerId, amount, at | one adjustment entry | entry key `adjustment:<id>` | lock `referrer:<id>`, no balance check |
| 5 | rule | `attach` (who earns from whom) | src/engine.js:77, php/src/ReferralEngine.php:105 | integrating server at sign-up or when a code is typed | as above | refereeId, referrerId, at | one referral per referee | primary key on referee; a different referrer throws `already_referred` | lock `referee:<id>`; self-referral and upstream cycle checks |
| 6 | rule | `attribute` (pick the referrer, guard checks) | src/attribution.js:78, php/src/Attribution.php | integrating server | pure function | touches, device IDs, IPs and payout destinations the caller collected | nothing | not applicable | not applicable |
| 7 | rule | commission plan: rate, tiers, flat amount, minimum earning, duration, caps | src/plan.js:18 and :66, php/src/Plan.php | server configuration | validated by `definePlan` | nothing from end users | nothing | not applicable | not applicable |
| 8 | rule | `holdSeconds`, `allowNegativeBalance`, `availableBalance`, `multiLevel` | src/engine.js:52, php/src/ReferralEngine.php:19 | server configuration | validated in the constructor | nothing from end users | nothing | not applicable | not applicable |
| 9 | read | `balance(referrerId, at)` | src/engine.js:258, php/src/ReferralEngine.php:366 | integrating server | none | at: only entries dated up to `at` are counted | nothing | not applicable | one read |

Who can reach these: only the integrator's server code. An end user influences them through what the integration lets through: how often and how close together payouts can be requested (row 3), which timestamps the integration passes as `at` (rows 1 to 3 and 9), and which accounts sign up with which codes (rows 5 and 6).
