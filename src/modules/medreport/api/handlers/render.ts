import "server-only";

/**
 * POST /api/reports/v1/render
 * Query ?format=docx|pdf, body RenderRequest → file. FINAL only with a verified receipt (mac + recomputed hash) and no blocking flags; otherwise DRAFT (or 409 when requireFinal). Sets x-medreport-render and x-medreport-content-sha256.
 *
 * Form reports (report.form set): body also carries `form` and `fileBase64`; ?format=original|pdf (docx = original for a Word form).
 * The answers are written into the referrer's ORIGINAL file (forms/docx-fill.ts, forms/pdf-fill.ts; FINAL = flattened PDF,
 * sign-off fields from the verified receipt via core/forms.ts buildFormAnswers). Word → PDF uses forms/convert.ts docxToPdf();
 * where LibreOffice is unavailable → 503 PDF_CONVERSION_UNAVAILABLE (detail NOTICES.pdfConversionUnavailable).
 * 409 FORM_MISMATCH if the file's SHA-256 ≠ report.form.fileSha256. Headers also x-medreport-form-kind, x-medreport-fill-warnings.
 * Portal question sets (form.kind "questions") have no file: format original|pdf returns their PDF summary
 * (docgen/question-summary.ts; `fileBase64` is not needed and ignored); format docx → 422.
 *
 * Final-render rule (both paths): receipt verifies (auth/sign-receipt.ts verifyReceipt: MAC, report and
 * tenant binding, recomputed content hash) AND the validators allow signing AND it is not a review copy
 * AND (forms) the form map carries a valid server attestation AND hashes to the receipt's
 * formMapSha256 (the map the clinician approved) AND no custom Word template is sent for a built-in
 * report. Otherwise the copy is DRAFT – or 409 RECEIPT_INVALID / SIGNOFF_BLOCKED / FORM_NOT_CONFIRMED /
 * FORM_MISMATCH (422 TEMPLATE_INVALID) when requireFinal is set. A FINAL file carries
 * x-medreport-file-token (auth/attestations.ts) for the write-back.
 *
 * Wave 2: an actor is required (auth/actor.ts; any role – a final copy needs a receipt anyway). The
 * report, its form map and its receipt must be the actor's clinic's (403 TENANT_MISMATCH; a receipt or map
 * of another clinic never makes a FINAL copy, even though its MAC verifies). A clinic's FINAL render is
 * written to its audit trail (report id, format, receipt MAC prefix).
 *
 * Owner: forms-engine agent.
 */
import { AUDIT_ACTIONS, assertActorTenant, auditActor, macPrefix, requireActor, type Actor } from "../../auth/actor";
import { createFileToken, formConfirmationProblem, formMapSha256, sha256HexOf, verifyFormConfirmation } from "../../auth/attestations";
import { verifyReceipt } from "../../auth/sign-receipt";
import { MAX_TEMPLATE_DOCX_BYTES } from "../../config.public";
import { todayIso } from "../../core/dates";
import { reportFingerprint } from "../../core/fingerprint";
import { buildFormAnswers } from "../../core/forms";
import type { FormDefinition, Report, ReportTemplate, SignReceipt } from "../../core/types";
import { validateReport, type ValidateReportResult } from "../../core/validation";
import { getBuiltinTemplateDocx, renderDocx } from "../../docgen/docx";
import { renderPdf } from "../../docgen/pdf";
import { renderQuestionSummaryPdf } from "../../docgen/question-summary";
import { buildViewModel } from "../../docgen/view-model";
import { assertFormFileMatches, decodeFormFile } from "../../forms/file";
import { fillWarningsHeader, formFileBaseName, renderFormFile, withSourceMarkers } from "../../forms/render-form";
import { CONTENT_TYPES, HEADERS, RenderQuerySchema, RenderRequestSchema, type RenderFormat } from "../contract";
import type { MedreportDeps } from "../deps";
import { fileResponse, logEvent, parseBody, parseQuery, problem, type MedreportHandler } from "../http";
import { resolveTemplate } from "../resolve-template";

