# easa-air-ops-mcp

MCP server and small web dashboard for the **EASA Easy Access Rules for Air Operations**
(Regulation (EU) No 965/2012 with its AMC/GM). It lets an MCP client such as Claude search
the rules and read any rule in full.

The document is the PDF published by EASA. At build time the server downloads it, extracts the text
and splits it into one record per rule: implementing rules (`IR`), `AMC`, `GM`, the articles of the
cover regulation (`ART`) and the Annex I definitions (`DEF`).
The build checks the result against the document's own table of contents and prints the coverage.

## MCP tools

| Tool | What it does |
|---|---|
| `search_rules` | Full-text search (BM25). Filters: `annex`, `type`. Returns key, title, location and a snippet. |
| `get_rule` | Full text of one rule by key (`AMC1 CAT.OP.MPA.155(c)`) or number (`CAT.OP.MPA.155`). `include_related` adds its AMC/GM. Long results are paginated with `offset`. |
| `list_structure` | Annexes and subparts with their rule counts. |

The MCP endpoint is `POST /mcp` (Streamable HTTP, stateless, no authentication).
The dashboard is served at `/`; the same data is available at `/api/search?q=` and `/api/rule?id=`.

## Run

Requires Node 22 and `poppler-utils` (`pdftotext`).

```
npm install
npm run build-index     # downloads the PDF from EASA, writes data/rules.json
npm start               # http://localhost:3000
npm test
```

`EASA_URL` overrides the source URL, `EASA_PDF` points to a local PDF instead of downloading it.

## Deploy

The `Dockerfile` runs the index build, so each deployment embeds the edition that EASA serves at that URL.
It is deployed on Railway from this repository. Redeploy to pick up a new revision.

## Known limits

- Search is lexical, not semantic: use the words of the rules, or an exact rule number.
- The text comes from a PDF layout extraction; tables are flattened and may lose alignment.
- Appendices are part of the text of the rule they belong to, not separate records.
- One rule of the table of contents (`SPO.IDE.A.140`) is not detected as a separate record.

## Source and licence

Content: EASA eRules, © European Union, reuse authorised with acknowledgement of the source
(see the EUR-Lex legal notice). This is not an official publication: only the official one is authentic.
Code: MIT.
