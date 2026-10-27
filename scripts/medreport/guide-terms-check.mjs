#!/usr/bin/env node
/**
 * Guide terms check (bh2 WF – plan AC-CPY-1, DoC-1 C11). The getting-started guide and the welcome pack sent to a trial
 * clinic are gitignored (demo-assets/outputs/<clinic>/welcome/), so nothing else checks them against the release:
 *
 *   1. every grey-box term in the guide (`<span class="ui">…</span>`) is on screen: it appears in the UI's own text
 *      (string literals and JSX text of the app, comments left out);
 *   2. the guide's source table ("Where each answer comes from") names every source chip a clinic's Studio shows
 *      (core/labels.ts RECORD_SOURCE_LABELS, ui-bits.tsx FILL_SOURCE_SHORT with the clinic's own record wording);
 *   3. the "Complete a report" steps cover choosing who approves, a staff entry the physio must Adopt, "Leave optional
 *      boxes blank…" and what staff see when a form is ready ("Ready for a signing clinician");
 *   4. no AI, model or vendor name anywhere (core/wording.ts hasBannedTerm);
 *   5. with --pack: the PDF was printed from this guide (its text holds every grey-box term), the email carries no
 *      invitation link and the business contact only, the sample notes are fictional, and every "quoted" screen word in
 *      the email and the sample notes' read-me is on screen too.
 *
 *   node --import tsx scripts/medreport/guide-terms-check.mjs [--guide <guide.html>] [--pack <welcome dir>] [--json]
 *
 * Default guide: $CLINFORMS_WELCOME_DIR/guide.html, else demo-assets/outputs/blue-heart/welcome/guide.html. Exit 0 =
 * clean, 1 = problems (each listed), 2 = usage error. A term the screen builds at run time is declared in the guide with
 * its fixed parts: `<span class="ui" data-ui-parts="Trial –|left.|Use made-up notes…">`. Prints terms and counts only.
 * The pure parts are exported for scripts/medreport/guide-terms-check.test.ts. Owner: WF.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ------------------------------------------------------------------------------------------------
 * Text
 * ----------------------------------------------------------------------------------------------*/

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "–", mdash: "—", hellip: "…", rarr: "→" };

/** HTML entities decoded. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/** One form for comparing screen words: entities decoded, typographic quotes plain, spaces collapsed. */
export function normalise(text) {
  return decodeEntities(text)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/\.\.\./g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

/** Visible text of an HTML fragment. */
export function visibleText(html) {
  return normalise(html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "));
}

/* ------------------------------------------------------------------------------------------------
 * The guide
 * ----------------------------------------------------------------------------------------------*/

/**
 * The grey-box terms of an HTML fragment, in order: {text, parts} – `parts` from data-ui-parts (a term the screen builds
 * at run time), else null. Nested spans are read as their text.
 */
export function greyBoxTerms(html) {
  const out = [];
  const re = /<span\b([^>]*\bclass\s*=\s*"(?:[^"]*\s)?ui(?:\s[^"]*)?"[^>]*)>([\s\S]*?)<\/span>/gi;
  for (const m of html.matchAll(re)) {
    const parts = /\bdata-ui-parts\s*=\s*"([^"]*)"/i.exec(m[1]);
    out.push({ text: visibleText(m[2]), parts: parts ? decodeEntities(parts[1]).split("|").map(normalise).filter(Boolean) : null });
  }
  return out;
}

/** The inner HTML of the first element matching an opening-tag pattern (no nesting of the same tag inside). */
function elementHtml(html, open, tag) {
  const m = open.exec(html);
  if (!m) return "";
  const start = m.index + m[0].length;
  const end = html.indexOf(`</${tag}>`, start);
  return end < 0 ? "" : html.slice(start, end);
}

/** The guide read for the check: every grey-box term, the source table's, the steps of "Complete a report", all text. */
export function guideParts(html) {
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const table = elementHtml(body, /<table\b[^>]*\bclass\s*=\s*"[^"]*\bsources\b[^"]*"[^>]*>/i, "table");
  const steps = elementHtml(body, /<section\b[^>]*\baria-labelledby\s*=\s*"s5"[^>]*>/i, "section");
  return {
    terms: greyBoxTerms(body),
    sourceTerms: greyBoxTerms(table).map((t) => t.text),
    steps: Array.from(steps.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi), (m) => ({ text: visibleText(m[1]), terms: greyBoxTerms(m[1]).map((t) => t.text) })),
    text: visibleText(body),
  };
}

