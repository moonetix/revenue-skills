// The referrer is paid once, after the invited user has earned or bought enough.
// Call this after every verified credit.
export function settleReferral(app, userId) {
  const { db, ledger, config } = app;
  const user = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(userId);
  if (!user?.referred_by) return;
  const verified = ledger.sum(userId, ['purchase', 'offer']);
  if (verified >= config.referralQualifyingCoins) {
    ledger.entry({ userId: user.referred_by, amount: config.referralBonus, kind: 'referral', ref: userId });
  }
}
