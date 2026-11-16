import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Comparing digests keeps the comparison constant-time for inputs of any length.
export function safeEqual(a, b) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function rewardlyHash(key, userId, tx, reward, status) {
  return createHmac('sha256', key).update(`${userId}:${tx}:${reward}:${status}`).digest('hex');
}
