/**
 * LLM provider abstraction with streaming.
 * Providers: ollama | openai (any OpenAI-compatible) | anthropic | groq | gemini | custom
 * All chat() calls accept { onToken, signal, temperature, maxTokens } and return full text.
 */
const { sleep } = require('./utils');

function normalizeBase(url) { return String(url || '').replace(/\/+$/, ''); }

function providerDefaults(provider) {
  switch (provider) {
    case 'openai': return { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', needsKey: true };
    case 'anthropic': return { baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-20250514', needsKey: true };
    case 'groq': return { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', needsKey: true };
    case 'gemini': return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', needsKey: true };
    case 'custom': return { baseUrl: 'http://localhost:1234/v1', defaultModel: '', needsKey: false };
    case 'ollama':
    default: return { baseUrl: 'http://localhost:11434', defaultModel: 'llama3.1', needsKey: false };
  }
}

/** Parse an SSE byte stream into `data:` payload strings. */
async function* sseLines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim();
}

/** Unified chat completion. messages: [{role:'system'|'user'|'assistant', content}] */
async function chat(cfg, messages, opts = {}) {
  const provider = cfg.provider || 'ollama';
  const d = providerDefaults(provider);
  const baseUrl = normalizeBase(cfg.baseUrl) || d.baseUrl;
  const model = cfg.model || d.defaultModel;
  const temperature = opts.temperature ?? cfg.temperature ?? 0.3;
  const maxTokens = opts.maxTokens ?? cfg.maxTokens ?? 2048;
  const signal = opts.signal;

  if (provider === 'ollama') {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { temperature, num_predict: maxTokens } })
    });
    if (!res.ok) throw new Error(await friendlyHttp(res, 'Ollama'));
    let full = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          const tok = j.message && j.message.content;
          if (tok) { full += tok; opts.onToken && opts.onToken(tok); }
          if (j.error) throw new Error(j.error);
        } catch (e) { if (e.message && !e.message.includes('JSON')) throw e; }
      }
    }
    return full;
  }

  if (provider === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST', signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: msgs, stream: true })
    });
    if (!res.ok) throw new Error(await friendlyHttp(res, 'Anthropic'));
    let full = '';
    for await (const data of sseLines(res.body)) {
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        if (j.type === 'content_block_delta' && j.delta && j.delta.text) {
          full += j.delta.text; opts.onToken && opts.onToken(j.delta.text);
        }
        if (j.type === 'error') throw new Error(j.error && j.error.message);
      } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    }
    return full;
  }

  // OpenAI-compatible (openai | groq | gemini | custom)
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', signal, headers,
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: true })
  });
  if (!res.ok) throw new Error(await friendlyHttp(res, provider));
  let full = '';
  for await (const data of sseLines(res.body)) {
    if (!data || data === '[DONE]') continue;
    try {
      const j = JSON.parse(data);
      const tok = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
      if (tok) { full += tok; opts.onToken && opts.onToken(tok); }
    } catch (e) { /* partial line */ }
  }
  return full;
}

async function friendlyHttp(res, who) {
  let body = '';
  try { body = (await res.text()).slice(0, 400); } catch { /* noop */ }
  if (res.status === 401 || res.status === 403) return `${who}: invalid or missing API key (HTTP ${res.status}). Check Settings.`;
  if (res.status === 404) return `${who}: model or endpoint not found (HTTP 404). Check the model name / base URL.`;
  if (res.status === 429) return `${who}: rate limited (HTTP 429). Wait a moment and retry.`;
  return `${who} HTTP ${res.status}: ${body}`;
}

/** List available models for the configured provider. */
async function listModels(cfg) {
  const provider = cfg.provider || 'ollama';
  const d = providerDefaults(provider);
  const baseUrl = normalizeBase(cfg.baseUrl) || d.baseUrl;
  try {
    if (provider === 'ollama') {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return (j.models || []).map((m) => m.name);
    }
    const headers = {};
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return (j.data || []).map((m) => m.id).filter(Boolean).slice(0, 200);
  } catch (e) {
    throw new Error(`Could not list models (${e.message}). Is the provider running / is the key valid?`);
  }
}

/** Quick connectivity test. Returns { ok, message, sampleModels }. */
async function testProvider(cfg) {
  try {
    const models = await listModels(cfg);
    return { ok: true, message: `Connected. ${models.length} model(s) available.`, sampleModels: models.slice(0, 30) };
  } catch (e) {
    return { ok: false, message: e.message, sampleModels: [] };
  }
}

module.exports = { chat, listModels, testProvider, providerDefaults };
