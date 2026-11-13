# Answer key

Spoilers. Run your audit first.

The 17 bugs planted in [`vulnerable/`](vulnerable/), in the order of the classes the `money-audit` skill uses. Paths are relative to `vulnerable/`. The machine-readable form is [`answers.json`](answers.json); the exploits are in [`../test/playground.test.mjs`](../test/playground.test.mjs).

| ID | Class | Where | What is wrong | How `fixed/` closes it |
| --- | --- | --- | --- | --- |
| V01 | unverified-events | `routes/webhooks.mjs:8` | The signature is checked only when the header is present. A webhook with no header is accepted. | Verification is unconditional and runs before anything else. |
| V02 | unverified-events | `routes/postback.mjs:17` | `debug=1` in the query switches the hash check off. | The switch is gone. The hash is compared in constant time. |
| V03 | duplicate-credit | `routes/webhooks.mjs:17` | Nothing remembers a processed event, so a genuine signed webhook credits again on every delivery. The signature timestamp is never checked for age. | Event ids are stored under a unique key, the order moves from pending to paid once, and old timestamps are rejected. |
| V04 | duplicate-credit | `routes/postback.mjs:37` | The transaction id is checked, then a network call runs, then the row is inserted. There is no unique index, so parallel deliveries all credit. | The ledger entry is inserted under a unique (kind, ref) key in the same transaction as the credit. |
| V05 | balance-races | `routes/wallet.mjs:18` | The balance is read, the item is delivered, and the stale value minus the price is written back. Parallel purchases are all delivered for the price of one. | The coins are taken with one conditional update before delivery, and returned if delivery fails. |
| V06 | balance-races | `routes/payouts.mjs:16` | The balance is checked, the gift card is sent, and only then are the coins deducted. Parallel requests are all paid. | The coins are reserved in one transaction before the provider is called. |
| V07 | client-trust | `routes/checkout.mjs:16` | The number of coins in an order comes from the request body when present. | Coins and price come from the server's pack table, and the paid amount is compared with the order. |
| V08 | money-arithmetic | `routes/wallet.mjs:36` | A transfer amount may be negative, which moves coins from the recipient to the sender. | Amounts must be whole numbers above zero and below a maximum. |
| V09 | money-arithmetic | `routes/payouts.mjs:15`, `db.mjs:8` | Coins are floating point. Half a coin is accepted and paid out as a whole cent. | Coins are integers everywhere. Fractions are rejected. |
| V10 | refunds-and-reversals | `routes/webhooks.mjs:17` | Only `payment.succeeded` is handled. A refund is acknowledged and the coins stay. | `payment.refunded` takes back the coins the order granted, once, even if they are spent. |
| V11 | refunds-and-reversals | `routes/postback.mjs:26` | A reversal subtracts the amount in the request without looking for the credit it reverses. Delivered twice, it is charged twice. | A reversal looks up the original entry, reverses that amount for that account, once. |
| V12 | promo-and-referral-abuse | `routes/promo.mjs:13` | Nothing records a redemption, so one account can redeem the same code without limit. | One redemption per account under a unique key, and a cap per code. |
| V13 | promo-and-referral-abuse | `routes/auth.mjs:30` | The referrer is paid as soon as an account signs up with their code. | The referrer is paid once, after the invited user has earned or bought enough through verified events. |
| V14 | payout-controls | `routes/payouts.mjs:9` | No minimum, no daily cap, no hold. Coins credited a second ago can be cashed out. | A minimum, a daily cap, a hold on offer earnings, and only offer earnings are withdrawable. |
| V15 | secrets-and-access | `config.mjs:6`, `public/admin.js:1` | The admin key has a default value, and the same value is in a script served to every visitor. | The key has no default, must be long, and lives only on the server. Grants need a reason and a request id. |
| V16 | secrets-and-access | `routes/wallet.mjs:34` | A transfer takes the sending account from the request body when present. | The sender is always the signed-in user. |
| V17 | ledger-and-audit-trail | `db.mjs`, every route | Purchases, promo credits, transfers, payouts and admin grants change the balance and record nothing that explains it. | Every change is a ledger row, and `GET /admin/reconcile` proves the balances equal the sums. |

An audit can reasonably report more than these: the hash comparison in `routes/postback.mjs` is not constant-time, the secrets in `config.mjs` have working defaults, and nothing limits sign-up or redemption attempts. The scorer lists such findings separately.
