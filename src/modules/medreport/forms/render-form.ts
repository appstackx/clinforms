import "server-only";

/**
 * One place that turns (form map + original file + answers) into the completed file, used by
 * POST /forms/fill-preview (always DRAFT) and POST /render for form reports (DRAFT or FINAL):
 *
 *   Word form  → original: filled .docx   · pdf: filled .docx converted by LibreOffice (null when absent)
 *   PDF form   → original / pdf: filled PDF, flattened (DRAFT: watermark on top of the answers)
 *
 * Also: review-copy source markers for the answers, the fill-warnings header and file names.
 *
 * Owner: forms-engine agent.
 */
import { CONTENT_TYPES, HEADERS } from "../api/contract";
import { HttpError } from "../api/http";
import { NOTICES } from "../config.public";
import { answerableFields, formTemplateId, type FormFillAnswers } from "../core/forms";
import type { FormDefinition, Report } from "../core/types";
import { buildFileBaseName } from "../docgen/view-model";
import { docxToPdf } from "./convert";
import { fillDocx } from "./docx-fill";
import { DOCX_MIME, PDF_MIME, type DecodedFormFile } from "./file";
import { fillPdf } from "./pdf-fill";

export type FormOutputFormat = "original" | "pdf";

export interface FormRenderInput {
  form: FormDefinition;
  file: DecodedFormFile;
  answers: FormFillAnswers;
  draft: boolean;
  reviewMarkers?: boolean;
  format: FormOutputFormat;
}

export interface FormRenderOutput {
  bytes: Uint8Array;
  contentType: typeof CONTENT_TYPES.docx | typeof CONTENT_TYPES.pdf;
  extension: "docx" | "pdf";
  /** Plain-English warnings, errors first (a draft lists its errors here too, for the fill-warnings header). */
  warnings: string[];
  /** Problems that make the written form wrong (PDF fill's onError). A final copy is refused with any. */
  errors?: string[];
}

/** 422 when the file type does not match the form map's kind (cannot happen when the SHA-256 matched). */
function assertKind(form: FormDefinition, file: DecodedFormFile): void {
  const wantDocx = form.kind === "docx";
  if ((wantDocx && file.mimeType !== DOCX_MIME) || (!wantDocx && file.mimeType !== PDF_MIME)) {
    throw new HttpError(422, "The file does not match the form map", {
      code: "FORM_INVALID",
      detail: `This form map is for a ${wantDocx ? "Word" : "PDF"} form, but the file sent is a ${file.mimeType === PDF_MIME ? "PDF" : "Word document"}.`,
    });
  }
}

/** Fill the referrer's original file (and convert a Word form to PDF when asked). */
export async function renderFormFile(input: FormRenderInput): Promise<FormRenderOutput> {
  const { form, file, answers, draft } = input;
  assertKind(form, file);
  const warnings: string[] = [];
  const onWarning = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };
  if (form.kind === "docx") {
    const docx = fillDocx(file.bytes, form, answers, { draft, reviewMarkers: input.reviewMarkers, onWarning });
    if (input.format === "original") return { bytes: docx, contentType: CONTENT_TYPES.docx, extension: "docx", warnings };
    let pdf: Uint8Array | null;
    try {
      pdf = await docxToPdf(docx);
    } catch {
      throw new HttpError(502, "The PDF copy could not be made", {
        code: "INTERNAL",
        detail: "The PDF converter did not finish. Download the completed Word form instead, or try again.",
        retryable: true,
      });
    }
    if (!pdf) {
      throw new HttpError(503, "PDF conversion is not available here", { code: "PDF_CONVERSION_UNAVAILABLE", detail: NOTICES.pdfConversionUnavailable });
    }
    return { bytes: pdf, contentType: CONTENT_TYPES.pdf, extension: "pdf", warnings };
  }
  // Flattened in both cases: FINAL by rule; DRAFT so the watermark is drawn above the filled boxes.
  const errors: string[] = [];
  const onError = (m: string) => {
    if (!errors.includes(m)) errors.push(m);
  };
  const pdf = await fillPdf(file.bytes, form, answers, { draft, flatten: true, reviewMarkers: input.reviewMarkers, onWarning, onError });
  if (errors.length > 0 && !draft) {
    // Never issue a form with a value cut to fit (e.g. a date written "14/02/19").
    throw new HttpError(422, "An answer does not fit the form", {
      code: "FORM_INVALID",
      detail: `${errors.join(" ")} The final copy was not made: correct the answer, approve the report again and download it.`,
    });
  }
  return { bytes: pdf, contentType: CONTENT_TYPES.pdf, extension: "pdf", warnings: [...errors, ...warnings], ...(errors.length > 0 && { errors }) };
}

/**
 * Review copies: append the answer's sources to each written text answer, e.g. " [N-001, N-006]"
 * (internal use only – a FINAL copy never carries them).
 */
export function withSourceMarkers(answers: FormFillAnswers, report: Pick<Report, "sections">, form: Pick<FormDefinition, "fields">): FormFillAnswers {
  const out: FormFillAnswers = { ...answers };
  for (const field of answerableFields(form)) {
    // Only drafted / reviewed text answers: identifiers, numbers and dates stay exactly as on the record.
    if (field.fillSource.kind !== "notes_narrative" && field.fillSource.kind !== "clinician_opinion") continue;
    if (field.answerType !== "long_text" && field.answerType !== "short_text") continue;
    if (field.anchor.kind === "docx" && field.anchor.target === "checkbox_glyph") continue;
    const answer = out[field.id];
    if (!answer?.text) continue;
    const section = report.sections.find((s) => s.key === field.id);
    const ids = Array.from(new Set((section?.paragraphs ?? []).flatMap((p) => p.sourceIds))).filter((id) => /^(N-\d{3,}|FACT-|REG$)/.test(id));
    if (ids.length) out[field.id] = { ...answer, text: `${answer.text} [${ids.join(", ")}]` };
  }
  return out;
}

/** Header value for HEADERS.fillWarnings: URI-encoded JSON, capped so proxies accept it. */
export function fillWarningsHeader(warnings: string[]): Record<string, string> {
  if (warnings.length === 0) return {};
  const list: string[] = [];
  let size = 2;
  for (const w of warnings) {
    const enc = encodeURIComponent(JSON.stringify(w)).length + 3;
    if (size + enc > 6000 || list.length >= 25) {
      list.push(`…and ${warnings.length - list.length} more.`);
      break;
    }
    list.push(w);
    size += enc;
  }
  return { [HEADERS.fillWarnings]: encodeURIComponent(JSON.stringify(list)) };
}

/** e.g. "Hart_M_Treating-Physiotherapist-Report_2026-10-07_SIGNED" (no extension). */
export function formFileBaseName(report: Pick<Report, "bundleSnapshot" | "version">, form: FormDefinition, opts: { signed: boolean; dateIso: string; preview?: boolean }): string {
  const reg = report.bundleSnapshot.registration;
  const built = buildFileBaseName({
    firstName: reg.firstName,
    lastName: reg.lastName,
    template: { id: formTemplateId(form.id), documentTitle: form.title },
    dateIso: opts.dateIso,
    signed: opts.signed,
  });
  // An amended version says so in its file name ("…_AMENDED-v2_SIGNED").
  const base = report.version && report.version > 1 ? built.replace(/(_SIGNED|_DRAFT)?$/, `_AMENDED-v${report.version}$1`) : built;
  return opts.preview ? `${base}_PREVIEW` : base;
}
