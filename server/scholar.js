/**
 * Academic search across open scholarly APIs (no API keys required):
 *  - arXiv            : preprints (physics, CS, math, stats, q-bio...)
 *  - OpenAlex         : 250M+ works, comprehensive scholarly graph
 *  - Semantic Scholar : CS/biomed focused, citation counts
 *  - Crossref         : DOI registration agency metadata
 * Results are normalized and can be exported to BibTeX/RIS or imported
 * (with PDF download when an open-access copy exists) into the library.
 */
const { truncate } = require('./utils');

const UA = 'ResearchAI-Assistant/1.0 (mailto:abhishek.aks@gmail.com)';

async function getJSON(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function getText(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

/** Download binary content (e.g. open-access PDFs). */
async function getBinary(url, timeoutMs = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading PDF`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500 || buf.slice(0, 4).toString('latin1') !== '%PDF') {
      throw new Error('URL did not return a valid PDF');
    }
    return buf;
  } finally { clearTimeout(t); }
}

// ---------------- arXiv ----------------
function tinyTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}
function tinyTagsAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
  return out;
}

async function searchArxiv(query, limit = 10) {
  const q = encodeURIComponent(query.replace(/"/g, ''));
  const xml = await getText(`http://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=${limit}&sortBy=relevance`);
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const idUrl = tinyTag(e, 'id') || '';
    const authors = tinyTagsAll(e, 'name');
    const published = tinyTag(e, 'published');
    return {
      source: 'arxiv',
      sourceId: idUrl,
      title: tinyTag(e, 'title').replace(/\s+/g, ' '),
      authors,
      year: published ? new Date(published).getFullYear() : null,
      venue: 'arXiv preprint',
      abstract: tinyTag(e, 'summary').replace(/\s+/g, ' '),
      doi: (e.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/) || [])[1] || null,
      url: idUrl,
      pdfUrl: idUrl.replace('/abs/', '/pdf/'),
      citations: null
    };
  });
}

// ---------------- OpenAlex ----------------
function abstractFromInverted(inv) {
  if (!inv) return '';
  const pairs = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) pairs.push([p, word]);
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map((p) => p[1]).join(' ');
}

async function searchOpenAlex(query, limit = 10) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&mailto=abhishek.aks@gmail.com`;
  const j = await getJSON(url);
  return (j.results || []).map((w) => ({
    source: 'openalex',
    sourceId: w.id,
    title: (w.display_name || '').replace(/\s+/g, ' '),
    authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
    year: w.publication_year || null,
    venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || (w.type === 'preprint' ? 'preprint' : ''),
    abstract: truncate(abstractFromInverted(w.abstract_inverted_index), 1200),
    doi: w.doi ? w.doi.replace('https://doi.org/', '') : null,
    url: (w.primary_location && w.primary_location.landing_page_url) || w.doi || w.id,
    pdfUrl: w.best_oa_location && (w.best_oa_location.pdf_url || (w.best_oa_location.landing_page_url)),
    citations: w.cited_by_count ?? null
  }));
}

// ---------------- Semantic Scholar ----------------
async function searchSemanticScholar(query, limit = 10) {
  const fields = 'title,abstract,year,authors,externalIds,venue,citationCount,openAccessPdf,url';
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
  const j = await getJSON(url);
  return (j.data || []).map((w) => ({
    source: 'semantic_scholar',
    sourceId: w.paperId,
    title: (w.title || '').replace(/\s+/g, ' '),
    authors: (w.authors || []).map((a) => a.name),
    year: w.year || null,
    venue: w.venue || '',
    abstract: truncate(w.abstract || '', 1200),
    doi: (w.externalIds && w.externalIds.DOI) || null,
    url: w.url || '',
    pdfUrl: (w.openAccessPdf && w.openAccessPdf.url) || null,
    citations: w.citationCount ?? null
  }));
}

// ---------------- Crossref ----------------
async function searchCrossref(query, limit = 10) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&mailto=abhishek.aks@gmail.com`;
  const j = await getJSON(url);
  return ((j.message && j.message.items) || []).map((w) => ({
    source: 'crossref',
    sourceId: w.DOI,
    title: Array.isArray(w.title) ? (w.title[0] || '').replace(/\s+/g, ' ') : String(w.title || ''),
    authors: (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')),
    year: (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0] && w.issued['date-parts'][0][0]) || null,
    venue: (w['container-title'] && w['container-title'][0]) || w.publisher || '',
    abstract: truncate(String(w.abstract || '').replace(/<[^>]+>/g, ' '), 1200),
    doi: w.DOI || null,
    url: (w.URL) || (w.DOI ? `https://doi.org/${w.DOI}` : ''),
    pdfUrl: null,
    citations: (w['is-referenced-by-count'] != null) ? w['is-referenced-by-count'] : null
  }));
}

const SEARCHERS = {
  arxiv: searchArxiv,
  openalex: searchOpenAlex,
  semantic_scholar: searchSemanticScholar,
  crossref: searchCrossref
};

/**
 * Multi-source academic search. Returns deduplicated, citation-count-sorted results.
 */
async function searchAcademic(query, { sources = ['arxiv', 'openalex', 'semantic_scholar', 'crossref'], limit = 12 } = {}) {
  const jobs = sources
    .filter((s) => SEARCHERS[s])
    .map(async (s) => {
      try { return await SEARCHERS[s](query, Math.max(6, limit)); }
      catch (e) { return { error: `${s}: ${e.message}`, results: [] }; }
    });
  const settled = await Promise.allSettled(jobs);
  const all = [], errors = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    if (r.value && r.value.error) { errors.push(r.value.error); continue; }
    all.push(...(r.value || []));
  }
  // dedupe by normalized title (or DOI)
  const seen = new Map();
  for (const p of all) {
    const key = (p.doi ? `doi:${p.doi.toLowerCase()}` : `t:${p.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 90)}`);
    if (!p.title) continue;
    if (seen.has(key)) {
      const prev = seen.get(key);
      prev.pdfUrl = prev.pdfUrl || p.pdfUrl;
      prev.citations = prev.citations ?? p.citations;
      prev.sources = [...new Set([...(prev.sources || [prev.source]), p.source])];
    } else {
      p.sources = [p.source];
      seen.set(key, p);
    }
  }
  const results = [...seen.values()].sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, limit);
  return { results, errors };
}

module.exports = { searchAcademic, searchArxiv, searchOpenAlex, searchSemanticScholar, searchCrossref, getText, getBinary };
