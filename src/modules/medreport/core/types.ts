/**
 * TypeScript types inferred from `core/schemas.ts` (the source of truth). Pure; safe everywhere.
 * Shared contract: do not change exported shapes (additive optional fields only, in schemas.ts).
 */
import type { z } from "zod";
import type * as S from "./schemas";

export type TenantId = z.infer<typeof S.TenantIdSchema>;
export type IsoDate = z.infer<typeof S.IsoDateSchema>;
export type IsoDateTime = z.infer<typeof S.IsoDateTimeSchema>;
export type SectionKey = z.infer<typeof S.SectionKeySchema>;

export type ConnectorId = z.infer<typeof S.ConnectorIdSchema>;
export type ConnectorStatus = z.infer<typeof S.ConnectorStatusSchema>;
export type InstructingPartyType = z.infer<typeof S.InstructingPartyTypeSchema>;
export type Sex = z.infer<typeof S.SexSchema>;
export type IncidentType = z.infer<typeof S.IncidentTypeSchema>;
export type NoteType = z.infer<typeof S.NoteTypeSchema>;
export type AppointmentStatus = z.infer<typeof S.AppointmentStatusSchema>;
export type OutcomeInstrument = z.infer<typeof S.OutcomeInstrumentSchema>;
export type EpisodeStatus = z.infer<typeof S.EpisodeStatusSchema>;
export type SectionKind = z.infer<typeof S.SectionKindSchema>;
export type RecordsBlock = z.infer<typeof S.RecordsBlockSchema>;
export type ScopeField = z.infer<typeof S.ScopeFieldSchema>;
export type ParagraphOrigin = z.infer<typeof S.ParagraphOriginSchema>;
export type ParagraphBasis = z.infer<typeof S.ParagraphBasisSchema>;
export type ReportSectionStatus = z.infer<typeof S.ReportSectionStatusSchema>;
export type ReportStatus = z.infer<typeof S.ReportStatusSchema>;
export type FlagSeverity = z.infer<typeof S.FlagSeveritySchema>;
export type DataCheckSeverity = z.infer<typeof S.DataCheckSeveritySchema>;
export type ReportFlagCode = z.infer<typeof S.ReportFlagCodeSchema>;
export type DataCheckCode = z.infer<typeof S.DataCheckCodeSchema>;
export type GenerationMode = z.infer<typeof S.GenerationModeSchema>;
export type AiMode = z.infer<typeof S.AiModeSchema>;
export type AiEffort = z.infer<typeof S.AiEffortSchema>;
export type SessionKind = z.infer<typeof S.SessionKindSchema>;
export type ApprovalKind = z.infer<typeof S.ApprovalKindSchema>;
export type TraceTransport = z.infer<typeof S.TraceTransportSchema>;

export type NoteId = z.infer<typeof S.NoteIdSchema>;
export type FactId = z.infer<typeof S.FactIdSchema>;
export type SourceId = z.infer<typeof S.SourceIdSchema>;

export type Clinician = z.infer<typeof S.ClinicianSchema>;
export type ClinicDetails = z.infer<typeof S.ClinicDetailsSchema>;
export type PatientRegistration = z.infer<typeof S.PatientRegistrationSchema>;
export type InstructingParty = z.infer<typeof S.InstructingPartySchema>;
export type Referral = z.infer<typeof S.ReferralSchema>;
export type Incident = z.infer<typeof S.IncidentSchema>;
export type Note = z.infer<typeof S.NoteSchema>;
export type Appointment = z.infer<typeof S.AppointmentSchema>;
export type OutcomePoint = z.infer<typeof S.OutcomePointSchema>;
export type OutcomeMeasureSeries = z.infer<typeof S.OutcomeMeasureSeriesSchema>;
export type Consent = z.infer<typeof S.ConsentSchema>;
export type EpisodeSource = z.infer<typeof S.EpisodeSourceSchema>;
export type EpisodeBundle = z.infer<typeof S.EpisodeBundleSchema>;
export type EpisodeRef = z.infer<typeof S.EpisodeRefSchema>;

export type ComputedFact = z.infer<typeof S.ComputedFactSchema>;
export type DataCheck = z.infer<typeof S.DataCheckSchema>;

export type TemplateSection = z.infer<typeof S.TemplateSectionSchema>;
export type TemplateScope = z.infer<typeof S.TemplateScopeSchema>;
export type ReportTemplate = z.infer<typeof S.ReportTemplateSchema>;

export type Paragraph = z.infer<typeof S.ParagraphSchema>;
export type ReportSection = z.infer<typeof S.ReportSectionSchema>;
export type GapResolution = z.infer<typeof S.GapResolutionSchema>;
export type Gap = z.infer<typeof S.GapSchema>;
export type FlagAcknowledgement = z.infer<typeof S.FlagAcknowledgementSchema>;
export type ReportFlag = z.infer<typeof S.ReportFlagSchema>;
export type TokenUsage = z.infer<typeof S.TokenUsageSchema>;
export type GenerationMeta = z.infer<typeof S.GenerationMetaSchema>;
export type ActivityEntry = z.infer<typeof S.ActivityEntrySchema>;
export type SignReceipt = z.infer<typeof S.SignReceiptSchema>;
export type Report = z.infer<typeof S.ReportSchema>;

