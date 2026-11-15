// Builds a Paylane webhook request file signed with the TEST secret the local server runs with.
// Usage: PAYLANE_TEST_SECRET=... node sign-webhook.mjs <event id> <event type> <order id> [unix timestamp] > file.json
import { createHmac } from 'node:crypto';
const [id, type, orderId, tArg] = process.argv.slice(2);
const secret = process.env.PAYLANE_TEST_SECRET;
if (!secret || !orderId) { console.error('need PAYLANE_TEST_SECRET and <event id> <event type> <order id>'); process.exit(2); }
const body = JSON.stringify({ id, type, data: { order_id: orderId } });
const t = tArg || Math.floor(Date.now() / 1000);
const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
console.log(JSON.stringify({ method: 'POST', url: 'http://127.0.0.1:8742/webhooks/paylane',
  headers: { 'content-type': 'application/json', 'paylane-signature': `t=${t},v1=${v1}` }, rawBody: body }));
