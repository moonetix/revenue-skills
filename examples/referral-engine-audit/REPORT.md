# Money audit: referral-engine

Date: 2026-11-14

**3 findings:** 0 critical, 1 high, 2 medium, 0 low.

**How the app was run.** A library without a server, so nothing was started and the probe script was not used. Proofs are failing tests in the project's own runner (node --test, Node 22.23.4) on a copy of the repository without .git, small scripts under money-audit/evidence/ for the PHP port (PHP 8.4.27 with pdo_sqlite), and one code trace for PdoStore on MySQL and PostgreSQL, because no such server may be run on this machine. Baseline before the audit: node --test, 37 passed, 0 failed; php php/tests/run.php, 550/550 passed.

## Summary

| ID | Severity | Class | Finding | Where | Proof |
| --- | --- | --- | --- | --- | --- |
| MA-03 | high | Races on a balance | On MySQL and PostgreSQL, PdoStore lets parallel payouts for one referrer both pass the balance check | `php/src/PdoStore.php:85` | trace |
| MA-01 | medium | Payout controls | A payout dated earlier than a recorded payout or clawback passes the balance check and overdraws | `src/engine.js:234` | test |
| MA-02 | medium | Races on a balance | Payouts sent at the same moment all pass the balance check when a JavaScript store has no withLock | `src/engine.js:74` | test |

## Findings

### MA-03: On MySQL and PostgreSQL, PdoStore lets parallel payouts for one referrer both pass the balance check

- **Severity:** high
- **Class:** Races on a balance
- **Where:** `php/src/PdoStore.php:85`

```
public function withLock(string $key, callable $fn): mixed
```

**Impact.** PdoStore accepts any PDO connection and its example names MySQL and PostgreSQL, but its lock is a plain transaction that never uses the key. At the default isolation levels (REPEATABLE READ in MySQL, READ COMMITTED in PostgreSQL) two PHP workers can both read the referrer's entries before either inserts. A referrer who sends two payout requests at the same moment, each with its own payout ID, has both recorded against one released balance, and an integration that pays what recordPayout accepted pays twice. On SQLite the second writer fails with 'database is locked' instead (evidence/pdo-sqlite-two-connections.txt), so SQLite is not affected. The README warns that two workers can interleave on these databases, but only for the same earning, where the unique key already protects, and the remedy it suggests (a row lock on the referral row) does not serialize payouts. Rated high on a code trace alone: no MySQL or PostgreSQL server was available to run it.

**Proof.** Traced in code, not run.

1. `php/src/ReferralEngine.php:349` recordPayout runs its duplicate check, balance check and insert inside the store lock for the referrer. This lock is the only thing that keeps two payouts for one referrer apart.

```
return $this->locked("referrer:{$referrer}", function () use ($referrer, $e, $guard): array {
```

2. `php/src/PdoStore.php:90` PdoStore::withLock ignores $key and only opens a transaction at the connection's default isolation level. There is no SELECT ... FOR UPDATE, no advisory or named lock and no isolation setting anywhere in php/src.

```
$this->pdo->beginTransaction();
```

3. `php/src/PdoStore.php:52` The balance is computed from a plain SELECT of the referrer's entries. It takes no lock, so worker B reads the same rows as worker A while A has not committed its payout yet.

```
$sql = 'SELECT ' . self::COLUMNS . ' FROM referral_ledger'
```

4. `php/src/ReferralEngine.php:328` Both workers compute the same available balance and both pass the check that follows on line 329.

```
$available = $this->balance($referrer, $at)['available'];
```

5. `php/src/PdoStore.php:77` Each worker inserts its own entry key (payout:<its own ID>), so the unique index on entry_key in schema/mysql.sql and schema/postgresql.sql has nothing to reject. Both transactions commit and the referrer's balance is negative by the second payout.

```
INSERT INTO referral_ledger (
```

**Fix.** Make PdoStore::withLock take a real lock for its key before the first read: pg_advisory_xact_lock on PostgreSQL and GET_LOCK, released after the commit, on MySQL and MariaDB. Keep SQLite as it is. Correct the README paragraph about PdoStore.

### MA-01: A payout dated earlier than a recorded payout or clawback passes the balance check and overdraws

- **Severity:** medium
- **Class:** Payout controls
- **Where:** `src/engine.js:234`

```
const { available } = await this.balance(referrer, at);
```

