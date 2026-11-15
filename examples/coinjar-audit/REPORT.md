# Money audit: Coinjar

Date: 2026-11-13

**24 findings:** 11 critical, 6 high, 6 medium, 1 low.

**How the app was run.** Started with `PORT=8742 node server.mjs` from the project folder on Node 22.23.4, default configuration: in-memory SQLite (DB_PATH unset) and no secret variables set, so the server ran on the test fallback values in config.mjs. Nothing was sent anywhere but 127.0.0.1:8742; the three providers are the in-process stand-ins in lib/providers.mjs. Test accounts (u1@audit.test to u20@audit.test) were made through POST /api/signup and funded, where a starting balance was needed, with a correctly hashed test postback. In the commands below: $P is `node <skill folder>/scripts/probe.mjs`, $R is money-audit/evidence/requests (request templates and the two signing helpers), $TOKEN is the session token returned by signup, $ID the user id from GET /api/me, $ORDER the order_id returned by POST /api/checkout. PAYLANE_TEST_SECRET and OFFERLY_TEST_KEY are the test values the local server runs with, read at run time with `node -e "import('./config.mjs').then(m=>console.log(m.defaults.webhookSecret))"` (postbackKey for the second). Signed request files were generated per run and are not kept, because order and user ids change on every start. 101 probe commands were run in total (88 send, 7 replay, 6 race), one at a time; saved outputs are in money-audit/evidence/. The server was stopped afterwards and the session tokens were deleted.

## Summary

| ID | Severity | Class | Finding | Where | Proof |
| --- | --- | --- | --- | --- | --- |
| MA-01 | critical | Unverified inbound events | A Paylane webhook sent without a signature header is accepted and credits the order | `routes/webhooks.mjs:8` | probe |
| MA-02 | critical | Unverified inbound events | Adding debug=1 to the Offerly postback URL skips the hash check and credits any reward | `routes/postback.mjs:17` | probe |
| MA-07 | critical | Races on a balance | Parallel purchases all succeed and the balance is charged for one | `routes/wallet.mjs:18` | probe |
| MA-08 | critical | Races on a balance | Parallel payout requests each send a gift card against the same balance | `routes/payouts.mjs:16` | probe |
| MA-09 | critical | Amounts trusted from the client | Checkout stores the number of coins sent by the client and the webhook credits that number | `routes/checkout.mjs:16` | probe |
| MA-10 | critical | Money arithmetic | A transfer with a negative amount pulls coins from the recipient to the sender | `routes/wallet.mjs:36` | probe |
| MA-13 | critical | Refunds and reversals | Refund and dispute events from Paylane are acknowledged and the coins stay | `routes/webhooks.mjs:17` | probe |
| MA-15 | critical | Promo, trial and referral abuse | One account can redeem the same promo code any number of times | `routes/promo.mjs:13` | probe |
| MA-16 | critical | Promo, trial and referral abuse | The referrer is paid 500 coins for every sign-up made with their code, with no check on the new account | `routes/auth.mjs:30` | probe |
| MA-20 | critical | Secrets and access on the money path | The admin key that grants coins is in a script served to every visitor | `public/admin.js:1` | probe |
| MA-21 | critical | Secrets and access on the money path | A transfer takes the paying account from the request body, so any user can move another user's coins | `routes/wallet.mjs:34` | probe |
| MA-05 | high | Duplicate credit | The same payment.succeeded event credits the order again every time it is delivered | `routes/webhooks.mjs:20` | probe |
| MA-06 | high | Duplicate credit | Overlapping deliveries of one Offerly postback each credit the reward | `routes/postback.mjs:37` | probe |
| MA-11 | high | Money arithmetic | A payout of half a coin is rounded up to a one-cent gift card | `routes/payouts.mjs:15` | probe |
| MA-14 | high | Refunds and reversals | An Offerly reversal subtracts whatever the message says, every time it arrives | `routes/postback.mjs:27` | probe |
| MA-17 | high | Payout controls | Coins can be withdrawn the moment they are credited, including bonus coins and reversible offer rewards | `routes/payouts.mjs:14` | probe |
| MA-23 | high | Ledger and audit trail | Most balance changes leave no record, so a balance cannot be explained or rebuilt | `db.mjs:8` | trace |
| MA-03 | medium | Unverified inbound events | A signed Paylane event is accepted however old its timestamp is | `lib/paylane.mjs:6` | probe |
| MA-12 | medium | Money arithmetic | Balances and amounts are stored as floating point and drift from their true value | `db.mjs:8` | probe |
| MA-18 | medium | Payout controls | Payouts have no minimum, no maximum and no daily cap | `routes/payouts.mjs:12` | probe |
| MA-19 | medium | Payout controls | The gift card is sent before any payout record exists and without an idempotency key | `routes/payouts.mjs:18` | trace |
| MA-22 | medium | Secrets and access on the money path | The webhook secret, postback key and admin key fall back to values committed in the code | `config.mjs:4` | probe |
| MA-24 | medium | Ledger and audit trail | Admin grants change a balance without recording who did it, when, how much or why | `routes/admin.mjs:9` | trace |
| MA-04 | low | Unverified inbound events | The postback hash is compared with !== instead of a constant-time comparison | `routes/postback.mjs:21` | trace |