export type LaunchClaims = z.infer<typeof S.LaunchClaimsSchema>;
export type SessionClaims = z.infer<typeof S.SessionClaimsSchema>;
export type SessionToken = z.infer<typeof S.SessionTokenSchema>;

export type ConnectorCapabilities = z.infer<typeof S.ConnectorCapabilitiesSchema>;
export type ConnectorInfo = z.infer<typeof S.ConnectorInfoSchema>;
export type EpisodeSummary = z.infer<typeof S.EpisodeSummarySchema>;
export type PatientSummary = z.infer<typeof S.PatientSummarySchema>;
export type TraceEntry = z.infer<typeof S.TraceEntrySchema>;
export type AttachReceipt = z.infer<typeof S.AttachReceiptSchema>;
export type ImportPayload = z.infer<typeof S.ImportPayloadSchema>;

export type DraftParagraphOutput = z.infer<typeof S.DraftParagraphOutputSchema>;
export type DraftSectionOutput = z.infer<typeof S.DraftSectionOutputSchema>;
export type DraftGapOutput = z.infer<typeof S.DraftGapOutputSchema>;
export type DraftGroupOutput = z.infer<typeof S.DraftGroupOutputSchema>;

/** The case export file's envelope as read on import (the report inside is checked separately). */
export type CaseExportEnvelope = z.infer<typeof S.CaseExportSchema>;

/* Referrer forms (Revision 2) */
export type FormFieldId = z.infer<typeof S.FormFieldIdSchema>;
export type ReferrerType = z.infer<typeof S.ReferrerTypeSchema>;
export type ReferrerInfo = z.infer<typeof S.ReferrerInfoSchema>;
export type FormMimeType = z.infer<typeof S.FormMimeTypeSchema>;
export type FormKind = z.infer<typeof S.FormKindSchema>;
export type AnswerType = z.infer<typeof S.AnswerTypeSchema>;
export type FormAnswerKind = z.infer<typeof S.FormAnswerKindSchema>;
export type FormFieldConfidence = z.infer<typeof S.FormFieldConfidenceSchema>;
export type FormStatus = z.infer<typeof S.FormStatusSchema>;
export type FormAnalysisMode = z.infer<typeof S.FormAnalysisModeSchema>;
export type DocxAnchorTarget = z.infer<typeof S.DocxAnchorTargetSchema>;
export type PdfFieldType = z.infer<typeof S.PdfFieldTypeSchema>;
export type RegistrationPath = z.infer<typeof S.RegistrationPathSchema>;
export type ComputedFactFormat = z.infer<typeof S.ComputedFactFormatSchema>;
export type SignoffPart = z.infer<typeof S.SignoffPartSchema>;
export type Party = z.infer<typeof S.PartySchema>;
export type FormAnswer = z.infer<typeof S.FormAnswerSchema>;
export type ReportFormRef = z.infer<typeof S.ReportFormRefSchema>;
export type FormFile = z.infer<typeof S.FormFileSchema>;
export type BlockId = z.infer<typeof S.BlockIdSchema>;
export type OptionGlyph = z.infer<typeof S.OptionGlyphSchema>;
export type DocxAnchor = z.infer<typeof S.DocxAnchorSchema>;
export type PdfFieldAnchor = z.infer<typeof S.PdfFieldAnchorSchema>;
export type PdfOverlayAnchor = z.infer<typeof S.PdfOverlayAnchorSchema>;
export type PdfOptionField = z.infer<typeof S.PdfOptionFieldSchema>;
export type PdfCharFormat = z.infer<typeof S.PdfCharFormatSchema>;
export type PdfCharFieldsAnchor = z.infer<typeof S.PdfCharFieldsAnchorSchema>;
export type FormAnchor = z.infer<typeof S.FormAnchorSchema>;
export type FillSource = z.infer<typeof S.FillSourceSchema>;
export type FillSourceKind = FillSource["kind"];
export type FormField = z.infer<typeof S.FormFieldSchema>;
export type FormAnalysis = z.infer<typeof S.FormAnalysisSchema>;
export type FormDefinition = z.infer<typeof S.FormDefinitionSchema>;
export type OutlineBlock = z.infer<typeof S.OutlineBlockSchema>;
export type PdfOutlineField = z.infer<typeof S.PdfOutlineFieldSchema>;
export type PdfFormOutline = z.infer<typeof S.PdfFormOutlineSchema>;

/* Tables, tick boxes and flat-PDF boxes (S2, additive) */
export type FormAnswerRow = z.infer<typeof S.FormAnswerRowSchema>;
export type FormTableColumn = z.infer<typeof S.FormTableColumnSchema>;
export type PdfTableAnchor = z.infer<typeof S.PdfTableAnchorSchema>;
export type PdfOverlayTableAnchor = z.infer<typeof S.PdfOverlayTableAnchorSchema>;
export type PdfOverlayTicksAnchor = z.infer<typeof S.PdfOverlayTicksAnchorSchema>;
export type AppointmentColumn = z.infer<typeof S.AppointmentColumnSchema>;
export type PdfBox = z.infer<typeof S.PdfBoxSchema>;

/* AI output for referrer forms (Revision 2, added by the ai agent – additive) */
export type FormDraftAnswerOutput = z.infer<typeof S.FormDraftAnswerOutputSchema>;
export type FormDraftGroupOutput = z.infer<typeof S.FormDraftGroupOutputSchema>;
