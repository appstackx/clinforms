/**
 * Record id prefixes of the integration module (data import, the native connector's filed forms and form
 * requests). An id is "<prefix>_<ULID>", made by the repositories. Never reuse another module's prefix
 * (docs/clinic-system/contract.md §4).
 */
export const INTEGRATION_ID_PREFIXES = {
  /** One import run: one file of one kind (patients, cases, appointments, invoices). */
  importBatch: "imp",
  /** One row of an import file, staged (encrypted) until it is imported. */
  importRow: "impr",
  /** A completed, approved referrer form filed to the patient's record. */
  filedForm: "ffm",
  /** One encrypted part of a filed form's file. */
  filedFormPart: "ffp",
  /** "Complete referrer form" started from a case: the referrer and the patient's consent to share. */
  formRequest: "frq",
} as const;
