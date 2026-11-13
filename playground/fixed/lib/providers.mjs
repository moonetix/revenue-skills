import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// Stand-ins for the services a real deployment calls over the network.
export function createProviders() {
  const delivered = [];
  const notifications = [];
  const giftCards = new Map();
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
      get sent() {
        return [...giftCards.values()];
      },
      // The same idempotency key always returns the same card, so a retried call cannot pay twice.
      // A real provider can also throw: an error with code 'refused' when it declined for
      // certain, anything else (a timeout, a reset connection) when the outcome is unknown.
      async send({ userId, cents, idempotencyKey }) {
        await sleep(20);
        if (!giftCards.has(idempotencyKey)) {
          giftCards.set(idempotencyKey, {
            userId,
            cents,
            code: `GC-${randomBytes(6).toString('hex').toUpperCase()}`,
          });
        }
        return giftCards.get(idempotencyKey);
      },
    },
  };
}
