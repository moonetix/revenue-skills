import { setTimeout as sleep } from 'node:timers/promises';

// Stand-ins for the services the app calls.
export function createProviders(config) {
  const delivered = [];
  const notifications = [];
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
  };
}
