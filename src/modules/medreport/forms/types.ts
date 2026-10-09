import "server-only";

/**
 * Shared option types for the forms engine (fill and outline). Server-only like the rest of forms/.
 *
 * Owner: forms-engine agent. Signatures are final.
 */
import { HttpError } from "../api/http";

/** Options for writing answers into a referrer's original file. */
export interface FillOptions {
  /**
   * true → DRAFT copy: a visible marking (Word: a red "DRAFT – awaiting clinician approval" banner at the
   * top of the body, skipped by the outline; PDF: diagonal "DRAFT – NOT APPROVED" watermark and a footer
   * note on every page). Sign-off fields stay blank because the caller passes no receipt.
   */
  draft: boolean;
  /**
   * Word: highlight each written answer and tag it with its field ID ("[F-07]"); unanswered questions get
   * a grey "[F-08 – not answered yet]" marker (internal review copy). Source markers ("[N-003]") are
   * added to the answer text by the caller (forms/render-form.ts withSourceMarkers).
   */
  reviewMarkers?: boolean;
  /** Plain-English problems met while filling (anchor not found, text overflowed its box, …). */
  onWarning?: (message: string) => void;
  /**
   * Plain-English problems that make the written form WRONG, not just untidy – e.g. a value cut to fit
   * a box that takes fewer characters (a date written "14/02/19"). Without onError they go to onWarning.
   * forms/render-form.ts lists them with the warnings on a draft and refuses to issue a final copy.
   */
  onError?: (message: string) => void;
}

export interface PdfFillOptions extends FillOptions {
  /**
   * Flatten the AcroForm after filling (FINAL copies are always flattened). The Studio flattens DRAFT
   * copies too, so the DRAFT watermark sits on top of the filled boxes.
   */
  flatten: boolean;
}

/** 501 for a forms-engine function that is not built yet (bindHandler → problem+json). */
export function formsEngineNotImplemented(fn: string): HttpError {
  return new HttpError(501, "Not implemented", { code: "NOT_IMPLEMENTED", detail: `${fn} is not implemented yet.` });
}
