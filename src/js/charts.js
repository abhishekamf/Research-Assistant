/** Lightweight SVG chart builders (no external libraries). */

function svgWrap(w, hgt, inner) {
  return `<svg viewBox="0 0 ${w} ${hgt}" width="100%" style="max-width:${w}px;background:var(--bg1);border-radius:10px;border:1px solid var(--line)">${inner}</svg>`;
}

/** Histogram from {min,max,width,bins:[{from,to,count}]} */
function chartHistogram(hh, w = 560, height = 220, color = 'var(--accent)') {
  if (!hh || !hh.bins || !hh.bins.length) return '<div class="faint small">No data</div>';
  const pad = 34, maxC = Math.max(...hh.bins.map((b) => b.count), 1);
  const bw = (w - pad * 2) / hh.bins.length;
  let bars = '', labels = '';
  hh.bins.forEach((b, i) => {
    const bh = (b.count / maxC) * (height - pad * 2);
    bars += `<rect x="${pad + i * bw + 1}" y="${height - pad - bh}" width="${bw - 2}" height="${bh}" rx="3" fill="${color}" opacity="0.85"><title>${b.from.toFixed(2)} – ${b.to.toFixed(2)}: ${b.count}</title></rect>`;
    if (i % Math.ceil(hh.bins.length / 8) === 0) labels += `<text x="${pad + i * bw + bw / 2}" y="${height - 12}" fill="var(--faint)" font-size="9" text-anchor="middle">${b.from.toFixed(1)}</text>`;
  });
  return svgWrap(w, height, `${bars}${labels}<line x1="${pad}" y1="${height - pad}" x2="${w - pad}" y2="${height - pad}" stroke="var(--line)"/>`);
}

/** Scatter with optional regression line. pts: [{x,y}], line: {m,b} */
function chartScatter(pts, line, w = 560, height = 300, xLabel = '', yLabel = '') {
  if (!pts || !pts.length) return '<div class="faint small">No data</div>';
  const pad = 44;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (v) => pad + (v - minX) / ((maxX - minX) || 1) * (w - pad * 2);
  const sy = (v) => height - pad - (v - minY) / ((maxY - minY) || 1) * (height - pad * 2);
  let dots = pts.slice(0, 3000).map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" fill="var(--accent2)" opacity="0.65"><title>(${p.x.toFixed(2)}, ${p.y.toFixed(2)})</title></circle>`).join('');
  let lineEl = '';
  if (line) {
    const y1 = line.m * minX + line.b, y2 = line.m * maxX + line.b;
    lineEl = `<line x1="${sx(minX)}" y1="${sy(y1)}" x2="${sx(maxX)}" y2="${sy(y2)}" stroke="var(--bad)" stroke-width="2" stroke-dasharray="6 4"/>`;
  }
  const axes = `<line x1="${pad}" y1="${height - pad}" x2="${w - pad / 2}" y2="${height - pad}" stroke="var(--line)"/>
    <line x1="${pad}" y1="${pad / 2}" x2="${pad}" y2="${height - pad}" stroke="var(--line)"/>
    <text x="${w / 2}" y="${height - 8}" fill="var(--faint)" font-size="11" text-anchor="middle">${xLabel}</text>
    <text x="12" y="${height / 2}" fill="var(--faint)" font-size="11" text-anchor="middle" transform="rotate(-90 12 ${height / 2})">${yLabel}</text>
    <text x="${pad}" y="${height - pad + 14}" fill="var(--faint)" font-size="9" text-anchor="middle">${minX.toFixed(1)}</text>
    <text x="${w - pad}" y="${height - pad + 14}" fill="var(--faint)" font-size="9" text-anchor="middle">${maxX.toFixed(1)}</text>`;
  return svgWrap(w, height, dots + lineEl + axes);
}

/** Correlation heatmap. labels: [names], matrix: [[r]] */
function chartHeatmap(labels, matrix, w = 620) {
  const n = labels.length;
  if (!n) return '';
  const cell = Math.min(56, (w - 130) / n);
  const height = 90 + n * cell;
  const color = (r) => {
    const a = Math.min(Math.abs(r), 1);
    return r >= 0 ? `rgba(124,108,255,${0.12 + a * 0.8})` : `rgba(248,113,113,${0.12 + a * 0.8})`;
  };
  let out = '';
  matrix.forEach((row, i) => {
    row.forEach((r, j) => {
      out += `<rect x="${110 + j * cell}" y="${70 + i * cell}" width="${cell - 2}" height="${cell - 2}" rx="4" fill="${color(r)}"><title>${labels[i]} × ${labels[j]}: r=${r}</title></rect>`;
      if (cell > 30) out += `<text x="${110 + j * cell + cell / 2 - 1}" y="${70 + i * cell + cell / 2 + 3}" fill="#fff" font-size="9.5" text-anchor="middle">${r.toFixed(2)}</text>`;
    });
    out += `<text x="104" y="${70 + i * cell + cell / 2 + 3}" fill="var(--muted)" font-size="10" text-anchor="end">${labels[i].slice(0, 14)}</text>`;
    out += `<text x="${110 + i * cell + cell / 2 - 1}" y="62" fill="var(--muted)" font-size="10" text-anchor="start" transform="rotate(-45 ${110 + i * cell + cell / 2 - 1} 62)">${labels[i].slice(0, 14)}</text>`;
  });
  return svgWrap(w, height, out);
}

