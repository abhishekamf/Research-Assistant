/**
 * Citation management: BibTeX/RIS parsing & export, formatted citations
 * (APA, MLA, Chicago, IEEE, Harvard, Vancouver). Pure JS, no heavy deps.
 */

// ---------- author parsing ----------
function splitAuthors(raw) {
  if (!raw) return [];
  let names;
  if (raw.includes(' and ')) names = raw.split(/\s+and\s+/i);
  else if (raw.includes(';')) names = raw.split(';');
  else if (raw.includes(',')) {
    // "Doe, J., Roe, J." pattern -> pair them
    const parts = raw.split(',').map((s) => s.trim());
    names = [];
    for (let i = 0; i < parts.length; i++) {
      if (/^([A-Z]\.)*[A-Z]$/.test(parts[i].replace(/\s/g, '')) && names.length) {
        names[names.length - 1] += `, ${parts[i]}`;
      } else names.push(parts[i]);
    }
  } else names = raw.split(/\s{2,}/);
  return names.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function parseAuthorName(name) {
  let last = name, first = '', particles = '';
  if (name.includes(',')) {
    const [l, f] = name.split(',');
    last = l.trim(); first = (f || '').trim();
  } else {
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) { last = parts.pop(); first = parts.join(' '); }
  }
  return { last, first, particles };
}

function initials(first) {
  return first.split(/\s+/).filter(Boolean).map((f) => `${f[0].toUpperCase()}.`).join(' ');
}

// ---------- BibTeX parsing ----------
function stripBraces(s) { return String(s || '').replace(/^\{+|\}+$/g, '').trim(); }

function parseBibtex(text) {
  const refs = [];
  const entryRe = /@(\w+)\s*\(\s*([^,]+),\s*([\s\S]*?)\n\s*\n|@(\w+)\s*\(\s*([^,]+),\s*([\s\S]*?)\}\s*(?=@|$)/g;
  // More reliable: manual scan of balanced braces per entry
  const src = String(text);
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at === -1) break;
    const typeM = src.slice(at).match(/^@(\w+)\s*\{\s*([^,\s]*)\s*,/);
    if (!typeM) { i = at + 1; continue; }
    const type = typeM[1].toLowerCase();
    const key = typeM[2];
    let depth = 1, j = at + typeM[0].length;
    let inQ = false;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '{' && !inQ) depth++;
      else if (c === '}' && !inQ) depth--;
      else if (c === '"') inQ = !inQ;
      j++;
    }
    const body = src.slice(at + typeM[0].length, j - 1);
    const fields = parseBibFields(body);
    refs.push(bibToRef(type, key, fields));
    i = j;
  }
  return refs;
}

function parseBibFields(body) {
  const fields = {};
  const re = /(\w+)\s*=\s*/g;
  let m;
  const positions = [];
  while ((m = re.exec(body))) positions.push({ name: m[1].toLowerCase(), start: m.index + m[0].length });
  for (let p = 0; p < positions.length; p++) {
    const start = positions[p].start;
    const end = p + 1 < positions.length ? commaBefore(body, positions[p + 1].start - positions[p + 1].name.length - 2) : body.length;
    let val = body.slice(start, end < start ? body.length : end).trim();
    if (val.startsWith('{')) val = stripBraces(val);
    else if (val.startsWith('"')) val = val.replace(/^"|"$/g, '').trim();
    fields[positions[p].name] = val.replace(/\s+/g, ' ').replace(/[{}]/g, '');
  }
  return fields;
}

function commaBefore(s, idx) {
  for (let i = Math.min(idx, s.length - 1); i >= 0; i--) if (s[i] === ',') return i;
  return s.length;
}

