/**
 * Pure-JS statistics engine for the Data Lab.
 * Descriptives, correlations, t-tests, one-way ANOVA, chi-square, OLS
 * regression, Cronbach's alpha (questionnaire reliability), k-means and PCA.
 * p-values computed via regularized incomplete beta/gamma functions.
 */
const { parseCsvBasic } = require('./ingest');
const fs = require('fs');

// ---------- special functions ----------
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5, ser = 1.000000000190015;
  tmp -= (x + 0.5) * Math.log(tmp);
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Regularized incomplete beta I_x(a,b) via continued fraction (NR). */
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Regularized lower incomplete gamma P(a,x) (for chi-square). */
function gammq(a, x) { // upper regularized Q(a,x)
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaCF(a, x);
}
function gammaSeries(a, x) {
  const EPS = 3e-16, FPMIN = 1e-300;
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 500; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  const ln = -x + a * Math.log(x) - logGamma(a);
  return Math.max(0, Math.min(1, sum * Math.exp(ln))) || FPMIN && sum * Math.exp(ln);
}
function gammaCF(a, x) {
  const EPS = 3e-16, FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
}
function gammaP(a, x) { return 1 - gammq(a, x); }

function erf(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 +
    t * 0.17087277)))))))));
  return x >= 0 ? 1 - y : y - 1;
}
function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

// ---------- basic stats ----------
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
function variance(a, sample = true) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return sum(a.map((x) => (x - m) ** 2)) / (a.length - (sample ? 1 : 0));
}
const sd = (a, sample = true) => Math.sqrt(variance(a, sample));
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}
function skewness(a) {
  const n = a.length, m = mean(a), s = sd(a);
  if (!s || n < 3) return NaN;
  return (n / ((n - 1) * (n - 2))) * sum(a.map((x) => ((x - m) / s) ** 3));
}
function kurtosis(a) {
  const n = a.length, m = mean(a), s = sd(a);
  if (!s || n < 4) return NaN;
  return sum(a.map((x) => ((x - m) / s) ** 4)) / n - 3;
}

// ---------- correlation ----------
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { r: NaN, p: NaN, n };
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const r = sxy / Math.sqrt(sxx * syy || 1e-300);
  const df = n - 2;
  const t = Math.abs(r) >= 1 ? Infinity : Math.abs(r) * Math.sqrt(df / (1 - r * r));
  return { r, p: tDistTwoTailP(t, df), n };
}

function rankify(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const ranks = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avgRank;
    i = j + 1;
  }
  return ranks;
}
function spearman(x, y) { return pearson(rankify(x), rankify(y)); }

// ---------- t-tests ----------
function tDistTwoTailP(t, df) {
  t = Math.abs(t);
  if (!isFinite(t)) return 0;
  // two-tailed p = 2 * I_{df/(df+t^2)}(df/2, 1/2)
  return betai(df / 2, 0.5, df / (df + t * t));
}

function tTestIndependent(a, b) {
  const n1 = a.length, n2 = b.length;
  const m1 = mean(a), m2 = mean(b);
  const v1 = variance(a), v2 = variance(b);
  // Welch's t
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = (m1 - m2) / (se || 1e-300);
  const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  return { t, df, p: tDistTwoTailP(t, df), mean1: m1, mean2: m2, n1, n2, cohenD: (m1 - m2) / Math.sqrt((v1 * (n1 - 1) + v2 * (n2 - 1)) / (n1 + n2 - 2) || 1e-300) };
}

function tTestOneSample(a, mu = 0) {
  const n = a.length, m = mean(a), s = sd(a);
  const t = (m - mu) / (s / Math.sqrt(n) || 1e-300);
  return { t, df: n - 1, p: tDistTwoTailP(t, n - 1), mean: m, mu };
}

// ---------- ANOVA ----------
function anovaOneWay(groups) {
  const k = groups.length;
  const all = groups.flat();
  const N = all.length;
  const grand = mean(all);
  const ssb = sum(groups.map((g) => g.length * (mean(g) - grand) ** 2));
  const ssw = sum(groups.map((g) => sum(g.map((x) => (x - mean(g)) ** 2))));
  const df1 = k - 1, df2 = N - k;
  const F = (ssb / df1) / (ssw / df2 || 1e-300);
  const p = betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * F));
  const etaSq = ssb / (ssb + ssw || 1e-300);
  return { F, df1, df2, p, etaSq, groupMeans: groups.map((g) => mean(g)), groupSd: groups.map((g) => sd(g)), groupN: groups.map((g) => g.length), N };
}

