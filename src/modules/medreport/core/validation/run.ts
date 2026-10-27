/**
 * runValidators, canSign and validateReport: run every validator, order and de-duplicate the flags, carry
 * acknowledgements over, and decide whether the report can be signed.
 *
 * Pure; browser and server. Split out of core/validation/index.ts by W0.4 (bh2 module split, pure move; index.ts re-exports it).
 * Owner: WA1 (issue state) – docs/bh2-ownership.json.
 */
import { computeFacts } from "../computed-facts";
import { issueDetails } from "../issue-state";
import { todayIso } from "../dates";
import type { ComputedFact, DataCheck, FormDefinition, Gap, Report, ReportFlag, ReportFlagCode, ReportTemplate } from "../types";
import { ackPolicyOf, acknowledgementStands } from "./acknowledge";
import { notApplicableAnsweredFlags, withoutChecksOfBoxesNotAsked } from "./conditions";
import { dedupeFlags, makeFlag } from "./context";
import { runDataChecks } from "./data-checks";
import { VALIDATORS, type ValidatorInput } from "./registry";

export interface CanSignResult {
  ok: boolean;
  /** Blocking items that still prevent signing (unacknowledged blocking flags + unresolved gaps). */
  blocking: ReportFlag[];
}

const CODE_ORDER: Record<ReportFlagCode, number> = {
  UNCITED_PARAGRAPH: 0,
  UNKNOWN_SOURCE_ID: 1,
  FIGURE_NOT_IN_SOURCE: 2,
  TERM_NOT_IN_SOURCE: 3,
  OPINION_LANGUAGE: 4,
  OTHER_CLINICIAN_VOICE: 5,
  SCOPE_TERM: 6,
  MISSING_PLACEHOLDER: 7,
  OPEN_GAP: 8,
  DATA_CHECK: 9,
  DRAFT_FIT: 10,
  // bh2 W0 follow-up (bh2-base2): after the existing codes, so no existing order changes.
  NOT_APPLICABLE_ANSWERED: 11,
  APPROVER_DECISION: 12,
};

/* ------------------------------------------------------------------------------------------------
 * runValidators
 * ----------------------------------------------------------------------------------------------*/

function dataCheckFlags(checks: DataCheck[]): ReportFlag[] {
  return checks
    .filter((c) => c.severity !== "info")
    .map((c) =>
      makeFlag({
        code: "DATA_CHECK",
        severity: c.severity === "blocking" ? "blocking" : "warning",
        evidence: c.code,
        message: c.message,
      }),
    );
}

/**
 * Run every validator and return the full, fresh list of flags for the report.
 *
 * - Deterministic: same input → same flags, with STABLE IDs (code + section + paragraph/gap + evidence).
 *   Order: document order (section, paragraph), then code; report-level DATA_CHECK flags last.
 * - Carries acknowledgements over from `input.report.flags` (matched by flag ID) where
 *   canAcknowledge() allows it. On "edited" text an OPINION_LANGUAGE flag is also cleared by the
 *   paragraph's `ackReason`; on "ai" text it never is.
 * - One OPEN_GAP (blocking) flag per gap without a resolution, with `gapId` set.
 * - DATA_CHECK flags from the data checks (blocking → blocking, warning → warning, info dropped).
 * - Never throws on malformed content: a validator that fails yields a blocking DATA_CHECK flag.
 */
