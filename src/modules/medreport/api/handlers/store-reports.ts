import "server-only";

/**
 * /api/reports/v1/store/reports/{id} (signed-in clinic member, two-step verified)
 *
 * GET    → {rev, updatedAt, report}, ETag "<rev>"; 404 when the clinic has no such report.
 * PUT    {report} → 201 (created) / 200 (updated) {rev, updatedAt, report}, ETag "<rev>".
 *        No If-Match = create; If-Match: "<rev>" = update of exactly that revision.
 *        409 REV_CONFLICT {current: {rev, updatedAt, report} | null} when the stored revision differs (or the
 *        report already exists on a create) – the Studio reloads the stored copy.
 *        Rules: the body passes ReportSchema (422 – strict; a stored copy is READ with core/stored-schemas.ts
 *        StoredReportSchema, which keeps what a later release wrote); report.id = the path id (422); the clinic is the
 *        member's (report.tenantId is set from the sign-in, never trusted); a report marked "signed" needs an
 *        approval receipt that verifies for this clinic and this exact content (422 RECEIPT_INVALID); any receipt
 *        on a draft must at least be genuine and for this report and clinic; an approved (signed) report cannot be
 *        turned back into a draft (409 REPORT_LOCKED – an amendment is a new report).
 *        (fix wave 2) a body naming another clinic (report.tenantId neither the member's clinic nor "demo" – a
 *        case imported from the public demo) is refused: 403 TENANT_MISMATCH, never re-filed under this clinic.
 * DELETE → {deleted}; If-Match optional (409 REV_CONFLICT when it does not match). (Fix wave 2) an approved
 *        report is deleted only by the clinic's owner or an administrator (409 REPORT_LOCKED otherwise) – so an
 *        approved record can never be deleted and re-created as a draft by another role.
 * Every change writes an audit row (ids, revision and status only). Patient data is encrypted at rest by the host.
 * bh2 WC design 2 – provenance checked by the server (403 DECISION_NOT_ALLOWED): an update is compared with the
 *        stored revision; a create with the approved version it amends (report.amends, the same clinic), else with
 *        nothing – everything it holds is new. Every new or changed decision must carry the signed-in member's own
 *        stamp (`by` on paragraphs, answers, gap resolutions, acknowledgements, dispositions, adoptions, acceptances
 *        and own-words records): the same member id – the account id the Studio stamps – and, where the stamp names a
 *        registration number, the member's own. An approver-only decision – on a clinician box, an approver-only
 *        acknowledgement, "my own words", an adoption, an acceptance, applies anyway, the approving clinician's own
 *        text – needs the report's approver. Where text comes from is checked too (C-ATTR-5): text "from the records"
 *        is written only by the report factory (never added, changed or relabelled later, never outside a box filled
 *        from the records); "staff" text only in such a box; a person's text is never relabelled as drafted text; the
 *        drafted wording behind an edited paragraph (originalText, basis) is never rewritten; a paragraph's
 *        acknowledgement reason does not survive someone else's change to its words. Someone other than the approver
 *        cannot take away what the approver confirmed in a clinician box without the box reading as a proposal
 *        (core/provenance.ts approverEntryLost), nor remove the approver's adoption. "Superseded" entries are the
 *        server's. On a create the approver may name the member only if they may approve, with their own
 *        registration number. A case imported from the public demo keeps none of the demo's fictional decisions
 *        (core/provenance.ts voidDecisionsNotBy). The approver changes only by the member's own "Take over as
 *        approver"; tombstones and takeovers are append-only.
 *        A stored APPROVED report cannot change: its flags are byte-equal, its activity is only appended to (entries
 *        the server added – "superseded" – are kept), else 403 REPORT_LOCKED.
 *        WC design 8: storing an approved version 2 (report.amends) appends "Superseded by version 2" to version 1's
 *        activity on the server, once; loading the approved version 2 retries it, so every tab reads v1 as superseded.
 * Usage (25/10/2026): a report created here is counted as started for the clinic (an amended version names the report
 * it amends, so it never counts as a new report – only an approved report of the same patient, episode and form,
 * by the server's fingerprint of this report: api/usage.ts usageEpisodeFp).
 *
 * Owner: store slice (wave 2).
 */
