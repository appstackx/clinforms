/**
 * Safety corpus: run one case through every path it declares and decide whether it holds.
 *
 * The meaning of BLOCK / FLAG / PASS on a box is in judge.ts. Per path:
 * - validate: the validators with the approver as voice owner (judge).
 * - sign:     POST /sign as the signer. BLOCK = 403/409; PASS and FLAG = 200; REFUSED_403/409 = that status.
 *             input.store.seedAs stores the report first (tenant store); input.store.thenBody "edited" changes the
 *             subject's text in the body sent to /sign (a stale or edited body must be refused).
 * - render:   /sign, then POST /render FINAL. PASS = a final copy; BLOCK = no final copy; IDENTICAL = after changing
 *             only keys outside the receipt (input.render.mutate), the FINAL is refused (409) or its document text
 *             is identical.
 * - store:    PUT /store/reports as input.store.putAs with input.store.forge applied (REFUSED_403 = refused).
 * - reducer:  input.steps by their actors (reducer.ts), then validate (judge).
 * - fill, lint, assemble, split, scope, probe: pure-paths.ts.
 * Every result says what it saw, so a failing case reads as a bug report.
 */
import type { Report, ReportFlag } from "../../../types";
import { validateReport } from "../../index";
import { buildCase, ownerOf, rolesOf, type Built } from "./build";
import type { ValidatorEngine } from "./engine";
import { checkFixRules, offeredFixes, type OfferedFix } from "./fixes";
import { actorOf, person } from "./fixtures";
import { createHttpHarness, getStoredReport, postRenderFinal, postSign, putStoredReport, type HttpHarness } from "./http";
import { createAmendedVersion } from "../../../../ui/components/review/review-model";
import { judge, onSubject, describeFlags, matches, INCIDENTAL_CODES, type FlagMatcher, type Judgement } from "./judge";
import { runPurePath } from "./pure-paths";
import { runSteps } from "./reducer";
import type { CasePath, PersonKey, RunCase } from "./types";
import { openZipSafely } from "../../../../forms/zip-guard";

export interface PathOutcome {
  path: CasePath;
  ok: boolean;
  detail: string;
}

export interface CaseOutcome {
  id: string;
  ok: boolean;
  paths: PathOutcome[];
}

export interface EvalOptions {
  engine: ValidatorEngine;
  /** Only these paths (corpus-diff runs "validate" and "reducer" only). */
  onlyPaths?: readonly CasePath[];
}


export function validateBuilt(built: Built, engine: ValidatorEngine, report: Report = built.report) {
  return engine.validate(report, built.template, { computedFacts: built.computedFacts, form: built.form, owner: ownerOf(built) });
}

/** Drop flags whose evidence comes only from an anti-strip carrier's own words (not from the case's text). */
function withoutCarrierFlags(c: RunCase, flags: ReportFlag[]): ReportFlag[] {
  if (!c.carrierText || c.parentText === undefined) return flags;
  const carrier = c.carrierText.toLowerCase();
  const original = c.parentText.toLowerCase();
  return flags.filter((f) => {
    const ev = (f.evidence ?? "").toLowerCase();
    return !ev || !carrier.includes(ev) || original.includes(ev);
  });
}

function judgeBuilt(c: RunCase, built: Built, engine: ValidatorEngine, report: Report = built.report): Judgement & { flags: ReportFlag[]; blocking: ReportFlag[] } {
  const raw = validateBuilt(built, engine, report);
  const res = { ...raw, flags: withoutCarrierFlags(c, raw.flags), blocking: withoutCarrierFlags(c, raw.blocking) };
  const expect = c.expect === "BLOCK" || c.expect === "FLAG" || c.expect === "PASS" ? c.expect : "PASS";
  const j = judge({
    expect,
    ack: c.ack,
    blockBy: c.blockBy,
    check: c.check,
    engine,
    report: { ...report, flags: res.flags },
    flags: res.flags,
    blocking: res.blocking,
    subject: { box: built.box, paragraphId: report === built.report ? built.paragraphId : null },
    approver: built.approver,
  });
  return { ...j, flags: res.flags, blocking: res.blocking };
}

