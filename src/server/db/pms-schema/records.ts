/**
 * Tables of the records module (owned by the records builder – docs/clinic-system/contract.md §3–4), migrations
 * 0120–0121 / 20261024000120–…121: note templates, clinical notes and amendments, outcome measures, attached files
 * (metadata + encrypted chunks) and patient anonymisations.
 *
 * - PRIMARY KEY (tenant_id, id) everywhere; foreign keys include tenant_id AND the patient where a row belongs to
 *   one (a note's case, an amendment's note, an outcome's note, a file's note are the same patient's).
 * - Columns ending in _enc: AES-GCM with AAD "<tenant>:<table>.<column>:<id>" (src/server/repos/pms/context.ts).
 *   Attachment chunks hold the file's bytes as base64 inside the ciphertext, so the offboarding export (which
 *   decrypts every _enc column as text) carries them intact.
 * - Signed notes and amendments are locked by triggers (0121).
 */
import type { ColumnType } from "kysely";
import type { IsoTimestamp } from "../schema";

type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** "YYYY-MM-DD" */
type IsoDate = string;

export interface PmsNoteTemplatesTable {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  note_type: string;
  /** JSON array of { key, label, hint, kind } – configuration, not patient data. */
  sections_json: string;
  body_chart: WithDefault<number>;
  active: WithDefault<number>;
  sort_order: WithDefault<number>;
  /** The built-in template it was copied from. */
  based_on: string | null;
  created_by: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsClinicalNotesTable {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  case_id: string | null;
  template_id: string;
  template_name: string;
  note_type: string;
  /** The template's snapshot when the note was started (JSON, plain). */
  template_json: string;
  seen_on: IsoDate;
  practitioner_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  /** "draft" | "signed" | "discarded" */
  status: WithDefault<string>;
  /** JSON { sectionKey: text }, encrypted. */
  sections_enc: string | null;
  /** JSON { markers: […] }, encrypted. */
  body_chart_enc: string | null;
  /** sha256 hex of the canonical content at signing. */
  content_hash: string | null;
  signed_at: IsoTimestamp | null;
  signed_by_user_id: string | null;
  signed_by_name: string | null;
  signed_registration: string | null;
  entered_in_error: WithDefault<number>;
  amendment_count: WithDefault<number>;
  discarded_at: IsoTimestamp | null;
  anonymised_at: IsoTimestamp | null;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsNoteAmendmentsTable {
  tenant_id: string;
  id: string;
  note_id: string;
  patient_id: string;
  /** "addendum" | "correction" | "entered_in_error" */
  kind: string;
  section_key: string | null;
  text_enc: string | null;
  reason_enc: string | null;
  author_user_id: string | null;
  author_name: string | null;
  author_registration: string | null;
  anonymised_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

export interface PmsOutcomeMeasuresTable {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  case_id: string | null;
  note_id: string | null;
  /** "ndi" | "odi" | "nprs" | "psfs" | "quickdash" */
  measure: string;
  taken_on: IsoDate;
  /** The score × 10 (42.5 % → 425). */
  score_tenths: number;
  band: string | null;
  answered: number;
  /** JSON { items, activities? }, encrypted. */
  answers_enc: string | null;
  /** "recorded" | "entered_in_error" */
  status: WithDefault<string>;
  error_reason_enc: string | null;
  error_at: IsoTimestamp | null;
  recorded_by: string | null;
  anonymised_at: IsoTimestamp | null;
  import_ref: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsAttachmentsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  note_id: string | null;
  case_id: string | null;
  /** "pdf" | "jpeg" | "png" | "docx" (from the file's own bytes) */
  file_type: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  chunk_count: number;
  file_name_enc: string | null;
  description_enc: string | null;
  /** "active" | "withdrawn" */
  status: WithDefault<string>;
  withdrawn_at: IsoTimestamp | null;
  withdrawn_by: string | null;
  withdrawn_reason_enc: string | null;
  uploaded_by: string | null;
  anonymised_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PmsAttachmentChunksTable {
  tenant_id: string;
  /** "<attachment id>.<idx>" */
  id: string;
  attachment_id: string;
  idx: number;
  /** base64 of ≤ 256 KiB of the file, encrypted (null once anonymised). */
  data_enc: string | null;
  created_at: IsoTimestamp;
}

export interface PmsPatientAnonymisationsTable {
  tenant_id: string;
  id: string;
  patient_id: string;
  /** "started" | "done" */
  status: string;
  started_at: IsoTimestamp;
  done_at: IsoTimestamp | null;
  by_user_id: string | null;
  /** JSON counts of what was anonymised (no content). */
  counts_json: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface RecordsTables {
  pms_note_templates: PmsNoteTemplatesTable;
  pms_clinical_notes: PmsClinicalNotesTable;
  pms_note_amendments: PmsNoteAmendmentsTable;
  pms_outcome_measures: PmsOutcomeMeasuresTable;
  pms_attachments: PmsAttachmentsTable;
  pms_attachment_chunks: PmsAttachmentChunksTable;
  pms_patient_anonymisations: PmsPatientAnonymisationsTable;
}

/** Foreign-key order (parents first). */
export const RECORDS_TABLES = [
  "pms_note_templates",
  "pms_clinical_notes",
  "pms_note_amendments",
  "pms_outcome_measures",
  "pms_attachments",
  "pms_attachment_chunks",
  "pms_patient_anonymisations",
] as const satisfies readonly (keyof RecordsTables)[];

export const RECORDS_PRIMARY_KEYS: { readonly [T in (typeof RECORDS_TABLES)[number]]: readonly (keyof RecordsTables[T] & string)[] } = {
  pms_note_templates: ["tenant_id", "id"],
  pms_clinical_notes: ["tenant_id", "id"],
  pms_note_amendments: ["tenant_id", "id"],
  pms_outcome_measures: ["tenant_id", "id"],
  pms_attachments: ["tenant_id", "id"],
  pms_attachment_chunks: ["tenant_id", "id"],
  pms_patient_anonymisations: ["tenant_id", "id"],
};

/** Timestamp columns besides created_at / updated_at (TEXT in SQLite, timestamptz in Postgres). */
export const RECORDS_TIMESTAMP_COLUMNS: readonly string[] = ["signed_at", "discarded_at", "anonymised_at", "error_at", "withdrawn_at", "started_at", "done_at"];

/** Every records table holds one clinic's own data (offboarding exports and deletes them). */
export const RECORDS_TENANT_TABLES: readonly (typeof RECORDS_TABLES)[number][] = RECORDS_TABLES;
