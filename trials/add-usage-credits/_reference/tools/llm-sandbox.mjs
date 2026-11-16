#!/usr/bin/env node
// Model provider sandbox: a local stand-in for an Anthropic-compatible Messages API.
//
//   POST /v1/messages               {"model","max_tokens","messages":[{"role","content"}],"stream":true}
//   POST /v1/messages/count_tokens  {"model","messages"} -> {"input_tokens"}
//
// One token is one whitespace-separated word. A streamed answer is the usual event sequence:
// message_start (usage.input_tokens), content_block_start, one content_block_delta per token,
// content_block_stop, message_delta (usage.output_tokens, the final count, and stop_reason),
// message_stop. An answer is 30 tokens long unless the prompt asks otherwise, and never longer
// than max_tokens (stop_reason "max_tokens").
//
// Test triggers inside the prompt text:
//   [sandbox:words=N]   answer with N tokens
//   [sandbox:slow=MS]   wait MS milliseconds between tokens
//   [sandbox:cut=K]     drop the connection after K tokens, before message_delta
//   [sandbox:error]     answer HTTP 529 {"type":"error","error":{"type":"overloaded_error"}} with no output
//   [sandbox:hang]      send message_start, then nothing more
//
//   PORT=4200 node llm-sandbox.mjs
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const countWords = (text) => (String(text).match(/\S+/g) || []).length;
const promptText = (body) =>
  (Array.isArray(body?.messages) ? body.messages : [])
    .map((m) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text ?? '').join(' ') : ''))
    .join(' ');
const trigger = (text, name) => {
  const match = new RegExp(`\\[sandbox:${name}(?:=(\\d+))?\\]`).exec(text);
  return match ? (match[1] === undefined ? true : Number(match[1])) : null;
};

export function createLlm() {
  const calls = [];
  const open = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid json' } });
      }
      const text = promptText(body);
      const inputTokens = countWords(text);
      if (req.method === 'POST' && req.url === '/v1/messages/count_tokens') return json(200, { input_tokens: inputTokens });
      if (req.method !== 'POST' || req.url !== '/v1/messages') return json(404, { type: 'error', error: { type: 'not_found_error' } });
      const maxTokens = body.max_tokens;
      if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
        return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens is required' } });
      }
      const call = { prompt: text, max_tokens: maxTokens, input_tokens: inputTokens, sent: 0, completed: false, aborted: false };
      calls.push(call);
      if (trigger(text, 'error')) {
        call.completed = true;
        return json(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
      }
      const wanted = trigger(text, 'words') ?? 30;
      const total = Math.min(wanted, maxTokens);
      const slow = trigger(text, 'slow') ?? 0;
      const cut = trigger(text, 'cut');
      const id = `msg_${randomBytes(8).toString('hex')}`;
      open.add(res);
      res.on('close', () => {
        open.delete(res);
        if (!call.completed) call.aborted = true;
      });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('message_start', {
        message: { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: inputTokens, output_tokens: 1 } },
      });
      if (trigger(text, 'hang')) return undefined;
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < total; i += 1) {
        if (res.destroyed) return undefined;
        if (cut !== null && i === cut) {
          await new Promise((resolve) => setTimeout(resolve, 50)); // let the tokens already written go out
          res.destroy();
          return undefined;
        }
        if (slow) await new Promise((resolve) => setTimeout(resolve, slow));
        if (res.destroyed) return undefined;
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: `word${i + 1} ` } });
        call.sent += 1;
      }
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: total < wanted ? 'max_tokens' : 'end_turn', stop_sequence: null }, usage: { output_tokens: total } });
      event('message_stop', {});
      call.completed = true;
      res.end();
      return undefined;
    });
  });
  return {
    server,
    calls,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
    },
    close() {
      for (const res of open) res.destroy();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const llm = createLlm();
  const port = await llm.listen(Number(process.env.PORT || 4200));
  console.log(`Model provider sandbox on http://127.0.0.1:${port}`);
}
