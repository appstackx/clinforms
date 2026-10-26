/**
 * The validator registry: the input every validator gets, and the validators in the order their flags are listed.
 * runValidators (run.ts) runs them; each validator file in this folder exports one. W0.6 registers empty stubs for WB's
 * new checks (attribution-*.ts) and adds the explicit voice owner (ValidatorInput.voice; context.ts voiceOwnerOf).
 *
 * Also the safety corpus ledger's test seam (hooks.ts, re-exported here as the corpus README's contract names it):
 * HOOK_IDS and withHookDisabled(id, fn) for the runner; defineHook(id) and hookEnabled(id) for each hook's owner.
 *
 * Pure; browser and server. Split out of core/validation/index.ts by W0.4 (bh2 module split, pure move; index.ts re-exports it).
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
import type { Clinician, ComputedFact, EpisodeBundle, FormDefinition, Report, ReportFlag, ReportTemplate } from "../types";
import { validateClinicianNamed } from "./attribution-clinician-named";
import { validateColleagueNamed } from "./attribution-colleague-named";
import { validateOpinionBoxQuotes } from "./attribution-opinion-boxes";
import { validateCitations } from "./citations";
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

export { HOOK_IDS, defineHook, hookEnabled, withHookDisabled } from "./hooks";

export interface ValidatorInput {
  report: Report;
  /** Normally `report.bundleSnapshot` (unscoped). */
  bundle: EpisodeBundle;
  template: ReportTemplate;
  computedFacts: ComputedFact[];
  /** The referrer's form map of a form report (10/2026: its recorded mail-merge fields are checked). */
  form?: Pick<FormDefinition, "analysis" | "fields">;
  /**
   * W0.6 plumbing: whose "I" the report speaks in (the voice owner). Absent: report.author, as before. WB makes it the
   * report's approver everywhere (review, /validate, /sign, drafting) and the receipt's signer at /render; `owner: null`
   * then means strict mode (every cited note counts as another clinician's). Read it with context.ts voiceOwnerOf().
   */
  voice?: { owner: Clinician | null };
}

/** A single validator. Each validator file in this folder exports one. */
export type Validator = (input: ValidatorInput) => ReportFlag[];

/** The validators in the order their flags are listed. */
export const VALIDATORS: ReadonlyArray<{ name: string; run: Validator }> = [
  { name: "citations", run: validateCitations },
  { name: "figures", run: validateFigures },
  { name: "form-answers", run: validateFormAnswers },
  { name: "choice-marks", run: validateChoiceMarks },
  { name: "terms", run: validateTerms },
  { name: "opinion-language", run: validateOpinionLanguage },
  { name: "voice", run: validateClinicianVoice },
  // W0.6 stubs for WB's new attribution checks (core/validation/attribution-*.ts): registered, so WB fills them in
  // without touching this list. Today each returns no flags.
  { name: "attribution-opinion-boxes", run: validateOpinionBoxQuotes },
  { name: "attribution-colleague-named", run: validateColleagueNamed },
  { name: "attribution-clinician-named", run: validateClinicianNamed },
  { name: "scope-terms", run: validateScopeTerms },
  { name: "placeholders", run: validatePlaceholders },
  { name: "merge-fields", run: validateMergeFields },
  { name: "gaps", run: validateGaps },
  { name: "draft-fit", run: validateDraftFit },
];
