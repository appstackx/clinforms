/**
 * ClinForms – HTTP contract (Report API v1 + Simulated TM3 paths).
 *
 * NOT server-only: the browser API client (ui/api-client.ts) imports this file. Keep it pure
 * (zod + core only). Server-only types may be re-exported with `export type` (erased at build).
 *
 * Conventions: version in the path; JSON bodies validated with zod (invalid → 422); errors are
 * `application/problem+json` (ProblemSchema); stateless (the client sends bundle/report every call);
 * logs hold IDs, timings and token counts, never note text.
 *
 * Shared contract (orchestrator-owned): additive optional fields only.
 */
import { z } from "zod";
import {
  AiEffortSchema,
  AiModeSchema,
  AttachReceiptSchema,
  ClinicianSchema,
  ComputedFactSchema,
  ConnectorIdSchema,
  ConnectorInfoSchema,
  DataCheckSchema,
  EpisodeBundleSchema,
  FormDefinitionSchema,
  FormFileSchema,
  FormKindSchema,
  GapSchema,
  GenerationMetaSchema,
  ImportPayloadSchema,
  InstructingPartySchema,
  IsoDateTimeSchema,
  LaunchClaimsSchema,
  PatientSummarySchema,
  ReferrerInfoSchema,
  ReportFlagSchema,
  ReportSchema,
  ReportSectionSchema,
  ReportTemplateSchema,
  SectionKeySchema,
  SessionTokenSchema,
  Sha256HexSchema,
  SignReceiptSchema,
  TraceEntrySchema,
} from "../core/schemas";
import { MAX_FORM_FIELDS_PER_DRAFT, MAX_SECTIONS_PER_DRAFT } from "../config.public";

/* ------------------------------------------------------------------------------------------------
 * Bases, headers, content types
 * ----------------------------------------------------------------------------------------------*/

export const REPORT_API_BASE = "/api/reports/v1" as const;
export const TM3_SIM_API_BASE = "/api/tm3-sim/v1" as const;

export const HEADERS = {
  /** Live AI passcode (POST /drafts with live AI). Compared with timingSafeEqual. */
  passcode: "x-medreport-passcode",
  /** Partner key, sent server-to-server by the clinic system on POST /launch. Never from a browser. */
  partnerKey: "x-partner-key",
  /** On /render responses: "final" or "draft". */
  renderKind: "x-medreport-render",
  /** On /render responses: the report's content fingerprint (hex). */
  contentSha256: "x-medreport-content-sha256",
  /** On every simulated TM3 response: "true". */
  simulated: "x-simulated",
  /** Set by the in-process transport on simulated responses: "in-process". */
  transport: "x-medreport-transport",
  /**
   * On /forms/fill-preview and form /render responses: URI-encoded JSON array of plain-English fill
   * warnings (e.g. "F-07: the answer is longer than the box; it continues on an extra page").
   */
  fillWarnings: "x-medreport-fill-warnings",
  /** On form /render responses: "docx" | "pdf_acroform" | "pdf_flat" (the referrer's form kind). */
  formKind: "x-medreport-form-kind",
  /**
   * On FINAL /render responses: the server's token for exactly these bytes, this receipt and this
   * patient's episode (auth/attestations.ts). POST /connectors/{id}/documents requires it as `fileToken`.
   */
  fileToken: "x-medreport-file-token",
} as const;

