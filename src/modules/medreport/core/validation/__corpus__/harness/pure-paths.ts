/**
 * Safety corpus: the paths that run one product function on a fictional input.
 *
 * fill     – the docx fill of a fictional form with FINAL semantics (answers from the built report as approved, or
 *            input.fill.answers); check.fill: {refused, contains[], notContains[], xmlMatch[], xmlNotMatch[], maxMs}.
 *            BLOCK = the FINAL fill is refused (4xx). input.fill.hostile builds a hostile-size Word file instead.
 * lint     – core/form-map-lint.ts lintFormMap(form) (WE); check.lint {rule, field}: FLAG = that rule reports an
 *            error, PASS = no error. Missing module = the case fails (pending WE).
 * assemble – ai/assemble.ts assembleDraft with input.assemble.output (a hand-written DraftOutput); check.assemble
 *            {box, printed[], notPrinted[], surfaced[], noGap[], noSuggestedAnswer, noAnswer}. BLOCK = what assembly
 *            prints, put back into the report, still blocks when validated.
 * split    – core/text/sentences.ts splitSentences(text, policy) (W0.5); check.split {count, whole[]}.
 * scope    – core/scope.ts removeSentencesWithTerms(text, terms); check.scope {contains[], notContains[], figures}.
 * probe    – input.probe.name: condition | own-voice | section-text | copy-equals-issued | map-note-visible |
 *            schema-keeps-release-fields | rtf-picture | status-label.
 */
import { assembleDraft } from "../../../../ai/assemble";
import { conditionOf, notApplicable } from "../../../conditions";
import { copyEntries } from "../../../answer-copy";
import { buildFormAnswers } from "../../../forms";
import { removeSentencesWithTerms } from "../../../scope";
import { ReportSchema } from "../../../schemas";
import { rewriteInFirstPerson } from "../../../voice";
import { convertRtfToDocx } from "../../../rtf";
import { answeredByPerson, questionStatus } from "../../../../ui/components/review/review-model";
import { CANDIDATE_ENGINE } from "./engine";
import type { FormDefinition, FormField, Report } from "../../../types";
import { DOCX_MIME, sha256Hex as fileSha256 } from "../../../../forms/file";
import { renderFormFile } from "../../../../forms/render-form";
import { openZipSafely } from "../../../../forms/zip-guard";
import { buildCase, buildForm, CORPUS_AT, ownerOf, rolesOf } from "./build";
import type { ValidatorEngine } from "./engine";
import { buildDocx, clinicianOf, person, type BlockSpec } from "./fixtures";
import type { CasePath, RunCase } from "./types";
import type { PathOutcome } from "./evaluate";
import { judge } from "./judge";

