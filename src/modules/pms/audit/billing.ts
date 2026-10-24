/**
 * Audit actions of the billing module and their plain-English labels (owned by the billing builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here.
 */
export const BILLING_AUDIT_LABELS: Readonly<Record<string, string>> = {};

/** Names of the record types its audit rows point at (target_type → label), e.g. { pms_appointment: "Appointment" }. */
export const BILLING_AUDIT_TARGETS: Readonly<Record<string, string>> = {};
