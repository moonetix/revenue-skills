// Builds an Offerly postback request file hashed with the TEST key the local server runs with.
// Usage: OFFERLY_TEST_KEY=... node sign-postback.mjs <user id> <tx> <reward> <status> > file.json
import { createHmac } from 'node:crypto';
const [user, tx, reward, status] = process.argv.slice(2);
const key = process.env.OFFERLY_TEST_KEY;
if (!key || status === undefined) { console.error('need OFFERLY_TEST_KEY and <user id> <tx> <reward> <status>'); process.exit(2); }
const hash = createHmac('sha256', key).update([user, tx, reward, status].join(':')).digest('hex');
console.log(JSON.stringify({ method: 'GET', url: `http://127.0.0.1:8742/postback/offerly?user_id=${user}&tx=${tx}&reward=${reward}&status=${status}&hash=${hash}` }));
