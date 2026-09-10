/**
 * Research workflows — the heart of the assistant.
 *  1. literatureMap      : cluster the library into research themes + 2D map
 *  2. researchGaps       : identify gaps in the literature (JSON)
 *  3. summarize          : citation-aware summaries (per-doc & synthesis)
 *  4. methodology        : methodology suggestions for the research question
 *  5. manuscript         : outline / section drafting / abstract / polishing
 *  6. interpretAnalysis  : plain-language interpretation of Data Lab results
 * All LLM text streams to the renderer via sendEvent('wf:token').
 */
const llm = require('./llm');
const { safeJson, truncate, uid } = require('./utils');
const { corpusBrief } = require('./rag');
const { kmeans, pca2d } = require('./stats');
const { localEmbed } = require('./embeddings');
const { contentTokens } = require('./utils');

async function runLLM(cfg, messages, p, opts = {}) {
  return llm.chat(cfg, messages, {
    onToken: (tok) => p.sendEvent && p.sendEvent('wf:token', { requestId: p.requestId, delta: tok }),
    signal: p.signal,
    temperature: opts.temperature ?? 0.4,
    maxTokens: opts.maxTokens ?? cfg.maxTokens ?? 2048
  });
}

/** Project-level settings + guards. */
function checkLLM(store) {
  const s = store.getSettings();
  if (!s.llm.model) throw new Error('No LLM model configured. Open Settings and pick a model first.');
  return s;
}

function readyDocs(project) {
  const docs = project.docs.filter((d) => d.status === 'ready');
  if (!docs.length) throw new Error('No ready documents in this project. Upload papers first (Library tab).');
  return docs;
}

// ---------------------------------------------------------------- 1. Literature map
async function literatureMap(store, project, p) {
  const s = checkLLM(store);
  const docs = readyDocs(project);

  // doc vectors: prefer mean of stored chunk embeddings, else local hash embedding
  const dim = project.meta.embedding.dim || 512;
  const vectors = docs.map((d) => {
    const chunkIdx = project.chunks.filter((c) => c.docId === d.id && c.ei != null && c.ei >= 0).map((c) => c.ei);
    if (chunkIdx.length && project.embeddings && project.embeddings.length >= (Math.max(...chunkIdx) + 1) * dim) {
      const v = new Float64Array(dim);
      for (const ei of chunkIdx.slice(0, 40)) {
        for (let j = 0; j < dim; j++) v[j] += project.embeddings[ei * dim + j] / chunkIdx.length;
      }
      return Array.from(v);
    }
    return Array.from(localEmbed(d.title + ' ' + (d.meta && d.meta.abstractHint || '') + ' ' + project.chunks.filter((c) => c.docId === d.id).slice(0, 3).map((c) => c.text).join(' ')));
  });

  const k = Math.min(8, Math.max(2, Math.round(Math.sqrt(docs.length / 1.7))));
  const km = kmeans(vectors, k);
  const proj = pca2d(vectors);

  // normalize projection to 0..100
  const xs = proj.x, ys = proj.y;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (v) => 8 + 84 * ((v - minX) / ((maxX - minX) || 1));
  const sy = (v) => 8 + 84 * ((v - minY) / ((maxY - minY) || 1));

  const clusterLists = Array.from({ length: km.k }, () => []);
  docs.forEach((d, i) => clusterLists[km.assign[i]].push(d));

  p.sendEvent && p.sendEvent('wf:status', { requestId: p.requestId, status: `Found ${km.k} theme clusters. Naming them with AI…` });

  const listing = clusterLists.map((list, i) => `Cluster ${i + 1} (${list.length} papers):\n${list.map((d) => `- ${d.title} (${d.year || 'n.d.'})`).join('\n')}`).join('\n\n');

  const answer = await runLLM(s.llm, [
    { role: 'system', content: 'You are a senior academic analyzing a research library. Respond ONLY with valid JSON.' },
    { role: 'user', content: `Given these ${km.k} clusters of research papers (grouped by textual similarity), name each theme and describe it in 2-3 sentences for a PhD scholar.\n\n${listing}\n\nReturn JSON exactly like:\n{"themes":[{"n":1,"title":"short theme name (max 6 words)","description":"...","keywords":["k1","k2","k3"]}]}` }
  ], p, { temperature: 0.2, maxTokens: 1500 });

  const parsed = safeJson(answer) || { themes: [] };
  const themes = clusterLists.map((list, i) => {
    const t = (parsed.themes || []).find((x) => +x.n === i + 1) || {};
    return {
      n: i + 1,
      title: t.title || `Theme ${i + 1}`,
      description: t.description || '',
      keywords: t.keywords || [],
      size: list.length,
      docs: list.map((d) => ({ id: d.id, title: d.title, year: d.year || null }))
    };
  });

  const layout = docs.map((d, i) => ({
    docId: d.id, title: truncate(d.title, 60), cluster: km.assign[i],
    x: +sx(xs[i]).toFixed(1), y: +sy(ys[i]).toFixed(1)
  }));

  return { themes, layout, k: km.k };
}

