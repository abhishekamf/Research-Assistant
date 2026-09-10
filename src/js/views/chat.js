/** Chat view: citation-aware RAG conversation with a live source panel. */
window.Views = window.Views || {};

Views.chat = {
  messages: [],       // {role, content}
  sources: [],        // last answer's sources
  busy: false,
  currentRequestId: null,

  async render(el) {
    if (!App.projectId) { el.innerHTML = '<div class="empty-state"><div class="big">💬</div>Create or select a project first.</div>'; return; }
    el.innerHTML = '';
    const layout = h('div', { class: 'chat-layout' });
    const col = h('div', { class: 'chat-col' });
    const side = h('div', { class: 'sources-panel', id: 'sources-panel' });
    layout.append(col, side);
    el.appendChild(layout);

    this.thread = h('div', { id: 'chat-thread' });
    col.appendChild(this.thread);

    if (!this.messages.length) {
      this.thread.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'big' }, '🎓'),
        h('h2', {}, 'Chat with your research library'),
        h('p', { class: 'muted' }, 'Every answer is grounded in your uploaded papers with clickable citations [S1], [S2]…'),
        h('div', { class: 'suggestions', style: 'justify-content:center;margin-top:14px' },
          ...['What are the key findings across my library?',
            'What methodologies do these papers use?',
            'Summarize the theoretical framework in my documents.',
            'Which papers discuss similar samples/populations?'].map((s) =>
            h('span', { class: 'suggestion-chip', onclick: () => { $('#chat-input').value = s; this.send(); } }, s)))
      ));
    } else {
      this.messages.forEach((m, i) => this.renderMessage(m, i));
    }

    const inputbar = h('div', { id: 'chat-inputbar' },
      h('div', { class: 'chat-modes' },
        h('label', { class: 'row small', style: 'gap:6px;margin:0' },
          Object.assign(h('input', { type: 'checkbox', id: 'rag-toggle', checked: 'checked', style: 'width:auto' }), { checked: true }),
          ' Ground answers in my library (RAG)'),
        h('span', { class: 'faint' }, '·'), h('span', { id: 'model-hint', class: 'faint' }, '')),
      h('div', { id: 'chat-input-row' },
        h('textarea', { id: 'chat-input', placeholder: 'Ask anything about your research… (Enter to send, Shift+Enter for newline)', onkeydown: (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
        } }),
        this.sendBtn = h('button', { class: 'btn btn-primary', onclick: () => this.busy ? this.stop() : this.send() }, 'Send')),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:6px' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.clear() }, '🧹 Clear conversation'))
    );
    col.appendChild(inputbar);

    this.renderSources();
    App.getSettings().then((s) => {
      const hint = $('#model-hint');
      if (hint) hint.textContent = s.llm.model ? `model: ${s.llm.model}` : '⚠ no model configured — open Settings';
    });
  },

  clear() { this.messages = []; this.sources = []; this.render($('#view-chat')); },

  renderMessage(m) {
    if (m.role === 'user') {
      this.thread.appendChild(h('div', { class: 'msg user' }, m.content));
    } else {
      const div = h('div', { class: `msg assistant ${m.error ? 'error' : ''}` });
      if (m.content) renderMd(div, m.content, (n) => this.focusSource(n));
      if (m.error) div.appendChild(h('span', { class: 'small' }, esc(m.error)));
      this.thread.appendChild(div);
    }
    this.thread.scrollTop = this.thread.scrollHeight;
  },

  renderSources() {
    const panel = $('#sources-panel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(h('h2', {}, 'Sources'));
    if (!this.sources.length) {
      panel.appendChild(h('p', { class: 'faint small' }, 'Retrieved passages from your library will appear here with every question. Citations [S1]…[Sn] in the answer link to them.'));
      return;
    }
    const used = new Set(this.lastUsed || []);
    this.sources.forEach((s, i) => {
      panel.appendChild(h('div', { class: `source-card ${used.has(i + 1) ? 'used' : ''}`, id: `src-${i + 1}` },
        h('div', {}, h('span', { class: 's-badge' }, `S${i + 1}`), h('strong', {}, s.title), s.year ? h('span', { class: 'faint' }, ` (${s.year})`) : null,
          s.page ? h('span', { class: 'chip', style: 'margin-left:6px' }, `p. ${s.page}`) : null, used.has(i + 1) ? h('span', { class: 'chip accent', style: 'margin-left:6px' }, 'cited') : null),
        h('div', { class: 'muted', style: 'margin-top:5px' }, s.text.slice(0, 420) + (s.text.length > 420 ? '…' : ''))
      ));
    });
  },

  focusSource(n) {
    const el = $(`#src-${n}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.borderColor = 'var(--accent)'; setTimeout(() => el.style.borderColor = '', 1600); }
  },

  async send() {
    if (this.busy) return;
    const input = $('#chat-input');
    const text = (input.value || '').trim();
    if (!text) return;
    if (!App.projectId) { toast('Select a project first', 'err'); return; }
    input.value = '';

    // clear welcome screen if present
    const welcome = this.thread.querySelector('.empty-state');
    if (welcome) this.thread.innerHTML = '';

    this.messages.push({ role: 'user', content: text });
    this.renderMessage(this.messages[this.messages.length - 1]);

    // placeholder assistant bubble with live streaming
    const bubble = h('div', { class: 'msg assistant' }, h('div', { class: 'status-line' }, 'Searching your library…'));
    this.thread.appendChild(bubble);
    this.thread.scrollTop = this.thread.scrollHeight;
    let acc = '';
    const requestId = `chat_${Date.now()}`;
    this.currentRequestId = requestId;
    this.busy = true;
    this.sendBtn.textContent = '■ Stop';

    const unToken = API.on('chat:token', (e) => {
      if (e.requestId !== requestId) return;
      acc += e.delta;
      renderMd(bubble, acc, (n) => this.focusSource(n));
      this.thread.scrollTop = this.thread.scrollHeight;
    });
    const unStatus = API.on('chat:status', (e) => {
      if (e.requestId !== requestId) return;
      bubble.querySelector('.status-line') && (bubble.querySelector('.status-line').textContent = e.status);
    });

    try {
      const useRag = $('#rag-toggle') ? $('#rag-toggle').checked : true;
      const r = await API.chat({ projectId: App.projectId, messages: this.messages, useRag, topK: 8, requestId });
      this.messages.push({ role: 'assistant', content: r.answer });
      this.sources = r.sources || [];
      this.lastUsed = r.usedSourceIds || [];
      renderMd(bubble, r.answer, (n) => this.focusSource(n));
      this.renderSources();
    } catch (e) {
      this.messages.push({ role: 'assistant', content: '', error: e.message });
      bubble.innerHTML = '';
      renderMd(bubble, `⚠️ ${e.message}`);
      bubble.classList.add('error');
    } finally {
      unToken(); unStatus();
      this.busy = false; this.currentRequestId = null;
      this.sendBtn.textContent = 'Send';
      this.thread.scrollTop = this.thread.scrollHeight;
    }
  },

  stop() {
    if (this.currentRequestId) API.cancel(this.currentRequestId);
  }
};