export const CONTENT_TYPES = {
  json: "application/json",
  problem: "application/problem+json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/* ------------------------------------------------------------------------------------------------
 * Paths (use these; never hand-build URLs)
 * ----------------------------------------------------------------------------------------------*/

const e = encodeURIComponent;

export const reportApiPaths = {
  health: () => `${REPORT_API_BASE}/health`,
  connectors: () => `${REPORT_API_BASE}/connectors`,
  launch: () => `${REPORT_API_BASE}/launch`,
  launchVerify: () => `${REPORT_API_BASE}/launch/verify`,
  sessionsDemo: () => `${REPORT_API_BASE}/sessions/demo`,
  patients: (connectorId: string, search?: string) =>
    `${REPORT_API_BASE}/connectors/${e(connectorId)}/patients${search ? `?search=${e(search)}` : ""}`,
  bundle: (connectorId: string, patientId: string, episodeId: string) =>
    `${REPORT_API_BASE}/connectors/${e(connectorId)}/patients/${e(patientId)}/episodes/${e(episodeId)}/bundle`,
  fileImportBundle: () => `${REPORT_API_BASE}/connectors/file-import/bundle`,
  templates: () => `${REPORT_API_BASE}/templates`,
  template: (id: string) => `${REPORT_API_BASE}/templates/${e(id)}`,
  templateDocx: (id: string) => `${REPORT_API_BASE}/templates/${e(id)}/docx`,
  templatesValidate: () => `${REPORT_API_BASE}/templates/validate`,
  drafts: () => `${REPORT_API_BASE}/drafts`,
  validate: () => `${REPORT_API_BASE}/validate`,
  sign: () => `${REPORT_API_BASE}/sign`,
  render: (format: RenderFormat) => `${REPORT_API_BASE}/render?format=${format}`,
  documents: (connectorId: string) => `${REPORT_API_BASE}/connectors/${e(connectorId)}/documents`,
  // Referrer forms (Revision 2)
  formsAnalyse: () => `${REPORT_API_BASE}/forms/analyse`,
  formSamples: () => `${REPORT_API_BASE}/forms/samples`,
  formSampleFile: (id: string) => `${REPORT_API_BASE}/forms/samples/${e(id)}/file`,
  formsFillPreview: () => `${REPORT_API_BASE}/forms/fill-preview`,
  formsConfirm: () => `${REPORT_API_BASE}/forms/confirm`,
  aiPayloadPreview: () => `${REPORT_API_BASE}/ai/payload-preview`,
} as const;

/** Paths of the SIMULATED TM3 API (scaffolding, not the product). Lists accept ?page=&page_size=. */
export const tm3SimPaths = {
  patients: (search?: string) => `${TM3_SIM_API_BASE}/patients${search ? `?search=${e(search)}` : ""}`,
  patient: (patientId: string) => `${TM3_SIM_API_BASE}/patients/${e(patientId)}`,
  patientEpisodes: (patientId: string) => `${TM3_SIM_API_BASE}/patients/${e(patientId)}/episodes`,
  patientDocuments: (patientId: string) => `${TM3_SIM_API_BASE}/patients/${e(patientId)}/documents`,
  episodeNotes: (episodeId: string) => `${TM3_SIM_API_BASE}/episodes/${e(episodeId)}/notes`,
  episodeAppointments: (episodeId: string) => `${TM3_SIM_API_BASE}/episodes/${e(episodeId)}/appointments`,
  episodeOutcomeMeasures: (episodeId: string) => `${TM3_SIM_API_BASE}/episodes/${e(episodeId)}/outcome-measures`,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Endpoint tables (README, tests, route coverage)
 * ----------------------------------------------------------------------------------------------*/

export type EndpointAuth = "none" | "partner-key" | "session" | "passcode-for-live" | "bearer-tm3-sim";

export interface EndpointSpec {
  name: string;
  method: "GET" | "POST";
  /** Next.js-style pattern with [params]. */
  path: string;
  auth: EndpointAuth;
  /** Handler file (Report API: src/modules/medreport/api/handlers/<file>; sim: src/sandbox/tm3-sim/handlers.ts). */
  handler: string;
  summary: string;
}

export const REPORT_API_ENDPOINTS: readonly EndpointSpec[] = [
  { name: "health", method: "GET", path: "/api/reports/v1/health", auth: "none", handler: "health.ts", summary: "Product, version, AI mode, live AI availability, model" },
  { name: "connectorsList", method: "GET", path: "/api/reports/v1/connectors", auth: "none", handler: "connectors-list.ts", summary: "Connector tiles (tm3-sim, file-import, tm3)" },
  { name: "launch", method: "POST", path: "/api/reports/v1/launch", auth: "partner-key", handler: "launch.ts", summary: "Clinic system asks for a launch URL with a 10-minute launch token" },
  { name: "launchVerify", method: "POST", path: "/api/reports/v1/launch/verify", auth: "none", handler: "launch-verify.ts", summary: "Exchange a launch token for its claims and a 1-hour session token" },
  { name: "sessionsDemo", method: "POST", path: "/api/reports/v1/sessions/demo", auth: "none", handler: "sessions-demo.ts", summary: "Demo-tenant session for the manual picker, uploads and batch" },
  { name: "patients", method: "GET", path: "/api/reports/v1/connectors/[id]/patients", auth: "session", handler: "patients.ts", summary: "Search patients (with episode summaries) via a connector" },
  { name: "bundle", method: "GET", path: "/api/reports/v1/connectors/[id]/patients/[pid]/episodes/[eid]/bundle", auth: "session", handler: "bundle.ts", summary: "EpisodeBundle + computed facts + data checks + integration trace; claims must match the path" },
  { name: "fileImportBundle", method: "POST", path: "/api/reports/v1/connectors/file-import/bundle", auth: "session", handler: "file-import-bundle.ts", summary: "Map an uploaded export (JSON/CSV) or pasted notes to an EpisodeBundle" },
  { name: "templatesList", method: "GET", path: "/api/reports/v1/templates", auth: "none", handler: "templates-list.ts", summary: "Report templates" },
  { name: "templateGet", method: "GET", path: "/api/reports/v1/templates/[id]", auth: "none", handler: "template-get.ts", summary: "One template's section spec" },
  { name: "templateDocx", method: "GET", path: "/api/reports/v1/templates/[id]/docx", auth: "none", handler: "template-docx.ts", summary: "Download the tagged Word template" },
  { name: "templatesValidate", method: "POST", path: "/api/reports/v1/templates/validate", auth: "none", handler: "templates-validate.ts", summary: "Validate an uploaded tagged .docx; plain-English TemplateErrors" },
  { name: "drafts", method: "POST", path: "/api/reports/v1/drafts", auth: "passcode-for-live", handler: "drafts.ts", summary: "Draft one group of 1–2 sections (live Claude or badged demo draft)" },
  { name: "validate", method: "POST", path: "/api/reports/v1/validate", auth: "none", handler: "validate.ts", summary: "Run the validators; flags + canSign" },
  { name: "sign", method: "POST", path: "/api/reports/v1/sign", auth: "session", handler: "sign.ts", summary: "Re-validate and issue an HMAC'd SignReceipt bound to the session, the form map and the content (409 SIGNOFF_BLOCKED if blocked)" },
  { name: "render", method: "POST", path: "/api/reports/v1/render", auth: "none", handler: "render.ts", summary: "Render .docx or .pdf (?format=docx|pdf), or a completed referrer form (?format=original|pdf); FINAL only with a valid receipt, otherwise DRAFT" },
  { name: "documents", method: "POST", path: "/api/reports/v1/connectors/[id]/documents", auth: "session", handler: "documents.ts", summary: "Write a signed file back to the clinic system with its receipt" },
  { name: "formsAnalyse", method: "POST", path: "/api/reports/v1/forms/analyse", auth: "passcode-for-live", handler: "forms-analyse.ts", summary: "Analyse a referrer's form (.docx or PDF) into a proposed form map (live Claude, recorded analysis or rules)" },
  { name: "formsSamples", method: "GET", path: "/api/reports/v1/forms/samples", auth: "none", handler: "forms-samples.ts", summary: "Bundled fictional referrer forms with their pre-confirmed form maps" },
  { name: "formsSampleFile", method: "GET", path: "/api/reports/v1/forms/samples/[id]/file", auth: "none", handler: "forms-sample-file.ts", summary: "The original file of a bundled sample form" },
  { name: "formsFillPreview", method: "POST", path: "/api/reports/v1/forms/fill-preview", auth: "none", handler: "forms-fill-preview.ts", summary: "The referrer's form filled with the current answers, marked DRAFT (for the live preview)" },
  { name: "formsConfirm", method: "POST", path: "/api/reports/v1/forms/confirm", auth: "session", handler: "forms-confirm.ts", summary: "Check a reviewed form map and return it confirmed, with the server's attestation of exactly that map" },
  { name: "aiPayloadPreview", method: "POST", path: "/api/reports/v1/ai/payload-preview", auth: "none", handler: "ai-payload-preview.ts", summary: "Exactly what a drafting call would send to Claude for this record (minimised), without calling it" },
];

export const TM3_SIM_ENDPOINTS: readonly EndpointSpec[] = [
  { name: "simPatients", method: "GET", path: "/api/tm3-sim/v1/patients", auth: "bearer-tm3-sim", handler: "simListPatients", summary: "Paged patients (?search=)" },
  { name: "simPatient", method: "GET", path: "/api/tm3-sim/v1/patients/[id]", auth: "bearer-tm3-sim", handler: "simGetPatient", summary: "One patient" },
  { name: "simPatientEpisodes", method: "GET", path: "/api/tm3-sim/v1/patients/[id]/episodes", auth: "bearer-tm3-sim", handler: "simListEpisodes", summary: "Paged episodes of a patient" },
  { name: "simEpisodeNotes", method: "GET", path: "/api/tm3-sim/v1/episodes/[id]/notes", auth: "bearer-tm3-sim", handler: "simListNotes", summary: "Paged SOAP notes with author {name, hcpc}" },
  { name: "simEpisodeAppointments", method: "GET", path: "/api/tm3-sim/v1/episodes/[id]/appointments", auth: "bearer-tm3-sim", handler: "simListAppointments", summary: "Paged appointments (ATT/DNA/LCN/CNC/BOOKED)" },
  { name: "simEpisodeOutcomeMeasures", method: "GET", path: "/api/tm3-sim/v1/episodes/[id]/outcome-measures", auth: "bearer-tm3-sim", handler: "simListOutcomeMeasures", summary: "Paged outcome measure series" },
  { name: "simAttachDocument", method: "POST", path: "/api/tm3-sim/v1/patients/[id]/documents", auth: "bearer-tm3-sim", handler: "simAttachDocument", summary: "Checks token + payload, returns {external_document_id, received_at, sha256}; stores nothing" },
];

/* ------------------------------------------------------------------------------------------------
 * Errors: application/problem+json
 * ----------------------------------------------------------------------------------------------*/

/** Known problem codes. `Problem.code` is an open string so clients tolerate new codes. */
export const PROBLEM_CODES = [
  "BAD_REQUEST",
  "BAD_JSON",
  "VALIDATION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNAUTHORIZED",
  "TOKEN_INVALID",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "SESSION_MISMATCH",
  "SIGNER_MISMATCH",
  "PARTNER_KEY_INVALID",
  "PASSCODE_REQUIRED",
  "PASSCODE_INVALID",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "SIGNOFF_BLOCKED",
  "RECEIPT_INVALID",
  "TEMPLATE_INVALID",
  "RATE_LIMITED",
  "LIVE_AI_UNAVAILABLE",
  "NO_DEMO_DRAFT",
  "AI_REFUSAL",
  "AI_MAX_TOKENS",
  "AI_TIMEOUT",
  "AI_ERROR",
  "CONNECTOR_NOT_CONFIGURED",
  "CONNECTOR_UNSUPPORTED",
  "CONNECTOR_ERROR",
  "IMPORT_INVALID",
  "FORM_INVALID",
  "FORM_MISMATCH",
  "FORM_NOT_CONFIRMED",
  "NO_DEMO_ANALYSIS",
  "PDF_CONVERSION_UNAVAILABLE",
  // Tenant storage (/store/**, wave 2; api/store-contract.ts)
  "TWO_FACTOR_REQUIRED",
  "REV_CONFLICT",
  "REPORT_LOCKED",
  "UPLOAD_INCOMPLETE",
  "UPLOAD_CORRUPT",
  "UNSUPPORTED_MEDIA_TYPE",
  "NOT_IMPLEMENTED",
  "INTERNAL",
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const ProblemIssueSchema = z.object({
  /** Dotted path into the body, e.g. "report.sections.3.paragraphs.0.text". */
  path: z.string(),
  message: z.string(),
});

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  /** 422 VALIDATION_FAILED: what was wrong with the body. */
  issues: z.array(ProblemIssueSchema).optional(),
  /** 409 SIGNOFF_BLOCKED: the blocking flags. */
  flags: z.array(ReportFlagSchema).optional(),
  /** Whether retrying the same request may succeed (AI timeouts, rate limits). */
  retryable: z.boolean().optional(),
});

/* ------------------------------------------------------------------------------------------------
 * Report API request/response schemas
 * ----------------------------------------------------------------------------------------------*/

// GET /health
export const HealthResponseSchema = z.object({
  product: z.string(),
  version: z.string(),
  aiMode: AiModeSchema,
  liveAiAvailable: z.boolean(),
  model: z.string(),
  promptVersion: z.string(),
});

// GET /connectors
export const ConnectorsResponseSchema = z.object({
  connectors: z.array(ConnectorInfoSchema),
});

// POST /launch (x-partner-key)
export const LaunchRequestSchema = z.object({
  connectorId: ConnectorIdSchema,
  patientId: z.string().min(1),
  episodeId: z.string().min(1),
  clinician: ClinicianSchema,
});
export const LaunchResponseSchema = z.object({
  /** Absolute URL built from the request origin: <origin>/reports/new?lt=<token>. */
  launchUrl: z.url(),
  expiresAt: IsoDateTimeSchema,
});

// POST /launch/verify
export const LaunchVerifyRequestSchema = z.object({ token: z.string().min(1) });
export const LaunchVerifyResponseSchema = z.object({
  claims: LaunchClaimsSchema,
  session: SessionTokenSchema,
});

// POST /sessions/demo
export const DemoSessionRequestSchema = z.object({
  purpose: z.enum(["picker", "upload", "batch"]),
  connectorId: ConnectorIdSchema.optional(),
});
export const DemoSessionResponseSchema = z.object({ session: SessionTokenSchema });

// GET /connectors/{id}/patients?search=
export const PatientsQuerySchema = z.object({ search: z.string().max(100).optional() });
export const PatientsResponseSchema = z.object({
  patients: z.array(PatientSummarySchema),
  trace: z.array(TraceEntrySchema),
});

// GET /connectors/{id}/patients/{pid}/episodes/{eid}/bundle   and   POST /connectors/file-import/bundle
/**
 * The demo drafts (recorded or pre-written) this deployment holds for the patient: built-in template
 * IDs and referrer-form file SHA-256s. Without live AI, the Studio skips drafting calls for anything
 * not listed (they would return NO_DEMO_DRAFT) and leaves those questions for the clinician.
 */
export const DemoDraftAvailabilitySchema = z.object({
  templateIds: z.array(z.string()),
  formSha256s: z.array(z.string()),
});

export const BundleResponseSchema = z.object({
  bundle: EpisodeBundleSchema,
  computedFacts: z.array(ComputedFactSchema),
  dataChecks: z.array(DataCheckSchema),
  trace: z.array(TraceEntrySchema),
  demoDrafts: DemoDraftAvailabilitySchema.optional(),
});
export const FileImportBundleRequestSchema = ImportPayloadSchema;

// GET /templates, /templates/{id}
export const TemplatesListResponseSchema = z.object({ templates: z.array(ReportTemplateSchema) });
export const TemplateGetResponseSchema = z.object({ template: ReportTemplateSchema });
// GET /templates/{id}/docx → binary (CONTENT_TYPES.docx)

// POST /templates/validate
export const TemplatesValidateRequestSchema = z.object({
  fileName: z.string().min(1),
  /** The .docx as base64 (decoded size ≤ MAX_TEMPLATE_DOCX_BYTES). */
  docxBase64: z.string().min(1),
});
export const TemplateErrorSchema = z.object({
  /** e.g. "unclosed_tag", "unopened_tag", "unclosed_loop", "unknown_tag", "tag_split_across_paragraphs". */
  code: z.string(),
  /** Plain-English explanation for a clinic administrator. */
  message: z.string(),
  tag: z.string().optional(),
  /** Where it is, e.g. "Paragraph 12" or "Table 2, row 1". */
  location: z.string().optional(),
});
export const TemplatesValidateResponseSchema = z.object({
  ok: z.boolean(),
  /** Every tag found, e.g. "patient.fullName", "#sections", "/sections". */
  tags: z.array(z.string()),
  errors: z.array(TemplateErrorSchema),
  /** Tags our view model supports but the template does not use (informational). */
  unusedTags: z.array(z.string()),
  /** Tags the template uses that our view model does not provide (would render "[MISSING]"). */
  unknownTags: z.array(z.string()),
});

// POST /drafts (x-medreport-passcode for live)
export const DraftsRequestSchema = z
  .object({
    /** Built-in template ID, or formTemplateId(form.id) ("form:<id>") when `form` is sent. */
    templateId: z.string().min(1),
    /** Unscoped bundle; the server applies the template scope and data minimisation before any AI call. */
    bundle: EpisodeBundleSchema,
    instructingParty: InstructingPartySchema,
    /**
     * One group of draftable section keys (spec: "sections"): 1–MAX_SECTIONS_PER_DRAFT for a built-in
     * template, 1–MAX_FORM_FIELDS_PER_DRAFT form field IDs ("F-07") when `form` is sent.
     */
    sectionKeys: z.array(SectionKeySchema).min(1).max(Math.max(MAX_SECTIONS_PER_DRAFT, MAX_FORM_FIELDS_PER_DRAFT)),
    /** "auto" (default): live when available and a passcode is sent, otherwise demo. */
    prefer: z.enum(["auto", "live", "demo"]).optional(),
    /** Override the server's effort setting (rehearsal/testing). */
    effort: AiEffortSchema.optional(),
    /**
     * Referrer forms (Revision 2): the form map being completed. The server drafts against
     * formToTemplate(form) instead of the template registry (forms live in the browser).
     */
    form: FormDefinitionSchema.optional(),
    /**
     * Referrer forms: the clinician who will sign the form (the report's author). Live drafting writes
     * what they recorded in the first person ("I recorded…"); other clinicians stay named.
     */
    author: ClinicianSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.form && body.sectionKeys.length > MAX_SECTIONS_PER_DRAFT) {
      ctx.addIssue({
        code: "custom",
        path: ["sectionKeys"],
        message: `Draft at most ${MAX_SECTIONS_PER_DRAFT} sections per call.`,
      });
    }
  });
