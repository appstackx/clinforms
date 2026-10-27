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
 *             is identical. (bh2 fix round 1, WA1 – W0 exception) input.render.legacyReceipt: the report as production
 *             made it (no reportModel, approver or frozen condition) with a receipt as production minted it (no
 *             issued-document or acknowledgement hash); check.render {contains[], notContains[]} on the FINAL text.
 * - sign (bh2 fix round 1, WA1 – W0 exception): input.store.bodyStatus "signed" sends the body to /sign saying it is
 *             approved already (status is outside the hashed content – the server must never trust it).
 * - store:    PUT /store/reports as input.store.putAs with input.store.forge applied (REFUSED_403 = refused).
 * - reducer:  input.steps by their actors (reducer.ts), then validate (judge).
 * - fill, lint, assemble, split, scope, probe: pure-paths.ts.
 * Every result says what it saw, so a failing case reads as a bug report.
 */
import type { Report, ReportFlag, SignReceipt } from "../../../types";
import { createReceipt } from "../../../../auth/sign-receipt";
import { validateReport } from "../../index";
import { buildCase, ownerOf, rolesOf, type Built } from "./build";
import type { ValidatorEngine } from "./engine";
import { checkFixRules, offeredFixes, type OfferedFix } from "./fixes";
import { actorOf, person } from "./fixtures";
import { createHttpHarness, getStoredReport, postRenderFinal, postSign, putStoredReport, type HttpHarness } from "./http";
import { CORPUS_TENANT } from "./fixtures";
import { applyFixProposal, offeredFixes as engineOfferedFixes } from "../../../../ui/components/review/fixes";
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

