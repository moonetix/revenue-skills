# Example: an audit of Coinjar

Spoilers for the practice app. Run your own audit first if you want to measure an agent with it.

This folder is the output of one `money-audit` run on a copy of [`playground/vulnerable/`](../../playground/vulnerable/), kept as the agent wrote it:

| File | What it is |
| --- | --- |
| `findings.json` | 24 findings: 20 proved with requests from the probe, 4 with step by step code traces. |
| `REPORT.md` | The report rendered from `findings.json`. |
| `money-map.md` | Every path where coins enter, move or leave the app. |
| `evidence/` | The request files and signing helpers the agent wrote, and the saved probe output each finding names as `output_file`. |

## Check it

```bash
npm run check:example
```

This validates the findings against the app and scores them against the answer key. It also checks the [referral-engine example](../referral-engine-audit/). Expected for this folder:

```console
examples/coinjar-audit/ against playground/vulnerable/
  ok    validator: VALID, 24 findings (11 critical, 6 high, 6 medium, 1 low)
  ok    scorer: 17 of 17 planted bugs found, each by a different finding; 23 of 24 findings point at a planted bug
```

The same steps by hand. The audit ran inside a copy of the app with its output in `money-audit/`, and the `output_file` paths are relative to that copy, so rebuild the layout first:

```bash
dir=$(mktemp -d)
cp -r playground/vulnerable/. "$dir"
cp -r examples/coinjar-audit "$dir/money-audit"
node skills/money-audit/scripts/validate-findings.mjs "$dir/money-audit/findings.json" --root "$dir"
node playground/score.mjs examples/coinjar-audit/findings.json
```

Run against `playground/vulnerable` directly, the validator reports every `output_file` as missing, because those files sit in this folder and not in the app.

The validator checks that each quoted line is at the file and line it names and that every proof has its fields filled in. It does not rerun the proofs. To see the attacks behind them run against both versions of the app, use `npm test` or the [live demo](https://moonetix.github.io/revenue-skills/).
