import { readFileSync } from 'node:fs';

// The economy file is the one home of every number; the service reads it.
const economy = JSON.parse(readFileSync(new URL('./economy.json', import.meta.url), 'utf8'));
const bonus = (type) => economy.bonuses.find((b) => b.type === type);

export const settings = {
  coinsPerDollar: economy.currency.coinsPerDollar,
  redeemCoinsPerDollar: economy.currency.redeemCoinsPerDollar,
  userSharePct: economy.earning.userSharePct,
  signupBonusCoins: bonus('per_new_user').coins,
  dailyBonusCoins: bonus('per_active_user_per_day').coins,
  referralCommissionPct: bonus('referral').pct,
  payoutMinimumUsd: economy.payout.minimumUsd,
  payoutFeePaidBy: economy.payout.feePaidBy,
  holdDays: economy.reversals.holdDays,
};
