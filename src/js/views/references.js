/** References view: citation management, styles, BibTeX/RIS import & export. */
window.Views = window.Views || {};

Views.references = {
  refs: [],
  style: 'apa',
  filter: '',

  async render(el) {
    if (!App.projectId) { el.innerHTML = '<div class="empty-state"><div class="big">📚</div>Create or select a project first.</div>'; return; }
    const settings = await App.getSettings();
    this.style = settings.prefs.citationStyle || 'apa';

    el.innerHTML = '';
    el.appendChild(h('h1', {}, 'Reference Manager'), h('p', { class: 'sub' }, 'Collected from Discover imports, .bib/.ris uploads and manual entry. Export to BibTeX/RIS or formatted styles.'));

    const toolbar = h('div', { class: 'ref-toolbar' },
      h('select', { id: 'ref-style', onchange: (e) => { this.style = e.target.value; API.saveSettings({ prefs: { citationStyle: e.target.value } }); this.renderRefs(); } },
        ...['apa', 'mla', 'chicago', 'ieee', 'harvard', 'vancouver'].map((s) => h('option', { value: s, selected: s === this.style ? '' : null }, s.toUpperCase()))),
      h('button', { class: 'btn btn-sm', onclick: () => this.addManual() }, '＋ Manual entry'),
      h('button', { class: 'btn btn-sm', onclick: () => this.importDialog() }, '⬆ Import .bib / .ris / paste'),
      h('div', { style: 'flex:1' }),
      h('button', { class: 'btn btn-sm', onclick: async () => { const r = await API.exportReferences(App.projectId, 'bibtex'); r.saved && toast(`Exported: ${r.saved}`, 'ok'); } }, 'Export .bib'),
      h('button', { class: 'btn btn-sm', onclick: async () => { const r = await API.exportReferences(App.projectId, 'ris'); r.saved && toast(`Exported: ${r.saved}`, 'ok'); } }, 'Export .ris'),
      h('button', { class: 'btn btn-sm', onclick: async () => { const r = await API.exportReferences(App.projectId, this.style); r.saved && toast(`Exported: ${r.saved}`, 'ok'); } }, `Export ${this.style.toUpperCase()}`)
    );
    el.appendChild(toolbar);

    el.appendChild(h('input', { type: 'text', placeholder: 'Filter references…', oninput: (e) => { this.filter = e.target.value.toLowerCase(); this.renderRefs(); } }));
    this.list = h('div', { class: 'mt' });
    el.appendChild(this.list);

    await this.refresh();
  },

  async refresh() {
    try { this.refs = await API.listReferences(App.projectId) || []; } catch { this.refs = []; }
    this.renderRefs();
  },

  async renderRefs() {
    if (!this.list) return;
    this.list.innerHTML = '';
    const refs = this.refs.filter((r) => !this.filter || (r.title + ' ' + r.authors.join(' ') + ' ' + (r.venue || '')).toLowerCase().includes(this.filter));
    if (!refs.length) { this.list.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'big' }, '📚'), 'No references yet. Use Discover, import a .bib file, or add manually.')); return; }
    let formatted = [];
    try { formatted = await API.formatReferences(App.projectId, this.style); } catch { /* noop */ }
    const fmtById = new Map(formatted.map((f) => [f.id, f]));
    for (const r of refs) {
      const f = fmtById.get(r.id);
      this.list.appendChild(h('div', { class: 'ref-row' },
        h('div', { class: 'ref-formatted', html: renderInlineCitation(f ? f.text : r.title) }),
        h('div', { class: 'ref-tags' },
          h('span', { class: 'chip' }, r.type), r.origin ? h('span', { class: 'chip' }, r.origin) : null,
          r.doi ? h('span', { class: 'chip accent' }, r.doi) : null),
        h('div', { class: 'doc-actions', style: 'opacity:1;margin-top:8px' },
          f ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => copyText(f.text) }, `Copy ${this.style.toUpperCase()}`) : null,
          f ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => copyText(f.inText) }, 'Copy in-text') : null,
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => copyText(f ? f.bibtex : '') }, 'Copy BibTeX'),
          h('button', { class: 'btn btn-ghost btn-sm danger', onclick: async () => { if (await confirmDialog('Delete reference', `Remove "${r.title}"?`)) { await API.deleteReference(App.projectId, r.id); this.refresh(); } } }, '🗑')
        )
      ));
    }
  },

  addManual() {
    modal('Add reference manually', (box, close) => {
      const f = {};
      const mk = (label, key, ph) => {
        f[key] = h('input', { type: 'text', placeholder: ph || '' });
        box.appendChild(h('div', { class: 'mt' }, h('label', {}, label), f[key]));
      };
      mk('Title *', 'title'); mk('Authors (comma or "and" separated)', 'authors', 'Jane Doe and John Roe'); mk('Year', 'year', '2024');
      mk('Journal / Conference', 'venue'); mk('Volume', 'volume'); mk('Issue', 'issue'); mk('Pages', 'pages', '1-18');
      mk('DOI', 'doi'); mk('URL', 'url'); mk('Type', 'type', 'article / inproceedings / book / thesis…');
      return {
        saveLabel: 'Add reference',
        onSave: async () => {
          const v = {};
          for (const k of Object.keys(f)) v[k] = f[k].value.trim();
          if (!v.title) { toast('Title is required', 'err'); return false; }
          await API.addReference(App.projectId, {
            title: v.title, authors: v.authors.split(/\s*(?:,| and )\s*/i).filter(Boolean),
            year: parseInt(v.year, 10) || null, venue: v.venue, volume: v.volume, issue: v.issue,
            pages: v.pages, doi: v.doi, url: v.url, type: v.type || 'article'
          });
          toast('Reference added', 'ok');
          this.refresh();
          return true;
        }
      };
    });
  },

  importDialog() {
    modal('Import references', (box) => {
      const ta = h('textarea', { style: 'min-height:160px', placeholder: 'Paste BibTeX or RIS content here…' });
      box.appendChild(h('label', {}, 'Paste BibTeX / RIS'), ta);
      box.appendChild(h('p', { class: 'faint small mt' }, 'Tip: .bib and .ris files dropped into the Library are imported automatically.'));
      return {
        saveLabel: 'Import',
        onSave: async () => {
          const text = ta.value.trim();
          if (!text) return false;
          const format = text.trimStart().startsWith('@') ? 'bibtex' : 'ris';
          const r = await API.importReferencesText(App.projectId, text, format);
          toast(`Imported ${r.count} reference(s)`, 'ok');
          this.refresh();
          return true;
        }
      };
    });
  }
};

function renderInlineCitation(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*(\S[^*]+)\*/g, '<em>$1</em>')
    .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
