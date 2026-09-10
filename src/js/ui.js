/** UI helpers: DOM builder, toasts, modals, mini-markdown with citation badges. */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function toast(message, kind = '') {
  const box = $('#toasts');
  const t = h('div', { class: `toast ${kind}` }, message);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4200);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'ok')).catch(() => toast('Copy failed', 'err'));
}

/** Access a single field in a modal. Returns a Promise resolving to values or null. */
function modal(title, bodyBuilder) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const close = (val) => { root.innerHTML = ''; resolve(val); };
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(null); } });
    const box = h('div', { class: 'modal' }, h('h2', {}, title));
    const result = bodyBuilder(box, close) || {};
    const actions = h('div', { class: 'modal-actions' });
    if (result.onSave) {
      actions.append(
        h('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onclick: async () => { const v = await result.onSave(); if (v !== false) close(v); } }, result.saveLabel || 'Save')
      );
    } else {
      actions.append(h('button', { class: 'btn btn-primary', onclick: () => close(true) }, 'Close'));
    }
    box.appendChild(actions);
    back.appendChild(box);
    root.appendChild(back);
    const firstInput = box.querySelector('input, textarea, select');
    if (firstInput) firstInput.focus();
  });
}

function confirmDialog(title, message) {
  return modal(title, (box, close) => {
    box.append(h('p', { class: 'muted' }, message));
    return {
      saveLabel: 'Delete',
      onSave: () => { close(true); return true; }
    };
  });
}

// ---------------- mini markdown renderer with [S1] citation badges ----------------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(text) {
  let s = esc(text);
  s = s.replace(/\[S(\d+)\]/g, (_m, n) => `<span class="cite-badge" data-cite="${n}">S${n}</span>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
/** Render markdown-ish text to HTML. sourceMap: cite badge n -> source object */
function mdToHtml(src, onCite) {
  const lines = String(src || '').split('\n');
  let html = '', inList = false, inCode = false, para = [];
  const flushPara = () => {
    if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; }
  };
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      flushPara(); closeList();
      if (inCode) { html += '</pre>'; inCode = false; }
      else { html += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(raw) + '\n'; continue; }
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      flushPara(); closeList();
      const lvl = Math.min(hm[1].length + 1, 4);
      html += `<h${lvl}>${inline(hm[2])}</h${lvl}>`;
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      flushPara();
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</li>`;
      continue;
    }
    if (/^\s*>/.test(line)) { flushPara(); closeList(); html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); closeList();
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      html += `<table><tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr></table>`;
      continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line);
  }
  flushPara(); closeList();
  if (inCode) html += '</pre>';
  return html;
}

function renderMd(container, text, onCite) {
  container.innerHTML = `<div class="md">${mdToHtml(text)}</div>`;
  if (onCite) {
    $$('.cite-badge', container).forEach((b) => {
      b.addEventListener('click', () => onCite(parseInt(b.dataset.cite, 10)));
    });
  }
}

function downloadOrSave(defaultName, content, filters) {
  return API.saveTextFile(defaultName, content, filters).then((r) => {
    if (r.saved) toast(`Saved: ${r.saved}`, 'ok');
    return r.saved;
  });
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
