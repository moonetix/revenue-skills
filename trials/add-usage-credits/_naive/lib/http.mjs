const MAX_BODY = 100_000;

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

export async function handle(app, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, payload) => {
    const text = typeof payload === 'string';
    res.writeHead(status, { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' });
    res.end(text ? payload : JSON.stringify(payload));
  };
  try {
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
    await route.handler({ req, res, query: url.searchParams, raw, body, user, send });
  } catch (err) {
    if (!res.headersSent) send(err.status || 500, { error: err.status ? 'request_rejected' : 'server_error' });
  }
}

export const requireUser = (handler) => (ctx) =>
  ctx.user ? handler(ctx) : ctx.send(401, { error: 'sign_in_required' });

// Whole coins only: 12, not "12", 12.5, 1e3 or -3.
export const wholeCoins = (value, max) => (Number.isSafeInteger(value) && value > 0 && value <= max ? value : null);
