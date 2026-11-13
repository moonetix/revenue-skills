# revenue-skills

Agent skills that find and fix the bugs that cost an app money: a webhook nobody verifies, a credit that lands twice, a balance two requests spend at once, a refund that leaves the goods behind.

Maintained by [Moonetix](https://moonetix.com).

**Status: in progress.** The practice app and its exploit tests are here. The audit skill and the builder skills follow.

## What is here so far

[`playground/`](playground/) holds Coinjar, a small backend that sells, grants, moves and pays out virtual coins, in two versions:

- [`playground/vulnerable/`](playground/vulnerable/) works, and loses money in 17 ways.
- [`playground/fixed/`](playground/fixed/) has the same features with every one of those ways closed.

[`test/playground.test.mjs`](test/playground.test.mjs) contains one exploit per planted bug. Each must succeed against the vulnerable app and fail against the fixed one.

```bash
npm test
```

Node 22.13 or newer. Nothing to install.

## License

MIT. See [LICENSE](LICENSE).