/* ------------------------------------------------------------------------------------------------
 * validate (+ one-click acceptance for "pass, or one approver click")
 * ----------------------------------------------------------------------------------------------*/

async function runValidate(c: RunCase, built: Built, engine: ValidatorEngine): Promise<PathOutcome> {
  if (c.expect === "NOT_OFFERED") return runNotOffered(c, built, engine);
  const j = judgeBuilt(c, built, engine);
  if (j.ok && (c.check?.fixClears || c.check?.fixYields)) return runFixOutcome(c, built, engine, j.flags, j.detail);
  if (j.ok || c.expect !== "PASS" || c.check?.orAccept !== true) return { path: "validate", ok: j.ok, detail: j.detail };
  // Khuram 26/10: the approver may accept, with one click, a drafted work-status / return line their own note records.
  const report = { ...built.report, flags: j.flags };
  const approverFixes = (await offeredFixes(report, { actor: built.approver ?? "sarah", voiceOwner: built.approver, form: built.form, template: built.template })).filter((f) => f.kind === "accept-note-words");
  const staffFixes = (await offeredFixes(report, { actor: "pat", voiceOwner: built.approver, form: built.form, template: built.template })).filter((f) => f.kind === "accept-note-words");
  if (approverFixes.length === 0) return { path: "validate", ok: false, detail: `${j.detail}; no approver acceptance offered` };
  if (staffFixes.length > 0) return { path: "validate", ok: false, detail: "the acceptance is offered to staff too" };
  let next: Report = report;
  for (const f of approverFixes) next = f.apply(next);
  const after = judgeBuilt(c, built, engine, next);
  return { path: "validate", ok: after.ok, detail: `after one approver acceptance: ${after.detail}` };
}

/**
 * check.fixClears [kinds]: one of these fixes is offered to the approver and, applied, leaves no flag on the box.
 * check.fixYields {kind, text}: that fix is offered and leaves exactly `text` in the box.
 */
async function runFixOutcome(c: RunCase, built: Built, engine: ValidatorEngine, flags: ReportFlag[], detail: string): Promise<PathOutcome> {
  const report = { ...built.report, flags };
  const fixes = await offeredFixes(report, { actor: built.approver ?? "sarah", voiceOwner: built.approver, form: built.form, template: built.template });
  const box = built.box ?? "";
  if (c.check?.fixClears) {
    const kinds = c.check.fixClears as string[];
    const fix = fixes.find((f) => kinds.includes(f.kind) && (f.box === null || f.box === box));
    if (!fix) return { path: "validate", ok: false, detail: `${detail}; no ${kinds.join("/")} fix offered` };
    const after = fix.apply(report);
    const res = validateBuilt(built, engine, after);
    const left = res.flags.filter((f) => f.sectionKey === box);
    return { path: "validate", ok: left.length === 0, detail: `${detail}; after “${fix.label}”: ${describeFlags(left)}` };
  }
  const want = c.check?.fixYields as { kind: string; text: string };
  const fix = fixes.find((f) => f.kind === want.kind && (f.box === null || f.box === box));
  if (!fix) return { path: "validate", ok: false, detail: `${detail}; no ${want.kind} fix offered` };
  const after = fix.apply(report);
  const text = (after.sections.find((s) => s.key === box)?.paragraphs ?? []).map((p) => p.text).join(" ").trim();
  return { path: "validate", ok: text === want.text, detail: `${detail}; after “${fix.label}”: ${JSON.stringify(text)}` };
}

/**
 * NOT_OFFERED: none of check.notOffered (fix kinds) is offered to check.to (actor keys; default every member). With
 * check.flag (W0 decisions 26/10), that flag must still be on the subject – the problem stays visible although no
 * one-click removes it (e.g. a box whose only sentence is a comment about the notes).
 */
