/**
 * ClinForms – canonical data contract (zod v4).
 *
 * This file is the SOURCE OF TRUTH for every shape that crosses a boundary:
 * connector → EpisodeBundle → Report API → Studio UI → Word/PDF render.
 * `core/types.ts` re-exports the inferred TypeScript types.
 *
 * Rules
 * - Pure: no React, no Next, no env, no Node built-ins. Safe in the browser and on the server.
 * - Dates in data are ISO (`YYYY-MM-DD`); timestamps are ISO 8601 date-times. Display formatting
 *   (DD/MM/YYYY) happens at the edges via `core/dates.ts`.
 * - Shared contract: later agents may only ADD optional fields here (and must say so).
 */
import { z } from "zod";

/* ------------------------------------------------------------------------------------------------
 * Primitives
 * ----------------------------------------------------------------------------------------------*/

/** Tenant identifier. The demo build has exactly one tenant: "demo". */
export const TenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Tenant IDs are lower-case letters, digits and hyphens");

/** Calendar date in data: `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();

/** Timestamp in data: ISO 8601 with `Z` or an offset, e.g. `2026-10-06T09:30:00.000Z`. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Clock time `HH:mm` (24h). */
export const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

/** Form field ID on a referrer's form, e.g. `F-01` (assigned in document order by the form analysis). */
export const FORM_FIELD_ID_PATTERN = /^F-\d{2,}$/;
export const FormFieldIdSchema = z.string().regex(FORM_FIELD_ID_PATTERN, "Form field IDs look like F-01");

/**
 * Section key: lower_snake_case for built-in templates (e.g. `presenting_complaints`), or a form field
 * ID (e.g. `F-07`) for a report that completes a referrer's own form (one section per answerable field).
 */
export const SectionKeySchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_]*|F-\d{2,})$/, "Section keys are lower_snake_case (or a form field ID such as F-01)");

/** SHA-256 digest as 64 lower-case hex characters. */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 hex digest");

/* ------------------------------------------------------------------------------------------------
 * Enumerations
 * ----------------------------------------------------------------------------------------------*/

export const ConnectorIdSchema = z.enum(["tm3-sim", "tm3", "file-import"]);
export const ConnectorStatusSchema = z.enum(["connected", "available", "not_configured"]);
/**
 * Who instructs a report / sends the form. "mlc" = medico-legal company (medical reporting agency).
 * Revision 2 added "mlc" and "other" (referrers send their own forms).
 */
export const InstructingPartyTypeSchema = z.enum(["solicitor", "employer", "insurer", "case_manager", "mlc", "other"]);
/** The referrer types of the referrer forms library (same members as InstructingPartyTypeSchema). */
export const ReferrerTypeSchema = InstructingPartyTypeSchema;
export const SexSchema = z.enum(["female", "male", "other", "not_recorded"]);
export const IncidentTypeSchema = z.enum([
  "road_traffic_accident",
  "workplace",
  "slip_trip_fall",
  "sport",
  "other",
]);
export const NoteTypeSchema = z.enum(["initial_assessment", "follow_up", "discharge", "telephone", "other"]);
/**
 * Appointment status codes.
 * ATT attended · DNA did not attend · LCN late cancellation · CNC cancelled with notice · BOOKED future.
 */
export const AppointmentStatusSchema = z.enum(["ATT", "DNA", "LCN", "CNC", "BOOKED"]);
export const OutcomeInstrumentSchema = z.enum(["NDI", "ODI", "NPRS", "PSFS", "QuickDASH"]);
export const EpisodeStatusSchema = z.enum(["open", "discharged"]);
export const SectionKindSchema = z.enum(["from_records", "ai_narrative", "clinician_opinion", "declaration"]);
/** Locked "From records – not AI" blocks a section displays/renders alongside its paragraphs. */
export const RecordsBlockSchema = z.enum(["attendance", "outcomes", "records_reviewed"]);
/** Bundle fields a template's scope can strip before drafting (see core/scope.ts). */
export const ScopeFieldSchema = z.enum(["note.pastMedicalHistory", "note.socialHistory"]);
export const ParagraphOriginSchema = z.enum(["ai", "edited", "clinician", "from_records"]);
export const ParagraphBasisSchema = z.enum([
  "patient_reported",
  "clinician_observed",
  "clinician_opinion_recorded",
  "record",
]);
export const ReportSectionStatusSchema = z.enum(["pending", "drafted", "needs_input", "complete"]);
export const ReportStatusSchema = z.enum(["draft", "signed"]);
export const FlagSeveritySchema = z.enum(["blocking", "warning"]);
export const DataCheckSeveritySchema = z.enum(["info", "warning", "blocking"]);
export const ReportFlagCodeSchema = z.enum([
  "UNKNOWN_SOURCE_ID",
  "UNCITED_PARAGRAPH",
  "FIGURE_NOT_IN_SOURCE",
  "TERM_NOT_IN_SOURCE",
  "OPINION_LANGUAGE",
  "SCOPE_TERM",
  "MISSING_PLACEHOLDER",
  "OPEN_GAP",
  "DATA_CHECK",
]);
export const DataCheckCodeSchema = z.enum([
  "NO_PRE_INCIDENT_HISTORY",
  "DNA_WITHOUT_REASON",
  "EPISODE_STILL_OPEN",
  "NO_DISCHARGE_NOTE",
  "SINGLE_TIMEPOINT_OUTCOME",
  "CONSENT_NOT_RECORDED",
  "INCIDENT_DATE_MISSING",
  "MULTIPLE_CLINICIANS",
]);
export const GenerationModeSchema = z.enum(["live", "demo_prewritten", "demo_recorded"]);
/** Effective AI mode of a deployment (see config.server.ts resolveAiMode()). */
export const AiModeSchema = z.enum(["live", "demo"]);
export const AiEffortSchema = z.enum(["low", "medium", "high"]);
export const SessionKindSchema = z.enum(["launch", "demo"]);
export const TraceTransportSchema = z.enum(["http", "in-process"]);

