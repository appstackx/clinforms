/**
 * Boxes that issue nothing (bh2 WA1 design 5), for runValidators (run.ts):
 *
 * - A box's content checks are dropped only when its issue state (core/issue-state.ts) is "not applicable" – a frozen
 *   condition rules it out, a person decided so, or a session the patient did not attend: nothing of it is printed.
 *   With the approver's "applies anyway" the box is an ordinary box and every check runs (R-safety-2).
 * - Kept on such a box: its open gaps (settled as not applicable by the review), this file's own warning, and a
 *   mail-merge code the issued form would still hold – merge-fields.ts raises one only when no box clears it, and a
 *   ruled-out box clears its own code (R-safety-8, R-security-4). A box ruled out by the earlier run-time reading (a
 *   report from before this release) keeps the earlier rule: every MISSING_PLACEHOLDER but its own "no answer yet".
 * - NOT_APPLICABLE_ANSWERED (warning, cannot be acknowledged): a person wrote or chose an answer in a box that does not
 *   apply, so it will not be printed (B1-1: never dropped without a word). It goes when the answer is removed, or when
 *   the approver decides the box applies after all ("applies anyway", hashed and audited).
 *
 * Ledger seam (core/validation/hooks.ts): "not-applicable-drop" – with it disabled no check is dropped.
 *
 * Pure; browser and server. Owner: WA1 (issue state) – docs/bh2-ownership.json.
 */
import type { BoxIssue } from "../issue-state";
import type { ReportFlag } from "../types";
import { makeFlag } from "./context";
import { defineHook, hookEnabled } from "./hooks";

/** The ledger hook this file owns (__corpus__/ledger.json "not-applicable-drop"). */
export const NOT_APPLICABLE_DROP_HOOK = defineHook("not-applicable-drop");

/** placeholders.ts's "this box has no answer yet" flag. */
function isUnansweredBoxFlag(f: ReportFlag): boolean {
  return f.code === "MISSING_PLACEHOLDER" && !f.paragraphId && (f.evidence === "empty section" || f.evidence === "optional field blank");
}

/** A mail-merge code left on the form (merge-fields.ts: raised only while the issued form would hold it). */
function isCodeLeftOnTheForm(f: ReportFlag): boolean {
  return f.code === "MISSING_PLACEHOLDER" && !f.paragraphId && (f.evidence ?? "").startsWith("mail-merge field ");
}

/** Whether a flag on a box that issues nothing still counts. */
function keptOnABoxNotAsked(f: ReportFlag, box: BoxIssue): boolean {
  if (f.code === "OPEN_GAP" || f.code === "NOT_APPLICABLE_ANSWERED") return true;
  if (f.code !== "MISSING_PLACEHOLDER") return false;
  // The earlier run-time reading (a report from before this release): as it was checked then.
  if (box.state.kind === "not_applicable" && box.state.reason === "condition" && !box.frozenCondition) return !isUnansweredBoxFlag(f);
  return isCodeLeftOnTheForm(f);
}

/** The flags of `flags` that count, given what each box issues (the drop is the ledger's "not-applicable-drop"). */
export function withoutChecksOfBoxesNotAsked(flags: readonly ReportFlag[], boxes: readonly BoxIssue[]): ReportFlag[] {
  if (!hookEnabled(NOT_APPLICABLE_DROP_HOOK)) return [...flags];
  const notAsked = new Map(boxes.filter((b) => b.state.kind === "not_applicable").map((b) => [b.key, b]));
  if (notAsked.size === 0) return [...flags];
  return flags.filter((f) => {
    const box = f.sectionKey ? notAsked.get(f.sectionKey) : undefined;
    return !box || keptOnABoxNotAsked(f, box);
  });
}

/** One NOT_APPLICABLE_ANSWERED warning per box that holds a person's answer but issues nothing. */
export function notApplicableAnsweredFlags(boxes: readonly BoxIssue[], titleOf: (key: string) => string): ReportFlag[] {
  const out: ReportFlag[] = [];
  for (const box of boxes) {
    if (box.state.kind !== "not_applicable" || box.state.reason === "session_not_attended" || !box.personContent) continue;
    const why = box.state.reason === "condition" && box.condition?.because ? ` (${box.condition.because})` : "";
    out.push({
      ...makeFlag({
        code: "NOT_APPLICABLE_ANSWERED",
        severity: "warning",
        sectionKey: box.key,
        evidence: "not applicable",
        message: `“${titleOf(box.key)}” does not apply${why}, so the answer entered here will not be printed on the form. Remove it – or, if the question does apply, the approving clinician can say so, and every check then runs on it.`,
      }),
      ackPolicy: "never",
    });
  }
  return out;
}
