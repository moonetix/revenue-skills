import { randomUUID } from 'node:crypto';
import { now } from '../db.mjs';
import { requireUser } from '../lib/http.mjs';
import { countTokens, streamMessage } from '../lib/llm.mjs';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
// Price: 1 coin per 100 prompt tokens plus 1 coin per 10 answer tokens, rounded up once.
const price = (input, output) => Math.ceil((input + 10 * output) / 100);

export default function askRoutes(app) {
  const { db, ledger, config } = app;
  const reservationTtl = Math.ceil(config.llmTimeoutMs / 1000) + 60;

  // Reserve the price of the longest answer before the model is called. One conditional statement.
  function reserve(id, userId, bound) {
    return ledger.atomic(() => {
      const existing = db.prepare('SELECT status, answer FROM ask_reservations WHERE id = ?').get(id);
      if (existing) return { existing };
      const held = db.prepare('UPDATE users SET reserved = reserved + ? WHERE id = ? AND balance - reserved >= ?').run(bound, userId, bound);
      if (!held.changes) return { refused: true };
      db.prepare("INSERT INTO ask_reservations (id, user_id, bound, status, expires_at) VALUES (?, ?, ?, 'open', ?)").run(
        id,
        userId,
        bound,
        now() + reservationTtl,
      );
      return {};
    });
  }

  // Settles once: commits the cost (at most the bound) or releases. Guarded by the status.
  function settle(id, cost, answer) {
    ledger.atomic(() => {
      const row = db.prepare("SELECT user_id, bound FROM ask_reservations WHERE id = ? AND status = 'open'").get(id);
      if (!row) return;
      const charged = Math.min(cost, row.bound);
      db.prepare("UPDATE ask_reservations SET status = ?, cost = ?, answer = ? WHERE id = ? AND status = 'open'").run(
        charged > 0 ? 'committed' : 'released',
        charged,
        answer,
        id,
      );
      db.prepare('UPDATE users SET reserved = reserved - ? WHERE id = ?').run(row.bound, row.user_id);
      if (charged > 0) ledger.entry({ userId: row.user_id, amount: -charged, kind: 'ask', ref: id });
    });
  }

  // Releases reservations whose work outlived its timeout (a crashed process).
  setInterval(() => {
    for (const row of db.prepare("SELECT id FROM ask_reservations WHERE status = 'open' AND expires_at < ?").all(now())) settle(row.id, 0, null);
  }, 30_000).unref();

  app.route(
    'POST',
    '/api/ask',
    requireUser(async (ctx) => {
      const prompt = ctx.body?.prompt;
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > config.askMaxPromptChars) {
        return ctx.send(400, { error: 'invalid_prompt' });
      }
      const key = ctx.req.headers['idempotency-key'];
      if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) return ctx.send(400, { error: 'invalid_idempotency_key' });
      const id = `${ctx.user.id}:${key ?? randomUUID()}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
      ctx.res.on('close', () => {
        if (!ctx.res.writableFinished) controller.abort();
      });

      let input;
      try {
        input = await countTokens(config, { prompt, signal: controller.signal });
      } catch {
        clearTimeout(timer);
        return ctx.send(502, { error: 'assistant_unavailable' });
      }
      const bound = price(input, config.askMaxOutputTokens);
      const held = reserve(id, ctx.user.id, bound);
      if (held.existing) {
        clearTimeout(timer);
        if (held.existing.status === 'committed') return ctx.send(200, held.existing.answer ?? '');
        if (held.existing.status === 'open') return ctx.send(409, { error: 'in_progress' });
        return ctx.send(502, { error: 'assistant_unavailable' });
      }
      if (held.refused) {
        clearTimeout(timer);
        return ctx.send(402, { error: 'insufficient_balance', needed: bound });
      }

      let reportedInput = input;
      let reportedOutput = null;
      let delivered = 0;
      let answer = '';
      try {
        for await (const event of streamMessage(config, { prompt, maxTokens: config.askMaxOutputTokens, signal: controller.signal })) {
          if (event.type === 'message_start') reportedInput = event.message?.usage?.input_tokens ?? reportedInput;
          if (event.type === 'message_delta' && Number.isSafeInteger(event.usage?.output_tokens)) reportedOutput = event.usage.output_tokens;
          if (event.type === 'error') throw new Error(event.error?.type || 'stream error');
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            if (!ctx.res.headersSent) ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
            ctx.res.write(event.delta.text);
            answer += event.delta.text;
            delivered += 1;
          }
        }
        if (!ctx.res.headersSent) ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        ctx.res.end();
      } catch {
        if (!ctx.res.headersSent) ctx.send(502, { error: 'assistant_unavailable' });
        else ctx.res.end();
      } finally {
        clearTimeout(timer);
        // Nothing delivered: release. Otherwise the provider's final count, or our own count of
        // what was delivered when the stream was cut.
        const output = reportedOutput ?? delivered;
        settle(id, delivered > 0 ? price(reportedInput, output) : 0, answer);
      }
    }),
  );
}
