// Turns `pdftotext -layout` output of the EASA Easy Access Rules into one record per rule.

const HEADER_RE = /^\s*Easy Access Rules for Air Operations\s{2,}(.+?)\s*$/;
const FOOTER_RE = /^\s*Powered by EASA eRules/;
const SKIP_SECTION_RE = /amendment status|^contents|table of contents|disclaimer|note to the reader|^revision|preface|foreword|^acronyms|incorporated amendments/i;
const SUBHEAD_RE = /^\s*(SUBPART|SECTION|APPENDIX|CHAPTER|TITLE)\b/i;

const ID = String.raw`[A-Z]{2,5}(?:\.[A-Z0-9]{1,6})+(?:\s?\([A-Za-z0-9]+\))*(?:\s?;\s?(?:\([A-Za-z0-9]+\))+)*`;
const HEAD_RE = new RegExp(String.raw`^(?:(AMC|GM)(\d+)?\s+)?(${ID})[,;]?(?:\s+(\S.*))?$`);
const ANNEX_GM_RE = /^(AMC|GM)(\d+)?\s+(Annex [IVX]+|Article [\d.]+[a-z]*(?:\([A-Za-z0-9]+\))*(?:;\s?(?:\([A-Za-z0-9]+\))+)*)(?:\s+(\S.*))?$/;
const ARTICLE_RE = /^Article\s+(\d+[a-z]*)\s+[-–—]\s+(\S.*)$/;
const ANNEX_HEAD_RE = /^(Annex [IVX]+)\s+[—–-]\s+(\S.*)$/;
const DEF_START_RE = /^\((\d+[a-z]*)\)\s+(\S.*)$/;
const AMEND_RE = /(ED Decision \d{4}\/\d+\/[A-Z]+|Regulation \(EU\)|Implementing Regulation|Delegated Regulation)/;
const DOTS_RE = /\.{6,}\s*\d+\s*$/;
const TOC_TAIL_RE = /\.{4,}\s*\d+\s*$/;

// Amendment lines are right-aligned paragraphs; running text that merely mentions a regulation is not.
const MIN_AMEND_INDENT = 25;
const SAME_LINE_AMEND_RE = /ED Decision \d{4}\/\d+\/[A-Z]+$/;
const indentOf = (l) => l.length - l.trimStart().length;
const squash = (s) => s.replace(/\s+/g, " ").trim();
const normId = (s) => s.replace(/\s+/g, "");

export function makeKey(type, num, id) {
  const prefix = type ? `${type}${num || ""} ` : "";
  return prefix + id;
}