export const DraftsResponseSchema = z.object({
  /** Drafted sections with server-assigned paragraph IDs (origin "ai"). */
  sections: z.array(ReportSectionSchema),
  gaps: z.array(GapSchema),
  /** Validator flags for the drafted sections only. */
  flags: z.array(ReportFlagSchema),
  generation: GenerationMetaSchema,
});

// POST /validate
export const ValidateRequestSchema = z.object({
  report: ReportSchema,
  /** Required for a form report (report.form set): its form map (the server has no form library). */
  form: FormDefinitionSchema.optional(),
});
export const ValidateResponseSchema = z.object({
  flags: z.array(ReportFlagSchema),
  canSign: z.boolean(),
  blocking: z.array(ReportFlagSchema),
});

// POST /sign
export const SignRequestSchema = z.object({
  report: ReportSchema,
  signer: ClinicianSchema,
  /** Typed signature; must equal signer.name (case-insensitive, trimmed). */
  typedSignature: z.string().min(1),
  statementAccepted: z.boolean(),
  /** The attestations the signer ticked (must equal the template's attestations; FORM_ATTESTATIONS for forms). */
  attestations: z.array(z.string()),
  /** Required for a form report (report.form set): its form map. */
  form: FormDefinitionSchema.optional(),
});
export const SignResponseSchema = z.object({
  receipt: SignReceiptSchema,
  /** Flags at the time of signing (no blocking ones). */
  flags: z.array(ReportFlagSchema),
});

