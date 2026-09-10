# 📚 Research AI Assistant — User Guide

A practical handbook for PhD scholars, faculty and researchers.

---

## 1. First launch

1. Open the app → you are asked to **create your first project**.
   - *Project name:* e.g. `PhD Chapter 2 — Systematic Review`
   - *Research question:* e.g. *"How do digital extension services affect smallholder farm income in India?"*
   - The research question powers Gap Analysis & Methodology workflows — write it carefully.
2. Go to **Settings** and configure the AI:
   - **Easiest & private:** install [Ollama](https://ollama.com), run `ollama pull llama3.1`, choose provider *Ollama*, click **Test connection & fetch models**, pick the model, **Save**.
   - **Cloud:** choose OpenAI / Anthropic / Groq / Gemini, paste your API key, test, save.
   - **Embeddings:** *Local (offline)* works instantly. For better semantic quality pull `nomic-embed-text` in Ollama and select it, then re-index your library.

> Model size tips: 8B models (llama3.1 8B, mistral 7B) are a good research default on 16 GB machines. Larger = better reasoning, slower.

## 2. Library — build your corpus

- Open **Library** → drag PDFs/DOCX/TXT/MD/CSV/XLSX/.bib/.ris anywhere into the window.
- Each document is parsed page-by-page, chunked and indexed (progress in the top bar).
- Use the **search box** to find any passage across your whole library instantly.
- Bibliography files (`.bib`, `.ris`) automatically import their entries into **Refs**.

## 3. Chat with citation receipts

- Open **Chat**, ask questions like:
  - *"What methodologies are used across my library?"*
  - *"Which papers study drip irrigation adoption? Summarize their samples."*
- Answers carry badges `[S1] [S2]` — click one to jump to the exact source passage in the right panel. Turn off *"Ground answers in my library"* for general questions.

## 4. Discover — find new papers

- **Discover** searches arXiv + OpenAlex + Semantic Scholar + Crossref at once.
- **＋ Add to project** saves the reference; if an open-access PDF exists it is downloaded, parsed and indexed automatically.
- Copy BibTeX or DOI for anything you find.

## 5. Research Workbench — the big five workflows

| Workflow | What you get | Tip |
|---|---|---|
| 🗺️ Literature Mapping | Theme clusters + 2-D map of your corpus | Needs ≥ 8 papers for a meaningful map |
| 🕳️ Research Gaps | Prioritized gaps (thematic/method/population/theory/data) + next steps | Focus with an optional question |
| 📝 Summaries | Per-paper structured summaries or corpus synthesis | Use per-doc mode for lit-review notes |
| 🧪 Methodology | Design, sampling, instruments, analysis plan, ethics | Set your research question first |
| ✍️ Manuscript | Outline → sections → abstract → polish → reviewer replies | Outputs are Markdown — save & reuse |

Every output has **Copy** and **Save .md** buttons.

## 6. Data Lab — analyse your questionnaire/dataset

1. Load a CSV/XLSX (try `samples/sample_survey.csv` shipped with the app).
2. Quick actions:
   - **Descriptives** — N, mean, SD, median, skew + histograms
   - **Correlations** — Pearson & Spearman matrix + heatmap
   - **Compare groups** — Welch t-test (2 groups) / one-way ANOVA (3+)
   - **Regression** — OLS with full coefficient table
   - **Chi-square** — test independence between two categorical variables
   - **Cronbach's α** — tick the Likert items of one scale (e.g. Q1–Q5) → reliability
3. Click **🤖 Interpret with AI** → plain-language explanation + an APA-style Results paragraph you can adapt, plus assumption caveats.
4. Export results as JSON for your records.

> Statistics are computed with exact p-values (incomplete beta/gamma functions) and were validated against R's outputs. Still — always sanity-check; the AI interpretation flags assumptions to verify.

## 7. References — never fight citation styles again

- Filter, search, add manual entries.
- Switch the style selector: **APA, MLA, Chicago, IEEE, Harvard, Vancouver**.
- Copy a formatted reference, the in-text citation, or BibTeX for any entry.
- Export the whole library as `.bib`, `.ris` or formatted text for LaTeX/Word.

## 8. Where is my data?

Everything lives locally:
- **macOS:** `~/Library/Application Support/Research AI Assistant/research-ai-data/`
- **Windows:** `%APPDATA%\Research AI Assistant\research-ai-data\`

(Settings → *Open data folder*). Back it up like any research asset. Delete a project and its data is truly removed.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| "No LLM model configured" | Settings → pick provider → test → choose model → **Save** |
| Ollama test fails | Is `ollama serve` running? (menu-bar icon = running) |
| Answers cite little/nothing | Index still running (watch top bar), or add more papers, or raise Settings temperature ↑ quality of model |
| Embedding model mismatch after switching providers | Library → **Re-index embeddings** |
| PDF has no text | It's a scanned image — OCR isn't built in yet; run OCR externally first |
| Windows SmartScreen warning on installer | Click *More info → Run anyway* (unsigned build) |

## 10. Privacy & academic integrity

- With Ollama, your papers never leave your machine.
- AI-generated text is a **drafting aid**: verify every citation, statistic and claim before it enters your thesis. The tool deliberately refuses to invent references — it marks `[CITATION NEEDED]` instead. Follow your university's AI-use policy.
