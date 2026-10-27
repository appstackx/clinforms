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
 * form, fix round 1), SCOPE_TERM (scope-terms.ts), OPEN_GAP (gaps.ts),
 * MISSING_PLACEHOLDER (placeholders.ts; merge-fields.ts for mail-merge fields left in an answer or on the
 * referrer's form – 10/2026, pass `form` to validateReport; choice-marks.ts for a marked cell or a kept printed option
 * that matches no printed option – 10/2026), DATA_CHECK (data-checks.ts, by the integration agent).
 *
 * Known limit, stated openly: a paraphrase error that cites a valid note is not caught (terms.ts catches
 * one kind: a corrupted glossary term such as "whale-associated disorder" for WAD). Click-to-source
 * review and the signer's attestation cover the rest.
 *
 * W0.4 module split (bh2): this file only re-exports, so every existing import keeps working. The code lives in
 *   registry.ts     ValidatorInput, Validator and VALIDATORS (the order flags are listed in)   (owner W0, shared)
 *   run.ts          runValidators, canSign, reportFactsDate, validateReport   (WA1)
 *   acknowledge.ts  canAcknowledge   (WC)
 * Owners per docs/bh2-ownership.json; this barrel is the integrator's.
 *
 * Owner: ai agent (runValidators). `canSign` keeps the foundation's signature.
 */
// bh2-base2 (W0 follow-up): whole-module re-exports, so a workstream changes its own file's exports without editing
// this barrel.
export * from "./registry";
export * from "./acknowledge";
export * from "./run";