export function runValidators(input: ValidatorInput): ReportFlag[] {
  const flags: ReportFlag[] = [];
  for (const v of VALIDATORS) {
    try {
      flags.push(...v.run(input));
    } catch {
      flags.push(
        makeFlag({
          code: "DATA_CHECK",
          severity: "blocking",
          evidence: `validator ${v.name}`,
          message: `The automatic "${v.name}" check could not run on this report, so it cannot be signed. Reload the report or contact support.`,
        }),
      );
    }
  }
  // bh2 WA1 design 5 (fix round 1 B0-7, R-safety-2, R-safety-8): a box's content checks are dropped only when it issues
  // nothing – its issue state (core/issue-state.ts, from the report's hashed content alone) is "not applicable". A box
  // the approver says applies anyway is an ordinary box: every check runs. Kept on a box that issues nothing: its open
  // gaps, a mail-merge code the issued form would still hold, and the warning that a person's answer there will not be
  // printed (validation/conditions.ts).
  try {
    const boxes = issueDetails(input.report, input.form ?? null);
    const titles = new Map((input.report.sections ?? []).map((s) => [s.key, s.title]));
    flags.push(...notApplicableAnsweredFlags(boxes, (key) => titles.get(key) ?? key));
    const kept = withoutChecksOfBoxesNotAsked(flags, boxes);
    flags.length = 0;
    flags.push(...kept);
  } catch {
    // Malformed content: nothing is dropped, and the report cannot be signed until it reads.
    flags.push(
      makeFlag({
        code: "DATA_CHECK",
        severity: "blocking",
        evidence: "validator issue-state",
        message: 'The automatic "what each box issues" check could not run on this report, so it cannot be signed. Reload the report or contact support.',
      }),
    );
  }
  try {
    flags.push(...dataCheckFlags(runDataChecks(input.bundle)));
  } catch {
    flags.push(
      makeFlag({
        code: "DATA_CHECK",
        severity: "blocking",
        evidence: "validator data-checks",
        message: "The checks on the source record could not run, so the report cannot be signed. Reload the report.",
      }),
    );
  }

  // Document order, then code.
  const sectionIndex = new Map((input.report.sections ?? []).map((s, i) => [s.key, i]));
  const paragraphIndex = new Map<string, number>();
  for (const s of input.report.sections ?? []) (s.paragraphs ?? []).forEach((p, i) => paragraphIndex.set(p.id, i));
  const rank = (f: ReportFlag) => [
    f.sectionKey !== undefined ? (sectionIndex.get(f.sectionKey) ?? 9_999) : 10_000,
    f.paragraphId !== undefined ? (paragraphIndex.get(f.paragraphId) ?? 9_999) : 10_000,
    CODE_ORDER[f.code] ?? 99,
  ];
  const ordered = dedupeFlags(flags)
    .map((f, i) => ({ f, i, r: rank(f) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2] || a.i - b.i)
    .map(({ f }) => f);

  // Carry acknowledgements over by flag ID.
  const previous = new Map((input.report.flags ?? []).filter((f) => f.acknowledged).map((f) => [f.id, f.acknowledged]));
  return ordered.map((f) => {
    const prev = previous.get(f.id);
    if (f.acknowledged) {
      // bh2 WC (check-WC A1): a flag that arrives acknowledged (edited OPINION_LANGUAGE with the paragraph's ackReason)
      // keeps it only where the flag may be acknowledged at all – never on drafted text or drafted residue kept in the
      // paragraph, which one acknowledgement of the person's own sentence must not clear too.
      if (ackPolicyOf(f, input.report) === "never") {
        const open = { ...f };
        delete open.acknowledged;
        return open;
      }
      // Only the original timestamp is carried over.
      return prev ? { ...f, acknowledged: { reason: f.acknowledged.reason, at: prev.at, ...(prev.by ? { by: prev.by } : {}) } } : f;
    }
    // bh2 WC: an acknowledgement stands only where its own author (`by`, stamped by the review) may make it.
    return prev && acknowledgementStands(f, input.report, prev) ? { ...f, acknowledged: prev } : f;
  });
}

/* ------------------------------------------------------------------------------------------------
 * canSign
 * ----------------------------------------------------------------------------------------------*/

/**
 * Whether the report can be signed. Blocking = every blocking flag that is not acknowledged, plus an
 * OPEN_GAP flag for each unresolved gap that has no matching flag in `flags` already. An OPEN_GAP
 * flag whose gap has since been resolved or acknowledged no longer blocks.
 */
export function canSign(flags: ReportFlag[], gaps: Gap[]): CanSignResult {
  const gapById = new Map(gaps.map((g) => [g.id, g]));
  const blocking = flags.filter(
    (f) =>
      f.severity === "blocking" &&
      !f.acknowledged &&
      !(f.code === "OPEN_GAP" && f.gapId && gapById.get(f.gapId)?.resolution),
  );
  const flaggedGapIds = new Set(flags.filter((f) => f.code === "OPEN_GAP" && f.gapId).map((f) => f.gapId));
  for (const gap of gaps) {
    if (!gap.resolution && !flaggedGapIds.has(gap.id)) {
      blocking.push(
        makeFlag({
          code: "OPEN_GAP",
          severity: "blocking",
          sectionKey: gap.sectionKey,
          gapId: gap.id,
          message: `Open gap: ${gap.issue}`,
        }),
      );
    }
  }
  return { ok: blocking.length === 0, blocking };
}

/* ------------------------------------------------------------------------------------------------
 * Convenience for handlers and the Studio
 * ----------------------------------------------------------------------------------------------*/

/** The date facts are computed for: the report's creation date (Europe/London), so FACT-age is stable. */
export function reportFactsDate(report: Pick<Report, "createdAt">): string {
  const d = new Date(report.createdAt);
  return Number.isNaN(d.getTime()) ? todayIso() : todayIso(d);
}

/* ------------------------------------------------------------------------------------------------
 * The work one request may ask of the validators (bh2 fix round 1, R1T-WA1-03)
 * ----------------------------------------------------------------------------------------------*/

/**
 * The most a report sent to POST /validate, /sign or /render may hold – the integration half of SEC-1 and SAF-1 (defence
 * in depth behind the linear tokenizer and residue checks, WD / WC): the server refuses a body over it before any
 * validator runs (413), so no request can make the validators work on text no real report holds. It bounds the size of
 * the work, not its cost per character – that is the algorithms' (on bh2-rc1's validators adversarial repeated text at
 * these limits still takes seconds; bh2 fix round 1 report r1-fix-WA1.md). Sized well above the largest real
 * report: the 192 reports of the bh2 V1 harness and replay (17 forms × 3 sample patients, A and B runs) hold at most 72
 * sections, 44 paragraphs, 684 characters in one paragraph, 12,513 characters of paragraph text, 2 tombstones (1,169
 * bytes), 103 flags, 48 gaps, 5,647 characters of notes and 73,323 characters in all; the largest of Dell's 17 maps has 72
 * questions.
 */
export const VALIDATION_BUDGET = {
  /** Boxes in the report. */
  sections: 400,
  /** Paragraphs in all boxes together. */
  paragraphs: 1_000,
  /** Characters in one paragraph (its text, its original drafted text and its acknowledgement reason, each). */
  paragraphChars: 10_000,
  /** Characters of paragraph text in all boxes together (text, original text and reasons). */
  textChars: 100_000,
  /** Deleted drafted paragraphs kept for the residue check, in all boxes together. */
  tombstones: 100,
  /** Characters in one tombstone. */
  tombstoneChars: 10_000,
  /** Characters in all tombstones together. */
  tombstoneTextChars: 50_000,
  /** Flags and gaps the report carries. */
  flags: 2_000,
  gaps: 1_000,
  /** Characters of the clinical notes in the report's bundle. */
  noteChars: 300_000,
  /** Characters in every string of the report together (bundle, activity and all). */
  reportChars: 1_500_000,
  /** Questions of the form map sent with it, and the characters of all its strings together. */
  formFields: 1_000,
  formChars: 500_000,
} as const;

/** What a body holds beyond VALIDATION_BUDGET: the first limit exceeded (for the 413's message). */
export interface ValidationBudgetExcess {
  /** The budget key (VALIDATION_BUDGET). */
  what: keyof typeof VALIDATION_BUDGET;
  limit: number;
  actual: number;
}

/** Every string's length in a parsed JSON value, summed (iterative – any nesting depth), stopping once over `cap`. */
function stringChars(value: unknown, cap: number): number {
  let total = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && total <= cap) {
    const v = stack.pop();
    if (typeof v === "string") total += v.length;
    else if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) stack.push(x);
  }
  return total;
}

