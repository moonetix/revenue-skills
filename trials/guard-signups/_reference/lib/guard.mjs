import { readFileSync } from 'node:fs';
import net from 'node:net';

const dataFile = (name) =>
  readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#'));

const DISPOSABLE = new Set(dataFile('disposable-domains.txt'));
const CLOUD = dataFile('cloud-ranges.txt').filter((c) => !c.includes(':'));
const TRUSTED_PROXIES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const EMAIL = /^[^@\s+][^@\s]*@[^@\s]+\.[^@\s]+$/;

export const WEIGHTS = { datacenter: 40, velocity_ip: 30 };
export const REVIEW_FROM = 30;

// Gmail treats dots and plus tags as the same inbox, and googlemail.com as gmail.com.
// Other domains are lowercased only.
export function normalizeEmail(email) {
  const text = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(text)) return null;
  const at = text.lastIndexOf('@');
  let local = text.slice(0, at);
  let domain = text.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replaceAll('.', '');
  if (!local) return null;
  return `${local}@${domain}`;
}

export function isDisposable(email) {
  const labels = String(email).toLowerCase().split('@')[1].split('.');
  for (let i = 0; i < labels.length - 1; i += 1) if (DISPOSABLE.has(labels.slice(i).join('.'))) return true;
  return false;
}

const v4 = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
export function isCloud(ip) {
  if (!net.isIPv4(ip)) return false;
  return CLOUD.some((cidr) => {
    const [base, bits] = cidr.split('/');
    const size = 2 ** (32 - Number(bits));
    return Math.floor(v4(ip) / size) === Math.floor(v4(base) / size);
  });
}

export function isPublic(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return !(a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 169 && b === 254));
}

// The socket peer, or the rightmost forwarded address that is not one of our proxies.
export function clientAddress(req) {
  let ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!TRUSTED_PROXIES.has(req.socket.remoteAddress) && !TRUSTED_PROXIES.has(ip)) return ip;
  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  while (hops.length) {
    ip = hops.pop().replace(/^::ffff:/, '');
    if (!TRUSTED_PROXIES.has(ip)) break;
  }
  return ip;
}