## Findings

### MA-01: A Paylane webhook sent without a signature header is accepted and credits the order

- **Severity:** critical
- **Class:** Unverified inbound events
- **Where:** `routes/webhooks.mjs:8`

```
if (signature && !verifyPaylaneSignature(ctx.raw, signature, config.webhookSecret)) {
```

**Impact.** Anyone on the internet who has signed up (sign-up is open) can create an order with POST /api/checkout, then tell the server it was paid, without paying. Every such request adds the order's coins to their balance: 500 coins (5 USD in gift cards) per call for the small pack, repeatable without limit, and unlimited coins per call when combined with MA-09.

**Proof.** Demonstrated with a live request.

```
ORDER=$($P send $R/checkout.json --var TOKEN=$TOKEN --extract order_id); node $R/sign-webhook.mjs evt_1 payment.succeeded $ORDER > webhook.json; $P send webhook.json --set-body id=evt_tampered --var TOKEN=$TOKEN --observe $R/me.json; $P send webhook.json --drop-header paylane-signature --var TOKEN=$TOKEN --observe $R/me.json
```

With a changed body and the old signature the server answered 400 bad_signature and the balance stayed 0, so the check works when the header is present. With the header dropped it answered 200 and the balance rose from 0 to 500 for an order nobody paid. A second send with an empty header value did the same (500 to 1000).

**Fix.** Make verification unconditional: `if (!signature || !verifyPaylaneSignature(...)) return ctx.send(400, ...)`, before parsing the body or touching the database.

### MA-02: Adding debug=1 to the Offerly postback URL skips the hash check and credits any reward

- **Severity:** critical
- **Class:** Unverified inbound events
- **Where:** `routes/postback.mjs:17`

```
if (q.get('debug') !== '1') {
```

**Impact.** Anyone on the internet can credit any account with any number of coins by calling one URL; no account, key or hash is needed. Coins are paid out as gift cards at 100 per USD, so one request for 100000 coins is 1000 USD. With status=2 the same switch lets anyone subtract coins from any user's balance (see MA-14).

**Proof.** Demonstrated with a live request.

```
$P send $R/postback-unsigned.json --var USER_ID=$ID --var TOKEN=$TOKEN --observe $R/me.json; $P send $R/postback-unsigned.json --set-query debug=1 --var USER_ID=$ID --var TOKEN=$TOKEN --observe $R/me.json
```

Without a hash the server answered 403 BAD HASH and the balance stayed 0. The same URL with debug=1 and still no hash answered 200 OK and the balance rose from 0 to 100000.

**Fix.** Delete the debug branch so the hash is always checked. If a test switch is needed, drive it from a server-side environment flag that production never sets, never from the request.

### MA-07: Parallel purchases all succeed and the balance is charged for one

- **Severity:** critical
- **Class:** Races on a balance
- **Where:** `routes/wallet.mjs:18`

```
db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(user.balance - price, ctx.user.id);
```

**Impact.** Any signed-in user can send the same purchase several times at once and receive every item while paying for one. Each request reads the balance, waits for the entitlement service, then writes back the value computed from its own stale read.

**Proof.** Demonstrated with a live request.

```
$P race $R/spend.json --parallel 10 --var TOKEN=$TOKEN --observe $R/me.json
```

With a balance of 300 coins, ten parallel purchases of the 300-coin theme were all answered 200 with the item granted. The balance fell from 300 to 0: ten items delivered, one paid for, 2700 coins of goods given away in one call.

**Fix.** Take the coins first with one conditional statement, `UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?`, grant the item only when `changes === 1`, and return the coins if the grant fails.

### MA-08: Parallel payout requests each send a gift card against the same balance

- **Severity:** critical
- **Class:** Races on a balance
- **Where:** `routes/payouts.mjs:16`

```
const card = await app.giftcards.send({ userId: ctx.user.id, usd });
```

**Impact.** Any signed-in user with a balance can withdraw it several times over by sending the payout request in parallel. The balance is checked, the gift card is sent, and only then are the coins deducted, so every request that arrives before the first deduction is paid. Real money leaves the business and the account is simply left negative.

**Proof.** Demonstrated with a live request.

```
$P race $R/payout.json --parallel 5 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json
```

With a balance of 500 coins (5 USD), five parallel payouts of 500 were all answered 200, each with its own gift card code for 5 USD. Five payouts were recorded (0 to 5), 25 USD paid for 5 USD of balance, and the balance ended at -2000.

**Fix.** Reserve before paying: in one statement `UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?`, create the payout as pending only when a row changed, then call the gift card provider and return the coins once on a definite failure.

### MA-09: Checkout stores the number of coins sent by the client and the webhook credits that number

- **Severity:** critical
- **Class:** Amounts trusted from the client
- **Where:** `routes/checkout.mjs:16`

```
coins: ctx.body.coins ?? pack.coins,
```

**Impact.** Any signed-in user can add a `coins` field to the checkout request and receive that many coins for the price of the smallest pack: 1000000 coins, worth 10000 USD in gift cards, for one genuine 4.99 USD payment. With MA-01 not even that payment is needed.

