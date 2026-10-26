/**
 * Records as the records module's repositories return them (decrypted where the comment says so). Pure types.
 */
import type { BodyChart } from "./body-chart";
import type { AmendmentKind, NoteStatus } from "./notes";
import type { OutcomeAnswers, OutcomeMeasureId } from "./outcomes";
import type { AttachmentType } from "./attachments";
import type { NoteType, TemplateSnapshot } from "./templates";

/** What a note list shows (nothing decrypted). */
export interface NoteSummary {
  tenantId: string;
  id: string;
  rev: number;
  patientId: string;
  caseId: string | null;
  templateId: string;
  templateName: string;
  noteType: NoteType;
  seenOn: string;
  practitionerId: string | null;
  authorUserId: string | null;
  authorName: string | null;
  status: NoteStatus;
  signedAt: string | null;
  signedByName: string | null;
  enteredInError: boolean;
  amendmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Amendment {
  tenantId: string;
  id: string;
  noteId: string;
  kind: AmendmentKind;
  sectionKey: string | null;
  /** Decrypted. */
  text: string | null;
  /** Decrypted. */
  reason: string | null;
  authorUserId: string | null;
  authorName: string | null;
  authorRegistration: string | null;
  createdAt: string;
}

export interface ClinicalNote extends NoteSummary {
  template: TemplateSnapshot;
  /** Decrypted: section key → text. */
  sections: Record<string, string>;
  /** Decrypted. */
  bodyChart: BodyChart | null;
  signedByUserId: string | null;
  signedRegistration: string | null;
  /** sha256 of the canonical content at signing. */
  contentHash: string | null;
  anonymisedAt: string | null;
  importRef: string | null;
  amendments: Amendment[];
}

export interface OutcomeSummary {
  tenantId: string;
  id: string;
  patientId: string;
  caseId: string | null;
  noteId: string | null;
  measure: OutcomeMeasureId;
  takenOn: string;
  scoreTenths: number;
  band: string | null;
  answered: number;
  status: "recorded" | "entered_in_error";
  recordedBy: string | null;
  createdAt: string;
}

export interface OutcomeRecord extends OutcomeSummary {
  rev: number;
  /** Decrypted. */
  answers: OutcomeAnswers | null;
  /** Decrypted (why it was marked in error). */
  errorReason: string | null;
}

export interface AttachmentMeta {
  tenantId: string;
  id: string;
  patientId: string;
  noteId: string | null;
  caseId: string | null;
  type: AttachmentType;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  chunkCount: number;
  status: "active" | "withdrawn";
  uploadedBy: string | null;
  createdAt: string;
  withdrawnAt: string | null;
}

export interface AttachmentDetails extends AttachmentMeta {
  /** Decrypted. */
  fileName: string;
  /** Decrypted. */
  description: string | null;
  /** Decrypted. */
  withdrawnReason: string | null;
}

export interface AnonymisationRecord {
  tenantId: string;
  id: string;
  patientId: string;
  status: "started" | "done";
  startedAt: string;
  doneAt: string | null;
  byUserId: string | null;
}

/** What a records server action answers (forms show `error` and the field errors next to their fields). */
export type RecordsActionState =
  | { ok: true; message?: string; id?: string; rev?: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; conflict?: boolean; rev?: number }
  | null;
