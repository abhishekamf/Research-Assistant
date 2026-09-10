/** Small shared utilities for the server layer. */

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowISO() { return new Date().toISOString(); }

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Tokenize text into lowercase word tokens (letters+digits, unicode aware). */
function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9][a-z0-9'\-]*/g) || [];
}

/** FNV-1a 32-bit hash */
function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const STOPWORDS = new Set(('a,an,the,and,or,but,if,then,else,for,of,to,in,on,at,by,with,from,as,is,are,was,' +
  'were,be,been,being,this,that,these,those,it,its,we,our,you,your,they,their,he,she,his,her,not,no,yes,' +
  'can,could,should,would,may,might,will,shall,do,does,did,done,have,has,had,than,so,such,also,however,' +
  'which,who,whom,whose,what,when,where,why,how,all,any,each,more,most,other,some,into,over,under,between').split(','));

function contentTokens(text) {
  return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Robustly extract a JSON object/array from an LLM response.
 * Strips markdown fences, finds the first balanced {...} or [...] block.
 */
function safeJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/```(?:json)?/gi, '```');
  const fence = s.indexOf('```');
  if (fence !== -1) {
    const end = s.indexOf('```', fence + 3);
    if (end !== -1) s = s.slice(fence + 3, end).trim();
  }
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { /* keep scanning */ }
      }
    }
  }
  try { return JSON.parse(s.slice(start)); } catch { return null; }
}

/** Truncate text to ~maxChars on a sentence boundary. */
function truncate(text, maxChars) {
  const t = String(text || '');
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const m = cut.match(/.*[.!?](?=\s|$)/s);
  return (m ? m[0] : cut) + ' …';
}

/** Rough token estimate (~4 chars/token). */
function estTokens(text) { return Math.ceil(String(text || '').length / 4); }

function humanSize(bytes) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const DOC_EXTS = ['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.bib', '.ris'];

function extOf(p) {
  const m = String(p || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return m ? m[1] : '';
}

module.exports = {
  uid, nowISO, clamp, sleep, tokenize, contentTokens, fnv1a,
  safeJson, truncate, estTokens, humanSize, DOC_EXTS, extOf
};