**Proof.** Demonstrated with a live request.

```
$P send $R/checkout.json --set-body coins=1000000 --var TOKEN=$TOKEN; node $R/sign-webhook.mjs evt_4 payment.succeeded $ORDER > webhook.json; $P send webhook.json --var TOKEN=$TOKEN --observe $R/me.json
```

Checkout answered 201 with coins 1000000 and price_cents 499. After one correctly signed payment.succeeded event for that order the balance rose from 0 to 1000000 instead of 500.

**Fix.** Ignore the request's coin count: `coins: pack.coins`. The client sends only the pack name; the server owns both price and grant.

### MA-10: A transfer with a negative amount pulls coins from the recipient to the sender

- **Severity:** critical
- **Class:** Money arithmetic
- **Where:** `routes/wallet.mjs:36`

```
if (!Number.isFinite(coins)) return ctx.send(400, { error: 'invalid_amount' });
```

**Impact.** Any signed-in user can create coins from nothing: transferring -400 to a second account they registered leaves the first with +400 and the second with -400, and the first can be paid out. The same request takes coins from any real user whose email is known. Any amount, repeatable without limit.

**Proof.** Demonstrated with a live request.

```
$P send $R/transfer.json --set-body amount=-400 --var TO=$OTHER_EMAIL --var TOKEN=$TOKEN --var VICTIM_TOKEN=$OTHER_TOKEN --observe $R/me.json --observe $R/me-victim.json
```

Both accounts started at 0. The request was answered 200 {"sent":-400}; the sender's balance went from 0 to 400 and the recipient's from 0 to -400. The balance check on line 40 passes because 0 < -400 is false.

**Fix.** Accept only a positive whole number of coins: reject unless `Number.isInteger(coins) && coins > 0`, and move the coins with a conditional `UPDATE ... WHERE balance >= ?` inside one transaction.

### MA-13: Refund and dispute events from Paylane are acknowledged and the coins stay

- **Severity:** critical
- **Class:** Refunds and reversals
- **Where:** `routes/webhooks.mjs:17`

```
if (event.type === 'payment.succeeded') {
```

**Impact.** Any buyer can pay for a pack, withdraw the coins as a gift card at once, then get the payment refunded or charge it back and keep the gift card. The loop can be repeated with every purchase: the business loses the pack price plus any dispute fee each time.

**Proof.** Demonstrated with a live request.

```
$P send paid.json --var TOKEN=$TOKEN --observe $R/me.json; $P send refunded.json --var TOKEN=$TOKEN --observe $R/me.json; $P send dispute.json --var TOKEN=$TOKEN --observe $R/me.json; $P send $R/payout.json --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json   # the three event files come from sign-webhook.mjs with types payment.succeeded, payment.refunded, dispute.created for one $ORDER
```

The signed payment.succeeded event raised the balance from 0 to 500. Signed payment.refunded and dispute.created events for the same order were each answered 200 {"received":true} and the balance stayed at 500. A payout of the 500 coins was then paid as a 5 USD gift card. The handler has one branch, for payment.succeeded; every other type falls through to the 200 on line 23.

**Fix.** Handle Paylane's reversing events: look up the order, move it from paid to refunded exactly once (conditional UPDATE), subtract the coins that order granted, let the balance go negative and block spending and payouts while it is below zero.

### MA-15: One account can redeem the same promo code any number of times

- **Severity:** critical
- **Class:** Promo, trial and referral abuse
- **Where:** `routes/promo.mjs:13`

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(promo.coins, ctx.user.id);
```

**Impact.** Any signed-in user can repeat the redemption request and collect 100 coins (WELCOME100) or 250 coins (SPRING250) each time, then withdraw them as gift cards (MA-17). A script turns one account into unlimited payouts; 1000 calls with SPRING250 are 2500 USD.

**Proof.** Demonstrated with a live request.

```
$P replay $R/promo.json --times 15 --var TOKEN=$TOKEN --observe $R/me.json; $P replay $R/payout.json --times 10 --set-body amount=150 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json
```

Fifteen redemptions of WELCOME100 by one new account were all answered 200 and the balance rose from 0 to 1500. The whole 1500 was then withdrawn at once as ten 1.50 USD gift cards (15 USD).

**Fix.** Add a redemptions table with a unique key on (code, user_id); in one transaction insert the redemption and credit only when the insert succeeded. Add a total cap per code if the budget is limited.

### MA-16: The referrer is paid 500 coins for every sign-up made with their code, with no check on the new account

- **Severity:** critical
- **Class:** Promo, trial and referral abuse
- **Where:** `routes/auth.mjs:30`

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(config.referralBonus, referrer.id);
```

**Impact.** Anyone can register accounts with made-up email addresses (nothing is verified, nothing limits sign-ups) and earn 500 coins, 5 USD in gift cards, for each. A script that creates 1000 accounts withdraws 5000 USD.

**Proof.** Demonstrated with a live request.

