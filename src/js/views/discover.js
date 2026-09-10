/** Discover view: multi-source academic search + one-click import. */
window.Views = window.Views || {};

Views.discover = {
  results: [],

  async render(el) {
    el.innerHTML = '';
    el.appendChild(h('h1', {}, 'Discover'), h('p', { class: 'sub' }, 'Search arXiv, OpenAlex, Semantic Scholar and Crossref simultaneously. Import papers (metadata + open-access PDFs) straight into your library with references.'));

    const bar = h('div', { class: 'row' },
      h('input', { type: 'text', id: 'scholar-q', placeholder: 'e.g. "machine learning crop disease detection India" or a theory, author, DOI…', onkeydown: (e) => { if (e.key === 'Enter') this.search(); } }),
      h('button', { class: 'btn btn-primary', onclick: () => this.search() }, 'Search')
    );
    const srcRow = h('div', { class: 'row mt', style: 'gap:14px' },
      ...['arxiv', 'openalex', 'semantic_scholar', 'crossref'].map((s) =>
        h('label', { class: 'row small', style: 'gap:5px;margin:0' },
          h('input', { type: 'checkbox', class: 'scholar-src', value: s, checked: 'checked', style: 'width:auto' }), this.prettySource(s))),
      h('span', { class: 'faint small', style: 'margin-left:auto' }, 'All sources are free & keyless')
    );
    el.append(bar, srcRow);
    this.out = h('div', { class: 'mt' }, h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '🔭'), 'Search results appear here, ranked by citations.'));
    el.appendChild(this.out);
  },

  prettySource(s) {
    return { arxiv: 'arXiv', openalex: 'OpenAlex', semantic_scholar: 'Semantic Scholar', crossref: 'Crossref' }[s] || s;
  },

  async search() {
    const q = ($('#scholar-q').value || '').trim();
    if (!q) return;
    const sources = $$('.scholar-src').filter((c) => c.checked).map((c) => c.value);
    if (!sources.length) { toast('Select at least one source', 'err'); return; }
    this.out.innerHTML = '<div class="row muted"><span class="spinner"></span>&nbsp;Querying academic APIs…</div>';
    try {
      const r = await API.searchAcademic(q, { sources, limit: 15 });
      this.results = r.results || [];
      this.renderResults(r.errors || []);
    } catch (e) { this.out.innerHTML = ''; toast(e.message, 'err'); }
  },

  renderResults(errors) {
    this.out.innerHTML = '';
    if (errors.length) this.out.appendChild(h('div', { class: 'chip warn', style: 'margin-bottom:10px' }, `Some sources failed: ${errors.join(' · ')}`));
    if (!this.results.length) { this.out.appendChild(h('div', { class: 'empty-state' }, 'No results. Try broader keywords.')); return; }
    this.out.appendChild(h('div', { class: 'small faint', style: 'margin-bottom:8px' }, `${this.results.length} papers (deduplicated, ranked by citations)`));
    for (const p of this.results) this.out.appendChild(this.resultCard(p));
  },

  resultCard(p) {
    const badges = (p.sources || [p.source]).map((s) => h('span', { class: 'chip' }, this.prettySource(s)));
    if (p.citations != null) badges.push(h('span', { class: 'chip accent' }, `${p.citations} citations`));
    if (p.year) badges.push(h('span', { class: 'chip' }, p.year));
    return h('div', { class: 'result-card' },
      h('div', { class: 'result-title' }, p.title),
      h('div', { class: 'result-authors' }, (p.authors || []).slice(0, 6).join(', ') + ((p.authors || []).length > 6 ? ' et al.' : '')),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:5px' }, ...badges),
      p.abstract ? h('div', { class: 'result-abs' }, p.abstract.slice(0, 340) + (p.abstract.length > 340 ? '…' : '')) : null,
      h('div', { class: 'result-actions' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: (e) => this.importPaper(p, e.target) }, '＋ Add to project'),
        p.pdfUrl ? h('button', { class: 'btn btn-sm', onclick: (e) => this.importPaper(p, e.target) }, '⬇ + PDF (OA)') : null,
        p.doi ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => copyText(p.doi) }, 'Copy DOI') : null,
        p.url ? h('a', { class: 'btn btn-ghost btn-sm', href: p.url, target: '_blank', style: 'text-decoration:none' }, 'Open ↗') : null,
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => copyText(bibtexOf(p)) }, 'Copy BibTeX'))
    );

    function bibtexOf(pp) {
      const key = ((pp.authors && pp.authors[0] ? pp.authors[0].split(' ').pop() : 'anon') + (pp.year || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
      return `@article{${key},\n  title = {${pp.title}},\n  author = {${(pp.authors || []).join(' and ')}},\n  year = {${pp.year || ''}},\n  journal = {${pp.venue || ''}},${pp.doi ? `\n  doi = {${pp.doi}},` : ''}${pp.url ? `\n  url = {${pp.url}},` : ''}\n}`;
    }
  },

  async importPaper(p, btn) {
    if (!App.projectId) { toast('Create/select a project first', 'err'); return; }
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const r = await API.importPaper(App.projectId, p);
      toast(r.importedDoc ? `Imported "${p.title}" with PDF` : `Reference saved: "${p.title}" (no open-access PDF found)`, 'ok');
      btn.textContent = '✓ Added';
      App.refreshProjectBadges();
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false; btn.textContent = '＋ Add to project';
    }
  }
};
