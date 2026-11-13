import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// Stand-ins for the services a real deployment calls over the network.
export function createProviders() {
  const delivered = [];
  const notifications = [];
  const giftCards = [];
  return {
    entitlements: {
      delivered,
      async grant(userId, item) {
        await sleep(15);
        delivered.push({ userId, item });
      },
    },
    notifier: {
      notifications,
      async rewardEarned(userId, coins) {
        await sleep(15);
        notifications.push({ userId, coins });
      },
    },
    giftcards: {
      sent: giftCards,
      async send({ userId, usd }) {
        await sleep(20);
        const card = { userId, usd, code: `GC-${randomBytes(6).toString('hex').toUpperCase()}` };
        giftCards.push(card);
        return card;
      },
    },
  };
}