// POST /render?format=docx|pdf|original → binary with HEADERS.renderKind + HEADERS.contentSha256
/**
 * Built-in template reports: "docx" | "pdf".
 * Form reports (report.form set): "original" = the referrer's own file type with the answers written in
 * (Word in → Word out; fillable/flat PDF in → PDF out, flattened); "pdf" = a PDF copy (a Word form is
 * converted with LibreOffice where available, otherwise 503 PDF_CONVERSION_UNAVAILABLE); "docx" is
 * accepted as "original" for a Word form.
 */
export const RenderFormatSchema = z.enum(["docx", "pdf", "original"]);
export const RenderQuerySchema = z.object({ format: RenderFormatSchema });
export const RenderRequestSchema = z.object({
  report: ReportSchema,
  /** FINAL only if this verifies (mac + recomputed hash) and no blocking flags remain. */
  receipt: SignReceiptSchema.optional(),
  /** A clinic's own tagged template (base64, decoded ≤ MAX_TEMPLATE_DOCX_BYTES). docx only. */
  templateDocxBase64: z.string().optional(),
  /** Add [DD/MM/YYYY] source markers for internal review. */
  reviewCopy: z.boolean().optional(),
  /** Fail with 409 SIGNOFF_BLOCKED / RECEIPT_INVALID instead of falling back to DRAFT. */
  requireFinal: z.boolean().optional(),
  /** Form reports: the form map (required when report.form is set). */
  form: FormDefinitionSchema.optional(),
  /**
   * Form reports: the referrer's original file as base64 (decoded ≤ MAX_FORM_FILE_BYTES; its SHA-256 must
   * equal report.form.fileSha256, otherwise 409 FORM_MISMATCH). In a clinic's own Studio the server reads the
   * file from the clinic's storage by that SHA-256 instead, when it holds it (wave 2).
   */
  fileBase64: z.string().optional(),
});

