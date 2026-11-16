# Coinbarn economy service

Coinbarn is a rewards app. Users complete offers and surveys from offer networks; the networks pay Coinbarn in dollars, and Coinbarn credits the user a share of that payout in coins. Users also get a sign-up bonus, a daily check-in bonus and a referral commission (a percentage of what the people they invited earn). Coins are cashed out as gift cards through Giftly.

This service holds the numbers behind the coins and serves them to the apps:

| Route | What it returns |
| --- | --- |
| `GET /api/economy` | `{coins_per_dollar, user_share_pct, signup_bonus_coins, daily_bonus_coins, referral_commission_pct, payout_minimum_coins, hold_days}` |
| `GET /api/reward-preview?payout_usd=0.37` | `{coins}`: what a user is credited for an offer that pays us that much |
| `GET /` | The cash-out page |

The numbers live in `config/settings.mjs`. `data/owner-notes.md` has what we measured and what the owner decided.

Run it with `PORT=3000 node server.mjs`. Node 22 or newer, no packages.
