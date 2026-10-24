import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePages, coverage } from "../src/parse.js";
import { Index } from "../src/search.js";

const page = readFileSync(new URL("./fixture.txt", import.meta.url), "utf8");
const { rules, tocKeys } = parsePages([page]);

test("extracts rules with type, id, title, amendment", () => {
  assert.deepEqual(rules.map((r) => r.key), ["GM3 CAT.OP.MPA.155(b)", "GM4 CAT.OP.MPA.155(b)", "AMC1 CAT.OP.MPA.155(c)", "CAT.OP.MPA.110", "GM1 Annex I"]);
  const r = rules[2];
  assert.equal(r.title, "Carriage of Special Categories of Passengers (SCPs)");
  assert.equal(r.amendment, "ED Decision 2016/004/R");
  assert.equal(r.annex, "ANNEX IV (Part-CAT)");
  assert.equal(r.subpart, "SUBPART B: OPERATING PROCEDURES");
});

test("a sentence starting with a rule number is not a heading", () => {
  assert.match(rules[1].text, /CAT\.OP\.MPA\.155 requires the operator/);
});

test("page header and footer are stripped from bodies", () => {
  for (const r of rules) assert.doesNotMatch(r.text, /Powered by EASA|Easy Access Rules for Air/);
});

test("table-of-contents lines are collected for coverage, not parsed as rules", () => {
  assert.ok(tocKeys.has("AMC1 ORO.MLR.100"));
  assert.equal(coverage(rules, tocKeys).missing[0], "AMC1 ORO.MLR.100");
});

test("search finds by words and by exact id; lookup by base returns IR and AMC/GM", () => {
  const idx = new Index(rules);
  assert.equal(idx.search("passengers briefing planned emergency")[0].rule.key, "GM4 CAT.OP.MPA.155(b)");
  assert.equal(idx.search("CAT.OP.MPA.110")[0].rule.key, "CAT.OP.MPA.110");
  assert.equal(idx.lookup("CAT.OP.MPA.155").length, 3);
});