/* Referrer forms (Revision 2) ----------------------------------------------------------------- */

/** MIME types accepted for a referrer's form: Word (.docx) or PDF. */
export const FormMimeTypeSchema = z.enum([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
]);
/**
 * docx: Word form, completed in place (Word in → Word out).
 * pdf_acroform: fillable PDF, fields filled and flattened (PDF in → PDF out).
 * pdf_flat: PDF without fields; best-effort text overlay at analysed positions.
 */
export const FormKindSchema = z.enum(["docx", "pdf_acroform", "pdf_flat"]);
/** What kind of answer a form question expects. */
export const AnswerTypeSchema = z.enum([
  "short_text",
  "long_text",
  "date",
  "yes_no",
  "checkbox",
  "single_choice",
  "number",
  "signature",
  "clinician_name",
  "hcpc_number",
  "date_signed",
]);
/** How a structured answer is stored on a form report section (see core/forms.ts answerKindFor). */
export const FormAnswerKindSchema = z.enum(["text", "yes_no", "checkbox", "choice", "date", "number"]);
export const FormFieldConfidenceSchema = z.enum(["high", "medium", "low"]);
export const FormStatusSchema = z.enum(["proposed", "confirmed"]);
/**
 * Provenance of a form analysis. "rules" = deterministic parsing only, no AI call (e.g. an uploaded
 * form in demo mode): every field is low confidence and staff complete the mapping.
 */
export const FormAnalysisModeSchema = z.enum(["live", "demo_recorded", "demo_prewritten", "rules"]);
/**
 * Where a Word anchor writes its answer.
 * - table_cell: into the (empty) answer cell `blockId` ("t2.r3.c1"), replacing its empty paragraph.
 * - after_paragraph: a new paragraph after the question paragraph `blockId` ("p12").
 * - replace_placeholder: replace `placeholderText` (e.g. "[Insert prognosis]", "………", "____") in `blockId`.
 * - content_control: the w:sdt content control containing `blockId`.
 * - checkbox_glyph: tick the ☐ glyph(s) listed in `optionGlyphs` (☐ → ☒).
 * - legacy_form_field: the legacy FORMTEXT / FORMCHECKBOX field in `blockId`.
 */
export const DocxAnchorTargetSchema = z.enum([
  "table_cell",
  "after_paragraph",
  "replace_placeholder",
  "content_control",
  "checkbox_glyph",
  "legacy_form_field",
]);
export const PdfFieldTypeSchema = z.enum(["text", "checkbox", "radio", "dropdown"]);
/**
 * Registration and record values filled by CODE (never by the AI) – see core/forms.ts
 * resolveRegistrationValue(). Identifiers on a form always come from here.
 */
export const RegistrationPathSchema = z.enum([
  "patient.fullName",
  "patient.firstName",
  "patient.lastName",
  "patient.dob",
  "patient.age",
  "patient.sex",
  "patient.address",
  "patient.occupation",
  "patient.employer",
  "referral.referrerName",
  "referral.reference",
  "incident.date",
  "incident.mechanism",
  "episode.firstSeen",
  "episode.lastSeen",
  "episode.dischargeDate",
  "clinic.name",
  "clinic.address",
  "report.date",
  "clinician.name",
  "clinician.hcpc",
  "clinician.profession",
  // Added for insurer (PMI) forms – additive. Patient title and contact details come from registration,
  // clinic contact details from the clinic's settings, and the insurer's identifiers from the referral
  // (membership / authorisation numbers are copied only onto that insurer's own form: core/form-record-rules.ts).
  "patient.title",
  "patient.phone",
  "patient.email",
  "clinic.phone",
  "clinic.email",
  "referral.insurerName",
  "referral.membershipNumber",
  "referral.authorisationNumber",
]);
/** How a computed fact is written into a form answer (default "summary" = the fact's value). */
export const ComputedFactFormatSchema = z.enum(["sessions_attended", "dna_count", "summary"]);
/** Sign-off parts filled from the server-signed receipt at approval (blank on a DRAFT). */
export const SignoffPartSchema = z.enum(["signature", "name", "hcpc", "date"]);

/* ------------------------------------------------------------------------------------------------
 * Citable source IDs
 * The AI may cite only these: "REG" (registration), "N-001"… (notes) and "FACT-*" (computed facts).
 * ----------------------------------------------------------------------------------------------*/

export const REGISTRATION_SOURCE_ID = "REG" as const;
export const NOTE_ID_PATTERN = /^N-\d{3,}$/;
export const NoteIdSchema = z.string().regex(NOTE_ID_PATTERN, "Note IDs look like N-001");

/** FACT-attendance | FACT-age | FACT-episode | FACT-outcomes-<instrument> */
export const FactIdSchema = z.union([
  z.literal("FACT-attendance"),
  z.literal("FACT-age"),
  z.literal("FACT-episode"),
  z.templateLiteral(["FACT-outcomes-", OutcomeInstrumentSchema]),
]);

