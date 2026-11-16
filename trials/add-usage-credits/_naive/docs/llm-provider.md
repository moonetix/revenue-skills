# Model provider (the parts Coinbarn uses)

The provider speaks the Anthropic Messages API. Base URL from `LLM_API_URL`, key from `LLM_API_KEY` (header `x-api-key`), model from `LLM_MODEL`.

## Create a message, streamed

`POST /v1/messages` with `{"model", "max_tokens", "stream": true, "messages": [{"role": "user", "content": "..."}]}`. `max_tokens` is required and caps the answer.

The answer arrives as server-sent events:

| Event | Carries |
| --- | --- |
| `message_start` | `message.usage.input_tokens`: the prompt's tokens |
| `content_block_start`, `content_block_delta`, `content_block_stop` | The text, in `delta.text` of each `text_delta` |
| `message_delta` | `usage.output_tokens`: the answer's tokens so far (the last one is the total), and `delta.stop_reason` (`end_turn`, `max_tokens`) |
| `message_stop` | The end of the stream |
| `error` | An error in the middle of a stream, for example `overloaded_error` |

An error before the stream starts is an HTTP status with `{"type": "error", "error": {"type": "...", "message": "..."}}`, for example 529 `overloaded_error`. A connection can also drop in the middle of a stream; then no `message_delta` arrives.

## Count tokens

`POST /v1/messages/count_tokens` with `{"model", "messages"}` returns `{"input_tokens"}` for that prompt, without calling the model.

## Sandbox

`node tools/llm-sandbox.mjs` runs the API above on port 4200. In the sandbox one token is one word, and an answer has 30 tokens. Test triggers in the prompt text: `[sandbox:words=N]` answers with N tokens, `[sandbox:slow=MS]` waits MS milliseconds between tokens, `[sandbox:cut=K]` drops the connection after K tokens, `[sandbox:error]` answers 529 before any output, `[sandbox:hang]` starts the stream and then sends nothing.