interface FinalDecision {
  final: boolean;
  /** Why a requested final copy cannot be made (null when final, or when no final was asked for). */
  refusal: Response | null;
}

async function decideFinal(
  report: Report,
  receipt: SignReceipt | undefined,
  validation: ValidateReportResult,
  opts: { reviewCopy: boolean; form: FormDefinition | null; templateDocx: boolean; tenantId: string },
): Promise<FinalDecision> {
  if (!receipt) {
    return {
      final: false,
      refusal: problem(409, "This report has not been approved", { code: "RECEIPT_INVALID", detail: "Approve the report first: a final copy needs the approval receipt." }),
    };
  }
  const verified = await verifyReceipt(receipt, report, { tenantId: opts.tenantId });
  if (!verified.ok) {
    const detail =
      verified.reason === "HASH_MISMATCH"
        ? "The report has changed since it was approved. Review the changes and approve it again."
        : "The approval receipt could not be verified for this report. Approve it again.";
    return { final: false, refusal: problem(409, "The approval receipt is not valid for this report", { code: "RECEIPT_INVALID", detail }) };
  }
  if (!validation.canSign) {
    return {
      final: false,
      refusal: problem(409, "Blocking items remain", { code: "SIGNOFF_BLOCKED", detail: "Resolve the blocking items first.", flags: validation.blocking }),
    };
  }
  if (opts.form) {
    const check = verifyFormConfirmation(opts.form, { tenantId: opts.tenantId });
    if (!check.ok) {
      return {
        final: false,
        refusal: problem(409, "The form mapping has not been confirmed", { code: "FORM_NOT_CONFIRMED", detail: formConfirmationProblem(check.reason) }),
      };
    }
    // The FINAL layout must be the map the clinician approved: the receipt carries its hash.
    if (receipt.formMapSha256 !== formMapSha256(opts.form)) {
      return {
        final: false,
        refusal: problem(409, "The form mapping differs from the one approved", {
          code: "FORM_MISMATCH",
          detail: "This form's mapping is not the one the clinician approved, so a final copy cannot be issued with it. Approve the report again with the current mapping.",
        }),
      };
    }
  }
  if (opts.templateDocx) {
    return {
      final: false,
      refusal: problem(422, "A custom Word template cannot wrap an approved report", {
        code: "TEMPLATE_INVALID",
        detail: "The final copy is rendered with the built-in template the clinician approved. Download a draft to try a custom template.",
      }),
    };
  }
  if (opts.reviewCopy) {
    return {
      final: false,
      refusal: problem(422, "A review copy is never final", { code: "VALIDATION_FAILED", issues: [{ path: "reviewCopy", message: "Leave reviewCopy off for the final copy." }] }),
    };
  }
  return { final: true, refusal: null };
}

function decodeTemplateDocx(base64: string): Uint8Array | Response {
  if (Math.floor((base64.length * 3) / 4) > MAX_TEMPLATE_DOCX_BYTES + 3) {
    return problem(413, "Template too large", { code: "PAYLOAD_TOO_LARGE", detail: `Word templates can be up to ${MAX_TEMPLATE_DOCX_BYTES / (1024 * 1024)} MB.` });
  }
  const bytes = new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));
  if (bytes.byteLength === 0 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return problem(422, "Not a Word template", { code: "TEMPLATE_INVALID", detail: "Upload the tagged template as a Word document (.docx)." });
  }
  return bytes;
}