/** The subject paragraph edited by `by` as the review records it: "edited", the drafted wording kept, their stamp. */
function withPersonEditedSubject(built: Built, by: PersonKey): Report {
  const box = built.box;
  return {
    ...built.report,
    sections: built.report.sections.map((s) =>
      s.key === box
        ? {
            ...s,
            paragraphs: s.paragraphs.map((p, i) =>
              i === 0 ? { ...p, text: `${p.text} He was seen again at the clinic.`, ...(p.origin === "ai" ? { origin: "edited" as const, originalText: p.originalText ?? p.text } : {}), by: actorOf(by) } : p,
            ),
          }
        : s,
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
  const store = (c.input.store ?? {}) as { seedAs?: PersonKey; thenBody?: "edited" | "stale" | "same"; bodyStatus?: "signed" } & StoreRewrite;
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
      // Someone saves a newer revision; the approver's tab still sends the old one. (R1T-WC-04: the newer revision is a
      // person's edit as the review writes it – origin "edited", their stamp – never drafted text rewritten in place,
      // which the store refuses.)
      const newer = await putStoredReport(h, withPersonEditedSubject(built, store.seedAs), store.seedAs, (seeded.body as { rev?: number }).rev ?? 1);
      if (newer.status !== 200) return { path: "sign", ok: false, detail: `could not store the newer revision (${newer.status} ${newer.code ?? ""})` };
    }
  }
  if (store.bodyStatus === "signed") report = { ...report, status: "signed" };
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

/**
 * bh2 fix round 1 (R1T-WA1-01): a report as production (e132057) made it – no reportModel, no approver, no frozen
 * condition, no person's decision (production wrote none of them).
 */
function productionMade(report: Report): Report {
  const out = { ...report, sections: report.sections.map(({ condition: _c, disposition: _d, ...s }) => s) } as Report;
  delete (out as { reportModel?: number }).reportModel;
  delete (out as { approver?: unknown }).approver;
  return out;
}

/** The receipt production minted for an approval: the same signer, time, map and session – and no hash of what it issued. */
async function productionReceipt(report: Report, release: SignReceipt): Promise<SignReceipt> {
  return createReceipt({
    report,
    signer: release.signer,
    statementAccepted: true,
    attestations: [...release.attestations],
    ...(release.formMapSha256 ? { formMapSha256: release.formMapSha256 } : {}),
    ...(release.approvedVia ? { approvedVia: release.approvedVia } : {}),
    now: new Date(release.signedAt),
  });
}

function renderTextProblems(c: RunCase, bytes: Uint8Array | null): string[] {
  const check = (c.check?.render ?? {}) as { contains?: unknown; notContains?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const text = bytes ? documentText(bytes).replace(/\s+/g, " ") : "";
  return [...list(check.contains).filter((t) => !text.includes(t)).map((t) => `the FINAL copy does not print “${t}”`), ...list(check.notContains).filter((t) => text.includes(t)).map((t) => `the FINAL copy prints “${t}”`)];
}

async function runRender(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  const mode = signMode(c);
  const legacy = c.input.render?.legacyReceipt === true;
  const base = legacy ? productionMade(built.report) : built.report;
  const signed = await postSign(h, { report: base, template: built.template, form: built.form, signer: built.signer, mode, fileBytes: built.fileBytes });
  if (!signed.receipt) {
    const blocked = `/sign refused (${signed.status} ${signed.code ?? ""}) – no final copy`;
    // A case about what happens AFTER approval needs the approval first.
    return { path: "render", ok: c.expect === "BLOCK" && c.input.render?.contentEdit !== true, detail: blocked };
  }
  const receipt = legacy ? await productionReceipt(base, signed.receipt) : signed.receipt;
  let approved: Report = { ...base, status: "signed", receipt };
  // A body whose content changed after approval never makes a final copy.
  if (c.input.render?.contentEdit === true) approved = { ...withEditedSubject({ ...built, report: base }), status: "signed", receipt };
  const first = await postRenderFinal(h, { report: approved, receipt, form: built.form, fileBytes: built.fileBytes, member: built.signer, mode });
  const kind = first.headers.get("x-medreport-render");
  const tag = legacy ? " (a receipt production minted)" : "";
  if (c.expect === "PASS") {
    const problems = first.status === 200 && kind === "final" ? renderTextProblems(c, first.bytes) : [];
    return { path: "render", ok: first.status === 200 && kind === "final" && problems.length === 0, detail: `FINAL${tag}: ${first.status} ${first.code ?? ""} ${kind ?? ""}${problems.length ? ` – ${problems.join("; ")}` : ""}`.trim() };
  }
  if (c.expect === "BLOCK") return { path: "render", ok: first.status !== 200 || kind !== "final", detail: `FINAL${tag}: ${first.status} ${first.code ?? ""} ${kind ?? ""}`.trim() };
  if (c.expect !== "IDENTICAL") return { path: "render", ok: first.status < 500, detail: `FINAL: ${first.status}` };
  if (first.status !== 200 || !first.bytes) return { path: "render", ok: false, detail: `the unmutated FINAL failed: ${first.status} ${first.code ?? ""}` };
  const kinds = ((c.input.render?.mutate as string[] | undefined) ?? ["flags-ack-na", "activity-answer-set", "status-draft", "updatedAt"]) as string[];
  const forged = mutateOutsideReceipt(approved, kinds);
  const second = await postRenderFinal(h, { report: forged, receipt, form: built.form, fileBytes: built.fileBytes, member: built.signer, mode });
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
  // WC fix round 1 (R1T-WC-01/03/04/05/06/07, additive):
  | "tombstone-untied"
  | "tombstone-tied"
  | "opinion-tick-unstamped"
  | "redraft-tick"
  | "redraft-no-tick"
  | "ai-rewrite"
  | "ai-fix-engine"
  | "gap-na-settle"
  | "no-approver"
  | "demo-stamp-colleague"
  | "member-stamp-colleague"
  // WC fix round 2 (R2-SAF-1/2, R2-TPN-01, R2-SEC-2, additive):
  | "pending-reset"
  | "redraft-flip"
  | "redraft-drop-gap"
  | "no-map-relabel"
  | "no-map-gap-na"
  | "builtin-version-relabel"
  | "answer-stamp-dropped"
  | "fix-claims-forged"
  | "fix-kind-unknown"
  // WC fix r2b (R2-TPN-01 re-check, R2-SEC-2 re-check, additive):
  | "answer-kind-text"
  | "answer-removed"
  | "records-paragraph-unstamped"
  | "records-paragraph-stamped"
  | "flags-amplified-seed"
  | "fix-flags-amplified"
  // WC fix r2c (R2-TPN-01 and R2-SEC-2 final-check residuals, additive):
  | "answer-empty-list"
  | "answer-empty-list-stamped"
  | "answer-blank-words"
  | "answer-cleared"
  | "fix-edits-long"
  | "none";

/** WC fix round 2: an unrecorded opinion, as a box relabelled "from the records" would print it. */
const UNRECORDED_OPINION = "He will make a full recovery within six weeks and is fit for normal duties now.";

/** WC fix round 2 (R2-SAF-2): the subject box relabelled "from the records", holding an unrecorded opinion (no question). */
function relabelledWithOpinion(report: Report, key: string): Report {
  return {
    ...report,
    sections: report.sections.map((s) => {
      if (s.key !== key) return s;
      const n = { ...s, kind: "from_records" as const, status: "complete" as const, paragraphs: [{ id: `${key}-r1`, text: UNRECORDED_OPINION, sourceIds: ["REG"], origin: "from_records" as const }] };
      delete (n as { answer?: unknown }).answer;
      return n;
    }),
    gaps: report.gaps.filter((g) => g.sectionKey !== key),
  };
}

/** WC fix round 2 (R2-SAF-2): the report's form reference without the attested map hash (ReportFormRefSchema: optional). */
function withoutMapHash(report: Report): Report {
  if (!report.form) return report;
  const form = { ...report.form };
  delete (form as { mapSha256?: unknown }).mapSha256;
  return { ...report, form };
}

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
    case "tombstone-untied":
      // R1T-WC-01: a tombstone no drafted paragraph of the stored box was deleted for (any text the client likes).
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, tombstones: [...(s.tombstones ?? []), { paragraphId: `${key}-never-drafted`, text: "Lift lift lift lift lift lift lift lift.", sourceIds: ["N-001"], by: actorOf(putAs), at }] } : s)) };
    case "tombstone-tied": {
      // The review's own delete of the box's first drafted paragraph: gone from the box, kept as its tombstone.
      const s0 = report.sections.find((s) => s.key === key);
      const gone = s0?.paragraphs.find((p) => p.origin === "ai");
      if (!s0 || !gone) return report;
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: s.paragraphs.filter((p) => p.id !== gone.id), tombstones: [...(s.tombstones ?? []), { paragraphId: gone.id, text: gone.originalText ?? gone.text, sourceIds: gone.sourceIds, by: actorOf(putAs), at }] } : s)) };
    }
    case "opinion-tick-unstamped":
      // R1T-WC-03: the subject box's structured answer set with nobody's stamp (as a forging client would on a create).
      return { ...report, sections: report.sections.map((s) => (s.key === key ? forgedAnswer(s, null) : s)) };
    case "redraft-tick":
    case "redraft-no-tick": {
      // R1T-WC-03 (SAF-2): a "drafting result" for the waiting subject box – a new generation entry naming it, a drafted
      // paragraph, and (redraft-tick) an answer nobody's stamp vouches for. Drafting never answers an opinion box.
      const generation = [...(report.generation ?? []), { mode: "live" as const, sectionKeys: [key], at, promptVersion: "forms-corpus" }];
      return {
        ...report,
        generation,
        sections: report.sections.map((s) => {
          if (s.key !== key) return s;
          const next = { ...s, status: "drafted" as const, paragraphs: [{ id: `${key}-corpus-p1`, text: "Tom Ellis recorded lumbar movement full and pain-free.", sourceIds: ["N-002"], origin: "ai" as const, originalText: "Tom Ellis recorded lumbar movement full and pain-free." }] };
          if (forge === "redraft-tick") return forgedAnswer(next, null);
          return next;
        }),
      };
    }
    case "ai-rewrite":
      // R1T-WC-04 (SAF-3): the subject box's drafted paragraph rewritten in place – still "ai", no stamp, no fix record.
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: s.paragraphs.map((p, i) => (i === 0 && p.origin === "ai" ? { ...p, text: p.text.replace(/\bno\s+/i, "") === p.text ? `${p.text.replace(/[.\s]+$/, "")} and red flags were found.` : p.text.replace(/\bno\s+/i, "") } : p)) } : s)) };
    case "gap-na-settle":
      // R1T-WC-05 (SAF-4): the subject box's open questions settled as "not applicable", by nobody (as the code's own settle).
      return { ...report, gaps: report.gaps.map((g) => (g.sectionKey === key && !g.resolution ? { ...g, resolution: { kind: "resolved" as const, text: "Not applicable: the answer before it rules it out.", at, notApplicable: true } } : g)) };
    case "no-approver": {
      // R1T-WC-06 (SEC-3): the report without its approving clinician.
      const r = { ...report };
      delete (r as { approver?: unknown }).approver;
      return r;
    }
    case "demo-stamp-colleague":
    case "member-stamp-colleague": {
      // R1T-WC-07 (SEC-4): an import from the public demo whose first paragraph is stamped as the demo's user under a
      // colleague's name, role and number (demo-stamp-colleague) – or as a member of the clinic (member-stamp-colleague).
      const colleague = actorOf(approver);
      const stampAs = forge === "demo-stamp-colleague" ? { ...colleague, memberId: "demo" } : colleague;
      return {
        ...report,
        tenantId: "demo",
        sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs: s.paragraphs.map((q, i) => (i === 0 ? ({ ...q, origin: "edited" as const, originalText: q.originalText ?? `${q.text} (drafted)`, by: stampAs } as typeof q) : q)) } : s)),
      };
    }
    case "pending-reset":
      // R2-SAF-1: the subject box put back to "waiting for drafting" (only the report factory makes a box pending).
      return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, status: "pending" as const } : s)) };
    case "redraft-flip":
    case "redraft-drop-gap": {
      // R2-SAF-1: a "drafting result" for the subject box – a new generation entry naming it – that rewrites its drafted
      // finding in place (negation dropped, a finding added; same paragraph ids, still "ai"), or drops its open questions.
      const generation = [...(report.generation ?? []), { mode: "live" as const, sectionKeys: [key], at, promptVersion: "forms-corpus" }];
      const flip = (t: string) => (t.replace(/\bno\s+/i, "") === t ? `${t.replace(/[.\s]+$/, "")} and red flags were found.` : t.replace(/\bno\s+/i, ""));
      return {
        ...report,
        generation,
        sections: report.sections.map((s) => {
          if (s.key !== key) return s;
          if (forge === "redraft-drop-gap") return { ...s, status: "needs_input" as const, paragraphs: [] };
          return { ...s, status: "drafted" as const, paragraphs: s.paragraphs.map((p) => (p.origin === "ai" ? { ...p, text: flip(p.text), originalText: flip(p.text) } : p)) };
        }),
        ...(forge === "redraft-drop-gap" ? { gaps: report.gaps.filter((g) => g.sectionKey !== key || g.resolution) } : {}),
      };
    }
    case "no-map-relabel":
      // R2-SAF-2: a create with no attested map hash, its opinion box relabelled "from the records" with an unrecorded opinion.
      return relabelledWithOpinion(withoutMapHash(report), key);
    case "no-map-gap-na": {
      // R2-SAF-2: a create with no attested map hash, the box's frozen condition inverted and its open question settled N/A.
      const r = withoutMapHash(report);
      const invert = (w: string | undefined) => (w === "no" ? "yes" : "no");
      return {
        ...r,
        sections: r.sections.map((s) => (s.key === key && s.condition ? { ...s, condition: { ...s.condition, wants: invert(s.condition.wants) } } : s)),
        gaps: r.gaps.map((g) => (g.sectionKey === key && !g.resolution ? { ...g, resolution: { kind: "resolved" as const, text: "Not applicable: the answer before it rules it out.", at, notApplicable: true } } : g)),
      };
    }
    case "builtin-version-relabel":
      // R2-SAF-2 (built-in sibling): a create naming another template version, its opinion box relabelled as above.
      return relabelledWithOpinion({ ...report, templateVersion: `${report.templateVersion}-x` }, key);
    case "answer-stamp-dropped":
      // R2-TPN-01: the subject box's answer kept, the stamp of the person who set it taken off (it would read as drafted).
      return {
        ...report,
        sections: report.sections.map((s) => {
          if (s.key !== key) return s;
          const n = { ...s };
          delete (n as { answerBy?: unknown }).answerBy;
          return n;
        }),
      };
    case "fix-claims-forged":
    case "fix-kind-unknown":
      // R2-SEC-2: every drafted paragraph of the subject box changed in place with one self-stamped "fix" entry the engine
      // never offers (fix-claims-forged: a known kind, value-only; fix-kind-unknown: a kind no generator makes).
      return {
        ...report,
        sections: report.sections.map((s) =>
          s.key !== key
            ? s
            : {
                ...s,
                paragraphs: s.paragraphs.map((p) =>
                  p.origin !== "ai" ? p : { ...p, text: `${p.text} Noted.`, fixes: [...(p.fixes ?? []), { kind: forge === "fix-kind-unknown" ? "remove-sentence" : "value-only", by: actorOf(putAs) as never, at, edits: [{ start: p.text.length, end: p.text.length, text: " Noted." }] }] },
                ),
              },
        ),
      };
    case "answer-kind-text":
    case "answer-removed":
      // R2-TPN-01 re-check: the subject box's structured answer replaced by a "text" answer holding another value, or
      // taken away – with no one's stamp – so the box would print its text instead of the answer.
      return {
        ...report,
        sections: report.sections.map((s) => {
          if (s.key !== key || !s.answer || s.answer.kind === "text") return s;
          const n = { ...s };
          delete (n as { answerBy?: unknown }).answerBy;
          if (forge === "answer-removed") delete (n as { answer?: unknown }).answer;
          else n.answer = { kind: "text", value: s.answer.kind === "yes_no" || s.answer.kind === "checkbox" ? (s.answer.value === true ? "No" : "Yes") : "01/01/1970" };
          return n;
        }),
      };
    case "records-paragraph-unstamped":
    case "records-paragraph-stamped": {
      // R2-TPN-01 re-check: the code-filled paragraph of a records box replaced by a staff entry – with no one's stamp, or
      // (the twin) stamped as the member who saves it.
      const stamp = forge === "records-paragraph-stamped" ? actorOf(putAs) : null;
      return {
        ...report,
        sections: report.sections.map((s) => {
          if (s.key !== key) return s;
          const p = { id: `${key}-staff-1`, text: "01/01/1970", sourceIds: [] as string[], origin: "staff" as const, ...(stamp ? { by: stamp as never } : {}) };
          const n = { ...s, paragraphs: [p] };
          if (s.answer && s.answer.kind !== "text") {
            // The structured answer is cleared (as the review clears it): the staff entry is then what the box prints.
            n.answer = { kind: s.answer.kind, value: null } as typeof s.answer;
            delete (n as { answerBy?: unknown }).answerBy;
          }
          return n;
        }),
      };
    }
    case "flags-amplified-seed": {
      // R2-SEC-2 re-check, step 1: many client-written flags pointed at the subject box's first drafted paragraph, stored
      // (the engine used to generate candidates once per stored flag).
      const target = report.sections.find((s) => s.key === key)?.paragraphs.find((p) => p.origin === "ai");
      if (!target) return report;
      const flags = Array.from({ length: 200 }, (_, i) => ({ id: `amplified-${i}`, code: "OTHER_CLINICIAN_VOICE", severity: "warning", sectionKey: key, paragraphId: target.id, message: `forged ${i}`, evidence: `unattributed Tom Ellis ${i}` }) as ReportFlag);
      return { ...report, flags: [...report.flags, ...flags] };
    }
    case "fix-flags-amplified": {
      // R2-SEC-2 re-check, step 2: the member's one claimed fix of a known kind (own stamp, replaying edits) on that
      // paragraph – a fix the engine does not make there.
      const target = report.sections.find((s) => s.key === key)?.paragraphs.find((p) => p.origin === "ai");
      if (!target) return report;
      return {
        ...report,
        sections: report.sections.map((s) =>
          s.key !== key
            ? s
            : { ...s, paragraphs: s.paragraphs.map((p) => (p.id !== target.id ? p : { ...p, text: `Tom Ellis recorded that ${p.text}`, fixes: [...(p.fixes ?? []), { kind: "attribution-prefix", by: actorOf(putAs) as never, at, edits: [{ start: 0, end: 0, text: "Tom Ellis recorded that " }] }] })) },
        ),
      };
    }
    case "answer-empty-list":
    case "answer-empty-list-stamped":
    case "answer-blank-words":
    case "answer-cleared":
      // WC fix r2c (R2-TPN-01 residual): the subject box's structured answer set to an empty list (no stamp, or stamped as
      // the member who saves it), to blank words (stamped), or – the twin – cleared as the review clears it (null, no stamp).
      return {
        ...report,
        sections: report.sections.map((s) => {
          if (s.key !== key || !s.answer || s.answer.kind === "text") return s;
          const n = { ...s };
          delete (n as { answerBy?: unknown }).answerBy;
          const value = forge === "answer-blank-words" ? "  " : forge === "answer-cleared" ? null : [];
          n.answer = { kind: s.answer.kind, value } as typeof s.answer;
          if (forge === "answer-empty-list-stamped" || forge === "answer-blank-words") n.answerBy = actorOf(putAs) as never;
          return n;
        }),
      };
    case "fix-edits-long": {
      // WC fix r2c (R2-SEC-2 residual): the member's one claimed fix of a known kind (own stamp) on the subject box's first
      // drafted paragraph, whose edits list carries 5,000 identity edits before the real one (the engine records one edit).
      const target = report.sections.find((s) => s.key === key)?.paragraphs.find((p) => p.origin === "ai");
      if (!target || target.text.length < 2) return report;
      const identity = Array.from({ length: 5_000 }, () => ({ start: 1, end: 2, text: target.text[1] }));
      return {
        ...report,
        sections: report.sections.map((s) =>
          s.key !== key
            ? s
            : { ...s, paragraphs: s.paragraphs.map((p) => (p.id !== target.id ? p : { ...p, text: `${p.text} Noted.`, fixes: [...(p.fixes ?? []), { kind: "value-only", by: actorOf(putAs) as never, at, edits: [...identity, { start: p.text.length, end: p.text.length, text: " Noted." }] }] })) },
        ),
      };
    }
    default:
      return report;
  }
}

