/** App controller: navigation, projects, global events. */
const App = {
  projectId: null,
  project: null,
  projects: [],
  settingsCache: null,
  currentView: 'library',

  async init() {
    // load projects
    await this.refreshProjects();
    if (this.projects.length) await this.selectProject(this.projects[0].id);

    // nav
    $$('.rail-btn').forEach((b) => b.addEventListener('click', () => this.showView(b.dataset.view)));

    // project controls
    $('#project-select').addEventListener('change', (e) => this.selectProject(e.target.value));
    $('#btn-new-project').addEventListener('click', () => this.newProject());
    $('#btn-edit-project').addEventListener('click', () => this.editProject());
    $('#btn-del-project').addEventListener('click', () => this.deleteProject());

    // global drag & drop
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop-overlay').classList.add('active'); });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.remove('active'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; $('#drop-overlay').classList.remove('active');
      const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
      const paths = files.map((f) => API.pathForFile(f)).filter(Boolean);
      if (paths.length) {
        this.showView('library');
        Views.library.addPaths(paths);
      }
    });

    // server events -> UI
    API.on('index:progress', (e) => { $('#top-status').innerHTML = `<span class="spinner"></span> indexing ${e.done}/${e.total} chunks`; });
    API.on('index:done', (e) => { $('#top-status').textContent = `✓ indexed ${e.count} chunks`; setTimeout(() => { $('#top-status').textContent = ''; }, 4000); Views.library.refresh(); });
    API.on('doc:status', () => Views.library.refresh());
    API.on('library:changed', () => { Views.library.refresh(); this.refreshProjectBadges(); });
    API.on('app:log', (e) => toast(e.message, 'err'));
    API.on('ui:about', () => this.about());

    // default view
    this.showView('library');
  },

  async getSettings() {
    if (!this.settingsCache) this.settingsCache = await API.getSettings();
    return this.settingsCache;
  },

  async refreshProjects() {
    this.projects = await API.listProjects();
    const sel = $('#project-select');
    sel.innerHTML = '';
    if (!this.projects.length) {
      sel.appendChild(h('option', {}, '— no projects yet —'));
      this.projectId = null; this.project = null;
      await this.newProject();
      return;
    }
    for (const p of this.projects) {
      sel.appendChild(h('option', { value: p.id, selected: p.id === this.projectId ? '' : null }, p.name));
    }
    if (!this.projectId || !this.projects.some((p) => p.id === this.projectId)) {
      await this.selectProject(this.projects[0].id);
    }
  },

  async selectProject(id) {
    this.projectId = id;
    $('#project-select').value = id;
    try {
      this.project = await API.getProject(id);
    } catch (e) { toast(e.message, 'err'); return; }
    this.refreshProjectBadges();
    // re-render current view
    this.showView(this.currentView, true);
  },

  refreshProjectBadges() {
    const st = $('#top-status');
    if (this.project) {
      const embedded = this.project.embedded || 0;
      st.innerHTML = `<span class="chip">${this.project.docs.length} docs</span> <span class="chip ${embedded ? 'good' : 'warn'}">${embedded} chunks indexed</span>`;
    }
  },

  async newProject() {
    await modal('New research project', (box, close) => {
      const name = h('input', { type: 'text', placeholder: 'e.g. PhD Chapter 2 — Systematic Review' });
      const desc = h('input', { type: 'text', placeholder: 'Short description (optional)' });
      const rq = h('textarea', { placeholder: 'Your research question (powers gap analysis & methodology workflows)' });
      box.append(h('label', {}, 'Project name *'), name, h('label', { class: 'mt' }, 'Description'), desc, h('label', { class: 'mt' }, 'Research question'), rq);
      return { saveLabel: 'Create project', onSave: async () => {
        if (!name.value.trim()) { toast('Name is required', 'err'); return false; }
        const p = await API.createProject(name.value.trim(), desc.value.trim(), rq.value.trim());
        this.settingsCache = null;
        await this.refreshProjects();
        await this.selectProject(p.id);
        toast('Project created — now add documents in the Library', 'ok');
        return true;
      } };
    });
  },

  async editProject() {
    if (!this.projectId) return;
    const p = await API.getProject(this.projectId);
    await modal('Project settings', (box, close) => {
      const name = h('input', { type: 'text', value: p.meta.name });
      const desc = h('input', { type: 'text', value: p.meta.description || '' });
      const rq = h('textarea', { placeholder: 'Research question' }); rq.value = p.meta.researchQuestion || '';
      box.append(h('label', {}, 'Name'), name, h('label', { class: 'mt' }, 'Description'), desc, h('label', { class: 'mt' }, 'Research question'), rq);
      return { saveLabel: 'Save', onSave: async () => {
        await API.updateProject(this.projectId, { name: name.value.trim() || p.meta.name, description: desc.value.trim() });
        await API.setResearchQuestion(this.projectId, rq.value.trim());
        this.project = await API.getProject(this.projectId);
        await this.refreshProjects();
        toast('Project updated', 'ok');
        return true;
      } };
    });
  },

  async deleteProject() {
    if (!this.projectId) return;
    if (!await confirmDialog('Delete project', 'This permanently deletes the project with ALL documents, indexes, references and chats. Continue?')) return;
    await API.deleteProject(this.projectId);
    this.projectId = null; this.project = null;
    await this.refreshProjects();
    toast('Project deleted');
  },

  showView(name, force) {
    if (!name) return;
    const changed = this.currentView !== name || force;
    this.currentView = name;
    $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.remove('active'));
    const el = $(`#view-${name}`);
    el.classList.add('active');
    if (changed && Views[name] && Views[name].render) Views[name].render(el);
  },

  about() {
    modal('About Research AI Assistant', (box) => {
      box.append(
        h('div', { style: 'text-align:center;padding:10px 0' },
          h('div', { style: 'font-size:44px' }, '🎓'),
          h('h2', { style: 'margin-top:8px' }, 'Research AI Assistant v1.0.0'),
          h('p', { class: 'small muted' }, 'AI-powered research companion for PhD scholars, faculty and universities')),
        h('p', { class: 'small mt' }, 'Literature mapping · Research gaps · Citation-aware RAG chat · Methodology · Data analysis · Manuscript assistance · Reference management'),
        h('p', { class: 'small muted mt' }, 'Author: ', h('strong', {}, 'Abhishek'), ' — ', h('a', { href: 'mailto:abhishek.aks@gmail.com' }, 'abhishek.aks@gmail.com'), ' — ', h('a', { href: 'https://github.com/abhishekamf', target: '_blank' }, 'github.com/abhishekamf')),
        h('p', { class: 'small faint mt' }, 'MIT License © 2026 Abhishek. Concepts inspired by Dify, AnythingLLM, Open WebUI & Paperless-ngx.')
      );
      return {};
    });
  }
};

window.addEventListener('DOMContentLoaded', () => App.init().catch((e) => toast(`Startup error: ${e.message}`, 'err')));