async function renderBuiltIn(
  format: RenderFormat,
  report: Report,
  template: ReportTemplate,
  final: boolean,
  receipt: SignReceipt | undefined,
  reviewCopy: boolean,
  templateDocxBase64: string | undefined,
): Promise<{ bytes: Uint8Array; contentType: string; ext: string; warnings: string[]; baseName: string } | Response> {
  if (format === "original") {
    return problem(422, "Unsupported format", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "format", message: "“original” is for reports that complete a referrer's form. Use docx or pdf." }],
    });
  }
  const vm = buildViewModel(report, report.bundleSnapshot, template, { receipt: final ? receipt : undefined, reviewCopy });
  if (format === "pdf") {
    const bytes = await renderPdf(vm);
    return { bytes, contentType: CONTENT_TYPES.pdf, ext: "pdf", warnings: [], baseName: vm.fileBaseName };
  }
  let templateBytes: Uint8Array | null;
  if (templateDocxBase64) {
    const decoded = decodeTemplateDocx(templateDocxBase64);
    if (decoded instanceof Response) return decoded;
    templateBytes = decoded;
  } else {
    templateBytes = getBuiltinTemplateDocx(template.docxTemplateId);
  }
  if (!templateBytes) return problem(422, "No Word template for this report type", { code: "TEMPLATE_INVALID" });
  try {
    const out = await renderDocx(vm, templateBytes);
    const warnings = out.missingTags.length
      ? [`The template uses ${out.missingTags.length === 1 ? "a tag" : "tags"} this report does not provide (${out.missingTags.join(", ")}); “[MISSING]” was written there.`]
      : [];
    return { bytes: out.bytes, contentType: CONTENT_TYPES.docx, ext: "docx", warnings, baseName: vm.fileBaseName };
  } catch {
    return problem(422, "The Word template could not be used", {
      code: "TEMPLATE_INVALID",
      detail: templateDocxBase64 ? "Check the template with “Validate template” and fix the problems it lists." : "The built-in template could not be rendered.",
    });
  }
}

/** A clinic's FINAL copy goes into its audit trail (ids only). */
async function auditFinal(deps: MedreportDeps, actor: Actor, report: Report, receipt: SignReceipt | undefined, format: RenderFormat, form: FormDefinition | null): Promise<void> {
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.renderFinal,
    targetType: "report",
    targetId: report.id,
    detail: { format, ...(form ? { formId: form.id, kind: form.kind } : { templateId: report.templateId }), receiptMac: macPrefix(receipt?.mac) },
  });
}