// ---------------------------------------------------------------- 2. Research gaps
async function researchGaps(store, project, p, researchQuestion) {
  const s = checkLLM(store);
  const docs = readyDocs(project);
  const rq = researchQuestion || project.researchQuestion || '(not specified - infer from the corpus)';

  p.sendEvent && p.sendEvent('wf:status', { requestId: p.requestId, status: 'Reading your library…' });
  const brief = corpusBrief(project, 50);

  const answer = await runLLM(s.llm, [
    { role: 'system', content: 'You are an exacting PhD supervisor and literature-review expert. Respond ONLY with valid JSON.' },
    { role: 'user', content: `Research question: ${rq}\n\nLibrary contents:\n${brief}\n\nIdentify research gaps in this literature. Consider: (a) thematic gaps (unexplored topics), (b) methodological gaps (weak/absent methods), (c) population/context gaps (understudied settings or samples, e.g. Global South / India-specific), (d) theoretical gaps, (e) data/measurement gaps.\n\nReturn JSON exactly like:\n{"gaps":[{"title":"...","type":"thematic|methodological|population|theoretical|data","description":"2-3 sentences","evidence":"which papers/absences support this","priority":"high|medium|low","actionable":"a concrete next step for a PhD scholar"}],"overallAssessment":"one paragraph summary of maturity of this field"}` }
  ], p, { temperature: 0.35, maxTokens: 2500 });

  const parsed = safeJson(answer);
  if (!parsed || !parsed.gaps) throw new Error('Could not parse gap analysis. Try again or use a stronger model.');
  return parsed;
}

// ---------------------------------------------------------------- 3. Summaries
async function summarizeDocs(store, project, p, { docIds = null, mode = 'corpus' }) {
  const s = checkLLM(store);
  const docs = readyDocs(project).filter((d) => !docIds || docIds.includes(d.id));

  if (mode === 'per-doc') {
    const out = [];
    for (const d of docs.slice(0, 12)) {
      p.sendEvent && p.sendEvent('wf:status', { requestId: p.requestId, status: `Summarizing: ${truncate(d.title, 50)}…` });
      const chunkText = project.chunks.filter((c) => c.docId === d.id).slice(0, 6).map((c) => c.text).join('\n\n');
      const text = await runLLM(s.llm, [
        { role: 'system', content: 'You are an academic summarizer. Write a structured, citation-aware summary. Use the paper title as a heading. Cover: Background & objective, Methodology, Key findings, Limitations, Relevance. Use markdown. If the extract lacks a section, write "not stated in extract".' },
        { role: 'user', content: `Summarize this paper extract:\n\nTitle: ${d.title} (${d.year || 'n.d.'})\nAuthors: ${(d.authors || []).join(', ') || 'unknown'}\n\n${truncate(chunkText, 9000)}` }
      ], p, { temperature: 0.2, maxTokens: 1200 });
      out.push({ docId: d.id, title: d.title, year: d.year, summary: text });
    }
    return { mode, summaries: out };
  }

  // corpus synthesis
  p.sendEvent && p.sendEvent('wf:status', { requestId: p.requestId, status: 'Synthesizing whole library…' });
  const brief = corpusBrief(project, 50);
  const text = await runLLM(s.llm, [
    { role: 'system', content: 'You are writing an academic literature synthesis. Use markdown with short headings. Weave papers together thematically (not paper-by-paper). Mention author-year style references like (Sharma, 2023) based only on the provided metadata.' },
    { role: 'user', content: `Synthesize the state of research across this library (${docs.length} papers):\n\n${brief}\n\nStructure: 1) Overview of the field, 2) Major themes with supporting papers, 3) Points of agreement/debate, 4) Overall trends.` }
  ], p, { temperature: 0.3, maxTokens: 2200 });
  return { mode: 'corpus', synthesis: text };
}

