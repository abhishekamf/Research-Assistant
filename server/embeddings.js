/**
 * Embedding providers:
 *  - local     : offline hashed bag-of-ngrams vectors (always available, no network)
 *  - ollama    : Ollama /api/embed (batch) with /api/embeddings fallback
 *  - openai    : any OpenAI-compatible /v1/embeddings endpoint (OpenAI, LM Studio, OpenRouter, ...)
 */
const { contentTokens, fnv1a, sleep } = require('./utils');

const LOCAL_DIM = 512;

/** Deterministic offline embedding: hashed unigrams+bigrams, sublinear TF, L2-normalized. */
function localEmbed(text, dim = LOCAL_DIM) {
  const toks = contentTokens(text).slice(0, 4000);
  const counts = new Map();
  const bump = (t) => counts.set(t, (counts.get(t) || 0) + 1);
  for (let i = 0; i < toks.length; i++) {
    bump(toks[i]);
    if (i + 1 < toks.length) bump(toks[i] + '_' + toks[i + 1]);
  }
  const v = new Float32Array(dim);
  for (const [term, tf] of counts) {
    const h = fnv1a(term);
    const idx = h % dim;
    const sign = (fnv1a(term, 0x9dc5) & 1) ? 1 : -1;
    v[idx] += sign * (1 + Math.log(tf));
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

async function fetchWithRetry(url, opts, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        await sleep(800 * Math.pow(2, i));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(600 * (i + 1));
    }
  }
  throw lastErr || new Error('Request failed');
}

function normalizeBase(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

async function ollamaEmbed(texts, cfg) {
  const base = normalizeBase(cfg.baseUrl) || 'http://localhost:11434';
  const model = cfg.model || 'nomic-embed-text';
  // Try batch endpoint first (Ollama >= 0.2.6)
  try {
    const res = await fetchWithRetry(`${base}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts })
    });
    const data = await res.json();
    if (Array.isArray(data.embeddings)) return { vectors: data.embeddings.map((a) => Float32Array.from(a)), model };
  } catch { /* fall through */ }
  const vectors = [];
  for (const t of texts) {
    const res = await fetchWithRetry(`${base}/api/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: t.slice(0, 8000) })
    });
    const data = await res.json();
    if (!data.embedding) throw new Error('Ollama returned no embedding');
    vectors.push(Float32Array.from(data.embedding));
  }
  return { vectors, model };
}

async function openaiEmbed(texts, cfg) {
  let base = normalizeBase(cfg.baseUrl);
  if (!base || base.includes('11434') || cfg.provider === 'openai') base = 'https://api.openai.com/v1';
  if (!/\/v\d+$/.test(base)) base += '/v1';
  const model = cfg.model || 'text-embedding-3-small';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const vectors = [];
  const BATCH = 48;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map((t) => String(t).slice(0, 30000));
    const res = await fetchWithRetry(`${base}/embeddings`, {
      method: 'POST', headers, body: JSON.stringify({ model, input: slice })
    });
    const data = await res.json();
    const sorted = (data.data || []).sort((a, b) => a.index - b.index);
    for (const d of sorted) vectors.push(Float32Array.from(d.embedding));
  }
  return { vectors, model };
}

/**
 * Embed a list of texts. Returns { vectors: Float32Array[], provider, model, dim }.
 * onProgress(done, total) optional.
 */
async function embedTexts(texts, cfg, onProgress) {
  const provider = cfg.provider || 'local';
  let vectors, model = provider;
  if (provider === 'local') {
    vectors = texts.map((t) => localEmbed(t));
    model = 'local-hash-512';
  } else if (provider === 'ollama') {
    vectors = [];
    const CH = 32;
    for (let i = 0; i < texts.length; i += CH) {
      const r = await ollamaEmbed(texts.slice(i, i + CH), cfg);
      vectors.push(...r.vectors); model = r.model;
      if (onProgress) onProgress(Math.min(i + CH, texts.length), texts.length);
    }
  } else { // openai-compatible
    vectors = [];
    const CH = 48;
    for (let i = 0; i < texts.length; i += CH) {
      const r = await openaiEmbed(texts.slice(i, i + CH), cfg);
      vectors.push(...r.vectors); model = r.model;
      if (onProgress) onProgress(Math.min(i + CH, texts.length), texts.length);
    }
  }
  const dim = vectors.length ? vectors[0].length : (provider === 'local' ? LOCAL_DIM : 0);
  return { vectors, provider, model, dim };
}

async function embedOne(text, cfg) {
  const r = await embedTexts([text], cfg);
  return r.vectors[0] || null;
}

/** Cosine similarity for L2-normalized vectors (dot product). */
function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

module.exports = { embedTexts, embedOne, localEmbed, cosine, LOCAL_DIM };
