/**
 * Audit actions of the reporting and set-up module and their plain-English labels (owned by the reporting
 * builder – contract §7). Codes: "pms.<entity>.<verb>", lower case. Details hold ids, counts and flags only.
 * The directory itself (sites, rooms, practitioners, appointment types, prices, referrers, record keeping) is
 * written through the foundation's repositories and keeps the foundation's codes.
 */
export const REPORTING_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.opening_hours.set": "Opening hours changed",
  "pms.closure.create": "Closure added",
  "pms.closure.remove": "Closure removed",
  "pms.report_targets.set": "Report targets changed",
  "pms.report.export": "Report downloaded",
  "pms.audit.export": "Audit trail downloaded",
};

/** Names of the record types its audit rows point at (target_type → label); also the audit search's areas. */
export const REPORTING_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_opening_hours: "Opening hours",
  pms_closure: "Closure",
  pms_reporting_settings: "Report targets",
  pms_report: "Clinic report",
  pms_audit: "Audit trail",
};
