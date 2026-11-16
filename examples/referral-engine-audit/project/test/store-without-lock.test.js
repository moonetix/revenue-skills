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

test('payouts sent at the same moment cannot all pass the balance check when the store has no withLock', async () => {
  const inner = new R.MemoryStore();
  // The README calls withLock "Optional in JavaScript": a store with the four required methods only.
  const store = {
    getReferral: (id) => inner.getReferral(id),
    insertReferral: (r) => inner.insertReferral(r),
    listEntries: (f) => inner.listEntries(f),
    appendEntries: (e) => inner.appendEntries(e),
  };
  const engine = await referrerWith500(store);
  const results = await Promise.allSettled(['p1', 'p2', 'p3'].map((id) => engine.recordPayout({ payoutId: id, referrerId: 'a', amount: 500, at: 10 })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'one payout of 500 fits a balance of 500');
  assert.equal((await engine.balance('a', 300)).available, 0);
});
