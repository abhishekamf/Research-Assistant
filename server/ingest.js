/**
 * Document ingestion: PDF / DOCX / TXT / MD / CSV / XLSX / BibTeX / RIS -> pages of text.
 * Returns { title, pages: [{page, text}], kind, meta }.
 */
const fs = require('fs');
const path = require('path');
const { extOf, humanSize } = require('./utils');
const { chunkPages } = require('./chunker');
const { parseBibtex, parseRis } = require('./citations');

/** PDF text extraction with page numbers (pdfjs-dist, official maintained parser). */
async function extractPdf(buf) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let lastY, text = '';
      for (const item of tc.items) {
        if (lastY === item.transform[5] || lastY === undefined) text += item.str;
        else text += '\n' + item.str;
        lastY = item.transform[5];
      }
      pages.push({ page: i, text });
    } catch (e) {
      pages.push({ page: i, text: `[page ${i} could not be extracted: ${e.message}]` });
    }
  }
  const metaInfo = await doc.getMetadata().catch(() => ({}));
  const numPages = doc.numPages;
  doc.destroy();
  const meta = {
    pdfTitle: (metaInfo.info && metaInfo.info.Title) || '',
    pdfAuthor: (metaInfo.info && metaInfo.info.Author) || '',
    numPages
  };
  return { pages, meta };
}

async function extractDocx(buf) {
  const mammoth = require('mammoth/mammoth.browser.js').default || require('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = (result && result.value) || '';
  return { pages: paginate(text), meta: {} };
}

/** Split plain text into ~3000-char pseudo pages for consistent chunking. */
function paginate(text, size = 3000) {
  const out = [];
  const paras = String(text || '').split(/\n/);
  let buf = '', page = 1;
  for (const line of paras) {
    buf += line + '\n';
    if (buf.length >= size) { out.push({ page: page++, text: buf }); buf = ''; }
  }
  if (buf.trim()) out.push({ page, text: buf });
  return out;
}

function guessTitleFromText(text, fallback) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find((l) => l.length > 12 && l.length < 300);
  return first ? first.replace(/^#+\s*/, '').slice(0, 180) : fallback;
}

/**
 * Ingest a file from disk.
 * @returns {{doc:object, chunks:Array, refs:Array}} produced doc meta, chunks and any parsed references
 */
async function ingestFile(filePath) {
  const ext = extOf(filePath);
  const buf = fs.readFileSync(filePath);
  const base = path.basename(filePath, ext);
  let pages = [], kind = 'document', meta = {}, title = base, parsedRefs = [];

  switch (ext) {
    case '.pdf': {
      const r = await extractPdf(buf);
      pages = r.pages; meta = r.meta; kind = 'pdf';
      title = meta.pdfTitle || guessTitleFromText(pages[0] && pages[0].text, base);
      break;
    }
    case '.docx': {
      const r = await extractDocx(buf);
      pages = r.pages; kind = 'docx';
      title = guessTitleFromText(pages[0] && pages[0].text, base);
      break;
    }
    case '.txt': case '.md': {
      const text = buf.toString('utf8');
      pages = paginate(text); kind = ext === '.md' ? 'markdown' : 'text';
      title = guessTitleFromText(text, base);
      break;
    }
    case '.csv': {
      const text = buf.toString('utf8');
      const { headers, rows } = parseCsvBasic(text);
      const preview = rows.slice(0, 400).map((r) => r.join(' | ')).join('\n');
      const textBody = `Dataset file: ${base}\nColumns: ${headers.join(', ')}\nRows: ${rows.length}\n\n` +
        `Header row:\n${headers.join(' | ')}\n\nFirst rows:\n${preview}`;
      pages = paginate(textBody); kind = 'dataset';
      meta = { columns: headers, rowCount: rows.length };
      title = base;
      break;
    }
    case '.xlsx': {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      const parts = [];
      let columns = [], rowCount = 0;
      for (const name of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        const parsed = parseCsvBasic(csv);
        columns = parsed.headers; rowCount += parsed.rows.length;
        parts.push(`Sheet: ${name}\n${parsed.headers.join(' | ')}\n` + parsed.rows.slice(0, 200).map((r) => r.join(' | ')).join('\n'));
      }
      pages = paginate(`Spreadsheet: ${base}\n\n${parts.join('\n\n')}`); kind = 'dataset';
      meta = { columns, rowCount, sheets: wb.SheetNames };
      title = base;
      break;
    }
    case '.bib': {
      parsedRefs = parseBibtex(buf.toString('utf8'));
      const textBody = `Bibliography file: ${base}\n\n` + parsedRefs
        .map((r) => `${r.authors.join(', ')} (${r.year}). ${r.title}. ${r.venue || ''}.`).join('\n');
      pages = paginate(textBody); kind = 'bibliography';
      title = base;
      break;
    }
    case '.ris': {
      parsedRefs = parseRis(buf.toString('utf8'));
      const textBody = `Bibliography file: ${base}\n\n` + parsedRefs
        .map((r) => `${r.authors.join(', ')} (${r.year}). ${r.title}. ${r.venue || ''}.`).join('\n');
      pages = paginate(textBody); kind = 'bibliography';
      title = base;
      break;
    }
    default:
      // try UTF-8 as a last resort
      const text = buf.toString('utf8');
      pages = paginate(text); kind = 'text';
      title = guessTitleFromText(text, base);
  }

  const chunks = chunkPages(pages);
  const doc = {
    id: `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: title || base,
    fileName: path.basename(filePath),
    filePath,
    kind,
    bytes: buf.length,
    pages: pages.length,
    addedAt: new Date().toISOString(),
    status: chunks.length ? 'ready' : 'empty',
    error: '',
    authors: meta.pdfAuthor ? [meta.pdfAuthor] : [],
    year: guessYear(pages.map((p) => p.text).join(' ').slice(0, 4000)),
    doi: findDoi(pages.map((p) => p.text).join(' ').slice(0, 6000)),
    meta
  };
  return { doc, chunks, refs: parsedRefs };
}

function guessYear(text) {
  const years = String(text || '').match(/\b(19|20)\d{2}\b/g) || [];
  if (!years.length) return null;
  const counts = {};
  for (const y of years) counts[y] = (counts[y] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const recent = sorted.filter(([y]) => +y <= new Date().getFullYear() + 1);
  return recent.length ? +recent[0][0] : null;
}

function findDoi(text) {
  const m = String(text || '').match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return m ? m[0].replace(/[.,;)]$/, '') : null;
}

/** Minimal but correct CSV parser (quotes, escaped quotes, CRLF). */
function parseCsvBasic(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const headers = rows.length ? rows[0].map((h, i) => (h.trim() || `col_${i + 1}`)) : [];
  const data = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  return { headers, rows: data };
}

module.exports = { ingestFile, extractPdf, extractDocx, paginate, parseCsvBasic, guessYear, findDoi };
