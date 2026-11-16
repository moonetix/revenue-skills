import { settings } from '../config/settings.mjs';

// Coins credited to the user for an offer that pays us payoutUsd.
export function rewardCoins(payoutUsd) {
  return Math.round(payoutUsd * settings.coinsPerDollar * (settings.userSharePct / 100));
}

// Coins needed to cash out usd dollars.
export function coinsForUsd(usd) {
  return Math.round(usd * settings.coinsPerDollar);
}
