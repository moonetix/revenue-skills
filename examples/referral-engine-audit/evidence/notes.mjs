// Demonstrations for the report's notes (not findings): node money-audit/evidence/notes.mjs
import * as R from '../../src/index.js';

const plan = { type: 'percentage', rateBps: 1000 };
const show = async (label, fn) => {
  try {
    console.log(label, JSON.stringify(await fn()));
  } catch (e) {
    console.log(label, 'throws', e.code);
  }
};

console.log('1. A reversal that arrives before its earning stores nothing, and the late earning accrues in full');
{
  const engine = new R.ReferralEngine({ store: new R.MemoryStore(), plan });
  await engine.attach({ refereeId: 'b', referrerId: 'a', at: 0 });
  await show('   reverseEarning e9:', () => engine.reverseEarning({ earningId: 'e9', at: 5 }));
  await show('   recordEarning e9: ', async () => (await engine.recordEarning({ earningId: 'e9', refereeId: 'b', amount: 5000, at: 4 })).status);
  await show('   balance of a:     ', () => engine.balance('a', 300));
}

console.log('2. Two attach calls at the same moment (a refers b, b refers a) on MemoryStore, which locks per referee');
{
  const engine = new R.ReferralEngine({ store: new R.MemoryStore(), plan });
  const results = await Promise.allSettled([engine.attach({ refereeId: 'a', referrerId: 'b', at: 0 }), engine.attach({ refereeId: 'b', referrerId: 'a', at: 0 })]);
  console.log('   results:', results.map((r) => (r.status === 'fulfilled' ? r.value.status : r.reason.code)).join(', '));
}

console.log('3. A partial reversal without reversalId, then the full reversal without reversalId (documented pitfall)');
{
  const engine = new R.ReferralEngine({ store: new R.MemoryStore(), plan });
  await engine.attach({ refereeId: 'b', referrerId: 'a', at: 0 });
  await engine.recordEarning({ earningId: 'e1', refereeId: 'b', amount: 5000, at: 1 });
  await show('   partial 2000:', async () => (await engine.reverseEarning({ earningId: 'e1', amount: 2000, at: 2 })).status);
  await show('   full:        ', async () => (await engine.reverseEarning({ earningId: 'e1', at: 3 })).status);
  await show('   balance of a:', () => engine.balance('a', 300));
}

console.log('4. A payout whose at lies after the hold releases held commission (the engine has no clock of its own)');
{
  const engine = new R.ReferralEngine({ store: new R.MemoryStore(), plan, holdSeconds: 1000 });
  await engine.attach({ refereeId: 'b', referrerId: 'a', at: 0 });
  await engine.recordEarning({ earningId: 'e1', refereeId: 'b', amount: 5000, at: 1 });
  await show('   payout at 2000:', async () => (await engine.recordPayout({ payoutId: 'p1', referrerId: 'a', amount: 500, at: 2000 })).status);
}

console.log('5. Concurrent earnings pass a per-referee cap of 100 when the store has no withLock (same root as MA-02)');
{
  const inner = new R.MemoryStore();
  const store = { getReferral: (x) => inner.getReferral(x), insertReferral: (x) => inner.insertReferral(x), listEntries: (x) => inner.listEntries(x), appendEntries: (x) => inner.appendEntries(x) };
  const engine = new R.ReferralEngine({ store, plan: { ...plan, perRefereeCap: 100 } });
  await engine.attach({ refereeId: 'b', referrerId: 'a', at: 0 });
  await Promise.all(['x1', 'x2', 'x3'].map((id) => engine.recordEarning({ earningId: id, refereeId: 'b', amount: 1000, at: 5 })));
  await show('   balance of a:', () => engine.balance('a', 10));
}