```
REF=$($P send '{"url":"http://127.0.0.1:8742/api/me","headers":{"authorization":"Bearer {{TOKEN}}"}}' --var TOKEN=$TOKEN --extract ref_code); $P send $R/signup-ref.json --var EMAIL=friend1@audit.test --var PW=$PW --var REF=$REF --var TOKEN=$TOKEN --observe $R/me.json   # three times with new addresses, then: $P send $R/payout.json --set-body amount=1500 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json
```

Three sign-ups with invented addresses and the referrer's code raised the referrer's balance from 0 to 1500 with no activity by the new accounts. The 1500 coins were paid out immediately as one 15 USD gift card. A fourth sign-up added another 500.

**Fix.** Do not pay on sign-up. Record referred_by, and pay the bonus once per invited user (unique key) only after that user completes a verified paid order or offer, taking it back if that event is reversed.

### MA-20: The admin key that grants coins is in a script served to every visitor

- **Severity:** critical
- **Class:** Secrets and access on the money path
- **Where:** `public/admin.js:1`

```
const ADMIN_KEY =
```

**Impact.** Anyone on the internet can download /public/admin.js, read the key and call POST /admin/grant to add any number of coins to any account, then withdraw them as gift cards. No sign-in is needed for the grant itself. The key in the script equals the fallback in config.mjs:6, and the support page only works when the two match, so changing the environment variable alone does not close this.

**Proof.** Demonstrated with a live request.

```
ADMIN_KEY=$(curl -s http://127.0.0.1:8742/public/admin.js | sed -n "s/^const ADMIN_KEY = '\(.*\)';$/\1/p"); $P send $R/admin-js.json --var ADMIN_KEY=$ADMIN_KEY; $P send $R/grant.json --var ADMIN_KEY=$ADMIN_KEY --var USER_ID=$ID --var TOKEN=$TOKEN --observe $R/me.json
```

GET /public/admin.js answered 200 to a request with no credentials and its first line holds the key. POST /admin/grant with a wrong key answered 403; with the key taken from that file it answered 200 {"granted":100000} and the target balance rose from 0 to 100000.

**Fix.** Remove the key from public/admin.js and rotate it. Put the support tool behind a staff login checked on the server (a session with an admin role), and have /admin/grant authorise that session instead of a shared header.

### MA-21: A transfer takes the paying account from the request body, so any user can move another user's coins

- **Severity:** critical
- **Class:** Secrets and access on the money path
- **Where:** `routes/wallet.mjs:34`

```
const from = ctx.body?.from ?? ctx.user.id;
```

**Impact.** Any signed-in user can send themselves the whole balance of any other account by putting that account's id in `from`. User ids are small sequential numbers, so a script can walk through all of them and empty every wallet, then cash out.

**Proof.** Demonstrated with a live request.

```
$P send $R/transfer.json --set-body from=$VICTIM_ID --set-body amount=500 --var TO=$OWN_EMAIL --var TOKEN=$TOKEN --var VICTIM_TOKEN=$VICTIM_TOKEN --observe $R/me.json --observe $R/me-victim.json
```

The attacker (balance 0) named the victim's id as `from` and their own email as recipient. The answer was 200 {"sent":500}; the attacker's balance went from 0 to 500 and the victim's from 500 to 0.

**Fix.** Always use the session: `const from = ctx.user.id;` and ignore any `from` field in the body.

### MA-05: The same payment.succeeded event credits the order again every time it is delivered

- **Severity:** high
- **Class:** Duplicate credit
- **Where:** `routes/webhooks.mjs:20`

```
db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
```

**Impact.** Every retry by Paylane (a timeout, a slow answer) gives the buyer the pack again for free, with no attacker involved. Anyone who holds one genuine signed event can replay it at will (MA-03 keeps it valid forever), and because of MA-01 anyone at all can repeat an unsigned one.

**Proof.** Demonstrated with a live request.

```
ORDER=$($P send $R/checkout.json --var TOKEN=$TOKEN --extract order_id); node $R/sign-webhook.mjs evt_2 payment.succeeded $ORDER > webhook.json; $P replay webhook.json --times 3 --var TOKEN=$TOKEN --observe $R/me.json
```

One correctly signed event for one 500-coin order was delivered three times. All three were answered 200 and the balance rose from 0 to 1500 instead of 500.

**Fix.** Make the transition conditional and credit only when it happened: `UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`, then add the coins only if `changes === 1`, both inside one transaction. Also store the event id under a unique key.

### MA-06: Overlapping deliveries of one Offerly postback each credit the reward

- **Severity:** high
- **Class:** Duplicate credit
- **Where:** `routes/postback.mjs:37`

```
const seen = db.prepare('SELECT id FROM transactions WHERE tx_id = ? AND status = 1').get(tx);
```

**Impact.** When Offerly delivers the same conversion more than once at nearly the same moment (retries, parallel senders), the user is credited once per delivery and the business pays for conversions the advertiser pays for once. A user cannot trigger it alone with a valid hash, but with MA-02 anyone can.

**Proof.** Demonstrated with a live request.

```
node $R/sign-postback.mjs $ID tx-race-1 200 1 > postback.json; $P race postback.json --parallel 10 --var TOKEN=$TOKEN --observe $R/me.json; $P replay postback.json --times 2 --var TOKEN=$TOKEN --observe $R/me.json
```