// ---------- chi-square ----------
function chiSquareTest(matrix) {
  const rows = matrix.length, cols = matrix[0].length;
  const rowSums = matrix.map((r) => sum(r));
  const colSums = Array.from({ length: cols }, (_, j) => sum(matrix.map((r) => r[j])));
  const N = sum(rowSums);
  let chi2 = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = rowSums[i] * colSums[j] / N;
      if (e > 0) chi2 += (matrix[i][j] - e) ** 2 / e;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const p = gammq(df / 2, chi2 / 2);
  const n = N;
  const cramersV = Math.sqrt(chi2 / (n * (Math.min(rows, cols) - 1 || 1)));
  return { chi2, df, p, cramersV, rowSums, colSums, N, expected: matrix.map((r, i) => r.map((_, j) => rowSums[i] * colSums[j] / N)) };
}

// ---------- OLS regression ----------
function ols(y, X) {
  // X: n x p (no intercept; we add one)
  const n = y.length;
  const p = X[0].length;
  const A = X.map((row, i) => [1, ...row]);
  const P = p + 1;
  // X'X
  const XtX = Array.from({ length: P }, (_, i) => Array.from({ length: P }, (_, j) => sum(A.map((r) => r[i] * r[j]))));
  const Xty = Array.from({ length: P }, (_, i) => sum(A.map((r, k) => r[i] * y[k])));
  // Solve via Gaussian elimination with partial pivoting
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < P; col++) {
    let piv = col;
    for (let r = col + 1; r < P; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return { ok: false, error: 'Singular matrix (check for perfectly correlated / constant predictors)' };
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < P; r++) {
      const f = M[r][col] / M[col][col];
      for (let c2 = col; c2 <= P; c2++) M[r][c2] -= f * M[col][c2];
    }
  }
  const beta = new Array(P).fill(0);
  for (let r = P - 1; r >= 0; r--) {
    let s = M[r][P];
    for (let c2 = r + 1; c2 < P; c2++) s -= M[r][c2] * beta[c2];
    beta[r] = s / M[r][r];
  }
  const fitted = A.map((row) => sum(row.map((v, i) => v * beta[i])));
  const resid = y.map((v, i) => v - fitted[i]);
  const ssr = sum(resid.map((e) => e * e));
  const sst = sum(y.map((v) => (v - mean(y)) ** 2));
  const r2 = 1 - ssr / (sst || 1e-300);
  const adjR2 = 1 - (1 - r2) * (n - 1) / (n - P || 1);
  const df = n - P;
  const mse = ssr / (df || 1);
  // standard errors from (X'X)^-1 diagonal
  const inv = invert(XtX);
  const se = beta.map((b, i) => Math.sqrt((inv && inv[i][i] || 0) * mse));
  const tStats = beta.map((b, i) => b / (se[i] || 1e-300));
  const pVals = tStats.map((t) => (df > 0 ? tDistTwoTailP(t, df) : NaN));
  const F = (r2 / (P - 1)) / ((1 - r2) / (df || 1e-300));
  const Fp = df > 0 ? betai(df / 2, (P - 1) / 2, df / (df + F * (P - 1))) : NaN;
  return { ok: true, beta, se, t: tStats, p: pVals, r2, adjR2, F, Fp, df, n, fitted, resid };
}

function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let c2 = 0; c2 < 2 * n; c2++) A[col][c2] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c2 = 0; c2 < 2 * n; c2++) A[r][c2] -= f * A[col][c2];
    }
  }
  return A.map((row) => row.slice(n));
}

// ---------- Cronbach's alpha (questionnaire reliability) ----------
function cronbachAlpha(items) {
  // items: array of columns (each an array of respondent scores, same length k)
  const k = items.length;
  if (k < 2) return { alpha: NaN, k, error: 'Need at least 2 items' };
  const n = items[0].length;
  const itemVar = sum(items.map((it) => variance(it)));
  const totals = Array.from({ length: n }, (_, i) => sum(items.map((it) => it[i])));
  const totalVar = variance(totals);
  const alpha = (k / (k - 1)) * (1 - itemVar / (totalVar || 1e-300));
  return { alpha, k, n };
}