// ---------------------------------------------------------------- 4. Methodology
async function methodologySuggestions(store, project, p, researchQuestion, design) {
  const s = checkLLM(store);
  const rq = researchQuestion || project.researchQuestion || '';
  if (!rq) throw new Error('Set a research question first (project header → "Set research question").');
  const brief = corpusBrief(project, 40);

  const text = await runLLM(s.llm, [
    { role: 'system', content: 'You are a senior research-methods advisor for PhD scholars. Give rigorous, practical, ethically-aware methodological guidance. Use markdown headings and bullet lists.' },
    { role: 'user', content: `Research question: ${rq}\nPreferred design (if any): ${design || 'open to suggestions'}\n\nRelated literature in the scholar's library:\n${truncate(brief, 9000)}\n\nProvide: 1) Recommended research design(s) with justification, 2) Population, sampling strategy and sample-size considerations, 3) Data collection instruments (including validated scales/questionnaire advice), 4) Data analysis plan (statistical or qualitative techniques, with software suggestions), 5) Validity, reliability and bias mitigations, 6) Ethical considerations, 7) Common pitfalls to avoid. Align suggestions with the provided literature where relevant.` }
  ], p, { temperature: 0.4, maxTokens: 2600 });
  return { text };
}

// ---------------------------------------------------------------- 5. Manuscript assistance
async function manuscriptAssist(store, project, p, params) {
  const s = checkLLM(store);
  const { task, title, question, section, outline, input, target } = params;
  const brief = corpusBrief(project, 30);

  const tasks = {
    outline: {
      system: 'You are an academic writing coach for journal papers and theses. Produce a detailed, well-structured outline in markdown with numbered sections, sub-points, suggested word counts, and notes on what evidence/citations each section needs.',
      user: `Create a complete paper outline.\nWorking title: ${title || '(give one)'}\nResearch question: ${question || '(infer)'}\nTarget venue/type: ${target || 'journal article'}\nLibrary context:\n${truncate(brief, 7000)}`
    },
    section: {
      system: 'You are an expert academic writer. Draft the requested section in scholarly prose (markdown), citing the scholar\'s library in author-year form where appropriate, e.g. (Sharma, 2023). Be substantive and specific. Never fabricate references — only cite papers present in the library list, or write [CITATION NEEDED].',
      user: `Draft the "${section || 'Introduction'}" section.\nTitle: ${title || ''}\nResearch question: ${question || ''}\nOutline to follow:\n${truncate(outline || '(none provided)', 4000)}\n\nLibrary (for citation):\n${truncate(brief, 9000)}${input ? `\n\nAdditional material from the scholar:\n${truncate(input, 4000)}` : ''}`
    },
    abstract: {
      system: 'You write precise academic abstracts (150-300 words) following the structured format: Background, Objective, Methods, Results/Expected contribution, Conclusion. Also provide 5-6 keywords.',
      user: `Write an abstract.\nTitle: ${title || ''}\nResearch question: ${question || ''}\n${outline ? `Outline/content:\n${truncate(outline, 6000)}` : ''}\n\nLibrary context:\n${truncate(brief, 6000)}`
    },
    polish: {
      system: 'You are a professional academic editor. Improve clarity, flow, tone and grammar while preserving meaning, terminology, citation markers and the author\'s voice. Return only the edited text. Keep [CITATION NEEDED] and citation markers intact.',
      user: `Edit this academic text:\n\n${truncate(input || '', 12000)}`
    },
    reviewer: {
      system: 'You are an experienced peer reviewer responding-helpfulness coach. For each reviewer comment, draft a polite, evidence-based response and describe the exact revision to make.',
      user: `Reviewer comments:\n${truncate(input || '', 6000)}\n\nPaper context:\n${truncate(brief, 5000)}`
    }
  };

  const t = tasks[task] || tasks.outline;
  const text = await runLLM(s.llm, [{ role: 'system', content: t.system }, { role: 'user', content: t.user }], p, { temperature: 0.5, maxTokens: 3000 });
  return { text };
}

// ---------------------------------------------------------------- 6. Data interpretation
async function interpretAnalysis(store, project, p, { results, context }) {
  const s = checkLLM(store);
  const text = await runLLM(s.llm, [
    { role: 'system', content: 'You are a friendly statistics tutor for PhD scholars. Interpret statistical output in plain language, note assumptions and caveats, and draft an APA-style results paragraph the scholar can adapt. Use markdown.' },
    { role: 'user', content: `Scholar's context/question: ${context || '(none provided)'}\n\nStatistical results (JSON):\n${JSON.stringify(results).slice(0, 9000)}\n\nProvide: 1) Plain-language interpretation of every key statistic, 2) Assumptions to check / caveats, 3) An APA-style "Results" paragraph template, 4) Suggestions for next analyses.` }
  ], p, { temperature: 0.3, maxTokens: 2000 });
  return { text };
}

module.exports = { literatureMap, researchGaps, summarizeDocs, methodologySuggestions, manuscriptAssist, interpretAnalysis };