Ten parallel deliveries of one correctly hashed postback worth 200 coins were all answered 200 OK and the balance rose from 0 to 2000. Sent again in sequence afterwards the answer was DUPLICATE with no change, so the check only fails when deliveries overlap: the handler awaits the notifier (line 39) between the SELECT and the INSERT, and db.mjs has no unique index on transactions.tx_id.

**Fix.** Add a unique index on transactions (tx_id, status) and, in one transaction, insert the row first with ON CONFLICT DO NOTHING and credit only when a row was inserted. Notify after the commit.

### MA-11: A payout of half a coin is rounded up to a one-cent gift card

- **Severity:** high
- **Class:** Money arithmetic
- **Where:** `routes/payouts.mjs:15`

```
const usd = Number((coins / config.coinsPerDollar).toFixed(2));
```

**Impact.** Any signed-in user with a balance can double its cash value by withdrawing it in 0.5-coin pieces: each piece is worth 0.005 USD and pays 0.01 USD. A 10000-coin balance (100 USD) becomes 200 USD of gift cards. Needs an existing balance and many requests, which nothing limits (MA-18).

**Proof.** Demonstrated with a live request.

```
$P replay $R/payout.json --times 20 --set-body amount=0.5 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json
```

Twenty payouts of 0.5 coins were all answered 200 with usd 0.01. The balance fell by 10 coins (worth 0.10 USD, from 100 to 90) while 20 gift cards worth 0.20 USD in total were issued.

**Fix.** Accept whole coins only and round payouts down: compute cents as `Math.floor(coins * 100 / coinsPerDollar)`, reject when it is 0, and deduct exactly the coins those cents represent.

### MA-14: An Offerly reversal subtracts whatever the message says, every time it arrives

- **Severity:** high
- **Class:** Refunds and reversals
- **Where:** `routes/postback.mjs:27`

```
db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(reward, userId);
```

**Impact.** A reversal that Offerly delivers twice takes the coins twice, and a reversal for a conversion that was never credited still takes them, so honest users lose balance they earned and support has to repair it by hand. With MA-02 anyone on the internet can empty or push negative any user's balance by id.

**Proof.** Demonstrated with a live request.

```
node $R/sign-postback.mjs $ID tx-rev-1 200 1 > credit.json; node $R/sign-postback.mjs $ID tx-rev-1 200 2 > reversal.json; node $R/sign-postback.mjs $ID tx-never-credited 300 2 > unknown.json; $P send credit.json --var TOKEN=$TOKEN --observe $R/me.json; $P replay reversal.json --times 3 --var TOKEN=$TOKEN --observe $R/me.json; $P send unknown.json --var TOKEN=$TOKEN --observe $R/me.json
```

After one 200-coin credit (0 to 200), the correctly hashed reversal for that transaction delivered three times took 600 coins (200 to -400) instead of 200. A reversal for a transaction id that was never credited took another 300 (-400 to -700). All answers were 200 OK.

**Fix.** Tie the reversal to the credit: find the status 1 row for that tx_id, subtract the reward and user stored in that row, and record the reversal under a unique (tx_id, status) key in the same transaction so a second delivery or an unknown tx does nothing.

### MA-17: Coins can be withdrawn the moment they are credited, including bonus coins and reversible offer rewards

- **Severity:** high
- **Class:** Payout controls
- **Where:** `routes/payouts.mjs:14`

```
if (user.balance < coins) return ctx.send(402, { error: 'insufficient_balance' });
```

**Impact.** The only condition for a payout is a sufficient balance. Offer rewards are withdrawn before the advertiser can take the conversion back, leaving a negative balance on an abandoned account, and promo and referral coins leave as cash through the same door. This turns every crediting flaw in this report (MA-01, 02, 09, 10, 15, 16, 20, 21) into money gone within seconds.

**Proof.** Demonstrated with a live request.

```
node $R/sign-postback.mjs $ID tx-hold-1 1000 1 > credit.json; node $R/sign-postback.mjs $ID tx-hold-1 1000 2 > reversal.json; $P send credit.json --var TOKEN=$TOKEN --observe $R/me.json; $P send $R/payout.json --set-body amount=1000 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json; $P send reversal.json --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json
```

A new account was credited 1000 coins by a hashed offer postback and withdrew all of it in the next request as a 10 USD gift card (balance 1000 to 0, payouts 0 to 1). The advertiser's reversal then put the balance at -1000; the gift card was already issued. The promo and referral runs (MA-15, MA-16) show bonus coins leaving the same way.

**Fix.** Track earned coins with a maturity date and allow payout only of matured, earned value: hold offer rewards for the network's reversal window, and make promo and referral coins spendable but not withdrawable.

### MA-23: Most balance changes leave no record, so a balance cannot be explained or rebuilt

- **Severity:** high
- **Class:** Ledger and audit trail
- **Where:** `db.mjs:8`

```
balance REAL NOT NULL DEFAULT 0,
```