// POST /connectors/{id}/documents (session)
export const DocumentsRequestSchema = z.object({
  patientId: z.string().min(1),
  episodeId: z.string().min(1),
  title: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.enum([CONTENT_TYPES.docx, CONTENT_TYPES.pdf]),
  contentBase64: z.string().min(1),
  /** SHA-256 of the decoded file bytes. */
  sha256: Sha256HexSchema,
  signReceipt: SignReceiptSchema,
  /**
   * The server's token from the FINAL /render response (HEADERS.fileToken). Required: only the exact
   * file ClinForms issued for this approval and this patient's episode is filed.
   */
  fileToken: z.string().min(1).max(200).optional(),
});
export const DocumentsResponseSchema = z.object({
  attachReceipt: AttachReceiptSchema,
  trace: z.array(TraceEntrySchema),
});

/* ------------------------------------------------------------------------------------------------
 * Referrer forms (Revision 2)
 * ----------------------------------------------------------------------------------------------*/

// POST /forms/analyse (x-medreport-passcode for live; route maxDuration = 60)
export const FormsAnalyseRequestSchema = z.object({
  /** The referrer's form: .docx or PDF as base64 (decoded ≤ MAX_FORM_FILE_BYTES). Type detected from the bytes. */
  fileBase64: z.string().min(1),
  fileName: z.string().min(1).max(200),
  /** Who sent the form, if staff already know (otherwise proposed by the analysis). */
  referrer: ReferrerInfoSchema.optional(),
  /** Form title, if staff already know (otherwise taken from the document). */
  title: z.string().max(200).optional(),
  /** "auto" (default): live when available and a passcode is sent; otherwise a recorded analysis or rules. */
  prefer: z.enum(["auto", "live", "demo"]).optional(),
  effort: AiEffortSchema.optional(),
});

