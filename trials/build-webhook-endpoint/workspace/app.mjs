import http from 'node:http';
import { checkConfig, defaults } from './config.mjs';
import { openDatabase } from './db.mjs';
import { handle } from './lib/http.mjs';
import { createLedger } from './lib/ledger.mjs';
import { createProviders } from './lib/providers.mjs';
import adminRoutes from './routes/admin.mjs';
import authRoutes from './routes/auth.mjs';
import checkoutRoutes from './routes/checkout.mjs';
import payoutRoutes from './routes/payouts.mjs';
import postbackRoutes from './routes/postback.mjs';
import promoRoutes from './routes/promo.mjs';
import walletRoutes from './routes/wallet.mjs';

export function createApp(overrides = {}) {
  const config = { ...defaults, ...overrides };
  checkConfig(config);
  const db = openDatabase(config.dbPath);
  const app = { config, routes: [], db, ledger: createLedger(db), ...createProviders(config) };
  app.route = (method, path, handler) => app.routes.push({ method, path, handler });
  for (const register of [
    authRoutes,
    walletRoutes,
    checkoutRoutes,
    postbackRoutes,
    promoRoutes,
    payoutRoutes,
    adminRoutes,
  ]) {
    register(app);
  }
  app.server = http.createServer((req, res) => handle(app, req, res));
  app.listen = (port = config.port) =>
    new Promise((resolve) => {
      app.server.listen(port, '127.0.0.1', () => resolve(app.server.address().port));
    });
  app.close = () =>
    new Promise((resolve) => {
      app.server.close(() => {
        app.db.close();
        resolve();
      });
      app.server.closeAllConnections();
    });
  return app;
}
