import { randomUUID } from 'node:crypto';
import { requireUser } from '../lib/http.mjs';
import { streamMessage } from '../lib/llm.mjs';

export default function askRoutes(app) {
  const { db, ledger, config } = app;

  app.route(
    'POST',
    '/api/ask',
    requireUser(async (ctx) => {
      const prompt = ctx.body?.prompt;
      if (typeof prompt !== 'string' || !prompt.trim()) return ctx.send(400, { error: 'invalid_prompt' });
      const { balance } = db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.user.id);
      if (balance < 1) return ctx.send(402, { error: 'insufficient_balance' });
      const maxTokens = ctx.body?.max_tokens ?? config.askMaxOutputTokens;
      let input = 0;
      let output = 0;
      try {
        for await (const event of streamMessage(config, { prompt, maxTokens })) {
          if (event.type === 'message_start') input = event.message.usage.input_tokens;
          if (event.type === 'message_delta') output = event.usage.output_tokens;
          if (event.type === 'content_block_delta') {
            if (!ctx.res.headersSent) ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
            ctx.res.write(event.delta.text);
          }
        }
        ctx.res.end();
      } catch {
        if (!ctx.res.headersSent) return ctx.send(502, { error: 'assistant_unavailable' });
        ctx.res.end();
      }
      const cost = Math.ceil(input / 100 + output / 10);
      if (cost > 0) ledger.atomic(() => ledger.entry({ userId: ctx.user.id, amount: -cost, kind: 'ask', ref: randomUUID(), allowDebt: true }));
    }),
  );
}
