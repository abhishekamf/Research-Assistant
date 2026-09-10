/** Data Lab: CSV/XLSX analysis, charts, questionnaire reliability, AI interpretation. */
window.Views = window.Views || {};

Views.data = {
  filePath: null,
  table: null,
  selected: new Set(),

  async render(el) {
    el.innerHTML = '';
    el.appendChild(h('h1', {}, 'Data Lab'));
    el.appendChild(h('p', { class: 'sub' }, 'Descriptives · correlations · group comparison · OLS regression · chi-square · questionnaire reliability (Cronbach\'s α) — with charts and AI interpretation.'));

    const layout = h('div', { class: 'data-layout' });
    const side = h('div', {}, null);
    const main = h('div', { id: 'data-main' }, h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '📊'), 'Load a CSV or XLSX file to begin.'));
    layout.append(side, main);
    el.appendChild(layout);

    side.appendChild(h('div', { class: 'card' },
      h('h2', {}, 'Dataset'),
      h('button', { class: 'btn btn-primary', style: 'width:100%', onclick: () => this.pickFile() }, '📂 Load CSV / XLSX'),
      h('div', { id: 'data-file-info', class: 'small muted mt' }, 'No file loaded'),
      h('div', { class: 'faint small mt' }, 'CSV files in your Library can also be analyzed here.')));

    this.colBox = h('div', { id: 'data-cols' });
    side.appendChild(h('div', { class: 'card mt' }, h('h2', {}, 'Columns'), this.colBox));
    this.renderCols();
  },

  async pickFile() {
    const paths = await API.pickFiles();
    if (!paths || !paths.length) return;
    try {
      this.table = await API.loadTable(paths[0]);
      this.filePath = paths[0];
      this.selected = new Set();
      $('#data-file-info').textContent = `${paths[0].split(/[\\/]/).pop()} — ${this.table.rowCount} rows × ${this.table.headers.length} cols`;
      this.renderCols();
      $('#data-main').innerHTML = '<div class="empty-state">Select an analysis from the column panel, or use the quick actions below.</div>';
      this.quickActions();
    } catch (e) { toast(e.message, 'err'); }
  },

  quickActions() {
    const main = $('#data-main');
    if (!main) return;
    const qa = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-bottom:14px' },
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => this.run('descriptives') }, 'Descriptives'),
      h('button', { class: 'btn btn-sm', onclick: () => this.run('correlation') }, 'Correlations'),
      h('button', { class: 'btn btn-sm', onclick: () => this.setupCompare() }, 'Compare groups'),
      h('button', { class: 'btn btn-sm', onclick: () => this.setupRegression() }, 'Regression'),
      h('button', { class: 'btn btn-sm', onclick: () => this.setupCrosstab() }, 'Chi-square'),
      h('button', { class: 'btn btn-sm', onclick: () => this.setupReliability() }, "Cronbach's α"),
      h('button', { class: 'btn btn-sm', onclick: () => this.setupFrequency() }, 'Frequencies'));
    main.prepend(qa);
  },

  renderCols() {
    if (!this.colBox) return;
    this.colBox.innerHTML = '';
    if (!this.table) { this.colBox.appendChild(h('p', { class: 'faint small' }, 'Load a dataset to see columns.')); return; }
    for (const c of this.table.columns) {
      const item = h('div', { class: 'col-item', onclick: (e) => this.toggleCol(c, e) },
        h('span', {}, c.name),
        h('span', { class: 'col-type' }, c.type === 'numeric' ? '#' : c.type === 'categorical' ? 'aA' : 'txt'));
      item.dataset.col = c.name;
      this.colBox.appendChild(item);
    }
  },

  toggleCol(col, evt) {
    const item = evt.currentTarget;
    if (this.selected.has(col.name)) { this.selected.delete(col.name); item.classList.remove('selected'); }
    else { this.selected.add(col.name); item.classList.add('selected'); }
  },

  picked(cols) { return [...this.selected.length || cols || []]; },

  sel() { return [...this.selected]; },

  renderResult(title, contentChildren, rawForAI) {
    const main = $('#data-main');
    if (!main) return;
    main.innerHTML = '';
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'spread' },
      h('h2', {}, title),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => { this.lastRaw = rawForAI; this.interpret(rawForAI); } }, '🤖 Interpret with AI'),
        h('button', { class: 'btn btn-sm', onclick: () => downloadOrSave(`analysis_${Date.now()}.json`, JSON.stringify(rawForAI, null, 2), [{ name: 'JSON', extensions: ['json'] }]) }, '⬇ JSON'))));
    card.append(...contentChildren);
    main.appendChild(card);
    this.quickActions();
  },

  statTable(headers, rows) {
    return h('table', { class: 'stat-table' },
      h('tr', {}, ...headers.map((hd) => h('th', {}, hd))),
      ...rows.map((r) => h('tr', {}, ...r.map((c, i) => h('td', { html: i === 0 ? esc(String(c)) : String(c) })))));
  },

  fmt(v, d = 3) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '—'; },
  pfmt(p) { if (p == null || !isFinite(p)) return '—'; return p < 0.001 ? '< 0.001' : p.toFixed(3); },
  stars(p) { return p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : ''; },

  async run(analysis, params = {}) {
    if (!this.filePath) { toast('Load a dataset first', 'err'); return; }
    try {
      const r = await API.analyze(this.filePath, analysis, params);
      this.renderAnalysis(r);
    } catch (e) { toast(e.message, 'err'); }
  },

  renderAnalysis(r) {
    switch (r.analysis) {
      case 'descriptives': {
        const rows = r.rows.map((x) => [x.name, x.n, this.fmt(x.mean, 2), this.fmt(x.sd, 2), this.fmt(x.median, 2), this.fmt(x.min, 2), this.fmt(x.max, 2), this.fmt(x.skew, 2)]);
        const histos = r.rows.slice(0, 6).map((x) => h('div', { class: 'mt' }, h('h2', {}, x.name), h('div', { html: chartHistogram(x.histogram, 560, 200) })));
        this.renderResult('Descriptive statistics', [this.statTable(['Variable', 'N', 'Mean', 'SD', 'Median', 'Min', 'Max', 'Skew'], rows), ...histos], r);
        break;
      }
      case 'correlation': {
        const heat = h('div', { html: chartHeatmap(r.columns, r.matrix, 620) });
        const pairs = r.pairs.slice().sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 12);
        const rows = pairs.map((p) => [`${p.a} × ${p.b}`, this.fmt(p.r), this.pfmt(p.p) + this.stars(p.p), this.fmt(p.rho), p.n]);
        this.renderResult('Correlation analysis', [heat, h('h2', { class: 'mt' }, 'Strongest pairs'), this.statTable(['Pair', 'Pearson r', 'p', 'Spearman ρ', 'N'], rows)], r);
        const strongest = pairs[0];
        if (strongest) {
          const sc = h('div', { class: 'mt' }, h('div', { class: 'faint small' }, 'plotting top pair…'));
          try { heat.after(sc); } catch { /* view changed */ }
          API.analyze(this.filePath, 'regression', { dependent: strongest.b, independents: [strongest.a], scatter: strongest.a }).then((rr) => {
            if (!sc.isConnected) return;
            if (rr.scatter) sc.innerHTML = chartScatter(rr.scatter.x.map((x, i) => ({ x, y: rr.scatter.y[i] })), { m: rr.coefficients[1].b, b: rr.coefficients[0].b }, 560, 280, strongest.a, strongest.b);
          }).catch(() => { if (sc.isConnected) sc.innerHTML = ''; });
        }
        break;
      }
      case 'compare': {
        const isT = r.test === 'welch-t';
        const rows = r.groups.map((g, i) => [g.name, g.values.length, this.fmt(isT ? (i === 0 ? r.result.mean1 : r.result.mean2) : r.result.groupMeans[i], 2), this.fmt(isT ? '' : r.result.groupSd[i], 2)]);
        const statRow = isT
          ? this.statTable(['Test', 't', 'df', 'p', "Cohen's d"], [['Welch t-test', this.fmt(r.result.t), this.fmt(r.result.df, 1), this.pfmt(r.result.p) + this.stars(r.result.p), this.fmt(r.result.cohenD, 2)]])
          : this.statTable(['Test', 'F', 'df1', 'df2', 'p', 'η²'], [['One-way ANOVA', this.fmt(r.result.F), r.result.df1, r.result.df2, this.pfmt(r.result.p) + this.stars(r.result.p), this.fmt(r.result.etaSq, 3)]]);
        this.renderResult('Group comparison', [this.statTable(['Group', 'N', 'Mean', 'SD'], rows), h('h2', { class: 'mt' }, 'Test result'), statRow,
          h('div', { class: 'mt', html: chartBars(r.groups.map((g, i) => ({ label: g.name, value: +(isT ? (i === 0 ? r.result.mean1 : r.result.mean2) : r.result.groupMeans[i]).toFixed(2) })), 560, 240) })], r);
        break;
      }
      case 'regression': {
        const rows = r.coefficients.map((c) => [c.name, this.fmt(c.b, 3), this.fmt(c.se, 3), this.fmt(c.t, 2), this.pfmt(c.p) + this.stars(c.p)]);
        const summary = this.statTable(['Model', 'R²', 'Adj. R²', 'F', 'p (F)', 'df', 'N'], [['OLS', this.fmt(r.r2), this.fmt(r.adjR2), this.fmt(r.F, 2), this.pfmt(r.Fp), r.df, r.n]]);
        const eq = `${r.dependent} = ${this.fmt(r.coefficients[0].b)} ` + r.coefficients.slice(1).map((c) => `+ ${this.fmt(c.b)}·${c.name}`).join(' ');
        this.renderResult('OLS regression', [h('p', { class: 'small muted', style: 'font-family:var(--mono)' }, eq), summary, h('h2', { class: 'mt' }, 'Coefficients'), this.statTable(['Predictor', 'b', 'SE', 't', 'p'], rows),
          r.scatter ? h('div', { class: 'mt', html: chartScatter(r.scatter.x.map((x, i) => ({ x, y: r.scatter.y[i] })), { m: r.coefficients[1] ? r.coefficients[1].b : 0, b: r.coefficients[0].b }, 560, 280, r.independents[0], r.dependent) }) : null], r);
        break;
      }
      case 'crosstab': {
        const rows = r.matrix.map((row, i) => [r.aNames[i], ...row, row.reduce((s, x) => s + x, 0)]);
        const test = this.statTable(['χ²', 'df', 'p', "Cramér's V", 'N'], [[this.fmt(r.chi2, 2), r.df, this.pfmt(r.p) + this.stars(r.p), this.fmt(r.cramersV, 3), r.N]]);
        this.renderResult(`Chi-square: ${r.columnA} × ${r.columnB}`,
          [this.statTable([r.columnA + ' \\ ' + r.columnB, ...r.bNames, 'Total'], rows), h('h2', { class: 'mt' }, 'Test'), test], r);
        break;
      }
      case 'reliability': {
        const interp = r.alpha >= 0.9 ? 'excellent' : r.alpha >= 0.8 ? 'good' : r.alpha >= 0.7 ? 'acceptable' : r.alpha >= 0.6 ? 'questionable' : 'poor';
        const rows = (r.itemStats || []).map((s) => [s.name, this.fmt(s.mean, 2), this.fmt(s.sd, 2)]);
        this.renderResult("Questionnaire reliability (Cronbach's α)",
          [this.statTable(['α', 'Items', 'N', 'Interpretation'], [[this.fmt(r.alpha), r.k, r.n, interp]]),
            rows.length ? h('h2', { class: 'mt' }, 'Item statistics') : null, rows.length ? this.statTable(['Item', 'Mean', 'SD'], rows) : null,
            h('p', { class: 'small muted mt' }, 'α ≥ 0.7 generally indicates acceptable internal consistency for research instruments.')], r);
        break;
      }
      case 'frequency': {
        const rows = r.levels.map((l) => [l.value, l.count, l.pct.toFixed(1) + '%']);
        this.renderResult(`Frequencies: ${r.column}`,
          [this.statTable(['Value', 'Count', '%'], rows), h('div', { class: 'mt', html: chartBars(r.levels.slice(0, 15).map((l) => ({ label: l.value, value: l.count })), 560, 260) }),
            h('p', { class: 'small faint mt' }, `Total rows: ${r.total} · missing: ${r.missing}`)], r);
        break;
      }
    }
  },

  // ---------- setup dialogs ----------
  setupCompare() {
    if (!this.table) return;
    const numerics = this.table.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
    const cats = this.table.columns.filter((c) => c.type === 'categorical').map((c) => c.name);
    if (!numerics.length || !cats.length) { toast('Need at least one numeric and one categorical column', 'err'); return; }
    modal('Compare groups', (box, close) => {
      const val = h('select', {}, ...numerics.map((n) => h('option', {}, n)));
      const grp = h('select', {}, ...cats.map((n) => h('option', {}, n)));
      box.append(h('label', {}, 'Numeric variable'), val, h('label', { class: 'mt' }, 'Group column (2+ categories → ANOVA, exactly 2 → t-test)'), grp);
      return { saveLabel: 'Run test', onSave: async () => { await this.run('compare', { valueColumn: val.value, groupColumn: grp.value }); return true; } };
    });
  },

  setupRegression() {
    if (!this.table) return;
    const numerics = this.table.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
    if (numerics.length < 2) { toast('Need at least 2 numeric columns', 'err'); return; }
    modal('OLS regression', (box, close) => {
      const dv = h('select', {}, ...numerics.map((n) => h('option', {}, n)));
      const ivBox = h('div', {}, ...numerics.map((n) => h('label', { class: 'row small', style: 'gap:6px;margin:2px 0' },
        h('input', { type: 'checkbox', class: 'reg-iv', value: n, style: 'width:auto' }), n)));
      box.append(h('label', {}, 'Dependent variable (Y)'), dv, h('label', { class: 'mt' }, 'Independent variables (X)'), ivBox);
      return { saveLabel: 'Run regression', onSave: async () => {
        const ivs = $$('.reg-iv', box).filter((c) => c.checked).map((c) => c.value);
        if (!ivs.length) { toast('Select at least one predictor', 'err'); return false; }
        await this.run('regression', { dependent: dv.value, independents: ivs, scatter: ivs[0] });
        return true;
      } };
    });
  },

  setupCrosstab() {
    if (!this.table) return;
    const cats = this.table.columns.filter((c) => c.type === 'categorical').map((c) => c.name);
    if (cats.length < 2) { toast('Need at least 2 categorical columns', 'err'); return; }
    modal('Chi-square test of independence', (box, close) => {
      const a = h('select', {}, ...cats.map((n) => h('option', {}, n)));
      const b = h('select', {}, ...cats.map((n) => h('option', {}, n)));
      box.append(h('label', {}, 'Column A (rows)'), a, h('label', { class: 'mt' }, 'Column B (columns)'), b);
      return { saveLabel: 'Run χ²', onSave: async () => {
        if (a.value === b.value) { toast('Pick two different columns', 'err'); return false; }
        await this.run('crosstab', { columnA: a.value, columnB: b.value });
        return true;
      } };
    });
  },

  setupReliability() {
    if (!this.table) return;
    const numerics = this.table.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
    if (numerics.length < 2) { toast('Reliability needs 2+ Likert/numeric items', 'err'); return; }
    modal("Cronbach's alpha — questionnaire reliability", (box, close) => {
      box.appendChild(h('p', { class: 'small muted' }, 'Tick every Likert item belonging to one scale (e.g. Q1…Q7 for "perceived usefulness").'));
      const ib = h('div', {}, ...numerics.map((n) => h('label', { class: 'row small', style: 'gap:6px;margin:2px 0' },
        h('input', { type: 'checkbox', class: 'rel-item', value: n, style: 'width:auto' }), n)));
      box.appendChild(ib);
      return { saveLabel: 'Compute α', onSave: async () => {
        const items = $$('.rel-item', box).filter((c) => c.checked).map((c) => c.value);
        if (items.length < 2) { toast('Select at least 2 items', 'err'); return false; }
        await this.run('reliability', { items });
        return true;
      } };
    });
  },

  setupFrequency() {
    if (!this.table) return;
    modal('Frequency table', (box, close) => {
      const c = h('select', {}, ...this.table.columns.map((x) => h('option', {}, x.name)));
      box.append(h('label', {}, 'Column'), c);
      return { saveLabel: 'Run', onSave: async () => { await this.run('frequency', { column: c.value }); return true; } };
    });
  },

  async interpret(results) {
    if (!App.projectId) { toast('AI interpretation needs a project + LLM (Settings). Stats still work without one.', 'err'); return; }
    const main = $('#data-main');
    if (!main) return;
    const card = h('div', { class: 'card mt' });
    card.appendChild(h('div', { class: 'spread' }, h('h2', {}, '🤖 AI interpretation'),
      h('button', { class: 'btn btn-sm', onclick: () => this.lastInterp && copyText(this.lastInterp) }, '📋 Copy')));
    const body = h('div', { class: 'wf-out-md' }, h('div', { class: 'row muted small' }, h('span', { class: 'spinner' }), ' Analyzing…'));
    card.appendChild(body);
    main.appendChild(card);
    let acc = '';
    const requestId = `wf_${Date.now()}`;
    const un = API.on('wf:token', (e) => { if (e.requestId === requestId) { acc += e.delta; renderMd(body, acc); } });
    try {
      const r = await API.runWorkflow({ projectId: App.projectId, kind: 'interpret', params: { results, context: App.project ? App.project.researchQuestion : '' }, requestId });
      this.lastInterp = r.text;
    } catch (e) { renderMd(body, `⚠️ ${e.message}`); }
    un();
  }
};