// ---------- k-means & PCA (literature mapping) ----------
function kmeans(points, k, iters = 30) {
  const n = points.length, dim = points[0].length;
  k = Math.min(k, n);
  // k-means++ init
  const centers = [points[Math.floor(Math.random() * n)].slice()];
  while (centers.length < k) {
    const d2 = points.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
    const total = sum(d2);
    let r = Math.random() * total, idx = 0;
    for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { idx = i; break; } }
    centers.push(points[idx].slice());
  }
  let assign = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(points[i], centers[c]);
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    const sums = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) { counts[assign[i]]++; for (let j = 0; j < dim; j++) sums[assign[i]][j] += points[i][j]; }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) { centers[c] = points[Math.floor(Math.random() * n)].slice(); continue; }
      for (let j = 0; j < dim; j++) centers[c][j] = sums[c][j] / counts[c];
    }
    if (!changed && it > 2) break;
  }
  return { assign: assign, centers, k };
}

function dist2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; }

/** 2-D PCA projection (power iteration + deflation). */
function pca2d(points) {
  const n = points.length, dim = points[0].length;
  const mu = new Float64Array(dim);
  for (const p of points) for (let j = 0; j < dim; j++) mu[j] += p[j] / n;
  const X = points.map((p) => p.map((v, j) => v - mu[j]));

  function power(rows) {
    let v = new Float64Array(dim);
    for (let j = 0; j < dim; j++) v[j] = Math.random() - 0.5;
    for (let it = 0; it < 80; it++) {
      const nv = new Float64Array(dim);
      for (const row of rows) {
        let d = 0;
        for (let j = 0; j < dim; j++) d += row[j] * v[j];
        for (let j = 0; j < dim; j++) nv[j] += d * row[j];
      }
      // normalize by Euclidean norm (standard power iteration)
      let norm2 = 0;
      for (let j = 0; j < dim; j++) norm2 += nv[j] * nv[j];
      norm2 = Math.sqrt(norm2) || 1;
      for (let j = 0; j < dim; j++) nv[j] /= norm2;
      v = nv;
    }
    return v;
  }

  const v1 = power(X);
  const proj1 = X.map((row) => sum(row.map((v, j) => v * v1[j])));
  const X2 = X.map((row, i) => row.map((v, j) => v - proj1[i] * v1[j]));
  const v2 = power(X2);
  const proj2 = X2.map((row) => sum(row.map((v, j) => v * v2[j])));
  return { x: proj1, y: proj2 };
}

// ---------- CSV data prep ----------
const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '.']);
function isMissing(v) { return MISSING.has(String(v).trim().toLowerCase()); }

function toNumber(v) {
  if (isMissing(v)) return null;
  const n = parseFloat(String(v).replace(/[,\s]/g, '').replace(/^\$/, '').replace(/%$/, ''));
  return isFinite(n) ? n : null;
}

function inferColumns(headers, rows) {
  return headers.map((h, j) => {
    const raw = rows.map((r) => r[j]);
    const nums = raw.filter((v) => !isMissing(v));
    const numericVals = nums.map(toNumber).filter((v) => v !== null);
    const missingCount = raw.length - nums.length + nums.length - numericVals.length;
    const isNumeric = nums.length > 0 && numericVals.length / nums.length > 0.9;
    if (isNumeric) {
      const vals = raw.map((v) => toNumber(v)).filter((v) => v !== null);
      return { name: h, index: j, type: 'numeric', missing: missingCount, unique: new Set(nums).size,
        min: Math.min(...vals), max: Math.max(...vals), mean: mean(vals), median: median(vals), sd: sd(vals) };
    }
    const uniques = [...new Set(nums)];
    const isCategorical = uniques.length <= Math.max(25, raw.length * 0.5);
    return { name: h, index: j, type: isCategorical ? 'categorical' : 'text', missing: missingCount,
      unique: uniques.length, levels: uniques.slice(0, 40) };
  });
}

/** Load a CSV/XLSX file into { headers, rows } (cached by path+mtime). */
let _cache = { path: null, mtime: 0, data: null };
function loadTable(filePath) {
  const st = fs.statSync(filePath);
  if (_cache.path === filePath && _cache.mtime === st.mtimeMs) return _cache.data;
  let headers, rows;
  if (filePath.toLowerCase().endsWith('.xlsx') || filePath.toLowerCase().endsWith('.xls')) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    ({ headers, rows } = parseCsvBasic(csv));
  } else {
    ({ headers, rows } = parseCsvBasic(fs.readFileSync(filePath, 'utf8')));
  }
  const data = { headers, rows, columns: inferColumns(headers, rows), rowCount: rows.length };
  _cache = { path: filePath, mtime: st.mtimeMs, data };
  return data;
}

