import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";
import { createServer } from "node:http";

const URL_SRC = process.env.EASA_URL || "https://www.easa.europa.eu/en/downloads/20342/en";
const out = "/tmp/easa.bin";
let report = "probe running";

const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 1 << 24 }); } catch (e) { return "ERR " + e.message; } };

async function run() {
  const res = await fetch(URL_SRC, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 easa-air-ops-mcp" } });
  const lines = [`status ${res.status} final ${res.url}`];
  for (const [k, v] of res.headers) lines.push(`H ${k}: ${v}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  lines.push("size " + sh(`stat -c %s ${out}`).trim());
  lines.push("file " + sh(`file ${out}`).trim());
  lines.push("head " + sh(`head -c 600 ${out} | strings | head -12`));
  const kind = sh(`file -b ${out}`);
  if (/Zip/.test(kind)) lines.push("unzip\n" + sh(`unzip -l ${out} | head -60`));
  if (/PDF/.test(kind)) lines.push("pdfinfo\n" + sh(`pdfinfo ${out}`));
  if (/XML|text/i.test(kind)) {
    lines.push("tags\n" + sh(`grep -o '<[a-zA-Z:_-]*' ${out} | sort | uniq -c | sort -rn | head -40`));
    lines.push("first\n" + sh(`head -c 3000 ${out}`));
  }
  report = lines.join("\n");
  console.log("=== PROBE REPORT ===\n" + report + "\n=== END ===");
}
run().catch((e) => { report = "FAIL " + e.stack; console.log(report); });
createServer((_, r) => { r.setHeader("content-type", "text/plain"); r.end(report); }).listen(process.env.PORT || 3000);
