/**
 * Validators: the same pure code runs after drafting, after every edit (browser), at POST /validate,
 * at POST /sign and at POST /render.
 *
 *   validateReport(report, template)          → { flags, canSign, blocking }   (computes the facts)
 *   runValidators({report, bundle, template, computedFacts}) → ReportFlag[]
 *   canSign(flags, gaps)                       → { ok, blocking }
 *   canAcknowledge(flag, report)               → whether the UI may offer "Acknowledge with a reason"
 *
 * Codes: UNKNOWN_SOURCE_ID, UNCITED_PARAGRAPH (citations.ts), FIGURE_NOT_IN_SOURCE (figures.ts, and
 * form-answers.ts for drafted date/number answers on a referrer's form), TERM_NOT_IN_SOURCE (terms.ts),
 * OPINION_LANGUAGE (opinion-language.ts), OTHER_CLINICIAN_VOICE (voice.ts: another clinician's note in the signer's
 * first person – fix round 1), DRAFT_FIT (draft-fit.ts: warnings – drafted wording that does not fit its place on the
 * form, fix round 1), NOT_APPLICABLE_ANSWERED (conditions.ts: a person's answer in a box that does not apply – fix
 * round 2), SCOPE_TERM (scope-terms.ts), OPEN_GAP (gaps.ts),
 * MISSING_PLACEHOLDER (placeholders.ts; merge-fields.ts for mail-merge fields left in an answer or on the
 * referrer's form – 10/2026, pass `form` to validateReport; choice-marks.ts for a marked cell or a kept printed option
 * that matches no printed option – 10/2026), DATA_CHECK (data-checks.ts, by the integration agent).
 *
 * Known limit, stated openly: a paraphrase error that cites a valid note is not caught (terms.ts catches
 * one kind: a corrupted glossary term such as "whale-associated disorder" for WAD). Click-to-source
 * review and the signer's attestation cover the rest.
 *
 * Owner: ai agent (runValidators). `canSign` keeps the foundation's signature.
 */
import { computeFacts } from "../computed-facts";
import { notApplicable, withReportConditions } from "../conditions";
import { todayIso } from "../dates";
import type {
  ComputedFact,
  DataCheck,
  EpisodeBundle,
  FormDefinition,
  Gap,
  Report,
  ReportFlag,
  ReportFlagCode,
  ReportTemplate,
} from "../types";
import { validateCitations } from "./citations";
import { dedupeFlags, makeFlag } from "./context";
import { runDataChecks } from "./data-checks";
import { validateFigures } from "./figures";
import { validateFormAnswers } from "./form-answers";
import { validateChoiceMarks } from "./choice-marks";
import { validateGaps } from "./gaps";
import { validateMergeFields } from "./merge-fields";
import { validateOpinionLanguage } from "./opinion-language";
import { validatePlaceholders } from "./placeholders";
import { validateScopeTerms } from "./scope-terms";
import { validateTerms } from "./terms";
import { validateClinicianVoice } from "./voice";
import { validateDraftFit } from "./draft-fit";
import { validateConditions } from "./conditions";

export interface ValidatorInput {
  report: Report;
  /** Normally `report.bundleSnapshot` (unscoped). */
  bundle: EpisodeBundle;
  template: ReportTemplate;
  computedFacts: ComputedFact[];
  /** The referrer's form map of a form report (10/2026: its recorded mail-merge fields are checked). */
  form?: Pick<FormDefinition, "analysis" | "fields">;
}

/** A single validator. Each validator file in this folder exports one. */
export type Validator = (input: ValidatorInput) => ReportFlag[];

export interface CanSignResult {
  ok: boolean;
  /** Blocking items that still prevent signing (unacknowledged blocking flags + unresolved gaps). */
  blocking: ReportFlag[];
}

/** The validators in the order their flags are listed. */
export const VALIDATORS: ReadonlyArray<{ name: string; run: Validator }> = [
  { name: "citations", run: validateCitations },
  { name: "figures", run: validateFigures },
  { name: "form-answers", run: validateFormAnswers },
  { name: "choice-marks", run: validateChoiceMarks },
  { name: "terms", run: validateTerms },
  { name: "opinion-language", run: validateOpinionLanguage },
  { name: "voice", run: validateClinicianVoice },
  { name: "scope-terms", run: validateScopeTerms },
  { name: "placeholders", run: validatePlaceholders },
  { name: "merge-fields", run: validateMergeFields },
  { name: "gaps", run: validateGaps },
  { name: "draft-fit", run: validateDraftFit },
  { name: "conditions", run: validateConditions },
];

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
  NOT_APPLICABLE_ANSWERED: 11,
};

