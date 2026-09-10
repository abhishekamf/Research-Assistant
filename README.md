<div align="center">

<img src="resources/banner.png" alt="Research AI Assistant" width="100%" />

# 🎓 Research AI Assistant

**An AI-powered research companion for PhD scholars, faculty and universities**

Literature mapping · Research gaps · Citation-aware summaries · Methodology suggestions · Data analysis · Manuscript assistance · Reference management

`Electron` · `Local-first RAG` · `Ollama or any LLM API` · `MIT License`

[About](#-about) · [Features](#-features) · [Install & Run](#-install--run-macbook) · [Build Distributables](#-build-macos--windows-distributables) · [User Guide](docs/USER_GUIDE.md)

</div>

---

## 📖 About

**Research AI Assistant** began as a personal need: a PhD scholar's workflow is scattered across reference managers, chatbots, PDF annotators, statistics software and half-filled notebooks. This project brings the *best concepts* from four amazing open-source projects into one focused desktop app for researchers:

| Inspired by | Concept adopted |
|---|---|
| [Dify](https://github.com/langgenius/dify) | Structured **research workflows** (multi-step LLM pipelines with JSON outputs) |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | **Local RAG**: workspaces (=projects), document embedding, citation-grounded chat |
| [Open WebUI](https://github.com/open-webui/open-webui) | Clean multi-provider **LLM settings** (Ollama local or cloud APIs), streaming UX |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | Robust **document ingestion** pipeline (parse → chunk → index → searchable) |

- **Author:** Abhishek — [abhishek.aks@gmail.com](mailto:abhishek.aks@gmail.com) — [github.com/abhishekamf](https://github.com/abhishekamf)
- **Status:** v1.0.0 · working prototype, actively developed
- **License:** MIT

## ✨ Features

### 📚 Library (Paperless-ngx-style ingestion)
- Drag & drop **PDF · DOCX · TXT · MD · CSV · XLSX · BibTeX · RIS**
- Automatic text extraction (page-aware), chunking, embedding & full-text (BM25) indexing
- Bibliography files auto-populate your reference manager

### 💬 Chat with your library (AnythingLLM-style RAG)
- Every answer grounded in **your** papers with clickable citations `[S1] [S2]` → source passages
- Hybrid retrieval: BM25 + vector embeddings fused with Reciprocal Rank Fusion
- Works fully offline with [Ollama](https://ollama.com) (`llama3.1`, `mistral`, `phi3`…) or use OpenAI / Claude / Groq / Gemini / any OpenAI-compatible endpoint

### 🔭 Discover (academic search)
- Parallel search across **arXiv, OpenAlex, Semantic Scholar, Crossref** — no API keys needed
- Deduplicated, citation-ranked results; one-click import of metadata **and open-access PDFs**
- Copy DOI / BibTeX instantly

### 📑 Reference Manager
- BibTeX & RIS import/export, manual entry
- Formatted citations in **APA, MLA, Chicago, IEEE, Harvard, Vancouver**
- One-click copy of full citations and in-text citations

### 🗺️ Research Workbench (Dify-style workflows)
1. **Literature Mapping** — k-means clustering over embeddings + PCA → interactive theme map with AI-named clusters
2. **Research Gap Analysis** — thematic / methodological / population / theoretical / data gaps, prioritized with actionable next steps (structured JSON → beautiful cards)
3. **Citation-aware Summaries** — structured per-paper summaries or whole-corpus synthesis
4. **Methodology Suggestions** — design, sampling, instruments, analysis plan, validity, ethics
5. **Manuscript Assistance** — outline → section drafting → abstract & keywords → polishing → reviewer responses

### 📊 Data Lab (built-in statistics — no SPSS needed for exploration)
- Descriptives, correlation matrix (Pearson + Spearman) with heatmap
- Welch's t-test / one-way ANOVA, χ² test of independence (Cramér's V)
- OLS regression with coefficient table, scatter + fit line
- **Cronbach's α** for questionnaire reliability, frequency tables
- Exact p-values (regularized incomplete beta/gamma — validated against R), SVG charts, **AI interpretation** in plain language + APA-style results paragraph

### 🔒 Privacy
Local-first: everything (documents, embeddings, chats, settings) stays on your machine. Use Ollama and **nothing ever leaves your computer**.

## 🚀 Install & Run (MacBook)

> Requires [Node.js 18+](https://nodejs.org) (20 recommended). For local AI: [Ollama](https://ollama.com).

```bash
# 1. clone
git clone https://github.com/abhishekamf/Research-Assistant.git
cd research-ai-assistant

# 2. install
npm install

# 3. run
npm start
```

**Recommended (fully local & free):**
```bash
# install Ollama, then in another terminal:
ollama pull llama3.1
ollama pull nomic-embed-text
```
Then in the app: **Settings → LLM → Ollama → Test connection → pick llama3.1 → Save**.

## 📦 Build macOS & Windows distributables

**On your MacBook (makes .dmg + .zip, Apple Silicon & Intel):**
```bash
npm run dist:mac     # → release/ Research AI Assistant-1.0.0-arm64.dmg etc.
```

**Windows installers are built automatically by GitHub Actions** on every push to `main` (and on version tags) — see [.github/workflows/build.yml](.github/workflows/build.yml). Artifacts appear under *Actions → Build → Artifacts* (`windows-installer`, `macos-dmg`). Tag `v1.0.1` → automatic GitHub Release with all installers attached.

## 🗂️ Project structure

```
research-ai-assistant/
├── electron/            main process (window, IPC, menus)
│   ├── main.js
│   └── preload.js
├── server/              research engine (pure Node, testable)
│   ├── api.js           IPC dispatcher (all features)
│   ├── ingest.js        PDF/DOCX/CSV/XLSX/BibTeX/RIS extraction (pdfjs-dist, mammoth)
│   ├── chunker.js       page-aware semantic chunking
│   ├── embeddings.js    local (offline) / Ollama / OpenAI embeddings
│   ├── retriever.js     BM25 + vector hybrid search (RRF fusion)
│   ├── rag.js           citation-aware RAG pipeline
│   ├── llm.js           streaming LLM providers (Ollama/OpenAI/Claude/Groq/Gemini)
│   ├── scholar.js       arXiv/OpenAlex/S2/Crossref search
│   ├── citations.js     BibTeX/RIS parse & export, APA/MLA/Chicago/IEEE/Harvard/Vancouver
│   ├── workflows.js     literature map · gaps · summaries · methodology · manuscript
│   ├── stats.js         full statistics engine (t-test, ANOVA, χ², OLS, α, k-means, PCA)
│   └── store.js         JSON data layer (projects, docs, chunks, refs)
├── src/                 renderer UI (vanilla JS, zero frameworks)
├── samples/             sample dataset to try the Data Lab instantly
├── scripts/             one-copy terminal setup scripts
├── docs/USER_GUIDE.md   illustrated how-to
└── .github/workflows/   mac/win build automation
```

## 🧪 Quality

- 80+ automated assertions validated the statistics engine against R reference values (Welch t, ANOVA, χ², OLS, Cronbach's α)
- Citation parsers round-trip tested (BibTeX → parse → export → parse)
- Ingestion tested against real arXiv PDFs

## 🤝 Contributing & roadmap

Ideas welcome — especially from fellow researchers! Planned: Zotero sync, PDF highlighting, multi-workspace federated search, qualitative coding (NVivo-lite), Gantt-style thesis planner.

## ⭐ Support

If this helps your research, please star the repo and share it with your department.

<div align="center"><sub>Built with ☕ and 📚 by Abhishek · MIT © 2026</sub></div>
