import http from 'node:http';
import { settings } from './config/settings.mjs';
import { coinsForUsd, rewardCoins } from './lib/convert.mjs';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (url.pathname === '/api/economy') {
    return json(res, 200, {
      coins_per_dollar: settings.coinsPerDollar,
      user_share_pct: settings.userSharePct,
      signup_bonus_coins: settings.signupBonusCoins,
      daily_bonus_coins: settings.dailyBonusCoins,
      referral_commission_pct: settings.referralCommissionPct,
      payout_minimum_coins: coinsForUsd(settings.payoutMinimumUsd),
      hold_days: settings.holdDays,
    });
  }
  if (url.pathname === '/api/reward-preview') {
    const payout = url.searchParams.get('payout_usd') ?? '';
    if (!/^\d{1,6}(\.\d{1,8})?$/.test(payout) || Number(payout) <= 0) return json(res, 400, { error: 'invalid_payout' });
    return json(res, 200, { coins: rewardCoins(payout) });
  }
  if (url.pathname === '/') {
    const fmt = (n) => n.toLocaleString('en-US');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Cash out</title><h1>Cash out</h1>
<p>Turn your coins into gift cards from ${fmt(coinsForUsd(settings.payoutMinimumUsd))} coins (${settings.payoutMinimumUsd.toFixed(2)} USD). Coins from offers can be cashed out ${settings.holdDays} days after you earn them.</p>
<p>Earn ${fmt(settings.dailyBonusCoins)} coins every day you check in, and ${fmt(settings.signupBonusCoins)} coins after your first completed offer.</p>`);
  }
  json(res, 404, { error: 'not_found' });
});

server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  console.log(`Coinbarn economy service on http://127.0.0.1:${server.address().port}`);
});
