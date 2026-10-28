/**
 * Review workspace model (pure, no React): how the review screen groups and labels questions, derives
 * each question's status, summarises how the report was drafted, and applies the clinician's edits.
 *
 * Every edit is immutable and bumps `updatedAt`. The validators (core/validation) re-run on the result
 * in the screen; nothing here decides whether a report can be approved.
 *
 * W0.4 module split (bh2): this file only re-exports, so every existing import keeps working. The code lives in
 *   status.ts      questions, groups and each question's status   (owner WA1)
 *   labels.ts      generation badge, origin and citation labels, answer options, blocking lines   (WC)
 *   reducer.ts     the edits (paragraphs, structured answers, consent, approval, amendments)   (WC)
 *   provenance.ts  who answered a question   (WC)
 *   gaps.ts        gaps and acknowledgements   (WC)
 *   fixes.ts       one-click fixes (own voice, name the clinician, "not recorded" sentences)   (WD)
 * Owners per docs/bh2-ownership.json; this barrel is the integrator's. New code imports from the file itself.
 */
// bh2-base2 (W0 follow-up): whole-module re-exports, so a workstream adds, renames or removes an export in its own file
// without editing this barrel (WC design 7 removes provenance helpers this barrel used to name one by one).
export * from "./status";
export * from "./labels";
export * from "./reducer";
export * from "./provenance";
export * from "./gaps";
export * from "./fixes";