/* ------------------------------------------------------------------------------------------------
 * The UI's own words
 * ----------------------------------------------------------------------------------------------*/

/** Where the screens' words are: the app, its components, the shared copy and the Studio module (tests left out). */
export const UI_SOURCE_DIRS = ["src/app", "src/components", "src/lib", "src/modules/medreport/ui", "src/modules/medreport/connectors/file-import"];
export const UI_SOURCE_FILES = ["src/modules/medreport/core/labels.ts", "src/modules/medreport/core/wording.ts", "src/modules/medreport/core/reuse.ts", "src/modules/medreport/config.public.ts"];

/** Source text with its comments removed (a "//" after ":" – a URL – is kept). */
export function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

/**
 * The searchable screen text of a set of source files: comments out, JSX spacing ({" "}) and entities as shown. Each file
 * is read twice – as written (attribute values: title="…", label="…") and with inline JSX tags dropped, so
 * "Entered by staff{" "}<b>Adopt</b>" reads as the screen shows it.
 */
export function uiCorpus(sources) {
  return sources
    .map((s) => {
      const text = withoutComments(s).replace(/\{\s*"\s*"\s*\}/g, " ").replace(/\{"([^"{}]*)"\}/g, "$1");
      return `${normalise(text)}\n${normalise(text.replace(/<\/?[A-Za-z][\w.]*(?:\s[^<>]*?)?\/?>/g, ""))}`;
    })
    .join("\n");
}

/** The fixed fragments a term must show: data-ui-parts, else the term split at "…" and at numbers (filled at run time). */
export function termFragments(term) {
  if (term.parts) return term.parts;
  return term.text
    .split(/…|\b\d+\b/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 3);
}

/** Whether the screen text holds `words` as words: "Adopt" is not found inside "Adopted". */
export function hasWords(corpus, words) {
  if (!words) return false;
  const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(corpus);
}

/** Whether a grey-box term is on screen: verbatim, or each of its fixed fragments. */
export function termOnScreen(term, corpus) {
  if (!term.parts && hasWords(corpus, term.text)) return true;
  const fragments = termFragments(term);
  return fragments.length > 0 && fragments.every((f) => hasWords(corpus, f));
}

/** The source chips a clinic's Studio shows, from the code's labels (passed in: the script imports them with tsx). */
export function studioSourceChips({ fillSourceShort, tenantRegistrationShort, recordSourceLabels }) {
  const fill = { ...fillSourceShort, registration: tenantRegistrationShort };
  return Array.from(new Set([...Object.values(fill), ...Object.values(recordSourceLabels).map((l) => l.short)].map(normalise)));
}

/* ------------------------------------------------------------------------------------------------
 * The checks
 * ----------------------------------------------------------------------------------------------*/

/**
 * What the "Complete a report" steps must cover (plan WF, AC-CPY-1): each a test over one step's text and grey-box terms.
 * The terms themselves are checked against the screen separately, so a step only passes with the screen's own words.
 */
export const REQUIRED_STEPS = [
  { id: "approver", what: "choosing the physio who approves the form", test: (s) => /\b(choose|chosen|pick|select)/i.test(s.text) && /\bapprov(e|es|er|ing)\b/i.test(s.text) },
  { id: "staff-proposal", what: "staff entries in a physio's box are proposals the approving physio adopts", test: (s) => s.terms.includes("Entered by staff") && s.terms.some((t) => /^Adopt\b/.test(t)) },
  { id: "adopt", what: "the approving physio's Adopt", test: (s) => s.terms.some((t) => /^Adopt\b/.test(t)) && /\bapprov/i.test(s.text) },
  { id: "leave-blank", what: '"Leave optional boxes blank…"', test: (s) => s.terms.some((t) => /^Leave optional boxes blank/.test(t)) },
  { id: "signing-clinician", what: 'what staff see when nothing is left ("Ready for a signing clinician")', test: (s) => s.terms.some((t) => t.startsWith("Ready for a signing clinician")) },
];