/** Any citable ID: "REG", a note ID or a fact ID. Validators drop anything else (UNKNOWN_SOURCE_ID). */
export const SourceIdSchema = z.union([z.literal(REGISTRATION_SOURCE_ID), NoteIdSchema, FactIdSchema]);

/* ------------------------------------------------------------------------------------------------
 * People and parties
 * ----------------------------------------------------------------------------------------------*/

/** A clinician. HCPC numbers in demo data use an obviously invalid format such as `PH-DEMO-01`. */
export const ClinicianSchema = z.object({
  name: z.string().min(1),
  hcpc: z.string().min(1),
  role: z.string().optional(),
});

/**
 * Patient registration (citable as "REG").
 * `addressSummary` and `contact` are NEVER sent to the AI (data minimisation); the name is replaced by
 * "[CLAIMANT]" and the date of birth by an age before any AI call.
 */
export const PatientRegistrationSchema = z.object({
  id: z.literal(REGISTRATION_SOURCE_ID),
  externalPatientId: z.string().min(1),
  title: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  fullName: z.string().min(1),
  dob: IsoDateSchema,
  sex: SexSchema,
  addressSummary: z.string(),
  occupation: z.string().optional(),
  employer: z.string().optional(),
  contact: z
    .object({
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
});

/** Who instructed the report. Strings may be empty ("") but are always present. */
export const InstructingPartySchema = z.object({
  type: InstructingPartyTypeSchema,
  name: z.string().min(1),
  reference: z.string(),
  contactName: z.string(),
  address: z.string(),
});

/** The referral on the episode: the instructing party plus referral details from the clinic system. */
export const ReferralSchema = InstructingPartySchema.extend({
  referralDate: IsoDateSchema.optional(),
  reason: z.string().optional(),
  /**
   * Private medical insurance (additive): the patient's insurer as the clinic system records it, and the
   * insurer's membership / policy and pre-authorisation numbers. Identifiers – never sent to the AI.
   */
  insurerName: z.string().optional(),
  membershipNumber: z.string().optional(),
  authorisationNumber: z.string().optional(),
});

/** The referrer (MLC, insurer, solicitor, case manager, employer…) whose own form is being completed. */
export const ReferrerInfoSchema = z.object({
  name: z.string().min(1),
  type: ReferrerTypeSchema,
  /** The referrer's case reference, when known (usually per patient; the form library keeps it blank). */
  reference: z.string().optional(),
});

export const IncidentSchema = z.object({
  /** Missing date raises the INCIDENT_DATE_MISSING data check. */
  date: IsoDateSchema.optional(),
  mechanism: z.string(),
  type: IncidentTypeSchema,
});

/* ------------------------------------------------------------------------------------------------
 * Clinical record
 * ----------------------------------------------------------------------------------------------*/

/** A SOAP clinical note. `id` is the citable "N-001"… ID assigned by the mapper in date/time order. */
export const NoteSchema = z.object({
  id: NoteIdSchema,
  externalId: z.string().optional(),
  date: IsoDateSchema,
  time: TimeSchema.optional(),
  type: NoteTypeSchema,
  author: ClinicianSchema,
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  freeText: z.string().optional(),
  /** Structured history fields; scoped templates (employer) strip these before drafting. */
  pastMedicalHistory: z.string().optional(),
  socialHistory: z.string().optional(),
});

export const AppointmentSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().optional(),
  date: IsoDateSchema,
  time: TimeSchema,
  status: AppointmentStatusSchema,
  /** Reason recorded for DNA/LCN/CNC. A DNA without a reason raises DNA_WITHOUT_REASON. */
  reason: z.string().optional(),
  noteId: NoteIdSchema.optional(),
  clinician: ClinicianSchema.optional(),
  /**
   * The clinic's charge for this appointment, when the clinic system holds one (additive; insurer claim
   * forms' expenses tables). `amount` is in pounds (GBP major units, e.g. 55 = £55.00).
   */
  charge: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.literal("GBP"),
      paid: z.boolean().optional(),
    })
    .optional(),
});

export const OutcomePointSchema = z.object({
  date: IsoDateSchema,
  value: z.number(),
  noteId: NoteIdSchema.optional(),
});

export const OutcomeMeasureSeriesSchema = z.object({
  id: z.string().min(1),
  instrument: OutcomeInstrumentSchema,
  /** Display unit, e.g. "%" for NDI/ODI, "/10" for NPRS. */
  unit: z.string(),
  higherIsWorse: z.boolean(),
  points: z.array(OutcomePointSchema),
});

export const ConsentSchema = z.object({
  disclosureConsentRecorded: z.boolean(),
  date: IsoDateSchema.optional(),
});

export const EpisodeSourceSchema = z.object({
  connectorId: ConnectorIdSchema,
  simulated: z.boolean(),
  fetchedAt: IsoDateTimeSchema,
  externalPatientId: z.string().min(1),
  externalEpisodeId: z.string().min(1),
  /** Human label for provenance, e.g. "Simulated TM3 sandbox" or an uploaded file name. */
  label: z.string().optional(),
});

