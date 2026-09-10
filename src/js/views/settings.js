/** Settings: LLM & embedding providers, model picker, connection tests, about. */
window.Views = window.Views || {};

Views.settings = {
  async render(el) {
    const s = await API.getSettings();
    el.innerHTML = '';
    el.appendChild(h('h1', {}, 'Settings'));
    const wrap = h('div', { class: 'settings-layout' });

    // ---------- LLM provider ----------
    const llmCard = h('div', { class: 'card' }, h('h2', {}, '🧠 Language model (LLM)'),
      h('p', { class: 'small muted' }, 'Local & private via Ollama, or any cloud API. Nothing leaves your machine with Ollama.'));
    const grid = h('div', { class: 'form-grid' });

    const providerSel = h('select', {}, ...[
      ['ollama', 'Ollama (local, free, private)'],
      ['openai', 'OpenAI'],
      ['anthropic', 'Anthropic Claude'],
      ['groq', 'Groq (fast, free tier)'],
      ['gemini', 'Google Gemini'],
      ['custom', 'Custom (OpenAI-compatible: LM Studio, OpenRouter, vLLM…)']
    ].map(([v, l]) => h('option', { value: v, selected: s.llm.provider === v ? '' : null }, l)));

    const baseUrl = h('input', { type: 'text', value: s.llm.baseUrl || '' });
    const apiKey = h('input', { type: 'password', value: s.llm.apiKey || '', placeholder: 'sk-…' });
    const model = h('input', { type: 'text', value: s.llm.model || '', placeholder: 'llama3.1 / gpt-4o-mini / …' });
    const modelList = h('datalist', { id: 'model-list' });
    const temp = h('input', { type: 'number', value: s.llm.temperature ?? 0.3, step: '0.1', min: '0', max: '2' });
    const maxTok = h('input', { type: 'number', value: s.llm.maxTokens ?? 2048, step: '128' });

    grid.append(
      h('div', {}, h('label', {}, 'Provider'), providerSel),
      h('div', {}, h('label', {}, 'Base URL'), baseUrl),
      h('div', {}, h('label', {}, 'API key (cloud providers only)'), apiKey),
      h('div', {}, h('label', {}, 'Model'), model, modelList));
    llmCard.appendChild(grid);
    llmCard.appendChild(h('div', { class: 'form-grid mt' },
      h('div', {}, h('label', {}, 'Temperature'), temp),
      h('div', {}, h('label', {}, 'Max output tokens'), maxTok)));
    const testOut = h('div', { class: 'small mt' });
    llmCard.appendChild(h('div', { class: 'row mt' },
      h('button', { class: 'btn btn-sm', onclick: async () => {
        testOut.innerHTML = '<span class="spinner"></span> Testing…';
        const r = await API.testLLM({ provider: providerSel.value, baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value });
        testOut.innerHTML = r.ok ? `<span style="color:var(--good)">✓ ${esc(r.message)}</span>` : `<span style="color:var(--bad)">✗ ${esc(r.message)}</span>`;
        if (r.ok && r.sampleModels.length) {
          modelList.innerHTML = r.sampleModels.map((m2) => `<option value="${esc(m2)}">`).join('');
          if (!model.value) model.value = r.sampleModels.find((m2) => !m2.includes('embed')) || r.sampleModels[0];
        }
      } }, 'Test connection & fetch models'),
      testOut));

    // ---------- embeddings ----------
    const embCard = h('div', { class: 'card mt' }, h('h2', {}, '🧲 Embeddings (for semantic search & literature map)'),
      h('p', { class: 'small muted' }, '"Local (offline)" works instantly with no setup using keyword-hash embeddings. For best semantic quality install Ollama and pull an embedding model (e.g. nomic-embed-text).'));
    const embGrid = h('div', { class: 'form-grid' });
    const embSel = h('select', {}, ...[
      ['local', 'Local (offline, instant)'],
      ['ollama', 'Ollama (recommended quality)'],
      ['openai', 'OpenAI-compatible API']
    ].map(([v, l]) => h('option', { value: v, selected: s.embed.provider === v ? '' : null }, l)));
    const embUrl = h('input', { type: 'text', value: s.embed.baseUrl || 'http://localhost:11434' });
    const embKey = h('input', { type: 'password', value: s.embed.apiKey || '' });
    const embModel = h('input', { type: 'text', value: s.embed.model || '', placeholder: 'nomic-embed-text / text-embedding-3-small' });
    embGrid.append(h('div', {}, h('label', {}, 'Provider'), embSel),
      h('div', {}, h('label', {}, 'Base URL'), embUrl),
      h('div', {}, h('label', {}, 'API key'), embKey),
      h('div', {}, h('label', {}, 'Embedding model'), embModel));
    embCard.appendChild(embGrid);
    const embTest = h('div', { class: 'small mt' });
    embCard.appendChild(h('div', { class: 'row mt' },
      h('button', { class: 'btn btn-sm', onclick: async () => {
        embTest.innerHTML = '<span class="spinner"></span> Testing…';
        const r = await API.testEmbed({ provider: embSel.value, baseUrl: embUrl.value, apiKey: embKey.value, model: embModel.value });
        embTest.innerHTML = r.ok ? `<span style="color:var(--good)">✓ ${esc(r.message)}</span>` : `<span style="color:var(--bad)">✗ ${esc(r.message)}</span>`;
      } }, 'Test embeddings'),
      embTest));

    // ---------- data & about ----------
    const aboutCard = h('div', { class: 'card mt' },
      h('h2', {}, '💾 Data & about'),
      h('p', { class: 'small muted' }, 'All projects, documents, embeddings and settings are stored locally on this machine.'),
      h('div', { class: 'row mt' },
        h('button', { class: 'btn btn-sm', onclick: () => API.openDataFolder() }, 'Open data folder')),
      h('hr', { style: 'border:none;border-top:1px solid var(--line);margin:16px 0' }),
      h('p', { class: 'small' }, h('strong', {}, 'Research AI Assistant'), ' v1.0.0 — AI-powered research companion for PhD scholars, faculty and universities.'),
      h('p', { class: 'small muted mt' }, 'Author: Abhishek · ', h('a', { href: 'mailto:abhishek.aks@gmail.com', style: 'color:var(--accent2)' }, 'abhishek.aks@gmail.com'), ' · ', h('a', { href: 'https://github.com/abhishekamf', target: '_blank', style: 'color:var(--accent2)' }, 'github.com/abhishekamf')),
      h('p', { class: 'small faint mt' }, 'Concepts inspired by Dify, AnythingLLM, Open WebUI and Paperless-ngx. MIT licensed.'));

    const saveBtn = h('button', { class: 'btn btn-primary', style: 'margin-top:16px;width:100%', onclick: async () => {
      await API.saveSettings({
        llm: { provider: providerSel.value, baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value, temperature: parseFloat(temp.value) || 0.3, maxTokens: parseInt(maxTok.value, 10) || 2048 },
        embed: { provider: embSel.value, baseUrl: embUrl.value, apiKey: embKey.value, model: embModel.value }
      });
      toast('Settings saved', 'ok');
      App.settingsCache = null;
    } }, '💾 Save settings');

    wrap.append(llmCard, embCard, aboutCard, saveBtn);
    el.appendChild(wrap);
  }
};