**Impact.** The balance is one number that code overwrites. Promo, referral, admin, transfer and purchase credits write nothing else, so after any of the abuses in this report the business cannot tell which coins were real, how much was lost, or what to take back, while those coins are being paid out as gift cards.

**Proof.** Traced in code, not run.

1. `db.mjs:8` The only store of a user's coins is this column. The schema (db.mjs lines 4 to 48) has no ledger or entries table; orders, transactions, purchases and payouts each cover one path.

```
balance REAL NOT NULL DEFAULT 0,
```

2. `routes/promo.mjs:13` A promo credit changes the balance and writes no row: which code, when and how often is not stored anywhere.

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(promo.coins, ctx.user.id);
```

3. `routes/auth.mjs:30` A referral bonus is added with no entry. Only users.referred_by hints at it, and it does not say whether or when a bonus was paid.

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(config.referralBonus, referrer.id);
```

4. `routes/wallet.mjs:41` A transfer changes two balances (lines 41 and 42) and stores nothing about sender, recipient or amount.

```
db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(coins, sender.id);
```

5. `routes/webhooks.mjs:21` A purchase credit stores neither the Paylane event id nor a time; orders.status only says paid, so a second credit (MA-05) or a refund has nothing to refer to.

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(order.coins, order.user_id);
```

6. `routes/postback.mjs:46` Where a record does exist (transactions, line 40; purchases; payouts) it is written in a separate statement from the balance change with no transaction, so record and balance can disagree after a crash or a race.

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(reward, userId);
```

**Fix.** Add an append-only ledger (user, signed amount, kind, reference, actor, time) with a unique key on (kind, reference), and change balances only in the same transaction that inserts the ledger row; add a scheduled check that each balance equals the sum of its entries.

### MA-03: A signed Paylane event is accepted however old its timestamp is

- **Severity:** medium
- **Class:** Unverified inbound events
- **Where:** `lib/paylane.mjs:6`

```
if (!parts.t || !parts.v1) return false;
```

**Impact.** A genuine signed event that was captured once (from a log, a proxy, a support ticket) stays valid forever. On its own this needs access to one real event; together with MA-05 it means that event can be replayed for another full credit at any later date, not only inside a retry window.

**Proof.** Demonstrated with a live request.

```
node $R/sign-webhook.mjs evt_3 payment.succeeded $ORDER 1000000000 > webhook-stale.json; $P send webhook-stale.json --var TOKEN=$TOKEN --observe $R/me.json
```

An event signed with t=1000000000 (September 2001, 25 years old) was answered 200 and the balance rose from 0 to 500.

**Fix.** In verifyPaylaneSignature reject the event unless t is a number within five minutes of the server clock, before comparing the HMAC.

### MA-12: Balances and amounts are stored as floating point and drift from their true value

- **Severity:** medium
- **Class:** Money arithmetic
- **Where:** `db.mjs:8`

```
balance REAL NOT NULL DEFAULT 0,
```

**Impact.** Balances pick up binary rounding errors, so sums of entries will not equal the stored balance and equality or threshold checks can go either way by a fraction. No direct loss was shown beyond MA-11, but it makes reconciliation impossible to do exactly and lets fractional coins exist at all (which MA-11 needs).

**Proof.** Demonstrated with a live request.

```
$P replay $R/transfer.json --times 3 --set-body amount=0.1 --var TO=$OTHER_EMAIL --var TOKEN=$TOKEN --var VICTIM_TOKEN=$OTHER_TOKEN --observe $R/me-victim.json
```

Three transfers of 0.1 coins into an empty account left it with 0.30000000000000004 coins, and the sender showed 899.6999999999999. orders.coins, transactions.reward, purchases.price, payouts.coins and payouts.usd are REAL as well (db.mjs lines 21, 29, 37, 43, 44).

**Fix.** Store coins as INTEGER (and USD as integer cents) in every table, and reject non-integer amounts at every endpoint that reads one from a request.

### MA-18: Payouts have no minimum, no maximum and no daily cap

- **Severity:** medium
- **Class:** Payout controls
- **Where:** `routes/payouts.mjs:12`

```
if (!(coins > 0)) return ctx.send(400, { error: 'invalid_amount' });
```

**Impact.** Any signed-in user can request any number of payouts of any size, from a fraction of a coin to the whole balance, as fast as requests can be sent. Nothing caps what one mistake or one abused account can take in a day, and each tiny payout costs a provider call (and feeds MA-11).

**Proof.** Demonstrated with a live request.

```
$P replay $R/payout.json --times 10 --set-body amount=150 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json; $P replay $R/payout.json --times 20 --set-body amount=0.5 --var TOKEN=$TOKEN --observe $R/me.json --observe $R/payouts-count.json
```

A minutes-old account made ten payouts of 1.50 USD in 244 ms, emptying its balance (1500 to 0, payouts 0 to 10), and another made twenty payouts of 0.5 coins (0.01 USD each) in under half a second. All 30 requests were answered 200.

**Fix.** Enforce, in the same transaction that reserves the funds, a minimum payout (for example 500 coins), a maximum per request, a cap per account per day, and a lower cap for new accounts; send larger amounts to manual approval.