/** Everything the report is built from. Produced by a connector, never edited by the UI. */
export const EpisodeBundleSchema = z.object({
  tenantId: TenantIdSchema,
  source: EpisodeSourceSchema,
  episodeTitle: z.string().optional(),
  registration: PatientRegistrationSchema,
  referral: ReferralSchema,
  incident: IncidentSchema.optional(),
  clinicians: z.array(ClinicianSchema),
  notes: z.array(NoteSchema),
  appointments: z.array(AppointmentSchema),
  outcomeMeasures: z.array(OutcomeMeasureSeriesSchema),
  consent: ConsentSchema,
  episodeStatus: EpisodeStatusSchema,
});

/** Pointer to an episode in a clinic system (external IDs). */
export const EpisodeRefSchema = z.object({
  connectorId: ConnectorIdSchema,
  patientId: z.string().min(1),
  episodeId: z.string().min(1),
});

/* ------------------------------------------------------------------------------------------------
 * Computed facts and data checks (code, never AI)
 * ----------------------------------------------------------------------------------------------*/

/** A fact computed by code from the bundle. The AI may quote it (by ID) but never recalculate it. */
export const ComputedFactSchema = z.object({
  id: FactIdSchema,
  label: z.string(),
  /** Short display value, e.g. "10 of 11 attended (1 DNA)". Figures here are citable. */
  value: z.string(),
  /** Longer explanation with the figures used, e.g. "42% (18/03/2026) → 24% → 12% (02/06/2026)". */
  detail: z.string(),
});

export const DataCheckSchema = z.object({
  code: DataCheckCodeSchema,
  severity: DataCheckSeveritySchema,
  message: z.string(),
  /** Related citable or record IDs (note IDs, appointment IDs, outcome series IDs). */
  relatedIds: z.array(z.string()),
});

/* ------------------------------------------------------------------------------------------------
 * Report templates
 * ----------------------------------------------------------------------------------------------*/

export const TemplateSectionSchema = z.object({
  key: SectionKeySchema,
  title: z.string().min(1),
  kind: SectionKindSchema,
  /** Instructions for the AI (ai_narrative / clinician_opinion) or for the code that fills it. */
  guidance: z.string(),
  /** Optional sections (e.g. the CPR Part 35-style declaration) can be left out of a report. */
  required: z.boolean(),
  blocks: z.array(RecordsBlockSchema).optional(),
  /** Form templates (formToTemplate): the field's answer type (added by the ai agent – additive). */
  answerType: AnswerTypeSchema.optional(),
});

export const TemplateScopeSchema = z.object({
  excludeFields: z.array(ScopeFieldSchema),
  /** Case-insensitive terms that must not appear in drafted text (SCOPE_TERM, blocking). */
  excludeTerms: z.array(z.string()),
});

export const ReportTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Title printed on the document, e.g. "Treating Physiotherapist Report". */
  documentTitle: z.string().min(1),
  audience: InstructingPartyTypeSchema,
  description: z.string(),
  version: z.string().min(1),
  scope: TemplateScopeSchema,
  sections: z.array(TemplateSectionSchema).min(1),
  declarationText: z.string(),
  /** Shown in the UI/sign dialog, never printed, e.g. "Confirm exact wording with the instructing solicitor." */
  declarationNote: z.string().optional(),
  /** Statements the signer must tick in the sign dialog (copied into the SignReceipt). */
  attestations: z.array(z.string()).min(1),
  /** ID of the tagged Word template docgen renders into (see templates/generated). */
  docxTemplateId: z.string().min(1),
});

/* ------------------------------------------------------------------------------------------------
 * Report content
 * ----------------------------------------------------------------------------------------------*/

/**
 * Structured answer of a form report section (Revision 2). Set for non-text answers only:
 * yes_no/checkbox → boolean, choice → the exact option text, date → ISO `YYYY-MM-DD`, number → digits as
 * a string; null = not answered. For kind "text" the section's paragraphs ARE the answer (value null).
 * See core/forms.ts answerKindFor() / answerToText().
 */
export const FormAnswerSchema = z.object({
  kind: FormAnswerKindSchema,
  value: z.union([z.string(), z.boolean(), z.null()]),
});

/** On a report that completes a referrer's own form: which form (and which exact file) it fills. */
export const ReportFormRefSchema = z.object({
  formId: z.string().min(1),
  title: z.string(),
  referrer: ReferrerInfoSchema,
  /** SHA-256 of the referrer's original file; fill/render refuse a different file (FORM_MISMATCH). */
  fileSha256: Sha256HexSchema,
  kind: FormKindSchema,
  /**
   * SHA-256 of the confirmed form MAP the report was started from (FormDefinition.confirmed.mapSha256,
   * attested by the server). Part of the signed content, so a FINAL copy can only be issued with the
   * exact map the clinician reviewed (409 FORM_MISMATCH otherwise). Optional for older reports.
   */
  mapSha256: Sha256HexSchema.optional(),
});

export const ParagraphSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  /** Citable IDs (REG, N-*, FACT-*). Required for origin "ai"/"edited" (UNCITED_PARAGRAPH otherwise). */
  sourceIds: z.array(z.string()),
  origin: ParagraphOriginSchema,
  basis: ParagraphBasisSchema.optional(),
  /** Reason given when the clinician acknowledged an OPINION_LANGUAGE flag on edited text. */
  ackReason: z.string().optional(),
  /** Text as first produced by the AI/demo draft, so the UI can revert an edit. */
  originalText: z.string().optional(),
});

