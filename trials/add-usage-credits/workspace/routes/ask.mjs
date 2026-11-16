import { requireUser } from '../lib/http.mjs';
import { streamMessage } from '../lib/llm.mjs';

// The assistant: streams the model's answer to the client as plain text.
export default function askRoutes(app) {
  const { config } = app;

  app.route(
    'POST',
    '/api/ask',
    requireUser(async (ctx) => {
      const prompt = ctx.body?.prompt;
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > config.askMaxPromptChars) {
        return ctx.send(400, { error: 'invalid_prompt' });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
      ctx.res.on('close', () => controller.abort());
      try {
        for await (const event of streamMessage(config, { prompt, maxTokens: config.askMaxOutputTokens, signal: controller.signal })) {
          if (!ctx.res.headersSent) ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') ctx.res.write(event.delta.text);
        }
        if (!ctx.res.headersSent) ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        ctx.res.end();
      } catch {
        if (!ctx.res.headersSent) return ctx.send(502, { error: 'assistant_unavailable' });
        ctx.res.end();
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
