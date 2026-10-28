/**
 * The report activity actions this release adds (bh2 W0 follow-up, bh2-base2 – seam "activity-actions"): named once
 * here, so the workstream that writes an entry (WC's review actions and store, WA1's dispositions, WD's one-click fixes
 * and held-back text) and the one that labels it (WF: ui/components/review/activity-panel.tsx, "no raw codes") use the
 * same code, and core/report-factory.ts KNOWN_ACTIVITY_ACTIONS lists them without anyone editing that file again.
 *
 *   adopted              the approver adopted what someone else entered in a clinician box (WC design 5)
 *   disposition_set      a person marked a box not applicable, applies anyway or left blank (WA1 design 2, WC design 4)
 *   disposition_cleared  that decision was cancelled (an answer, or the controlling answer changed – WA1 design 2)
 *   approver_taken_over  "Take over as approver" (WC design 1)
 *   note_words_accepted  the approver's "Accept as the note's words" for one drafted phrase (WB design 5, WC design 4)
 *   own_words            the approver's "These are my own words" (WC design 6)
 *   fix_applied          a one-click fix applied to drafted text (WD design 6; Paragraph.fixes)
 *   held_back            drafted text held back for a person to check (WD design 3: "Drafted text held back – check it")
 *
 * ActivityEntry.action stays an open string (core/schemas.ts); these are codes, never shown as they are. Version 1's
 * "superseded" entry (WC design 8) uses the existing "superseded" action, with ActivityEntry.reportId naming version 2.
 *
 * Pure; browser and server. Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
export const RELEASE_ACTIVITY_ACTIONS = [
  "adopted",
  "disposition_set",
  "disposition_cleared",
  "approver_taken_over",
  "note_words_accepted",
  "own_words",
  "fix_applied",
  "held_back",
] as const;

export type ReleaseActivityAction = (typeof RELEASE_ACTIVITY_ACTIONS)[number];