export const handleRender: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  const query = parseQuery(req, RenderQuerySchema);
  if (!query.ok) return query.response;
  const parsed = await parseBody(req, RenderRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { format } = query.data;
  const { report, receipt, templateDocxBase64, form, fileBase64 } = parsed.data;
  const reviewCopy = parsed.data.reviewCopy === true;
  assertActorTenant(actor, report.tenantId, "report");
  if (form) assertActorTenant(actor, form.tenantId, "form");
  if (receipt) assertActorTenant(actor, receipt.tenantId, "approval");

  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;
  const { template } = resolved;
  const formDef = resolved.form;

  const started = Date.now();
  const validation = validateReport(report, template);
  const decision =
    receipt || parsed.data.requireFinal
      ? await decideFinal(report, receipt, validation, { reviewCopy, form: formDef, templateDocx: Boolean(templateDocxBase64), tenantId: actor.tenantId })
      : { final: false, refusal: null };
  if (parsed.data.requireFinal && !decision.final && decision.refusal) return decision.refusal;
  const final = decision.final;
  const contentSha256 = await reportFingerprint(report);
  const baseHeaders: Record<string, string> = {
    [HEADERS.renderKind]: final ? "final" : "draft",
    [HEADERS.contentSha256]: contentSha256,
  };
  const dateIso = final && receipt ? todayIso(new Date(receipt.signedAt)) : todayIso();
  // FINAL files carry the server's token for exactly these bytes, this approval and this episode;
  // the write-back (POST /connectors/{id}/documents) accepts nothing else.
  const fileTokenHeader = (bytes: Uint8Array): Record<string, string> =>
    final && receipt
      ? {
          [HEADERS.fileToken]: createFileToken({
            receiptMac: receipt.mac,
            sha256: sha256HexOf(bytes),
            tenantId: report.tenantId,
            connectorId: report.episodeRef.connectorId,
            patientId: report.episodeRef.patientId,
            episodeId: report.episodeRef.episodeId,
          }),
        }
      : {};

  if (formDef && formDef.kind === "questions") {
    // A portal question set has no file to fill: its record copy is the summary PDF.
    if (format === "docx") {
      return problem(422, "Portal questions have no Word file", {
        code: "VALIDATION_FAILED",
        detail: "Portal questions are answered for copying into the portal. Download the summary as a PDF (format=pdf or original).",
        issues: [{ path: "format", message: "Use format=pdf (or original) for a portal question set." }],
      });
    }
    const out = await renderQuestionSummaryPdf(report, formDef, template, { receipt: final ? receipt : undefined });
    const base = reviewCopy ? `${out.baseName}_REVIEW-COPY` : out.baseName;
    logEvent("render", { template: template.id, format, kind: formDef.kind, final, bytes: out.bytes.byteLength, warnings: 0, ms: Date.now() - started });
    if (final) await auditFinal(deps, actor, report, receipt, format, formDef);
    return fileResponse(out.bytes, {
      contentType: CONTENT_TYPES.pdf,
      fileName: `${base}.pdf`,
      headers: { ...baseHeaders, [HEADERS.formKind]: formDef.kind, ...fillWarningsHeader([]), ...fileTokenHeader(out.bytes) },
    });
  }

  if (formDef) {
    if (format === "docx" && formDef.kind !== "docx") {
      return problem(422, "This form is a PDF", { code: "VALIDATION_FAILED", issues: [{ path: "format", message: "Use format=original (or pdf) for a PDF form." }] });
    }
    if (!fileBase64) {
      return problem(422, "The referrer's form file is missing", {
        code: "VALIDATION_FAILED",
        issues: [{ path: "fileBase64", message: "Send the referrer's original form file (from the forms library) as fileBase64." }],
      });
    }
    const file = decodeFormFile(fileBase64);
    assertFormFileMatches(file, report.form?.fileSha256 ?? formDef.file.sha256);
    let answers = buildFormAnswers(report, formDef, { receipt: final ? receipt : null });
    if (reviewCopy) answers = withSourceMarkers(answers, report, formDef);
    const out = await renderFormFile({ form: formDef, file, answers, draft: !final, reviewMarkers: reviewCopy, format: format === "pdf" ? "pdf" : "original" });
    const base = formFileBaseName(report, formDef, { signed: final, dateIso });
    logEvent("render", { template: template.id, format, kind: formDef.kind, final, bytes: out.bytes.byteLength, warnings: out.warnings.length, ms: Date.now() - started });
    if (final) await auditFinal(deps, actor, report, receipt, format, formDef);
    return fileResponse(out.bytes, {
      contentType: out.contentType,
      fileName: `${reviewCopy ? `${base}_REVIEW-COPY` : base}.${out.extension}`,
      headers: { ...baseHeaders, [HEADERS.formKind]: formDef.kind, ...fillWarningsHeader(out.warnings), ...fileTokenHeader(out.bytes) },
    });
  }

  const out = await renderBuiltIn(format, report, template, final, receipt, reviewCopy, templateDocxBase64);
  if (out instanceof Response) return out;
  logEvent("render", { template: template.id, format, final, bytes: out.bytes.byteLength, warnings: out.warnings.length, ms: Date.now() - started });
  if (final) await auditFinal(deps, actor, report, receipt, format, null);
  return fileResponse(out.bytes, {
    contentType: out.contentType,
    fileName: `${out.baseName}.${out.ext}`,
    headers: { ...baseHeaders, ...fillWarningsHeader(out.warnings), ...fileTokenHeader(out.bytes) },
  });
};
