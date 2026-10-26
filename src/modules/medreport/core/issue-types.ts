/**
 * What a box issues (W0.6 shared types, bh2): the types of WA1's one hashed answer to "what does this box issue"
 * (core/issue-state.ts issueState, not built yet). Every consumer – the forms fill, Copy answers, the question summary
 * PDF, review status, the counts, the approved summary – will read a BoxState instead of working it out again.
 *
 *   answer          the box prints this answer (text, a structured value or table rows), entered by `by`
 *   blank           the box prints nothing: left blank on purpose, no answer, or the record has nothing for it
 *   not_applicable  the box is not asked: a condition rules it out, a session the patient did not attend, or a person
 *   signoff         filled from the receipt at approval
 *   referrer_use    left for the referrer's own use (the map's leave_blank)
 *
 * Types only; pure; browser and server.
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
import type { Actor } from "./actor";
import type { FormAnswerRow } from "./types";

/** Why a box prints nothing. */
export type BlankReason = "left_blank" | "no_answer" | "record_empty";

/** Why a box is not asked. */
export type NotApplicableReason = "condition" | "session_not_attended" | "person";

export type BoxState =
  | { kind: "answer"; text: string; value?: string | boolean | null; rows?: FormAnswerRow[]; by: Actor | null }
  | { kind: "blank"; reason: BlankReason }
  | { kind: "not_applicable"; reason: NotApplicableReason }
  | { kind: "signoff" }
  | { kind: "referrer_use" };

export type BoxStateKind = BoxState["kind"];

/** BoxState per form field id ("F-07"), for every field of the form. */
export type IssueState = Record<string, BoxState>;

/** What countOutcomes (WA1) reports – the counts add up to the number of fields. */
export interface IssueOutcomeCounts {
  answered: number;
  notApplicable: number;
  leftBlank: number;
  recordEmpty: number;
  noAnswer: number;
  referrerUse: number;
  signoff: number;
  total: number;
}

/** Keys of a report that never change what is issued (stripped at run time before issueState, WA1 design 1). */
export const ISSUE_EXCLUDED_KEYS = ["flags", "activity", "status", "updatedAt", "receipt"] as const;
export type IssueExcludedKey = (typeof ISSUE_EXCLUDED_KEYS)[number];

/* ------------------------------------------------------------------------------------------------
 * What the fill did (bh2 W0 follow-up, bh2-base2): WA2's forms engine reports one FillOutcome per field (WA2 design 1);
 * WA1's /sign dry run refuses on a fatal one (WA1 design 6) and the review card's "On the form" line shows them (the
 * fill preview's HEADERS.fillOutcomes, api/contract.ts). Defined here once so WA1 and WA2 build against the same type.
 * ----------------------------------------------------------------------------------------------*/

/**
 * What the fill did at a field's anchor:
 *   written     the answer was written in
 *   cleared     the printed placeholder, dots or merge code were removed (a blank or not-applicable box)
 *   removed     the printed lead or row was removed with it (a blank sentence-opener, a session not attended)
 *   as_printed  the anchor was left exactly as printed (nothing to write, nothing to clear)
 *   not_found   the anchor was not found in the file
 *   collision   another field wrote at the same place
 */
export const FILL_OUTCOME_KINDS = ["written", "cleared", "removed", "as_printed", "not_found", "collision"] as const;
export type FillOutcomeKind = (typeof FILL_OUTCOME_KINDS)[number];

export interface FillOutcome {
  /** The form field ("F-07"). */
  fieldId: string;
  /** What the box was meant to issue (issueState's kind for it; WA1). */
  intended: BoxStateKind;
  outcome: FillOutcomeKind;
  /** What is left at the anchor that should not be (a pre-printed mark, a ☒, a default, a merge code, dots) – plain words. */
  residue?: string[];
  /**
   * The engine's verdict (WA2 design 1): not_found, collision, as_printed on a decided box, a merge code, or residue on
   * a decided box. A FINAL copy – and the /sign dry run – is refused with any fatal outcome.
   */
  fatal: boolean;
  /** An informational note (an instruction removed with the answer, a mark-grid column that matched nothing). */
  note?: string;
}