type Loose = Record<string, unknown>;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Each table row's cell texts (fixtures have no nested tables). */
function tableRows(xml: string): string[][] {
  return (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((tr) => (tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []).map(xmlText));
}

/** Checks on the cells of the row whose first cell reads `label` (rows may be removed by the fill, so never by index). */
function rowProblems(xml: string, checks: unknown): string[] {
  const out: string[] = [];
  const rows = tableRows(xml);
  for (const r of (Array.isArray(checks) ? checks : []) as Array<{ label: string; cell: number; contains?: string[]; notContains?: string[]; equals?: string; absent?: boolean }>) {
    const row = rows.find((cells) => cells[0] === r.label);
    if (r.absent) {
      if (row) out.push(`row “${r.label}” is still printed`);
      continue;
    }
    if (!row) {
      out.push(`no row “${r.label}”`);
      continue;
    }
    const text = row[r.cell] ?? "";
    for (const s of r.contains ?? []) if (!text.includes(s)) out.push(`“${r.label}” cell ${r.cell} lacks “${s}” (has ${JSON.stringify(text)})`);
    for (const s of r.notContains ?? []) if (text.includes(s)) out.push(`“${r.label}” cell ${r.cell} still prints “${s}” (${JSON.stringify(text)})`);
    if (r.equals !== undefined && text !== r.equals) out.push(`“${r.label}” cell ${r.cell} is ${JSON.stringify(text)}, expected ${JSON.stringify(r.equals)}`);
  }
  return out;
}

/** Checks on the XML of the paragraph that prints `text`. */
function paraProblems(xml: string, checks: unknown): string[] {
  const out: string[] = [];
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  for (const c of (Array.isArray(checks) ? checks : []) as Array<{ text: string; match?: string[]; notMatch?: string[] }>) {
    const p = paras.find((x) => xmlText(x).includes(c.text));
    if (!p) {
      out.push(`no paragraph prints “${c.text}”`);
      continue;
    }
    for (const re of c.match ?? []) if (!new RegExp(re).test(p)) out.push(`the paragraph with “${c.text}” does not match /${re}/`);
    for (const re of c.notMatch ?? []) if (new RegExp(re).test(p)) out.push(`the paragraph with “${c.text}” matches /${re}/`);
  }
  return out;
}

function docParts(bytes: Uint8Array): { xml: string; text: string } {
  const zip = openZipSafely(bytes);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return { xml, text };
}

/* ------------------------------------------------------------------------------------------------
 * fill
 * ----------------------------------------------------------------------------------------------*/

/**
 * A Word file that makes the fill do work proportional to lines × cells (the R-security-2 / R-security-3 shapes), and
 * its map: `questions` questions in one cell followed by `lines` empty lines, and `cells` more cells in the same row
 * holding `besideLines` empty lines each. kind "placeholders": replace_placeholder questions with clearPlaceholder;
 * kind "typography": after_paragraph questions on a form whose file name marks it converted from RTF.
 */
function hostileForm(spec: Loose): { form: FormDefinition; bytes: Uint8Array } {
  const lines = Number(spec.lines ?? 2000);
  const cells = Number(spec.cells ?? 0);
  const besideLines = Number(spec.besideLines ?? Math.min(lines, 200));
  const questions = Number(spec.questions ?? 40);
  const kind = String(spec.kind ?? "placeholders");
  const own: string[] = [];
  for (let i = 0; i < questions; i++) own.push(kind === "placeholders" ? `Q${i}: [answer ${i}]` : `Question ${i}`);
  for (let i = 0; i < lines; i++) own.push("");
  const row = [{ paras: own }, ...Array.from({ length: cells }, () => ({ paras: Array.from({ length: besideLines }, () => "") }))];
  const layout: BlockSpec[] = [{ p: "Hostile size check (fictional)" }, { table: [row] }];
  const bytes = buildDocx(layout);
  const fields: FormField[] = own.slice(0, questions).map((_, i) => ({
    id: `F-${String(i + 1).padStart(2, "0")}`,
    label: `Question ${i}`,
    guidance: "",
    answerType: "short_text",
    anchor:
      kind === "placeholders"
        ? { kind: "docx", target: "replace_placeholder", blockId: "t0.r0.c0", placeholderText: `[answer ${i}]`, clearPlaceholder: true }
        : { kind: "docx", target: "after_paragraph", blockId: `t0.r0.c0.p${i}` },
    fillSource: { kind: "notes_narrative" },
    required: false,
    confidence: "high",
  }));
  const form: FormDefinition = {
    id: "frm_hostile",
    tenantId: "demo",
    referrer: { name: "Hostile Size Ltd (fictional)", type: "other" },
    title: "Hostile size check",
    file: { fileName: kind === "typography" ? "hostile.rtf" : "hostile.docx", mimeType: DOCX_MIME, sha256: fileSha256(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields,
    status: "proposed",
    analysis: { mode: "rules", promptVersion: "corpus", at: CORPUS_AT, warnings: [] },
    createdAt: CORPUS_AT,
    updatedAt: CORPUS_AT,
  };
  return { form, bytes };
}

/** One timed FINAL fill of a hostile file (ms, or a 4xx refusal). */
async function timedHostileFill(spec: Loose): Promise<{ ms: number; refusal: string | null }> {
  const { form, bytes } = hostileForm(spec);
  const answers: ReturnType<typeof buildFormAnswers> = {};
  if (spec.answered !== false) for (const f of form.fields) answers[f.id] = spec.blank ? { leftBlank: true } : { text: "x" };
  const started = Date.now();
  try {
    await renderFormFile({ form, file: { bytes, mimeType: DOCX_MIME, sha256: form.file.sha256, sizeBytes: bytes.byteLength }, answers, draft: false, format: "original" });
    return { ms: Date.now() - started, refusal: null };
  } catch (err) {
    const e = err as { status?: number; init?: { code?: string } };
    if (typeof e.status === "number" && e.status < 500) return { ms: Date.now() - started, refusal: `${e.status} ${e.init?.code ?? ""}` };
    throw err;
  }
}

/**
 * A hostile size holds when the fill finishes within `maxMs` or is refused (422). On a loaded machine (the whole
 * test:medreport suite runs in parallel) an over-budget time is re-checked: the same file and one at a tenth of the
 * size are sampled again, interleaved (small, big, small) so both see the same load, and the fastest run of each is
 * compared. Work that grows no faster than about linearly (ratio ≤ 25 for 10× the input; quadratic is ×100) still
 * holds – the gate is on the algorithm, not on how busy the machine is. A single small sample taken after the big
 * one is not enough: on 26/10 one landed on an idle moment and gave ×31 for linear work.
 */
async function runHostile(c: RunCase): Promise<PathOutcome> {
  const spec = (c.input.fill?.hostile ?? {}) as Loose;
  const maxMs = Number((c.check?.fill as Loose | undefined)?.maxMs ?? 3000);
  const big = await timedHostileFill(spec);
  if (big.refusal) return { path: "fill", ok: true, detail: `refused (${big.refusal}) after ${big.ms} ms` };
  if (big.ms <= maxMs) return { path: "fill", ok: true, detail: `filled in ${big.ms} ms (budget ${maxMs} ms)` };
  const smallSpec = { ...spec, lines: Math.max(1, Math.round(Number(spec.lines ?? 2000) / 10)), besideLines: Math.max(1, Math.round(Number(spec.besideLines ?? 200) / 10)) };
  const small1 = await timedHostileFill(smallSpec);
  const big2 = await timedHostileFill(spec);
  if (big2.refusal) return { path: "fill", ok: true, detail: `refused (${big2.refusal}) after ${big2.ms} ms` };
  const small2 = await timedHostileFill(smallSpec);
  const bigMs = Math.min(big.ms, big2.ms);
  const smallMs = Math.min(small1.ms, small2.ms);
  if (bigMs <= maxMs) return { path: "fill", ok: true, detail: `filled in ${bigMs} ms on a re-run (budget ${maxMs} ms; first run ${big.ms} ms on a busy machine)` };
  const ratio = bigMs / Math.max(1, smallMs);
  const runs = `big ${big.ms}/${big2.ms} ms, a tenth ${small1.ms}/${small2.ms} ms`;
  return ratio <= 25
    ? { path: "fill", ok: true, detail: `over ${maxMs} ms on a busy machine but grows linearly: ×${ratio.toFixed(1)} for 10× the input (${runs})` }
    : { path: "fill", ok: false, detail: `over the ${maxMs} ms budget and grows ×${ratio.toFixed(1)} for 10× the input (${runs})` };
}

async function runFill(c: RunCase): Promise<PathOutcome> {
  const fill = (c.input.fill ?? {}) as Loose;
  const check = (c.check?.fill ?? {}) as Loose;
  if (fill.hostile) return runHostile(c);
  const built = await buildCase(c.input);
  if (!built.form || !built.fileBytes) return { path: "fill", ok: false, detail: "fill needs a form report (input.report form:…)" };
  const form: FormDefinition = built.form;
  const bytes: Uint8Array = built.fileBytes;
  const roles = rolesOf(c.input);
  const answers = buildFormAnswers(built.report, form, fill.draft === true ? {} : { receipt: { signer: clinicianOf(roles.signer), signedAt: CORPUS_AT } });
  for (const [k, v] of Object.entries((fill.answers ?? {}) as Record<string, unknown>)) answers[k] = v as (typeof answers)[string];
  const started = Date.now();
  let out: Awaited<ReturnType<typeof renderFormFile>> | null = null;
  let refusal: string | null = null;
  try {
    out = await renderFormFile({ form, file: { bytes, mimeType: DOCX_MIME, sha256: form.file.sha256, sizeBytes: bytes.byteLength }, answers, draft: fill.draft === true, format: "original" });
  } catch (err) {
    const e = err as { status?: number; init?: { code?: string; detail?: string } };
    if (typeof e.status === "number" && e.status < 500) refusal = `${e.status} ${e.init?.code ?? ""} ${String(e.init?.detail ?? "").slice(0, 120)}`;
    else throw err;
  }
  const ms = Date.now() - started;
  const problems: string[] = [];
  if (typeof check.maxMs === "number" && ms > check.maxMs && !refusal) problems.push(`took ${ms} ms (limit ${check.maxMs} ms)`);
  if (c.expect === "BLOCK") {
    if (!refusal) problems.push("the FINAL copy was made");
    return { path: "fill", ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `refused: ${refusal}` };
  }
  if (refusal) {
    if (check.refusedOk === true) return { path: "fill", ok: problems.length === 0, detail: `refused (allowed): ${refusal}; ${ms} ms` };
    return { path: "fill", ok: false, detail: `the FINAL fill was refused: ${refusal}` };
  }
  const { xml, text } = docParts(out!.bytes);
  for (const s of strings(check.contains)) if (!text.includes(s)) problems.push(`missing “${s}”`);
  for (const s of strings(check.notContains)) if (text.includes(s)) problems.push(`still prints “${s}”`);
  for (const s of strings(check.xmlMatch)) if (!new RegExp(s).test(xml)) problems.push(`document.xml does not match /${s}/`);
  for (const s of strings(check.xmlNotMatch)) if (new RegExp(s).test(xml)) problems.push(`document.xml matches /${s}/`);
  problems.push(...rowProblems(xml, check.rows), ...paraProblems(xml, check.paras));
  if (c.expect === "FLAG" && (out!.warnings ?? []).length === 0) problems.push("no fill warning");
  return { path: "fill", ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `filled in ${ms} ms${out!.warnings.length ? `; warnings: ${out!.warnings.join(" | ").slice(0, 160)}` : ""}` };
}

/* ------------------------------------------------------------------------------------------------
 * lint
 * ----------------------------------------------------------------------------------------------*/

const LINT_MODULE = "../../../form-map-lint";

async function runLint(c: RunCase): Promise<PathOutcome> {
  let mod: Loose;
  try {
    mod = (await import(/* @vite-ignore */ LINT_MODULE)) as Loose;
  } catch {
    return { path: "lint", ok: false, detail: "core/form-map-lint.ts (lintFormMap) is not on this tree" };
  }
  const lint = mod.lintFormMap as ((form: FormDefinition, opts?: Loose) => Array<{ rule: string; fieldId?: string; severity?: string }>) | undefined;
  if (typeof lint !== "function") return { path: "lint", ok: false, detail: "core/form-map-lint.ts has no lintFormMap" };
  const input = (c.input.lint ?? {}) as Loose;
  const { form } = await buildForm(String(input.form ?? "cf-discharge"), "clinic-corpus");
  const patched: FormDefinition = {
    ...form,
    fields: form.fields.map((f) => {
      const patch = (input.fields as Record<string, Partial<FormField>> | undefined)?.[f.id];
      return patch ? ({ ...f, ...patch } as FormField) : f;
    }),
    ...(input.analysisWarnings ? { analysis: { ...form.analysis, warnings: strings(input.analysisWarnings) } } : {}),
    ...(input.noSourcePin ? { file: { ...form.file } } : {}),
  };
  const issues = lint(patched, (input.options ?? {}) as Loose);
  const errors = issues.filter((i) => (i.severity ?? "error") === "error");
  const want = (c.check?.lint ?? {}) as { rule?: string; field?: string };
  const hits = errors.filter((i) => (!want.rule || i.rule === want.rule) && (!want.field || i.fieldId === want.field));
  const detail = `errors: ${errors.map((i) => `${i.rule}${i.fieldId ? `@${i.fieldId}` : ""}`).join(", ") || "none"}`;
  if (c.expect === "FLAG" || c.expect === "BLOCK") return { path: "lint", ok: hits.length > 0, detail };
  const relevant = want.field ? errors.filter((i) => i.fieldId === want.field) : errors;
  return { path: "lint", ok: relevant.length === 0, detail };
}

/* ------------------------------------------------------------------------------------------------
 * assemble
 * ----------------------------------------------------------------------------------------------*/

async function runAssemble(c: RunCase, engine: ValidatorEngine): Promise<PathOutcome> {
  const built = await buildCase(c.input);
  const a = (c.input.assemble ?? {}) as Loose;
  const output = a.output as { sections: unknown[]; gaps: unknown[] };
  const keys = strings(a.keys).length ? strings(a.keys) : Array.from(new Set((output.sections as Array<{ sectionKey: string }>).map((s) => s.sectionKey)));
  const roles = rolesOf(c.input);
  const author = roles.author && person(roles.author).hcpc ? clinicianOf(roles.author) : undefined;
  const res = assembleDraft({
    template: built.template,
    bundle: built.report.bundleSnapshot,
    instructingParty: built.report.instructingParty,
    sectionKeys: keys,
    computedFacts: built.computedFacts,
    output: output as Parameters<typeof assembleDraft>[0]["output"],
    meta: { mode: "demo_prewritten", sectionKeys: keys, at: CORPUS_AT, promptVersion: "corpus" },
    ...(built.form ? { form: built.form } : {}),
    idSeed: "corpus",
    ...(author ? { author } : {}),
    // The release's assembly takes the approver as voice owner (WD); older code ignores it.
    ...({ approver: roles.approver ? { name: person(roles.approver).name, hcpc: person(roles.approver).hcpc } : null } as object),
  });
  const check = (c.check?.assemble ?? {}) as Loose;
  const box = String(check.box ?? keys[0]);
  const section = res.sections.find((s) => s.key === box);
  if (c.expect === "BLOCK") {
    // What assembly prints must still block when validated (a pre-strip never makes unsafe text pass).
    const assembled: Report = { ...built.report, sections: built.report.sections.map((s) => res.sections.find((x) => x.key === s.key) ?? s) };
    const v = engine.validate(assembled, built.template, { computedFacts: built.computedFacts, form: built.form, owner: ownerOf(built) });
    const j = judge({ expect: "BLOCK", ack: c.ack, blockBy: c.blockBy, check: c.check, engine, report: { ...assembled, flags: v.flags }, flags: v.flags, blocking: v.blocking, subject: { box, paragraphId: null }, approver: built.approver });
    const printed = (section?.paragraphs ?? []).map((p) => p.text).join(" ");
    return { path: "assemble", ok: j.ok, detail: `assembled ${JSON.stringify(printed.slice(0, 120))} ⇒ ${j.detail}` };
  }
  const printed = (section?.paragraphs ?? []).map((p) => p.text).join("\n");
  const gaps = res.gaps.filter((g) => g.sectionKey === box);
  const surfacedText = [...gaps.map((g) => `${g.issue}\n${g.suggestedQuestion}`), ...res.flags.filter((f) => f.sectionKey === box).map((f) => `${f.message}\n${f.evidence ?? ""}`)].join("\n");
  const problems: string[] = [];
  for (const s of strings(check.printed)) if (!printed.includes(s)) problems.push(`not printed: “${s}”`);
  for (const s of strings(check.notPrinted)) if (printed.includes(s)) problems.push(`printed: “${s}”`);
  for (const s of strings(check.surfaced)) if (!surfacedText.includes(s) && !printed.includes(s)) problems.push(`dropped without trace: “${s}”`);
  for (const re of strings(check.noGap)) if (gaps.some((g) => new RegExp(re, "i").test(`${g.issue} ${g.suggestedQuestion}`))) problems.push(`a gap says /${re}/`);
  if (check.noSuggestedAnswer === true && gaps.some((g) => g.suggestedAnswer)) problems.push(`one-click answer offered: “${gaps.find((g) => g.suggestedAnswer)?.suggestedAnswer}”`);
  if (check.noAnswer === true && section?.answer && section.answer.value !== null && section.answer.value !== undefined) problems.push(`code set the answer: ${JSON.stringify(section.answer.value)}`);
  if (c.expect === "FLAG" && strings(check.surfaced).length === 0 && gaps.length === 0) problems.push("nothing held back");
  const detail = `printed: ${JSON.stringify(printed.slice(0, 160))}; gaps: ${gaps.map((g) => JSON.stringify(g.issue.slice(0, 80)) + (g.suggestedAnswer ? ` [tick ${g.suggestedAnswer}]` : "")).join(", ") || "none"}`;
  return { path: "assemble", ok: problems.length === 0, detail: problems.length ? `${problems.join("; ")} – ${detail}` : detail };
}

/* ------------------------------------------------------------------------------------------------
 * split / scope
 * ----------------------------------------------------------------------------------------------*/

const SENTENCES_MODULE = "../../../text/sentences";

async function runSplit(c: RunCase): Promise<PathOutcome> {
  let mod: Loose;
  try {
    mod = (await import(/* @vite-ignore */ SENTENCES_MODULE)) as Loose;
  } catch {
    return { path: "split", ok: false, detail: "core/text/sentences.ts (splitSentences) is not on this tree" };
  }
  const split = mod.splitSentences as ((text: string, policy?: string) => Array<string | { text: string }>) | undefined;
  if (typeof split !== "function") return { path: "split", ok: false, detail: "core/text/sentences.ts has no splitSentences" };
  const input = (c.input.split ?? {}) as Loose;
  const sentences = split(String(input.text ?? ""), String(input.policy ?? "prose")).map((s) => (typeof s === "string" ? s : s.text).trim());
  const check = (c.check?.split ?? {}) as Loose;
  const problems: string[] = [];
  if (typeof check.count === "number" && sentences.length !== check.count) problems.push(`${sentences.length} sentences, expected ${check.count}`);
  for (const w of strings(check.whole)) if (!sentences.some((s) => s.includes(w))) problems.push(`“${w}” is split`);
  return { path: "split", ok: problems.length === 0, detail: `${problems.join("; ")} ${JSON.stringify(sentences)}`.trim() };
}

function runScope(c: RunCase): PathOutcome {
  const input = (c.input.scope ?? {}) as Loose;
  const text = String(input.text ?? "");
  const out = removeSentencesWithTerms(text, strings(input.terms));
  const check = (c.check?.scope ?? {}) as Loose;
  const problems: string[] = [];
  for (const s of strings(check.contains)) if (!out.includes(s)) problems.push(`lost “${s}”`);
  for (const s of strings(check.notContains)) if (out.includes(s)) problems.push(`kept “${s}”`);
  for (const re of strings(check.notMatch)) if (new RegExp(re).test(out)) problems.push(`matches /${re}/`);
  return { path: "scope", ok: problems.length === 0, detail: `${problems.join("; ")} → ${JSON.stringify(out)}`.trim() };
}

/* ------------------------------------------------------------------------------------------------
 * probe
 * ----------------------------------------------------------------------------------------------*/

async function runProbe(c: RunCase): Promise<PathOutcome> {
  const input = (c.input.probe ?? {}) as Loose;
  const name = String(input.name ?? "");
  const check = (c.check?.probe ?? {}) as Loose;
  if (name === "own-voice") {
    const out = rewriteInFirstPerson(String(input.text ?? ""), String(input.owner ?? "Sarah Reid"));
    const problems = [
      ...strings(check.contains).filter((s) => !out.includes(s)).map((s) => `lost “${s}”`),
      ...strings(check.notContains).filter((s) => out.includes(s)).map((s) => `wrote “${s}”`),
    ];
    return { path: "probe", ok: problems.length === 0, detail: `${problems.join("; ")} → ${JSON.stringify(out)}`.trim() };
  }
  const built = await buildCase(c.input);
  if (name === "condition") {
    const key = String(input.box ?? built.box ?? "");
    const issue = await issueStateOf(built.report, built.form, key);
    const applies = issue ?? (notApplicable(built.report.sections, key) ? false : true);
    const cond = conditionOf(built.report.sections, key);
    const want = check.applies as boolean;
    return { path: "probe", ok: applies === want, detail: `${key} ${applies ? "applies" : "does not apply"} (expected ${want ? "applies" : "does not apply"})${cond ? ` – depends on ${cond.controllers.map((s) => s.key).join(", ")}` : " – read as an ordinary question"}` };
  }
  if (name === "section-text") {
    const key = String(input.box ?? "");
    const text = (built.report.sections.find((s) => s.key === key)?.paragraphs ?? []).map((p) => p.text).join(" ");
    const problems = strings(check.notContains).filter((s) => text.includes(s)).map((s) => `prints “${s}”`);
    return { path: "probe", ok: problems.length === 0, detail: `${problems.join("; ")} ${JSON.stringify(text.slice(0, 200))}`.trim() };
  }
  if (name === "copy-equals-issued") {
    if (!built.form) return { path: "probe", ok: false, detail: "needs a form report" };
    const signed: Report = { ...built.report, status: "signed" };
    const issued = buildFormAnswers(signed, built.form, { receipt: { signer: clinicianOf(built.signer), signedAt: CORPUS_AT } });
    const copied = copyEntries(signed, built.form);
    const problems: string[] = [];
    for (const e of copied) {
      if (e.signoff) continue;
      const a = issued[e.key];
      const prints = Boolean(a && !a.leftBlank && !a.blank && (a.text ?? "").trim() !== "");
      const copies = e.answer !== null && e.answer.trim() !== "";
      if (prints !== copies) problems.push(`${e.key}: ${copies ? "copied" : "not copied"} but ${prints ? "printed" : "not printed"}`);
    }
    return { path: "probe", ok: problems.length === 0, detail: problems.join("; ") || "Copy answers = issued" };
  }
  if (name === "map-note-visible") {
    let mod: Loose = {};
    try {
      mod = (await import(/* @vite-ignore */ "../../../../ui/components/forms/mapping")) as Loose;
    } catch {
      // no mapping module: nothing hides notes
    }
    const shows = mod.showsMapNote as ((field: Loose, opts: Loose) => boolean) | undefined;
    if (typeof shows !== "function") return { path: "probe", ok: true, detail: "no note filter on this tree: every analysis note is shown" };
    const visible = shows({ note: String(input.note ?? "") }, { tenant: true });
    return { path: "probe", ok: visible === true, detail: `tenant mode shows the note: ${visible}` };
  }
  if (name === "status-label") {
    // Who answered, as the review labels it (B2-20, C-REV-3): never "drafted" for a person's answer, never "clinician"
    // for staff.
    const key = String(input.box ?? built.box ?? "");
    const section = built.report.sections.find((s) => s.key === key);
    const field = built.form?.fields.find((f) => f.id === key);
    const v = _engineValidate(built);
    const status = questionStatus({ section, field } as Parameters<typeof questionStatus>[0], v.flags, built.report.gaps, answeredByPerson(built.report, key), false, built.report.sections);
    const bad = strings(check.notStatus).includes(status);
    return { path: "probe", ok: !bad, detail: `${key} is labelled “${status}”${bad ? " – wrong for who answered it" : ""}` };
  }
  if (name === "rtf-picture") {
    // A converted letter template keeps its logo (B0-14, B3-9): a 1×1 PNG in an RTF \\pict group.
    const png = "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082";
    const rtf = `{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Corpus Physio (fictional) {\\pict\\pngblip\\picw1\\pich1\\picwgoal240\\pichgoal240 ${png}}\\par Patient name\\par}`;
    const out = convertRtfToDocx(new TextEncoder().encode(rtf), { maxBytes: 5 * 1024 * 1024 });
    const media = Object.keys(openZipSafely(out.docx).files).filter((n) => n.startsWith("word/media/"));
    return { path: "probe", ok: media.length > 0, detail: media.length ? `the picture is kept (${media.join(", ")})` : "the converted file has no picture" };
  }
  if (name === "schema-keeps-release-fields") {
    // The plan's "model" is stored as Report.reportModel (W0.3: "model" is a banned key in the clinic's case export).
    const r = { ...built.report, approver: { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" }, reportModel: 2 } as Report & Loose;
    const parsed = ReportSchema.safeParse(r) as { success: boolean; data?: Loose };
    const kept = parsed.success && parsed.data && "approver" in parsed.data && parsed.data.reportModel === 2;
    // …and the release's factory writes them (W0.6): the corpus report is made by createReport / createFormReport.
    const made = (built.report as Report & Loose).reportModel === 2 && (built.report as Report & Loose).approver !== undefined;
    const ok = Boolean(kept) && made;
    const detail = !kept ? "ReportSchema drops the release fields (approver, reportModel)" : !made ? "the report factory does not set reportModel 2 and the approver" : "release fields kept by ReportSchema and set by the factory";
    return { path: "probe", ok, detail };
  }
  return { path: "probe", ok: false, detail: `unknown probe ${name}` };
}

function _engineValidate(built: Awaited<ReturnType<typeof buildCase>>) {
  return CANDIDATE_ENGINE.validate(built.report, built.template, { computedFacts: built.computedFacts, form: built.form, owner: ownerOf(built) });
}

/** core/issue-state.ts (WA1), loaded by a computed path so a tree without it still type-checks and loads. */
const ISSUE_STATE_MODULE = ["..", "..", "..", "issue-state"].join("/");

/** The release's issue state for one box, when the tree has core/issue-state.ts (WA1): true = applies. */
async function issueStateOf(report: Report, form: FormDefinition | null, key: string): Promise<boolean | null> {
  let mod: Loose;
  try {
    mod = (await import(/* @vite-ignore */ ISSUE_STATE_MODULE)) as Loose;
  } catch {
    return null;
  }
  const fn = mod.issueState as ((content: Report, form: FormDefinition | null, approval: unknown) => Record<string, { kind?: string; reason?: string }> | { fields?: Record<string, { kind?: string; reason?: string }> }) | undefined;
  if (typeof fn !== "function") return null;
  const res = fn(report, form, null) as Loose;
  const fields = ((res.fields ?? res) as Record<string, { kind?: string; reason?: string }>) ?? {};
  const st = fields[key];
  if (!st) return null;
  return !(st.kind === "not_applicable" && (st.reason === "condition" || st.reason === undefined));
}

export async function runPurePath(path: CasePath, c: RunCase, engine: ValidatorEngine): Promise<PathOutcome> {
  switch (path) {
    case "fill":
      return runFill(c);
    case "lint":
      return runLint(c);
    case "assemble":
      return runAssemble(c, engine);
    case "split":
      return runSplit(c);
    case "scope":
      return runScope(c);
    case "probe":
      return runProbe(c);
    default:
      return { path, ok: false, detail: `not a pure path: ${path}` };
  }
}