### MA-19: The gift card is sent before any payout record exists and without an idempotency key

- **Severity:** medium
- **Class:** Payout controls
- **Where:** `routes/payouts.mjs:18`

```
db.prepare('INSERT INTO payouts (user_id, coins, usd, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
```

**Impact.** If the process stops or a statement fails after the provider call, the user holds a gift card while the balance is untouched and no row says a payout happened, so they can withdraw again and nobody can see why. A retried request creates a second card because the provider gets nothing that identifies the payout. Loss needs a crash, timeout or retry at the wrong moment.

**Proof.** Traced in code, not run.

1. `routes/payouts.mjs:16` The money leaves first. The provider is given a user id and an amount only: no payout id, no idempotency key. lib/providers.mjs:26 shows the call takes nothing else.

```
const card = await app.giftcards.send({ userId: ctx.user.id, usd });
```

2. `routes/payouts.mjs:17` The balance is reduced only after the card exists, in its own statement with no transaction. A crash between line 16 and here leaves the card paid and the coins in place.

```
db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(coins, ctx.user.id);
```

3. `routes/payouts.mjs:18` The payout row is written last and directly with status 'paid' (line 22). There is no pending state to resume or reconcile from, and no code path that returns coins when the provider call fails after a deduction. No other file writes to payouts.

```
db.prepare('INSERT INTO payouts (user_id, coins, usd, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
```

**Fix.** Make the payout a small state machine: reserve coins and insert the row as pending in one transaction, call the provider with the payout id as idempotency key, then mark it paid, or failed with one refund of the coins; leave timeouts pending and resolve them by asking the provider.

### MA-22: The webhook secret, postback key and admin key fall back to values committed in the code

- **Severity:** medium
- **Class:** Secrets and access on the money path
- **Where:** `config.mjs:4`

```
webhookSecret: process.env.PAYLANE_WEBHOOK_SECRET ||
```

**Impact.** If any of the three variables is missing in production (a new server, a typo in the name, a lost env file) the app starts normally and accepts events signed with a value anyone with the source code knows. That person can then forge paid orders, offer rewards and admin grants with valid signatures. No loss while production sets all three; lines 5 and 6 have the same shape.

**Proof.** Demonstrated with a live request.

```
PORT=8742 node server.mjs   # no secret variables set; then: PAYLANE_TEST_SECRET=<fallback read from config.mjs> node $R/sign-webhook.mjs evt_5 payment.succeeded $ORDER > paid.json; $P send paid.json --var TOKEN=$TOKEN --observe $R/me.json
```

The server started without PAYLANE_WEBHOOK_SECRET, OFFERLY_POSTBACK_KEY or ADMIN_KEY and printed no warning. An event signed with the fallback from config.mjs was answered 200 and raised the balance from 0 to 500; postbacks hashed with the fallback key and the admin grant of MA-20 were accepted in the same run.

**Fix.** Remove the three `|| '...'` fallbacks and refuse to start when a variable is missing or empty; keep test values in a test-only env file.

### MA-24: Admin grants change a balance without recording who did it, when, how much or why

- **Severity:** medium
- **Class:** Ledger and audit trail
- **Where:** `routes/admin.mjs:9`

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(coins, userId);
```

**Impact.** Staff, or anyone holding the shared key (see MA-20), can add or remove any number of coins on any account and nothing remembers it. A wrong or dishonest grant cannot be found, attributed or reversed, and there is no size limit to contain one.

**Proof.** Traced in code, not run.

1. `routes/admin.mjs:5` The caller is identified only by one key shared by all staff. No staff identity reaches the handler.

```
if (ctx.req.headers['x-admin-key'] !== config.adminKey) return ctx.send(403, { error: 'forbidden' });
```

2. `routes/admin.mjs:8` Any finite amount is accepted, negative included. There is no upper limit and no reason field.

```
if (!Number.isFinite(coins)) return ctx.send(400, { error: 'invalid_amount' });
```

3. `routes/admin.mjs:9` The balance is changed and the handler ends on line 11. No table receives a row; db.mjs has none for adjustments.

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(coins, userId);
```

**Fix.** Write every grant to the ledger of MA-23 with the staff member's identity, the amount and a required reason, limit the size of one grant, and require a second approver above a threshold.

### MA-04: The postback hash is compared with !== instead of a constant-time comparison

- **Severity:** low
- **Class:** Unverified inbound events
- **Where:** `routes/postback.mjs:21`

```
if (q.get('hash') !== expected) return ctx.send(403, 'BAD HASH');
```

**Impact.** A caller who can time many requests precisely could learn the expected hash for a chosen postback byte by byte and then credit themselves. It is hard to do over a network and nothing is lost today; it matters once MA-02 is closed and the hash is the only guard. The Paylane check already uses timingSafeEqual (lib/paylane.mjs:9).

**Proof.** Traced in code, not run.

1. `routes/postback.mjs:18` The expected hash is built as a hex string from the query values the caller supplied.

```
const expected = createHmac('sha256', config.postbackKey)
```

2. `routes/postback.mjs:21` The caller's hash is compared with a plain string comparison, which stops at the first differing character. No rate limit exists in lib/http.mjs to slow repeated guesses.

