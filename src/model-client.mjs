export const defaultModel = 'qwen3:0.6b';

export function createModelClient({
  baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model = process.env.LLM_MODEL || defaultModel,
  timeoutMs = 120_000,
} = {}) {
  return async function complete(messages, tools = [], {format, temperature} = {}) {
    let response;
    try {
      response = await fetch(new URL('/api/chat', baseUrl), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model, messages, tools, stream: false, think: false,
          ...(format ? {format} : {}),
          ...(temperature === undefined ? {} : {options: {temperature}}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error('Ollama took too long to answer. Try a shorter request or a smaller model.', {cause: error});
      }
      throw new Error('Could not reach Ollama. Check that it is running and OLLAMA_URL is correct.', {cause: error});
    }
    if (!response.ok) {
      const hint = response.status === 404 ? ' Check the model name and run ollama pull for that model.' : '';
      throw new Error(`Ollama returned HTTP ${response.status}.${hint}`);
    }

    const payload = await response.json().catch(error => {
      throw new Error('Ollama returned invalid JSON.', {cause: error});
    });
    const message = payload?.message;
    const calls = message?.tool_calls ?? [];
    if (payload?.done !== true || typeof message?.content !== 'string' || !Array.isArray(calls)) {
      throw new Error('Ollama returned an incomplete or malformed chat response.');
    }
    const toolCalls = calls.map(item => {
      const call = item?.function;
      if (typeof call?.name !== 'string' || !call.name.trim()
          || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
        throw new Error('Ollama returned a malformed tool call.');
      }
      return {name: call.name, arguments: call.arguments};
    });
    return {text: message.content.trim(), toolCalls};
  };
}

export const complete = createModelClient();