const lengthOf = (v: unknown) => (typeof v === "string" ? v.length : 0);
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * The first limit of VALIDATION_BUDGET that `report` (and the form map sent with it) exceeds, or null. Linear in the
 * size of the body; reads the parsed body only (no validator runs). Pure.
 */
export function validationBudgetExcess(report: unknown, form?: unknown): ValidationBudgetExcess | null {
  const B = VALIDATION_BUDGET;
  const over = (what: keyof typeof VALIDATION_BUDGET, actual: number): ValidationBudgetExcess | null => (actual > B[what] ? { what, limit: B[what], actual } : null);
  const r = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const sections = listOf(r.sections);
  let excess = over("sections", sections.length);
  if (excess) return excess;
  let paragraphs = 0;
  let text = 0;
  let tombstones = 0;
  let tombstoneText = 0;
  for (const raw of sections) {
    const section = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    for (const p of listOf(section.paragraphs)) {
      paragraphs += 1;
      const para = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      for (const key of ["text", "originalText", "ackReason"]) {
        const n = lengthOf(para[key]);
        if ((excess = over("paragraphChars", n))) return excess;
        text += n;
      }
    }
    for (const t of listOf(section.tombstones)) {
      tombstones += 1;
      const n = lengthOf((t && typeof t === "object" ? (t as Record<string, unknown>) : {}).text);
      if ((excess = over("tombstoneChars", n))) return excess;
      tombstoneText += n;
    }
    if ((excess = over("paragraphs", paragraphs) ?? over("textChars", text) ?? over("tombstones", tombstones) ?? over("tombstoneTextChars", tombstoneText))) return excess;
  }
  if ((excess = over("flags", listOf(r.flags).length) ?? over("gaps", listOf(r.gaps).length))) return excess;
  const bundle = (r.bundleSnapshot && typeof r.bundleSnapshot === "object" ? r.bundleSnapshot : {}) as Record<string, unknown>;
  if ((excess = over("noteChars", stringChars(bundle.notes, B.noteChars)))) return excess;
  if ((excess = over("reportChars", stringChars(report, B.reportChars)))) return excess;
  if (form && typeof form === "object") {
    if ((excess = over("formFields", listOf((form as Record<string, unknown>).fields).length))) return excess;
    if ((excess = over("formChars", stringChars(form, B.formChars)))) return excess;
  }
  return null;
}

export interface ValidateReportResult extends CanSignResult {
  flags: ReportFlag[];
  canSign: boolean;
}

/**
 * Validate a whole report against its own bundle snapshot: computes the facts (as of the report's
 * creation date), runs every validator and canSign. Used by POST /validate, /sign, /render and the Studio.
 */
export function validateReport(
  report: Report,
  template: ReportTemplate,
  opts: {
    computedFacts?: ComputedFact[];
    form?: Pick<FormDefinition, "analysis" | "fields"> | null;
    /** W0.6: the voice owner (ValidatorInput.voice; absent = report.author, as before). */
    voice?: ValidatorInput["voice"];
  } = {},
): ValidateReportResult {
  const bundle = report.bundleSnapshot;
  const computedFacts = opts.computedFacts ?? computeFacts(bundle, { asOf: reportFactsDate(report) });
  const flags = runValidators({ report, bundle, template, computedFacts, ...(opts.form && { form: opts.form }), ...(opts.voice && { voice: opts.voice }) });
  const result = canSign(flags, report.gaps ?? []);
  return { flags, canSign: result.ok, ok: result.ok, blocking: result.blocking };
}
