import { setTimeout as sleep } from 'node:timers/promises';

// Clients for the services the app calls over the network.
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
    // Giftly gift card API. See docs/giftly-api.md.
    giftcards: {
      async send({ userId, cents, idempotencyKey }) {
        let res;
        try {
          res = await fetch(`${config.giftlyUrl}/v1/orders`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.giftlyKey ?? ''}` },
            body: JSON.stringify({ external_id: idempotencyKey, amount_cents: cents, recipient: `user-${userId}` }),
            signal: AbortSignal.timeout(3000),
          });
        } catch (err) {
          throw Object.assign(new Error(`giftly: ${err.message}`), { code: 'unknown' });
        }
        const body = await res.json().catch(() => null);
        if (res.status === 200 || res.status === 201) return { code: body?.code, id: body?.id };
        if (res.status >= 400 && res.status < 500 && body?.error?.code) {
          throw Object.assign(new Error(`giftly: ${body.error.code}`), { code: 'refused' });
        }
        throw Object.assign(new Error(`giftly: HTTP ${res.status}`), { code: 'unknown' });
      },
    },
  };
}
