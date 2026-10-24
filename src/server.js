import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Index } from "./search.js";
import { registerTools, getRule, summary } from "./tools.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.DATA_PATH || join(root, "data", "rules.json");
if (!existsSync(dataPath)) {
  console.error(`Missing ${dataPath}. Run "npm run build-index" first.`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const index = new Index(data.rules);
const meta = { revision: data.revision, pages: data.pages, source: data.source, builtAt: data.builtAt, rules: data.rules.length };

if (existsSync(join(root, "data", "report.txt"))) console.log("BUILD REPORT\n" + readFileSync(join(root, "data", "report.txt"), "utf8"));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(root, "public")));

app.get("/health", (_, res) => res.json({ ok: true, ...meta }));
app.get("/api/meta", (_, res) => res.json(meta));

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ hits: [] });
  const hits = index.search(q, { limit: Math.min(Number(req.query.limit) || 20, 50), annex: req.query.annex, type: req.query.type });
  res.json({ hits: hits.map((h) => ({ ...summary(h.rule), snippet: h.snippet, score: h.score })) });
});

app.get("/api/rule", (req, res) => {
  const r = getRule(index, String(req.query.id || ""), { includeRelated: req.query.related === "1", offset: Number(req.query.offset) || 0, maxChars: 1e9 });
  if (r.error) return res.status(404).json(r);
  res.json(r);
});

// MCP over Streamable HTTP, stateless: one server per request.
app.post("/mcp", async (req, res) => {
  const server = new McpServer({ name: "easa-air-ops", version: "0.1.0" });
  registerTools(server, index, meta);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on ${port} — ${meta.rules} rules, ${meta.revision}`));