async function runNotOffered(c: RunCase, built: Built, engine: ValidatorEngine): Promise<PathOutcome> {
  const kinds = (c.check?.notOffered ?? []) as string[];
  const to = ((c.check?.to as PersonKey[] | undefined) ?? ["sarah", "tom", "pat", "chris"]) as PersonKey[];
  const res = validateBuilt(built, engine);
  const report = { ...built.report, flags: res.flags };
  const want = c.check?.flag as FlagMatcher | undefined;
  if (want && !res.flags.some((f) => onSubject(f, { box: built.box, paragraphId: built.paragraphId }) && matches(f, want))) {
    return { path: "validate", ok: false, detail: `expected the flag ${JSON.stringify(want)} to stay – subject: ${describeFlags(res.flags.filter((f) => onSubject(f, { box: built.box, paragraphId: built.paragraphId })))}` };
  }
  const offered: string[] = [];
  for (const actor of to) {
    for (const f of await offeredFixes(report, { actor, voiceOwner: built.approver, form: built.form, template: built.template })) {
      if (f.box !== null && built.box && f.box !== built.box) continue;
      if (kinds.includes(f.kind) || kinds.includes("*")) offered.push(`${f.kind} (“${f.label}”) to ${actor}`);
    }
  }
  const forbid = (c.check?.forbid ?? []) as FlagMatcher[];
  const forbidden = res.flags.filter((f) => onSubject(f, { box: built.box, paragraphId: built.paragraphId }) && forbid.some((m) => matches(f, m)));
  if (forbidden.length) return { path: "validate", ok: false, detail: `flagged: ${describeFlags(forbidden)}` };
  return offered.length === 0
    ? { path: "validate", ok: true, detail: `not offered: ${kinds.join(", ") || "(none asked)"}${forbid.length ? "; no forbidden flag" : ""}${want ? `; still flagged: ${describeFlags(res.flags.filter((f) => onSubject(f, { box: built.box, paragraphId: built.paragraphId }) && matches(f, want)))}` : ""}` }
    : { path: "validate", ok: false, detail: `offered: ${offered.join("; ")}` };
}

/* ------------------------------------------------------------------------------------------------
 * sign / render / store
 * ----------------------------------------------------------------------------------------------*/

function signMode(c: RunCase): "tenant" | "demo" {
  return c.input.signMode ?? "tenant";
}

function withEditedSubject(built: Built): Report {
  const box = built.box;
  return {
    ...built.report,
    sections: built.report.sections.map((s) =>
      s.key === box ? { ...s, paragraphs: s.paragraphs.map((p, i) => (i === 0 ? { ...p, text: `${p.text} He was seen again at the clinic.` } : p)) } : s,
    ),
  };
}

/**
 * harden-WA1 (check2 N1): what a member's store write may rewrite in the report it stores – a box's frozen condition or
 * printed question (input.store.rewrite: box → {condition (null: removed), title}), every frozen condition
 * (dropConditions) and Report.reportModel (dropReportModel). Report content the server must not trust.
 */
type StoreRewrite = { rewrite?: Record<string, { condition?: Record<string, unknown> | null; title?: string }>; dropConditions?: boolean; dropReportModel?: boolean };

function rewrittenReport(report: Report, r: StoreRewrite): Report {
  const sections = report.sections.map((s) => {
    const patch = r.rewrite?.[s.key];
    let next = { ...s } as Report["sections"][number];
    if (r.dropConditions || (patch && patch.condition === null)) delete next.condition;
    if (patch?.condition) next = { ...next, condition: patch.condition as unknown as NonNullable<typeof s.condition> };
    if (patch?.title !== undefined) next = { ...next, title: patch.title };
    return next;
  });
  const out = { ...report, sections } as Report;
  if (r.dropReportModel) delete (out as { reportModel?: number }).reportModel;
  return out;
}

