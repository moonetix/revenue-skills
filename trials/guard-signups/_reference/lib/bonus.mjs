// Moves a held welcome bonus into the balance, once. Call inside the transaction of a verified credit.
export function releaseBonus(app, userId) {
  const grant = app.db.prepare('SELECT coins FROM bonus_grants WHERE user_id = ?').get(userId);
  if (!grant) return;
  const moved = app.db.prepare("UPDATE bonus_grants SET state = 'granted' WHERE user_id = ? AND state = 'held'").run(userId);
  if (moved.changes) app.ledger.entry({ userId, amount: grant.coins, kind: 'welcome_bonus', ref: userId });
}
