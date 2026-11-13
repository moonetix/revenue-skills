# Coinjar: a practice app with 17 money bugs

Coinjar is a small backend that sells, grants, moves and pays out virtual coins. It exists in two versions with the same features:

| Folder | What it is |
| --- | --- |
| [`vulnerable/`](vulnerable/) | The app as many first versions are written. It works, and it loses money in 17 ways. |
| [`fixed/`](fixed/) | The same app with every one of those ways closed. |

Use it to try the `money-audit` skill, to measure how well an agent audits, or to read working examples of the patterns the builder skills describe.

**Do not deploy `vulnerable/`.** It is meant to run on your own machine and binds to 127.0.0.1 only.

## What the app does

| Feature | Endpoint |
| --- | --- |
| Sign up (with an optional referral code), sign in, profile | `POST /api/signup`, `POST /api/login`, `GET /api/me` |
| Buy a coin pack | `POST /api/checkout`, then the payment provider calls `POST /webhooks/paylane` |
| Earn coins from offers | An offer network calls `GET /postback/offerly` |
| Redeem a promo code | `POST /api/promo` |
| Spend coins on an item | `POST /api/spend` |
| Send coins to another user | `POST /api/transfer` |
| Cash out as a gift card | `POST /api/payouts`, `GET /api/payouts` |
| Support tool: grant coins | `POST /admin/grant` |

Paylane (payments) and Offerly (offers) are made-up providers. Their signature schemes are described in comments in `lib/paylane.mjs` and `routes/postback.mjs`, and they follow the two most common real-world designs: a timestamped HMAC header and a hash query parameter.

## Run it

Node 22.13 or newer, no packages to install. The database is in memory and starts empty.

```bash
PORT=3000 node playground/vulnerable/server.mjs
```

```bash
PAYLANE_WEBHOOK_SECRET=whsec_test_not_secret OFFERLY_POSTBACK_KEY=test_postback_key_not_secret PORT=3000 node playground/fixed/server.mjs
```

The fixed version refuses to start without its secrets. That is one of the fixes.

## Measure an audit

1. Copy `vulnerable/` somewhere outside this repository, so the agent cannot read the answer key, the fixed version or the tests.
2. Ask your agent to run a full audit of the copy with the `money-audit` skill.
3. Score the result:

```bash
node playground/score.mjs path/to/copy/money-audit/findings.json
```

The scorer reports which of the 17 planted bugs were found, which were missed, and which findings match nothing in the key. Read that last group: an audit can find real weaknesses the key does not list.

## Proof that the key is real

[`../test/playground.test.mjs`](../test/playground.test.mjs) holds one exploit per planted bug. Each exploit must succeed against `vulnerable/` and fail against `fixed/`. The suite runs in CI on every change.

```bash
npm test
```

## Spoilers

[ANSWER-KEY.md](ANSWER-KEY.md) lists every planted bug with its location and its fix. Read it after your audit, not before.
