/**
 * JSON-file storage layer.
 * Data lives under <userData>/research-ai-data (override with RESEARCHAI_DATA env var).
 *
 * Layout:
 *   settings.json                     app settings (providers, keys, prefs)
 *   projects.json                     project index
 *   projects/<id>/project.json        meta + embedding index info
 *   projects/<id>/documents.json      ingested documents
 *   projects/<id>/chunks.json         text chunks (embeddings stored separately)
 *   projects/<id>/embeddings.bin      Float32 embedding rows
 *   projects/<id>/references.json     reference library
 *   projects/<id>/chats.json          saved chat threads
 */
const fs = require('fs');
const path = require('path');
let app = null;
try { app = require('electron').app; } catch { /* running outside Electron (tests/CLI) */ }
const { uid, nowISO } = require('./utils');

function dataRoot() {
  if (process.env.RESEARCHAI_DATA) return process.env.RESEARCHAI_DATA;
  try { return path.join(app.getPath('userData'), 'research-ai-data'); }
  catch { return path.join(process.cwd(), 'research-ai-data'); }
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

/** Atomic write: temp file + rename. */
function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const DEFAULT_SETTINGS = {
  llm: {
    provider: 'ollama',              // ollama | openai | anthropic | groq | gemini | custom
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    model: '',
    temperature: 0.3,
    maxTokens: 2048
  },
  embed: {
    provider: 'local',               // local | ollama | openai
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    model: ''                        // e.g. nomic-embed-text (ollama) / text-embedding-3-small (openai)
  },
  scholar: { sources: ['arxiv', 'openalex', 'semantic_scholar', 'crossref'], limit: 12 },
  prefs: { citationStyle: 'apa', theme: 'dark' }
};

function mergeSettings(saved) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const k of Object.keys(saved || {})) {
    if (typeof saved[k] === 'object' && saved[k] && !Array.isArray(saved[k])) Object.assign(s[k] || (s[k] = {}), saved[k]);
    else s[k] = saved[k];
  }
  return s;
}

class Store {
  constructor() {
    this.root = dataRoot();
    ensureDir(this.root);
    ensureDir(path.join(this.root, 'projects'));
    this.settingsFile = path.join(this.root, 'settings.json');
    this.projectsFile = path.join(this.root, 'projects.json');
    this._cache = new Map(); // projectId -> project data bundle
  }

  // ---------- settings ----------
  getSettings() { return mergeSettings(readJSON(this.settingsFile, {})); }
  saveSettings(patch) {
    const merged = mergeSettings({ ...this.getSettings(), ...patch });
    writeJSON(this.settingsFile, merged);
    return merged;
  }

  // ---------- projects ----------
  listProjects() {
    return readJSON(this.projectsFile, []);
  }
  saveProjectIndex(list) { writeJSON(this.projectsFile, list); }

  createProject(name, description = '', researchQuestion = '') {
    const id = uid('prj');
    const meta = {
      id, name: name || 'Untitled Project', description, researchQuestion,
      createdAt: nowISO(), updatedAt: nowISO(),
      embedding: { provider: '', model: '', dim: 0, count: 0 }
    };
    const dir = path.join(this.root, 'projects', id);
    ensureDir(dir);
    writeJSON(path.join(dir, 'project.json'), meta);
    writeJSON(path.join(dir, 'documents.json'), []);
    writeJSON(path.join(dir, 'chunks.json'), []);
    writeJSON(path.join(dir, 'references.json'), []);
    writeJSON(path.join(dir, 'chats.json'), []);
    const list = this.listProjects();
    list.unshift({ id, name: meta.name, description, createdAt: meta.createdAt, updatedAt: meta.updatedAt, docCount: 0 });
    this.saveProjectIndex(list);
    return meta;
  }

  deleteProject(id) {
    const list = this.listProjects().filter((p) => p.id !== id);
    this.saveProjectIndex(list);
    this._cache.delete(id);
    fs.rmSync(path.join(this.root, 'projects', id), { recursive: true, force: true });
  }