/**
 * R1T-WC-04: the subject box's first drafted paragraph changed by a one-click fix the engine offers – to `putAs`, else
 * (a client applying what the review offers someone else) to the approver – applied as `putAs` (as the review applies it).
 */
function withEngineFix(built: Built, report: Report, putAs: PersonKey): Report {
  for (const offeredTo of [putAs, built.approver ?? "sarah"] as PersonKey[]) {
    const fixes = engineOfferedFixes(report, { actor: actorOf(offeredTo) as never, template: built.template, form: built.form });
    const fix = fixes.find((f) => f.sectionKey === built.box && f.after.trim() !== "" && f.after !== f.before);
    if (fix) return applyFixProposal(report, fix, actorOf(putAs) as never);
  }
  return report;
}

/**
 * WC fix round 1: the report as `who` would create it – the report factory's boxes and drafted text, and only what `who`
 * wrote, chose or decided (anyone else's paragraphs, answers, acknowledgements and decisions left out): a member's
 * create never carries a colleague's decisions.
 */
function asCreatedBy(report: Report, who: PersonKey): Report {
  const me = actorOf(who).memberId;
  const mine = (by: { memberId?: string } | null | undefined) => Boolean(by && by.memberId === me);
  const sections = report.sections.map((s) => {
    const n = { ...s, paragraphs: s.paragraphs.filter((p) => p.origin === "ai" || p.origin === "from_records" || mine(p.by)).map((p) => {
      const q = { ...p };
      if (q.ownWords && !mine(q.ownWords.by)) delete q.ownWords;
      if (q.ackReason && !mine(q.by)) delete q.ackReason;
      return q;
    }) };
    if (n.answerBy && !mine(n.answerBy)) {
      delete n.answerBy;
      if (n.answer && n.answer.kind !== "text") n.answer = { ...n.answer, value: null };
    }
    delete n.adoptedBy;
    delete n.accepted;
    if (n.disposition && !mine(n.disposition.by)) delete n.disposition;
    return n;
  });
  const gaps = report.gaps.map((g) => {
    if (!g.resolution || mine(g.resolution.by)) return g;
    const open = { ...g };
    delete open.resolution;
    return open;
  });
  const flags = report.flags.map((f) => {
    if (!f.acknowledged || mine(f.acknowledged.by)) return f;
    const open = { ...f };
    delete open.acknowledged;
    return open;
  });
  return { ...report, sections, gaps, flags };
}