/** Problems with the guide (empty = clean). `hasBannedTerm` is core/wording.ts's. */
export function checkGuide(html, { corpus, chips, hasBannedTerm }) {
  const g = guideParts(html);
  const problems = [];
  const seen = new Set();
  for (const t of g.terms) {
    const key = `${t.text}|${(t.parts ?? []).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!termOnScreen(t, corpus)) problems.push({ kind: "term-not-on-screen", term: t.text, fragments: termFragments(t).filter((f) => !hasWords(corpus, f)) });
  }
  if (g.sourceTerms.length === 0) problems.push({ kind: "no-source-table" });
  for (const chip of chips) if (!g.sourceTerms.includes(chip)) problems.push({ kind: "chip-not-in-source-table", term: chip });
  if (g.steps.length === 0) problems.push({ kind: "no-steps" });
  for (const req of REQUIRED_STEPS) if (!g.steps.some((s) => req.test(s))) problems.push({ kind: "step-missing", term: req.id, what: req.what });
  if (hasBannedTerm(g.text)) problems.push({ kind: "banned-term", where: "guide" });
  return { problems, terms: seen.size, sourceTerms: g.sourceTerms.length, steps: g.steps.length };
}

/** Words quoted "like this" in a plain-text file (the email, the sample notes' read-me) – screen words to check. */
export function quotedTerms(text) {
  return Array.from(new Set(Array.from(text.matchAll(/"([^"\n]{3,120})"/g), (m) => normalise(m[1]))));
}

/** A URL in the email that is not a public page (an invitation, reset or sign-in link with a token). */
export function privateLinks(text) {
  return Array.from(text.matchAll(/https?:\/\/[^\s)>\]]+/g), (m) => m[0]).filter((url) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return true;
    }
    const publicHost = /(^|\.)clinforms\.co\.uk$|(^|\.)appstackx\.co\.uk$/.test(u.hostname);
    const tokenish = u.search !== "" || /invite|accept|reset|token|verify|magic/i.test(u.pathname) || /[A-Za-z0-9_-]{24,}/.test(u.pathname);
    return !publicHost || tokenish;
  });
}

/** Problems with the rest of the welcome pack (files read by the caller). */
export function checkPack({ guideTerms, pdfText, email, readMe, sampleNoteNames, sampleNoteTexts, guideMtime, pdfMtime }, { corpus, hasBannedTerm }) {
  const problems = [];
  if (pdfText === null) problems.push({ kind: "pdf-missing" });
  else {
    const pdf = normalise(pdfText).replace(/\s+/g, "");
    for (const t of guideTerms) {
      const fragments = t.parts ?? [t.text];
      if (!fragments.every((f) => pdf.includes(normalise(f).replace(/\s+/g, "")))) problems.push({ kind: "pdf-out-of-date", term: t.text });
    }
    if (guideMtime !== null && pdfMtime !== null && pdfMtime < guideMtime) problems.push({ kind: "pdf-older-than-guide" });
    if (hasBannedTerm(pdfText)) problems.push({ kind: "banned-term", where: "pdf" });
  }
  if (email === null) problems.push({ kind: "email-missing" });
  else {
    for (const url of privateLinks(email)) problems.push({ kind: "email-private-link", term: url.replace(/[?#].*$/, "?…") });
    if (/@gmail\.com/i.test(email)) problems.push({ kind: "email-personal-address" });
    if (!/^From:\s*khuram@appstackx\.co\.uk\s*$/m.test(email)) problems.push({ kind: "email-not-from-business-address" });
    if (hasBannedTerm(email)) problems.push({ kind: "banned-term", where: "email" });
  }
  for (const [where, text] of [
    ["email", email],
    ["sample-notes read-me", readMe],
  ]) {
    if (text === null) continue;
    for (const term of quotedTerms(text)) if (!termOnScreen({ text: term, parts: null }, corpus)) problems.push({ kind: "quoted-term-not-on-screen", where, term });
  }
  for (const name of sampleNoteNames) if (name !== "About-these-sample-notes.txt" && !/^Fictional-/.test(name)) problems.push({ kind: "sample-notes-not-marked-fictional", term: name });
  for (const [name, text] of Object.entries(sampleNoteTexts)) if (hasBannedTerm(text)) problems.push({ kind: "banned-term", where: name });
  return problems;
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ----------------------------------------------------------------------------------------------*/

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "__corpus__" && !e.name.startsWith(".")) walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const d of UI_SOURCE_DIRS) walk(path.join(root, d));
  for (const f of UI_SOURCE_FILES) if (fs.existsSync(path.join(root, f))) out.push(path.join(root, f));
  return out;
}

/** The screen corpus and the chip list of the tree at `root` (imports its label modules: run under tsx). */
export async function loadUi(root = ROOT) {
  const corpus = uiCorpus(sourceFiles(root).map((f) => fs.readFileSync(f, "utf8")));
  const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const [labels, bits, copy, wording] = await Promise.all([
    imp("src/modules/medreport/core/labels.ts"),
    imp("src/modules/medreport/ui/components/shared/ui-bits.tsx"),
    imp("src/modules/medreport/ui/studio-copy.ts"),
    imp("src/modules/medreport/core/wording.ts"),
  ]);
  const chips = studioSourceChips({ fillSourceShort: bits.FILL_SOURCE_SHORT, tenantRegistrationShort: copy.TENANT_COPY.sources.registrationShort, recordSourceLabels: labels.RECORD_SOURCE_LABELS });
  return { corpus, chips, hasBannedTerm: wording.hasBannedTerm };
}

async function pdfTextOf(file, root = ROOT) {
  const { loadPdfjs, pdfjsDocumentParams } = await import(pathToFileURL(path.join(root, "src/modules/medreport/forms/pdfjs.ts")).href);
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(new Uint8Array(fs.readFileSync(file))));
  try {
    const doc = await task.promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += ` ${content.items.map((it) => ("str" in it ? it.str : "")).join(" ")}`;
    }
    return text;
  } finally {
    await task.destroy();
  }
}

function readOrNull(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const welcome = process.env.CLINFORMS_WELCOME_DIR || path.join(ROOT, "demo-assets/outputs/blue-heart/welcome");
  const guidePath = arg("--guide") ?? path.join(welcome, "guide.html");
  const packDir = argv.includes("--pack") ? (arg("--pack") ?? welcome) : null;
  if (!fs.existsSync(guidePath)) {
    console.error(`No guide at ${guidePath} (it is gitignored: pass --guide, or set CLINFORMS_WELCOME_DIR).`);
    return 2;
  }
  const ui = await loadUi();
  const html = fs.readFileSync(guidePath, "utf8");
  const guide = checkGuide(html, ui);
  let pack = [];
  if (packDir) {
    const pdfName = fs.readdirSync(packDir).find((n) => /\.pdf$/i.test(n) && /getting-started/i.test(n));
    const pdfPath = pdfName ? path.join(packDir, pdfName) : null;
    const notesDir = path.join(packDir, "sample-notes");
    const names = fs.existsSync(notesDir) ? fs.readdirSync(notesDir) : [];
    pack = checkPack(
      {
        guideTerms: guideParts(html).terms,
        pdfText: pdfPath ? await pdfTextOf(pdfPath) : null,
        email: readOrNull(path.join(packDir, "email.txt")),
        readMe: readOrNull(path.join(notesDir, "About-these-sample-notes.txt")),
        sampleNoteNames: names,
        sampleNoteTexts: Object.fromEntries(names.filter((n) => n.endsWith(".txt")).map((n) => [n, fs.readFileSync(path.join(notesDir, n), "utf8")])),
        guideMtime: fs.statSync(guidePath).mtimeMs,
        pdfMtime: pdfPath ? fs.statSync(pdfPath).mtimeMs : null,
      },
      ui,
    );
  }
  const problems = [...guide.problems, ...pack];
  if (argv.includes("--json")) console.log(JSON.stringify({ ok: problems.length === 0, guide: { terms: guide.terms, sourceTerms: guide.sourceTerms, steps: guide.steps, chips: ui.chips.length }, problems }, null, 2));
  else {
    console.log(`Guide: ${guide.terms} grey-box terms, ${guide.sourceTerms} in the source table (${ui.chips.length} chips on screen), ${guide.steps} steps${packDir ? "; welcome pack checked" : ""}.`);
    for (const p of problems) console.log(`- ${p.kind}${p.where ? ` [${p.where}]` : ""}${p.term ? `: ${p.term}` : ""}${p.what ? ` – ${p.what}` : ""}${p.fragments?.length ? ` (not found: ${p.fragments.join(" | ")})` : ""}`);
    console.log(problems.length ? `${problems.length} problem(s).` : "OK.");
  }
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    },
  );
}
