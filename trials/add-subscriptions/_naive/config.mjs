export const defaults = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || ':memory:',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripeApiUrl: process.env.STRIPE_API_URL || 'https://api.stripe.com',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  postbackKey: process.env.REWARDLY_POSTBACK_KEY,
  adminKey: process.env.ADMIN_KEY,
  giftlyUrl: process.env.GIFTLY_API_URL || 'https://api.giftly.test',
  giftlyKey: process.env.GIFTLY_API_KEY,
  webhookToleranceSeconds: 300,
  referralBonus: 500,
  referralQualifyingCoins: 500,
  coinsPerDollar: 100,
  payoutMinCoins: 500,
  payoutDailyMaxCoins: 5000,
  payoutHoldSeconds: Number(process.env.PAYOUT_HOLD_SECONDS || 7 * 24 * 3600),
  transferMaxCoins: 10_000,
  adminGrantMaxCoins: 100_000,
  plusGraceSeconds: Number(process.env.PLUS_GRACE_SECONDS || 3 * 24 * 3600),
};

// Coinbarn Plus: one monthly plan on Stripe Billing.
export const PLUS = { price: 'price_plus_monthly', priceCents: 499, currency: 'usd', monthlyCoins: 300 };

export const PACKS = {
  small: { coins: 500, priceCents: 499 },
  medium: { coins: 1200, priceCents: 999 },
  large: { coins: 3000, priceCents: 1999 },
};

export const ITEMS = { avatar: 100, boost: 150, theme: 300 };

export const PROMOS = {
  WELCOME100: { coins: 100, maxRedemptions: 10_000 },
  SPRING250: { coins: 250, maxRedemptions: 500 },
};

export function checkConfig(config) {
  for (const key of ['stripeWebhookSecret', 'postbackKey']) {
    if (typeof config[key] !== 'string' || config[key].length < 16) {
      throw new Error(`${key} is not set: the app does not start with a missing or short secret`);
    }
  }
  if (config.adminKey !== undefined && String(config.adminKey).length < 32) {
    throw new Error('adminKey must be at least 32 characters, or unset to switch the admin routes off');
  }
}