/** An approved report amended and the amendment approved: the stored v1 must read as superseded (B2-25, B3-3). */
async function runAmend(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  // WC fix round 2 (R2-SAF-2): the clinic holds the form map its reports are started from, as the Studio keeps it – the
  // store checks a create against it (a create it cannot check is refused).
  if (built.form) await storeFormMap(h, built.form);
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

/** The clinic's stored copy of a form map (as the Studio saves it before any report is started from it). */
async function storeFormMap(h: HttpHarness, form: NonNullable<Built["form"]>): Promise<void> {
  if (await h.store.getForm(CORPUS_TENANT, form.id)) return;
  await h.store.createForm(CORPUS_TENANT, { id: form.id, status: form.status, title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form });
}

async function runStore(c: RunCase, built: Built, h: HttpHarness): Promise<PathOutcome> {
  if ((c.input.store as { amend?: boolean } | undefined)?.amend) return runAmend(c, built, h);
  const store = (c.input.store ?? {}) as {
    seedAs?: PersonKey;
    putAs?: PersonKey;
    forge?: Forge;
    signFirst?: boolean;
    /** WC fix round 1: the clinic's store holds the form map the report was started from (as the Studio keeps it). */
    storeForm?: boolean;
    /** WC fix round 1: the forged report is PUT as a CREATE (no stored copy first). */
    createOnly?: boolean;
    /** WC fix round 1: these boxes wait for drafting in the stored copy (status "pending", nothing in them, no questions). */
    seedPending?: string[];
    /** WC fix round 1: the seed is the report as `seedAs` creates it (asCreatedBy: nobody else's decisions in it). */
    seedAsCreator?: boolean;
    /** WC fix round 2: these boxes' answers are stored with no one's stamp (as drafting or the records leave them). */
    seedDrafted?: string[];
    /** WC fix round 2: the subject box's open questions are settled ("Mark resolved") by `seedAs` in the seed. */
    seedResolved?: boolean;
    /** WC fix round 2 (R2-SAF-1): a second PUT by `putAs` on the stored copy the first one left, with this forge. */
    thenForge?: Forge;
  };
  const seedAs = store.seedAs ?? built.approver ?? "sarah";
  const putAs = store.putAs ?? built.actor;
  // WC fix round 2 (R2-SAF-2): always, for a form report (storeForm is kept for the cases that name it) – the Studio keeps
  // the map a report is started from, and the store refuses a create it cannot check against the clinic's map.
  if (built.form) await storeFormMap(h, built.form);
  // bh2-rc1: the report as the review holds it – with the validators' flags – so a forged acknowledgement has a flag
  // to acknowledge (the forge was a no-op on a report with no flags).
  let base: Report = { ...built.report, flags: validateReport(built.report, built.template, { computedFacts: built.computedFacts, form: built.form, ...(ownerOf(built) ? { voice: { owner: ownerOf(built) as never } } : {}) }).flags };
  if (store.signFirst) {
    const signed = await postSign(h, { report: base, template: built.template, form: built.form, signer: built.signer, mode: "tenant", fileBytes: built.fileBytes });
    if (!signed.receipt) return { path: "store", ok: false, detail: `could not approve first (${signed.status} ${signed.code ?? ""})` };
    base = { ...base, status: "signed", receipt: signed.receipt, flags: (signed.body as { flags?: ReportFlag[] }).flags ?? base.flags };
  }
  if (store.seedPending?.length) {
    const pending = new Set(store.seedPending);
    base = {
      ...base,
      sections: base.sections.map((s) => {
        if (!pending.has(s.key)) return s;
        const next = { ...s, status: "pending" as const, paragraphs: [] as typeof s.paragraphs, ...(s.answer ? { answer: { ...s.answer, value: null } } : {}) };
        delete (next as { answerBy?: unknown }).answerBy;
        delete (next as { adoptedBy?: unknown }).adoptedBy;
        return next;
      }),
      gaps: base.gaps.filter((g) => !pending.has(g.sectionKey)),
      flags: base.flags.filter((f) => !f.sectionKey || !pending.has(f.sectionKey)),
    };
  }
  if (store.seedDrafted?.length) {
    const drafted = new Set(store.seedDrafted);
    base = { ...base, sections: base.sections.map((s) => (drafted.has(s.key) ? (({ answerBy: _by, ...rest }) => rest)(s) : s)) };
  }
  if (store.seedResolved) {
    const by = actorOf(seedAs);
    base = { ...base, gaps: base.gaps.map((g) => (g.sectionKey === built.box && !g.resolution ? { ...g, resolution: { kind: "resolved" as const, text: "Checked with the patient.", at: base.updatedAt, by: by as never } } : g)) };
  }
  if (store.createOnly) base = asCreatedBy(base, putAs);
  else if (store.seedAsCreator) base = asCreatedBy(base, seedAs);
  let forged = forgeReport(base, store.forge ?? "none", built.approver ?? "sarah", built.box, putAs);
  if (store.forge === "ai-fix-engine") forged = withEngineFix(built, base, putAs);
  let res;
  if (store.createOnly) {
    res = await putStoredReport(h, forged, putAs, null);
  } else {
    const seeded = await putStoredReport(h, base, seedAs, null);
    if (seeded.status !== 201) return { path: "store", ok: false, detail: `seed PUT by ${seedAs}: ${seeded.status} ${seeded.code ?? ""}` };
    const rev = (seeded.body as { rev?: number }).rev ?? 1;
    if (store.forge === "ai-fix-engine" && forged === base) return { path: "store", ok: false, detail: `the engine offers ${person(putAs).name} no fix on ${built.box}` };
    res = await putStoredReport(h, forged, putAs, rev);
    // WC fix round 2 (R2-SAF-1): a second step on what the first stored (the first step's refusal is the outcome).
    if (store.thenForge && res.status === 200) {
      const stored = (res.body as { report?: Report; rev?: number } | null)?.report;
      const nextRev = (res.body as { rev?: number } | null)?.rev ?? rev + 1;
      if (stored) res = await putStoredReport(h, forgeReport(stored, store.thenForge, built.approver ?? "sarah", built.box, putAs), putAs, nextRev);
    }
  }
  // WC fix round 1 (R1T-WC-07): what the stored copy's subject paragraph is stamped with (check.storedStampName).
  const wantStamp = c.check?.storedStampName as string | undefined;
  if (wantStamp !== undefined && (res.status === 200 || res.status === 201)) {
    const storedReport = (res.body as { report?: Report } | null)?.report;
    const by = storedReport?.sections.find((s) => s.key === built.box)?.paragraphs[0]?.by;
    if (by?.name !== wantStamp) return { path: "store", ok: false, detail: `stored, but the paragraph is stamped “${by?.name ?? "nobody"}”, not “${wantStamp}”` };
  }
  const expectStatus = store.createOnly ? 201 : 200;
  const detail = `PUT by ${person(putAs).name} (${store.forge ?? "none"}): ${res.status} ${res.code ?? ""}`.trim();
  if (c.expect === "REFUSED_403") return { path: "store", ok: res.status === 403, detail };
  if (c.expect === "REFUSED_409") return { path: "store", ok: res.status === 409, detail };
  if (c.expect === "PASS") return { path: "store", ok: res.status === expectStatus, detail };
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