export const ReportSectionSchema = z.object({
  key: SectionKeySchema,
  title: z.string(),
  kind: SectionKindSchema,
  paragraphs: z.array(ParagraphSchema),
  status: ReportSectionStatusSchema,
  /** Form reports: the FormField this section answers (equals `key`). */
  fieldId: FormFieldIdSchema.optional(),
  /** Form reports: structured answer for non-text answer types (see FormAnswerSchema). */
  answer: FormAnswerSchema.optional(),
});

export const GapResolutionSchema = z.object({
  kind: z.enum(["resolved", "acknowledged"]),
  text: z.string().min(1),
  at: IsoDateTimeSchema,
});

/** Something the record does not say. Every unresolved gap blocks signing (OPEN_GAP). */
export const GapSchema = z.object({
  id: z.string().min(1),
  sectionKey: SectionKeySchema,
  issue: z.string(),
  suggestedQuestion: z.string(),
  relatedNoteIds: z.array(z.string()),
  raisedBy: z.enum(["ai", "system"]).optional(),
  resolution: GapResolutionSchema.optional(),
});

export const FlagAcknowledgementSchema = z.object({
  reason: z.string().min(1),
  at: IsoDateTimeSchema,
});

export const ReportFlagSchema = z.object({
  id: z.string().min(1),
  code: ReportFlagCodeSchema,
  severity: FlagSeveritySchema,
  sectionKey: SectionKeySchema.optional(),
  paragraphId: z.string().optional(),
  gapId: z.string().optional(),
  message: z.string(),
  /** The offending text or figure, e.g. "full recovery" or "March 2027". */
  evidence: z.string().optional(),
  acknowledged: FlagAcknowledgementSchema.optional(),
});

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
});

/** Provenance of one drafted section group. Shown as a badge on every draft. */
export const GenerationMetaSchema = z.object({
  mode: GenerationModeSchema,
  sectionKeys: z.array(SectionKeySchema),
  at: IsoDateTimeSchema,
  /** Model that actually served the request (may differ from the requested one after a fallback). */
  model: z.string().optional(),
  promptVersion: z.string(),
  effort: AiEffortSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  usage: TokenUsageSchema.optional(),
  stopReason: z.string().optional(),
  /** For demo_recorded: when the real Claude output was recorded. */
  recordedAt: IsoDateTimeSchema.optional(),
});

/** Demo-grade audit trail entry (browser only). Known actions: KNOWN_ACTIVITY_ACTIONS in core/report-factory.ts. */
export const ActivityEntrySchema = z.object({
  at: IsoDateTimeSchema,
  actor: z.string(),
  action: z.string(),
  detail: z.string(),
});

/** Server-HMAC'd sign-off receipt. `mac` covers every other field (canonical JSON). */
export const SignReceiptSchema = z.object({
  reportId: z.string().min(1),
  tenantId: TenantIdSchema,
  /** SHA-256 of canonicalJson(report) – see core/fingerprint.ts (receipt/status/activity excluded). */
  contentSha256: Sha256HexSchema,
  signer: ClinicianSchema,
  signedAt: IsoDateTimeSchema,
  statementAccepted: z.boolean(),
  attestations: z.array(z.string()),
  /**
   * Form reports: SHA-256 of the form map the server verified at approval (api: formMapSha256). A
   * FINAL copy is only rendered with a map that hashes to this value.
   */
  formMapSha256: Sha256HexSchema.optional(),
  /** The authenticated session the approval came through (recorded in the audit trail). */
  approvedVia: z
    .object({
      kind: SessionKindSchema,
      sid: z.string().min(1),
      /** The clinician the clinic system launched the session for, if any. */
      clinician: ClinicianSchema.optional(),
    })
    .optional(),
  /** base64url HMAC-SHA256 with MEDREPORT_SIGNING_SECRET. */
  mac: z.string().min(1),
});

export const ReportSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  /** Display label, e.g. "Megan Hart". */
  patientLabel: z.string(),
  episodeRef: EpisodeRefSchema,
  instructingParty: InstructingPartySchema,
  /** Frozen copy of the bundle the report was drafted from. Requests send it inside the report. */
  bundleSnapshot: EpisodeBundleSchema,
  sections: z.array(ReportSectionSchema),
  gaps: z.array(GapSchema),
  flags: z.array(ReportFlagSchema),
  status: ReportStatusSchema,
  generation: z.array(GenerationMetaSchema),
  activity: z.array(ActivityEntrySchema),
  receipt: SignReceiptSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /**
   * Set when the report completes a referrer's own form (Revision 2). `templateId` is then
   * formTemplateId(formId) ("form:<formId>") and there is one section per answerable FormField.
   */
  form: ReportFormRefSchema.optional(),
  /**
   * The clinician the report is prepared for and who is expected to sign it (the clinician the clinic
   * system launched it for, else the treating clinician). Used for the audit trail's actor when no
   * one is signed in, and for writing their own notes in the first person.
   */
  author: ClinicianSchema.optional(),
  /**
   * Demo deployments: whether this deployment holds recorded / pre-written answers for this exact
   * record and form (from the bundle response). false → drafting without live AI cannot help, so the
   * Studio says so instead of making a call that would fail.
   */
  demoDraftsAvailable: z.boolean().optional(),
  /** Version of this report (1 when absent). An amended version is a new report with version + 1. */
  version: z.number().int().min(1).optional(),
  /** Set on an amended version: the approved report it amends (that approval is superseded once this one is approved). */
  amends: z
    .object({
      reportId: z.string().min(1),
      version: z.number().int().min(1),
      approvedAt: IsoDateTimeSchema,
    })
    .optional(),
});

