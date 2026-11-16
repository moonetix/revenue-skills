// The referrer is paid once, after the invited user has bought or earned enough.
// If refunds or reversals pull the invited user back under the bar, the bonus is taken back.
export function settleReferral(app, userId) {
  const { db, config } = app;
  const user = db.prepare('SELECT referred_by, referral_state FROM users WHERE id = ?').get(userId);
  if (!user?.referred_by) return;
  const bought = db.prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM orders WHERE user_id = ? AND status = 'paid'").get(userId).n;
  const earned = db.prepare("SELECT COALESCE(SUM(coins), 0) AS n FROM offer_conversions WHERE user_id = ? AND status = 'credited'").get(userId).n;
  if (bought + earned >= config.referralQualifyingCoins) {
    const paid = db.prepare("UPDATE users SET referral_state = 'paid' WHERE id = ? AND referral_state = 'none'").run(userId);
    if (paid.changes) db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(config.referralBonus, user.referred_by);
    return;
  }
  const taken = db.prepare("UPDATE users SET referral_state = 'taken_back' WHERE id = ? AND referral_state = 'paid'").run(userId);
  if (taken.changes) db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(config.referralBonus, user.referred_by);
}
