# Coinbarn

Coinbarn is the backend of a small rewards app. Users buy coin packs, earn coins by completing offers from the Rewardly offer network, redeem promo codes, spend coins on items, send coins to friends, and cash out as Giftly gift cards.

Node 22.13 or newer, no packages to install. Data is kept in SQLite (`node:sqlite`): in memory by default, or in the file named by `DB_PATH`.

## Run

```bash
REWARDLY_POSTBACK_KEY=rewardly_local_dev_key_1234 \
ADMIN_KEY=local_admin_key_0123456789abcdef0123 \
GIFTLY_API_URL=http://127.0.0.1:4100 GIFTLY_API_KEY=giftly_test_key \
PORT=3000 node server.mjs
```

For local work, `node tools/giftly-sandbox.mjs` runs a Giftly stand-in on port 4100 (see `docs/giftly-api.md`).

## Configuration

| Variable | What it is |
| --- | --- |
| `PORT` | HTTP port, bound to 127.0.0.1 |
| `DB_PATH` | SQLite file. Default: in memory |
| `REWARDLY_POSTBACK_KEY` | Rewardly postback key |
| `ADMIN_KEY` | Key for the support routes under `/admin`. Unset switches them off |
| `GIFTLY_API_URL`, `GIFTLY_API_KEY` | Giftly gift card API |
| `PAYOUT_HOLD_SECONDS` | How long offer earnings wait before they can be cashed out. Default 7 days |

## API

Signed-in routes take `Authorization: Bearer <token>` from sign-up or sign-in. Amounts are whole coins.

| Route | What it does |
| --- | --- |
| `POST /api/signup` `{email, password, ref?}` | Creates an account, returns `{user_id, token}` |
| `POST /api/login` `{email, password}` | Returns `{user_id, token}` |
| `GET /api/me` | `{id, email, balance, ref_code}` |
| `POST /api/checkout` `{pack}` | Creates a pending order for a coin pack (`small`, `medium`, `large`) and returns the Stripe Checkout URL. Coins are not credited yet |
| `GET /postback/rewardly` | Rewardly offer postbacks: `user_id`, `tx`, `reward`, `status` (1 credited, 2 reversed), `hash` = hex HMAC-SHA256 of `user_id:tx:reward:status` with the postback key |
| `POST /api/promo` `{code}` | Redeems a promo code |
| `POST /api/spend` `{item}` | Buys an item (`avatar`, `boost`, `theme`) |
| `POST /api/transfer` `{to, amount}` | Sends coins to another user, by email |
| `POST /api/payouts` `{amount}`, `GET /api/payouts` | Cash out offer earnings as a gift card (100 coins = $1) |
| `POST /admin/grant`, `GET /admin/reconcile`, `POST /admin/payouts/resolve` | Support tools, with `X-Admin-Key` |