async function runSign(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  const store = (c.input.store ?? {}) as { seedAs?: PersonKey; thenBody?: "edited" | "stale" | "same" } & StoreRewrite;
  const forged = Boolean(store.rewrite || store.dropConditions || store.dropReportModel);
  let report = forged ? rewrittenReport(built.report, store) : built.report;
  let refusedFirst = "";
  if (store.seedAs) {
    const seeded = await putStoredReport(h, report, store.seedAs, null);
    if (forged && !store.thenBody && seeded.status === 403) {
      // bh2-rc1 (WA1 x WC): the clinic's store refuses the member's rewritten copy itself (WC: a box's condition, its
      // question and the report model are pinned to the map). /sign must still refuse that copy should it be stored
      // past the store's checks: postSign stores it exactly as the case wrote it when the clinic holds no revision.
      refusedFirst = `the store refused ${person(store.seedAs).name}'s rewritten copy (${seeded.status} ${seeded.code ?? ""}); stored past it, `;
    } else if (seeded.status !== 201 && seeded.status !== 200) return { path: "sign", ok: false, detail: `could not store the report first (${seeded.status} ${seeded.code ?? ""})` };
    if (store.thenBody === "edited") report = withEditedSubject(built);
    if (store.thenBody === "stale") {
      // Someone saves a newer revision; the approver's tab still sends the old one.
      const newer = await putStoredReport(h, withEditedSubject(built), store.seedAs, (seeded.body as { rev?: number }).rev ?? 1);
      if (newer.status !== 200) return { path: "sign", ok: false, detail: `could not store the newer revision (${newer.status} ${newer.code ?? ""})` };
    }
  }
  const res = await postSign(h, { report, template: built.template, form: built.form, signer: built.signer, mode: signMode(c), fileBytes: built.fileBytes });
  const got = `${res.status}${res.code ? ` ${res.code}` : ""}`;
  const flags = ((res.body as { flags?: ReportFlag[] } | null)?.flags ?? []).filter((f) => onSubject(f, { box: built.box, paragraphId: built.paragraphId }));
  const detail = `${refusedFirst}/sign by ${person(built.signer).name}: ${got}${flags.length ? ` – ${describeFlags(flags)}` : ""}`;
  switch (c.expect) {
    case "BLOCK": {
      if (res.status !== 409 && res.status !== 403) return { path: "sign", ok: false, detail };
      // Refused because of the subject – not because another box is incomplete.
      if (res.code !== "SIGNOFF_BLOCKED") return { path: "sign", ok: true, detail };
      const allowed = new Set(c.blockBy ?? []);
      const own = flags.filter((f) => f.severity === "blocking" && (!INCIDENTAL_CODES.has(f.code) || allowed.has(f.code)));
      return { path: "sign", ok: own.length > 0, detail: own.length ? detail : `${detail} – refused, but not because of the subject` };
    }
    case "PASS":
    case "FLAG":
      return { path: "sign", ok: res.status === 200, detail };
    case "REFUSED_403":
      return { path: "sign", ok: res.status === 403, detail };
    case "REFUSED_409":
      return { path: "sign", ok: res.status === 409, detail };
    default:
      return { path: "sign", ok: res.status < 500, detail };
  }
}

function documentText(bytes: Uint8Array): string {
  const zip = openZipSafely(bytes);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  return xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
}

/** Change only keys the receipt does not cover (flags, activity, status, updatedAt), as a forging client would. */
export function mutateOutsideReceipt(report: Report, kinds: readonly string[]): Report {
  let r: Report = { ...report };
  for (const k of kinds) {
    if (k === "flags-ack-na") {
      r = {
        ...r,
        flags: [
          ...r.flags,
          ...r.sections.map(
            (s): ReportFlag => ({
              id: `forged-${s.key}`,
              code: "NOT_APPLICABLE_ANSWERED" as ReportFlag["code"],
              severity: "blocking",
              sectionKey: s.key,
              message: "forged",
              acknowledged: { reason: "Print my answer anyway (forged).", at: r.updatedAt },
            }),
          ),
        ],
      };
    } else if (k === "activity-answer-set") {
      r = { ...r, activity: [...r.activity, ...r.sections.map((s) => ({ at: r.updatedAt, actor: "Pat Morgan", action: "answer_set", detail: `${s.key}: forged answer` }))] };
    } else if (k === "flags-clear") {
      r = { ...r, flags: [] };
    } else if (k === "status-draft") {
      r = { ...r, status: "draft" };
    } else if (k === "updatedAt") {
      r = { ...r, updatedAt: "2026-12-31T23:59:59.000Z" };
    }
  }
  return r;
}

