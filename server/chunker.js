/**
 * Text chunking with page awareness.
 * Splits page-wise (pages passed as array of {page, text}); long pages are
 * split at sentence boundaries with overlap so RAG retrieval stays precise.
 */
const { estTokens } = require('./utils');

function splitSentences(text) {
  const parts = String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;:])\s+(?=[A-Z(\[0-9"“'\-])|\s{2,}/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {Array<{page:number,text:string}>} pages
 * @param {{targetChars?:number, overlapChars?:number}} opts
 * @returns {Array<{text:string, page:number, tokens:number}>}
 */
function chunkPages(pages, opts = {}) {
  const target = opts.targetChars || 1600;
  const overlap = opts.overlapChars || 220;
  const chunks = [];
  for (const { page, text } of pages) {
    const clean = String(text || '').replace(/[ \t]+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length <= target + 200) {
      chunks.push({ text: clean, page, tokens: estTokens(clean) });
      continue;
    }
    const sentences = splitSentences(clean);
    let buf = '';
    const flush = () => {
      const t = buf.trim();
      if (t.length > 40) chunks.push({ text: t, page, tokens: estTokens(t) });
      // keep tail overlap for continuity
      buf = t.length > overlap ? t.slice(-overlap) : '';
    };
    for (const s of sentences) {
      if (buf.length + s.length > target && buf.length > 100) flush();
      buf += (buf && !buf.endsWith(' ') ? ' ' : '') + s;
    }
    const rest = buf.trim();
    if (rest.length > 40) chunks.push({ text: rest, page, tokens: estTokens(rest) });
  }
  return chunks;
}

module.exports = { chunkPages, splitSentences };
