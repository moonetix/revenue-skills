import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/index.js';

const plan = { type: 'percentage', rateBps: 1000 };

// One referrer "a" with 500 of released commission (10% of a 5000 earning, no hold).
async function referrerWith500(store = new R.MemoryStore()) {
  const engine = new R.ReferralEngine({ store, plan });
  await engine.attach({ refereeId: 'b', referrerId: 'a', at: 0 });
  await engine.recordEarning({ earningId: 'e1', refereeId: 'b', amount: 5000, at: 1 });
  return engine;
}

test('a payout dated before an already recorded payout cannot pay the same balance twice', async () => {
  const engine = await referrerWith500();
  await engine.recordPayout({ payoutId: 'p1', referrerId: 'a', amount: 500, at: 200 });
  await assert.rejects(engine.recordPayout({ payoutId: 'p2', referrerId: 'a', amount: 500, at: 150 }), (e) => e.code === 'insufficient_balance');
  assert.equal((await engine.balance('a', 300)).available, 0);
});

test('a payout dated before an already recorded clawback cannot pay reversed commission', async () => {
  const engine = await referrerWith500();
  await engine.reverseEarning({ earningId: 'e1', at: 200 });
  await assert.rejects(engine.recordPayout({ payoutId: 'p1', referrerId: 'a', amount: 500, at: 150 }), (e) => e.code === 'insufficient_balance');
  assert.equal((await engine.balance('a', 300)).available, 0);
});
