/**
 * The validator registry: the input every validator gets, and the validators in the order their flags are listed.
 * runValidators (run.ts) runs them; each validator file in this folder exports one.
 *
 * Pure; browser and server. Split out of core/validation/index.ts by W0.4 (bh2 module split, pure move; index.ts re-exports it).
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
import type { ComputedFact, EpisodeBundle, FormDefinition, Report, ReportFlag, ReportTemplate } from "../types";
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
];