/** What deterministic parsing found, shown before the proposed mapping. */
export const FormOutlineSummarySchema = z.object({
  kind: FormKindSchema,
  pages: z.number().int().nonnegative().optional(),
  paragraphs: z.number().int().nonnegative().optional(),
  tables: z.number().int().nonnegative().optional(),
  /** AcroForm fields (fillable PDF) or content controls / legacy fields (Word). */
  fillableFields: z.number().int().nonnegative().optional(),
  /** Candidate answer spaces found by parsing (empty cells, placeholders, tick boxes, fields). */
  answerSpaces: z.number().int().nonnegative(),
  /** The form's own headings, in order (first 40). */
  headings: z.array(z.string()),
  warnings: z.array(z.string()),
});

/** One step of the analysis, for the "how this was analysed" panel. Never contains form text. */
export const FormAnalysisStepSchema = z.object({
  label: z.string(),
  status: z.enum(["ok", "warning", "skipped"]),
  ms: z.number().nonnegative(),
  detail: z.string().optional(),
});

export const FormsAnalyseResponseSchema = z.object({
  /** status "proposed": staff review and confirm the mapping once. */
  form: FormDefinitionSchema,
  outlineSummary: FormOutlineSummarySchema,
  trace: z.array(FormAnalysisStepSchema).optional(),
});