// ---------- analysis runners ----------
function numericCol(table, name) {
  const j = table.headers.indexOf(name);
  if (j === -1) throw new Error(`Column "${name}" not found`);
  return table.rows.map((r) => toNumber(r[j])).filter((v) => v !== null);
}

function pairedComplete(table, colA, colB) {
  const ja = table.headers.indexOf(colA), jb = table.headers.indexOf(colB);
  const a = [], b = [];
  for (const r of table.rows) {
    const va = toNumber(r[ja]), vb = toNumber(r[jb]);
    if (va !== null && vb !== null) { a.push(va); b.push(vb); }
  }
  return [a, b];
}

function groupValues(table, valueCol, groupCol) {
  const jv = table.headers.indexOf(valueCol), jg = table.headers.indexOf(groupCol);
  if (jv === -1 || jg === -1) throw new Error('Column not found');
  const groups = new Map();
  for (const r of table.rows) {
    const v = toNumber(r[jv]);
    const g = isMissing(r[jg]) ? '(missing)' : String(r[jg]).trim() || '(blank)';
    if (v === null) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }
  return [...groups.entries()].map(([name, values]) => ({ name, values })).filter((g) => g.values.length >= 2);
}

function histogram(values, bins = 12) {
  if (!values.length) return { bins: [], min: 0, max: 0 };
  const min = Math.min(...values), max = Math.max(...values);
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / width))]++;
  return { min, max, width, bins: counts.map((c, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: c })) };
}

function crosstab(table, colA, colB, maxLevels = 8) {
  const ja = table.headers.indexOf(colA), jb = table.headers.indexOf(colB);
  const levelsA = new Map(), levelsB = new Map();
  const pairs = [];
  for (const r of table.rows) {
    if (isMissing(r[ja]) || isMissing(r[jb])) continue;
    const a = String(r[ja]).trim() || '(blank)';
    const b = String(r[jb]).trim() || '(blank)';
    pairs.push([a, b]);
    if (!levelsA.has(a)) levelsA.set(a, levelsA.size);
    if (!levelsB.has(b)) levelsB.set(b, levelsB.size);
  }
  // collapse rare levels
  const topA = [...levelsA.entries()].sort((x, y) => y[0].localeCompare(x[0]));
  let aNames = [...new Set(pairs.map((p) => p[0]))];
  let bNames = [...new Set(pairs.map((p) => p[1]))];
  if (aNames.length > maxLevels) {
    const counts = {}; pairs.forEach((p) => counts[p[0]] = (counts[p[0]] || 0) + 1);
    aNames = aNames.sort((x, y) => counts[y] - counts[x]).slice(0, maxLevels - 1);
    aNames.push('(other)');
  }
  if (bNames.length > maxLevels) {
    const counts = {}; pairs.forEach((p) => counts[p[1]] = (counts[p[1]] || 0) + 1);
    bNames = bNames.sort((x, y) => counts[y] - counts[x]).slice(0, maxLevels - 1);
    bNames.push('(other)');
  }
  const ai = (v) => { const i = aNames.indexOf(v); return i === -1 ? aNames.length - 1 : i; };
  const bi = (v) => { const i = bNames.indexOf(v); return i === -1 ? bNames.length - 1 : i; };
  const matrix = aNames.map(() => bNames.map(() => 0));
  for (const [a, b] of pairs) matrix[ai(a)][bi(b)]++;
  return { aNames, bNames, matrix, ...chiSquareTest(matrix) };
}

