import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Comparing digests keeps the comparison constant-time for inputs of any length.
export function safeEqual(a, b) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Stripe-Signature: "t=<unix seconds>,v1=<hex HMAC-SHA256 of t.body>[,v1=...][,v0=...]".
// Any v1 entry may match (Stripe sends one per active secret while a secret is rolled).
export function verifyStripeSignature(rawBody, header, secret, toleranceSeconds, nowSeconds) {
  let t = null;
  const v1 = [];
  for (const part of String(header || '').split(',')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') t = value;
    else if (key === 'v1') v1.push(value);
  }
  if (!/^\d{1,12}$/.test(t || '') || v1.length === 0) return false;
  if (Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  let match = false;
  for (const candidate of v1) if (safeEqual(candidate, expected)) match = true;
  return match;
}

export function rewardlyHash(key, userId, tx, reward, status) {
  return createHmac('sha256', key).update(`${userId}:${tx}:${reward}:${status}`).digest('hex');
}
