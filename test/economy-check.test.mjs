// Tests for skills/design-reward-economy/scripts/economy-check.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.join(here, '..', 'skills', 'design-reward-economy');
const script = path.join(skill, 'scripts', 'economy-check.mjs');
const { checkEconomy, formatReport, holdDaysFor, InputError, insideHold, normalize } = await import(pathToFileURL(script).href);
const example = JSON.parse(readFileSync(path.join(skill, 'assets', 'economy.example.json'), 'utf8'));

const scratch = mkdtempSync(path.join(tmpdir(), 'economy-check-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// The smallest valid economy: half of every payout goes to users, nothing else.
const base = (changes = {}) => ({
  currency: { coinsPerDollar: 1000 },
  earning: { userSharePct: 50 },
  volume: { monthlyRevenueUsd: 10000 },
  payout: { minimumUsd: 5 },
  ...changes,
});
const rules = (list) => list.map((item) => item.rule);
const close = (actual, expected, tolerance = 0.002) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected about ${expected}, got ${actual}`);
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const save = (name, data) => {
  const file = path.join(scratch, name);
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
};

test('a plain share is the margin', () => {
  const r = checkEconomy(base());
  assert.equal(r.ok, true);
  assert.equal(r.perDollarOfRevenue.margin, 0.5);
  assert.equal(r.perDollarOfRevenue.marginIfEveryCoinIsRedeemed, 0.5);
  assert.equal(r.share.effectivePct, 50);
  assert.equal(r.monthly.issuedToUsersUsd, 5000);
  assert.equal(r.breakEven.userSharePctAtZeroMargin, 100);
  assert.equal(r.breakEven.minMonthlyRevenueUsd, 0);
  assert.equal(r.payout.minimumCoins, 5000);
  assert.deepEqual(rules(r.violations), []);
  assert.deepEqual(rules(r.warnings), ['cash-not-checked']);
});

test('an earning bonus is paid from the margin, and too large a bonus breaks the economy', () => {
  const boost = (pct) => checkEconomy(base({ bonuses: [{ type: 'earning_multiplier', pct }] }));
  const doubled = boost(100);
  assert.equal(doubled.share.effectivePct, 100);
  assert.equal(doubled.perDollarOfRevenue.margin, 0);
  assert.equal(doubled.ok, true);

  const over = boost(150);
  assert.equal(over.share.effectivePct, 125);
  assert.equal(over.ok, false);
  assert.deepEqual(rules(over.violations), ['pays-more-than-it-earns', 'margin-below-target']);

  const partial = checkEconomy(base({ bonuses: [{ type: 'earning_multiplier', pct: 20, coveragePct: 50 }] }));
  assert.equal(partial.share.effectivePct, 55);
  assert.equal(partial.bonuses[0].coinsPerMonth, 500000);
});

test('a referral commission counts like any other bonus', () => {
  const r = checkEconomy(base({ bonuses: [{ name: 'refs', type: 'referral', pct: 10, coveragePct: 40 }] }));
  assert.equal(r.share.effectivePct, 52);
  assert.equal(r.share.bonusPctOfRevenue, 2);
  assert.equal(r.bonuses[0].name, 'refs');
  assert.equal(r.bonuses[0].usdPerMonth, 200);
});

test('coins that redeem cheaper than they are earned raise the real share', () => {
  const r = checkEconomy(base({ currency: { coinsPerDollar: 100, redeemCoinsPerDollar: 80 }, earning: { userSharePct: 90 } }));
  assert.equal(r.share.effectivePct, 112.5);
  assert.equal(r.ok, false);
  assert.ok(rules(r.violations).includes('pays-more-than-it-earns'));
  assert.ok(rules(r.warnings).includes('redeem-rate-below-earn-rate'));

  const dearer = checkEconomy(base({ currency: { coinsPerDollar: 1000, redeemCoinsPerDollar: 1100 } }));
  close(dearer.share.effectivePct, 45.45, 0.01);
  assert.equal(dearer.payout.minimumCoins, 5500);
  assert.ok(!rules(dearer.warnings).includes('redeem-rate-below-earn-rate'));
});

test('fixed bonuses are counted from take-up and user numbers', () => {
  const r = checkEconomy(
    base({
      volume: { monthlyRevenueUsd: 10000, activeUsers: 1000, newUsers: 1000 },
      bonuses: [{ type: 'per_new_user', coins: 1000, takeUpPct: 50 }],
    }),
  );
  assert.equal(r.bonuses[0].coinsPerMonth, 500000);
  assert.equal(r.monthly.issuedToUsersUsd, 5500);
  assert.equal(r.perDollarOfRevenue.margin, 0.45);
  assert.equal(r.share.effectivePct, 55);
  assert.equal(r.share.bonusPctOfRevenue, 5);
  assert.equal(r.breakEven.minMonthlyRevenueUsd, 1000);
  assert.equal(r.breakEven.bonusHeadroomCoinsPerMonth, 4500000);

  const mixed = checkEconomy(
    base({
      volume: { monthlyRevenueUsd: 10000, activeUsers: 1000, newUsers: 0 },
      bonuses: [
        { type: 'per_active_user_per_day', coins: 10, takeUpPct: 10 },
        { type: 'per_active_user_per_month', coins: 100, takeUpPct: 20 },
        { type: 'fixed_per_month', coins: 50000 },
      ],
    }),
  );
  assert.deepEqual(mixed.bonuses.map((b) => b.coinsPerMonth), [30000, 20000, 50000]);
  assert.equal(mixed.monthly.issuedToUsersUsd, 5100);
});

test('bonuses alone must not reach the payout minimum', () => {
  const withBonus = (bonus) =>
    checkEconomy(base({ volume: { monthlyRevenueUsd: 10000, activeUsers: 100, newUsers: 100 }, bonuses: [bonus] }));
  assert.deepEqual(rules(withBonus({ type: 'per_new_user', coins: 1000 }).violations), []);
  assert.ok(rules(withBonus({ type: 'per_new_user', coins: 5000 }).violations).includes('bonus-only-payout'));
  assert.ok(!rules(withBonus({ type: 'per_new_user', coins: 5000, requiresEarning: true }).violations).includes('bonus-only-payout'));
  const daily = withBonus({ type: 'per_active_user_per_day', coins: 200, takeUpPct: 1 });
  assert.ok(rules(daily.violations).includes('bonus-only-payout'));
  assert.equal(daily.payout.bonusOnlyCoinsIn30Days, 6000);
});

test('reversals cost revenue, and a hold decides how much of the credit comes back', () => {
  const noHold = checkEconomy(base({ reversals: { ratePct: 10 } }));
  assert.deepEqual(rules(noHold.violations), ['no-hold']);
  assert.equal(noHold.perDollarOfRevenue.keptAfterReversals, 0.9);
  assert.equal(noHold.perDollarOfRevenue.margin, 0.4);
  assert.equal(noHold.monthly.uncollectedReversalsUsd, 500);
  assert.equal(noHold.breakEven.maxReversalRatePct, 50);

  const full = checkEconomy(base({ reversals: { ratePct: 10, holdDays: 30, arrival: [{ days: 30, pct: 100 }] } }));
  assert.equal(full.ok, true);
  assert.equal(full.hold.reversalsInsidePct, 100);
  assert.equal(full.perDollarOfRevenue.margin, 0.45);
  assert.equal(full.monthly.uncollectedReversalsUsd, 0);
  assert.equal(full.share.effectivePct, 50);

  const half = checkEconomy(base({ reversals: { ratePct: 10, holdDays: 15, arrival: [{ days: 30, pct: 100 }] } }));
  assert.equal(half.hold.reversalsInsidePct, 50);
  assert.equal(half.monthly.uncollectedReversalsUsd, 250);
  assert.equal(half.perDollarOfRevenue.margin, 0.425);

  const recovered = checkEconomy(base({ reversals: { ratePct: 10, holdDays: 15, lateRecoveryPct: 50, arrival: [{ days: 30, pct: 100 }] } }));
  assert.equal(recovered.monthly.uncollectedReversalsUsd, 125);

  const blind = checkEconomy(base({ reversals: { ratePct: 10, holdDays: 30 } }));
  assert.equal(blind.ok, true);
  assert.ok(rules(blind.warnings).includes('no-arrival-data'));
  assert.equal(blind.hold.reversalsInsidePct, 0);
});

test('the arrival curve is read with straight lines between points', () => {
  const curve = [
    { days: 7, pct: 50 },
    { days: 30, pct: 90 },
    { days: 60, pct: 100 },
  ];
  assert.equal(insideHold(curve, 0), 0);
  assert.equal(insideHold(curve, 3.5), 0.25);
  assert.equal(insideHold(curve, 7), 0.5);
  close(insideHold(curve, 18.5), 0.7, 1e-9);
  assert.equal(insideHold(curve, 60), 1);
  assert.equal(insideHold(curve, 400), 1);
  assert.equal(insideHold(undefined, 30), 0);
  assert.equal(insideHold([{ days: 30, pct: 80 }], 90), 0.8);

  assert.equal(holdDaysFor(curve, 50), 7);
  assert.equal(holdDaysFor(curve, 25), 4);
  assert.equal(holdDaysFor(curve, 90), 30);
  assert.equal(holdDaysFor(curve, 95), 45);
  assert.equal(holdDaysFor([{ days: 30, pct: 80 }], 90), null);
  assert.equal(holdDaysFor(undefined, 90), null);
});

test('a hold target names the hold that would meet it', () => {
  const reversals = { ratePct: 5, holdDays: 30, arrival: [{ days: 30, pct: 92 }, { days: 60, pct: 99 }] };
  const missed = checkEconomy(base({ reversals, targets: { minReversalsInsideHoldPct: 95 } }));
  assert.deepEqual(rules(missed.violations), ['hold-misses-target']);
  assert.equal(missed.hold.daysForTarget, 43);
  assert.match(missed.violations[0].message, /needs 43 days/);

  const met = checkEconomy(base({ reversals, targets: { minReversalsInsideHoldPct: 90 } }));
  assert.equal(met.ok, true);

  const unreachable = checkEconomy(base({ reversals, targets: { minReversalsInsideHoldPct: 100 } }));
  assert.match(unreachable.violations[0].message, /never reaches/);
});

test('payout fees are a cost only when the app pays them', () => {
  const payout = { minimumUsd: 5, feePct: 2, feeFixedUsd: 0.5, averagePayoutUsd: 10 };
  const byApp = checkEconomy(base({ payout }));
  assert.equal(byApp.payout.feePctAtAveragePayout, 7);
  assert.equal(byApp.payout.feePctAtMinimumPayout, 12);
  assert.equal(byApp.perDollarOfRevenue.payoutFees, 0.035);
  assert.equal(byApp.perDollarOfRevenue.margin, 0.465);

  const byUser = checkEconomy(base({ payout: { ...payout, feePaidBy: 'user' } }));
  assert.equal(byUser.perDollarOfRevenue.payoutFees, 0);
  assert.equal(byUser.perDollarOfRevenue.margin, 0.5);

  const swallowed = checkEconomy(base({ payout: { minimumUsd: 5, feeFixedUsd: 5, feePaidBy: 'user' } }));
  assert.deepEqual(rules(swallowed.violations), ['fee-consumes-minimum-payout']);

  const thin = checkEconomy(base({ earning: { userSharePct: 90 }, payout: { minimumUsd: 2, feeFixedUsd: 0.5, averagePayoutUsd: 50 } }));
  assert.equal(thin.ok, true);
  assert.ok(rules(thin.warnings).includes('fees-at-minimum-payout'));
});

test('unredeemed coins lift the expected margin but stay a liability', () => {
  const r = checkEconomy(base({ payout: { minimumUsd: 5, redemptionPct: 80 } }));
  assert.equal(r.perDollarOfRevenue.margin, 0.6);
  assert.equal(r.perDollarOfRevenue.marginIfEveryCoinIsRedeemed, 0.5);
  assert.equal(r.monthly.liabilityAddedUsd, 1000);
  assert.equal(r.monthly.paidToUsersUsd, 4000);

  const leaning = checkEconomy(base({ payout: { minimumUsd: 5, redemptionPct: 80 }, targets: { minMarginPct: 55 } }));
  assert.equal(leaning.ok, true);
  assert.ok(rules(leaning.warnings).includes('margin-relies-on-unredeemed-coins'));
  assert.equal(leaning.breakEven.maxRedemptionPct, 90);

  const short = checkEconomy(base({ payout: { minimumUsd: 5, redemptionPct: 80 }, targets: { minMarginPct: 65 } }));
  assert.deepEqual(rules(short.violations), ['margin-below-target']);
});

test('other costs and fixed costs come out of the margin', () => {
  const r = checkEconomy(base({ costs: { otherPctOfRevenue: 5, fixedMonthlyUsd: 1000 } }));
  assert.equal(r.perDollarOfRevenue.otherCosts, 0.15);
  assert.equal(r.perDollarOfRevenue.margin, 0.35);
  close(r.breakEven.minMonthlyRevenueUsd, 2222.22, 0.01);
  assert.equal(r.breakEven.userSharePctAtZeroMargin, 85);
});

test('the smallest reward must be at least one coin, and rounding loss is reported', () => {
  const zero = checkEconomy(base({ currency: { coinsPerDollar: 100 }, earning: { userSharePct: 50, smallestPayoutUsd: 0.01 } }));
  assert.deepEqual(rules(zero.violations), ['smallest-reward-is-zero']);

  const coarse = base({ earning: { userSharePct: 50, smallestPayoutUsd: 0.1 } });
  const warned = checkEconomy(coarse);
  assert.equal(warned.rounding.smallestRewardCoins, 50);
  assert.equal(warned.rounding.worstLossPct, 2);
  assert.equal(warned.ok, true);
  assert.ok(rules(warned.warnings).includes('rounding-loss'));
  assert.deepEqual(rules(checkEconomy({ ...coarse, targets: { maxRoundingLossPct: 1 } }).violations), ['rounding-loss']);

  const fine = checkEconomy(base({ earning: { userSharePct: 50, smallestPayoutUsd: 0.2 } }));
  assert.ok(!rules(fine.warnings).includes('rounding-loss'));
});

test('targets for share, bonus budget and time to the minimum are enforced', () => {
  const volume = { monthlyRevenueUsd: 10000, activeUsers: 1000, newUsers: 0 };
  const bonuses = [{ type: 'fixed_per_month', coins: 1000000 }];
  const r = checkEconomy(base({ volume, bonuses, targets: { maxEffectiveSharePct: 55, maxBonusPctOfRevenue: 5, maxDaysToMinimumPayout: 20 } }));
  assert.equal(r.share.effectivePct, 60);
  assert.equal(r.share.bonusPctOfRevenue, 10);
  assert.equal(r.payout.daysToMinimum, 25);
  assert.deepEqual(rules(r.violations), ['effective-share-over-target', 'bonus-budget-over-target', 'minimum-payout-too-far']);

  const relaxed = checkEconomy(base({ volume, bonuses, targets: { maxEffectiveSharePct: 60, maxBonusPctOfRevenue: 10, maxDaysToMinimumPayout: 25 } }));
  assert.equal(relaxed.ok, true);

  const unknown = checkEconomy(base({ targets: { maxDaysToMinimumPayout: 20 } }));
  assert.ok(rules(unknown.warnings).includes('minimum-payout-not-checked'));
});

test('unspent balances must be covered, and so must the gap before the networks pay', () => {
  const uncovered = checkEconomy(base({ cash: { outstandingCoins: 20000000, reserveUsd: 5000, receivablesUsd: 5000 } }));
  assert.deepEqual(rules(uncovered.violations), ['liability-not-covered']);
  assert.equal(uncovered.cash.liabilityUsd, 20000);
  assert.equal(uncovered.cash.workingCapitalUsd, null);

  const reversals = { ratePct: 0, holdDays: 30 };
  const gap = checkEconomy(base({ reversals, cash: { outstandingCoins: 1000000, reserveUsd: 2000, receivablesUsd: 20000, networkPaymentDelayDays: 45 } }));
  assert.deepEqual(rules(gap.violations), ['payment-gap-not-funded']);
  assert.equal(gap.cash.paymentGapDays, 15);
  assert.equal(gap.cash.workingCapitalUsd, 2500);

  const funded = checkEconomy(base({ reversals, cash: { outstandingCoins: 1000000, reserveUsd: 3000, receivablesUsd: 20000, networkPaymentDelayDays: 45 } }));
  assert.equal(funded.ok, true);
  assert.deepEqual(rules(funded.warnings), []);

  const longHold = checkEconomy(base({ reversals: { ratePct: 0, holdDays: 60 }, cash: { outstandingCoins: 0, reserveUsd: 0, networkPaymentDelayDays: 45 } }));
  assert.equal(longHold.cash.paymentGapDays, 0);
  assert.equal(longHold.ok, true);
});

test('each break-even point, put back into the input, lands on the target margin', () => {
  const target = example.targets.minMarginPct / 100;
  const b = checkEconomy(example).breakEven;
  const marginWith = (change) => {
    const input = structuredClone(example);
    change(input);
    return checkEconomy(input).perDollarOfRevenue.margin;
  };
  close(marginWith((e) => (e.earning.userSharePct = b.maxUserSharePct)), target);
  close(marginWith((e) => (e.volume.monthlyRevenueUsd = b.minMonthlyRevenueUsd)), target);
  close(marginWith((e) => (e.reversals.ratePct = b.maxReversalRatePct)), target);
  close(marginWith((e) => e.bonuses.push({ type: 'fixed_per_month', coins: b.bonusHeadroomCoinsPerMonth })), target);
  const zero = structuredClone(example);
  zero.earning.userSharePct = b.userSharePctAtZeroMargin;
  zero.targets = {};
  close(checkEconomy(zero).perDollarOfRevenue.margin, 0);
});

test('the per-dollar lines add up to the margin', () => {
  const d = checkEconomy(example).perDollarOfRevenue;
  close(d.keptAfterReversals - d.offerRewards - d.bonuses - d.payoutFees - d.otherCosts, d.margin, 0.0005);
});

test('the example file holds without warnings', () => {
  const r = checkEconomy(example);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
  assert.match(formatReport(r), /VERDICT: the economy holds\./);
});

test('wrong input is refused with every problem named', () => {
  const problems = (input) => {
    try {
      checkEconomy(input);
    } catch (err) {
      assert.ok(err instanceof InputError);
      return err.problems;
    }
    return assert.fail('expected an InputError');
  };
  assert.deepEqual(problems([]), ['the file must contain one JSON object']);
  const missing = problems({});
  assert.equal(missing.length, 4);
  assert.ok(missing.includes('"earning.userSharePct" is required'));

  const many = problems({
    currency: { coinsPerDollar: 0, rate: 1000 },
    earning: { userSharePct: 120 },
    volume: { monthlyRevenueUsd: '10000' },
    payout: { minimumUsd: 5, feePaidBy: 'nobody', averagePayoutUsd: 2 },
    reversals: { ratePct: 100, arrival: [{ days: 30, pct: 90 }, { days: 20, pct: 80 }] },
    bonuses: [{ type: 'cashback', coins: 5 }, { type: 'per_new_user', coins: 5 }, { type: 'fixed_per_month' }],
    cash: { reserveUsd: 100 },
    economy: {},
  });
  for (const part of [
    '"economy" is not a known section',
    '"currency.rate" is not a known field',
    '"currency.coinsPerDollar" must be greater than 0',
    '"earning.userSharePct" must be 100 or less',
    '"volume.monthlyRevenueUsd" must be a number',
    '"payout.feePaidBy" must be one of',
    '"payout.averagePayoutUsd" cannot be below',
    '"reversals.ratePct" must be less than 100',
    '"reversals.arrival[1].days" must be greater than',
    '"reversals.arrival[1].pct" must be between 90 and 100',
    '"bonuses[0].type" must be one of',
    '"bonuses[1]" needs "volume.newUsers"',
    '"bonuses[2].coins" is required',
    '"cash" needs both',
  ]) {
    assert.ok(many.some((p) => p.includes(part)), `no problem mentions ${part}`);
  }
});

test('notes are ignored and defaults are filled in', () => {
  const c = normalize({ ...base(), _comment: 'draft', $schema: 'x', currency: { coinsPerDollar: 500, _why: 'small numbers' } });
  assert.equal(c.currency.name, 'coins');
  assert.equal(c.currency.redeemCoinsPerDollar, 500);
  assert.equal(c.payout.averagePayoutUsd, 5);
  assert.equal(c.payout.redemptionPct, 100);
  assert.equal(c.payout.feePaidBy, 'app');
  assert.equal(c.targets.minMarginPct, 0);
  assert.equal(c.hasCash, false);
});

test('the result is plain data and the report prints every violation', () => {
  const r = checkEconomy(base({ reversals: { ratePct: 10 }, bonuses: [{ type: 'earning_multiplier', pct: 150 }] }));
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  const text = formatReport(r);
  for (const v of r.violations) assert.ok(text.includes(`[${v.rule}] ${v.message}`));
  assert.match(text, /VERDICT: the economy does not hold\. 3 rules are violated\./);
  assert.doesNotMatch(text, /NaN|undefined|Infinity/);
});

test('command line: usage, exit codes and --json', () => {
  const none = cli();
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^Usage:/);
  assert.equal(none.stdout, '');

  const good = cli(path.join(skill, 'assets', 'economy.example.json'));
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /margin if every coin is redeemed/);
  assert.match(good.stdout, /VERDICT: the economy holds\./);

  const bad = save('bad.json', base({ bonuses: [{ type: 'earning_multiplier', pct: 150 }] }));
  const failing = cli(bad);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /\[pays-more-than-it-earns\]/);

  const machine = cli(bad, '--json');
  assert.equal(machine.status, 1);
  const parsed = JSON.parse(machine.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.violations[0].rule, 'pays-more-than-it-earns');
  assert.equal(JSON.parse(cli('--json', path.join(skill, 'assets', 'economy.example.json')).stdout).ok, true);

  const broken = cli(save('broken.json', '{ "currency": '));
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /is not valid JSON/);

  const absent = cli(path.join(scratch, 'nothing.json'));
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /Cannot read the file/);

  const invalid = cli(save('invalid.json', { currency: { coinsPerDollar: 1000 } }));
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /The economy file has 3 problems/);
  assert.equal(invalid.stdout, '');

  assert.equal(cli('a.json', 'b.json').status, 2);
  assert.equal(cli('--verbose').status, 2);
});