async function runRender(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  const mode = signMode(c);
  const signed = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: built.signer, mode, fileBytes: built.fileBytes });
  if (!signed.receipt) {
    const blocked = `/sign refused (${signed.status} ${signed.code ?? ""}) – no final copy`;
    // A case about what happens AFTER approval needs the approval first.
    return { path: "render", ok: c.expect === "BLOCK" && c.input.render?.contentEdit !== true, detail: blocked };
  }
  let approved: Report = { ...built.report, status: "signed", receipt: signed.receipt };
  // A body whose content changed after approval never makes a final copy.
  if (c.input.render?.contentEdit === true) approved = { ...withEditedSubject(built), status: "signed", receipt: signed.receipt };
  const first = await postRenderFinal(h, { report: approved, receipt: signed.receipt, form: built.form, fileBytes: built.fileBytes, member: built.signer, mode });
  const kind = first.headers.get("x-medreport-render");
  if (c.expect === "PASS") return { path: "render", ok: first.status === 200 && kind === "final", detail: `FINAL: ${first.status} ${first.code ?? ""} ${kind ?? ""}`.trim() };
  if (c.expect === "BLOCK") return { path: "render", ok: first.status !== 200 || kind !== "final", detail: `FINAL: ${first.status} ${first.code ?? ""} ${kind ?? ""}`.trim() };
  if (c.expect !== "IDENTICAL") return { path: "render", ok: first.status < 500, detail: `FINAL: ${first.status}` };
  if (first.status !== 200 || !first.bytes) return { path: "render", ok: false, detail: `the unmutated FINAL failed: ${first.status} ${first.code ?? ""}` };
  const kinds = ((c.input.render?.mutate as string[] | undefined) ?? ["flags-ack-na", "activity-answer-set", "status-draft", "updatedAt"]) as string[];
  const forged = mutateOutsideReceipt(approved, kinds);
  const second = await postRenderFinal(h, { report: forged, receipt: signed.receipt, form: built.form, fileBytes: built.fileBytes, member: built.signer, mode });
  // Refused (409, or 422 when the forged body does not even parse): no final copy with different text.
  if (second.status === 409 || second.status === 422) return { path: "render", ok: true, detail: `mutated (${kinds.join(", ")}): refused ${second.status} ${second.code ?? ""}` };
  if (second.status !== 200 || !second.bytes) return { path: "render", ok: false, detail: `mutated: ${second.status} ${second.code ?? ""}` };
  const same = documentText(first.bytes) === documentText(second.bytes);
  return { path: "render", ok: same, detail: same ? `mutated (${kinds.join(", ")}): identical document text` : `mutated (${kinds.join(", ")}): DIFFERENT document text with a FINAL copy` };
}

type Forge =
  | "ack-by-approver"
  | "accept-by-approver"
  | "own-words-by-approver"
  | "adopt-by-approver"
  | "signed-flags-change"
  | "signed-activity-rewrite"
  // harden-WC (check2-WC, additive): what a modified client could send that the review never writes.
  | "relabel-box"
  | "answer-unstamped"
  | "answer-stamped-own"
  | "gap-removed"
  | "stamp-name-forged"
  | "drafted-text-added"
  | "edited-verbatim-added"
  | "condition-changed"
  | "none";

/** The subject box's structured answer set to another value (as a forging client would), stamped as `by` or as nobody. */
function forgedAnswer(s: Report["sections"][number], by: ReturnType<typeof actorOf> | null): Report["sections"][number] {
  if (!s.answer || s.answer.kind === "text") return s;
  const kind = s.answer.kind;
  const value = kind === "date" ? "2026-12-01" : kind === "yes_no" || kind === "checkbox" ? s.answer.value !== true : kind === "number" ? "3" : kind === "rows" ? s.answer.value : "6-12 months";
  const next = { ...s, status: "complete" as const, answer: { kind, value } as typeof s.answer };
  delete next.answerBy;
  if (by) next.answerBy = by;
  return next;
}

