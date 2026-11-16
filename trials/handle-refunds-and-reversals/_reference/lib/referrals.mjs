// The referrer is paid once, and only after the invited user has earned or bought enough
// through events the app verified itself. A sign-up alone is worth nothing. When refunds
// or reversals pull the invited user back under the bar, the bonus is taken back, once.
// A bonus that was taken back is not paid a second time: UNIQUE (kind, ref) keeps the
// first entry. Call this after every verified credit and after every reversal.
export function settleReferral(app, userId) {
  const { db, ledger, config } = app;
  const user = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(userId);
  if (!user?.referred_by) return;
  const verified = ledger.sum(userId, ['purchase', 'purchase_refund', 'purchase_dispute', 'purchase_dispute_won', 'offer', 'offer_reversal']);
  if (verified >= config.referralQualifyingCoins) {
    ledger.entry({ userId: user.referred_by, amount: config.referralBonus, kind: 'referral', ref: userId });
    return;
  }
  const paid = db.prepare("SELECT user_id, amount FROM ledger WHERE kind = 'referral' AND ref = ?").get(String(userId));
  if (!paid) return;
  ledger.entry({ userId: paid.user_id, amount: -paid.amount, kind: 'referral_reversal', ref: userId, allowDebt: true });
}