```
if (q.get('hash') !== expected) return ctx.send(403, 'BAD HASH');
```

3. `routes/postback.mjs:46` A request that passes that comparison credits the reward named in the query to the user named in the query.

```
db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(reward, userId);
```

**Fix.** Compare with crypto.timingSafeEqual on two equal-length buffers, as lib/paylane.mjs already does, and reject a missing or wrong-length hash first.

## Coverage

| Class | Result | Files read | Note |
| --- | --- | --- | --- |
| Unverified inbound events | 4 findings | `routes/webhooks.mjs`, `routes/postback.mjs`, `lib/paylane.mjs`, `lib/http.mjs`, `config.mjs` |  |
| Duplicate credit | 2 findings | `routes/webhooks.mjs`, `routes/postback.mjs`, `db.mjs`, `routes/promo.mjs`, `routes/auth.mjs` |  |
| Races on a balance | 2 findings | `routes/wallet.mjs`, `routes/payouts.mjs`, `routes/promo.mjs`, `lib/providers.mjs`, `db.mjs` |  |
| Amounts trusted from the client | 1 findings | `routes/checkout.mjs`, `routes/wallet.mjs`, `routes/webhooks.mjs`, `routes/promo.mjs`, `config.mjs`, `public/admin.js` |  |
| Money arithmetic | 3 findings | `db.mjs`, `routes/wallet.mjs`, `routes/payouts.mjs`, `routes/postback.mjs`, `routes/admin.mjs`, `routes/checkout.mjs`, `config.mjs` |  |
| Refunds and reversals | 2 findings | `routes/webhooks.mjs`, `routes/postback.mjs`, `routes/payouts.mjs`, `db.mjs` |  |
| Promo, trial and referral abuse | 2 findings | `routes/promo.mjs`, `routes/auth.mjs`, `config.mjs`, `db.mjs`, `lib/http.mjs` |  |
| Payout controls | 3 findings | `routes/payouts.mjs`, `lib/providers.mjs`, `db.mjs`, `config.mjs` |  |
| Secrets and access on the money path | 3 findings | `config.mjs`, `public/admin.js`, `public/admin.html`, `routes/admin.mjs`, `routes/wallet.mjs`, `routes/auth.mjs`, `routes/payouts.mjs`, `lib/http.mjs`, `app.mjs`, `server.mjs` |  |
| Ledger and audit trail | 2 findings | `db.mjs`, `routes/promo.mjs`, `routes/auth.mjs`, `routes/admin.mjs`, `routes/wallet.mjs`, `routes/webhooks.mjs`, `routes/postback.mjs`, `routes/payouts.mjs` |  |

## Notes

- Not rated as a finding, proved by probe: a correctly hashed postback with a status other than 1 or 2 (status=0 was tried) is credited as a completed offer (routes/postback.mjs:26 only branches on '2'). It costs money only if Offerly ever sends another status such as pending or rejected. Credit on status '1' only and answer 200 without acting on anything else.
- Not rated as a finding, proved by probe: a correctly hashed reversal (status=2) with reward=-250 raised the balance by 250, because routes/postback.mjs:23 accepts any finite reward. It needs Offerly's key, or the debug switch of MA-02. Require reward > 0 when fixing MA-14.
- Not proved: the Paylane handler never compares a paid amount or currency with the order (routes/webhooks.mjs:18 reads only data.order_id). Whether Paylane's real event carries an amount could not be checked from this code; if it does, compare it with orders.price_cents before crediting.
- No loss found, proved by probe: POST /api/spend with item 'constructor' or '__proto__' and POST /api/checkout with pack 'constructor' pass the lookup in ITEMS / PACKS (inherited object properties) and answer 500. Spend calls entitlements.grant with the bogus item name before the balance write fails; the balance did not move. Look items up with Object.hasOwn.
- Checked and not reproduced: POST /api/transfer cannot be overdrawn by parallel requests in the current single process. Three race runs (10, 20 and 20 parallel) each let exactly one transfer through. The read, the check and both updates run synchronously on node:sqlite with no await between them. The two updates are still not in a transaction, so a second worker process on a shared database file, or a move to an asynchronous driver, would reopen it; use one conditional UPDATE when fixing MA-10 and MA-21.
- Not rated: /api/spend, /api/transfer and /api/payouts take no idempotency key, so a client that retries after a network error is charged, or paid, a second time. The cost falls on the user first and on support afterwards.
- Not rated: nothing compares the payouts table with the gift card provider's records, or orders with Paylane's settlement reports. With MA-23 fixed, add a daily reconciliation.
- The entitlement stand-in keeps deliveries in process memory and no endpoint lists them or the purchases table, so MA-07 counts the ten 200 answers, each of which is returned only after entitlements.grant has run (routes/wallet.mjs:17).
- Sub-agents were not used: the machine is short on memory and probes had to run one at a time, so the ten classes and the disproving pass were done in sequence by one agent, as the skill allows.
- Outside the money path, one line: session tokens never expire and cannot be revoked, /api/login and /api/signup have no attempt limit, and the support page public/admin.html is served to anonymous visitors.
