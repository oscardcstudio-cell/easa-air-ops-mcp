// Downloads the EAR PDF from EASA, extracts text with pdftotext and writes data/rules.json.
import { createWriteStream, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseText, coverage } from "../src/parse.js";

const SRC = process.env.EASA_URL || "https://www.easa.europa.eu/en/downloads/20342/en";
const pdf = process.env.EASA_PDF || "/tmp/easa.pdf";
const txt = "/tmp/easa.txt";

async function download() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(SRC, { headers: { "user-agent": "Mozilla/5.0 easa-air-ops-mcp" } });
      if (!res.ok || !/pdf/.test(res.headers.get("content-type") || "")) throw new Error(`bad response ${res.status} ${res.headers.get("content-type")}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(pdf));
      return;
    } catch (e) {
      console.log(`download attempt ${attempt} failed: ${e.message}`);
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

if (!process.env.EASA_PDF) await download();
execFileSync("pdftotext", ["-layout", pdf, txt], { maxBuffer: 1 << 28 });
const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
const subject = /Subject:\s*(.*)/.exec(info)?.[1] || "";
const pages = /Pages:\s*(\d+)/.exec(info)?.[1] || "";

const { rules, tocKeys, rejected, sections } = parseText(readFileSync(txt, "utf8"));
const cov = coverage(rules, tocKeys);
const report = [];
const log = (m) => { console.log(m); report.push(m); };
log(`REVISION ${subject} | pages ${pages}`);
log(`RULES parsed=${rules.length} unique=${cov.parsed} toc=${cov.toc} missing=${cov.missing.length} extra=${cov.extra.length}`);
log(`MISSING(first 40): ${cov.missing.slice(0, 40).join(" | ")}`);
log(`EXTRA(first 20): ${cov.extra.slice(0, 20).join(" | ")}`);
log(`REJECTED(first 15): ${rejected.slice(0, 15).join(" || ")}`);
const types = {};
for (const r of rules) types[r.type] = (types[r.type] || 0) + 1;
log(`TYPES ${JSON.stringify(types)}`);
const lens = rules.map((r) => r.text.length).sort((a, b) => a - b);
log(`TEXTLEN min=${lens[0]} median=${lens[lens.length >> 1]} max=${lens.at(-1)} empty=${lens.filter((l) => l < 20).length}`);

if (process.env.DIAG !== "0") {
  const byAnnex = {};
  for (const r of rules) byAnnex[r.annex] = (byAnnex[r.annex] || 0) + 1;
  log(`ANNEX ${Object.entries(byAnnex).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}=${v}`).join(" | ")}`);
  const buckets = {};
  for (const r of rules) { const b = Math.floor(r.page / 250) * 250; buckets[b] = (buckets[b] || 0) + 1; }
  log(`PAGEBUCKETS ${JSON.stringify(buckets)} firstPage=${Math.min(...rules.map((r) => r.page))}`);
  log(`LONGEST ${[...rules].sort((a, b) => b.text.length - a.text.length).slice(0, 8).map((r) => `${r.key}@p${r.page}:${r.text.length}`).join(" | ")}`);
  const seen = new Map(); const dups = [];
  for (const r of rules) { if (seen.has(r.key)) dups.push(`${r.key}@p${seen.get(r.key)}+p${r.page}`); else seen.set(r.key, r.page); }
  log(`DUPS(${dups.length}) ${dups.slice(0, 12).join(" | ")}`);
  const extra = rules.filter((r) => !tocKeys.has(r.key) && !/Annex I$/.test(r.key));
  log(`EXTRA_NON_ANNEXI(${extra.length}) ${extra.filter((_, i) => i % Math.max(1, Math.floor(extra.length / 25)) === 0).slice(0, 25).map((r) => `${r.key}@p${r.page}[${r.annex.slice(0, 14)}]`).join(" | ")}`);
  const txt2 = readFileSync(txt, "utf8").split("\n");
  for (const k of cov.missing) {
    const hits = [];
    txt2.forEach((l, i) => { if (!/\.{5,}/.test(l) && l.includes(k.replace(/^(AMC|GM)\d+ /, "")) && hits.length < 3) hits.push(`L${i}: ${txt2.slice(i, i + 3).map((x) => x.trim().slice(0, 70)).join(" ⏎ ")}`); });
    log(`MISSING_CTX ${k} => ${hits.join(" ## ")}`);
  }
}
if (process.env.DIAG !== "0") {
  log(`SECTIONS ${[...sections].map(([k, v]) => `${k.slice(0, 40)}[p${v.first}-${v.last} n=${v.n}]`).join(" | ")}`);
  const pagesRaw = readFileSync(txt, "utf8").split("\f");
  for (const n of (process.env.DUMP_PAGES || "").split(",").filter(Boolean).map(Number)) {
    log(`DUMP p${n} ${pagesRaw[n - 1].split("\n").filter((l) => l.trim()).slice(0, 32).map((l) => `${" ".repeat(0)}[${l.length - l.trimStart().length}]${l.trim().slice(0, 110)}`).join(" ⏎ ")}`);
  }
  const lines2 = readFileSync(txt, "utf8").split("\n");
  const art = [];
  lines2.forEach((l, i) => { if (/^\s*Article \d+[a-z]?\b/.test(l) && art.length < 14) art.push(`L${i}: ${l.trim().slice(0, 50)} ⏎ ${(lines2[i + 1] || "").trim().slice(0, 50)} ⏎ ${(lines2[i + 2] || "").trim().slice(0, 50)}`); });
  log(`ARTICLES ${art.join(" ## ")}`);
  const dupKeys = []; const c = new Map();
  for (const r of rules) c.set(r.key, (c.get(r.key) || 0) + 1);
  for (const [k, n] of c) if (n > 1 && dupKeys.length < 3) dupKeys.push(k);
  for (const k of dupKeys) log(`DUPTEXT ${k} => ${rules.filter((r) => r.key === k).map((r) => `p${r.page}-${r.endPage} len=${r.text.length} "${r.text.slice(0, 90).replace(/\s+/g, " ")}"`).join(" ## ")}`);
  const apx = [];
  lines2.forEach((l, i) => { if (/^\s{0,3}Appendix \d+[A-Za-z]?\b/.test(l) && !/\.{5,}/.test(l) && apx.length < 10) apx.push(`L${i}[${l.length - l.trimStart().length}]: ${l.trim().slice(0, 60)} ⏎ ${(lines2[i + 1] || "").trim().slice(0, 50)} ⏎ ${(lines2[i + 2] || "").trim().slice(0, 50)}`); });
  log(`APPENDIX ${apx.join(" ## ")}`);
  const big = [...rules].sort((a, b) => b.text.length - a.text.length).slice(0, 3);
  log(`BIGSPAN ${big.map((r) => `${r.key} p${r.page}-${r.endPage}`).join(" | ")}`);
}
mkdirSync("data", { recursive: true });
writeFileSync("data/rules.json", JSON.stringify({ revision: subject, pages: Number(pages), source: SRC, builtAt: new Date().toISOString(), rules }));
writeFileSync("data/report.txt", report.join("\n"));
console.log("WROTE data/rules.json");
