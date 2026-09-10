/**
 * Retrieval-Augmented Generation with citation-aware answers.
 * Answers are forced to cite retrieved chunks as [S1]..[Sn]; each source is
 * returned with document title, page and snippet so the UI can render them.
 */
const { RetrievalIndex } = require('./retriever');
const { truncate } = require('./utils');

const SYSTEM_RAG = `You are Research AI Assistant, a rigorous academic research companion for PhD scholars and faculty.
Answer the user's question using ONLY the numbered sources provided in the context when they are relevant.
Rules:
1. Cite sources inline using their bracket IDs, e.g. [S1], [S2]. Place citations right after the claim they support.
2. If the sources do not contain the answer, say so clearly and answer from general knowledge, marking it "(general knowledge, not from your library)".
3. Be precise, scholarly and concise. Use short markdown headings and bullet lists where helpful.
4. Never invent page numbers, statistics, DOIs or references that are not in the sources.`;

const SYSTEM_DIRECT = `You are Research AI Assistant, a rigorous academic research companion for PhD scholars and faculty.
Provide precise, scholarly, well-structured answers using markdown. Be honest about uncertainty.`;

/**
 * Retrieve top chunks for a query from a project.
 * @returns {Promise<Array<{id, docId, title, page, text, score}>>}
 */
async function retrieve(store, project, query, topK = 8, useVector = true) {
  const settings = store.getSettings();
  const idx = new RetrievalIndex(project, settings.embed);
  const hits = await idx.search(query, topK, useVector);
  const byId = new Map(project.docs.map((d) => [d.id, d]));
  return hits.map(({ index, score }) => {
    const c = project.chunks[index];
    const d = byId.get(c.docId) || {};
    return {
      chunkId: c.id,
      docId: c.docId,
      title: d.title || '(document)',
      authors: d.authors || [],
      year: d.year || null,
      page: c.page,
      kind: d.kind || 'document',
      text: c.text,
      score: Number(score.toFixed(4))
    };
  });
}

/** Build the numbered source block for the prompt. */
function sourcesBlock(sources, charsPerSource = 1400) {
  return sources.map((s, i) => {
    const meta = [s.title, s.year ? `(${s.year})` : '', s.page ? `p. ${s.page}` : ''].filter(Boolean).join(' ');
    return `[S${i + 1}] ${meta}\n${truncate(s.text, charsPerSource)}`;
  }).join('\n\n---\n\n');
}

/** Extract which source IDs the model actually used, e.g. [S2] -> 2. */
function usedSourceIds(answer, nSources) {
  const used = new Set();
  for (const m of String(answer || '').matchAll(/\[S(\d+)\]/g)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= nSources) used.add(n);
  }
  return [...used].sort((a, b) => a - b);
}

/**
 * Main RAG chat entry.
 * @param {object} p { store, project, messages, requestId, useRag, topK, sendEvent, signal }
 * @returns {Promise<{answer, sources, usedSourceIds}>}
 */
async function chatWithSources(p) {
  const { store, project, messages, useRag = true, topK = 8 } = p;
  const settings = store.getSettings();
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const q = lastUser ? lastUser.content : '';

  let sources = [];
  if (useRag && q) {
    p.sendEvent && p.sendEvent('chat:status', { requestId: p.requestId, status: 'Searching your library…' });
    sources = await retrieve(store, project, q, topK, true);
  }

  const history = messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 12000) }));
  const sys = useRag && sources.length ? SYSTEM_RAG : SYSTEM_DIRECT;
  const content = useRag && sources.length
    ? `Context sources from the user's research library:\n\n${sourcesBlock(sources)}\n\nQuestion/task: ${q}`
    : q;

  const llmMessages = [{ role: 'system', content: sys }, ...history.slice(0, -1), { role: 'user', content }];

  p.sendEvent && p.sendEvent('chat:status', { requestId: p.requestId, status: 'Thinking…' });
  const answer = await require('./llm').chat(settings.llm, llmMessages, {
    onToken: (tok) => p.sendEvent && p.sendEvent('chat:token', { requestId: p.requestId, delta: tok }),
    signal: p.signal,
    temperature: settings.llm.temperature,
    maxTokens: settings.llm.maxTokens
  });

  return { answer, sources, usedSourceIds: usedSourceIds(answer, sources.length) };
}

/**
 * Corpus briefing used by workflows (map step): compact per-doc summaries.
 * Uses doc-level info + first chunks to keep it fast.
 */
function corpusBrief(project, maxDocs = 60) {
  const docs = project.docs.filter((d) => d.status === 'ready').slice(0, maxDocs);
  return docs.map((d) => {
    const firstChunks = project.chunks.filter((c) => c.docId === d.id).slice(0, 2).map((c) => c.text).join(' ');
    return `- "${d.title}" (${d.year || 'n.d.'})${d.authors && d.authors.length ? ` by ${d.authors.slice(0, 3).join(', ')}` : ''} [${d.kind}]\n  Abstract/extract: ${truncate(firstChunks, 600)}`;
  }).join('\n');
}

module.exports = { retrieve, sourcesBlock, usedSourceIds, chatWithSources, corpusBrief, SYSTEM_RAG, SYSTEM_DIRECT };