/* ------------------------------------------------------------------------------------------------
 * Acknowledgement rules
 * ----------------------------------------------------------------------------------------------*/

/**
 * Whether a flag may be cleared by acknowledging it with a reason:
 * - warnings: yes;
 * - FIGURE_NOT_IN_SOURCE (dates): yes – the signer confirms the date from their own knowledge;
 * - TERM_NOT_IN_SOURCE: yes – the signer confirms the wording is right;
 * - DRAFT_FIT (a repeated numbered row blocks – fix round 2): yes – the signer confirms both rows are right;
 * - NOT_APPLICABLE_ANSWERED: on a person's answer, yes – the signer wants it printed although the box does not apply;
 *   on a drafted answer whose supporting text says its condition does not hold, no;
 * - OPINION_LANGUAGE and OTHER_CLINICIAN_VOICE: only on "edited" text (the clinician's own words); never on AI text –
 *   except (fix round 3, B2-3) a paragraph that names the clinician whose note it cites and says "I" or "my" without an
 *   opinion (evidence "named …"): the signer's own account beside a colleague's ("while covering my annual leave");
 * - UNCITED_PARAGRAPH, SCOPE_TERM, MISSING_PLACEHOLDER, blocking DATA_CHECK: no – fix the text or the record;
 * - OPEN_GAP: no – resolve or acknowledge the gap itself.
 */
export function canAcknowledge(flag: ReportFlag, report?: Pick<Report, "sections">): boolean {
  if (flag.severity === "warning") return true;
  switch (flag.code) {
    case "FIGURE_NOT_IN_SOURCE":
    case "TERM_NOT_IN_SOURCE":
    // A numbered row repeating an earlier one (fix round 2, B1-4): the clinician may keep both with a reason.
    case "DRAFT_FIT":
      return true;
    case "NOT_APPLICABLE_ANSWERED":
      // A person's answer in a box that does not apply – not a drafted answer whose own text says it does not hold.
      return flag.evidence === "not applicable";
    case "OPINION_LANGUAGE":
    case "OTHER_CLINICIAN_VOICE": {
      if (flag.code === "OTHER_CLINICIAN_VOICE" && /^named /.test(flag.evidence ?? "")) return true;
      if (!report || !flag.paragraphId) return false;
      for (const s of report.sections) {
        const p = s.paragraphs.find((x) => x.id === flag.paragraphId);
        if (p) return p.origin === "edited";
      }
      return false;
    }
    default:
      return false;
  }
}

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
export function runValidators(given: ValidatorInput): ReportFlag[] {
  // Fix round 3 (B2-4): a report drafted before conditions were kept through drafting gets them from its form map.
  const withConditions = withReportConditions(given.report, given.form);
  const input = withConditions === given.report ? given : { ...given, report: withConditions };
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
  // Fix round 1 (B0-7): a conditional question that does not apply ("IF YES, PLEASE DETAIL" after a "No") is not asked:
  // nothing of it is printed, so none of its checks blocks (its gaps are settled as not applicable by the review). Fix
  // round 2 (B1-1): except the check that a person's own answer sits in it (validation/conditions.ts).
  const inapplicable = new Set((input.report.sections ?? []).filter((s) => notApplicable(input.report, s.key)).map((s) => s.key));
  if (inapplicable.size > 0) {
    const kept = (f: ReportFlag) => f.code === "OPEN_GAP" || f.code === "NOT_APPLICABLE_ANSWERED";
    for (let i = flags.length - 1; i >= 0; i--) if (flags[i].sectionKey && inapplicable.has(flags[i].sectionKey as string) && !kept(flags[i])) flags.splice(i, 1);
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
    // A flag that arrives acknowledged (edited OPINION_LANGUAGE with a paragraph ackReason) keeps it;
    // only the original timestamp is carried over.
    if (f.acknowledged) return prev ? { ...f, acknowledged: { reason: f.acknowledged.reason, at: prev.at } } : f;
    return prev && canAcknowledge(f, input.report) ? { ...f, acknowledged: prev } : f;
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
  opts: { computedFacts?: ComputedFact[]; form?: Pick<FormDefinition, "analysis" | "fields"> | null } = {},
): ValidateReportResult {
  const bundle = report.bundleSnapshot;
  const computedFacts = opts.computedFacts ?? computeFacts(bundle, { asOf: reportFactsDate(report) });
  const flags = runValidators({ report, bundle, template, computedFacts, ...(opts.form && { form: opts.form }) });
  const result = canSign(flags, report.gaps ?? []);
  return { flags, canSign: result.ok, ok: result.ok, blocking: result.blocking };
}
