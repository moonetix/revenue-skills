import { settings } from '../config/settings.mjs';

// Exact decimal string -> { n, d } with value n / d.
function fraction(value) {
  const [whole, dec = ''] = String(value).split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(dec)) throw new TypeError('not a decimal');
  return { n: BigInt(whole + dec), d: 10n ** BigInt(dec.length) };
}

// Coins credited for an offer that pays us payoutUsd: integer arithmetic, rounded down once.
export function rewardCoins(payoutUsd) {
  const p = fraction(payoutUsd);
  const s = fraction(settings.userSharePct);
  return Number((p.n * BigInt(settings.coinsPerDollar) * s.n) / (p.d * s.d * 100n));
}

// Coins needed to cash out usd dollars: rounded up once.
export function coinsForUsd(usd) {
  const u = fraction(usd);
  const num = u.n * BigInt(settings.redeemCoinsPerDollar);
  return Number((num + u.d - 1n) / u.d);
}
