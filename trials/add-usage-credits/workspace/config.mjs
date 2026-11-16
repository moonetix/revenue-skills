export const defaults = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || ':memory:',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  postbackKey: process.env.REWARDLY_POSTBACK_KEY,
  adminKey: process.env.ADMIN_KEY,
  giftlyUrl: process.env.GIFTLY_API_URL || 'https://api.giftly.test',
  giftlyKey: process.env.GIFTLY_API_KEY,
  llmUrl: process.env.LLM_API_URL || 'http://127.0.0.1:4200',
  llmKey: process.env.LLM_API_KEY,
  llmModel: process.env.LLM_MODEL || 'coinbarn-assistant-1',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 30_000),
  askMaxOutputTokens: 400,
  askMaxPromptChars: 4000,
  webhookToleranceSeconds: 300,
  referralBonus: 500,
  referralQualifyingCoins: 500,
  coinsPerDollar: 100,
  payoutMinCoins: 500,
  payoutDailyMaxCoins: 5000,
  payoutHoldSeconds: Number(process.env.PAYOUT_HOLD_SECONDS || 7 * 24 * 3600),
  transferMaxCoins: 10_000,
  adminGrantMaxCoins: 100_000,
};

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