function forgeReport(report: Report, forge: Forge, approver: PersonKey, box: string | null, putAs: PersonKey = "pat"): Report {
  // The release's `by` stamp is the stored Actor (core/schemas.ts ActorSchema), so a forged PUT is schema-valid and only
  // the server's role rules (WC) can refuse it.
  const by = actorOf(approver);
  const at = report.updatedAt;
  const key = box ?? report.sections[0]?.key;
  switch (forge) {
    case "ack-by-approver":
      return { ...report, flags: report.flags.map((f) => (f.sectionKey === key ? { ...f, acknowledged: { reason: "Checked with the approver.", at, by } as ReportFlag["acknowledged"] } : f)) };
    case "accept-by-approver":
      return { ...report, sections: report.sections.map((s) => (s.key === key ? ({ ...s, accepted: [{ check: "OPINION_LANGUAGE", phrase: "fit", sentenceSha: "0".repeat(64), by, at }] } as typeof s) : s)) };
    case "own-words-by-approver":
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: s.paragraphs.map((q) => ({ ...q, ownWords: { by, at } }) as typeof q) } : s)) };
    case "adopt-by-approver":
      return { ...report, sections: report.sections.map((s) => (s.key === key ? ({ ...s, adoptedBy: { by, at, contentSha: "0".repeat(64) } } as typeof s) : s)) };
    case "signed-flags-change":
      return { ...report, flags: [] };
    case "signed-activity-rewrite":
      // bh2-rc1: an entry dropped – or, with one entry only, its words rewritten – so the forgery is never a no-op.
      return report.activity.length > 1
        ? { ...report, activity: report.activity.slice(0, 1) }
        : { ...report, activity: report.activity.map((a, i) => (i === 0 ? { ...a, detail: `${a.detail} (rewritten)` } : a)) };
    case "relabel-box":
      // The box claims to be a records box with a neutral title (check2-WC major A).
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, kind: "from_records" as const, title: "Notes" } : s)) };
    case "answer-unstamped":
    case "answer-stamped-own":
      return { ...report, sections: report.sections.map((s) => (s.key === key ? forgedAnswer(s, forge === "answer-stamped-own" ? actorOf(putAs) : null) : s)) };
    case "gap-removed":
      return { ...report, gaps: report.gaps.filter((g) => g.sectionKey !== key), flags: report.flags.filter((f) => f.sectionKey !== key) };
    case "stamp-name-forged": {
      // The putter's own member id under the approver's name and role (check2-WC minor 1).
      const own = actorOf(putAs);
      const forged = { ...own, name: person(approver).name, role: person(approver).role, canSign: true };
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: s.paragraphs.map((q, i) => (i === 0 ? ({ ...q, by: forged } as typeof q) : q)) } : s)) };
    }
    case "drafted-text-added":
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: [...s.paragraphs, { id: `${key}-forged-d1`, text: "Settling well with his home exercise programme.", sourceIds: ["N-001"], origin: "ai" as const, originalText: "Settling well with his home exercise programme." }] } : s)) };
    case "edited-verbatim-added": {
      const text = report.sections.find((s) => s.key === key)?.paragraphs[0]?.text ?? "Settling well with his home exercise programme.";
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: [...s.paragraphs, { id: `${key}-forged-e1`, text, sourceIds: ["N-001"], origin: "edited" as const, originalText: text, by: actorOf(putAs) }] } : s)) };
    }
    case "condition-changed": {
      const at = report.sections.findIndex((s) => s.key === key);
      const controller = report.sections.slice(0, Math.max(at, 0)).reverse().find((s) => s.answer && s.answer.kind !== "text")?.key ?? report.sections[0]?.key ?? key;
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, condition: { controllers: [controller], wants: "yes", parser: "forged" } } : s)) };
    }
    default:
      return report;
  }
}

