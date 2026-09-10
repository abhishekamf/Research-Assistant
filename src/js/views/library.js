/** Library view: project documents, upload/drag-drop, search. */
window.Views = window.Views || {};

Views.library = {
  docs: [],
  filter: '',

  async render(el) {
    const pid = App.projectId;
    if (!pid) { el.innerHTML = '<div class="empty-state"><div class="big">📁</div>Create or select a project first.</div>'; return; }

    el.innerHTML = '';
    const layout = h('div', { class: 'lib-layout' });
    const left = h('div', {}, null);
    const right = h('div', {}, null);
    layout.append(left, right);
    el.appendChild(layout);

    const drop = h('div', { class: 'dropzone', onclick: () => this.addViaDialog() },
      h('div', { style: 'font-size:30px' }, '📄'),
      h('div', {}, h('strong', {}, 'Add research documents')),
      h('div', { class: 'small mt', style: 'margin-top:6px' }, 'PDF · DOCX · TXT · MD · CSV · XLSX · BibTeX (.bib) · RIS (.ris)'),
      h('div', { class: 'small faint', style: 'margin-top:4px' }, 'click to browse, or drag & drop anywhere in the window')
    );
    left.appendChild(drop);

    const searchBar = h('div', { class: 'row mt' },
      h('input', { type: 'text', id: 'lib-search', placeholder: 'Search full text across your library (BM25)…', onkeydown: (e) => { if (e.key === 'Enter') this.doSearch(); } }),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => this.doSearch() }, 'Search')
    );
    left.appendChild(searchBar);
    this.searchOut = h('div', { id: 'search-results', class: 'mt' });
    left.appendChild(this.searchOut);

    left.appendChild(h('div', { class: 'spread mt' },
      h('h2', {}, 'Documents'),
      h('span', { class: 'faint small', id: 'doc-count' }, '')
    ));
    this.docList = h('div', { class: 'doc-list' });
    left.appendChild(this.docList);

    // right panel: project summary + indexing
    right.appendChild(h('div', { class: 'card' }, [
      h('h2', {}, 'Library status'),
      h('div', { id: 'lib-status', class: 'small muted' }, 'Loading…'),
      h('div', { class: 'mt' },
        h('button', { class: 'btn btn-sm', onclick: () => this.reindexAll() }, '🔄 Re-index embeddings'),
        h('p', { class: 'faint small', style: 'margin-top:8px' }, 'Re-run embedding for all chunks (needed after changing the embedding provider in Settings).')
      )
    ]));
    right.appendChild(h('div', { class: 'card mt' }, [
      h('h2', {}, 'Supported inputs'),
      h('ul', { class: 'small muted', style: 'margin-left:18px;line-height:1.8' },
        h('li', {}, 'Research papers (PDF, DOCX)'), h('li', {}, 'Thesis chapters & literature reviews'),
        h('li', {}, 'Questionnaires & protocols (TXT/DOCX)'), h('li', {}, 'Datasets (CSV, XLSX → use Data Lab)'),
        h('li', {}, 'Bibliographies (.bib, .ris → auto-import references)'))
    ]));

    await this.refresh();
  },

  async refresh() {
    if (!App.projectId) return;
    try {
      this.docs = await API.listDocuments(App.projectId);
    } catch { this.docs = []; }
    this.renderDocs();
  },

  renderDocs() {
    const list = this.docList;
    if (!list) return;
    list.innerHTML = '';
    const q = this.filter.toLowerCase();
    const docs = this.docs.filter((d) => !q || d.title.toLowerCase().includes(q) || (d.fileName || '').toLowerCase().includes(q));
    $('#doc-count') && ($('#doc-count').textContent = `${docs.length} document(s)`);
    if (!docs.length) {
      list.appendChild(h('div', { class: 'empty-state' }, 'No documents yet. Add your first paper above.'));
      return;
    }
    const icons = { pdf: '📕', docx: '📘', markdown: '📝', text: '📄', dataset: '📊', bibliography: '📚' };
    for (const d of docs) {
      const statusChip = d.status === 'ready' ? h('span', { class: 'chip good' }, 'ready')
        : d.status === 'empty' ? h('span', { class: 'chip warn' }, 'no text')
        : h('span', { class: 'chip bad' }, d.status || '?');
      const item = h('div', { class: 'doc-item' },
        h('div', { class: 'doc-icon' }, icons[d.kind] || '📄'),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'doc-title' }, d.title),
          h('div', { class: 'doc-meta' }, `${d.fileName || ''} · ${d.pages || '?'} pages · ${d.year || 'n.d.'} `)),
        statusChip,
        h('div', { class: 'doc-actions' },
          h('button', { class: 'icon-btn', title: 'Preview', onclick: (e) => { e.stopPropagation(); this.preview(d); } }, '👁'),
          h('button', { class: 'icon-btn', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (await confirmDialog('Delete document', `Remove "${d.title}" from the library? This cannot be undone.`)) { await API.deleteDocument(App.projectId, d.id); this.refresh(); App.refreshProjectBadges(); } } }, '🗑')
        )
      );
      item.addEventListener('click', () => this.preview(d));
      list.appendChild(item);
    }
  },

  async addViaDialog() {
    const paths = await API.pickFiles();
    if (paths && paths.length) await this.addPaths(paths);
  },

  async addPaths(paths) {
    if (!App.projectId) { toast('Create a project first', 'err'); return; }
    toast(`Ingesting ${paths.length} file(s)…`);
    try {
      const r = await API.addFiles(App.projectId, paths);
      if (r.added.length) toast(`Added ${r.added.length} document(s). Indexing in background…`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    setTimeout(() => this.refresh(), 1500);
  },

  async doSearch() {
    const q = $('#lib-search') ? $('#lib-search').value.trim() : '';
    if (!q) return;
    this.searchOut.innerHTML = '<div class="row muted small"><span class="spinner"></span>&nbsp;Searching…</div>';
    try {
      const results = await API.searchLibrary(App.projectId, q, 15);
      this.searchOut.innerHTML = '';
      if (!results.length) { this.searchOut.appendChild(h('div', { class: 'faint small' }, 'No matches.')); return; }
      this.searchOut.appendChild(h('div', { class: 'small faint', style: 'margin-bottom:6px' }, `${results.length} matching passages`));
      for (const r of results) {
        this.searchOut.appendChild(h('div', { class: 'source-card' },
          h('div', {}, h('span', { class: 's-badge' }, `p.${r.page}`), h('strong', {}, r.title)),
          h('div', { class: 'muted', style: 'margin-top:4px' }, r.snippet + '…')
        ));
      }
    } catch (e) { this.searchOut.innerHTML = ''; toast(e.message, 'err'); }
  },

  async preview(doc) {
    await modal(doc.title, (box) => {
      const body = h('div', {}, h('div', { class: 'row muted small' }, h('span', { class: 'spinner' }), ' Loading preview…'));
      box.appendChild(body);
      API.getDocument(App.projectId, doc.id).then((r) => {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'small muted' }, `${r.doc.kind} · ${r.doc.pages} pages · added ${timeAgo(r.doc.addedAt)} · DOI: ${r.doc.doi || '—'}`));
        if (r.doc.abstract || (r.doc.meta && r.doc.meta.pdfTitle)) {
          body.appendChild(h('p', { class: 'small mt', html: `<strong>PDF title:</strong> ${esc(r.doc.meta.pdfTitle || '—')}` }));
        }
        body.appendChild(h('h2', { class: 'mt' }, 'Extracted passages (first 8)'));
        for (const c of r.chunks.slice(0, 8)) {
          body.appendChild(h('div', { class: 'source-card' }, h('span', { class: 's-badge' }, `p.${c.page}`), ' ', esc(c.text) + '…'));
        }
        if (!r.chunks.length) body.appendChild(h('p', { class: 'faint' }, 'No text extracted from this file.'));
      }).catch((e) => { body.innerHTML = `<p class="small" style="color:var(--bad)">${esc(e.message)}</p>`; });
      return {};
    });
  },

  async reindexAll() {
    toast('Re-indexing all documents…');
    try {
      await API.call('reindexDocument', App.projectId, this.docs[0] ? this.docs[0].id : '');
      toast('Re-indexing started', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }
};