/** Simple bar chart. items: [{label, value, color?}] */
function chartBars(items, w = 560, height = 240, horizontal = false) {
  if (!items || !items.length) return '';
  const pad = 40;
  const maxV = Math.max(...items.map((i) => Math.abs(i.value)), 0.0001);
  if (horizontal) {
    const rowH = Math.min(30, (height - pad) / items.length);
    const labelW = 150;
    let out = items.map((it, i) => {
      const bw = (Math.abs(it.value) / maxV) * (w - labelW - pad);
      const y = 10 + i * rowH;
      return `<text x="${labelW - 8}" y="${y + rowH / 2 + 3}" fill="var(--muted)" font-size="10" text-anchor="end">${String(it.label).slice(0, 22)}</text>
        <rect x="${labelW}" y="${y + 4}" width="${bw}" height="${rowH - 8}" rx="4" fill="${it.color || 'var(--accent)'}" opacity="0.85"><title>${it.label}: ${it.value}</title></rect>
        <text x="${labelW + bw + 6}" y="${y + rowH / 2 + 3}" fill="var(--faint)" font-size="10">${it.value}</text>`;
    }).join('');
    return svgWrap(w, Math.max(height, 10 + items.length * rowH + 10), out);
  }
  const bw = (w - pad * 2) / items.length;
  let out = items.map((it, i) => {
    const bh = (Math.abs(it.value) / maxV) * (height - pad * 2);
    const x = pad + i * bw;
    return `<rect x="${x + 2}" y="${height - pad - bh}" width="${bw - 4}" height="${bh}" rx="4" fill="${it.color || 'var(--accent)'}" opacity="0.85"><title>${it.label}: ${it.value}</title></rect>
      <text x="${x + bw / 2}" y="${height - pad + 13}" fill="var(--faint)" font-size="9" text-anchor="middle">${String(it.label).slice(0, 10)}</text>`;
  }).join('');
  return svgWrap(w, height, out + `<line x1="${pad}" y1="${height - pad}" x2="${w - pad / 2}" y2="${height - pad}" stroke="var(--line)"/>`);
}

/** Literature map bubbles. layout: [{docId,title,x,y,cluster}], themes: [{title}] */
const MAP_COLORS = ['#7c6cff', '#4dd6ff', '#4ade80', '#fbbf24', '#f87171', '#f472b6', '#a3e635', '#fb923c'];
function chartLitMap(layout, themes, onPick) {
  const w = 860, height = 560;
  const size = layout.length;
  const r = Math.max(14, Math.min(34, 900 / Math.sqrt(size) / 4));
  let out = '';
  layout.forEach((d) => {
    const c = MAP_COLORS[d.cluster % MAP_COLORS.length];
    out += `<g class="map-bubble" data-doc="${d.docId}" style="cursor:pointer">
      <circle cx="${(d.x / 100) * w}" cy="${(d.y / 100) * height}" r="${r}" fill="${c}" opacity="0.8" stroke="#fff" stroke-opacity="0.25"><title>${d.title}</title></circle>
      <text x="${(d.x / 100) * w}" y="${(d.y / 100) * height}" fill="#fff" font-size="9" text-anchor="middle" pointer-events="none">${d.cluster + 1}</text>
    </g>`;
  });
  themes.forEach((t, i) => {
    const members = layout.filter((l) => l.cluster === i);
    if (!members.length) return;
    const cx = members.reduce((s, m) => s + (m.x / 100) * w, 0) / members.length;
    const cy = members.reduce((s, m) => s + (m.y / 100) * height, 0) / members.length;
    out += `<text x="${cx}" y="${cy - r - 26}" fill="${MAP_COLORS[i % MAP_COLORS.length]}" font-size="12.5" font-weight="600" text-anchor="middle" font-family="Georgia, serif">${t.title}</text>`;
  });
  const el = h('div', { class: 'map-wrap' });
  el.innerHTML = svgWrap(w, height, out);
  if (onPick) {
    $$('.map-bubble', el).forEach((g) => g.addEventListener('click', () => onPick(g.dataset.doc)));
  }
  return el;
}