/** An approved report amended and the amendment approved: the stored v1 must read as superseded (B2-25, B3-3). */
async function runAmend(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  const s1 = await postSign(h, { report: built.report, template: built.template, form: built.form, signer: built.signer, mode: "tenant", fileBytes: built.fileBytes });
  if (!s1.receipt) return { path: "store", ok: false, detail: `could not approve v1 (${s1.status} ${s1.code ?? ""})` };
  const v1: Report = { ...built.report, status: "signed", receipt: s1.receipt };
  const p1 = await putStoredReport(h, v1, built.signer, null);
  if (p1.status !== 201) return { path: "store", ok: false, detail: `could not store v1 (${p1.status} ${p1.code ?? ""})` };
  const v2draft = createAmendedVersion(v1, person(built.signer).name, `${v1.id}_v2`);
  const s2 = await postSign(h, { report: v2draft, template: built.template, form: built.form, signer: built.signer, mode: "tenant", fileBytes: built.fileBytes });
  if (!s2.receipt) return { path: "store", ok: false, detail: `could not approve v2 (${s2.status} ${s2.code ?? ""})` };
  const p2 = await putStoredReport(h, { ...v2draft, status: "signed", receipt: s2.receipt }, built.signer, null);
  if (p2.status !== 201) return { path: "store", ok: false, detail: `could not store v2 (${p2.status} ${p2.code ?? ""})` };
  const got = await getStoredReport(h, v1.id, built.signer);
  const stored = (got.body as { report?: Report } | null)?.report;
  const superseded = Boolean(stored && stored.activity.some((a) => /supersed/i.test(`${a.action} ${a.detail}`)));
  return { path: "store", ok: superseded, detail: superseded ? "the stored v1 reads as superseded by v2" : "after v2 was approved and stored, the stored v1 does not say it was superseded" };
}

async function runStore(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  if ((c.input.store as { amend?: boolean } | undefined)?.amend) return runAmend(c, built, h);
  const store = (c.input.store ?? {}) as { seedAs?: PersonKey; putAs?: PersonKey; forge?: Forge; signFirst?: boolean };
  const seedAs = store.seedAs ?? built.approver ?? "sarah";
  const putAs = store.putAs ?? built.actor;
  // bh2-rc1: the report as the review holds it – with the validators' flags – so a forged acknowledgement has a flag
  // to acknowledge (the forge was a no-op on a report with no flags).
  let base: Report = { ...built.report, flags: validateReport(built.report, built.template, { computedFacts: built.computedFacts, form: built.form, ...(ownerOf(built) ? { voice: { owner: ownerOf(built) as never } } : {}) }).flags };
  if (store.signFirst) {
    const signed = await postSign(h, { report: base, template: built.template, form: built.form, signer: built.signer, mode: "tenant", fileBytes: built.fileBytes });
    if (!signed.receipt) return { path: "store", ok: false, detail: `could not approve first (${signed.status} ${signed.code ?? ""})` };
    base = { ...base, status: "signed", receipt: signed.receipt, flags: (signed.body as { flags?: ReportFlag[] }).flags ?? base.flags };
  }
  const seeded = await putStoredReport(h, base, seedAs, null);
  if (seeded.status !== 201) return { path: "store", ok: false, detail: `seed PUT by ${seedAs}: ${seeded.status} ${seeded.code ?? ""}` };
  const rev = (seeded.body as { rev?: number }).rev ?? 1;
  const forged = forgeReport(base, store.forge ?? "none", built.approver ?? "sarah", built.box, putAs);
  const res = await putStoredReport(h, forged, putAs, rev);
  const detail = `PUT by ${person(putAs).name} (${store.forge ?? "none"}): ${res.status} ${res.code ?? ""}`.trim();
  if (c.expect === "REFUSED_403") return { path: "store", ok: res.status === 403, detail };
  if (c.expect === "REFUSED_409") return { path: "store", ok: res.status === 409, detail };
  if (c.expect === "PASS") return { path: "store", ok: res.status === 200, detail };
  return { path: "store", ok: res.status < 500, detail };
}

/* ------------------------------------------------------------------------------------------------
 * reducer
 * ----------------------------------------------------------------------------------------------*/

