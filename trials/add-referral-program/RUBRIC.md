# Rubric: add-referral-program

Task: invite codes (`ref_code` in `GET /api/me`, `ref` on sign-up), a 500-coin bonus once the friend has 500 coins of verified purchases or offer earnings, taken back when a refund or reversal drops the friend below 500, no hold, at most 20 bonuses per referrer per 30 days, no bonus for a second account of the referrer, and `GET /api/referrals` without friend emails. The workspace keeps promo codes and transfers so the checker can prove that gifts do not qualify (the brief suggested removing promo code too; it stays as a fixture).

## Automated checks (`check.mjs`)

| Check | What it does | Skill rule covered |
| --- | --- | --- |
| F01 | Three sign-ups with a code and nothing else: referrer balance 0, three referrals listed | Creating an account posts no reward to anyone (playground V13) |
| F02 | The code is not the user id or a short counter; the list does not contain the friend's email | Codes are random; the referrer's view shows states, not personal data |
| F03 | Sign-up with `referrer_id`, `referred_by`, `referrer` in the body: nothing attributed, the friend's later activity pays nothing; an unknown code still signs up | The referrer is resolved on the server from a code; a request never carries a trusted referrer id |
| F04 | 300 earned: nothing; 200 more: +500; the same postback again and a purchase: still 500 | The reward is one ledger entry keyed by the referred account; qualifying activity from verified entries |
| F05 | Friend has 450 earned, 400 received by transfer, 100 promo: nothing | Qualifying activity is computed from verified entries only, never from gifts |
| F06 | Bonus paid, referrer spends 300, friend's offer reversed (twice): referrer at -300; friend earns 700 again: still -300 | Every reversal path calls the settle function; the take-back is the posted amount, once, also when spent; a reversed referral never rewards again |
| F07 | 400 + 400 + 300, the 300 reversed: bonus stays | A reversal that leaves activity above the threshold changes nothing |
| F08 | Six qualifying postbacks at once: one bonus | The unique key makes a second reward impossible |
| F09 | Friend's qualifying purchase fully refunded: bonus taken back | Refund handlers call the settle function in the same transaction |
| F10 | Referrer `jane.doe.<run>@gmail.com`, friend `j.a.n.e.d.o.e<run>+bonus@googlemail.com`: never pays (refusing the sign-up also passes) | Second accounts of the same person are held back (normalized email signal) |
| F11 | 21 friends qualify: referrer gets 20 bonuses | Caps are checked in the transaction that posts |
| F12 | `GET /admin/reconcile` reports no mismatch | Rewards go through the ledger |

## Rules reviewed by reading the code (not automated)

- An account cannot be its own referrer: a check in code and a constraint in the schema.
- The referral row is written once, in the sign-up transaction; no code path (profile update, later "enter a code" screen) changes the referrer.
- The cap is checked under a lock (SQLite serializes; check that the count and the post are in one transaction).
- A blocked or held referral posts nothing until a named staff member releases it; staff actions (block, release, revoke) carry a name and a reason, and staff cannot decide on their own referrals. The task asks for review but no staff screen; note what was built.
- Same-person signals beyond email (device id, payment fingerprint, payout destination) where the app has them; the network address only flags.
- The reconcile queries for referrals are scheduled.
- The program's rules (condition, cap, take-back) are written down for users.
