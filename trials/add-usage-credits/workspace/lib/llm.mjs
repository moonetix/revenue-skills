// Client for the model provider's Messages API (Anthropic-compatible). See docs/llm-provider.md.
// streamMessage() yields the provider's stream events as parsed objects.
export async function* streamMessage(config, { prompt, maxTokens, signal }) {
  const res = await fetch(`${config.llmUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.llmKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.llmModel, max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] }),
    signal,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw Object.assign(new Error(`model provider: HTTP ${res.status}`), { status: res.status, error: error?.error });
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split('\n').find((line) => line.startsWith('data: '));
      if (data) yield JSON.parse(data.slice(6));
    }
  }
}

export async function countTokens(config, { prompt, signal }) {
  const res = await fetch(`${config.llmUrl}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.llmKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.llmModel, messages: [{ role: 'user', content: prompt }] }),
    signal,
  });
  if (!res.ok) throw new Error(`model provider: HTTP ${res.status}`);
  return (await res.json()).input_tokens;
}
