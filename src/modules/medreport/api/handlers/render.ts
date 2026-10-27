import "server-only";

/**
 * POST /api/reports/v1/render
 * Query ?format=docx|pdf, body RenderRequest → file. FINAL only with a verified receipt (mac + recomputed hash) and no blocking flags; otherwise DRAFT (or 409 when requireFinal). Sets x-medreport-render and x-medreport-content-sha256 (FINAL: the verified receipt's contentSha256; draft: the report's fingerprint as read, else as this build knows it – rollback shim, auth/sign-receipt.ts readReportFingerprint).
 *
 * Form reports (report.form set): body also carries `form` and `fileBase64`; ?format=original|pdf (docx = original for a Word form).
 * In a clinic's own Studio the clinic's stored copy of the file (by tenant and SHA-256) is preferred and
 * `fileBase64` may be left out (handlers/store-form-file.ts).
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
 * written to its audit trail (report id, format, receipt MAC prefix, purpose) – except (fix wave 2) the review's
 * on-screen preview (`purpose: "preview"`), which is not recorded and carries no file token.
 *
 * Demo clinics (ClinicProfile.demoClinic – the host's clinic_plan, read on the server): EVERY output – a referrer's
 * form (Word, PDF, the PDF copy), a portal question set's summary and a built-in report (Word or PDF), draft or final –
 * carries the demonstration notice on every page (core/demo-clinic.ts demoOutputNotice: the form's own notice, else
 * the demo clinic notice), and the final document's audit row says demoClinic. Real clinics and the public demo are
 * unchanged. File names follow the usual rules.
 *
 * bh2 WA1 design 7 (R-security-1, E5): a receipt that binds what was issued (SignReceipt.issuedContentSha256 /
 * acknowledgementsSha256, minted by /sign's dry run) makes a FINAL copy only when both still hold: the acknowledgements
 * the validators carry over now are the ones the approval relied on, and the Word document filled now (the issue
 * state's answers, the receipt's signer and time) hashes to the one checked at approval. Otherwise 409
 * ISSUED_COPY_CHANGED, written to the clinic's audit trail. The effective signer is always the receipt's.
 *
 * bh2 fix round 1 (R1T-WA1-01, RG-1; R1T-WA2-02): a receipt from before the release (minted by production – neither key:
 * sign/receipt.ts isPreReleaseReceipt = forms/render-form.ts issuedByPreReleaseEngine) approved the document PRODUCTION
 * issued. Its FINAL copy of a referrer's form is issued by production's own forms engine, frozen in forms/pre-release
 * (renderPreReleaseFinal): production's answers (no condition reading, no person's decision, unanswered boxes as
 * printed) and production's fill, so it is the document production issued – never this release's issue state, which
 * would leave out answers production printed. The dispatch is in finalFormCopy below, so scripts/admin/check-issued.ts
 * re-issues exactly what /render issues; it still compares every such approval with production's own code before a
 * deploy and reports any difference as CHANGED (Khuram decides on each).
 * Release rule (README): no forms-engine change is deployed while approved trial reports exist without first running
 * scripts/admin/check-issued.ts (decrypt, re-render, compare).
 *
 * bh2 fix round 1 (R1T-WA1-03, R1T-WA1-04): a body over the validators' budget is refused before they run (413); the
 * validators read the body as not yet approved (its status and receipt are the client's word: sign/checks/issue.ts
 * asNotYetApproved) with the voice /sign used – the approver, else the receipt's signer.
 *
 * Owner: forms-engine agent.
 */
