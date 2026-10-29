/**
 * Audit actions of the integration module and their plain-English labels (owned by the integration builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here.
 */
export const INTEGRATION_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.import_batch.create": "Data import started",
  "pms.import_batch.rows_add": "Data import file uploaded (part)",
  "pms.import_batch.upload": "Data import file uploaded",
  "pms.import_batch.map": "Data import columns matched",
  "pms.import_batch.check": "Data import checked",
  "pms.import_batch.approve": "Data import approved to run",
  "pms.import_batch.commit": "Data imported",
  "pms.import_batch.undo": "Data import undone",
  "pms.import_batch.cancel": "Data import cancelled",
  "pms.import_batch.close": "Data import closed",
  "pms.appointment.import_undo": "Imported appointments removed (import undone)",
  "pms.form_request.create": "Referrer form started from a case",
  "pms.filed_form.create": "Approved referrer form filed to a case",
  "pms.filed_form.view": "Filed referrer form opened",
  "pms.native.bundle_read": "Case record read to complete a referrer form",
};

/** Names of the record types its audit rows point at (target_type → label), e.g. { pms_appointment: "Appointment" }. */
export const INTEGRATION_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_import_batch: "Data import",
  pms_form_request: "Referrer form request",
  pms_filed_form: "Filed referrer form",
};
