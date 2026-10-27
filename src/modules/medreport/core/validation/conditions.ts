/**
 * Boxes that issue nothing (bh2 WA1 design 5), for runValidators (run.ts):
 *
 * - A box's content checks are dropped only when its issue state (core/issue-state.ts) is "not applicable" – a frozen
 *   condition rules it out, a person decided so, or a session the patient did not attend: nothing of it is printed.
 *   With the approver's "applies anyway" the box is an ordinary box and every check runs (R-safety-2).
 * - Kept on such a box: its open gaps (settled as not applicable by the review), this file's own warning, and a
 *   mail-merge code the issued form would still hold – merge-fields.ts raises one only when no box clears it, and a
 *   ruled-out box clears its own code (R-safety-8, R-security-4). (Only a frozen condition rules a box out since bh2 fix
 *   round 1 – R1T-WA1-01 – so the earlier run-time reading's own rule for MISSING_PLACEHOLDER is gone with it.)
 * - NOT_APPLICABLE_ANSWERED (warning, cannot be acknowledged): a person wrote or chose an answer in a box that does not
 *   apply, so it will not be printed (B1-1: never dropped without a word). It goes when the answer is removed, when the
 *   answer it depends on is corrected, or when the approver decides the box applies after all ("applies anyway", hashed
 *   and audited) with the card's control APPLIES_ANYWAY_ACTION (WC, R1T-WC-12). Its words name only those three
 *   remedies (R1T-WA1-05: no remedy the screens do not offer – validation/remedies.test.ts).
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

/** A mail-merge code left on the form (merge-fields.ts: raised only while the issued form would hold it). */
function isCodeLeftOnTheForm(f: ReportFlag): boolean {
  return f.code === "MISSING_PLACEHOLDER" && !f.paragraphId && (f.evidence ?? "").startsWith("mail-merge field ");
}

/** Whether a flag on a box that issues nothing still counts. */
function keptOnABoxNotAsked(f: ReportFlag): boolean {
  if (f.code === "OPEN_GAP" || f.code === "NOT_APPLICABLE_ANSWERED") return true;
  return f.code === "MISSING_PLACEHOLDER" && isCodeLeftOnTheForm(f);
}

/** The flags of `flags` that count, given what each box issues (the drop is the ledger's "not-applicable-drop"). */
export function withoutChecksOfBoxesNotAsked(flags: readonly ReportFlag[], boxes: readonly BoxIssue[]): ReportFlag[] {
  if (!hookEnabled(NOT_APPLICABLE_DROP_HOOK)) return [...flags];
  const notAsked = new Map(boxes.filter((b) => b.state.kind === "not_applicable").map((b) => [b.key, b]));
  if (notAsked.size === 0) return [...flags];
  return flags.filter((f) => {
    const box = f.sectionKey ? notAsked.get(f.sectionKey) : undefined;
    return !box || keptOnABoxNotAsked(f);
  });
}

/**
 * The approving clinician's control on a not-applicable box's card that makes it apply after all (WC, R1T-WC-12:
 * setDisposition applies_anyway) – the words NOT_APPLICABLE_ANSWERED's remedy names. The control must carry exactly these
 * words (validation/remedies.test.ts checks it once a review component offers the decision).
 */
export const APPLIES_ANYWAY_ACTION = "This applies – print my answer";

/**
 * One NOT_APPLICABLE_ANSWERED warning per box that holds a person's answer but issues nothing. Its remedies (R1T-WA1-05):
 * remove the answer; correct the answer the box depends on, if that is what is wrong (a condition's reason only); or –
 * the approving clinician – choose APPLIES_ANYWAY_ACTION on the card. A person's own "not applicable" names who decided.
 */
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
        message: notApplicableAnsweredMessage(titleOf(box.key), why, box.state.reason === "condition"),
      }),
      ackPolicy: "never",
    });
  }
  return out;
}

/** NOT_APPLICABLE_ANSWERED's words: what does not apply and why, then only the remedies the review offers. */
export function notApplicableAnsweredMessage(title: string, why: string, byCondition: boolean): string {
  const correct = byCondition ? " or correct the answer it depends on if that is wrong" : "";
  return `“${title}” does not apply${why}, so the answer entered here will not be printed on the form. Remove it${correct}. If the question applies all the same, the approving clinician can choose “${APPLIES_ANYWAY_ACTION}” on its card, and every check then runs on it.`;
}