**Impact.** A referrer with released commission can be paid the same balance twice, or be paid commission that was already clawed back, whenever the second payout carries an earlier timestamp than the debit already in the ledger. recordPayout checks balance(referrer, at), and balance() only counts entries dated up to at, so a payout or clawback with a later at is invisible to the check. The timestamps come from the integrating server, so it needs one of: two app servers whose clocks differ across a second boundary (the referrer sends two payout requests at once), payouts stamped with the time the request was created and processed out of order or retried later, or a reversal stamped with the current time followed by a payout stamped with an older request time. The loss is real money, up to the whole released balance per extra payout. The PHP port has the same check (php/src/ReferralEngine.php:328).

**Proof.** Demonstrated with a test.

```
node --test --test-concurrency=1 test/payout-timestamps.test.js; php money-audit/evidence/ma-01-php.php
```

Both tests fail on the audited code with 'Missing expected rejection': with 500 available, payout p1 of 500 at 200 is recorded, then payout p2 of 500 at 150 is recorded too, and the balance is -500. Likewise a full reversal at 200 followed by a payout of 500 at 150 is recorded and leaves -500. The PHP script prints 'recorded, available afterwards -500' for both cases and exits 1 (evidence/ma-01-php.txt).

**Fix.** In recordPayout (both ports) check against an amount that counts every debit already in the ledger whatever its timestamp: commission released at at, minus all clawbacks of it, minus all payouts and negative adjustments, plus positive adjustments dated up to at. Leave balance(referrerId, at) as the as-of report it is documented to be.

### MA-02: Payouts sent at the same moment all pass the balance check when a JavaScript store has no withLock

- **Severity:** medium
- **Class:** Races on a balance
- **Where:** `src/engine.js:74`

```
return typeof this.#store.withLock === 'function' ? this.#store.withLock(key, fn) : fn();
```

**Impact.** The README and the type definitions call withLock optional in JavaScript, and the library ships no store for PostgreSQL or MySQL, so a store written to the documented contract can leave it out. recordPayout then reads the balance, awaits, and appends with nothing in between, and every await lets another call run: a referrer who sends several payout requests at once is paid the same released balance several times, even in a single Node process. Each payout has its own ID, so the unique ledger key does not stop it. The stores that ship with the library (MemoryStore, SqliteStore) do lock and are not affected. The same gap lets earnings recorded at once pass per-referee and per-referrer caps.

**Proof.** Demonstrated with a test.

```
node --test --test-concurrency=1 test/store-without-lock.test.js
```

The test fails on the audited code with '3 !== 1': three payouts of 500 sent with Promise.allSettled against a released balance of 500 were all recorded (the balance afterwards is -1000). The store was a MemoryStore wrapped so that only the four required methods are exposed.

**Fix.** When the store has no withLock, let the engine queue calls per key itself (the promise queue MemoryStore already uses), so that one process is always safe, and say in the README and the type definitions that several processes on one database need a store lock.

## Coverage

