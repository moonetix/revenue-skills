#!/usr/bin/env node
// Giftly sandbox: a local stand-in for the Giftly gift card API.
//
//   POST /v1/orders            {"external_id","amount_cents","recipient"} -> 201 order, or 200 with the
//                              existing order when external_id was used before (idempotent)
//   GET  /v1/orders?external_id=<id>  -> {"data":[order]} or {"data":[]}
//   POST /_sandbox/mode        {"mode": "ok" | "decline" | "lost" | "error" | "hang"}   (sandbox only)
//
// Modes: ok issues the card. decline answers 422 {"error":{"code":"declined"}} and issues nothing.
// lost issues the card and then drops the connection without an answer. error answers 500 and
// issues nothing. hang never answers and issues nothing.
//
//   PORT=4100 node giftly-sandbox.mjs
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createGiftly() {
  const orders = new Map();
  const state = { mode: 'ok', calls: 0 };
  const hanging = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let body = null;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      } catch {
        return send(400, { error: { code: 'invalid_json' } });
      }
      if (req.method === 'POST' && url.pathname === '/_sandbox/mode') {
        state.mode = String(body?.mode || 'ok');
        return send(200, { mode: state.mode });
      }
      if (req.method === 'GET' && url.pathname === '/v1/orders') {
        const order = orders.get(url.searchParams.get('external_id') || '');
        return send(200, { data: order ? [order] : [] });
      }
      if (req.method === 'POST' && url.pathname === '/v1/orders') {
        state.calls += 1;
        const externalId = String(body?.external_id || '');
        const cents = body?.amount_cents;
        if (!externalId || !Number.isSafeInteger(cents) || cents <= 0) {
          return send(400, { error: { code: 'invalid_request' } });
        }
        if (orders.has(externalId)) {
          const existing = orders.get(externalId);
          if (existing.amount_cents !== cents) return send(409, { error: { code: 'external_id_reused' } });
          return send(200, existing);
        }
        const issue = () => {
          const order = {
            id: `gor_${randomBytes(6).toString('hex')}`,
            external_id: externalId,
            amount_cents: cents,
            recipient: body?.recipient ?? null,
            status: 'delivered',
            code: `GC-${randomBytes(6).toString('hex').toUpperCase()}`,
          };
          orders.set(externalId, order);
          return order;
        };
        switch (state.mode) {
          case 'decline':
            return send(422, { error: { code: 'declined', message: 'The order was declined.' } });
          case 'error':
            return send(500, { error: { code: 'internal' } });
          case 'hang':
            hanging.add(res);
            return undefined;
          case 'lost':
            issue();
            req.socket.destroy();
            return undefined;
          default:
            return send(201, issue());
        }
      }
      return send(404, { error: { code: 'not_found' } });
    });
  });

  return {
    server,
    orders,
    state,
    get issued() {
      return [...orders.values()];
    },
    setMode(mode) {
      state.mode = mode;
    },
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
    },
    close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const giftly = createGiftly();
  const port = await giftly.listen(Number(process.env.PORT || 4100));
  console.log(`Giftly sandbox on http://127.0.0.1:${port}`);
}
