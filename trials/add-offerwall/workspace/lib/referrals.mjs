// The referrer is paid once, after the invited user has bought enough. When refunds pull
// the invited user back under the bar, the bonus is taken back, once. Call this after every
// verified credit and after every reversal.
export function settleReferral(app, userId) {
  const { db, ledger, config } = app;
  const user = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(userId);
  if (!user?.referred_by) return;
  const verified = ledger.sum(userId, ['purchase', 'purchase_refund']);
  if (verified >= config.referralQualifyingCoins) {
    ledger.entry({ userId: user.referred_by, amount: config.referralBonus, kind: 'referral', ref: userId });
    return;
  }
  const paid = db.prepare("SELECT user_id, amount FROM ledger WHERE kind = 'referral' AND ref = ?").get(String(userId));
  if (!paid) return;
  ledger.entry({ userId: paid.user_id, amount: -paid.amount, kind: 'referral_reversal', ref: userId, allowDebt: true });
}