| Class | Result | Files read | Note |
| --- | --- | --- | --- |
| Unverified inbound events | not-applicable | none | The library receives no webhooks, postbacks or return URLs. Its callers verify those before they call recordEarning or reverseEarning, and the examples contain no network handler. |
| Duplicate credit | clear | `src/engine.js`, `src/memory-store.js`, `src/sqlite-store.js`, `php/src/ReferralEngine.php`, `php/src/PdoStore.php`, `php/src/MemoryStore.php`, `schema/sqlite.sql`, `schema/mysql.sql`, `schema/postgresql.sql`, `test/api.test.js`, `test/sqlite.test.js` | Every entry has a deterministic key (accrual:<level>:<earningId>, a clawback key per reversal ID, payout:<id>, adjustment:<id>) under a unique index, appendEntries writes all entries or none, and each method looks for the key before it writes. A repeated earning answers duplicate; on a store without a lock the second insert fails on the key and the engine answers duplicate or conflict. The project's own tests cover 10 concurrent copies on MemoryStore and 5 on SQLite. |
| Races on a balance | 2 findings | `src/engine.js`, `src/memory-store.js`, `src/sqlite-store.js`, `php/src/ReferralEngine.php`, `php/src/PdoStore.php`, `php/src/MemoryStore.php`, `README.md` | Clear for the shipped JavaScript stores and for PdoStore on SQLite: MemoryStore queues per key, SqliteStore queues every call and uses BEGIN IMMEDIATE, and two PdoStore connections on one SQLite file cannot both pay (evidence/pdo-sqlite-two-connections.txt). |
| Amounts trusted from the client | clear | `src/engine.js`, `src/plan.js`, `src/util.js`, `src/attribution.js`, `php/src/ReferralEngine.php`, `php/src/Plan.php`, `php/src/Util.php` | The library has no client-facing surface. Commission is computed from the server's plan and the stored referral, never from a caller-supplied rate or amount of commission; clawbacks are computed from the stored accrual; every ID, amount and timestamp is type and range checked (safe integers, amounts not below 0 or 1 as the method requires). |
| Money arithmetic | clear | `src/util.js`, `src/plan.js`, `src/engine.js`, `php/src/Util.php`, `php/src/Plan.php`, `php/src/ReferralEngine.php`, `test-vectors/vectors.json` | Integers only, in both languages, limited to 2^53 - 1. Commission is one exact product divided once and rounded down (mulDiv); results above the limit throw overflow. Clawbacks use the cumulative reversed share, so partial reversals cannot take more than was accrued or leave a remainder; the shared vectors check rounding with a 33.33% rate. Negative and fractional amounts are refused before any write. |
| Refunds and reversals | clear | `src/engine.js`, `php/src/ReferralEngine.php`, `test-vectors/vectors.json`, `README.md` | A reversal is tied to the stored accrual of that earning, takes the same share from every level, is keyed by a reversal ID so a second delivery answers duplicate, and stops at what is left. Commission still in its hold is cancelled; released commission goes negative or, with allowNegativeBalance false, stops at zero with the rest reported as uncollected, a stated rule. See the notes for a reversal that arrives before its earning and for partial reversals without an ID. |
| Promo, trial and referral abuse | clear | `src/attribution.js`, `src/engine.js`, `src/plan.js`, `src/fraud.js`, `src/codes.js`, `src/ip.js`, `php/src/Attribution.php`, `php/src/ReferralEngine.php` | Nothing is paid for a sign-up: commission exists only for a referee's recorded earning of at least minEarning, inside the plan's duration, under per-earning, per-referee and per-period caps, and it is clawed back with the earning. One referrer per referee (primary key), self-referral and upstream cycles are refused, and attribute() blocks shared devices and payout destinations by default. Codes are drawn from a cryptographic source. See the notes for two attach calls at the same moment. |
| Payout controls | 1 finding | `src/engine.js`, `php/src/ReferralEngine.php`, `README.md` | Clear apart from MA-01: a payout needs a unique payout ID, cannot exceed the available balance, and cannot touch commission still inside holdSeconds. Limits per day, destinations and the transfer itself belong to the integrating app, which the library does not see. |
| Secrets and access on the money path | not-applicable | none | The library holds no keys or tokens, exposes no endpoint and takes the account from its caller. Nothing in src/, php/src/ or examples/ reads a secret. |
| Ledger and audit trail | clear | `src/engine.js`, `src/memory-store.js`, `src/sqlite-store.js`, `php/src/PdoStore.php`, `schema/sqlite.sql`, `schema/mysql.sql`, `schema/postgresql.sql`, `test/sqlite.test.js` | The ledger is the balance: balance() replays append-only entries, each with type, referrer, referee, earning ID, signed amount, base amount and time under a unique key that names its source (earning, reversal, payout or adjustment ID). The reference schemas refuse UPDATE and DELETE with triggers, and the project's tests check that on SQLite. |

## Notes

- Not filed as a finding because the integrating app normally removes it one layer up: reverseEarning for an earning the ledger has not seen yet answers unknown_earning and stores nothing, so an earning recorded afterwards accrues in full (evidence/notes.txt, case 1). An app whose postback table marks the transaction as reversed and skips recordEarning for it is safe; an app that relies on the engine alone is not. The README does not mention unknown_earning; a sentence there, or an optional tombstone, would close it.
- Not filed: two attach calls at the same moment, a refers b and b refers a, both succeed on a store that locks per referee, and the pair ends up referring each other (evidence/notes.txt, case 2). It needs typed codes in the grace period and exact timing, and it pays nothing that one of the two accounts could not earn as an ordinary referee. SqliteStore queues all calls and is not affected.
- Documented pitfall, kept as is: reverseEarning uses the earning ID as the default reversalId, so a partial reversal sent without its own ID makes a later full reversal a duplicate, and the rest of the commission stays (evidence/notes.txt, case 3, 300 of 500 kept). The README tells callers to give each partial reversal its own ID.
- By design: the engine has no clock. A payout or balance call with an at beyond the hold treats held commission as released (evidence/notes.txt, case 4). Pass the server's current time, never a time that came from a client.
- Same root as MA-02: without a store lock, earnings recorded at the same moment are each measured against the caps and tiers as they were before any of them, so a per-referee cap of 100 let 300 through (evidence/notes.txt, case 5). The fix for MA-02 covers it inside one process.
- Sums of ledger amounts in balance() are not range checked. It would take totals above 2^53 - 1 in the smallest unit to matter, so this was left alone.
