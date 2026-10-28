/**
 * The patient's pronouns and clinical flags (pure, browser-safe) – the two parts of the record that the shared
 * patient table does not hold (records tables pms_patient_extras and pms_clinical_flags, migration 0125).
 *
 * - Pronouns ("she/her") are shown with the name, like the title: plain, everyone who sees the record sees them.
 * - Clinical flags (K2-PAT-014, "Clinical: on anticoagulants") are clinical information: encrypted, read and written
 *   only with the clinical permissions (clinicians, owners, administrators) – never reception. A flag is ended when
 *   it no longer applies; nothing is deleted. Medical alerts (allergies etc., the shared record's encrypted
 *   `alerts`) stay visible to reception: they matter for everyone who handles the patient.
 */
import { z } from "zod";

export const MAX_PRONOUNS_CHARS = 40;
export const MAX_FLAG_CHARS = 120;
/** Active flags on one record (more would hide each other in the header). */
export const MAX_ACTIVE_FLAGS = 8;

export const PronounsSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() || null : null))
  .refine((v) => v === null || v.length <= MAX_PRONOUNS_CHARS, `At most ${MAX_PRONOUNS_CHARS} characters`);

export const ClinicalFlagInputSchema = z.object({
  text: z
    .string({ error: "Write the flag" })
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .refine((v) => v.length > 0, "Write the flag")
    .refine((v) => v.length <= MAX_FLAG_CHARS, `At most ${MAX_FLAG_CHARS} characters`),
});
export type ClinicalFlagInput = z.input<typeof ClinicalFlagInputSchema>;

export interface ClinicalFlag {
  tenantId: string;
  id: string;
  rev: number;
  patientId: string;
  /** Decrypted (null once anonymised). */
  text: string | null;
  status: "active" | "ended";
  createdBy: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface PatientExtras {
  pronouns: string | null;
  /** 0 = nothing recorded yet. */
  rev: number;
}

export const EMPTY_PATIENT_EXTRAS: PatientExtras = { pronouns: null, rev: 0 };

/** "Mrs · she/her" – the line beside the name (null when neither is recorded). */
export function titleLine(title: string | null | undefined, pronouns: string | null | undefined): string | null {
  const parts = [title?.trim(), pronouns?.trim()].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}
