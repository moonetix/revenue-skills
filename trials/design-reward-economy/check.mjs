#!/usr/bin/env node
// Checker for the design-reward-economy trial: the economy file, its inputs, and the service's numbers.
//   node check.mjs <folder>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkEconomy } from '../../skills/design-reward-economy/scripts/economy-check.mjs';
import { client, notStarted, report, startTrialApp, targetFolder } from '../lib/harness.mjs';

const folder = targetFolder();
const r = report('design-reward-economy');
let economy = null;
let loadError = '';
try {
  economy = JSON.parse(readFileSync(path.join(folder, 'config', 'economy.json'), 'utf8'));
} catch (err) {
  loadError = err.message;
}
const run = (input) => {
  try {
    return checkEconomy(input);
  } catch (err) {
    return { ok: false, violations: [{ rule: 'input-error', message: (err.problems || [err.message]).join('; ') }] };
  }
};
const describe = (result) => result.violations.map((v) => v.rule).join(', ');
const bonus = (type) => (economy?.bonuses || []).find((b) => b.type === type);

await r.check('E01', 'config/economy.json exists and the economy check passes on it', async () => {
  if (!economy) return `cannot read config/economy.json: ${loadError}`;
  const result = run(economy);
  return result.ok || `violations: ${describe(result)}`;
});

await r.check('E02', 'the inputs are the owner\'s measured numbers, or more cautious ones', async () => {
  if (!economy) return 'no economy file';
  const e = economy;
  const wrong = [];
  const want = (name, value, test) => {
    if (!test(value)) wrong.push(`${name}=${JSON.stringify(value)}`);
  };
  want('volume.monthlyRevenueUsd', e.volume?.monthlyRevenueUsd, (v) => v === 12000);
  want('volume.activeUsers', e.volume?.activeUsers, (v) => v === 3000);
  want('volume.newUsers', e.volume?.newUsers, (v) => v === 1800);
  want('reversals.ratePct', e.reversals?.ratePct, (v) => v >= 7);
  want('reversals.lateRecoveryPct', e.reversals?.lateRecoveryPct ?? 0, (v) => v <= 25);
  const measured = { 7: 30, 14: 55, 30: 85, 45: 94, 60: 98, 90: 100 };
  for (const point of e.reversals?.arrival || []) {
    if (measured[point.days] !== undefined && point.pct > measured[point.days]) wrong.push(`arrival ${point.days}d=${point.pct}`);
  }
  if (!(e.reversals?.arrival || []).length) wrong.push('reversals.arrival missing');
  want('payout.feePct', e.payout?.feePct, (v) => v >= 2);
  want('payout.feeFixedUsd', e.payout?.feeFixedUsd, (v) => v >= 0.25);
  want('payout.feePaidBy', e.payout?.feePaidBy ?? 'app', (v) => v === 'app');
  want('payout.averagePayoutUsd', e.payout?.averagePayoutUsd ?? e.payout?.minimumUsd, (v) => v <= 11);
  want('payout.redemptionPct', e.payout?.redemptionPct ?? 100, (v) => v >= 92);
  want('costs.otherPctOfRevenue', e.costs?.otherPctOfRevenue ?? 0, (v) => v >= 3);
  want('costs.fixedMonthlyUsd', e.costs?.fixedMonthlyUsd ?? 0, (v) => v >= 1200);
  want('cash.reserveUsd', e.cash?.reserveUsd, (v) => v <= 15000);
  want('cash.receivablesUsd', e.cash?.receivablesUsd ?? 0, (v) => v <= 14000);
  want('cash.networkPaymentDelayDays', e.cash?.networkPaymentDelayDays, (v) => v >= 40);
  const redeem = e.currency?.redeemCoinsPerDollar ?? e.currency?.coinsPerDollar;
  want('cash.outstandingCoins (in dollars)', (e.cash?.outstandingCoins ?? 0) / redeem, (v) => v >= 9000);
  want('daily check-in takeUpPct', bonus('per_active_user_per_day')?.takeUpPct ?? 100, (v) => v >= 30);
  want('sign-up bonus takeUpPct', bonus('per_new_user')?.takeUpPct ?? 100, (v) => v >= 100);
  want('referral coveragePct', bonus('referral')?.coveragePct ?? 100, (v) => v >= 20);
  for (const type of ['per_new_user', 'per_active_user_per_day', 'referral']) if (!bonus(type)) wrong.push(`bonus ${type} missing`);
  return wrong.length === 0 || `not the measured numbers: ${wrong.join(', ')}`;
});