function parseHeading(trimmed) {
  let m = HEAD_RE.exec(trimmed);
  if (m) {
    const id = normId(m[3]);
    return { type: m[1] || "IR", num: m[2] || "", id, base: id.replace(/[(;].*$/, ""), rest: m[4] || "", key: makeKey(m[1], m[2], id) };
  }
  m = ARTICLE_RE.exec(trimmed);
  if (m) {
    const id = `Article ${m[1]}`;
    return { type: "ART", num: "", id, base: id, rest: m[2], key: id };
  }
  m = ANNEX_HEAD_RE.exec(trimmed);
  if (m) return { type: "ANNEX", num: "", id: m[1], base: m[1], rest: m[2], key: m[1] };
  m = ANNEX_GM_RE.exec(trimmed);
  if (m) {
    const id = m[3].replace(/;\s+/g, ";");
    return { type: m[1], num: m[2] || "", id, base: id, rest: m[4] || "", key: makeKey(m[1], m[2], id) };
  }
  return null;
}

// Annex I is a numbered list of definitions: one record per definition so each can be fetched on its own.
function splitDefinitions(rec) {
  const out = [{ ...rec, lines: [], pgs: [] }];
  rec.lines.forEach((l, i) => {
    const m = DEF_START_RE.exec(l);
    if (m) {
      const term = /‘([^’]{1,100})’/.exec(m[2]);
      out.push({ ...rec, key: `Annex I (${m[1]})`, type: "DEF", id: `Annex I (${m[1]})`, base: "Annex I", title: term ? term[1] : squash(m[2]).slice(0, 70), page: rec.pgs[i], endPage: rec.pgs[i], lines: [], pgs: [] });
    }
    const target = out[out.length - 1];
    target.lines.push(l);
    target.pgs.push(rec.pgs[i]);
    target.endPage = rec.pgs[i];
  });
  return out.filter((r) => r.type === "DEF" ? !/^\(\d+[a-z]*\)\s+\[deleted/i.test(r.lines[0]) : true);
}

export function parsePages(pages) {
  const rules = [];
  const tocKeys = new Set();
  const rejected = [];
  const sections = new Map();
  let current = null;
  let annex = "";
  let subpart = "";

  const finish = (rec) => {
    rec.text = rec.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    delete rec.lines;
    delete rec.pgs;
    rules.push(rec);
  };
  const flush = () => {
    if (!current) return;
    if (current.key === "Annex I") splitDefinitions(current).forEach(finish);
    else finish(current);
    current = null;
  };

  pages.forEach((page, idx) => {
    const pageNo = idx + 1;
    const raw = page.split("\n").map((l) => l.replace(/\s+$/, ""));
    raw.forEach((l, k) => {
      let line = l;
      if (!TOC_TAIL_RE.test(line) && raw[k + 1] && TOC_TAIL_RE.test(raw[k + 1]) && !parseHeading(squash(raw[k + 1]))) line = `${l} ${raw[k + 1].trim()}`;
      if (TOC_TAIL_RE.test(line)) {
        const head = parseHeading(squash(line.replace(TOC_TAIL_RE, "")));
        if (head) tocKeys.add(head.key);
      }
    });
    const firstIdx = raw.findIndex((l) => l.trim());
    const hm = firstIdx >= 0 ? HEADER_RE.exec(raw[firstIdx]) : null;
    if (!hm) { return; }
    const section = squash(hm[1]);
    const sec = sections.get(section) || { first: pageNo, last: pageNo, n: 0 };
    sec.last = pageNo; sec.n++; sections.set(section, sec);
    if (SKIP_SECTION_RE.test(section)) { flush(); return; }
    let lines = raw.slice(firstIdx + 1).filter((l) => !FOOTER_RE.test(l) && !DOTS_RE.test(l));
    annex = section;
    const subIdx = lines.findIndex((l) => l.trim());
    if (subIdx >= 0 && SUBHEAD_RE.test(lines[subIdx])) {
      subpart = squash(lines[subIdx]);
      lines = lines.slice(subIdx + 1);
    } else {
      subpart = "";
    }

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const head = trimmed && parseHeading(squash(trimmed));
      if (head) {
        let title = head.rest;
        let amend = "";
        let end = -1;
        const sameLine = SAME_LINE_AMEND_RE.exec(title);
        if (sameLine) {
          amend = squash(title.slice(sameLine.index));
          title = squash(title.slice(0, sameLine.index));
          end = i;
        } else {
          let seen = 0;
          for (let j = i + 1; j < lines.length && seen < 4; j++) {
            const t = lines[j].trim();
            if (!t) continue;
            seen++;
            if (seen === 1 && /^n\/a$/i.test(t)) { amend = ""; title = squash(`${title} ${lines.slice(i + 1, j).join(" ")}`); end = j - 1; break; }
            if (AMEND_RE.test(t) && squash(t).length < 160 && indentOf(lines[j]) >= MIN_AMEND_INDENT) {
              amend = squash(t);
              title = squash(`${title} ${lines.slice(i + 1, j).join(" ")}`);
              end = j;
              break;
            }
            if (squash(t).length > 140 || parseHeading(squash(t))) break;
          }
        }
        if (end >= 0) {
          flush();
          current = { key: head.key, type: head.type, num: head.num, id: head.id, base: head.base, title, annex, subpart, page: pageNo, endPage: pageNo, amendment: amend, lines: [], pgs: [] };
          i = end;
          continue;
        }
        if (rejected.length < 40) rejected.push(`p${pageNo}: ${trimmed.slice(0, 100)}`);
      }
      if (current) { current.lines.push(lines[i]); current.pgs.push(pageNo); current.endPage = pageNo; }
    }
  });
  flush();
  return { rules, tocKeys, rejected, sections };
}

export function parseText(fullText) {
  return parsePages(fullText.split("\f"));
}

export function coverage(rules, tocKeys) {
  const have = new Set(rules.map((r) => r.key));
  const missing = [...tocKeys].filter((k) => !have.has(k));
  const extra = [...have].filter((k) => !tocKeys.has(k));
  return { toc: tocKeys.size, parsed: have.size, missing, extra };
}