/* ------------------------------------------------------------------------------------------------
 * Referrer forms (Revision 2): the referrer's OWN report form, analysed once into a form map
 * (FormDefinition) that is confirmed by staff and reused for every patient.
 * ----------------------------------------------------------------------------------------------*/

export const FormFileSchema = z.object({
  fileName: z.string().min(1),
  mimeType: FormMimeTypeSchema,
  /** SHA-256 of the original bytes. A FormDefinition is bound to exactly this file. */
  sha256: Sha256HexSchema,
  sizeBytes: z.number().int().nonnegative(),
});

/**
 * Stable block ID from the Word outline (forms/docx-outline.ts), bound to the file's sha256:
 * "p<n>" = body paragraph n, "t<n>.r<n>.c<n>" = table n, row n, cell n (all 0-based, document order;
 * nested tables append ".t<n>.r<n>.c<n>"). Parse/format with core/forms.ts parseBlockId/formatBlockId.
 */
export const BlockIdSchema = z.string().min(1).max(80);

export const OptionGlyphSchema = z.object({
  /** The option label as printed, e.g. "Yes", "Fit with adjustments". */
  option: z.string(),
  blockId: BlockIdSchema,
  /** Index of the ☐ glyph within the block's text (0 = first glyph in that block). */
  glyphIndex: z.number().int().nonnegative(),
});

export const DocxAnchorSchema = z.object({
  kind: z.literal("docx"),
  target: DocxAnchorTargetSchema,
  blockId: BlockIdSchema,
  /** replace_placeholder: the exact text to replace (e.g. "[Insert prognosis]", "……", "_____"). */
  placeholderText: z.string().optional(),
  /** checkbox_glyph (and yes_no / single_choice): where each option's ☐ is. */
  optionGlyphs: z.array(OptionGlyphSchema).optional(),
});

export const PdfFieldAnchorSchema = z.object({
  kind: z.literal("pdf_field"),
  /** Fully qualified AcroForm field name. */
  fieldName: z.string().min(1),
  fieldType: PdfFieldTypeSchema,
  /** radio / dropdown: the export values, in order. */
  options: z.array(z.string()).optional(),
});

/** Flat PDF (best effort): draw the answer in this box. Page is 1-based; PDF points, origin bottom-left. */
export const PdfOverlayAnchorSchema = z.object({
  kind: z.literal("pdf_overlay"),
  page: z.number().int().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  fontSize: z.number().positive().optional(),
});

/** Where the answer goes in the ORIGINAL document. */
export const FormAnchorSchema = z.discriminatedUnion("kind", [
  DocxAnchorSchema,
  PdfFieldAnchorSchema,
  PdfOverlayAnchorSchema,
]);

/**
 * Where the answer comes from.
 * - registration: filled by CODE from TM3 registration/referral/episode data (identifiers never come from the AI);
 * - computed_fact: filled by CODE from a FACT-* (attendance, DNA count, …);
 * - notes_narrative: drafted by Claude strictly from the notes, with citations;
 * - clinician_opinion: only an opinion a clinician actually recorded, attributed and cited; otherwise
 *   left blank and flagged for the clinician;
 * - signoff: filled from the server-signed approval receipt (blank on a DRAFT);
 * - leave_blank: the referrer's own use / not for the clinic (no report section);
 * - fixed (additive): the same answer for every patient, set once in the form map by staff (e.g. tick
 *   "Physiotherapist", "United Kingdom"); filled by CODE, never the AI.
 */
export const FillSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("registration"), path: RegistrationPathSchema }),
  z.object({ kind: z.literal("computed_fact"), factId: FactIdSchema, format: ComputedFactFormatSchema.optional() }),
  z.object({ kind: z.literal("notes_narrative") }),
  z.object({ kind: z.literal("clinician_opinion") }),
  z.object({ kind: z.literal("signoff"), part: SignoffPartSchema }),
  z.object({ kind: z.literal("leave_blank") }),
  z.object({ kind: z.literal("fixed"), value: z.string() }),
]);

/** One question / answer space on the referrer's form. */
export const FormFieldSchema = z.object({
  /** "F-01", "F-02"… in document order. Also the section key of the report section that answers it. */
  id: FormFieldIdSchema,
  /** The question or label as printed on the form. */
  label: z.string().min(1),
  /** The form's own heading this question sits under, e.g. "Section C – Prognosis". */
  section: z.string().optional(),
  /** What the referrer wants, in plain English (shown to staff and given to the AI as the brief). */
  guidance: z.string(),
  answerType: AnswerTypeSchema,
  /** single_choice / yes_no / checkbox: the options as printed. */
  options: z.array(z.string()).optional(),
  anchor: FormAnchorSchema,
  fillSource: FillSourceSchema,
  required: z.boolean(),
  confidence: FormFieldConfidenceSchema,
  /** Analysis or staff note, e.g. "Two answer boxes found; using the larger one." */
  note: z.string().optional(),
});

export const FormAnalysisSchema = z.object({
  mode: FormAnalysisModeSchema,
  /** Model that served the analysis (live / demo_recorded). */
  model: z.string().optional(),
  promptVersion: z.string(),
  durationMs: z.number().nonnegative().optional(),
  usage: TokenUsageSchema.optional(),
  at: IsoDateTimeSchema,
  /** Plain-English caveats, e.g. "Flat PDF: answers are overlaid at estimated positions." */
  warnings: z.array(z.string()),
});

