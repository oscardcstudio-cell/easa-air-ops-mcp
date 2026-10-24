// In-memory BM25 over title, key and body of each rule.

const fold = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set("a an and are as at be by for from in is it of on or that the this to with".split(" "));

export function tokenize(s) {
  const out = [];
  for (const t of fold(s).split(/[^a-z0-9.]+/)) {
    const clean = t.replace(/^\.+|\.+$/g, "");
    if (!clean) continue;
    if (clean.includes(".")) {
      out.push(clean);
      out.push(...clean.split(".").filter(Boolean));
    } else if (!STOP.has(clean)) {
      out.push(clean);
    }
  }
  return out;
}

export class Index {
  constructor(rules) {
    this.rules = rules;
    this.byKey = new Map();
    this.byBase = new Map();
    this.tf = [];
    this.df = new Map();
    this.len = [];
    rules.forEach((r, i) => {
      this.byKey.set(r.key.toUpperCase(), i);
      if (!this.byBase.has(r.base)) this.byBase.set(r.base, []);
      this.byBase.get(r.base).push(i);
      const tf = new Map();
      const add = (tokens, w) => { for (const t of tokens) tf.set(t, (tf.get(t) || 0) + w); };
      const body = tokenize(r.text);
      add(body, 1);
      add(tokenize(r.title), 3);
      add(tokenize(r.key), 5);
      this.tf.push(tf);
      this.len.push(body.length + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    });
    this.avg = this.len.reduce((a, b) => a + b, 0) / (this.len.length || 1);
  }

  search(query, { limit = 8, annex, type } = {}) {
    const q = [...new Set(tokenize(query))];
    const N = this.rules.length;
    const exact = this.lookup(query);
    const scored = [];
    this.rules.forEach((r, i) => {
      if (annex && !fold(r.annex).includes(fold(annex))) return;
      if (type && r.type !== type.toUpperCase()) return;
      let score = 0;
      for (const t of q) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(t) + 0.5) / (this.df.get(t) + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (this.len[i] / this.avg)));
      }
      if (exact && exact.includes(i)) score += 1000;
      if (score > 0) scored.push([score, i]);
    });
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, limit).map(([score, i]) => ({ score: Math.round(score * 100) / 100, rule: this.rules[i], snippet: snippet(this.rules[i].text, q) }));
  }

  // Exact lookup by key ("AMC1 CAT.OP.MPA.155(c)") or by id/base ("CAT.OP.MPA.155").
  lookup(id) {
    const raw = id.trim().replace(/\s+/g, " ").toUpperCase();
    const direct = this.byKey.get(raw);
    if (direct !== undefined) return [direct];
    const compact = raw.replace(/\s+/g, "");
    const hits = [];
    this.rules.forEach((r, i) => { if (r.id.toUpperCase() === compact || r.base.toUpperCase() === compact) hits.push(i); });
    return hits.length ? hits : null;
  }
}

function snippet(text, tokens) {
  const low = fold(text);
  let pos = -1;
  for (const t of tokens) {
    const p = low.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  const start = Math.max(0, (pos < 0 ? 0 : pos) - 120);
  const piece = text.slice(start, start + 360).replace(/\s+/g, " ").trim();
  return (start > 0 ? "… " : "") + piece + (start + 360 < text.length ? " …" : "");
}
