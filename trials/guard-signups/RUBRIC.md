# Rubric: guard-signups

Task: a 100-coin welcome bonus, paid at once for clean sign-ups and held until the first purchase or offer earning for suspicious ones (cloud ranges in `data/cloud-ranges.txt`); duplicates including Gmail variants and throwaway domains (`data/disposable-domains.txt`) refused; `POST /api/promo` with `WELCOME100` (100 coins, 10,000 total) and `LAUNCH5` (250 coins, first 5 accounts), once per account; the app sits behind a proxy on 127.0.0.1 that appends to `X-Forwarded-For`. The checker sends every sign-up with an `X-Forwarded-For` value; clean ones get a distinct residential address each.

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| G01 | `jane.doe.<run>@gmail.com`, then `janedoe<run>+1@gmail.com` and `J.A.N.E.D.O.E.<run>@googlemail.com`: refused, no second account | The unique index is on the normalized email; Gmail rules |
| G02 | `erin+tag@outlook.com` next to `erin@outlook.com`, `first.last@example.org` next to `firstlast@example.org`: all created | A normalization rule exists only where the provider documents it |
| G03 | `@mailinator.com`, `@eu.mailinator.com` (parent match), `@YOPMAIL.com`: refused, no account, the answer names no score, threshold, list or domain | Disposable domains block; a block shows hints only |
| G04 | `kim@@example.org`, `kim@example`, `+tag@gmail.com`: refused | Malformed addresses are rejected (skill test vectors) |
| G05 | Clean sign-up: balance 100 | Allow outcome |
| G06 | Sign-up from a cloud address: account works, balance 0 | Review never disables the account; it holds the bonus |
| G07 | Held account earns 50 twice: balance 200 | A bonus enters the balance through one conditional transition from held, once |
| G08 | `X-Forwarded-For: 81.2.1.9, 3.5.140.77`: bonus held | The client address is the rightmost entry not added by a trusted proxy |
| G09 | Twelve sign-ups, different emails, one home address: all created | No network signal or velocity rule blocks alone |
| G10 | One email eight times: first created, the rest 4xx | Uniqueness on the normalized key; attempts still refused |
| G11 | `WELCOME100` three times (with `coins: 99999` in the body), and ten times at once on another account: +100 each | A promo redemption inserts under a unique (code, account) key; the amount comes from the code (playground V12) |
| G12 | Seven accounts redeem `LAUNCH5` at once: 1,250 coins in total | The cap is taken with a conditional update in the same transaction |
| G13 | Unknown code: 4xx, no change | Baseline |
| G14 | `GET /admin/reconcile` reports no mismatch | Bonuses and promos go through the ledger |

## Rules reviewed by reading the code (not automated)

- Every account-creating and email-changing path writes the normalized key (Coinbarn has only sign-up; check the backfill for existing rows and that it merges no one).
- The score equals the sum of the stored reasons' points; weights and thresholds are configuration; every attempt, including refused ones, is recorded with its reasons before the decision.
- A non-public client address is never counted or scored (127.0.0.1 from the proxy itself must not trip velocity).
- Lists are read from local storage during a request; nothing is fetched at sign-up; a job refreshes them and refuses a shrunken download.
- Promo redemption has attempt limits around it; no `SELECT COUNT(*)` before the insert decides the cap.
- Trials do not exist in Coinbarn; a trial claim keyed by identity is not applicable.
- Referral rewards stay tied to verified activity (unchanged from the starter).
- Retention: assessments deleted after 90 days, unclaimed held bonuses voided after 30 days (scheduled).
