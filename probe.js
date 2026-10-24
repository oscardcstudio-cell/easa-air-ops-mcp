import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";
import { createServer } from "node:http";

const URL_SRC = process.env.EASA_URL || "https://www.easa.europa.eu/en/downloads/20342/en";
const pdf = "/tmp/easa.pdf";
let report = "probe running";
const sh = (c) => { try { return execSync(c, { encoding: "utf8", maxBuffer: 1 << 28 }); } catch (e) { return "ERR " + e.message; } };
const emit = (title, body) => { console.log(`##### ${title}\n${body}`); report += `\n##### ${title}\n${body}`; };

async function run() {
  const res = await fetch(URL_SRC, { headers: { "user-agent": "Mozilla/5.0 easa-air-ops-mcp" } });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(pdf));
  sh(`pdftotext -layout ${pdf} /tmp/full.txt`);
  emit("full.txt", sh("wc -lc /tmp/full.txt"));
  for (const p of [120, 121, 1000]) emit(`page ${p}`, sh(`pdftotext -layout -f ${p} -l ${p} ${pdf} - | head -70`));
  emit("heading-like counts", sh(`grep -cE '^ *(AMC|GM)[0-9]* [A-Z]{2,4}\\.' /tmp/full.txt; grep -cE '^ *[A-Z]{3}\\.[A-Z]{2,4}\\.[0-9]+' /tmp/full.txt`));
  emit("heading samples", sh(`grep -nE '^ *(AMC|GM)[0-9]* [A-Z]{2,4}\\.|^ *[A-Z]{3}\\.[A-Z]{2,4}\\.[0-9]+ ' /tmp/full.txt | sed -n '1,10p;400,410p;1500,1510p'`));
  emit("regulation/annex markers", sh(`grep -nE '^ *(ANNEX|Annex|SUBPART|Subpart|SECTION|Section|APPENDIX|Appendix) ' /tmp/full.txt | sed -n '1,40p'`));
  emit("END", "done");
}
run().catch((e) => emit("FAIL", e.stack));
createServer((_, r) => { r.setHeader("content-type", "text/plain"); r.end(report); }).listen(process.env.PORT || 3000);
