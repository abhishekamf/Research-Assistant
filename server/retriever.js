/**
 * Hybrid retrieval: BM25 (always on) + vector cosine (when embeddings exist),
 * fused with Reciprocal Rank Fusion.
 */
const { contentTokens } = require('./utils');
const { embedOne, cosine } = require('./embeddings');

class RetrievalIndex {
  constructor(projectBundle, embedCfg) {
    this.bundle = projectBundle;
    this.embedCfg = embedCfg;
    this._version = -1;
    this._bm25 = null;
  }

  _checkVersion() {
    if (this._version !== this.bundle.chunks.length) {
      this._version = this.bundle.chunks.length;
      this._buildBm25();
    }
  }

  _buildBm25() {
    const K1 = 1.4, B = 0.72;
    const chunks = this.bundle.chunks;
    const docs = chunks.map((c) => contentTokens(c.text));
    const df = new Map();
    for (const toks of docs) {
      const seen = new Set(toks);
      for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
    }
    const totalLen = docs.reduce((s, d) => s + d.length, 0);
    this._bm25 = {
      K1, B,
      N: chunks.length,
      avgLen: totalLen / Math.max(1, docs.length),
      df,
      docs
    };
  }

  bm25Scores(query) {
    this._checkVersion();
    const { K1, B, N, avgLen, df, docs } = this._bm25;
    const qTerms = [...new Set(contentTokens(query))];
    const scores = new Float64Array(N);
    if (!qTerms.length) return scores;
    for (let d = 0; d < N; d++) {
      const toks = docs[d];
      if (!toks.length) continue;
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      const docLen = toks.length;
      let score = 0;
      for (const q of qTerms) {
        const f = tf.get(q);
        if (!f) continue;
        const n = df.get(q) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * docLen / avgLen));
      }
      scores[d] = score;
    }
    return scores;
  }

  topK(scores, k) {
    const idx = Array.from(scores.keys());
    idx.sort((a, b) => scores[b] - scores[a]);
    return idx.filter((i) => scores[i] > 0).slice(0, k);
  }

  async vectorScores(queryText) {
    const emb = this.bundle.meta.embedding;
    if (!emb || !emb.count) return null;
    if (!this.bundle.embeddings) this.bundle.loadEmbeddings && this.bundle.loadEmbeddings();
    const qv = await embedOne(queryText, this.embedCfg);
    if (!qv) return null;
    if (qv.length !== emb.dim) return null; // dimension mismatch -> skip vector search
    const { chunks } = this.bundle;
    const out = new Float64Array(chunks.length);
    const all = this.bundle.embeddings;
    const dim = emb.dim;
    for (let i = 0; i < chunks.length; i++) {
      const ci = chunks[i].ei;
      if (ci == null || ci < 0) continue;
      const off = ci * dim;
      if (off + dim > all.length) continue;
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += qv[j] * all[off + j];
      out[i] = dot;
    }
    return out;
  }

  /**
   * Hybrid retrieve.
   * @returns {Promise<Array<{index:number, score:number}>>} ranked chunk indices
   */
  async search(query, k = 8, useVector = true) {
    this._checkVersion();
    if (!this.bundle.chunks.length) return [];
    const bm = this.bm25Scores(query);
    const bmTop = this.topK(bm, 30);
    if (!useVector) return bmTop.slice(0, k).map((i) => ({ index: i, score: bm[i] }));

    let vec = null;
    try { vec = await this.vectorScores(query); } catch { vec = null; }

    if (!vec) return bmTop.slice(0, k).map((i) => ({ index: i, score: bm[i] }));

    const vecTop = [];
    const idx = Array.from(vec.keys());
    idx.sort((a, b) => vec[b] - vec[a]);
    for (const i of idx) { if (vec[i] > 0.05) vecTop.push(i); if (vecTop.length >= 30) break; }

    // Reciprocal Rank Fusion
    const rrf = new Map();
    bmTop.forEach((i, r) => rrf.set(i, (rrf.get(i) || 0) + 1 / (60 + r + 1)));
    vecTop.forEach((i, r) => rrf.set(i, (rrf.get(i) || 0) + 1 / (60 + r + 1)));
    return [...rrf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([index, score]) => ({ index, score }));
  }
}

module.exports = { RetrievalIndex };