await r.check('E03', 'the owner\'s targets are in the file and not loosened', async () => {
  if (!economy) return 'no economy file';
  const t = economy.targets || {};
  const wrong = [];
  if (!(t.minMarginPct >= 15)) wrong.push(`minMarginPct=${t.minMarginPct}`);
  if (!(t.minReversalsInsideHoldPct >= 90)) wrong.push(`minReversalsInsideHoldPct=${t.minReversalsInsideHoldPct}`);
  if (!(t.maxDaysToMinimumPayout <= 30)) wrong.push(`maxDaysToMinimumPayout=${t.maxDaysToMinimumPayout}`);
  if (!(t.maxBonusPctOfRevenue <= 10)) wrong.push(`maxBonusPctOfRevenue=${t.maxBonusPctOfRevenue}`);
  return wrong.length === 0 || wrong.join(', ');
});

await r.check('E04', 'the worst case (every bonus taken, every coin redeemed, every payout at the minimum) still passes', async () => {
  if (!economy) return 'no economy file';
  const worst = structuredClone(economy);
  for (const b of worst.bonuses || []) if (['per_new_user', 'per_active_user_per_day', 'per_active_user_per_month'].includes(b.type)) b.takeUpPct = 100;
  worst.payout.redemptionPct = 100;
  worst.payout.averagePayoutUsd = worst.payout.minimumUsd;
  const result = run(worst);
  return result.ok || `violations: ${describe(result)}`;
});

await r.check('E05', 'every section of the file says where its numbers come from', async () => {
  if (!economy) return 'no economy file';
  const missing = ['currency', 'earning', 'volume', 'payout', 'reversals', 'costs', 'targets'].filter(
    (section) => !economy[section] || !Object.keys(economy[section]).some((k) => k.startsWith('_') || k.startsWith('$')),
  );
  return missing.length === 0 || `no note in: ${missing.join(', ')}`;
});

const app = await startTrialApp(folder, {});
if (!app.started) {
  r.skipAll([['E06', 'the service checks']], notStarted(app));
  await r.finish(app.stop);
} else {
  const t = client(app.base);
  const e = economy || { currency: {}, earning: {}, payout: {}, reversals: {} };
  const rate = e.currency.coinsPerDollar;
  const redeem = e.currency.redeemCoinsPerDollar ?? rate;
  const minimumCoins = Math.round((e.payout.minimumUsd ?? 0) * redeem);

  await r.check('E06', 'GET /api/economy serves the numbers of the economy file', async () => {
    const res = await t.api('/api/economy');
    if (res.status !== 200) return `answered ${res.status}`;
    const got = res.json;
    const expected = {
      coins_per_dollar: rate,
      user_share_pct: e.earning.userSharePct,
      signup_bonus_coins: bonus('per_new_user')?.coins ?? 0,
      daily_bonus_coins: bonus('per_active_user_per_day')?.coins ?? 0,
      referral_commission_pct: bonus('referral')?.pct ?? 0,
      payout_minimum_coins: minimumCoins,
      hold_days: e.reversals.holdDays ?? 0,
    };
    const diff = Object.entries(expected).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k} ${got[k]} vs file ${v}`);
    return diff.length === 0 || diff.join(', ');
  });

  await r.check('E07', 'rewards are computed exactly and rounded down', async () => {
    // floor(payout x rate x share / 100) in exact integer arithmetic.
    const frac = (x) => {
      const [whole, dec = ''] = String(x).split('.');
      return { n: BigInt(whole + dec), d: 10n ** BigInt(dec.length) };
    };
    const share = frac(e.earning.userSharePct);
    const wrong = [];
    for (const payout of ['0.05', '0.37', '1.15', '2.675', '0.0005', '3.333333', '12.5']) {
      const p = frac(payout);
      const want = Number((p.n * BigInt(rate) * share.n) / (p.d * share.d * 100n));
      const res = await t.api(`/api/reward-preview?payout_usd=${payout}`);
      if (res.json?.coins !== want) wrong.push(`${payout}: ${res.json?.coins} (want ${want})`);
    }
    return wrong.length === 0 || wrong.join(', ');
  });

  await r.check('E08', 'the cash-out page shows the new minimum, bonuses and hold, not the old ones', async () => {
    const res = await t.api('/');
    const text = res.text.replace(/<[^>]+>/g, ' ');
    const shows = (n) => text.includes(String(n)) || text.includes(Number(n).toLocaleString('en-US'));
    const missing = [];
    if (!shows(minimumCoins)) missing.push(`minimum ${minimumCoins}`);
    if (bonus('per_new_user') && !shows(bonus('per_new_user').coins)) missing.push(`sign-up bonus ${bonus('per_new_user').coins}`);
    if (bonus('per_active_user_per_day') && !shows(bonus('per_active_user_per_day').coins)) missing.push(`daily ${bonus('per_active_user_per_day').coins}`);
    if ((e.reversals.holdDays ?? 0) > 0 && !shows(e.reversals.holdDays)) missing.push(`hold ${e.reversals.holdDays} days`);
    if (/right away/i.test(text) && (e.reversals.holdDays ?? 0) > 0) missing.push('still says coins can be cashed out right away');
    return missing.length === 0 || `page lacks: ${missing.join(', ')}`;
  });

  await r.finish(app.stop);
}
