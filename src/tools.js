import { z } from "zod";

const MAX_CHARS = 40000;

export function summary(r) {
  return { key: r.key, type: r.type, title: r.title, annex: r.annex, subpart: r.subpart, page: r.page, amendment: r.amendment };
}

function render(r) {
  return `# ${r.key} — ${r.title}\n${r.annex}${r.subpart ? " / " + r.subpart : ""} · PDF page ${r.page}${r.amendment ? " · " + r.amendment : ""}\n\n${r.text}`;
}

export function getRule(index, id, { includeRelated = false, offset = 0, maxChars = MAX_CHARS } = {}) {
  const hits = index.lookup(id);
  if (!hits) return { error: `No rule found for "${id}". Try search_rules first.` };
  const exact = hits.length === 1 ? hits : hits.filter((i) => index.rules[i].type === "IR");
  const main = exact.length ? exact : hits;
  const baseIdx = index.byBase.get(index.rules[main[0]].base) || [];
  const related = baseIdx.filter((i) => !main.includes(i)).map((i) => summary(index.rules[i]));
  const picked = includeRelated ? [...main, ...baseIdx.filter((i) => !main.includes(i))] : main;
  const full = picked.map((i) => render(index.rules[i])).join("\n\n---\n\n");
  const slice = full.slice(offset, offset + maxChars);
  return {
    text: slice + (offset + maxChars < full.length ? `\n\n[truncated: ${full.length} chars total, call again with offset=${offset + maxChars}]` : ""),
    related,
    matches: hits.length,
  };
}

export function registerTools(server, index, meta) {
  server.registerTool(
    "search_rules",
    {
      title: "Search rules",
      description: `Full-text search in the EASA Easy Access Rules for Air Operations (${meta.revision}). Returns the best matching rules (IR = Implementing Rule, AMC = Acceptable Means of Compliance, GM = Guidance Material, ART = Article of the cover regulation, DEF = Annex I definition) with a snippet. Use get_rule with a returned key to read the full text.`,
      inputSchema: {
        query: z.string().describe("Keywords or a question, e.g. 'fuel policy helicopter' or 'CAT.OP.MPA.150'"),
        limit: z.number().int().min(1).max(25).default(8).optional(),
        annex: z.string().optional().describe("Filter on annex/part, e.g. 'Part-CAT', 'Part-ORO'"),
        type: z.enum(["IR", "AMC", "GM", "ART", "DEF", "ANNEX"]).optional(),
      },
    },
    async ({ query, limit, annex, type }) => {
      const hits = index.search(query, { limit: limit ?? 8, annex, type });
      const text = hits.length
        ? hits.map((h, n) => `${n + 1}. ${h.rule.key} — ${h.rule.title}\n   ${h.rule.annex}${h.rule.subpart ? " / " + h.rule.subpart : ""} · PDF page ${h.rule.page}\n   ${h.snippet}`).join("\n\n")
        : "No match.";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "get_rule",
    {
      title: "Get a rule in full",
      description: "Returns the complete text of one rule. `id` is either an exact key ('AMC1 CAT.OP.MPA.155(c)') or a rule number ('CAT.OP.MPA.155'). With a rule number, the Implementing Rule is returned and its AMC/GM are listed; set include_related to get their full text too. Long results are paginated with offset.",
      inputSchema: {
        id: z.string(),
        include_related: z.boolean().optional().describe("Also return the full text of all AMC/GM attached to the same rule number"),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ id, include_related, offset }) => {
      const r = getRule(index, id, { includeRelated: !!include_related, offset: offset ?? 0 });
      if (r.error) return { content: [{ type: "text", text: r.error }], isError: true };
      const rel = r.related.length && !include_related ? `\n\n[Related: ${r.related.map((x) => x.key).join(", ")}]` : "";
      return { content: [{ type: "text", text: r.text + rel }] };
    },
  );

  server.registerTool(
    "list_structure",
    {
      title: "List annexes and subparts",
      description: "Lists the annexes/parts and subparts of the document with the number of rules in each.",
      inputSchema: {},
    },
    async () => {
      const tree = new Map();
      for (const r of index.rules) {
        const sub = tree.get(r.annex) || new Map();
        sub.set(r.subpart || "(none)", (sub.get(r.subpart || "(none)") || 0) + 1);
        tree.set(r.annex, sub);
      }
      const text = [...tree].map(([a, subs]) => `${a}\n${[...subs].map(([s, n]) => `  - ${s}: ${n}`).join("\n")}`).join("\n");
      return { content: [{ type: "text", text }] };
    },
  );
}