import { AUDIT_ACTIONS, actorInDemoClinic, assertActorTenant, auditActor, macPrefix, requireActor, type Actor } from "../../auth/actor";
import { createFileToken, formConfirmationProblem, sha256HexOf, verifyFormConfirmation } from "../../auth/attestations";
import { readReportFingerprint, verifyReceipt } from "../../auth/sign-receipt";
import { MAX_TEMPLATE_DOCX_BYTES } from "../../config.public";
import { todayIso } from "../../core/dates";
import { demoOutputNotice, isDemoHcpc } from "../../core/demo-clinic";
import { buildFormAnswers } from "../../core/forms";
import type { FormDefinition, Report, ReportTemplate, SignReceipt } from "../../core/types";
import { validateReport, type ValidateReportResult } from "../../core/validation";
import { defaultVoiceOwner } from "../../core/validation/attribution-owner";
import { getBuiltinTemplateDocx, renderDocx } from "../../docgen/docx";
import { renderPdf } from "../../docgen/pdf";
import { renderQuestionSummaryPdf } from "../../docgen/question-summary";
import { buildViewModel } from "../../docgen/view-model";
import { addDocxDemoNotice, stampPdfDemoNotice } from "../../forms/demo-notice";
import { assertFormFileMatches } from "../../forms/file";
import { fillWarningsHeader, formFileBaseName, issuedByPreReleaseEngine, renderFormFile, renderPreReleaseFinal, withSourceMarkers, type FormRenderOutput } from "../../forms/render-form";
import type { DecodedFormFile } from "../../forms/file";
import { CONTENT_TYPES, HEADERS, RenderQuerySchema, RenderRequestSchema, type RenderFormat } from "../contract";
import type { MedreportDeps } from "../deps";
import { fileResponse, logEvent, parseBody, parseQuery, problem, type MedreportHandler } from "../http";
import { resolveTemplate } from "../resolve-template";
import { formFileForRequest } from "./store-form-file";
import { acknowledgementsSha256, bindsIssuedDocument, finalCopyAnswers, issuedContentSha256, issuedDocument } from "./sign/receipt";
import { asNotYetApproved, validationBudgetRefusal } from "./sign/checks/issue";

