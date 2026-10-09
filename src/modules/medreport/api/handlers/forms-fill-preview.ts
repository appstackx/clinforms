import "server-only";

/**
 * POST /api/reports/v1/forms/fill-preview
 * Body FormFillPreviewRequest {report, form, fileBase64?, mode: "draft", reviewMarkers?} – fileBase64 may be left out
 * when the signed-in clinic holds the file (its stored copy is preferred; handlers/store-form-file.ts).
 *   → the referrer's original file with the current answers written in, marked DRAFT
 *     (docx → .docx via forms/docx-fill.ts; pdf → .pdf via forms/pdf-fill.ts, flattened under a DRAFT watermark).
 * Headers: x-medreport-render "draft", x-medreport-fill-warnings (URI-encoded JSON array),
 * x-medreport-form-kind. 409 FORM_MISMATCH when the file's SHA-256 differs from form.file.sha256 or
 * report.form.fileSha256; 422 when report.form.formId ≠ form.id.
 * Body cap MAX_FORM_REQUEST_BYTES. Sign-off fields are always blank here (no receipt).
 * A proposed (unconfirmed) map may be previewed – that is how staff test a mapping.
 * Portal question sets (form.kind "questions") have no file to fill: the response is their DRAFT
 * summary PDF (docgen/question-summary.ts), and `fileBase64` is ignored.
 *
 * Owner: forms-engine agent.
 */
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { todayIso } from "../../core/dates";
import { buildFormAnswers } from "../../core/forms";
import { isQuestionSet } from "../../core/question-set";
import { renderQuestionSummaryPdf } from "../../docgen/question-summary";
import { assertFormFileMatches } from "../../forms/file";
import { fillWarningsHeader, formFileBaseName, renderFormFile, withSourceMarkers } from "../../forms/render-form";
import { CONTENT_TYPES, FormFillPreviewRequestSchema, HEADERS } from "../contract";
import { fileResponse, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import { resolveTemplate } from "../resolve-template";
import { formFileForRequest } from "./store-form-file";

export const handleFormsFillPreview: MedreportHandler = async (req, _ctx, deps) => {
  const parsed = await parseBody(req, FormFillPreviewRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const { report, form, fileBase64, reviewMarkers } = parsed.data;
  if (!report.form) {
    return problem(422, "This report does not complete a referrer's form", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "report.form", message: "Only reports started from a referrer's form can be previewed in the form's layout." }],
    });
  }
  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;

  const started = Date.now();
  if (isQuestionSet(form)) {
    const out = await renderQuestionSummaryPdf(report, form, resolved.template);
    logEvent("form_fill_preview", { form: form.id, kind: form.kind, bytes: out.bytes.byteLength, warnings: 0, ms: Date.now() - started });
    return fileResponse(out.bytes, {
      contentType: CONTENT_TYPES.pdf,
      fileName: `${out.baseName}.pdf`,
      inline: true,
      headers: { [HEADERS.renderKind]: "draft", [HEADERS.formKind]: form.kind, ...fillWarningsHeader([]) },
    });
  }
  // The clinic's stored copy when it holds the file (wave 2), else fileBase64; 422 when neither.
  const file = await formFileForRequest(req, deps, { fileBase64, sha256: form.file.sha256 });
  assertFormFileMatches(file, form.file.sha256);

  let answers = buildFormAnswers(report, form, { receipt: null });
  if (reviewMarkers) answers = withSourceMarkers(answers, report, form);
  const out = await renderFormFile({ form, file, answers, draft: true, reviewMarkers, format: "original" });

  logEvent("form_fill_preview", { form: form.id, kind: form.kind, bytes: out.bytes.byteLength, warnings: out.warnings.length, ms: Date.now() - started });
  return fileResponse(out.bytes, {
    contentType: out.contentType,
    fileName: `${formFileBaseName(report, form, { signed: false, dateIso: todayIso(), preview: true })}.${out.extension}`,
    inline: true,
    headers: {
      [HEADERS.renderKind]: "draft",
      [HEADERS.formKind]: form.kind,
      ...fillWarningsHeader(out.warnings),
    },
  });
};
