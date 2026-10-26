/**
 * Review workspace model – gaps and acknowledgements: what "Resolve" may claim, settling gaps by a person's answer or
 * by a condition, reopening, and acknowledging a flag with a reason.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import { conditionOf } from "../../../core/conditions";
import { nowIso } from "../../../core/dates";
import { isSectionAnswered } from "../../../core/forms";
import { appendActivity } from "../../../core/report-factory";
import type { Actor, Gap, Report, ReportSection } from "../../../core/types";
import { answeredByPerson } from "./provenance";

/* ------------------------------------------------------------------------------------------------
 * Gaps: what "Resolve" may claim
 * ----------------------------------------------------------------------------------------------*/

/** Minimum length of a typed resolution or reason (something a reader of the audit trail can use). */
export const MIN_GAP_REASON = 15;

/**
 * bh2 W0 follow-up (seam "bulk-leave-blank", bh2-base2): may `actor` leave `section` blank through "Leave optional boxes
 * blank"? box-items.ts (WA1's file) asks it for every box it offers and every box it acknowledges, so WC's rule – leaving
 * opinion boxes blank in bulk is the approver's, staff never settle a clinician box (WC design 4) – lives here only.
 * `actor` null: the caller names nobody. Stub: whoever may use the action today may – WC fills it in.
 */
export const mayLeaveBlankInBulk: (report: Pick<Report, "sections" | "approver">, section: ReportSection, actor: Actor | null) => boolean = () => true;

export interface GapResolutionOptions {
  /** "Resolve" is offered (otherwise only "Acknowledge with a reason"). */
  canResolve: boolean;
  /** Text the resolution form starts with ("" = the person types their own). */
  prefill: string;
  /** Minimum length of the typed text. */
  minLength: number;
  /** Why "Resolve" is not offered, or what resolving means here. */
  hint: string | null;
  /**
   * Fix round 1 (B0-3): "Acknowledge with a reason" is offered (default). Not on a required question with no answer yet:
   * acknowledging would not let the form be approved without its answer.
   */
  canAcknowledge?: boolean;
}

/** gapResolutionOptions() for a gap in a required question that has no answer yet: answer it first (fix round 1, B0-3). */
export function requiredAnswerFirst(options: GapResolutionOptions): GapResolutionOptions {
  return { ...options, canAcknowledge: false, hint: "This form requires an answer here: give it, then mark the gap resolved." };
}

/**
 * What resolving a gap may claim, so the audit trail never says something untrue:
 * - the question has an answer a PERSON wrote or set → "Resolve" pre-filled with that fact;
 * - an opinion question (prognosis, restrictions, recommendations, fitness for work) with only an AI
 *   draft or nothing → no "Resolve": the clinician writes their opinion first, or acknowledges the gap
 *   with a reason;
 * - any other gap → "Resolve" with the person's own words (at least MIN_GAP_REASON characters).
 */
export function gapResolutionOptions(report: Pick<Report, "sections" | "activity">, gap: Gap, actor: string): GapResolutionOptions {
  const section = report.sections.find((s) => s.key === gap.sectionKey);
  return resolutionOptionsFor({ own: answeredByPerson(report, gap.sectionKey), opinion: section?.kind === "clinician_opinion", gap, actor });
}

/** gapResolutionOptions() from what the question card already knows. */
export function resolutionOptionsFor(input: { own: boolean; opinion: boolean; gap: Gap; actor: string }): GapResolutionOptions {
  const { own, gap, actor } = input;
  if (own) {
    const prefill = gap.id.endsWith("-referrer")
      ? `Entered by ${actor} from the referrer's instruction letter.`
      : `Answered on the form by ${actor}.`;
    return { canResolve: true, prefill, minLength: 3, hint: null };
  }
  if (input.opinion) {
    return {
      canResolve: false,
      prefill: "",
      minLength: MIN_GAP_REASON,
      hint: "Only the clinician can answer this: write your opinion in the answer box (or choose an answer) to resolve it, or acknowledge it with a reason.",
    };
  }
  return { canResolve: true, prefill: "", minLength: MIN_GAP_REASON, hint: null };
}