interface FinalDecision {
  final: boolean;
  /** Why a requested final copy cannot be made (null when final, or when no final was asked for). */
  refusal: Response | null;
  /** When final: the content hash the verified receipt records (what was approved). */
  contentSha256?: string;
  /** bh2 WA1: the receipt-bound acknowledgements changed (the refusal is ISSUED_COPY_CHANGED, always sent and audited). */
  issuedChanged?: "acknowledgements";
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
    // The FINAL layout must be the map the clinician approved: the receipt carries its hash – the attested hash of this
    // map, just verified (as read, else as this build knows it: auth/attestations.ts formMapMatches).
    if (receipt.formMapSha256 !== check.mapSha256) {
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
  // bh2 WA1 design 7: the acknowledgements carried over now must be the ones the approval relied on (receipt-bound).
  if (receipt.acknowledgementsSha256 && acknowledgementsSha256(validation.flags, report.gaps ?? []) !== receipt.acknowledgementsSha256) {
    return { final: false, refusal: issuedCopyChanged("acknowledgements"), issuedChanged: "acknowledgements" };
  }
  return { final: true, refusal: null, contentSha256: verified.contentSha256 };
}

/** 409 ISSUED_COPY_CHANGED: what would be issued now is not what was approved (bh2 WA1 design 7). */
function issuedCopyChanged(what: "acknowledgements" | "document"): Response {
  return problem(409, "The completed form differs from the one approved", {
    code: "ISSUED_COPY_CHANGED",
    detail:
      what === "acknowledgements"
        ? "The checks acknowledged on this report are not the ones it was approved with, so a final copy cannot be issued. Reload the approved report, or create an amended version and approve it again."
        : "Filling the form now would not give the document that was approved, so a final copy cannot be issued. Ask ClinForms support to check this approval; create an amended version to issue it again.",
  });
}

/** A refused final copy goes into the clinic's audit trail too (ids only). */
async function auditIssuedChanged(deps: MedreportDeps, actor: Actor, report: Report, receipt: SignReceipt | undefined, what: "acknowledgements" | "document"): Promise<void> {
  logEvent("render_refused_issued_changed", { report: report.id, what });
  // bh2-rc1: its own audit action – written as report.render_final it read "Final document produced" on the clinic's
  // activity page although nothing was produced (WF labels report.issue_refused: "Final document refused – …").
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.issueRefused,
    targetType: "report",
    targetId: report.id,
    detail: { refused: "ISSUED_COPY_CHANGED", what, receiptMac: macPrefix(receipt?.mac) },
  });
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
async function auditFinal(
  deps: MedreportDeps,
  actor: Actor,
  report: Report,
  receipt: SignReceipt | undefined,
  format: RenderFormat,
  form: FormDefinition | null,
  purpose: "download" | "preview" | "file_back",
  demoClinic: boolean,
): Promise<void> {
  if (purpose === "preview") return; // the on-screen preview of an approved report: nobody produced a document
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.renderFinal,
    targetType: "report",
    targetId: report.id,
    detail: {
      format,
      purpose,
      ...(form ? { formId: form.id, kind: form.kind } : { templateId: report.templateId }),
      receiptMac: macPrefix(receipt?.mac),
      // A demo clinic's final document carries the demonstration notice: the trail says so.
      ...(demoClinic ? { demoClinic: true } : {}),
    },
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
  const purpose = parsed.data.purpose ?? "download";
  assertActorTenant(actor, report.tenantId, "report");
  if (form) assertActorTenant(actor, form.tenantId, "form");
  if (receipt) assertActorTenant(actor, receipt.tenantId, "approval");

  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;
  const { template } = resolved;
  const formDef = resolved.form;

  // bh2 fix round 1 (R1T-WA1-03): no validator runs on a body over the budget.
  const tooLarge = validationBudgetRefusal(report, form);
  if (tooLarge) return tooLarge;
  const started = Date.now();
  // bh2 fix round 1 (R1T-WA1-04): the checks read the body as not yet approved – its status and receipt are the client's
  // word – in the voice /sign checked it in (sign/checks/voice.ts signVoiceOwner: the approver, else the signer, who is
  // the receipt's signer once it verifies; a draft copy without one: the report's default voice).
  const asChecked = asNotYetApproved(report);
  const voiceSigner = receipt?.signer ?? (report.status === "signed" ? report.receipt?.signer : undefined);
  const owner = report.approver?.name.trim() ? { name: report.approver.name, hcpc: report.approver.hcpc } : (voiceSigner ?? defaultVoiceOwner(asChecked));
  const validation = validateReport(asChecked, template, { form: formDef, voice: { owner } });
  const decision =
    receipt || parsed.data.requireFinal
      ? await decideFinal(report, receipt, validation, { reviewCopy, form: formDef, templateDocx: Boolean(templateDocxBase64), tenantId: actor.tenantId })
      : { final: false, refusal: null };
  if ("issuedChanged" in decision && decision.issuedChanged) {
    await auditIssuedChanged(deps, actor, report, receipt, decision.issuedChanged);
    return decision.refusal as Response;
  }
  if (parsed.data.requireFinal && !decision.final && decision.refusal) return decision.refusal;
  const final = decision.final;
  // A demo clinic's outputs all carry the demonstration notice (undefined everywhere else; read on the server).
  // Fix 25/10/2026: a FINAL document approved with a made-up PH-DEMO number (only possible in a demo clinic – the
  // receipt's signer is covered by its MAC, verified above) keeps the notice after the clinic is switched back to real.
  const madeUpApproval = actor.via !== "demo" && final && isDemoHcpc(receipt?.signer.hcpc);
  const demoClinic = (await actorInDemoClinic(deps, actor)) || madeUpApproval;
  const notice = demoClinic ? demoOutputNotice(formDef, true) : undefined;
  // FINAL: the hash the verified receipt records – also when it verified over the report as this build knows it (keys
  // it does not know left out, as before the rollback shim). Draft: the report's fingerprint as read, else as known.
  const contentSha256 = final && decision.contentSha256 ? decision.contentSha256 : await readReportFingerprint(report);
  if (contentSha256 === null) {
    // Only a report e132057 refused outright: a value no ClinForms build writes under a key this build does not know
    // (core/stored-schemas.ts), in a report that also holds a member this build does not know.
    return problem(422, "The report could not be read", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "report", message: "The report holds a value that cannot be read (a number out of range, or nesting too deep)." }],
    });
  }
  const baseHeaders: Record<string, string> = {
    [HEADERS.renderKind]: final ? "final" : "draft",
    [HEADERS.contentSha256]: contentSha256,
  };
  const dateIso = final && receipt ? todayIso(new Date(receipt.signedAt)) : todayIso();
  // FINAL files carry the server's token for exactly these bytes, this approval and this episode;
  // the write-back (POST /connectors/{id}/documents) accepts nothing else.
  const fileTokenHeader = (bytes: Uint8Array): Record<string, string> =>
    final && receipt && purpose !== "preview"
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
    const bytes = notice ? await stampPdfDemoNotice(out.bytes, notice, { draft: !final }) : out.bytes;
    const base = reviewCopy ? `${out.baseName}_REVIEW-COPY` : out.baseName;
    logEvent("render", { template: template.id, format, kind: formDef.kind, final, bytes: bytes.byteLength, warnings: 0, ms: Date.now() - started });
    if (final) await auditFinal(deps, actor, report, receipt, format, formDef, purpose, demoClinic);
    return fileResponse(bytes, {
      contentType: CONTENT_TYPES.pdf,
      fileName: `${base}.pdf`,
      headers: { ...baseHeaders, [HEADERS.formKind]: formDef.kind, ...fillWarningsHeader([]), ...fileTokenHeader(bytes) },
    });
  }

  if (formDef) {
    if (format === "docx" && formDef.kind !== "docx") {
      return problem(422, "This form is a PDF", { code: "VALIDATION_FAILED", issues: [{ path: "format", message: "Use format=original (or pdf) for a PDF form." }] });
    }
    // The clinic's stored copy when it holds the file (wave 2), else fileBase64; 422 when neither.
    const expectedSha256 = report.form?.fileSha256 ?? formDef.file.sha256;
    const file = await formFileForRequest(deps, { fileBase64, sha256: expectedSha256, tenantId: actor.via === "demo" ? null : actor.tenantId });
    assertFormFileMatches(file, expectedSha256);
    // bh2 WA1 design 7: a receipt that binds the issued document – fill it again exactly as /sign's dry run did (the
    // issue state's answers, the receipt's signer and time, no clinic notice) and compare before anything is issued.
    let issued: Awaited<ReturnType<typeof issuedDocument>> | null = null;
    if (final && receipt?.issuedContentSha256 && bindsIssuedDocument(formDef)) {
      issued = await issuedDocument({ report, form: formDef, file, approval: receipt });
      if (issuedContentSha256(issued.bytes) !== receipt.issuedContentSha256) {
        await auditIssuedChanged(deps, actor, report, receipt, "document");
        return issuedCopyChanged("document");
      }
    }
    const fileFormat = format === "pdf" ? "pdf" : "original";
    let out: FormRenderOutput;
    if (issued && format !== "pdf" && !notice) out = issued;
    else if (final && receipt) {
      // R1T-WA1-01: the FINAL copy, one function for /render and check-issued (an approval production made is issued with
      // the answers production wrote – see the file comment). A review copy is never final (decideFinal).
      out = await finalFormCopy({ report, form: formDef, file, receipt, format: fileFormat, continuationLabel: continuationLabelFor(report), ...(notice ? { demoNotice: notice } : {}) });
    } else {
      let answers = buildFormAnswers(report, formDef, { receipt: null });
      if (reviewCopy) answers = withSourceMarkers(answers, report, formDef);
      out = await renderFormFile({
        form: formDef,
        file,
        answers,
        draft: true,
        reviewMarkers: reviewCopy,
        format: fileFormat,
        continuationLabel: continuationLabelFor(report),
        ...(notice ? { demoNotice: notice } : {}),
      });
    }
    const base = formFileBaseName(report, formDef, { signed: final, dateIso });
    logEvent("render", { template: template.id, format, kind: formDef.kind, final, bytes: out.bytes.byteLength, warnings: out.warnings.length, ms: Date.now() - started });
    if (final) await auditFinal(deps, actor, report, receipt, format, formDef, purpose, demoClinic);
    return fileResponse(out.bytes, {
      contentType: out.contentType,
      fileName: `${reviewCopy ? `${base}_REVIEW-COPY` : base}.${out.extension}`,
      headers: { ...baseHeaders, [HEADERS.formKind]: formDef.kind, ...fillWarningsHeader(out.warnings), ...fileTokenHeader(out.bytes) },
    });
  }

  const rendered = await renderBuiltIn(format, report, template, final, receipt, reviewCopy, templateDocxBase64);
  if (rendered instanceof Response) return rendered;
  const out = notice
    ? {
        ...rendered,
        bytes: rendered.ext === "pdf" ? await stampPdfDemoNotice(rendered.bytes, notice, { draft: !final }) : addDocxDemoNotice(rendered.bytes, notice),
      }
    : rendered;
  logEvent("render", { template: template.id, format, final, bytes: out.bytes.byteLength, warnings: out.warnings.length, ms: Date.now() - started });
  if (final) await auditFinal(deps, actor, report, receipt, format, null, purpose, demoClinic);
  return fileResponse(out.bytes, {
    contentType: out.contentType,
    fileName: `${out.baseName}.${out.ext}`,
    headers: { ...baseHeaders, ...fillWarningsHeader(out.warnings), ...fileTokenHeader(out.bytes) },
  });
};