// GET /forms/samples
export const FormSampleSchema = z.object({
  /** Also the FormDefinition.sampleId of definitions seeded from it. */
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  referrer: ReferrerInfoSchema,
  kind: FormKindSchema,
  file: FormFileSchema,
  /** What makes this form different, e.g. "Prognosis asked as tick boxes with a free-text reason". */
  highlights: z.array(z.string()),
  /** Pre-confirmed form map (recorded analysis), when one exists. */
  form: FormDefinitionSchema.optional(),
  /**
   * Local demonstration form (dev/demo only, ai/demo-assets.ts): its map is prepared, but the file is
   * not served (GET /forms/samples/{id}/file is 404) – staff upload their own copy of exactly this
   * file (file.sha256) and the upload gets the prepared map. Never carries `form`.
   */
  uploadRequired: z.boolean().optional(),
});
export const FormSamplesResponseSchema = z.object({ samples: z.array(FormSampleSchema) });
// GET /forms/samples/{id}/file → binary (CONTENT_TYPES.docx or CONTENT_TYPES.pdf)

// POST /forms/fill-preview → binary (same type as the original), HEADERS.renderKind "draft", HEADERS.fillWarnings
export const FormFillPreviewRequestSchema = z.object({
  report: ReportSchema,
  form: FormDefinitionSchema,
  /**
   * The referrer's original file (base64, decoded ≤ MAX_FORM_FILE_BYTES, SHA-256 = form.file.sha256). Optional
   * since wave 2: in a clinic's own Studio the server reads the file from the clinic's storage by SHA-256 (and
   * prefers that copy); without a stored copy it is required (422).
   */
  fileBase64: z.string().min(1).optional(),
  /** Previews are always DRAFT (watermarked / marked "DRAFT – not approved"). */
  mode: z.literal("draft"),
  /** Highlight each written answer with its field ID (internal review copy). */
  reviewMarkers: z.boolean().optional(),
});

// POST /forms/confirm (session) → the map with status "confirmed" and confirmed {by, at, mapSha256, mac}
export const FormsConfirmRequestSchema = z.object({
  /** The reviewed map (any status); its fields are checked (checkFormDefinition) before it is attested. */
  form: FormDefinitionSchema,
  /** Name of the staff member confirming it (recorded in the attestation). */
  confirmedBy: z.string().trim().min(2).max(120),
});
export const FormsConfirmResponseSchema = z.object({ form: FormDefinitionSchema });