/** A referrer's form, analysed into a form map. Saved per referrer form and reused for every patient. */
export const FormDefinitionSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  referrer: ReferrerInfoSchema,
  /** e.g. "Treating Physiotherapist Report Form". */
  title: z.string().min(1),
  /** The referrer's own version label, e.g. "v3 (2026)". */
  versionLabel: z.string().optional(),
  file: FormFileSchema,
  kind: FormKindSchema,
  fields: z.array(FormFieldSchema),
  /** "proposed" until a staff member reviews the mapping and confirms it. Only confirmed forms are filled for patients. */
  status: FormStatusSchema,
  analysis: FormAnalysisSchema,
  confirmed: z
    .object({
      by: z.string().min(1),
      at: IsoDateTimeSchema,
      /**
       * Server attestation (POST /forms/confirm, or GET /forms/samples for the bundled maps): SHA-256 of
       * the map (kind, file, fields) and an HMAC over it. /drafts, /sign and /render accept a form as
       * confirmed only when both verify – "confirmed" is never just the browser's claim.
       */
      mapSha256: Sha256HexSchema.optional(),
      mac: z.string().optional(),
    })
    .optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** True for the bundled fictional sample forms. */
  builtIn: z.boolean().optional(),
  /** ID of the bundled sample this definition came from (GET /forms/samples/{id}/file serves its bytes). */
  sampleId: z.string().optional(),
});

/* Analysis inputs (deterministic parsing → Claude) --------------------------------------------- */

/** One block of a Word form's outline (forms/docx-outline.ts). */
export const OutlineBlockSchema = z.object({
  id: BlockIdSchema,
  kind: z.enum(["paragraph", "cell"]),
  text: z.string(),
  style: z.string().optional(),
  headingLevel: z.number().int().min(1).max(9).optional(),
  table: z.object({ t: z.number().int().nonnegative(), r: z.number().int().nonnegative(), c: z.number().int().nonnegative() }).optional(),
  /** No visible text (an empty answer cell or blank line). */
  isEmpty: z.boolean(),
  /** Contains a fill-in placeholder ("[…]", "……", "____", "Click or tap here to enter text."). */
  hasPlaceholder: z.boolean(),
  placeholderText: z.string().optional(),
  /** Number of ☐/☒ glyphs in the block. */
  checkboxGlyphs: z.number().int().nonnegative().optional(),
  inContentControl: z.boolean().optional(),
  legacyFieldName: z.string().optional(),
});

export const PdfOutlineFieldSchema = z.object({
  name: z.string(),
  type: PdfFieldTypeSchema,
  /** 1-based page number. */
  page: z.number().int().min(1),
  /** PDF points, origin bottom-left. */
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  options: z.array(z.string()).optional(),
  /** Text printed near the field (label candidates), nearest first. */
  nearbyText: z.string(),
});

/** A PDF form's outline (forms/pdf-outline.ts): AcroForm fields plus positioned page text. */
export const PdfFormOutlineSchema = z.object({
  pages: z.number().int().nonnegative(),
  fields: z.array(PdfOutlineFieldSchema),
  pageText: z.array(
    z.object({
      page: z.number().int().min(1),
      items: z.array(z.object({ str: z.string(), x: z.number(), y: z.number() })),
    }),
  ),
});

/* ------------------------------------------------------------------------------------------------
 * Auth claims
 * ----------------------------------------------------------------------------------------------*/

/** Claims in the launch token (HMAC, 10 min) issued by POST /launch to the clinic system. */
export const LaunchClaimsSchema = z.object({
  tenantId: TenantIdSchema,
  connectorId: ConnectorIdSchema,
  patientId: z.string().min(1),
  episodeId: z.string().min(1),
  clinician: ClinicianSchema,
  /** Seconds since the Unix epoch. */
  iat: z.number().int(),
  exp: z.number().int(),
  /** Unique token ID: POST /launch/verify accepts each launch token once (replays are refused). */
  jti: z.string().min(8).max(64).optional(),
});

/**
 * Claims in the session token (HMAC, 1 h).
 * kind "launch": bound to connector, patient and episode (the bundle path must match).
 * kind "demo": issued by POST /sessions/demo for the manual picker, uploads and batch; not bound to a patient.
 */
export const SessionClaimsSchema = z.object({
  tenantId: TenantIdSchema,
  sid: z.string().min(1),
  kind: SessionKindSchema,
  connectorId: ConnectorIdSchema.optional(),
  patientId: z.string().optional(),
  episodeId: z.string().optional(),
  clinician: ClinicianSchema.optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});

/** A session token as handed to the browser. */
export const SessionTokenSchema = z.object({
  token: z.string().min(1),
  expiresAt: IsoDateTimeSchema,
  claims: SessionClaimsSchema,
});

/* ------------------------------------------------------------------------------------------------
 * Connectors
 * ----------------------------------------------------------------------------------------------*/

export const ConnectorCapabilitiesSchema = z.object({
  patients: z.boolean(),
  clinicalNotes: z.boolean(),
  appointments: z.boolean(),
  outcomeMeasures: z.boolean(),
  writeBackDocuments: z.boolean(),
});

