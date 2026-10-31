/**
 * Audit actions of the records module and their plain-English labels (owned by the records builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here. Details hold ids,
 * counts, kinds and statuses only – never note text, names or dates of birth.
 */
export const RECORDS_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.note.create": "Clinical note started",
  "pms.note.save": "Clinical note draft saved",
  "pms.note.sign": "Clinical note signed and locked",
  "pms.note.discard": "Clinical note draft discarded",
  "pms.note.amend": "Clinical note amended",
  "pms.note.view": "Clinical note opened",
  "pms.note_template.create": "Note template added",
  "pms.note_template.update": "Note template updated",
  "pms.note_template.retire": "Note template retired",
  "pms.note_template.restore": "Note template back in use",
  "pms.records_settings.update": "Clinical note settings changed",
  "pms.outcome.record": "Outcome measure recorded",
  "pms.outcome.error": "Outcome measure marked as entered in error",
  "pms.attachment.upload": "File attached to a patient record",
  "pms.attachment.download": "Attached file downloaded",
  "pms.attachment.withdraw": "Attached file withdrawn",
  "pms.patient.export": "Patient record exported (subject access)",
  "pms.patient.anonymise": "Patient record anonymised",
  "pms.note.bulk_create": "Clinical notes added in bulk",
  "pms.outcome.bulk_create": "Outcome measures added in bulk",
  "pms.patient_extras.update": "Pronouns changed",
  "pms.clinical_flag.add": "Clinical flag added",
  "pms.clinical_flag.end": "Clinical flag ended",
  "pms.patients.export": "Patient list exported (CSV)",
};

/** Names of the record types its audit rows point at (target_type → label). */
export const RECORDS_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_note: "Clinical note",
  pms_note_template: "Note template",
  pms_outcome: "Outcome measure",
  pms_attachment: "Attached file",
  pms_records_settings: "Clinical note settings",
  pms_patient_extras: "Patient details",
  pms_clinical_flag: "Clinical flag",
  pms_patient_list: "Patient list",
};