// POST /ai/payload-preview → exactly what a drafting call would send to Claude (minimised), no AI call
export const AiPayloadPreviewRequestSchema = z.object({
  templateId: z.string().min(1),
  bundle: EpisodeBundleSchema,
  instructingParty: InstructingPartySchema,
  form: FormDefinitionSchema.optional(),
});
export const AiPayloadPreviewResponseSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  /** The user message blocks in the order they are sent (system prompt summarised separately). */
  blocks: z.array(z.object({ label: z.string(), text: z.string() })),
  /** First lines of the frozen system prompt (the full rules are fixed and contain no patient data). */
  systemSummary: z.string(),
  /** What was removed or replaced before sending, in plain English. */
  removed: z.array(z.string()),
  /** Fields withheld by the referrer's scope (e.g. past medical history for an employer). */
  withheld: z.array(z.string()),
});

/* ------------------------------------------------------------------------------------------------
 * Types
 * ----------------------------------------------------------------------------------------------*/

export type Problem = z.infer<typeof ProblemSchema>;
export type ProblemIssue = z.infer<typeof ProblemIssueSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ConnectorsResponse = z.infer<typeof ConnectorsResponseSchema>;
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>;
export type LaunchResponse = z.infer<typeof LaunchResponseSchema>;
export type LaunchVerifyRequest = z.infer<typeof LaunchVerifyRequestSchema>;
export type LaunchVerifyResponse = z.infer<typeof LaunchVerifyResponseSchema>;
export type DemoSessionRequest = z.infer<typeof DemoSessionRequestSchema>;
export type DemoSessionResponse = z.infer<typeof DemoSessionResponseSchema>;
export type PatientsQuery = z.infer<typeof PatientsQuerySchema>;
export type PatientsResponse = z.infer<typeof PatientsResponseSchema>;
export type BundleResponse = z.infer<typeof BundleResponseSchema>;
export type FileImportBundleRequest = z.infer<typeof FileImportBundleRequestSchema>;
export type TemplatesListResponse = z.infer<typeof TemplatesListResponseSchema>;
export type TemplateGetResponse = z.infer<typeof TemplateGetResponseSchema>;
export type TemplatesValidateRequest = z.infer<typeof TemplatesValidateRequestSchema>;
export type TemplateError = z.infer<typeof TemplateErrorSchema>;
export type TemplatesValidateResponse = z.infer<typeof TemplatesValidateResponseSchema>;
export type DraftsRequest = z.infer<typeof DraftsRequestSchema>;
export type DraftsResponse = z.infer<typeof DraftsResponseSchema>;
export type ValidateRequest = z.infer<typeof ValidateRequestSchema>;
export type ValidateResponse = z.infer<typeof ValidateResponseSchema>;
export type SignRequest = z.infer<typeof SignRequestSchema>;
export type SignResponse = z.infer<typeof SignResponseSchema>;
export type RenderFormat = z.infer<typeof RenderFormatSchema>;
export type RenderQuery = z.infer<typeof RenderQuerySchema>;
export type RenderRequest = z.infer<typeof RenderRequestSchema>;
export type DocumentsRequest = z.infer<typeof DocumentsRequestSchema>;
export type DocumentsResponse = z.infer<typeof DocumentsResponseSchema>;
export type FormsAnalyseRequest = z.infer<typeof FormsAnalyseRequestSchema>;
export type FormOutlineSummary = z.infer<typeof FormOutlineSummarySchema>;
export type FormAnalysisStep = z.infer<typeof FormAnalysisStepSchema>;
export type FormsAnalyseResponse = z.infer<typeof FormsAnalyseResponseSchema>;
export type FormSample = z.infer<typeof FormSampleSchema>;
export type FormSamplesResponse = z.infer<typeof FormSamplesResponseSchema>;
export type FormFillPreviewRequest = z.infer<typeof FormFillPreviewRequestSchema>;
export type FormsConfirmRequest = z.infer<typeof FormsConfirmRequestSchema>;
export type FormsConfirmResponse = z.infer<typeof FormsConfirmResponseSchema>;
export type AiPayloadPreviewRequest = z.infer<typeof AiPayloadPreviewRequestSchema>;
export type AiPayloadPreviewResponse = z.infer<typeof AiPayloadPreviewResponseSchema>;

/**
 * Simulated TM3 wire types (request/response bodies of TM3_SIM_ENDPOINTS). The zod schemas live in the
 * server-only connectors/tm3-sim/wire.ts; type-only re-exports are erased at build time.
 */
export type {
  SimAppointment,
  SimAttachDocumentRequest,
  SimAttachDocumentResponse,
  SimClinician,
  SimEpisode,
  SimError,
  SimNote,
  SimOutcomeMeasure,
  SimPage,
  SimPatient,
} from "../connectors/tm3-sim/wire";
