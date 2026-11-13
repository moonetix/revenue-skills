import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Comparing digests keeps the comparison constant-time for inputs of any length.
export function safeEqual(a, b) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Paylane signs each webhook: "Paylane-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of t.body>".
// The timestamp is part of the signed text, so an old capture cannot be replayed with a new time.
export function verifyPaylaneSignature(rawBody, header, secret, toleranceSeconds, nowSeconds) {
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((p) => p.split('=')),
  );
  if (!/^\d{1,12}$/.test(parts.t || '') || !/^[a-f0-9]{64}$/.test(parts.v1 || '')) return false;
  if (Math.abs(nowSeconds - Number(parts.t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return safeEqual(parts.v1, expected);
}

export function offerlyHash(key, userId, tx, reward, status) {
  return createHmac('sha256', key).update(`${userId}:${tx}:${reward}:${status}`).digest('hex');
}
