/** Research Workbench: literature map · gaps · summaries · methodology · manuscript */
window.Views = window.Views || {};

Views.workflows = {
  active: null,

  WORKFLOWS: [
    { id: 'literatureMap', icon: '🗺️', title: 'Literature Mapping', desc: 'Clusters your library into research themes and draws an interactive concept map.' },
    { id: 'researchGaps', icon: '🕳️', title: 'Research Gap Analysis', desc: 'Thematic, methodological, population & theoretical gaps with actionable next steps.' },
    { id: 'summarize', icon: '📝', title: 'Citation-aware Summaries', desc: 'Structured per-paper summaries or a full corpus synthesis, in academic style.' },
    { id: 'methodology', icon: '🧪', title: 'Methodology Suggestions', desc: 'Design, sampling, instruments, analysis plan, validity & ethics tailored to your question.' },
    { id: 'manuscript', icon: '✍️', title: 'Manuscript Assistance', desc: 'Outline, draft sections, abstract, polishing and reviewer responses.' },
    { id: 'data', icon: '📊', title: 'Data Analysis', desc: 'Head to the Data Lab for statistics, charts & questionnaire reliability.' }
  ],

  async render(el) {
    if (!App.projectId) { el.innerHTML = '<div class="empty-state"><div class="big">⚙️</div>Create or select a project first.</div>'; return; }
    el.innerHTML = '';
    el.appendChild(h('h1', {}, 'Research Workbench'));
    el.appendChild(h('p', { class: 'sub' }, 'The full pipeline: Literature mapping → Research gaps → Summaries → Methodology → Manuscript. Outputs are exportable as Markdown.'));
    const grid = h('div', { class: 'wf-grid' });
    for (const wf of this.WORKFLOWS) {
      grid.appendChild(h('div', { class: 'wf-card', onclick: () => this.open(wf.id) },
        h('div', { class: 'wf-icon' }, wf.icon), h('h3', {}, wf.title), h('p', {}, wf.desc),
        wf.id === 'data' ? h('p', { class: 'small', style: 'margin-top:8px;color:var(--accent2)' }, 'Opens the Data Lab tab →') : null));
    }
    el.appendChild(grid);
    this.runArea = h('div', { id: 'wf-run' });
    el.appendChild(this.runArea);
  },

  open(id) {
    if (id === 'data') { App.showView('data'); return; }
    this.active = id;
    const area = this.runArea;
    area.innerHTML = '';
    const paramsPanel = h('div', { class: 'card' });
    const out = h('div', { id: 'wf-output', class: 'card' }, h('div', { class: 'faint' }, 'Configure options and click Run.'));
    const layout = h('div', { class: 'wf-run-layout' }, paramsPanel, out);
    area.appendChild(layout);
    this.out = out;

    const runBtn = h('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px', onclick: () => this.run(id) }, '▶ Run');
    paramsPanel.appendChild(runBtn);

    if (id === 'literatureMap') {
      paramsPanel.prepend(h('div', {}, h('h2', {}, '🗺️ Literature Map'),
        h('p', { class: 'small muted' }, 'Uses embedding similarity (k-means + PCA). More documents → richer map. No options needed.')));
    } else if (id === 'researchGaps') {
      const rq = h('textarea', { id: 'wf-rq', placeholder: 'Leave blank to use the project research question / infer from corpus' });
      paramsPanel.prepend(h('div', {}, h('h2', {}, '🕳️ Research Gaps'),
        h('p', { class: 'small muted' }, 'Focus the analysis on this question (optional):'), rq));
    } else if (id === 'summarize') {
      const mode = h('select', {},
        h('option', { value: 'corpus' }, 'Whole-library synthesis'),
        h('option', { value: 'per-doc' }, 'Per-paper structured summaries'));
      paramsPanel.prepend(h('div', {}, h('h2', {}, '📝 Summaries'),
        h('p', { class: 'small muted' }, 'Choose the summary mode:'), mode));
      this._sumMode = mode;
    } else if (id === 'methodology') {
      const rq = h('textarea', { id: 'wf-rq', placeholder: 'Your research question' });
      const design = h('input', { type: 'text', placeholder: 'Preferred design (optional): survey, mixed methods, RCT…' });
      paramsPanel.prepend(h('div', {}, h('h2', {}, '🧪 Methodology'),
        h('label', {}, 'Research question'), rq,
        h('label', { class: 'mt' }, 'Preferred design (optional)'), design));
      this._design = design;
    } else if (id === 'manuscript') {
      const task = h('select', { id: 'wf-task' },
        h('option', { value: 'outline' }, 'Generate paper outline'),
        h('option', { value: 'section' }, 'Draft a section'),
        h('option', { value: 'abstract' }, 'Write abstract + keywords'),
        h('option', { value: 'polish' }, 'Polish / academic edit text'),
        h('option', { value: 'reviewer' }, 'Respond to reviewers'));
      const title = h('input', { type: 'text', placeholder: 'Working title' });
      const section = h('input', { type: 'text', placeholder: 'Section name (for drafting): Introduction, Methods…' });
      const big = h('textarea', { placeholder: 'Outline / text to polish / reviewer comments' });
      const toggle = () => { section.classList.toggle('hidden', task.value !== 'section'); big.placeholder = { outline: 'Optional: notes, scope, target journal…', section: 'Any specific points to include…', abstract: 'Optional: key results to highlight…', polish: 'Paste the text to edit…', reviewer: 'Paste reviewer comments…' }[task.value] || ''; };
      task.addEventListener('change', toggle); toggle();
      paramsPanel.prepend(h('div', {}, h('h2', {}, '✍️ Manuscript'),
        h('label', {}, 'Task'), task,
        h('label', { class: 'mt' }, 'Title'), title, h('label', { class: 'mt' }, 'Section (drafting only)'), section,
        h('label', { class: 'mt' }, 'Input text'), big));
      this._ms = { task, title, section, big };
    }
  },

  async run(id) {
    if (!App.projectId) return;
    const out = this.out;
    out.innerHTML = '<div class="row muted"><span class="spinner"></span>&nbsp;<span id="wf-status">Working…</span></div><div id="wf-stream" class="mt"></div>';
    const stream = $('#wf-stream', out);
    let acc = '';
    const requestId = `wf_${Date.now()}`;
    let result = null, error = null;

    const unToken = API.on('wf:token', (e) => {
      if (e.requestId !== requestId) return;
      acc += e.delta;
      renderMd(stream, acc);
    });
    const unStatus = API.on('wf:status', (e) => {
      if (e.requestId !== requestId) return;
      const s = $('#wf-status', out); if (s) s.textContent = e.status;
    });

    // build params per workflow
    const params = {};
    if (id === 'researchGaps') params.researchQuestion = $('#wf-rq') ? $('#wf-rq').value.trim() : '';
    if (id === 'summarize') params.mode = this._sumMode ? this._sumMode.value : 'corpus';
    if (id === 'methodology') {
      params.researchQuestion = $('#wf-rq') ? $('#wf-rq').value.trim() : '';
      params.design = this._design ? this._design.value.trim() : '';
    }
    if (id === 'manuscript' && this._ms) {
      params.task = this._ms.task.value;
      params.title = this._ms.title.value.trim();
      params.section = this._ms.section.value.trim();
      params.input = this._ms.big.value;
      params.outline = this._ms.big.value;
      params.question = App.project ? App.project.researchQuestion : '';
    }

    try {
      result = await API.runWorkflow({ projectId: App.projectId, kind: id, params, requestId });
    } catch (e) { error = e; }

    unToken(); unStatus();

    if (error) {
      out.innerHTML = '';
      out.appendChild(h('div', { class: 'card', style: 'border-color:rgba(248,113,113,.5)' }, h('strong', { style: 'color:var(--bad)' }, 'Error: '), error.message,
        h('p', { class: 'faint small mt' }, 'Tips: check Settings → LLM connection, or upload more documents for corpus-wide workflows.')));
      return;
    }

    // render structured outputs
    out.innerHTML = '';
    const toolbar = h('div', { class: 'row', style: 'justify-content:flex-end;margin-bottom:10px' },
      h('button', { class: 'btn btn-sm', onclick: () => copyText(this.exportText || acc || JSON.stringify(result, null, 2)) }, '📋 Copy'),
      h('button', { class: 'btn btn-sm', onclick: () => downloadOrSave(`${id}_${Date.now()}.md`, this.exportText || acc || JSON.stringify(result, null, 2)) }, '⬇ Save .md'));
    out.appendChild(toolbar);

    if (id === 'literatureMap') {
      this.exportText = this.mapToMarkdown(result);
      out.appendChild(chartLitMap(result.layout, result.themes, (docId) => Views.library.preview && Views.library.preview({ id: docId })));
      const legend = h('div', { class: 'theme-legend' });
      const colors = MAP_COLORS;
      result.themes.forEach((t, i) => {
        legend.appendChild(h('span', { class: 'theme-pill', style: `color:${colors[i % colors.length]};border-color:${colors[i % colors.length]}` }, `${i + 1}. ${t.title} (${t.size})`));
      });
      out.appendChild(legend);
      for (const t of result.themes) {
        out.appendChild(h('div', { class: 'card mt' },
          h('h2', { style: `color:${colors[(t.n - 1) % colors.length] || 'var(--text)'}` }, `${t.n}. ${t.title}`),
          t.keywords && t.keywords.length ? h('div', { class: 'row', style: 'flex-wrap:wrap;gap:5px;margin-bottom:8px' }, ...t.keywords.map((k) => h('span', { class: 'chip accent' }, k))) : null,
          h('p', { class: 'small muted' }, t.description),
          h('ul', { class: 'small', style: 'margin:8px 0 0 18px;color:var(--muted)' }, ...t.docs.map((d) => h('li', {}, `${d.title} ${d.year ? `(${d.year})` : ''}`)))));
      }
    } else if (id === 'researchGaps') {
      this.exportText = this.gapsToMarkdown(result);
      if (result.overallAssessment) out.appendChild(h('div', { class: 'card mt' }, h('h2', {}, 'Overall assessment'), h('p', { class: 'small muted', html: mdToHtml(result.overallAssessment) })));
      const order = { high: 0, medium: 1, low: 2 };
      const gaps = [...(result.gaps || [])].sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3));
      for (const g of gaps) {
        out.appendChild(h('div', { class: `gap-card p-${g.priority || 'medium'}` },
          h('div', { class: 'spread' }, h('strong', {}, g.title), h('span', { class: `chip ${g.priority === 'high' ? 'bad' : g.priority === 'low' ? 'good' : 'warn'}` }, `${g.type || 'gap'} · ${g.priority || 'medium'}`)),
          h('p', { class: 'small mt' }, g.description),
          g.evidence ? h('p', { class: 'small faint mt' }, 'Evidence: ' + g.evidence) : null,
          g.actionable ? h('p', { class: 'small', style: 'margin-top:6px;color:var(--accent2)' }, '→ ' + g.actionable) : null));
      }
    } else if (id === 'summarize' && result.mode === 'per-doc') {
      this.exportText = (result.summaries || []).map((s) => `# ${s.title}${s.year ? ` (${s.year})` : ''}\n\n${s.summary}`).join('\n\n---\n\n');
      for (const s of result.summaries || []) {
        out.appendChild(h('div', { class: 'card mt' }));
        const c = out.lastChild;
        c.appendChild(h('h2', {}, s.title));
        renderMd(c, s.summary);
      }
    } else {
      const text = result.text || result.synthesis || acc || JSON.stringify(result, null, 2);
      this.exportText = text;
      out.appendChild(h('div', { class: 'wf-out-md' }));
      renderMd(out.lastChild, text);
    }
  },

  mapToMarkdown(r) {
    return `# Literature Map\n\n${r.themes.map((t) => `## ${t.n}. ${t.title}\n\n${t.description}\n\n**Keywords:** ${(t.keywords || []).join(', ')}\n\n**Papers:**\n${t.docs.map((d) => `- ${d.title}${d.year ? ` (${d.year})` : ''}`).join('\n')}`).join('\n\n')}`;
  },
  gapsToMarkdown(r) {
    return `# Research Gap Analysis\n\n## Overall assessment\n${r.overallAssessment || ''}\n\n${(r.gaps || []).map((g) => `## ${g.title}\n- **Type:** ${g.type} (${g.priority} priority)\n- **Description:** ${g.description}\n- **Evidence:** ${g.evidence || ''}\n- **Next step:** ${g.actionable || ''}`).join('\n\n')}`;
  }
};