  updateProjectMeta(id, patch) {
    const meta = this.projectMeta(id);
    Object.assign(meta, patch, { updatedAt: nowISO() });
    writeJSON(path.join(this.projectDir(id), 'project.json'), meta);
    const list = this.listProjects();
    const i = list.findIndex((p) => p.id === id);
    if (i !== -1) { list[i].name = meta.name; list[i].description = meta.description; list[i].updatedAt = meta.updatedAt; }
    this.saveProjectIndex(list);
    return meta;
  }

  projectDir(id) { return path.join(this.root, 'projects', id); }
  projectMeta(id) { return readJSON(path.join(this.projectDir(id), 'project.json'), null); }

  /** Load (and cache) the full working set for a project. */
  loadProject(id) {
    if (this._cache.has(id)) return this._cache.get(id);
    const dir = this.projectDir(id);
    const meta = this.projectMeta(id);
    if (!meta) throw new Error(`Project ${id} not found`);
    const bundle = {
      id,
      meta,
      dir,
      docs: readJSON(path.join(dir, 'documents.json'), []),
      chunks: readJSON(path.join(dir, 'chunks.json'), []),
      refs: readJSON(path.join(dir, 'references.json'), []),
      chats: readJSON(path.join(dir, 'chats.json'), []),
      embeddings: null,       // Float32Array of dim*count, lazily loaded
      embDirty: false,
      chunkDirty: false,
      docDirty: false,
      refDirty: false,
      chatDirty: false
    };
    this._cache.set(id, bundle);
    this.loadEmbeddings(bundle);   // lazy but eager enough: vectors ready for retrieval
    if (this._cache.size > 6) { // simple LRU-ish eviction
      const first = this._cache.keys().next().value;
      if (first !== id) this.flushProject(first);
      this._cache.delete(first);
    }
    return bundle;
  }

  embFile(id) { return path.join(this.projectDir(id), 'embeddings.bin'); }

  loadEmbeddings(bundle) {
    const { dim, count } = bundle.meta.embedding;
    if (!dim || !count) { bundle.embeddings = new Float32Array(0); return bundle.embeddings; }
    try {
      const buf = fs.readFileSync(this.embFile(bundle.id));
      bundle.embeddings = new Float32Array(buf.buffer, buf.byteOffset, Math.min(dim * count, buf.byteLength / 4));
    } catch { bundle.embeddings = new Float32Array(0); }
    return bundle.embeddings;
  }

  saveProject(bundle) {
    if (bundle.chunkDirty) writeJSON(path.join(bundle.dir, 'chunks.json'), bundle.chunks);
    if (bundle.docDirty) writeJSON(path.join(bundle.dir, 'documents.json'), bundle.docs);
    if (bundle.refDirty) writeJSON(path.join(bundle.dir, 'references.json'), bundle.refs);
    if (bundle.chatDirty) writeJSON(path.join(bundle.dir, 'chats.json'), bundle.chats);
    if (bundle.embDirty && bundle.embeddings && bundle.embeddings.length) {
      ensureDir(bundle.dir);
      fs.writeFileSync(this.embFile(bundle.id), Buffer.from(bundle.embeddings.buffer, bundle.embeddings.byteOffset, bundle.embeddings.byteLength));
    }
    if (bundle.meta) writeJSON(path.join(bundle.dir, 'project.json'), bundle.meta);
    const list = this.listProjects();
    const i = list.findIndex((p) => p.id === bundle.id);
    if (i !== -1) {
      list[i].name = bundle.meta.name;
      list[i].docCount = bundle.docs.length;
      list[i].updatedAt = bundle.meta.updatedAt;
      this.saveProjectIndex(list);
    }
    bundle.chunkDirty = bundle.docDirty = bundle.refDirty = bundle.chatDirty = bundle.embDirty = false;
  }

  flushProject(id) {
    const b = this._cache.get(id);
    if (b) this.saveProject(b);
  }

  flushAll() { for (const id of this._cache.keys()) this.flushProject(id); }
}

module.exports = { Store, dataRoot, DEFAULT_SETTINGS };
