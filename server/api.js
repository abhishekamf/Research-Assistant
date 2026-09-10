/**
 * API dispatcher: every renderer call flows through dispatch(method, args).
 * Also owns background jobs (ingestion, embedding) and event streaming.
 */
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { uid, DOC_EXTS, extOf, truncate } = require('./utils');
const { ingestFile } = require('./ingest');
const { embedTexts } = require('./embeddings');
const { RetrievalIndex } = require('./retriever');
const rag = require('./rag');
const llm = require('./llm');
const scholar = require('./scholar');
const citations = require('./citations');
const workflows = require('./workflows');
const stats = require('./stats');

const store = new Store();
let sendEvent = () => {};
const aborts = new Map(); // requestId -> AbortController

function setEventSender(fn) { sendEvent = fn; }

function getProject(id) { return store.loadProject(id); }

/** Re-embed all chunks of a project (background). */
async function reindexProject(project) {
  const settings = store.getSettings();
  const targets = project.chunks.filter((c) => c.text && c.text.length > 20);
  if (!targets.length) return { embedded: 0 };
  sendEvent('index:progress', { projectId: project.id, done: 0, total: targets.length });
  const texts = targets.map((c) => c.text);
  let result;
  try {
    result = await embedTexts(texts, settings.embed, (done, total) => {
      sendEvent('index:progress', { projectId: project.id, done, total });
    });
  } catch (e) {
    // graceful fallback to offline local embeddings
    sendEvent('app:log', { message: `Embedding provider failed (${e.message}); using offline local embeddings.` });
    result = await embedTexts(texts, { provider: 'local' });
  }
  project.embeddings = concatFloat32(result.vectors, result.dim);
  project.chunks.forEach((c, i) => { c.ei = i; });
  project.meta.embedding = { provider: result.provider, model: result.model, dim: result.dim, count: result.vectors.length };
  project.embDirty = true;
  project.chunkDirty = true;
  store.saveProject(project);
  project.docs.forEach((d) => { d.status = 'ready'; });
  project.docDirty = true;
  store.saveProject(project);
  sendEvent('index:done', { projectId: project.id, count: result.vectors.length });
  return { embedded: result.vectors.length, provider: result.provider, model: result.model, dim: result.dim };
}

function concatFloat32(vectors, dim) {
  const out = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => out.set(v, i * dim));
  return out;
}