/** Run an analysis. analysis: descriptives|correlation|compare|regression|crosstab|reliability|frequency */
function runAnalysis(table, analysis, params = {}) {
  switch (analysis) {
    case 'descriptives': {
      const cols = params.columns || table.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
      const rows = cols.map((name) => {
        const v = numericCol(table, name);
        return { name, n: v.length, mean: mean(v), sd: sd(v), median: median(v), min: Math.min(...v), max: Math.max(...v), q1: quantile(v, 0.25), q3: quantile(v, 0.75), skew: skewness(v), kurtosis: kurtosis(v), histogram: histogram(v) };
      });
      return { analysis, rows };
    }
    case 'correlation': {
      const cols = (params.columns || table.columns.filter((c) => c.type === 'numeric').map((c) => c.name)).slice(0, 12);
      const matrix = [], pairs = [];
      for (let i = 0; i < cols.length; i++) {
        matrix.push([]);
        for (let j = 0; j < cols.length; j++) {
          if (i === j) { matrix[i].push(1); continue; }
          if (j < i) { matrix[i].push(matrix[j][i]); continue; }
          const [a, b] = pairedComplete(table, cols[i], cols[j]);
          const pr = pearson(a, b);
          const sp = spearman(a, b);
          matrix[i].push(Number(pr.r.toFixed(3)));
          pairs.push({ a: cols[i], b: cols[j], r: pr.r, p: pr.p, rho: sp.r, rhoP: sp.p, n: pr.n });
        }
      }
      return { analysis, columns: cols, matrix, pairs: pairs.filter((p) => isFinite(p.r)) };
    }
    case 'compare': {
      const groups = groupValues(table, params.valueColumn, params.groupColumn).slice(0, 8);
      if (groups.length < 2) throw new Error('Need at least 2 groups with >=2 numeric values');
      if (groups.length === 2) {
        const t = tTestIndependent(groups[0].values, groups[1].values);
        return { analysis, test: 'welch-t', groups, result: t };
      }
      const a = anovaOneWay(groups.map((g) => g.values));
      return { analysis, test: 'anova', groups, result: a };
    }
    case 'regression': {
      const y = numericCol(table, params.dependent);
      const predCols = params.independents;
      const rowsIdx = [];
      const Xrows = [];
      const yv = [];
      const jIdx = predCols.map((c) => table.headers.indexOf(c));
      for (let i = 0; i < table.rows.length; i++) {
        const yvRaw = toNumber(table.rows[i][table.headers.indexOf(params.dependent)]);
        if (yvRaw === null) continue;
        const xs = jIdx.map((j) => toNumber(table.rows[i][j]));
        if (xs.some((v) => v === null)) continue;
        Xrows.push(xs); yv.push(yvRaw);
      }
      const r = ols(yv, Xrows);
      if (!r.ok) throw new Error(r.error);
      return {
        analysis, dependent: params.dependent, independents: predCols,
        n: r.n, r2: r.r2, adjR2: r.adjR2, F: r.F, Fp: r.Fp, df: r.df,
        coefficients: [{ name: '(Intercept)', b: r.beta[0], se: r.se[0], t: r.t[0], p: r.p[0] },
          ...predCols.map((name, i) => ({ name, b: r.beta[i + 1], se: r.se[i + 1], t: r.t[i + 1], p: r.p[i + 1] }))],
        scatter: params.scatter ? { x: numericCol(table, params.scatter), y: yv } : null
      };
    }
    case 'crosstab': {
      const ct = crosstab(table, params.columnA, params.columnB, params.maxLevels || 6);
      return { analysis, columnA: params.columnA, columnB: params.columnB, ...ct };
    }
    case 'reliability': {
      const items = (params.items || []).map((name) => numericCol(table, name));
      if (params.items) params.items.forEach((name) => name);
      const r = cronbachAlpha(items);
      const itemStats = (params.items || []).map((name) => {
        const v = numericCol(table, name);
        return { name, mean: mean(v), sd: sd(v) };
      });
      return { analysis, ...r, itemStats };
    }
    case 'frequency': {
      const name = params.column;
      const j = table.headers.indexOf(name);
      if (j === -1) throw new Error(`Column "${name}" not found`);
      const counts = new Map();
      let missing = 0;
      for (const r of table.rows) {
        const v = r[j];
        if (isMissing(v)) { missing++; continue; }
        const k = String(v).trim() || '(blank)';
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const levels = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
      return { analysis, column: name, total: table.rows.length, missing, levels: levels.map(([value, count]) => ({ value, count, pct: count / table.rows.length * 100 })) };
    }
    default:
      throw new Error(`Unknown analysis: ${analysis}`);
  }
}

module.exports = {
  mean, median, sd, variance, quantile, skewness, kurtosis, pearson, spearman,
  tTestIndependent, tTestOneSample, anovaOneWay, chiSquareTest, ols, cronbachAlpha,
  kmeans, pca2d, loadTable, runAnalysis, histogram, crosstab, inferColumns, toNumber, isMissing,
  betai, gammq
};
