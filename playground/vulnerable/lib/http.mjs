import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BODY = 100_000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sessionUser(db, header) {
  const match = /^Bearer ([a-f0-9]{48})$/.exec(header || '');
  if (!match) return null;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(match[1]);
  return row ? { id: row.user_id } : null;
}

async function serveStatic(pathname, send, res) {
  const name = path.basename(pathname);
  try {
    const file = await readFile(path.join(PUBLIC_DIR, name));
    const type = name.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(file);
  } catch {
    send(404, { error: 'not_found' });
  }
}

export async function handle(app, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, payload) => {
    const text = typeof payload === 'string';
    res.writeHead(status, { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' });
    res.end(text ? payload : JSON.stringify(payload));
  };
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
      return await serveStatic(url.pathname, send, res);
    }
    const route = app.routes.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) return send(404, { error: 'not_found' });
    const raw = req.method === 'GET' ? '' : await readBody(req);
    let body = null;
    if (raw && (req.headers['content-type'] || '').includes('application/json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { error: 'invalid_json' });
      }
    }
    const user = sessionUser(app.db, req.headers.authorization);
    await route.handler({ req, query: url.searchParams, raw, body, user, send });
  } catch (err) {
    if (!res.headersSent) send(err.status || 500, { error: err.status ? 'request_rejected' : 'server_error' });
  }
}

export const requireUser = (handler) => (ctx) =>
  ctx.user ? handler(ctx) : ctx.send(401, { error: 'sign_in_required' });
