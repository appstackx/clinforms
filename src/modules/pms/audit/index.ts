/**
 * Every clinic-system audit action and its label (orchestrator-owned aggregator: builders edit only
 * audit/<module>.ts). src/lib/activity-copy.ts merges these into the activity page's labels; the activity test
 * fails when a repository writes an action code that has no label.
 */
import { BILLING_AUDIT_LABELS, BILLING_AUDIT_TARGETS } from "./billing";
import { COMMS_AUDIT_LABELS, COMMS_AUDIT_TARGETS } from "./comms";
import { DIARY_AUDIT_LABELS, DIARY_AUDIT_TARGETS } from "./diary";
import { FOUNDATION_AUDIT_LABELS, FOUNDATION_AUDIT_TARGETS } from "./foundation";
import { INTEGRATION_AUDIT_LABELS, INTEGRATION_AUDIT_TARGETS } from "./integration";
import { PORTAL_AUDIT_LABELS, PORTAL_AUDIT_TARGETS } from "./portal";
import { RECORDS_AUDIT_LABELS, RECORDS_AUDIT_TARGETS } from "./records";
import { REPORTING_AUDIT_LABELS, REPORTING_AUDIT_TARGETS } from "./reporting";

export const PMS_AUDIT_LABELS: Readonly<Record<string, string>> = {
  ...FOUNDATION_AUDIT_LABELS,
  ...DIARY_AUDIT_LABELS,
  ...RECORDS_AUDIT_LABELS,
  ...BILLING_AUDIT_LABELS,
  ...COMMS_AUDIT_LABELS,
  ...PORTAL_AUDIT_LABELS,
  ...REPORTING_AUDIT_LABELS,
  ...INTEGRATION_AUDIT_LABELS,
};

/** The clinic-system actions (pms.*) for the activity page's "Clinic system" filter group. */
export const PMS_AUDIT_ACTIONS: readonly string[] = Object.keys(PMS_AUDIT_LABELS).filter((a) => a.startsWith("pms.") || a === "clinic.package_change");

/** Record types of the clinic system's audit rows (target_type → label), merged into the activity page's targets. */
export const PMS_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  ...FOUNDATION_AUDIT_TARGETS,
  ...DIARY_AUDIT_TARGETS,
  ...RECORDS_AUDIT_TARGETS,
  ...BILLING_AUDIT_TARGETS,
  ...COMMS_AUDIT_TARGETS,
  ...PORTAL_AUDIT_TARGETS,
  ...REPORTING_AUDIT_TARGETS,
  ...INTEGRATION_AUDIT_TARGETS,
};