/** Resolve or acknowledge a gap with the clinician's text. */
export function resolveGap(
  report: Report,
  gapId: string,
  kind: "resolved" | "acknowledged",
  text: string,
  actor: string,
  now?: Date,
): Report {
  const gap = report.gaps.find((g) => g.id === gapId);
  const clean = text.trim();
  if (!gap || !clean) return report;
  const at = nowIso(now);
  // Fix round 1 (B0-24): whether this acknowledgement left an empty box blank (a value entered later replaces it).
  const section = report.sections.find((s) => s.key === gap.sectionKey);
  const leftBlank = kind === "acknowledged" ? { leftBlank: !section || !isSectionAnswered(section) } : {};
  const gaps = report.gaps.map((g) => (g.id === gapId ? { ...g, resolution: { kind, text: clean, at, ...leftBlank } } : g));
  return appendActivity(
    { ...report, gaps, updatedAt: at },
    { actor, action: kind === "resolved" ? "gap_resolved" : "gap_acknowledged", detail: `${gap.sectionKey}: ${kind === "resolved" ? "resolved" : "acknowledged"} gap “${gap.issue}” – ${clean}` },
    now,
  );
}

/**
 * A value entered after its gap was acknowledged as "left blank" supersedes the acknowledgement: the gap
 * becomes resolved by the answer ("Answered on the form by …"), so the card no longer says "Left blank
 * for the office to add…" beside the value. Only gaps of `key` that were acknowledged (not resolved) while the box
 * was empty (fix round 1, B0-24: an acknowledgement of a gap in an answered box – "dose not recorded" beside a drafted
 * answer – keeps its own reason), and only when the section now holds a person's own answer.
 */
export function supersedeAcknowledgedGaps(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return report;
  const personAnswered =
    section.paragraphs.some((p) => (p.origin === "clinician" || p.origin === "edited") && p.text.trim() !== "") ||
    (section.answer !== undefined && section.answer.kind !== "text" && section.answer.value !== null && section.answer.value !== "");
  if (!personAnswered) return report;
  const stale = report.gaps.filter((g) => g.sectionKey === key && g.resolution?.kind === "acknowledged" && g.resolution.leftBlank !== false);
  if (stale.length === 0) return report;
  const at = nowIso(now);
  const text = `Answered on the form by ${actor} (replaces “${(stale[0].resolution?.text ?? "").replace(/[.\s]+$/, "")}”).`;
  const gaps = report.gaps.map((g) => (stale.indexOf(g) >= 0 ? { ...g, resolution: { kind: "resolved" as const, text, at } } : g));
  return appendActivity({ ...report, gaps, updatedAt: at }, { actor, action: "gap_resolved", detail: `${key}: a value was entered, so the earlier “left blank” acknowledgement no longer applies.` }, now);
}

/**
 * Safety amendment (NEW-1 stop-gap): a gap only a clinician settles – any gap of an opinion box (section kind
 * "clinician_opinion"), or of the physiotherapist's choice on each report (core/report-factory.ts "-physio" gap).
 */
export function isClinicianGap(report: Pick<Report, "sections">, gap: Pick<Gap, "id" | "sectionKey">): boolean {
  if (gap.id.endsWith("-physio")) return true;
  return report.sections.find((s) => s.key === gap.sectionKey)?.kind === "clinician_opinion";
}

/**
 * Fix round 1 (B0-8): a person's answer settles its own box's gaps in the same step. When `key` goes from no answer to
 * a person's answer, each of its open gaps is resolved ("Answered on the form by Sarah Reid.", one activity entry
 * each – exactly what "Mark resolved" records); when that answer is removed again, the gaps resolved that way are
 * reopened. Drafting never resolves a gap this way, and a box that already had an answer keeps its gaps for the
 * person to check (a typo fixed is not the gap answered). canSign() is unchanged.
 *
 * Safety amendment (NEW-1 stop-gap, release/bh-trial-2): when the actor is staff (`opts.actorIsStaff`), a clinician gap
 * (isClinicianGap) is never settled this way – staff typing or ticking an opinion box leaves its gap open for the
 * clinician to resolve. Workstream WC replaces this with the approver rule.
 */
export function settleGapsByAnswer(before: Report, after: Report, key: string, actor: string, now?: Date, opts: { actorIsStaff?: boolean } = {}): Report {
  const was = before.sections.find((s) => s.key === key);
  const is = after.sections.find((s) => s.key === key);
  if (!was || !is || !actor.trim()) return after;
  const answeredBefore = isSectionAnswered(was);
  const answeredNow = isSectionAnswered(is);
  if (!answeredBefore && answeredNow && answeredByPerson(after, key)) {
    // Safety amendment (NEW-1 stop-gap): staff answering never settles a clinician gap (isClinicianGap).
    const open = after.gaps.filter((g) => g.sectionKey === key && !g.resolution && !(opts.actorIsStaff && isClinicianGap(after, g)));
    if (open.length === 0) return after;
    const at = nowIso(now);
    let next: Report = after;
    for (const gap of open) {
      const text = resolutionOptionsFor({ own: true, opinion: is.kind === "clinician_opinion", gap, actor }).prefill;
      next = {
        ...next,
        gaps: next.gaps.map((g) => (g.id === gap.id ? { ...g, resolution: { kind: "resolved" as const, text, at, byAnswer: true } } : g)),
        updatedAt: at,
      };
      next = appendActivity(next, { actor, action: "gap_resolved", detail: `${key}: resolved gap “${gap.issue}” – ${text}` }, now);
    }
    return next;
  }
  if (answeredBefore && !answeredNow) {
    const settled = after.gaps.filter((g) => g.sectionKey === key && g.resolution?.byAnswer);
    if (settled.length === 0) return after;
    const gaps = after.gaps.map((g) => {
      if (settled.indexOf(g) < 0) return g;
      const open = { ...g };
      delete open.resolution;
      return open;
    });
    return appendActivity({ ...after, gaps }, { actor, action: "edited", detail: `${key}: the answer was removed, so ${settled.length === 1 ? "its gap is" : `its ${settled.length} gaps are`} open again.` }, now);
  }
  return after;
}

