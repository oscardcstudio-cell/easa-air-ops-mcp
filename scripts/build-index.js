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

const { rules, tocKeys, rejected } = parseText(readFileSync(txt, "utf8"));
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

mkdirSync("data", { recursive: true });
writeFileSync("data/rules.json", JSON.stringify({ revision: subject, pages: Number(pages), source: SRC, builtAt: new Date().toISOString(), rules }));
writeFileSync("data/report.txt", report.join("\n"));
console.log("WROTE data/rules.json");