function bibToRef(type, key, f) {
  const T = { article: 'article', inproceedings: 'inproceedings', book: 'book', incollection: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', misc: 'misc', preprint: 'preprint' }[type] || 'misc';
  const pages = String(f.pages || '').replace(/--+/g, '-');
  return {
    id: `ref_${Math.random().toString(36).slice(2, 10)}`,
    type: T,
    key: key || '',
    title: f.title || '(untitled)',
    authors: splitAuthors(f.author || ''),
    editors: splitAuthors(f.editor || ''),
    year: parseInt((f.year || '').match(/\d{4}/) ? f.year.match(/\d{4}/)[0] : '0', 10) || null,
    venue: f.journal || f.booktitle || f.publisher || f.school || f.howpublished || '',
    volume: f.volume || '',
    issue: f.number || '',
    pages,
    doi: (f.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//, ''),
    url: f.url || '',
    publisher: f.publisher || '',
    address: f.address || '',
    abstract: f.abstract || '',
    keywords: f.keywords || '',
    addedAt: new Date().toISOString(),
    origin: 'import:bibtex'
  };
}

// ---------- RIS parsing ----------
function parseRis(text) {
  const refs = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/) || line.match(/^([A-Z][A-Z0-9])\s*-\s?(.*)$/);
    if (!m) continue;
    const tag = m[1], val = m[2].trim();
    if (tag === 'TY') { cur = { authors: [], type: 'article' }; }
    if (!cur) continue;
    switch (tag) {
      case 'TY': cur.type = ({ JOUR: 'article', CONF: 'inproceedings', BOOK: 'book', CHAP: 'chapter', THES: 'thesis', RPRT: 'report', UNPB: 'misc', PCONG: 'inproceedings' })[val] || (val === 'CHAP' ? 'chapter' : 'article'); break;
      case 'AU': case 'A1': cur.authors.push(val); break;
      case 'TI': case 'T1': cur.title = val; break;
      case 'PY': case 'Y1': cur.year = parseInt((val.match(/\d{4}/) || ['0'])[0], 10) || null; break;
      case 'JO': case 'JF': case 'T2': case 'JA': cur.venue = cur.venue || val; break;
      case 'VL': cur.volume = val; break;
      case 'IS': cur.issue = val; break;
      case 'SP': cur.pages = cur.pages ? `${val}-${cur.pages}` : val; break;
      case 'EP': cur.endPage = val; break;
      case 'DO': cur.doi = val.replace(/^https?:\/\/(dx\.)?doi\.org\//, ''); break;
      case 'UR': cur.url = val; break;
      case 'PB': cur.publisher = val; break;
      case 'AB': case 'N2': cur.abstract = val; break;
      case 'KW': cur.keywords = cur.keywords ? cur.keywords + ', ' + val : val; break;
      case 'ER': refs.push(finishRis(cur)); cur = null; break;
    }
  }
  if (cur) refs.push(finishRis(cur));
  return refs;
}

function finishRis(c) {
  if (c.endPage && c.pages) c.pages = c.pages.includes('-') ? c.pages : `${c.pages}-${c.endPage}`;
  return {
    id: `ref_${Math.random().toString(36).slice(2, 10)}`,
    type: c.type || 'article',
    key: '',
    title: c.title || '(untitled)',
    authors: c.authors.map((a) => a.trim()).filter(Boolean),
    year: c.year || null,
    venue: c.venue || '',
    volume: c.volume || '',
    issue: c.issue || '',
    pages: c.pages || '',
    doi: c.doi || '',
    url: c.url || '',
    publisher: c.publisher || '',
    address: '',
    abstract: c.abstract || '',
    keywords: c.keywords || '',
    addedAt: new Date().toISOString(),
    origin: 'import:ris'
  };
}

// ---------- Export ----------
function texSafe(s) { return String(s || '').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}'); }

function bibAuthorList(authors) {
  return authors.map((a) => {
    const { last, first, particles } = parseAuthorName(a);
    return texSafe([particles, last].filter(Boolean).join(' ').trim()) + (first ? `, ${initials(first)}` : '');
  }).join(' and ');
}

function refToBibtex(r) {
  const typeMap = { article: 'article', inproceedings: 'inproceedings', book: 'book', chapter: 'incollection', thesis: 'phdthesis', report: 'techreport', misc: 'misc', preprint: 'misc' };
  const t = typeMap[r.type] || 'article';
  const key = r.key || generateKey(r);
  const fields = [];
  fields.push(`  author     = {${bibAuthorList(r.authors || [])}}`);
  fields.push(`  title      = {${texSafe(r.title)}}`);
  if (r.year) fields.push(`  year       = {${r.year}}`);
  const venueField = t === 'inproceedings' ? 'booktitle' : (t === 'article' ? 'journal' : null);
  if (venueField && r.venue) fields.push(`  ${venueField.padEnd(10)} = {${texSafe(r.venue)}}`);
  if (r.publisher && t !== 'article') fields.push(`  publisher  = {${texSafe(r.publisher)}}`);
  if (r.volume) fields.push(`  volume     = {${r.volume}}`);
  if (r.issue) fields.push(`  number     = {${r.issue}}`);
  if (r.pages) fields.push(`  pages      = {${r.pages}}`);
  if (r.doi) fields.push(`  doi        = {${r.doi}}`);
  if (r.url) fields.push(`  url        = {${r.url}}`);
  return `@${t}{${key},\n${fields.join(',\n')}\n}`;
}

function generateKey(r) {
  const first = (r.authors && r.authors[0]) ? parseAuthorName(r.authors[0]).last : 'anon';
  return `${first.toLowerCase().replace(/[^a-z]/g, '')}${r.year || 'nd'}`;
}

function refToRis(r) {
  const typeMap = { article: 'JOUR', inproceedings: 'CONF', book: 'BOOK', chapter: 'CHAP', thesis: 'THES', report: 'RPRT', misc: 'GEN', preprint: 'JOUR' };
  const lines = [`TY  - ${typeMap[r.type] || 'JOUR'}`];
  for (const a of (r.authors || [])) {
    const { last, first } = parseAuthorName(a);
    lines.push(`AU  - ${last}${first ? `, ${initials(first)}` : ''}`);
  }
  lines.push(`TI  - ${r.title}`);
  if (r.year) lines.push(`PY  - ${r.year}`);
  if (r.venue) lines.push(`JO  - ${r.venue}`);
  if (r.volume) lines.push(`VL  - ${r.volume}`);
  if (r.issue) lines.push(`IS  - ${r.issue}`);
  if (r.pages) {
    const [sp, ep] = String(r.pages).split('-');
    lines.push(`SP  - ${sp}`);
    if (ep) lines.push(`EP  - ${ep}`);
  }
  if (r.doi) lines.push(`DO  - ${r.doi}`);
  if (r.url) lines.push(`UR  - ${r.url}`);
  if (r.publisher) lines.push(`PB  - ${r.publisher}`);
  if (r.abstract) lines.push(`AB  - ${r.abstract}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

// ---------- Formatted styles ----------
function authorListAPA(authors, max = 20) {
  if (!authors.length) return '';
  const parts = authors.slice(0, max).map((a) => {
    const { last, first } = parseAuthorName(a);
    return `${last}, ${initials(first)}`.replace(/,$/, '');
  });
  if (authors.length > max) return parts.join(', ') + ', ...';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ', & ' + parts[parts.length - 1];
}

function authorListMLA(authors) {
  if (!authors.length) return '';
  const fmt = authors.map((a) => {
    const { last, first } = parseAuthorName(a);
    return first ? `${last}, ${first}` : last;
  });
  if (fmt.length === 1) return fmt[0];
  if (fmt.length === 2) return `${fmt[0]}, and ${fmt[1]}`;
  return `${fmt[0]}, et al.`;
}

function venueC(r) { return [r.venue, r.volume ? `${r.volume}` : '', r.issue ? `(${r.issue})` : '', r.pages ? `, ${r.pages}` : ''].filter(Boolean).join(''); }

function formatRef(r, style = 'apa') {
  const a = r.authors || [];
  const year = r.year || 'n.d.';
  const t = r.title || '';
  const venue = r.venue || '';
  const vol = r.volume ? `, ${r.volume}` : '';
  const iss = r.issue ? `(${r.issue})` : '';
  const pp = r.pages ? `, ${r.pages}` : '';
  const doi = r.doi ? ` https://doi.org/${r.doi}` : (r.url ? ` ${r.url}` : '');

  switch (style) {
    case 'apa':
      return `${authorListAPA(a)} (${year}). ${t}.${venue ? ` *${venue}*${vol}${iss}${pp}.` : ''}${doi}`.trim();
    case 'mla':
      return `${authorListMLA(a)} "${t}."${venue ? ` *${venue}*${vol}${iss}${year}${pp ? ', ' + r.pages : ''}.` : ''}${r.doi ? ` https://doi.org/${r.doi}` : (r.url ? ` ${r.url}` : '')}`.trim();
    case 'chicago':
      return `${authorListMLA(a)} "${t}." ${venue}${vol}${iss} (${year})${pp ? ': ' + r.pages : ''}.${doi}`.trim();
    case 'ieee':
      return `${authorListAPA(a).replace(/, & /, ', and ')}, "${t}," ${venue}${vol ? ', vol. ' + r.volume : ''}${iss ? ', no. ' + r.issue.replace(/[()]/g, '') : ''}${pp ? ', pp. ' + r.pages : ''}, ${year}.${r.doi ? ` doi: ${r.doi}.` : ''}`.trim();
    case 'harvard':
      return `${authorListAPA(a).replace(/, & /, ' and ')} (${year}) '${t}', ${venue}${vol}${iss}${pp ? ', pp. ' + r.pages : ''}.${doi}`.trim();
    case 'vancouver':
      return `${a.slice(0, 6).map((x) => { const { last, first } = parseAuthorName(x); return `${last} ${initials(first)}`.trim(); }).join(', ')}${a.length > 6 ? ', et al.' : ''}. ${t}. ${venue}. ${year}${r.volume ? ';' + r.volume : ''}${r.issue ? '(' + r.issue + ')' : ''}${pp ? ':' + r.pages.replace('-', '–') : ''}.${r.doi ? ` doi:${r.doi}` : ''}`.trim();
    default:
      return formatRef(r, 'apa');
  }
}

/** In-text citation, e.g. (Sharma & Verma, 2023) */
function inTextCitation(r, style = 'apa') {
  const a = r.authors || [];
  let name;
  if (a.length === 0) name = r.venue || 'Anonymous';
  else if (a.length === 1) name = parseAuthorName(a[0]).last;
  else if (a.length === 2) name = `${parseAuthorName(a[0]).last} & ${parseAuthorName(a[1]).last}`;
  else name = `${parseAuthorName(a[0]).last} et al.`;
  if (style === 'mla' || style === 'chicago') return `(${name.replace(' & ', ' and ')}${r.year ? ' ' + r.year : ''})`;
  return `(${name}${r.year ? ', ' + r.year : ''})`;
}

module.exports = { parseBibtex, parseRis, refToBibtex, refToRis, formatRef, inTextCitation, splitAuthors, parseAuthorName, generateKey };
