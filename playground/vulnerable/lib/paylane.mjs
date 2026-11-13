import { createHmac, timingSafeEqual } from 'node:crypto';

// Paylane signs each webhook: "Paylane-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of t.body>".
export function verifyPaylaneSignature(rawBody, header, secret) {
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
