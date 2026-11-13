export const defaults = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || ':memory:',
  webhookSecret: process.env.PAYLANE_WEBHOOK_SECRET || 'whsec_test_not_secret',
  postbackKey: process.env.OFFERLY_POSTBACK_KEY || 'test_postback_key_not_secret',
  adminKey: process.env.ADMIN_KEY || 'coinjar-admin',
  referralBonus: 500,
  coinsPerDollar: 100,
};

export const PACKS = {
  small: { coins: 500, priceCents: 499 },
  medium: { coins: 1200, priceCents: 999 },
  large: { coins: 3000, priceCents: 1999 },
};

export const ITEMS = { avatar: 100, boost: 150, theme: 300 };

export const PROMOS = { WELCOME100: { coins: 100 }, SPRING250: { coins: 250 } };