/**
 * Fix round 1 (B0-7): a conditional question that does not apply ("IF YES, PLEASE DETAIL" after a "No") has its open
 * gaps settled – "Not applicable: “ANY FURTHER TREATMENT RECOMMENDED?” is “NO”." (one activity entry each); when the
 * answer before it changes so that it applies again, the gaps settled that way are reopened. Returns `report` itself when
 * nothing changes.
 */
export function settleConditionalGaps(report: Report, actor: string, now?: Date): Report {
  let next = report;
  const at = nowIso(now);
  for (const section of report.sections) {
    const own = next.gaps.filter((g) => g.sectionKey === section.key);
    if (own.length === 0) continue;
    const condition = conditionOf(next.sections, section.key);
    if (condition?.applies === false) {
      const open = own.filter((g) => !g.resolution);
      if (open.length === 0) continue;
      const text = `Not applicable: ${condition.because}.`;
      next = { ...next, gaps: next.gaps.map((g) => (open.indexOf(g) >= 0 ? { ...g, resolution: { kind: "resolved" as const, text, at, notApplicable: true } } : g)), updatedAt: at };
      for (const g of open) next = appendActivity(next, { actor, action: "gap_resolved", detail: `${section.key}: resolved gap “${g.issue}” – ${text}` }, now);
    } else {
      const settled = own.filter((g) => g.resolution?.notApplicable);
      if (settled.length === 0) continue;
      next = {
        ...next,
        gaps: next.gaps.map((g) => {
          if (settled.indexOf(g) < 0) return g;
          const reopened = { ...g };
          delete reopened.resolution;
          return reopened;
        }),
        updatedAt: at,
      };
      next = appendActivity(next, { actor, action: "edited", detail: `${section.key}: applies again, so its gap${settled.length === 1 ? " is" : "s are"} open again.` }, now);
    }
  }
  return next;
}

/** Undo a gap's resolution. */
export function reopenGap(report: Report, gapId: string, actor: string, now?: Date): Report {
  const gap = report.gaps.find((g) => g.id === gapId);
  if (!gap?.resolution) return report;
  const at = nowIso(now);
  const gaps = report.gaps.map((g) => {
    if (g.id !== gapId) return g;
    const next = { ...g };
    delete next.resolution;
    return next;
  });
  return appendActivity({ ...report, gaps, updatedAt: at }, { actor, action: "edited", detail: `${gap.sectionKey}: reopened gap “${gap.issue}”.` }, now);
}

/**
 * Acknowledge a flag with a reason. On an OPINION_LANGUAGE flag the reason is also stored on the
 * paragraph (`ackReason`), so it travels with the signed content.
 */
export function acknowledgeFlag(report: Report, flagId: string, reason: string, actor: string, now?: Date): Report {
  const flag = report.flags.find((f) => f.id === flagId);
  const clean = reason.trim();
  if (!flag || !clean) return report;
  const at = nowIso(now);
  const flags = report.flags.map((f) => (f.id === flagId ? { ...f, acknowledged: { reason: clean, at } } : f));
  let sections = report.sections;
  if (flag.code === "OPINION_LANGUAGE" && flag.paragraphId) {
    sections = report.sections.map((s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => (p.id === flag.paragraphId && p.origin === "edited" ? { ...p, ackReason: clean } : p)),
    }));
  }
  return appendActivity(
    { ...report, flags, sections, updatedAt: at },
    { actor, action: "flag_acknowledged", detail: `${flag.sectionKey ? `${flag.sectionKey}: ` : ""}acknowledged the check: ${flag.message.trim().replace(/[.\s]+$/, "")}. Reason: ${clean}` },
    now,
  );
}
