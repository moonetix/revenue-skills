# revenue-skills plugin

Agent skills that find and fix the bugs that cost an app money. This branch holds only the files of the plugin, version 1.3.5: the plugin manifests, the skills, the license and the security policy. The source, the tests, the practice app, the trials and the demo page are on the main branch of [moonetix/revenue-skills](https://github.com/moonetix/revenue-skills). A workflow rebuilds this branch from each release tag, so changes go to the main branch.

## Install in Claude Code

```
/plugin marketplace add moonetix/revenue-skills@plugin
/plugin install revenue-skills@revenue-skills
```

## The skills

| Skill | What it does |
| --- | --- |
| [`add-offerwall`](skills/add-offerwall/) | Add an offerwall to a website, app, game, bot or community so users earn the app's own currency. |
| [`add-payouts`](skills/add-payouts/) | Build withdrawals as a state machine. |
| [`add-referral-program`](skills/add-referral-program/) | Build a referral program whose rewards are paid once, after a verified qualifying event, and taken back when that event is reversed. |
| [`add-subscriptions`](skills/add-subscriptions/) | Build subscription access that follows the provider's state, not the client. |
| [`add-usage-credits`](skills/add-usage-credits/) | Build prepaid usage credits for metered features such as AI generations, LLM calls, API calls or exports. |
| [`build-ledger`](skills/build-ledger/) | Build an append-only ledger with a cached balance for points, credits, coins or wallet money. |
| [`build-webhook-endpoint`](skills/build-webhook-endpoint/) | Build an endpoint that receives signed server-to-server events, such as payment webhooks, app store server notifications and affiliate or offerwall postbacks. |
| [`design-reward-economy`](skills/design-reward-economy/) | Design and check the numbers behind a rewards currency. |
| [`guard-signups`](skills/guard-signups/) | Build sign-up screening and once-only redemption rules that keep sign-up bonuses, free trials, promo codes and referral rewards from being farmed by fake and duplicate accounts. |
| [`handle-refunds-and-reversals`](skills/handle-refunds-and-reversals/) | Make refunds, chargebacks, disputes and reversed conversions take back what the original event granted, exactly once. |
| [`money-audit`](skills/money-audit/) | Audit the code paths where an app handles money, credits, points or rewards, and report the bugs that lose money, each with the exact file and line, the quoted code, and a proof (a request, a test or a code trace). |

Maintained by [Moonetix](https://moonetix.com), an affiliate network. MIT licensed, see [LICENSE](LICENSE). To report a vulnerability, see [SECURITY.md](SECURITY.md).