/** Connector tile data for GET /connectors. */
export const ConnectorInfoSchema = z.object({
  id: ConnectorIdSchema,
  label: z.string(),
  simulated: z.boolean(),
  status: ConnectorStatusSchema,
  capabilities: ConnectorCapabilitiesSchema,
  /** e.g. "TM3 export upload – available now" or "Needs TM3 partner access". */
  note: z.string(),
});

export const EpisodeSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: EpisodeStatusSchema,
  startDate: IsoDateSchema.optional(),
  endDate: IsoDateSchema.optional(),
  /** Used to preselect the template (solicitor → treating physio report, employer → fitness for work). */
  referralType: InstructingPartyTypeSchema.optional(),
  instructingPartyName: z.string().optional(),
});

export const PatientSummarySchema = z.object({
  connectorId: ConnectorIdSchema,
  id: z.string().min(1),
  displayName: z.string(),
  dob: IsoDateSchema.optional(),
  ageYears: z.number().int().nonnegative().optional(),
  sex: SexSchema.optional(),
  simulated: z.boolean(),
  /** True when the patient has registration details only (no episode to report on). */
  registrationOnly: z.boolean(),
  episodes: z.array(EpisodeSummarySchema),
});

/** One recorded integration call, shown in the Integration Log. Never contains note text. */
export const TraceEntrySchema = z.object({
  method: z.string(),
  url: z.string(),
  /** HTTP status; 0 when the request failed before a response. */
  status: z.number().int(),
  ms: z.number().nonnegative(),
  transport: TraceTransportSchema,
  note: z.string().optional(),
});

/** Receipt returned by a clinic system for a written-back document. */
export const AttachReceiptSchema = z.object({
  externalDocumentId: z.string().min(1),
  receivedAt: IsoDateTimeSchema,
  sha256: Sha256HexSchema,
});

/** An uploaded export (our documented import format) or pasted anonymised notes. */
export const ImportPayloadSchema = z.object({
  /** "pdf": printed / saved clinical notes as a PDF; `content` is then the file as base64. */
  format: z.enum(["json", "csv", "text", "pdf"]),
  content: z.string().min(1),
  fileName: z.string().optional(),
});

/* ------------------------------------------------------------------------------------------------
 * AI output (structured output schema for client.beta.messages.parse + betaZodOutputFormat)
 * Keep this simple: no recursion, no unions of objects, no optional fields, plain enums.
 * ----------------------------------------------------------------------------------------------*/

export const DraftParagraphOutputSchema = z.object({
  text: z
    .string()
    .describe("One paragraph in UK English. Dates as DD/MM/YYYY. Refer to the patient as [CLAIMANT]."),
  sourceIds: z
    .array(z.string())
    .min(1)
    .describe("Citable IDs supporting every statement in the paragraph: REG, N-### note IDs or FACT-* IDs."),
  basis: ParagraphBasisSchema.describe(
    "patient_reported, clinician_observed, clinician_opinion_recorded (an opinion written in a cited note) or record.",
  ),
});

export const DraftSectionOutputSchema = z.object({
  sectionKey: z.string().describe("Key of the section being drafted, exactly as given."),
  paragraphs: z.array(DraftParagraphOutputSchema),
});

export const DraftGapOutputSchema = z.object({
  sectionKey: z.string(),
  issue: z.string().describe("What the record does not say that the section needs."),
  suggestedQuestion: z.string().describe("A question the clinician could answer to close the gap."),
  relatedNoteIds: z.array(z.string()),
});

export const DraftGroupOutputSchema = z.object({
  sections: z.array(DraftSectionOutputSchema),
  gaps: z.array(DraftGapOutputSchema),
});

/* ------------------------------------------------------------------------------------------------
 * Case export (Studio "Export case JSON")
 * ----------------------------------------------------------------------------------------------*/

export const CASE_EXPORT_FORMAT = "appstackx-reports.case" as const;

/**
 * The file's envelope. Version 2 (written by this build) holds the report in the public encoding of
 * core/case-export.ts (decodeCaseReport, then ReportSchema); version 1 holds the stored Report as is.
 */
export const CaseExportSchema = z.object({
  format: z.literal(CASE_EXPORT_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: IsoDateTimeSchema,
  product: z.object({ name: z.string(), version: z.string() }),
  report: z.record(z.string(), z.unknown()),
});

/* ------------------------------------------------------------------------------------------------
 * AI output for referrer forms (Revision 2, added by the ai agent – additive).
 * Structured output schema for drafting a group of FORM FIELDS (POST /drafts with `form`). Same shape
 * as DraftGroupOutputSchema plus one `answer` string per field for structured answer types. Simple on
 * purpose (structured outputs): no unions of objects, no optional fields.
 * ----------------------------------------------------------------------------------------------*/

export const FormDraftAnswerOutputSchema = z.object({
  sectionKey: z.string().describe("The form field ID being answered, exactly as given (e.g. F-07)."),
  answer: z
    .string()
    .describe(
      'Structured answer types only: yes_no and checkbox → "Yes" or "No"; single_choice → one option exactly as printed; date → DD/MM/YYYY; number → digits only. Use "" for text answer types (the paragraphs are the answer) and whenever the record does not support an answer.',
    ),
  paragraphs: z.array(DraftParagraphOutputSchema),
});

export const FormDraftGroupOutputSchema = z.object({
  sections: z.array(FormDraftAnswerOutputSchema),
  gaps: z.array(DraftGapOutputSchema),
});
