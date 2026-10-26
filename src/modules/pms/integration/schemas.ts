/**
 * Inputs of the integration module's repositories (zod v4) – the source of truth for what they accept. Pure.
 */
import { z } from "zod";
import { IsoDateSchema, PmsIdSchema, optionalText } from "../core/schemas";
import { CSV_LIMITS } from "./csv";
import { IMPORT_KINDS } from "./import-kinds";

export const ImportKindSchema = z.enum(IMPORT_KINDS);

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "A SHA-256 digest (64 hex characters)");

/** A data row of an import file, as stored (JSON of the cells): at most 64 KB. */
export const MAX_IMPORT_ROW_BYTES = 64 * 1024;
/** Rows per upload request (the page sends the file in parts). */
export const MAX_IMPORT_ROWS_PER_PART = 1000;

export const ImportBatchInputSchema = z.object({
  kind: ImportKindSchema,
  /** The uploaded file's name (stored encrypted – it may name a person). */
  fileName: optionalText(200),
  fileSha256: z.union([Sha256Schema, z.null()]).optional(),
  delimiter: z.enum([",", ";", "\t"]),
  headers: z
    .array(z.string().max(200, "A column name is longer than 200 characters"))
    .min(1, "The file has no columns")
    .max(CSV_LIMITS.maxColumns, `At most ${CSV_LIMITS.maxColumns} columns`),
  expectedRows: z
    .number()
    .int()
    .min(1, "The file has no rows")
    .max(CSV_LIMITS.maxRows, `At most ${CSV_LIMITS.maxRows.toLocaleString("en-GB")} rows in one file`),
});
export type ImportBatchInput = z.input<typeof ImportBatchInputSchema>;

export const ImportRowsPartSchema = z.object({
  /** Row number (1-based, the header not counted) of the first row in `rows`. */
  firstRowNo: z.number().int().min(1),
  rows: z
    .array(z.array(z.string().max(CSV_LIMITS.maxFieldLength)))
    .min(1)
    .max(MAX_IMPORT_ROWS_PER_PART),
});
export type ImportRowsPart = z.input<typeof ImportRowsPartSchema>;

export const ImportApprovalSchema = z.object({
  /** The person checking confirms they compared the sample with the earlier system. */
  sampleChecked: z.literal(true, { message: "Confirm that you compared the sample with the earlier system" }),
  /** Required when some rows will not be imported: they are left out on purpose. */
  leaveOutProblemRows: z.boolean().optional(),
});
export type ImportApproval = z.input<typeof ImportApprovalSchema>;

export const FormRequestInputSchema = z
  .object({
    patientId: PmsIdSchema,
    caseId: PmsIdSchema,
    /** Who the form is for (the case's payer by default). */
    referrerId: z.union([PmsIdSchema, z.null()]).optional(),
    /** The patient agreed that the completed form may be shared with the referrer. */
    consentRecorded: z.boolean(),
    consentOn: z.union([IsoDateSchema, z.null()]).optional(),
    /** How consent was given ("signed the clinic's consent form"). Encrypted. */
    consentNote: optionalText(1000),
  })
  .refine((v) => !v.consentRecorded || Boolean(v.consentOn), { message: "Enter the date the patient agreed", path: ["consentOn"] });
export type FormRequestInput = z.input<typeof FormRequestInputSchema>;

export const FILED_FORM_MIME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export const MAX_FILED_FORM_BYTES = 10 * 1024 * 1024;

export const FiledFormInputSchema = z.object({
  patientId: PmsIdSchema,
  caseId: PmsIdSchema,
  title: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(FILED_FORM_MIME_TYPES),
  sha256: Sha256Schema,
  reportId: z.string().min(1).max(128),
  /** The approval receipt as ClinForms issued it (no patient data). */
  receipt: z.record(z.string(), z.unknown()),
  signerName: optionalText(160),
  signerRegistration: optionalText(40),
  signedAt: z.union([z.string().max(40), z.null()]).optional(),
});
export type FiledFormInput = z.input<typeof FiledFormInputSchema>;
