import "server-only";

/**
 * bh2 fix round 1 (R1T-WA2-02, the engine part of review RG-1): the FINAL copy of a report approved BEFORE this release
 * is the document production issued for it.
 *
 * Why: this release changes what the forms engine writes for the same answers – an unanswered Word content control
 * loses its prompt, a blank sentence opener loses its printed lead words, the form author's instructions are left off,
 * printed tick marks and default values in a box nobody answered are cleared. Applied to a report production approved,
 * any of those makes the FINAL copy differ from the copy that was approved (on Dell's 17 forms as production holds them,
 * the text changed on 10). A receipt from before the release binds no issued document (no issuedContentSha256 /
 * acknowledgementsSha256 – every approval on this release gets at least the acknowledgements hash, and the MAC covers
 * both, so neither can be stripped), so the release cannot tell such a change from a correct copy. Instead, such a
 * receipt is issued by production's own forms engine, frozen in this folder (forms.ts, docx-fill.ts, pdf-fill.ts,
 * pdf-acro-fill.ts, pdf-overlay-marks.ts, render-form.ts = c883ce5 byte for byte, import paths only rewired): the
 * answers production's buildFormAnswers gives, written by production's fill – no run-time condition reading, no issue
 * state, nothing this release added. forms/pre-release-engine.test.ts pins the output against production's own fill.
 *
 * Bounded work: production's fill has no step budget (R-security-2/3), and the form map and file of a receipt minted by
 * production can be anything production approved – also in the public demo. So before the frozen fill runs, the form
 * must pass this release's request caps (forms/request-caps.ts) and – for a Word form – this release's bounded fill of the
 * same answers must not refuse it as too complex (422 FORM_TOO_COMPLEX, MAX_FILL_BLOCKS / MAX_BLOCK_PARAGRAPHS /
 * MAX_FILL_STEPS). No real form comes near either; a refusal is the same 422 the release gives for that file.
 *
 * Owner: WA2 (forms engine).
 */
import { HttpError } from "../../api/http";
import type { FormDefinition, Report, SignReceipt } from "../../core/types";
import { fillDocxReport } from "../docx-fill";
import type { DecodedFormFile } from "../file";
import { formRequestCapIssues } from "../request-caps";
import { buildFormAnswers } from "./forms";
import { renderFormFile, type FormRenderOutput } from "./render-form";

/** The production build whose forms engine is frozen here (main = c883ce5: e132057 + the PDF font fix + the rollback shim). */
export const PRE_RELEASE_ENGINE = "c883ce5";

/**
 * Whether production's forms engine issues this receipt's FINAL copy: a receipt minted before this release (it binds
 * neither the issued document nor the acknowledgements). Every approval this release makes carries acknowledgementsSha256
 * (api/handlers/sign/checks/issue.ts), and the receipt's MAC covers both keys, so a release receipt cannot be made to
 * read as one from before the release.
 */
export function issuedByPreReleaseEngine(receipt: Pick<SignReceipt, "issuedContentSha256" | "acknowledgementsSha256"> | null | undefined): boolean {
  return Boolean(receipt) && !receipt?.issuedContentSha256 && !receipt?.acknowledgementsSha256;
}

export interface PreReleaseFinalInput {
  report: Pick<Report, "sections">;
  form: FormDefinition;
  file: DecodedFormFile;
  /** The verified receipt: its signer and time fill the sign-off boxes, as production did. */
  receipt: Pick<SignReceipt, "signer" | "signedAt">;
  format: "original" | "pdf";
  /** PDF forms: printed on every continuation page (as production's /render passed it). */
  continuationLabel?: string;
  /** A demo clinic's notice (as production's /render passed it). */
  demoNotice?: string;
}

function tooComplex(issues: Array<{ path: string; message: string }>): HttpError {
  return new HttpError(422, "This form is too complex to fill", {
    code: "FORM_TOO_COMPLEX",
    detail: `${issues
      .slice(0, 3)
      .map((i) => i.message)
      .join(" ")} The final copy was not made.`,
    issues,
  });
}

/**
 * Bounded-work admission for the frozen fill (see the file comment): the release's caps, and – Word – the release's own
 * bounded fill of the same answers (its outcomes are not used; only a FORM_TOO_COMPLEX refusal counts).
 */
function admit(input: PreReleaseFinalInput, answers: ReturnType<typeof buildFormAnswers>): void {
  const capped = formRequestCapIssues(input.form);
  if (capped.length > 0) throw tooComplex(capped);
  if (input.form.kind !== "docx") return;
  try {
    fillDocxReport(input.file.bytes, input.form, answers, { draft: false });
  } catch (err) {
    const e = err as { status?: number; init?: { code?: string } };
    if (e.status === 422 && e.init?.code === "FORM_TOO_COMPLEX") throw err;
    // Anything else (a file production could not fill either) is production's fill's to report, below.
  }
}

/**
 * The FINAL copy of a report approved before this release, exactly as production issues it: production's answers and
 * production's fill (Word: the original or production's PDF conversion of it; PDF forms: production's flattened fill),
 * with the clinic's demonstration notice where production added one. Throws what production's fill threw (422
 * FORM_INVALID for a mail-merge field left, a value that does not fit) and 422 FORM_TOO_COMPLEX past the bounds above.
 */
export async function renderPreReleaseFinal(input: PreReleaseFinalInput): Promise<FormRenderOutput> {
  const answers = buildFormAnswers(input.report, input.form, { receipt: input.receipt });
  admit(input, answers);
  return renderFormFile({
    form: input.form,
    file: input.file,
    answers,
    draft: false,
    format: input.format,
    ...(input.continuationLabel ? { continuationLabel: input.continuationLabel } : {}),
    ...(input.demoNotice ? { demoNotice: input.demoNotice } : {}),
  });
}
