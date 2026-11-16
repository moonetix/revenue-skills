#!/usr/bin/env node
// Stripe sandbox: a local stand-in for the few Stripe API reads Coinbarn makes, in the shape of
// API version 2026-10-28.endive. Objects are kept in memory; the sandbox never creates or changes
// one by itself.
//
//   GET /v1/subscriptions/<id>                     -> the subscription, or 404 resource_missing
//   GET /v1/subscriptions?status=all&limit=&starting_after=
//                                                  -> {"object":"list","data":[...],"has_more"}, newest first
//   GET /v1/invoices/<id>                          -> the invoice, or 404 resource_missing
//   GET /v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=<pi>[&status=paid]
//                                                  -> {"object":"list","data":[invoice payment ...]}
//   POST /_sandbox/objects  {"objects":[...], "invoice_payments":[{"invoice","payment_intent"}]}
//                                                  stores or replaces subscriptions and invoices, and links an
//                                                  invoice to the PaymentIntent that paid it (sandbox only)
//
// Every /v1 request needs "Authorization: Bearer <key>". Without the key the answer is 401.
//
//   STRIPE_SECRET_KEY=sk_test_local_0123456789 PORT=4200 node stripe-sandbox.mjs
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createStripe({ key }) {
  const subscriptions = new Map();
  const invoices = new Map();
  const paidBy = new Map(); // invoice id -> PaymentIntent id
  const state = { calls: 0 };

  const put = (object) => {
    const copy = structuredClone(object);
    if (copy.object === 'subscription') subscriptions.set(copy.id, copy);
    else if (copy.object === 'invoice') invoices.set(copy.id, copy);
    else throw new Error(`unsupported object ${copy.object}`);
    return copy;
  };
  const link = (invoiceId, paymentIntent) => paidBy.set(invoiceId, paymentIntent);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const missing = (id) => send(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such object: '${id}'` } });
      if (req.method === 'POST' && url.pathname === '/_sandbox/objects') {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const stored = (body.objects || []).map((o) => put(o).id);
          for (const p of body.invoice_payments || []) link(String(p.invoice), String(p.payment_intent));
          return send(200, { stored });
        } catch (err) {
          return send(400, { error: { type: 'invalid_request_error', message: err.message } });
        }
      }
      if (!url.pathname.startsWith('/v1/')) return send(404, { error: { type: 'invalid_request_error', message: 'Unrecognized request URL' } });
      if ((req.headers.authorization || '') !== `Bearer ${key}`) {
        return send(401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } });
      }
      if (req.method !== 'GET') return send(405, { error: { type: 'invalid_request_error', message: 'The sandbox answers GET only' } });
      state.calls += 1;
      let match;
      if ((match = /^\/v1\/subscriptions\/([\w-]+)$/.exec(url.pathname))) {
        const sub = subscriptions.get(match[1]);
        return sub ? send(200, sub) : missing(match[1]);
      }
      if (url.pathname === '/v1/subscriptions') {
        const status = url.searchParams.get('status');
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 10), 1), 100);
        let list = [...subscriptions.values()].sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
        if (status === 'ended') list = list.filter((s) => s.status === 'canceled' || s.status === 'incomplete_expired');
        else if (status && status !== 'all') list = list.filter((s) => s.status === status);
        else if (!status) list = list.filter((s) => s.status !== 'canceled');
        const after = url.searchParams.get('starting_after');
        if (after) {
          const at = list.findIndex((s) => s.id === after);
          list = at >= 0 ? list.slice(at + 1) : [];
        }
        return send(200, { object: 'list', url: '/v1/subscriptions', data: list.slice(0, limit), has_more: list.length > limit });
      }
      if ((match = /^\/v1\/invoices\/([\w-]+)$/.exec(url.pathname))) {
        const invoice = invoices.get(match[1]);
        return invoice ? send(200, invoice) : missing(match[1]);
      }
      if (url.pathname === '/v1/invoice_payments') {
        const pi = url.searchParams.get('payment[payment_intent]');
        const type = url.searchParams.get('payment[type]');
        const status = url.searchParams.get('status');
        if (type !== 'payment_intent' || !pi) {
          return send(400, { error: { type: 'invalid_request_error', message: 'payment[type]=payment_intent and payment[payment_intent] are required' } });
        }
        const data = [...invoices.values()]
          .filter((inv) => paidBy.get(inv.id) === pi)
          .map((inv) => ({
            id: `inpay_${inv.id.slice(3)}`,
            object: 'invoice_payment',
            invoice: inv.id,
            is_default: true,
            livemode: false,
            amount_paid: inv.amount_paid,
            amount_requested: inv.amount_due,
            currency: inv.currency,
            status: inv.status === 'paid' ? 'paid' : 'open',
            payment: { type: 'payment_intent', payment_intent: pi },
          }))
          .filter((p) => !status || p.status === status);
        return send(200, { object: 'list', url: '/v1/invoice_payments', data, has_more: false });
      }
      return send(404, { error: { type: 'invalid_request_error', message: 'Unrecognized request URL' } });
    });
  });

  return {
    server,
    state,
    put,
    link,
    subscription: (id) => structuredClone(subscriptions.get(id)),
    invoice: (id) => structuredClone(invoices.get(id)),
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('usage: STRIPE_SECRET_KEY=<key> [PORT=4200] node stripe-sandbox.mjs');
    process.exit(2);
  }
  const stripe = createStripe({ key });
  const port = await stripe.listen(Number(process.env.PORT || 4200));
  console.log(`Stripe sandbox on http://127.0.0.1:${port}`);
}