async function runReducer(c: RunCase, built: Built, engine: ValidatorEngine): Promise<PathOutcome> {
  const steps = await runSteps(built, c.input.steps ?? [], engine);
  if (steps.error) return { path: "reducer", ok: false, detail: steps.error };
  if (c.expect === "NOT_OFFERED") {
    const blocked = steps.log.filter((l) => l.startsWith("NOT OFFERED")).length;
    const done = steps.log.filter((l) => l.startsWith("DONE")).length;
    return { path: "reducer", ok: done === 0 && blocked > 0, detail: steps.log.join(" | ") };
  }
  const j = judgeBuilt(c, { ...built, paragraphId: null }, engine, steps.report);
  return { path: "reducer", ok: j.ok, detail: `${steps.log.join(" | ")} ⇒ ${j.detail}` };
}

/* ------------------------------------------------------------------------------------------------
 * The case
 * ----------------------------------------------------------------------------------------------*/

export async function evaluateCase(c: RunCase, opts: EvalOptions): Promise<CaseOutcome> {
  const paths: PathOutcome[] = [];
  const wanted = c.paths.filter((p) => !opts.onlyPaths || opts.onlyPaths.includes(p));
  let built: Built | null = null;
  let h: HttpHarness | null = null;
  for (const path of wanted) {
    try {
      if (path === "fill" || path === "lint" || path === "assemble" || path === "split" || path === "scope" || path === "probe") {
        paths.push(await runPurePath(path, c, opts.engine));
        continue;
      }
      built = built ?? (await buildCase(c.input));
      if (path === "validate") paths.push(await runValidate(c, built, opts.engine));
      else if (path === "reducer") paths.push(await runReducer(c, built, opts.engine));
      else {
        h = h ?? createHttpHarness();
        if (path === "sign") paths.push(await runSign(c, built, h));
        else if (path === "render") paths.push(await runRender(c, built, h));
        else if (path === "store") paths.push(await runStore(c, built, h));
      }
    } catch (err) {
      paths.push({ path, ok: false, detail: `error: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 400) });
    }
  }
  return { id: c.id, ok: paths.length > 0 && paths.every((p) => p.ok), paths };
}

/* ------------------------------------------------------------------------------------------------
 * One-click mutations: apply each offered fix to a copy and check the engine rules
 * ----------------------------------------------------------------------------------------------*/

export interface OneClickResult {
  id: string;
  kind: string;
  ok: boolean;
  detail: string;
}

export async function evaluateOneClicks(c: RunCase, engine: ValidatorEngine): Promise<OneClickResult[]> {
  const built = await buildCase(c.input);
  const res = validateBuilt(built, engine);
  const report = { ...built.report, flags: res.flags };
  const roles = rolesOf(c.input);
  const out: OneClickResult[] = [];
  const seen = new Map<string, number>();
  const actors: PersonKey[] = Array.from(new Set([roles.approver ?? "sarah", roles.actor]));
  for (const actor of actors) {
    const fixes: OfferedFix[] = await offeredFixes(report, { actor, voiceOwner: roles.approver, form: built.form, template: built.template });
    for (const fix of fixes) {
      const n = (seen.get(fix.kind) ?? 0) + 1;
      seen.set(fix.kind, n);
      const id = `${c.id}~fix-${fix.kind}-${n}`;
      let after: Report;
      try {
        after = fix.apply(report);
      } catch (err) {
        out.push({ id, kind: fix.kind, ok: false, detail: `the fix threw: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      const res2 = validateBuilt(built, engine, after);
      const rules = checkFixRules(report, after, res.blocking, res2.blocking);
      const problems = [...rules.problems];
      if (c.expect === "BLOCK" && built.box) {
        const allowed = new Set((c.check?.allowFixes as string[] | undefined) ?? []);
        const stillBlocks = res2.blocking.some((f) => f.sectionKey === built.box && (!INCIDENTAL_CODES.has(f.code) || (c.blockBy ?? []).includes(f.code)));
        if (!stillBlocks && !allowed.has(fix.kind)) problems.push(`“${fix.label}” turns this unsafe text into an approvable one`);
      }
      out.push({ id, kind: fix.kind, ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `“${fix.label}” keeps the engine rules` });
    }
  }
  return out;
}
