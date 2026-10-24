/**
 * Audit actions of the reporting module and their plain-English labels (owned by the reporting builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here.
 */
export const REPORTING_AUDIT_LABELS: Readonly<Record<string, string>> = {};

/** Names of the record types its audit rows point at (target_type → label), e.g. { pms_appointment: "Appointment" }. */
export const REPORTING_AUDIT_TARGETS: Readonly<Record<string, string>> = {};