// ---------------------------------------------------------------- handlers
const handlers = {
  // ---- system / settings ----
  ping: () => ({ pong: true, version: '1.0.0', dataDir: require('./store').dataRoot() }),
  getSettings: () => store.getSettings(),
  saveSettings: (patch) => {
    const s = store.saveSettings(patch);
    return s;
  },
  listModels: async (cfg) => llm.listModels(cfg),
  testLLM: async (cfg) => llm.testProvider(cfg),
  testEmbed: async (cfg) => {
    try {
      const r = await embedTexts(['hello world'], cfg);
      return { ok: true, dim: r.dim, provider: r.provider, model: r.model, message: `Embeddings OK (dim=${r.dim})` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
  openDataFolder: async () => {
    const { shell } = require('electron');
    shell.openPath(require('./store').dataRoot());
    return true;
  },

  // ---- projects ----
  listProjects: () => store.listProjects(),
  createProject: (name, description, researchQuestion) => store.createProject(name, description, researchQuestion),
  deleteProject: (id) => { store.deleteProject(id); return true; },
  updateProject: (id, patch) => store.updateProjectMeta(id, patch),
  getProject: (id) => {
    const p = getProject(id);
    return {
      meta: p.meta,
      docs: p.docs,
      refs: p.refs,
      chats: p.chats,
      chunkCount: p.chunks.length,
      embedded: p.meta.embedding && p.meta.embedding.count || 0
    };
  },
  setResearchQuestion: (id, rq) => {
    store.updateProjectMeta(id, { researchQuestion: rq });
    return true;
  },

  // ---- documents ----
  pickFiles: async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Research documents', extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'bib', 'ris'] }]
    });
    return r.canceled ? [] : r.filePaths;
  },
  addFiles: async (projectId, filePaths) => {
    const project = getProject(projectId);
    const added = [];
    let newRefs = [];
    for (const fp of filePaths) {
      const ext = extOf(fp);
      if (!DOC_EXTS.includes(ext)) { sendEvent('doc:status', { docId: fp, status: 'error', error: `Unsupported file type: ${ext}` }); continue; }
      try {
        sendEvent('doc:status', { docId: fp, status: 'parsing', title: path.basename(fp) });
        const { doc, chunks, refs } = await ingestFile(fp);
        // de-dup by title+filename
        if (project.docs.some((d) => d.fileName === doc.fileName && d.bytes === doc.bytes)) {
          sendEvent('doc:status', { docId: fp, status: 'duplicate', title: doc.title });
          continue;
        }
        project.docs.push(doc);
        for (const c of chunks) {
          project.chunks.push({ id: uid('chk'), docId: doc.id, page: c.page, text: c.text, ei: -1 });
        }
        newRefs.push(...refs);
        added.push(doc);
        project.docDirty = project.chunkDirty = project.refDirty = true;
        sendEvent('doc:status', { docId: doc.id, status: 'parsed', title: doc.title, chunks: chunks.length });
      } catch (e) {
        sendEvent('doc:status', { docId: fp, status: 'error', error: e.message, title: path.basename(fp) });
      }
    }
    if (newRefs.length) project.refs.unshift(...newRefs);
    store.saveProject(project);
    sendEvent('library:changed', { projectId });
    // re-index embeddings in the background (don't await)
    if (added.length) {
      reindexProject(project).catch((e) => sendEvent('app:log', { message: `Indexing error: ${e.message}` }));
    }
    return { added: added.map((d) => ({ id: d.id, title: d.title, kind: d.kind, chunks: 0 })) };
  },
  importPdfFromUrl: async (projectId, url, title) => {
    const project = getProject(projectId);
    const tmp = path.join(require('os').tmpdir(), `researchai_${uid('dl')}.pdf`);
    const buf = await scholar.getBinary(url);
    fs.writeFileSync(tmp, buf);
    const r = await ingestFile(tmp);
    r.doc.title = title || r.doc.title;
    r.doc.filePath = url;
    project.docs.push(r.doc);
    for (const c of r.chunks) project.chunks.push({ id: uid('chk'), docId: r.doc.id, page: c.page, text: c.text, ei: -1 });
    project.docDirty = project.chunkDirty = true;
    store.saveProject(project);
    sendEvent('library:changed', { projectId });
    reindexProject(project).catch(() => {});
    return { id: r.doc.id, title: r.doc.title };
  },
  listDocuments: (projectId) => getProject(projectId).docs,
  deleteDocument: (projectId, docId) => {
    const project = getProject(projectId);
    project.docs = project.docs.filter((d) => d.id !== docId);
    project.chunks = project.chunks.filter((c) => c.docId !== docId);
    project.docDirty = project.chunkDirty = true;
    store.saveProject(project);
    sendEvent('library:changed', { projectId });
    return true;
  },
  reindexDocument: (projectId, docId) => {
    const project = getProject(projectId);
    const doc = project.docs.find((d) => d.id === docId);
    if (!doc) throw new Error('Document not found');
    sendEvent('library:changed', { projectId });
    return reindexProject(project);
  },
  getDocument: (projectId, docId) => {
    const project = getProject(projectId);
    const doc = project.docs.find((d) => d.id === docId);
    if (!doc) throw new Error('Document not found');
    const chunks = project.chunks.filter((c) => c.docId === docId).map((c) => ({ id: c.id, page: c.page, text: truncate(c.text, 400) }));
    return { doc, chunks };
  },
  searchLibrary: (projectId, query, k = 20) => {
    const project = getProject(projectId);
    const idx = new RetrievalIndex(project, store.getSettings().embed);
    const hits = idx.bm25Scores(query);
    const top = idx.topK(hits, k);
    const byId = new Map(project.docs.map((d) => [d.id, d]));
    return top.map((i) => {
      const c = project.chunks[i];
      const d = byId.get(c.docId) || {};
      return { docId: c.docId, title: d.title, page: c.page, snippet: truncate(c.text, 260), score: +hits[i].toFixed(3) };
    });
  },

  // ---- chat (RAG) ----
  chat: async (p) => {
    const { projectId, messages, useRag, topK, requestId } = p;
    const project = getProject(projectId);
    const ctrl = new AbortController();
    aborts.set(requestId, ctrl);
    try {
      const r = await rag.chatWithSources({
        store, project, messages, useRag, topK, requestId, signal: ctrl.signal, sendEvent
      });
      // persist thread
      project.chats = project.chats || [];
      project.chatDirty = true;
      store.saveProject(project);
      return r;
    } finally { aborts.delete(requestId); }
  },
  cancel: (requestId) => {
    const c = aborts.get(requestId);
    if (c) c.abort();
    return true;
  },

  // ---- workflows ----
  workflow: async (p) => {
    const { projectId, kind, params = {}, requestId } = p;
    const project = getProject(projectId);
    const ctrl = new AbortController();
    aborts.set(requestId, ctrl);
    const ctx = { requestId, signal: ctrl.signal, sendEvent };
    try {
      switch (kind) {
        case 'literatureMap': return await workflows.literatureMap(store, project, ctx);
        case 'researchGaps': return await workflows.researchGaps(store, project, ctx, params.researchQuestion);
        case 'summarize': return await workflows.summarizeDocs(store, project, ctx, params);
        case 'methodology': return await workflows.methodologySuggestions(store, project, ctx, params.researchQuestion, params.design);
        case 'manuscript': return await workflows.manuscriptAssist(store, project, ctx, params);
        case 'interpret': return await workflows.interpretAnalysis(store, project, ctx, params);
        default: throw new Error(`Unknown workflow: ${kind}`);
      }
    } finally { aborts.delete(requestId); }
  },

  // ---- academic search ----
  searchAcademic: async (query, opts) => scholar.searchAcademic(query, opts || {}),
  importPaper: async (projectId, paper) => {
    const project = getProject(projectId);
    const ref = {
      id: uid('ref'), type: paper.venue && /conf|proc/i.test(paper.venue) ? 'inproceedings' : 'article',
      key: '', title: paper.title, authors: paper.authors || [], year: paper.year || null,
      venue: paper.venue || '', volume: '', issue: '', pages: '', doi: paper.doi || '', url: paper.url || '',
      publisher: '', address: '', abstract: paper.abstract || '', keywords: '',
      addedAt: new Date().toISOString(), origin: `discover:${paper.source}`
    };
    project.refs.unshift(ref);
    project.refDirty = true;
    let importedDoc = null;
    if (paper.pdfUrl && /\.pdf(\?|$)/i.test(paper.pdfUrl)) {
      try {
        sendEvent('doc:status', { docId: paper.pdfUrl, status: 'downloading', title: paper.title });
        const r = await handlers.importPdfFromUrl(projectId, paper.pdfUrl, paper.title);
        importedDoc = r;
      } catch (e) {
        sendEvent('app:log', { message: `PDF import failed: ${e.message} (reference saved anyway)` });
      }
    }
    store.saveProject(project);
    sendEvent('library:changed', { projectId });
    return { ref, importedDoc };
  },

  // ---- references ----
  listReferences: (projectId) => getProject(projectId).refs,
  addReference: (projectId, ref) => {
    const project = getProject(projectId);
    const r = {
      id: uid('ref'), type: ref.type || 'article', key: ref.key || '', title: ref.title || '(untitled)',
      authors: ref.authors || [], year: ref.year || null, venue: ref.venue || '', volume: ref.volume || '',
      issue: ref.issue || '', pages: ref.pages || '', doi: ref.doi || '', url: ref.url || '',
      publisher: ref.publisher || '', address: '', abstract: ref.abstract || '', keywords: ref.keywords || '',
      addedAt: new Date().toISOString(), origin: 'manual'
    };
    project.refs.unshift(r);
    project.refDirty = true;
    store.saveProject(project);
    return r;
  },
  importReferencesFile: (projectId, filePath) => {
    const project = getProject(projectId);
    const text = fs.readFileSync(filePath, 'utf8');
    const refs = /\.bib$/i.test(filePath) ? citations.parseBibtex(text) : citations.parseRis(text);
    project.refs.unshift(...refs);
    project.refDirty = true;
    store.saveProject(project);
    return { count: refs.length };
  },
  importReferencesText: (projectId, text, format) => {
    const project = getProject(projectId);
    const refs = format === 'ris' ? citations.parseRis(text) : citations.parseBibtex(text);
    project.refs.unshift(...refs);
    project.refDirty = true;
    store.saveProject(project);
    return { count: refs.length };
  },
  deleteReference: (projectId, refId) => {
    const project = getProject(projectId);
    project.refs = project.refs.filter((r) => r.id !== refId);
    project.refDirty = true;
    store.saveProject(project);
    return true;
  },
  formatReferences: (projectId, style) => {
    const refs = getProject(projectId).refs;
    return refs.map((r) => ({ id: r.id, text: citations.formatRef(r, style), bibtex: citations.refToBibtex(r), inText: citations.inTextCitation(r, style) }));
  },
  exportReferences: async (projectId, format) => {
    const { dialog } = require('electron');
    const refs = getProject(projectId).refs;
    let content, ext, filters;
    if (format === 'bibtex') {
      content = refs.map((r) => citations.refToBibtex(r)).join('\n\n');
      ext = 'bib'; filters = [{ name: 'BibTeX', extensions: ['bib'] }];
    } else if (format === 'ris') {
      content = refs.map((r) => citations.refToRis(r)).join('\n');
      ext = 'ris'; filters = [{ name: 'RIS', extensions: ['ris'] }];
    } else {
      content = refs.map((r) => citations.formatRef(r, format)).join('\n\n');
      ext = 'txt'; filters = [{ name: 'Text', extensions: ['txt'] }];
    }
    const p = await dialog.showSaveDialog({ defaultPath: `references.${ext}`, filters });
    if (!p.canceled && p.filePath) { fs.writeFileSync(p.filePath, content); return { saved: p.filePath, count: refs.length }; }
    return { saved: null };
  },

  // ---- data lab ----
  loadTable: (filePath) => {
    const t = stats.loadTable(filePath);
    return {
      headers: t.headers, rowCount: t.rowCount,
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, missing: c.missing, unique: c.unique, levels: (c.levels || []).slice(0, 25), mean: c.mean, sd: c.sd, min: c.min, max: c.max }))
    };
  },
  analyze: (filePath, analysis, params) => stats.runAnalysis(stats.loadTable(filePath), analysis, params || {}),

  // ---- export helpers ----
  saveTextFile: async (defaultName, content, filters) => {
    const { dialog } = require('electron');
    const p = await dialog.showSaveDialog({ defaultPath: defaultName, filters: filters || [{ name: 'Markdown', extensions: ['md'] }] });
    if (!p.canceled && p.filePath) { fs.writeFileSync(p.filePath, content); return { saved: p.filePath }; }
    return { saved: null };
  },
  readFileText: (filePath) => fs.readFileSync(filePath, 'utf8')
};

/** Dispatch a method call from the renderer. */
async function dispatch(method, args) {
  const fn = handlers[method];
  if (!fn) throw new Error(`Unknown API method: ${method}`);
  return fn(...args);
}

module.exports = { dispatch, setEventSender, store };