import { MANAGE_ROLES, assertActorTenant, type Actor as AuthActor } from "../../auth/actor";
import { formMapMatches } from "../../auth/attestations";
import { verifyReceipt } from "../../auth/sign-receipt";
import { DEMO_TENANT_ID } from "../../config.public";
import { WORDING } from "../../core/wording";
import { canonicalize } from "../../core/fingerprint";
import { formToTemplate } from "../../core/forms";
import { REPORT_MODEL } from "../../core/schemas";
import { splitSentences } from "../../core/text/sentences";
import { getTemplate } from "../../templates/registry";
import {
  VOIDED_ADOPTION_SHA,
  answerSet,
  approverEntryLost,
  isClinicianBox,
  isClinicianGap,
  isOpinionBox,
  isPhysioChoiceBox,
  isSupersededBy,
  normaliseHcpc,
  ruledOutByRule,
  supersededEntry,
  voidDecisionsNotBy,
  type BoxContext,
  type RuleContext,
} from "../../core/provenance";
import { StoredFormDefinitionSchema, StoredReportSchema } from "../../core/stored-schemas";
import type { Actor, ActivityEntry, FormDefinition, Paragraph, Report, ReportFlag, ReportSection, ReportTemplate } from "../../core/types";
import { validateReport, validationBudgetExcess } from "../../core/validation";
import { ackPolicyOf } from "../../core/validation/acknowledge";
import { ENGINE_FIX_KINDS, fixCandidates, fixTextProblems, revalidationProblems, type FixCandidate } from "../../ui/components/review/fixes";
import { HttpError, json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import {
  STORE_MAX_PUT_BYTES,
  STORE_MAX_RECORD_BYTES,
  STORE_RECORD_ID_PATTERN,
  StoreReportPutRequestSchema,
  parseRevTag,
  type StoreReportResponse,
} from "../store-contract";
import type { StoredReportMeta, TenantStore } from "../store-port";
import { assertContentType, auditStore, jsonWithRev, pathParam, problemWith, requireTenantActor, takeNewData, type TenantActor } from "./store-actor";
import { assertClinicMayCreate } from "../../auth/clinic-access";
import { recordUsage, usageEpisodeFp, usageEpisodeOfReport } from "../usage";

function readIfMatch(req: Request): number | null {
  const raw = req.headers.get("if-match");
  if (raw === null || raw.trim() === "") return null;
  const rev = parseRevTag(raw);
  if (rev === null) {
    throw new HttpError(422, "Invalid If-Match", { code: "VALIDATION_FAILED", issues: [{ path: "If-Match", message: 'Send the revision as "<rev>".' }] });
  }
  return rev;
}

/**
 * A stored payload that no longer parses is a server fault, never shown to the client as data. Read as stored
 * (core/stored-schemas.ts): keys and flag codes a later release wrote stay in, so its receipt still verifies.
 */
function parseStoredReport(payload: unknown, id: string): Report {
  const parsed = StoredReportSchema.safeParse(payload);
  if (!parsed.success) {
    logEvent("store_report_unreadable", { id });
    throw new HttpError(500, "The stored report could not be read", { code: "INTERNAL", detail: "Please try again, or contact support." });
  }
  return parsed.data;
}

async function currentCopy(store: TenantStore, tenantId: string, id: string): Promise<StoreReportResponse | null> {
  const stored = await store.getReport(tenantId, id);
  if (!stored) return null;
  const parsed = StoredReportSchema.safeParse(stored.payload);
  return parsed.success ? { rev: stored.rev, updatedAt: stored.updatedAt, report: parsed.data } : null;
}

function conflict(current: StoreReportResponse | null, detail: string): Response {
  return problemWith(409, "This report was changed elsewhere", "REV_CONFLICT", detail, { current });
}

/** Receipt rules for a report about to be stored for `tenantId` (report.tenantId is already the actor's). */
async function checkReceipt(report: Report, tenantId: string): Promise<Response | null> {
  if (report.status === "signed") {
    if (!report.receipt) {
      return problem(422, "An approved report needs its approval receipt", {
        code: "RECEIPT_INVALID",
        detail: "Approve the report in ClinForms: the server issues the receipt.",
      });
    }
    const verified = await verifyReceipt(report.receipt, report, { tenantId });
    if (!verified.ok) {
      return problem(422, "The approval receipt is not valid for this report", {
        code: "RECEIPT_INVALID",
        detail:
          verified.reason === "HASH_MISMATCH"
            ? "The report has changed since it was approved. Start an amendment to change an approved report."
            : "The approval receipt could not be verified for this report and clinic.",
      });
    }
    return null;
  }
  if (report.receipt) {
    // A draft may still carry a receipt from before an edit, but never a forged one or another report's.
    const verified = await verifyReceipt(report.receipt, report, { tenantId });
    if (!verified.ok && verified.reason !== "HASH_MISMATCH") {
      return problem(422, "The approval receipt is not valid for this report", {
        code: "RECEIPT_INVALID",
        detail: "The approval receipt could not be verified for this report and clinic.",
      });
    }
  }
  return null;
}


/* ------------------------------------------------------------------------------------------------
 * Provenance (bh2 WC design 2)
 * ----------------------------------------------------------------------------------------------*/

/** The signed-in member as the store compares stamps with it (the account id is the member id the Studio stamps). */
interface StoreMember {
  memberId: string;
  name: string;
  role: string;
  hcpc?: string;
  canSign: boolean;
}

function storeMemberOf(actor: AuthActor): StoreMember {
  const hcpc = actor.clinician?.hcpc?.trim();
  return { memberId: actor.userId ?? "", name: actor.name ?? actor.clinician?.name ?? "", role: actor.role, ...(hcpc ? { hcpc } : {}), canSign: actor.clinician?.canSign === true };
}

/**
 * A stamp names the signed-in member: their account id – the member id the Studio stamps and the review compares
 * (core/provenance.ts sameMember) – and, where the stamp carries a registration number, theirs. Never the registration
 * number alone: the review would read such a stamp as whoever's member id it carries (check-WC problem 2).
 */
function isMember(stamp: { memberId?: string; hcpc?: string } | null | undefined, m: StoreMember): boolean {
  if (!stamp?.memberId || !m.memberId || stamp.memberId !== m.memberId) return false;
  if (!stamp.hcpc) return true;
  return Boolean(m.hcpc && normaliseHcpc(stamp.hcpc) === normaliseHcpc(m.hcpc));
}

const sameName = (a: string, b: string) => a.normalize("NFKC").trim().replace(/\s+/g, " ") === b.normalize("NFKC").trim().replace(/\s+/g, " ");

/** Whether the member may approve as the Studio stamps it (core/actor.ts memberActor: not staff, may sign, an HCPC number). */
const stampMaySign = (m: StoreMember) => m.role !== "staff" && m.canSign && Boolean(m.hcpc);

/**
 * A NEW or changed stamp is the signed-in member's own (harden-WC, check2-WC minor 1): their member id (and number, as
 * isMember) – and also the name and role the Studio stamps for them (the account's name and the member's role, the
 * same sources the server reads: src/server/auth/studio-access.ts, medreport-actor.ts), and never "may sign" for a
 * member who may not. So a label never names someone else ("Entered by Sarah Reid" on Pat's entry). Stamps kept as
 * stored are not re-read: a member renamed since keeps their earlier stamps.
 */
function isOwnStamp(stamp: { memberId?: string; hcpc?: string; name?: string; role?: string; canSign?: boolean } | null | undefined, m: StoreMember): boolean {
  if (!isMember(stamp, m) || !stamp) return false;
  if (typeof stamp.name === "string" && !sameName(stamp.name, m.name)) return false;
  if (typeof stamp.role === "string" && stamp.role !== m.role) return false;
  return !(stamp.canSign === true && !stampMaySign(m));
}

/** The member makes the approver's decisions on this report (a report with no approver: any member who is not staff). */
function isApprover(report: Pick<Report, "approver">, m: StoreMember): boolean {
  return report.approver ? isMember(report.approver, m) : m.role !== "staff";
}

const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/** Paragraph content that a stamp vouches for: its words and citations, and the drafted wording behind them. */
function paragraphContent(p: Paragraph): unknown {
  return { text: p.text, sourceIds: p.sourceIds, originalText: p.originalText ?? null, basis: p.basis ?? null };
}

const PERSON_ORIGINS: ReadonlySet<Paragraph["origin"]> = new Set<Paragraph["origin"]>(["clinician", "edited", "staff"]);

/** A stored paragraph is drafted text, or drafted text a person edited (it has drafted wording behind it). */
const isDraftedParagraph = (p: Paragraph) => p.origin === "ai" || (p.origin === "edited" && p.originalText !== undefined);

/**
 * Where a paragraph's text says it comes from, checked against the stored one (`b`; absent: a new paragraph – on a
 * create, everything): C-ATTR-5.
 */
function originViolations(s: ReportSection, p: Paragraph, b: Paragraph | undefined, opts: { create: boolean; was?: ReportSection; wasParagraphs: ReadonlyMap<string, Paragraph>; redrafted: boolean }): string[] {
  const out: string[] = [];
  const { create } = opts;
  const recordsBox = s.kind === "from_records" || s.kind === "declaration";
  const changed = !b || b.origin !== p.origin || !same(paragraphContent(p), paragraphContent(b));
  if (p.origin === "from_records" && changed) {
    // Written by the report factory only: on a create, in a box filled from the records; never added, changed or relabelled later.
    if (!recordsBox || !create) out.push("records-origin-claimed");
  }
  if (p.origin === "staff" && changed && s.kind !== "from_records") out.push("staff-origin-misplaced");
  // harden-WC (check2-WC minor 4): a person's paragraph whose words are exactly its drafted wording is drafted text –
  // never added as a person's (on a create, or as a new paragraph): the review turns such text back into drafted text.
  if (!b && PERSON_ORIGINS.has(p.origin) && p.originalText !== undefined && p.text === p.originalText) out.push("drafted-origin-relabelled");
  // harden-WC (check2-WC minor 5): drafted text appears on an update only where drafting fills a box that was waiting
  // for it, or where "Split it out" moves drafted sentences out of a stored paragraph of the box (splitOutParagraph).
  if (!b && !create && p.origin === "ai" && !opts.redrafted && !splitOutParagraph(opts.wasParagraphs, p)) out.push("drafted-text-added");
  if (!b) return out;
  // A person's text is never relabelled as drafted text (only put back to its drafted wording: "Revert"), and drafted
  // text becomes a person's only by a change to its words (check-WC minor 8: never verbatim drafted text as "edited").
  if (p.origin === "ai" && b.origin !== "ai" && (b.originalText === undefined || p.text !== b.originalText)) out.push("drafted-origin-claimed");
  if (b.origin === "ai" && PERSON_ORIGINS.has(p.origin) && p.text === b.text) out.push("drafted-origin-relabelled");
  // The drafted wording behind a paragraph changes only with its drafted text (a redraft), or when drafted text is first
  // edited (it keeps the words it was drafted with).
  if (!same(p.originalText, b.originalText) || !same(p.basis, b.basis)) {
    const redraft = b.origin === "ai" && p.origin === "ai";
    const firstEdit = b.origin === "ai" && PERSON_ORIGINS.has(p.origin) && p.originalText === (b.originalText ?? b.text) && same(p.basis, b.basis);
    if (!redraft && !firstEdit) out.push("drafted-wording-changed");
  }
  return out;
}

/**
 * R1T-WC-02 (SEC-2): "Split it out" moves the drafted sentences a person kept in their paragraph into a drafted paragraph
 * of their own – one or a few sentences. A split-out paragraph longer than this, or more of them in one save than
 * SPLIT_OUT_MAX_PER_SAVE, is not one: refused before any sentence of it is read.
 */
const SPLIT_OUT_MAX_CHARS = 20_000;
const SPLIT_OUT_MAX_PER_SAVE = 50;

/**
 * A drafted paragraph "Split it out" writes (ui/components/review/reducer.ts splitOutResidue): id "<id>-d<n>" next to a
 * stored person's paragraph <id> of the same box, with that paragraph's citations and basis, its drafted wording equal
 * to its text, and every sentence taken from the stored paragraph's words. Bounded (R1T-WC-02): never longer than
 * SPLIT_OUT_MAX_CHARS or its parent, and its parent found by id in the box's index.
 */
function splitOutParagraph(wasParagraphs: ReadonlyMap<string, Paragraph>, p: Paragraph): boolean {
  if (p.text.length > SPLIT_OUT_MAX_CHARS || p.id.length > 200) return false;
  const m = /^(.+)-d\d+$/.exec(p.id);
  const parent = m ? wasParagraphs.get(m[1]) : undefined;
  if (!parent || !PERSON_ORIGINS.has(parent.origin) || p.originalText !== p.text || !p.text.trim() || p.text.length > parent.text.length) return false;
  if (!same(p.sourceIds, parent.sourceIds) || !same(p.basis, parent.basis)) return false;
  return splitSentences(p.text, "prose").every((sp) => parent.text.includes(sp.text));
}

/**
 * The boxes this change redrafts (core/report-factory.ts applyDraftResult): waiting for drafting in the stored copy
 * (status "pending") and named by a drafting run the change records (a new Report.generation entry). Drafting replaces
 * such a box whole – its drafted text, a drafted answer, and its open questions.
 */
function redraftedKeys(before: Report | null, after: Report): Set<string> {
  const out = new Set<string>();
  if (!before) return out;
  // R2-SAF-1: only a box as the report factory makes it – waiting and empty: no paragraph, no answer, no tombstone. A
  // box that holds anything is never "redrafted" (a stored box is never put back to "pending": box-reset-pending), so
  // drafted text, answers and questions in it keep every check.
  const pending = new Set(before.sections.filter(waitingAndEmpty).map((s) => s.key));
  for (const g of (after.generation ?? []).slice((before.generation ?? []).length)) {
    for (const key of g.sectionKeys ?? []) if (pending.has(key)) out.add(key);
  }
  return out;
}

/** A box waiting for drafting as the report factory makes it (core/report-factory.ts): "pending" with nothing in it. */
function waitingAndEmpty(s: ReportSection): boolean {
  return s.status === "pending" && s.paragraphs.length === 0 && !answerSet(s.answer) && (s.tombstones ?? []).length === 0;
}

/** What makes a box the box it is: its key, kind, printed title, form field and the condition frozen when it was made. */
const boxIdentity = (s: ReportSection) => ({ kind: s.kind, title: s.title, fieldId: s.fieldId ?? s.key, condition: s.condition ?? null });

/**
 * harden-WC (check2-WC major A, check2-WA1 N1 option b): the boxes of a report are the report factory's, never the
 * request's. On an update (or a create amending an approved version) every box keeps its key, kind, title, form field
 * and frozen condition, and none is added or removed; Report.reportModel never changes. On a create the store checks
 * them, where it holds the clinic's form map the report was started from (or the built-in template), against the boxes
 * that map makes (`made`: kind from the fill source, title = the printed label; a drafted question the records answer –
 * session dates, core/session-dates.ts – may be filled from the records, never an opinion box).
 */
function boxViolations(before: Report | null, after: Report, made: BoxContext["boxes"]): string[] {
  const out: string[] = [];
  if (before) {
    const stored = new Map(before.sections.map((s) => [s.key, s]));
    const keys = new Set(after.sections.map((s) => s.key));
    if (after.sections.length !== keys.size || stored.size !== keys.size || before.sections.some((s) => !keys.has(s.key))) out.push("box-changed");
    for (const s of after.sections) {
      const was = stored.get(s.key);
      if (was && !same(boxIdentity(s), boxIdentity(was))) out.push("box-changed");
    }
    if (!same(before.reportModel, after.reportModel)) out.push("report-model-changed");
    // …and it completes the same form (or template) it was started from: the map its boxes come from.
    const formOf = (r: Report) => ({ formId: r.form?.formId ?? null, fileSha256: r.form?.fileSha256 ?? null, mapSha256: r.form?.mapSha256 ?? null, templateId: r.templateId, templateVersion: r.templateVersion ?? null });
    if (!same(formOf(before), formOf(after))) out.push("report-form-changed");
    return out;
  }
  if (after.reportModel !== undefined && after.reportModel !== REPORT_MODEL) out.push("report-model-changed");
  if (!made) return out;
  const keys = new Set(after.sections.map((s) => s.key));
  // Every box of the map is there (a built-in report may leave out a section its template marks optional).
  const optionalSection = (b: (typeof made)[number]) => !after.form && (b as { required?: boolean }).required === false;
  if (after.sections.length !== keys.size || made.some((b) => !keys.has(b.key) && !optionalSection(b))) out.push("box-changed");
  const byKey = new Map(made.map((b) => [b.key, b]));
  for (const s of after.sections) {
    const box = byKey.get(s.key);
    if (!box || box.title !== s.title || (s.fieldId !== undefined && s.fieldId !== s.key)) {
      out.push("box-changed");
      continue;
    }
    const recordsFill = box.kind === "ai_narrative" && s.kind === "from_records" && !isClinicianBox(after, box);
    if (box.kind !== s.kind && !recordsFill) out.push("box-changed");
  }
  return out;
}

/**
 * The stored questions (gaps) stay as stored (harden-WC, check2-WC major B): none is removed and none is rewritten apart
 * from its resolution (who settles one is checked below) – except the open questions of a box this change redrafts,
 * which drafting replaces. Removing a question would settle it, or leave an opinion box blank, with nobody's decision.
 */
function gapViolations(before: Report | null, after: Report, redrafted: ReadonlySet<string>): string[] {
  if (!before) return [];
  const out: string[] = [];
  // What the question is (the keys this build knows – a key a later release wrote is never sent back by this one).
  const core = (g: Report["gaps"][number]) => ({ sectionKey: g.sectionKey, kind: g.kind ?? null, issue: g.issue, suggestedQuestion: g.suggestedQuestion, suggestedAnswer: g.suggestedAnswer ?? null, relatedNoteIds: g.relatedNoteIds, raisedBy: g.raisedBy ?? null });
  const now = new Map(after.gaps.map((g) => [g.id, g]));
  for (const g of before.gaps) {
    const replaced = redrafted.has(g.sectionKey) && !g.resolution;
    const n = now.get(g.id);
    if (!n) {
      if (!replaced) out.push("gap-removed");
    } else if (!replaced && !same(core(n), core(g))) {
      out.push("gap-rewritten");
    }
  }
  return out;
}

/**
 * R1T-WC-01 (SAF-1): a tombstone (a drafted paragraph a person deleted – the drafted-residue check reads it) is the
 * server's to trust only as what it says it is: every NEW tombstone names a drafted paragraph of the stored box (origin
 * "ai", or edited drafted text) that this change removes, holds that paragraph's citations and part of its drafted
 * wording (the review keeps a long one as consecutive pieces of at most DRAFT_TOMBSTONE_MAX_CHARS characters), and is
 * stamped by the member. Stored tombstones stay as stored (append-only). A create has no stored paragraph to delete: it
 * holds none – except a create amending an approved version, whose tombstones it keeps, and a case imported from the
 * public demo, whose tombstones only ever make the check stricter (and are capped by the schema).
 */
/** The most drafted paragraphs (or pieces of one) one save may record as deleted in one box. */
const TOMBSTONES_PER_SAVE = 100;

function tombstoneViolations(was: ReportSection | undefined, s: ReportSection, m: StoreMember, opts: { create: boolean; demoImport: boolean; nowParagraphs: ReadonlyMap<string, Paragraph> }): string[] {
  const out: string[] = [];
  const stored = was?.tombstones ?? [];
  const now = s.tombstones ?? [];
  if (!same(now.slice(0, stored.length), stored)) out.push("tombstones-rewritten");
  const added = now.slice(stored.length);
  if (added.length === 0) return out;
  if (added.length > TOMBSTONES_PER_SAVE) return [...out, "tombstone-untied"];
  if (opts.create && !was) {
    if (!opts.demoImport) out.push("tombstone-untied");
    return out;
  }
  const wasParagraphs = new Map((was?.paragraphs ?? []).map((p) => [p.id, p]));
  for (const t of added) {
    const gone = wasParagraphs.get(t.paragraphId);
    const drafted = gone ? (gone.originalText ?? gone.text) : "";
    const tied = Boolean(gone && isDraftedParagraph(gone) && !opts.nowParagraphs.has(gone.id) && t.text.length > 0 && drafted.includes(t.text) && same(t.sourceIds, gone.sourceIds));
    if (!tied) out.push("tombstone-untied");
    else if (!isOwnStamp(t.by, m)) out.push("tombstone-by-other");
  }
  return out;
}

/** What the store needs to check a change: the boxes as the factory makes them, the form map, and the template. */
export interface StoreCheckContext extends RuleContext {
  /** The template the report's boxes are checked with (the form's, or the built-in one), for the one-click engine. */
  template?: ReportTemplate | null;
  /** The form map with its analysis (the one-click engine reads printed leads from it). */
  engineForm?: FormDefinition | null;
}

/** The most drafted paragraphs one save may change in place by one-click fixes, and the most fixes per paragraph. */
const FIXED_PARAGRAPHS_PER_SAVE = 20;
const FIXES_PER_PARAGRAPH_PER_SAVE = 5;

/** A fix's edits replayed on the text before it (from the last range to the first), or null when it has none to replay. */
function replayFix(text: string, fix: NonNullable<Paragraph["fixes"]>[number]): string | null {
  if (!fix.edits || fix.edits.length === 0) return null;
  let out = text;
  const edits = [...fix.edits].sort((a, b) => b.start - a.start);
  for (const e of edits) {
    if (e.start > e.end || e.end > out.length) return null;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * R1T-WC-04 (SAF-3): drafted text (origin "ai") changed in place keeps its "drafted" label and none of a person's
 * stamps, so it is changed only by the one-click engine (ui/components/review/fixes.ts – WD's rules, imported, never
 * re-implemented here): each new Paragraph.fixes entry is the member's own, replays (its edits) to the next text, and
 * that text is exactly a fix the engine offers the member on the report as it then stands (offeredFixes: whole
 * sentences, figures, negations, clinical negatives, the box's answer and re-validation all checked) – or, for an
 * undo, a text the paragraph held before (its drafted wording or an earlier fix's result). In a clinician box only the
 * approver applies one (the engine's own policy too). Anything else – a rewrite, a dropped clause, a flipped negation –
 * is refused: a person's change to drafted text is "edited", with their stamp.
 */
/**
 * R2-SEC-2 (= R2-REG-1): the R1T-WC-04 rule above, at a bounded cost. It used to run the validators over the whole
 * report – and the engine's own re-validation of every candidate – once per claimed fix, before refusing (any member,
 * unbudgeted). Now:
 *   1. the cheap structural checks of every claimed fix come first, with no validator, and the first refusal stops the
 *      check (draftedRewritePlan): the fix kind is one the engine makes, the stored entries are kept as a prefix, each
 *      new entry is the member's own, its edits replay to the next text, an undo returns to a text held before, only
 *      the approver changes a clinician box, at most FIXED_PARAGRAPHS_PER_SAVE paragraphs and FIXES_PER_SAVE fixes;
 *   2. only then, and only when some claimed fix needs the engine, the report is held to the validators' budget
 *      (VALIDATION_BUDGET, as /validate and /sign) and to the store's stricter bound on its notes
 *      (STORE_FIX_CHECK_NOTES_JSON): 413 before any validator – an ordinary save is never refused by either;
 *   3. the validators run once on the stored copy (the flags the engine works from, and the blocking flags before), each
 *      claimed fix must be exactly a candidate the engine makes for the member from that paragraph's flags and pass its
 *      text rules (fixTextProblems: whole sentences, figures, negations, clinical negatives, the box's answer, twins),
 *      and the validators run once more on the result (revalidationProblems over all the fixes together, per check and
 *      box; with more than one fix, a box whose answered check also gains a flag is refused – no fix can hide another's).
 * So a save costs at most two validator runs within those bounds, whatever it claims.
 */
const FIXES_PER_SAVE = 20;

/**
 * The store's own, stricter bound on the clinical notes of a report whose claimed fixes it checks (R2-SEC-2: the notes
 * set the validators' cost – one run on the validators' full budget, 300,000 characters, takes about a second). Counted
 * as the notes' JSON (a little more than their characters). The largest real report of the bh2 runs holds 5,647
 * characters of notes; beyond this the one-click fix is refused (413) and the paragraph is edited by hand instead.
 */
const STORE_FIX_CHECK_NOTES_JSON = 120_000;

/**
 * R2-SEC-2 (re-check, fix r2b): the engine's candidate generation on a claimed paragraph costs per flag it reads, more
 * than linearly in the paragraph and also with the notes it compares the paragraph with (measured per flag: a 680-
 * character paragraph 15 ms with 5,000 characters of notes, 66 ms with 100,000; a 10,000-character paragraph 0.5 s). So
 *   - a paragraph a claimed one-click fix changes holds at most STORE_FIX_PARAGRAPH_CHARS characters, before and after
 *     (the largest paragraph of the bh2 runs holds 684 – VALIDATION_BUDGET; a longer one is edited by hand, 413), and
 *   - the generators read only the SERVER's flags of the claimed paragraph (never the client-written stored flags), only
 *     those of the check the claimed kind answers, each distinct flag once, and within ENGINE_WORK_PER_SAVE: per flag
 *     read, the paragraph's characters plus the notes' characters / ENGINE_NOTES_WEIGHT, summed over the claims (about
 *     0.4 s of generation). Twenty claims on the largest real paragraphs (684 characters, 5,647 of notes) need about 17,000;
 *     beyond the budget, 413.
 */
const STORE_FIX_PARAGRAPH_CHARS = 4_000;
const ENGINE_WORK_PER_SAVE = 20_000;
const ENGINE_NOTES_WEIGHT = 40;

/**
 * The check each engine fix kind answers (the flag code its generator reads – fixes.ts own generators and
 * remove-commentary read DRAFT_FIT, WB's attribution fixes OTHER_CLINICIAN_VOICE). A narrowing only: a kind not listed
 * reads every flag of its paragraph. Kept to ENGINE_FIX_KINDS by scripts/medreport/wc-fix2b-store.test.ts.
 */
export const ENGINE_FIX_FLAG_CODE: Readonly<Record<string, ReportFlag["code"]>> = {
  "repeat-removal": "DRAFT_FIT",
  "duplicate-paragraph": "DRAFT_FIT",
  "value-only": "DRAFT_FIT",
  "dose-not-stated": "DRAFT_FIT",
  "printed-lead": "DRAFT_FIT",
  "remove-commentary": "DRAFT_FIT",
  "attribution-prefix": "OTHER_CLINICIAN_VOICE",
  "use-note-words": "OTHER_CLINICIAN_VOICE",
  "name-instead": "OTHER_CLINICIAN_VOICE",
};

/** One claimed fix the engine must make: the paragraph's text before and after it, as the save replays it. */
interface ClaimedFix {
  key: string;
  paragraphId: string;
  kind: string;
  before: string;
  after: string;
}

/** The structural checks (step 1): the engine fixes to verify, or the first refusal. No validator runs here. */
function draftedRewritePlan(after: Report, rewrites: ReadonlyArray<{ key: string; p: Paragraph; b: Paragraph }>, m: StoreMember, ctx: StoreCheckContext, approver: boolean): { refused: string } | { claims: ClaimedFix[] } {
  if (rewrites.length > FIXED_PARAGRAPHS_PER_SAVE) return { refused: "drafted-text-rewritten" };
  if (!ctx.template) return { refused: "drafted-text-rewritten" };
  const claims: ClaimedFix[] = [];
  let total = 0;
  for (const { key, p, b } of rewrites) {
    const stored = b.fixes ?? [];
    const now = p.fixes ?? [];
    const added = now.slice(stored.length);
    total += added.length;
    if (added.length === 0 || added.length > FIXES_PER_PARAGRAPH_PER_SAVE || total > FIXES_PER_SAVE || !same(now.slice(0, stored.length), stored)) return { refused: "drafted-text-rewritten" };
    // The fix kind is one the engine makes (or the undo of one).
    if (added.some((f) => !ENGINE_FIX_KINDS.has(f.kind.startsWith("undo-") ? f.kind.slice("undo-".length) : f.kind))) return { refused: "drafted-text-rewritten" };
    if (added.some((f) => !isOwnStamp(f.by, m))) return { refused: "fix-by-other" };
    const section = after.sections.find((s) => s.key === key);
    if (section && isClinicianBox(after, section, ctx) && !approver) return { refused: "fix-approver-only" };
    // The texts the paragraph held before this save: its drafted wording and each earlier fix's result.
    const earlier = new Set<string>([b.originalText ?? b.text, b.text]);
    let replay = b.originalText ?? b.text;
    for (const f of stored) {
      const next = replayFix(replay, f);
      if (next === null) break;
      earlier.add(next);
      replay = next;
    }
    let text = b.text;
    for (let i = 0; i < added.length; i++) {
      const f = added[i];
      const next = replayFix(text, f) ?? (i === added.length - 1 ? p.text : null);
      if (next === null) return { refused: "drafted-text-rewritten" };
      if (f.kind.startsWith("undo-")) {
        if (!earlier.has(next)) return { refused: "drafted-text-rewritten" };
      } else {
        claims.push({ key, paragraphId: b.id, kind: f.kind, before: text, after: next });
      }
      earlier.add(next);
      text = next;
    }
    if (text !== p.text) return { refused: "drafted-text-rewritten" };
  }
  return { claims };
}

/** A report with one paragraph's text replaced (the claimed fix applied, as the engine checks it). */
function withText(report: Report, key: string, paragraphId: string, text: string): Report {
  return { ...report, sections: report.sections.map((s) => (s.key !== key ? s : { ...s, paragraphs: s.paragraphs.map((x) => (x.id === paragraphId ? { ...x, text } : x)) })) };
}

/**
 * Steps 2 and 3: the claimed fixes, each exactly one the engine makes and its rules accept, on the stored copy. Returns
 * a refusal code, or null. "fix-check-too-large" is answered 413 (the validators' budget).
 */
function engineFixViolation(before: Report, claims: readonly ClaimedFix[], m: StoreMember, ctx: StoreCheckContext): string | null {
  const template = ctx.template;
  if (!template) return "drafted-text-rewritten";
  const form = ctx.engineForm ?? null;
  // The fixed report (every claimed fix applied to the stored copy) is what the validators read last.
  let fixed: Report = before;
  for (const c of claims) fixed = withText(fixed, c.key, c.paragraphId, c.after);
  if (validationBudgetExcess(before, form) || validationBudgetExcess(fixed, form)) return "fix-check-too-large";
  const notesJson = JSON.stringify(before.bundleSnapshot?.notes ?? []).length;
  if (notesJson > STORE_FIX_CHECK_NOTES_JSON) return "fix-check-too-large";
  if (claims.some((c) => c.before.length > STORE_FIX_PARAGRAPH_CHARS || c.after.length > STORE_FIX_PARAGRAPH_CHARS)) return "fix-check-too-large";
  try {
    const actor: Actor = { memberId: m.memberId, name: m.name, role: m.role as Actor["role"], canSign: stampMaySign(m), ...(m.hcpc ? { hcpc: m.hcpc } : {}) };
    const owner = before.approver ? { memberId: before.approver.memberId, name: before.approver.name, hcpc: before.approver.hcpc } : null;
    const validate = (r: Report) => validateReport({ ...r, flags: [] }, template, { form, ...(owner ? { voice: { owner } } : {}) });
    const engine = { actor, template, form };
    // The validators once on the stored copy: the flags the engine works from, the blocking ones before.
    const first = validate(before);
    const matched: FixCandidate[] = [];
    // Each paragraph's claimed fixes in order, each on the paragraph as the earlier ones left it. The generators read the
    // server's flags only (R2-SEC-2 re-check: client-written stored flags multiplied their work), of the claimed kind's
    // check, each distinct flag once – and a claim's generators run only while the save's work stays within
    // ENGINE_WORK_PER_SAVE (the work done before a refusal never exceeds it; a forged claim stops the check at once).
    let current: Report = before;
    let work = 0;
    for (const c of claims) {
      const code = ENGINE_FIX_FLAG_CODE[c.kind];
      const seen = new Set<string>();
      const flags: ReportFlag[] = [];
      for (const f of first.flags) {
        if (f.sectionKey !== c.key || f.paragraphId !== c.paragraphId || (code && f.code !== code)) continue;
        const sig = `${f.code}|${f.severity}|${f.evidence ?? ""}|${f.message}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        flags.push(f);
      }
      work += flags.length * (c.before.length + Math.ceil(notesJson / ENGINE_NOTES_WEIGHT));
      if (work > ENGINE_WORK_PER_SAVE) return "fix-check-too-large";
      if (current.status === "signed") return "drafted-text-rewritten";
      const candidate = fixCandidates({ ...current, flags }, engine).find(
        (x) => x.paragraphId === c.paragraphId && x.sectionKey === c.key && x.before === c.before && x.after === c.after && x.generator.slice(0, 64) === c.kind && fixTextProblems(current, x, engine).length === 0,
      );
      if (!candidate) return "drafted-text-rewritten";
      matched.push(candidate);
      current = withText(current, c.key, c.paragraphId, c.after);
    }
    // The validators once more, on the fixed report: no blocking flag added, none cleared but the ones the fixes answer.
    const last = validate(fixed);
    if (revalidationProblems(first.blocking, last.blocking, matched).length > 0) return "drafted-text-rewritten";
    if (matched.length > 1) {
      // No fix hides another's: a box where a fix answers a check keeps no new flag of that check.
      const sig = (f: ReportFlag) => `${f.code}|${f.sectionKey ?? ""}|${f.paragraphId ?? ""}|${f.evidence ?? ""}|${f.message}`;
      const had = new Set(first.blocking.map(sig));
      const answeredKeys = new Set(matched.flatMap((x) => x.answers).map((f) => `${f.code}|${f.sectionKey ?? ""}`));
      if (last.blocking.some((f) => answeredKeys.has(`${f.code}|${f.sectionKey ?? ""}`) && !had.has(sig(f)))) return "drafted-text-rewritten";
    }
    return null;
  } catch {
    return "drafted-text-rewritten";
  }
}

/**
 * The new or changed decisions in `after` – against `before`: the stored revision (an update), the approved version a
 * create amends, or null (a create: everything is new) – that the member may not record. Codes only.
 * `ctx`: the boxes as the report factory makes them (the clinic's form map the report was started from, or the built-in
 * template – boxContextOf), when the store holds them.
 * R1T-WC-02 (SEC-2): every stored box, paragraph and gap is looked up through an index built once per save – never
 * searched again for every box or paragraph of the request.
 */
export function decisionViolations(
  before: Report | null,
  after: Report,
  m: StoreMember,
  ctx: StoreCheckContext = {},
  opts: { create?: boolean; /** A case imported from the public demo: text and answers its fictional user wrote. */ demoAuthors?: boolean } = {},
): string[] {
  const out: string[] = [];
  const create = opts.create === true;
  // Who wrote a paragraph or chose an answer (not a decision): the member, or – in a case imported from the public
  // demo – the demo's one fictional user (DEMO_IMPORT_ACTOR, as importedFromDemo stamps it), who is nobody in the clinic
  // (what they wrote waits for the approver). R1T-WC-07: never a demo stamp carrying another name, role or number.
  const author = (by: { memberId?: string; hcpc?: string; name?: string; role?: string; canSign?: boolean }) => isOwnStamp(by, m) || (opts.demoAuthors === true && isDemoImportStamp(by));
  const approver = isApprover(after, m);
  const redrafted = create ? new Set<string>() : redraftedKeys(before, after);
  // R1T-WC-06 (SEC-3): a clinic report is made with its approving clinician (the Studio always chooses one): a create
  // without one is refused – the approver-only rules below then always have an approver to keep decisions for. (A
  // version 2 amending an approval from before the release keeps that approval's absence of one.)
  if (create && !after.approver && !(before && before.status === "signed" && !before.approver)) out.push("approver-missing");
  // R2-SAF-2: a new report is checked against the boxes the report factory makes – the clinic's stored form map it names
  // (report.form.mapSha256, the very map) or the built-in template of the same version. A create whose boxes the server
  // cannot establish is refused, never checked against its own boxes, kinds, titles and frozen conditions. (An
  // amendment is checked against the approved version 1 it amends, which fixes its boxes – even after the template
  // or map moved on.)
  if (create && !before && !ctx.boxes) out.push(after.form ? "form-map-unknown" : "template-unknown");
  // What makes each box the box it is, and the questions stored about it (harden-WC majors A and B).
  out.push(...boxViolations(before, after, ctx.boxes ?? null));
  out.push(...gapViolations(before, after, redrafted));
  const flagsBefore = new Map((before?.flags ?? []).map((f) => [f.id, f]));
  // The stored boxes and their paragraphs, indexed once (R1T-WC-02).
  const sectionsBefore = new Map((before?.sections ?? []).map((s) => [s.key, s]));
  const paragraphsBefore = new Map<string, Map<string, Paragraph>>();
  const storedParagraphs = (key: string): Map<string, Paragraph> => {
    let idx = paragraphsBefore.get(key);
    if (!idx) {
      idx = new Map();
      for (const p of sectionsBefore.get(key)?.paragraphs ?? []) if (!idx.has(p.id)) idx.set(p.id, p);
      paragraphsBefore.set(key, idx);
    }
    return idx;
  };
  // Paragraphs whose words or citations this change rewrote (by id, across boxes – as the stored flags name them).
  const rewritten = new Set<string>();
  for (const s of after.sections ?? []) {
    const idx = storedParagraphs(s.key);
    for (const p of s.paragraphs) {
      const b = idx.get(p.id);
      if (b && (b.text !== p.text || !same(b.sourceIds, p.sourceIds))) rewritten.add(p.id);
    }
  }
  for (const f of after.flags ?? []) {
    const ack = f.acknowledged;
    if (!ack) continue;
    const stored = flagsBefore.get(f.id);
    const was = stored?.acknowledged;
    if (stored && was && was.reason === ack.reason && was.at === ack.at && same(was.by, ack.by)) {
      // A kept acknowledgement stays on the check it was made on (harden-WC, check2-WC major C): the paragraph, box and
      // question are the stored flag's – the flag id names them – never the request's.
      const where = (x: typeof f) => ({ code: x.code, sectionKey: x.sectionKey ?? null, paragraphId: x.paragraphId ?? null, gapId: x.gapId ?? null });
      if (!same(where(f), where(stored))) out.push("acknowledgement-moved");
      // Someone else's acknowledgement covered the words as they were: it does not survive this member rewriting them.
      if (stored.paragraphId && rewritten.has(stored.paragraphId) && ack.by && !isMember(ack.by, m)) out.push("acknowledgement-stale");
      continue;
    }
    if (ack.by && !isOwnStamp(ack.by, m)) out.push("acknowledged-by-other");
    else if (f.code === "APPROVER_DECISION") out.push("approver-decision-acknowledged");
    else {
      const policy = ackPolicyOf(f, after);
      // R1T-WC-L8: a check nobody may acknowledge (fix the text, the record or the gap) is not stored as acknowledged.
      if (policy === "never") out.push("acknowledgement-never");
      else if (policy === "approver" && !approver) out.push("acknowledgement-approver-only");
    }
  }
  const draftedRewrites: Array<{ key: string; p: Paragraph; b: Paragraph }> = [];
  let splitOuts = 0;
  for (const s of after.sections ?? []) {
    const was = sectionsBefore.get(s.key);
    const wasParagraphs = storedParagraphs(s.key);
    const nowParagraphs = new Map(s.paragraphs.map((p) => [p.id, p]));
    const clinician = isClinicianBox(after, s, ctx);
    const redraft = redrafted.has(s.key);
    // R2-SAF-1: a stored box is never put back to waiting for drafting – only the report factory makes a box "pending".
    if (was && was.status !== "pending" && s.status === "pending") out.push("box-reset-pending");
    for (const p of s.paragraphs) {
      const b = wasParagraphs.get(p.id);
      const contentChanged = !b || !same(paragraphContent(p), paragraphContent(b));
      if (p.by && (contentChanged || !same(p.by, b?.by)) && !author(p.by) && !(b && !contentChanged && p.origin !== b.origin)) out.push("paragraph-by-other");
      // R1T-WC-08: someone else's words are never re-stamped as this member's without a change to them – "These are my
      // own words" is for the approver's own rewrites; someone else's uncited text is adopted (it keeps their name).
      if (b && !contentChanged && b.by && p.by && !same(p.by, b.by) && !isMember(b.by, m) && isMember(p.by, m)) out.push("paragraph-restamped");
      if (p.ownWords && !same(p.ownWords, b?.ownWords)) {
        if (!isOwnStamp(p.ownWords.by, m) || !approver) out.push("own-words-approver-only");
        else if ((b && b.by && !isMember(b.by, m)) || b?.origin === "staff" || (!b && p.by && !isMember(p.by, m))) out.push("own-words-other-member");
      }
      if (p.ackReason && p.ackReason !== b?.ackReason && !approver) out.push("acknowledgement-approver-only");
      // A paragraph's acknowledgement reason covered its words: someone else's change to them does not keep it.
      if (p.ackReason && b && b.ackReason === p.ackReason && contentChanged && !approver) out.push("acknowledgement-stale");
      const nowClinician = p.origin === "clinician" && (!b || b.origin !== "clinician" || contentChanged);
      if (nowClinician && !approver) out.push("clinician-text-approver-only");
      if (!b && !create && p.origin === "ai" && !redraft) splitOuts += 1;
      // R1T-WC-04: drafted text changed in place, outside a redraft – the one-click engine's, checked below.
      if (b && b.origin === "ai" && p.origin === "ai" && b.text !== p.text && !redraft) draftedRewrites.push({ key: s.key, p, b });
      // Fixes are append-only and each new one is the member's own (a fix on any paragraph, drafted or a person's).
      if (b && !redraft) {
        const storedFixes = b.fixes ?? [];
        const nowFixes = p.fixes ?? [];
        if (!same(nowFixes.slice(0, storedFixes.length), storedFixes)) out.push("fixes-rewritten");
        else if (nowFixes.slice(storedFixes.length).some((f) => !isOwnStamp(f.by, m))) out.push("fix-by-other");
      } else if (!b && (p.fixes ?? []).some((f) => !author(f.by)) && !redraft) {
        out.push("fix-by-other");
      }
      out.push(...originViolations(s, p, b, { create: create && !before, was, wasParagraphs, redrafted: redraft }));
      // R2-TPN-01 (re-check, fix r2b): a person's paragraph added on an update, or whose words or citations it changes,
      // carries the member's stamp – the review stamps every paragraph a person writes or changes (reducer
      // stampDecisions) – and a stamp is never taken off. Unstamped, a staff entry replacing a records box's code-filled
      // paragraph (or any box's text) would read "Entered by staff" with no one's name, no activity and no check. (An
      // origin change alone – the approver's adoption – keeps the stored stamp, or its absence on an older report.)
      if (before && was && !redraft && PERSON_ORIGINS.has(p.origin) && !p.by && (!b || b.text !== p.text || !same(b.sourceIds, p.sourceIds) || Boolean(b.by))) out.push("paragraph-unstamped");
    }
    if (s.answer && !same(s.answer, was?.answer) && s.answerBy && !author(s.answerBy)) out.push("answer-by-other");
    // An answer set or replaced with no one's stamp (check-WC problem 3; harden-WC, check2-WC major B: an empty box filled
    // too). R2-TPN-01: in EVERY box, whoever saves it – a records box's code-filled value, a drafted yes/no, tick or
    // choice, a clinician box: the review stamps every answer a person sets (reducer setStructuredAnswer,
    // stampDecisions), the report factory fills a records box only when the report is made, and drafting fills only an
    // empty box that waits for it (a redraft) – so an unstamped change would read as drafted or as the records, with no
    // one's name, no activity and no check. Clearing an answer (no value, no stamp) stays the member's to do; a stamp is
    // never taken off an answer that stays (it would turn a person's answer back into "drafted" or "records").
    if (before && was && !redraft && answerSet(s.answer) && !s.answerBy && (!same(s.answer, was.answer) || was.answerBy)) out.push("answer-unstamped");
    // R2-TPN-01 (re-check, fix r2b): a box's answer keeps the kind it was made with (core/forms/answers.ts answerKindFor:
    // fixed by the form question; the review's setAnswer never changes it) and is never taken away – a yes/no, date or
    // tick replaced by a "text" answer, or removed, would print the box's text instead of the answer with no one's
    // stamp (answerSet reads a text answer as no answer). Only a redraft of an empty waiting box writes a new answer.
    if (before && was && !redraft && was.answer && (!s.answer || s.answer.kind !== was.answer.kind)) out.push("answer-kind-changed");
    // A text answer holds no value (toFormAnswer, parseFormAnswerValue: the box's paragraphs are its answer).
    if (s.answer && s.answer.kind === "text" && s.answer.value !== null && s.answer.value !== undefined && !same(s.answer, was?.answer)) out.push("answer-kind-changed");
    // R1T-WC-03 (SAF-2): drafting never answers an opinion box or the physiotherapist's choice – not on a create, not in
    // a redraft – so an answer there with no one's stamp is refused there too (the review stamps every answer a person sets).
    if ((isOpinionBox(s, ctx) || isPhysioChoiceBox(ctx, s.key)) && answerSet(s.answer) && !same(s.answer, was?.answer) && !s.answerBy && (create || redraft || !before)) out.push("answer-unstamped");
    // Anyone's change voids the approver's adoption (the review writes VOIDED_ADOPTION_SHA); only the approver adopts.
    const voiding = Boolean(was?.adoptedBy && s.adoptedBy && same(s.adoptedBy, { ...was.adoptedBy, contentSha: VOIDED_ADOPTION_SHA }));
    if (s.adoptedBy && !same(s.adoptedBy, was?.adoptedBy) && !voiding && (!isOwnStamp(s.adoptedBy.by, m) || !approver)) out.push("adoption-approver-only");
    // The approver's adoption is theirs to renew or remove: someone else's change leaves it stale (the box waits for them).
    if (was?.adoptedBy && !s.adoptedBy && !approver) out.push("adoption-removed");
    const acceptedBefore = new Set((was?.accepted ?? []).map((a) => canonicalize(a)));
    for (const a of s.accepted ?? []) if (!acceptedBefore.has(canonicalize(a)) && (!isOwnStamp(a.by, m) || !approver)) out.push("acceptance-approver-only");
    const d = s.disposition;
    if (d && !same(d, was?.disposition)) {
      if (!isOwnStamp(d.by, m)) out.push("disposition-by-other");
      else if ((clinician || d.kind === "applies_anyway") && !approver) out.push("disposition-approver-only");
    }
    out.push(...tombstoneViolations(was, s, m, { create, demoImport: opts.demoAuthors === true, nowParagraphs }));
    // What the approver confirmed in a clinician box is not taken away behind their back (check-WC problem 5).
    if (before && clinician && !approver && approverEntryLost(before, after, s.key, ctx)) out.push("approver-entry-removed");
  }
  if (splitOuts > SPLIT_OUT_MAX_PER_SAVE) out.push("drafted-text-added");
  // R2-SEC-2: claimed one-click fixes – their structural checks here (no validator); the engine's, last, below.
  let engineClaims: ClaimedFix[] = [];
  if (before && draftedRewrites.length > 0) {
    const plan = draftedRewritePlan(after, draftedRewrites, m, ctx, approver);
    if ("refused" in plan) out.push(plan.refused);
    else engineClaims = plan.claims;
  }
  const gapsBefore = new Map((before?.gaps ?? []).map((g) => [g.id, g]));
  // R1T-WC-05 (SAF-4): which boxes a rule rules out, as the server reads them – now and in the stored copy – worked out once.
  let ruledOutNow: ReadonlySet<string> | null = null;
  let ruledOutBefore: ReadonlySet<string> | null = null;
  const outNow = (key: string) => (ruledOutNow ??= ruledOutByRule(after, ctx)).has(key);
  const outBefore = (key: string) => Boolean(before) && (ruledOutBefore ??= ruledOutByRule(before as Report, ctx)).has(key);
  for (const g of after.gaps ?? []) {
    const r = g.resolution;
    if (!r) continue;
    const was = gapsBefore.get(g.id)?.resolution;
    const kept = Boolean(was && same({ ...was, by: undefined }, { ...r, by: undefined }) && same(was.by, r.by));
    // "Not applicable" stands only where a rule rules the box out (gaps.ts settleConditionalGaps); a claim the server's
    // reading does not make is checked like any other resolution of the question.
    const ruledOut = r.notApplicable === true && outNow(g.sectionKey);
    if (kept) {
      // A kept "not applicable" whose box this change made apply again is a question someone closed: the review reopens it.
      if (r.notApplicable && !ruledOut && outBefore(g.sectionKey) && isClinicianGap(after, g, ctx) && !approver) out.push("gap-approver-only");
      continue;
    }
    if (r.by && !isOwnStamp(r.by, m)) out.push("gap-by-other");
    else if (!ruledOut && isClinicianGap(after, g, ctx) && !approver) out.push("gap-approver-only");
  }
  if (before && !same(before.approver, after.approver)) {
    // Only "Take over as approver": the member themselves, who may approve, recorded as a takeover from the approver.
    const takeovers = after.approverTakeovers ?? [];
    const last = takeovers[takeovers.length - 1];
    const recorded = !before.approver || (last && same(last.from, before.approver) && same(last.to, after.approver) && takeovers.length === (before.approverTakeovers?.length ?? 0) + 1);
    if (!after.approver || !isOwnStamp(after.approver, m) || !m.canSign || !m.hcpc || !recorded) out.push("approver-changed");
  }
  if (before?.approver && after.approver && !same(before.approver, after.approver) && takeoverKeepsOthers(before, after, m, ctx)) out.push("takeover-not-voided");
  if (!before && after.approver && after.approver.memberId === m.memberId && (!m.canSign || !m.hcpc || !isOwnStamp(after.approver, m))) out.push("approver-claimed");
  if (before && !same((after.approverTakeovers ?? []).slice(0, (before.approverTakeovers ?? []).length), before.approverTakeovers ?? [])) out.push("takeovers-rewritten");
  // harden-WC (check2-WC minor 3): a new report has had no takeover – the receipt of its approval would repeat a made-up one.
  if (!before && (after.approverTakeovers ?? []).length > 0) out.push("takeovers-claimed");
  // "Superseded" entries are the server's (markSuperseded): a client never adds one (check-WC minor 7).
  const kept = new Set((before?.activity ?? []).map((e) => canonicalize(e)));
  if ((after.activity ?? []).some((e) => e.action === "superseded" && !kept.has(canonicalize(e)))) out.push("superseded-by-client");
  // R2-SEC-2: the validators run only for a save every other check accepts, and only for fixes the engine must confirm.
  if (out.length === 0 && before && engineClaims.length > 0) {
    const refused = engineFixViolation(before, engineClaims, m, ctx);
    if (refused) out.push(refused);
  }
  return Array.from(new Set(out));
}

/** R2-SEC-2: the refusal code answered 413 (the validators' budget) rather than 403. */
export const FIX_CHECK_TOO_LARGE = "fix-check-too-large";

/**
 * A takeover (the approver changes to the member) keeps a decision someone else made before it – an acknowledgement
 * (not a warning's), an adoption, an acceptance, an own-words record, an approver-only disposition, a paragraph's
 * acknowledgement reason, "clinician" text, a settled clinician gap – that "Take over as approver" voids
 * (core/provenance.ts voidDecisionsNotBy): a client that changed the approver without voiding them.
 * R1T-WC-02: the stored boxes and paragraphs indexed once; R1T-WC-05: a "not applicable" resolution is exempt only where a
 * rule rules its box out.
 */
function takeoverKeepsOthers(before: Report, after: Report, m: StoreMember, ctx: StoreCheckContext): boolean {
  const mine = (by: { memberId?: string; hcpc?: string } | null | undefined) => isMember(by, m);
  const flagsBefore = new Map(before.flags.map((f) => [f.id, f.acknowledged]));
  if (after.flags.some((f) => f.acknowledged && f.severity !== "warning" && !mine(f.acknowledged.by) && same(flagsBefore.get(f.id), f.acknowledged))) return true;
  const gapsBefore = new Map(before.gaps.map((g) => [g.id, g.resolution]));
  const ruledOut = ruledOutByRule(after, ctx);
  if (after.gaps.some((g) => g.resolution && !(g.resolution.notApplicable && ruledOut.has(g.sectionKey)) && !mine(g.resolution.by) && same(gapsBefore.get(g.id), g.resolution) && isClinicianGap(after, g, ctx))) return true;
  const sectionsBefore = new Map(before.sections.map((s) => [s.key, s]));
  for (const s of after.sections) {
    const was = sectionsBefore.get(s.key);
    if (!was) continue;
    if (s.adoptedBy && !mine(s.adoptedBy.by) && same(s.adoptedBy, was.adoptedBy)) return true;
    const acceptedBefore = new Set((was.accepted ?? []).map((a) => canonicalize(a)));
    if ((s.accepted ?? []).some((a) => !mine(a.by) && acceptedBefore.has(canonicalize(a)))) return true;
    if (s.disposition && !mine(s.disposition.by) && same(s.disposition, was.disposition) && (s.disposition.kind === "applies_anyway" || isClinicianBox(after, s, ctx))) return true;
    const wasParagraphs = new Map(was.paragraphs.map((p) => [p.id, p]));
    for (const p of s.paragraphs) {
      const b = wasParagraphs.get(p.id);
      if (!b) continue;
      if (p.ackReason && p.ackReason === b.ackReason) return true;
      if (p.ownWords && !mine(p.ownWords.by) && same(p.ownWords, b.ownWords)) return true;
      if (p.origin === "clinician" && b.origin === "clinician" && !mine(p.by) && same(paragraphContent(p), paragraphContent(b))) return true;
    }
  }
  return false;
}

/** The member id the public demo stamps its one fictional user with (core/actor.ts demoActor). */
const DEMO_MEMBER_ID = "demo";

/**
 * R1T-WC-07 (SEC-4): the one stamp a case imported from the public demo carries for what the demo's fictional user did –
 * whatever name, role or number the demo's own stamps said. So a label never reads "Entered by <a member of this
 * clinic>" for the demo's words: they read as the public demo's, and wait for the approver.
 */
export const DEMO_IMPORT_ACTOR: Actor = { memberId: DEMO_MEMBER_ID, name: "Public demo user (fictional)", role: "clinician", canSign: false };

/** Exactly the stamp importedFromDemo writes. */
function isDemoImportStamp(by: { memberId?: string; hcpc?: string; name?: string; role?: string; canSign?: boolean } | null | undefined): boolean {
  return Boolean(by && by.memberId === DEMO_MEMBER_ID && by.name === DEMO_IMPORT_ACTOR.name && by.role === DEMO_IMPORT_ACTOR.role && by.canSign !== true && !by.hcpc);
}

function demoStamp<T extends { memberId?: string } | undefined>(by: T): T | Actor {
  return by && by.memberId === DEMO_MEMBER_ID ? { ...DEMO_IMPORT_ACTOR } : by;
}

/**
 * A case imported from the public demo (report.tenantId "demo"): its decisions are the demo's fictional user's, made in
 * no clinic – none of them stands here. Every acknowledgement, own-words record, adoption, acceptance, disposition and
 * gap resolution someone other than the importing member made is removed (core/provenance.ts voidDecisionsNotBy, and
 * the member-level ones too); "clinician" text becomes a proposal; "superseded" entries are dropped (the server writes
 * those). Who wrote the text and chose the answers stays (the demo's user is nobody in the clinic, so it waits for
 * the approver) – R1T-WC-07: as the one fixed demo stamp (DEMO_IMPORT_ACTOR), never the name, role or number the demo's
 * own stamp carried – and so does the demo's approver, under that name: a member who may approve takes over before
 * approving.
 */
function importedFromDemo(report: Report, m: StoreMember, ctx: RuleContext = {}): Report {
  const mine = (by: { memberId?: string; hcpc?: string } | null | undefined) => isMember(by, m);
  const voided = voidDecisionsNotBy(report, mine, ctx);
  const sections = voided.sections.map((s) => {
    const next: ReportSection = { ...s, paragraphs: s.paragraphs.map((p) => (p.by?.memberId === DEMO_MEMBER_ID || (p.fixes ?? []).some((f) => f.by.memberId === DEMO_MEMBER_ID) ? { ...p, ...(p.by ? { by: demoStamp(p.by) as Actor } : {}), ...(p.fixes ? { fixes: p.fixes.map((f) => ({ ...f, by: demoStamp(f.by) as Actor })) } : {}) } : p)) };
    if (next.answerBy) next.answerBy = demoStamp(next.answerBy) as Actor;
    if (next.tombstones) next.tombstones = next.tombstones.map((t) => ({ ...t, by: demoStamp(t.by) as Actor }));
    if (next.disposition && !mine(next.disposition.by)) delete next.disposition;
    return next;
  });
  const gaps = voided.gaps.map((g) => {
    if (!g.resolution?.by || mine(g.resolution.by)) return g;
    const open = { ...g };
    delete open.resolution;
    return open;
  });
  const flags = voided.flags.map((f) => {
    if (!f.acknowledged || mine(f.acknowledged.by)) return f;
    const open = { ...f };
    delete open.acknowledged;
    return open;
  });
  // No takeover happened in this clinic (harden-WC, check2-WC minor 3): the demo's own are not kept.
  const approver = report.approver && report.approver.memberId === DEMO_MEMBER_ID ? { ...report.approver, name: DEMO_IMPORT_ACTOR.name } : report.approver;
  const imported: Report = { ...report, sections, gaps, flags, activity: report.activity.filter((e) => e.action !== "superseded"), ...(approver ? { approver } : {}) };
  delete imported.approverTakeovers;
  return imported;
}

/**
 * The approved version a create amends (report.amends, stored in this clinic) – the base its decisions are checked
 * against. Only an APPROVED report is a base (harden-WC, check2-WC minor 2): an amendment starts from an approval; a
 * "version 2" of a draft is checked as all-new, so it carries none of the draft's decisions.
 */
async function amendedBase(t: TenantActor, report: Report): Promise<Report | null> {
  const id = report.amends?.reportId;
  if (!id || id === report.id) return null;
  const row = await t.store.getReport(t.tenantId, id).catch(() => null);
  const parsed = row ? StoredReportSchema.safeParse(row.payload) : null;
  return parsed?.success && parsed.data.status === "signed" ? parsed.data : null;
}

/** An activity entry the server wrote (version 1's "superseded"): a client's older copy may lack it. */
function serverEntry(e: ActivityEntry): boolean {
  return e.action === "superseded" && typeof e.reportId === "string";
}

/**
 * A stored approved report: the flags must be exactly the stored ones and the activity an extension of it. Returns the
 * activity to store (the server's own entries kept where the client's copy lacks them), or null when refused.
 */
function lockedActivity(before: Report, after: Report): ActivityEntry[] | null {
  if (!same(before.flags, after.flags)) return null;
  const body = after.activity.map((e) => canonicalize(e));
  let i = 0;
  const merged: ActivityEntry[] = [];
  for (const e of before.activity) {
    const key = canonicalize(e);
    if (body[i] === key) {
      merged.push(e);
      i += 1;
    } else if (serverEntry(e)) {
      merged.push(e);
    } else {
      return null;
    }
  }
  return [...merged, ...after.activity.slice(i)];
}

/**
 * The boxes as the report factory makes them, for the box and clinician-box rules (harden-WC, check2-WC major A): from
 * the clinic's stored form map – only the very map the report was started from (report.form.mapSha256, which the
 * approval binds) – or, for a built-in report, the template of the same version. Empty when the store holds neither:
 * /validate and /sign then read the boxes from the attested map they are sent (core/validation/approver-decision.ts).
 * With them: the form map itself (the issue state's reading of which boxes a rule rules out, R1T-WC-05) and the template
 * and map the one-click engine checks a drafted paragraph's fixes with (R1T-WC-04).
 */
async function boxContextOf(t: TenantActor, report: Report): Promise<StoreCheckContext> {
  if (report.form?.formId) {
    if (!report.form.mapSha256) return {};
    const row = await t.store.getForm(t.tenantId, report.form.formId).catch(() => null);
    const parsed = row ? StoredFormDefinitionSchema.safeParse(row.payload) : null;
    if (!parsed?.success || !formMapMatches(parsed.data, report.form.mapSha256)) return {};
    const template = formToTemplate(parsed.data);
    return { fields: parsed.data.fields, boxes: template.sections, form: parsed.data, engineForm: parsed.data, template };
  }
  const template = getTemplate(report.templateId);
  return template && template.version === report.templateVersion ? { boxes: template.sections, template } : {};
}

/**
 * WC design 8: an approved amended version marks the version it amends as superseded – one activity entry naming
 * version 2 (ActivityEntry.reportId), appended once (idempotent); outside the content fingerprint, so version 1's
 * receipt still verifies. Best effort: a failure is logged and retried the next time version 2 is stored or loaded.
 */
async function markSuperseded(t: TenantActor, v2: Report): Promise<void> {
  if (v2.status !== "signed" || !v2.amends?.reportId || v2.amends.reportId === v2.id) return;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await t.store.getReport(t.tenantId, v2.amends.reportId);
      if (!row) return;
      const parsed = StoredReportSchema.safeParse(row.payload);
      if (!parsed.success) return;
      const v1 = parsed.data;
      if (isSupersededBy(v1, v2.id)) return;
      const updated: Report = { ...v1, activity: [...v1.activity, supersededEntry(v2)] };
      const res = await t.store.updateReport(t.tenantId, { id: v1.id, status: v1.status, templateId: v1.templateId, formId: v1.form?.formId ?? null, payload: updated }, row.rev);
      if (res.ok) {
        await auditStore(t, { action: "report.update", targetType: "report", targetId: v1.id, detail: { rev: res.rev, status: v1.status, supersededBy: v2.id } });
        return;
      }
      if (res.reason !== "conflict") return;
    }
  } catch {
    logEvent("store_supersede_failed", { id: v2.id });
  }
}

export const handleStoreReportGet: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const stored = await t.store.getReport(t.tenantId, id);
  if (!stored) return problem(404, "Report not found", { code: "NOT_FOUND", detail: "This report is not in the clinic's records." });
  const body: StoreReportResponse = { rev: stored.rev, updatedAt: stored.updatedAt, report: parseStoredReport(stored.payload, id) };
  // WC design 8: an approved version 2 makes sure version 1 reads as superseded (idempotent retry).
  if (body.report.status === "signed" && body.report.amends) await markSuperseded(t, body.report);
  return jsonWithRev(body, stored.rev);
};

export const handleStoreReportPut: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const ifMatch = readIfMatch(req);
  const parsed = await parseBody(req, StoreReportPutRequestSchema, { maxBytes: STORE_MAX_PUT_BYTES });
  if (!parsed.ok) return parsed.response;
  if (parsed.data.report.id !== id) {
    return problem(422, "Report id does not match the path", { code: "VALIDATION_FAILED", issues: [{ path: "report.id", message: "Must equal the id in the path." }] });
  }
  // The clinic is the signed-in member's – a stored report can never be filed under another clinic. A body that
  // names another clinic is refused (a change made for one clinic is never re-filed under another); a case
  // imported from the public demo (tenant "demo") becomes the clinic's own.
  if (parsed.data.report.tenantId !== DEMO_TENANT_ID) assertActorTenant(t.actor, parsed.data.report.tenantId, "report");
  const report: Report = parsed.data.report.tenantId === t.tenantId ? parsed.data.report : { ...parsed.data.report, tenantId: t.tenantId };
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > STORE_MAX_RECORD_BYTES) {
    return problem(413, "This report is too large to store", { code: "PAYLOAD_TOO_LARGE" });
  }
  const refused = await checkReceipt(report, t.tenantId);
  if (refused) return refused;

  let before: StoredReportMeta | null = null;
  let stored: Report | null = null;
  if (ifMatch !== null) {
    before = await t.store.getReportMeta(t.tenantId, id);
    if (before && before.status === "signed" && report.status !== "signed") {
      return problem(409, "This report has been approved", {
        code: "REPORT_LOCKED",
        detail: "An approved report cannot be changed. Start an amendment to correct it.",
      });
    }
    // The stored revision this PUT changes (a revision other than If-Match is answered 409 by the update below).
    if (before && before.rev === ifMatch) {
      const full = await t.store.getReport(t.tenantId, id);
      if (full && full.rev === ifMatch) stored = parseStoredReport(full.payload, id);
    }
  }

  // A create over a report the clinic already holds is never stored: the stored copy is returned at once (409), before
  // the change is checked as the member's – so a tab that missed the earlier create reloads it, whatever it holds.
  if (ifMatch === null && (await t.store.getReportMeta(t.tenantId, id))) {
    return conflict(await currentCopy(t.store, t.tenantId, id), "The clinic already holds this report. The stored copy was loaded.");
  }
  // bh2 WC design 2: every new or changed decision is the signed-in member's own, and approver-only ones the approver's –
  // an update against the stored revision; a create against the approved version it amends, else everything it holds.
  const member = storeMemberOf(t.actor);
  let checked: Report = report;
  let base: Report | null = stored;
  const demoImport = ifMatch === null && parsed.data.report.tenantId === DEMO_TENANT_ID && t.tenantId !== DEMO_TENANT_ID;
  const checkCtx = ifMatch === null || stored ? await boxContextOf(t, report) : {};
  if (ifMatch === null) {
    base = await amendedBase(t, report);
    if (demoImport) checked = importedFromDemo(report, member, checkCtx);
  }
  const violations = ifMatch === null || stored ? decisionViolations(base, checked, member, checkCtx, { create: ifMatch === null, demoAuthors: demoImport }) : [];
  if (violations.length === 1 && violations[0] === FIX_CHECK_TOO_LARGE) {
    // R2-SEC-2: the one-click fixes this save claims would be checked by the validators, over their budget (as /validate).
    logEvent("store_fix_check_refused", { id });
    return problem(413, "The report is too large to check", {
      code: "PAYLOAD_TOO_LARGE",
      detail: "This change claims one-click fixes, which are checked on the whole report, and the report holds more than any report ClinForms checks. Nothing was saved.",
    });
  }
  if (violations.length > 0) {
    logEvent("store_decision_refused", { id, count: violations.length, first: violations[0], codes: violations.slice(0, 8).join(",") });
    return problem(403, "This change cannot be saved as yours", {
      code: "DECISION_NOT_ALLOWED",
      // An update is refused whole and the Studio loads the stored copy (ui/store/server-api.ts DECISION_REFUSED_CODES).
      detail: `It records a decision as someone else, or a decision only the approving clinician can make, or it changes what the report is.${ifMatch === null ? "" : " The clinic's stored copy was loaded."}`,
    });
  }
  let toStore: Report = checked;
  if (stored && stored.status === "signed") {
    const activity = lockedActivity(stored, report);
    if (!activity) {
      return problem(403, "This report has been approved", {
        code: "REPORT_LOCKED",
        detail: "An approved report's checks and activity log cannot be rewritten. Start an amendment to correct it.",
      });
    }
    toStore = activity.length === report.activity.length ? report : { ...report, activity };
  }

  const row = { id, status: toStore.status, templateId: toStore.templateId, formId: toStore.form?.formId ?? null, payload: toStore };
  // The clinic's daily new-data allowance counts a new report in full and (fix wave 3) the growth of an update – a
  // record created small and saved again at full size is counted too.
  const bytes = new TextEncoder().encode(JSON.stringify(toStore)).byteLength;
  // 10/2026: a clinic whose trial has ended keeps (and may still change) what it has, but creates nothing new.
  if (ifMatch === null) await assertClinicMayCreate(t.actor, deps, "report");
  if (ifMatch === null) await takeNewData(deps, t, bytes);
  else if (before?.storedBytes !== undefined && bytes - before.storedBytes > 1024) await takeNewData(deps, t, bytes - before.storedBytes);
  const result = ifMatch === null ? await t.store.createReport(t.tenantId, row) : await t.store.updateReport(t.tenantId, row, ifMatch);
  if (!result.ok) {
    switch (result.reason) {
      case "exists":
        return conflict(await currentCopy(t.store, t.tenantId, id), "The clinic already holds this report. The stored copy was loaded.");
      case "conflict":
        return conflict(await currentCopy(t.store, t.tenantId, id), "Someone saved this report after you opened it. The stored copy was loaded.");
      case "not_found":
        return problem(404, "Report not found", { code: "NOT_FOUND", detail: "This report was deleted." });
      case "invalid":
        return problem(422, "The report could not be stored", { code: "VALIDATION_FAILED", detail: result.message });
    }
  }
  const created = ifMatch === null;
  await auditStore(t, {
    action: created ? "report.create" : report.status === "signed" && before?.status !== "signed" ? "report.store_signed" : "report.update",
    targetType: "report",
    targetId: id,
    detail: { rev: result.rev, status: report.status, version: report.version ?? 1 },
  });
  if (created) {
    await recordUsage(deps, t.actor, {
      kind: "report_started",
      reportId: id,
      ...(report.amends ? { amendsReportId: report.amends.reportId } : {}),
      episodeFp: usageEpisodeFp(t.tenantId, usageEpisodeOfReport(report)),
    });
  }
  // WC design 8: storing the approved version 2 supersedes version 1 on the server (never a second client write).
  if (toStore.status === "signed" && toStore.amends) await markSuperseded(t, toStore);
  const body: StoreReportResponse = { rev: result.rev, updatedAt: result.updatedAt, report: toStore };
  return jsonWithRev(body, result.rev, { status: created ? 201 : 200 });
};

export const handleStoreReportDelete: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const ifMatch = readIfMatch(req);
  const before = await t.store.getReportMeta(t.tenantId, id);
  if (before && ifMatch !== null && before.rev !== ifMatch) {
    return conflict(await currentCopy(t.store, t.tenantId, id), "Someone saved this report after you opened it. The stored copy was loaded.");
  }
  if (before && before.status === "signed" && MANAGE_ROLES.indexOf(t.actor.role) < 0) {
    return problem(409, WORDING.server.access.approvedLockedTitle, { code: "REPORT_LOCKED", detail: WORDING.server.access.approvedDeleteDetail });
  }
  const deleted = before ? await t.store.deleteReport(t.tenantId, id) : false;
  if (deleted) {
    await auditStore(t, { action: "report.delete", targetType: "report", targetId: id, detail: { rev: before?.rev ?? null, status: before?.status ?? null } });
  }
  return json({ deleted });
};