/**
 * The FINAL copy of a referrer's form for a VERIFIED receipt, as POST /render issues it (a receipt that binds the issued
 * document is first compared with it – the handler) – and exactly what scripts/admin/check-issued.ts re-issues, so the
 * pre-deploy check compares what /render would issue. bh2 fix round 1 (R1T-WA1-01, R1T-WA2-02): an approval production
 * made is issued by production's frozen forms engine (forms/pre-release renderPreReleaseFinal: production's answers and
 * fill); any other is filled with the issue state's answers (sign/receipt.ts finalCopyAnswers).
 */
export async function finalFormCopy(input: {
  report: Report;
  form: FormDefinition;
  file: DecodedFormFile;
  receipt: SignReceipt;
  format: "original" | "pdf";
  continuationLabel?: string;
  demoNotice?: string;
}): Promise<FormRenderOutput> {
  // R1T-WA2-02 (merge:r1, as both fix reports ask): approved before the release – production's own frozen forms engine
  // issues it (production's answers and fill), here so /render and check-issued issue the same document.
  if (issuedByPreReleaseEngine(input.receipt)) {
    return renderPreReleaseFinal({
      report: input.report,
      form: input.form,
      file: input.file,
      receipt: input.receipt,
      format: input.format,
      ...(input.continuationLabel ? { continuationLabel: input.continuationLabel } : {}),
      ...(input.demoNotice ? { demoNotice: input.demoNotice } : {}),
    });
  }
  return renderFormFile({
    form: input.form,
    file: input.file,
    answers: finalCopyAnswers(input.report, input.form, input.receipt),
    draft: false,
    format: input.format,
    ...(input.continuationLabel ? { continuationLabel: input.continuationLabel } : {}),
    ...(input.demoNotice ? { demoNotice: input.demoNotice } : {}),
  });
}

/** "Claimant: <name> · Reference: <their reference, else the policy number>" for a PDF form's continuation sheet (fix wave 3). */
export function continuationLabelFor(report: Report): string {
  const reference = report.instructingParty.reference?.trim() || report.bundleSnapshot.referral.membershipNumber?.trim() || "";
  return [`Claimant: ${report.patientLabel}`, reference ? `Reference: ${reference}` : ""].filter(Boolean).join(" · ");
}
