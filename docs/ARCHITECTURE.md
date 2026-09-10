# Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Electron main process (electron/main.js)                          │
│    window · menus · dialogs · single IPC dispatch channel          │
└───────────────┬────────────────────────────────────────────────────┘
                │ ipc 'call' (method, args)  /  events 'evt' (streaming)
┌───────────────▼────────────────────────────────────────────────────┐
│  server/api.js — dispatcher (≈40 methods)                          │
│    projects · documents · chat · workflows · search · refs · data  │
└──┬─────────┬──────────┬──────────┬──────────┬───────────┬─────────┘
   │         │          │          │          │           │
┌──▼──┐  ┌───▼───┐  ┌───▼────┐ ┌───▼────┐ ┌───▼─────┐ ┌───▼──────┐
│store│  │ingest │  │embedder│ │retriever│ │scholar  │ │stats     │
│JSON │  │pdfjs  │  │local/  │ │BM25+vec │ │arXiv    │ │t/ANOVA/χ²│
│atomc│  │mammoth│  │ollama/ │ │RRF fuse │ │OpenAlex │ │OLS/α/km/ │
│files│  │xlsx   │  │openai  │ │         │ │S2/Cross │ │PCA       │
└──┬──┘  └───┬───┘  └───┬────┘ └───┬─────┘ └───┬─────┘ └───┬──────┘
   │         │          │          │           │           │
   │     chunker.js     └── llm.js ┘           │      citations.js
   │                   streaming providers     │      BibTeX/RIS + 6 styles
   └── data under <userData>/research-ai-data/ ┘
       projects/<id>/{documents,chunks,references,chats}.json + embeddings.bin
```

### Design principles

1. **Local-first.** All state is plain JSON + a flat Float32 embeddings file per project — inspectable, portable, no daemon required.
2. **Graceful AI degradation.** No LLM configured? Library, search, references and the full Data Lab still work. Embedding provider down? Automatic fallback to offline hashed embeddings.
3. **One IPC channel.** The renderer calls `researchai.call(method, ...args)`; the server streams tokens/status back through typed events — a Dify-style orchestration boundary, but in-process (no HTTP server, no ports).
4. **Testable core.** `server/` never imports Electron UI (only `store.js` touches `app.getPath`, guarded); everything runs under plain Node for CI tests.
5. **Citation integrity.** RAG answers must cite `[Sn]` ids mapped to real retrieved passages; manuscript mode may only cite library metadata or explicitly mark `[CITATION NEEDED]`.
