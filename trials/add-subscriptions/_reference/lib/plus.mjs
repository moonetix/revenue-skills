import { PLUS } from '../config.mjs';
import { now } from '../db.mjs';

// Coinbarn Plus. One row per Stripe subscription, holding Stripe's own latest state as fetched
// from the API. Whether a user has Plus is computed from those rows at the moment of the request,
// so time alone ends a grace period or a canceled month without waiting for an event.
const KEEPS_ACCESS = new Set(['active', 'trialing', 'past_due']);

export function createPlus(app) {
  const { db, ledger, config, stripe } = app;

  // Writes Stripe's subscription object. The row keeps the moment the object was fetched, and a
  // write that started earlier than the stored one changes nothing: a slow fetch cannot put an
  // older state back. Returns the user the subscription belongs to, or null when it is not ours.
  function store(sub, fetchedMs) {
    const checkoutId = String(sub?.metadata?.checkout_id ?? '');
    const checkout = db.prepare('SELECT id, user_id FROM plus_checkouts WHERE id = ?').get(checkoutId);
    if (!checkout) return null;
    const item = sub.items?.data?.find((i) => i?.price?.id === PLUS.price) ?? sub.items?.data?.[0];
    const start = Number(item?.current_period_start) || 0;
    const end = Number(item?.current_period_end) || 0;
    db.prepare(
      `INSERT INTO plus_subscriptions (id, user_id, checkout_id, status, period_start, period_end, cancel_at_period_end, fetched_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, period_start = excluded.period_start,
         period_end = excluded.period_end, cancel_at_period_end = excluded.cancel_at_period_end,
         fetched_ms = excluded.fetched_ms, updated_at = excluded.updated_at
       WHERE plus_subscriptions.fetched_ms <= excluded.fetched_ms`,
    ).run(sub.id, checkout.user_id, checkout.id, String(sub.status), start, end, sub.cancel_at_period_end ? 1 : 0, fetchedMs, now());
    db.prepare("UPDATE plus_checkouts SET status = 'completed' WHERE id = ? AND status = 'pending'").run(checkout.id);
    return db.prepare('SELECT user_id FROM plus_subscriptions WHERE id = ?').get(sub.id).user_id;
  }

  // The monthly coins, once per subscription and paid period: the ledger key is the subscription
  // and the start of the period the invoice paid for, so a repeated event, a second event type for
  // the same invoice or a run of the sync job grant nothing more.
  function grantPeriodCoins(invoice) {
    if (invoice?.status !== 'paid') return false;
    if (!['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason)) return false;
    const subId = invoice.parent?.subscription_details?.subscription;
    const row = subId ? db.prepare('SELECT user_id FROM plus_subscriptions WHERE id = ?').get(String(subId)) : null;
    if (!row) return false;
    const line = invoice.lines?.data?.find((l) => !l?.parent?.subscription_item_details?.proration) ?? invoice.lines?.data?.[0];
    const periodStart = Number(line?.period?.start);
    if (!Number.isSafeInteger(periodStart) || periodStart <= 0) return false;
    return ledger.entry({ userId: row.user_id, amount: PLUS.monthlyCoins, kind: 'plus_period', ref: `${subId}:${periodStart}` });
  }

  // A refunded or disputed Plus payment ends that subscription's access at once.
  function revoke(subId, reason) {
    db.prepare('UPDATE plus_subscriptions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL').run(now(), reason, subId);
  }

  function hasPlus(userId, at = now()) {
    const rows = db
      .prepare('SELECT status, period_start, period_end, cancel_at_period_end, revoked_at FROM plus_subscriptions WHERE user_id = ?')
      .all(userId);
    return rows.some((s) => {
      if (s.revoked_at !== null || !KEEPS_ACCESS.has(s.status)) return false;
      // past_due: Stripe has moved on to a period that is not paid, so access runs from the end
      // of the last paid period (the start of the current one) plus the grace period.
      if (s.status === 'past_due') return at < s.period_start + config.plusGraceSeconds;
      const slack = s.cancel_at_period_end ? 0 : config.plusGraceSeconds;
      return at < s.period_end + slack;
    });
  }

  // The provider is the source of truth: fetch, then store inside the caller's transaction.
  async function fetchSubscription(id) {
    const fetchedMs = Date.now();
    const sub = await stripe.subscription(id);
    return sub ? { sub, fetchedMs } : null;
  }

  // Compares every Stripe subscription that names one of our checkouts with what we store.
  async function sync() {
    let checked = 0;
    let coins = 0;
    for await (const { sub, fetchedMs } of stripe.allSubscriptions()) {
      if (!sub?.metadata?.checkout_id) continue;
      const latest = typeof sub.latest_invoice === 'string' ? await stripe.invoice(sub.latest_invoice) : null;
      ledger.atomic(() => {
        if (store(sub, fetchedMs) === null) return;
        checked += 1;
        if (latest && grantPeriodCoins(latest)) coins += 1;
      });
    }
    return { checked, periods_granted: coins };
  }

  return { store, grantPeriodCoins, revoke, hasPlus, fetchSubscription, sync };
}
