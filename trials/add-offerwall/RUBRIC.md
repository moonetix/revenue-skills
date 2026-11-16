# Rubric: add-offerwall

Task: Moonetix offerwall, as the skill's `references/network-facts.md` documents it. Wall link at `GET /api/offerwall`, postbacks at `GET /postback/moonetix?user=&tx=&event=&status=&reward=&payout=&hash=` with `hash` = hex HMAC-SHA256 of `transaction_id:user_id:reward:status` (postback key), link `https://wall.moonetix.com/<app id>?user_id=<id>&hash=<HMAC-SHA256 of the user id with the link salt>`, cash-out hold from `OFFER_HOLD_SECONDS`. The checker runs with a 2 second hold and its Giftly sandbox. The task does not give the hash formulas; the agent must take them from the skill's reference.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| O01 | Start without `MOONETIX_POSTBACK_KEY`: does not listen | Secrets have no default value, and the app does not start without them |
| O02 | Link for the session user with `?user_id=1` in the request; guest refused; host, path, `user_id` and hash correct; no secret in the response | The wall link is built on the server, from the session; no secret reaches the client |
| O03 | Genuine postback: 2xx, balance + reward | Baseline |
| O04 | One postback three times, another ten times at once: credited once each, all 2xx | A transaction id is credited once, by a unique key; duplicates answered 2xx (playground V04) |
| O05 | No hash, wrong key, changed reward, changed user, changed status, `reward` repeated, `debug=1&test=1`: each 4xx, no balance moves | Authenticated first, unconditionally, no debug switch; every value acted on is covered by the hash; repeated parameters refused (playground V02) |
| O06 | Unsigned `payout=999.00` and `event`: credit equals the signed reward | The credited amount comes from authenticated fields only |
| O07 | Reversal twice: taken once; a signed reversal naming 10 for a 250 credit takes 250 | A reversal takes back the stored amount from the stored account, once (playground V11) |
| O08 | Reversal of an unknown tx: 2xx, no change; the later credit pays nothing | A reversal for an unknown transaction changes no balance, and a later credit for that id pays nothing |
| O09 | Spend 300, reversal: balance -300, the next spend refused | The rule for a reversal after the coins are gone is explicit; only the reversal path makes debt |
| O10 | Fresh 600: payout refused, `withdrawable` 0; 600 matured for the hold: payout succeeds | Fresh offer earnings cannot be withdrawn before the hold has passed (playground V14) |
| O11 | 600 + 700 matured, 3,000 bought, the 600 reversed: `withdrawable` 700, payout of 800 refused | A reversal reduces what can be withdrawn at once |
| O12 | Postback for an unknown user: 2xx | Decision default: logged, answered 2xx, not credited (avoids endless retries) |
| O13 | Signed reward `120.75`: +120 | Rounding: down, once; values hashed as received |
| O14 | `GET /admin/reconcile` reports no mismatch | Credits and reversals go through the ledger posting function |

## Rules reviewed by reading the code (not automated)

- The hash comparison is constant-time.
- The balance changes only when the insert reported a new row, in the same transaction, and the 2xx is sent after the commit; a failed write answers 5xx.
- Client callbacks from the wall never credit anything (no such endpoint should exist).
- No secret is in the repository (check committed config, tests and docs for the real key or salt).
- A log line per postback with the raw query string and the answer; test postbacks (`test_` ids) are not credited to real accounts.
- Referral commission is posted and reversed with offer credits (Coinbarn's referral code counts only purchases in this workspace; note whether the agent extended it).
- The network's facts (parameters, scheme, reversal shape, expected answer, retries) are written down in the code or docs.
