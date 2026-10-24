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

const hdr = (section) => `                         Easy Access Rules for Air Operations              ${section}`;

test("a skipped front-matter page closes the open rule instead of being appended to it", () => {
  const body = [hdr("ANNEX VII (Part-NCO)"), "GM1 NCO.OP.110 Minima", " ".repeat(60) + "ED Decision 2022/014/R", "Real text."].join("\n");
  const front = [hdr("Incorporated amendments"), "Long list of amendments that is not rule text."].join("\n");
  const { rules } = parsePages([body, front]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].text, "Real text.");
});

test("table-of-contents dot-leader lines never end up in a rule body", () => {
  const page = [hdr("ANNEX III (Part-ORO)"), "ORO.GEN.110 Operator responsibilities", " ".repeat(60) + "Regulation (EU) 2018/1042", "Text.", "AMC1 ORO.GEN.110 Something ............................ 42"].join("\n");
  const { rules } = parsePages([page]);
  assert.equal(rules[0].text, "Text.");
});

test("a rule whose body is n/a is still a rule", () => {
  const page = [hdr("ANNEX III (Part-ORO)"), "AMC1 ORO.FTL.120(b)(2) Fatigue risk management (FRM)", "n/a"].join("\n");
  assert.equal(parsePages([page]).rules[0].key, "AMC1 ORO.FTL.120(b)(2)");
});

test("a table-of-contents entry with a wrapped title is collected", () => {
  const page = ["AMC1 CAT.OP.MPA.155(c) Carriage of Special Categories of", "Passengers (SCPs) ............................ 700"].join("\n");
  assert.ok(parsePages([page]).tocKeys.has("AMC1 CAT.OP.MPA.155(c)"));
});

test("running text that mentions a regulation does not make a heading", () => {
  const page = [hdr("ANNEX II (Part-ARO)"), "ORO.GEN.200A is applicable as described in Regulation (EU) No 965/2012", "and the competent authority shall check it.", "More text."].join("\n");
  assert.equal(parsePages([page]).rules.length, 0);
});
