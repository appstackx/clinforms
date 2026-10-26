/**
 * Clinic activity page (/app/settings/activity) wording for the audit actions the Blue Heart release adds to reports
 * and their review (bh2 W0 follow-up, seam "activity-labels", bh2-base2): the approver's decisions, takeovers, adoptions,
 * superseded versions – whatever the release's server code writes to the audit trail for a report.
 *
 * Owned by WF ("no raw action codes in any activity view", AC-CPY-2) and merged into src/lib/activity-copy.ts (WE's
 * file: sign-in, members, clinic, forms) – the Reports group lists RELEASE_REPORT_AUDIT_ACTIONS, the labels and detail
 * descriptions fall back to these – so neither workstream needs the other's file. The report's own activity log
 * (the review screen's Activity tab) is labelled in src/modules/medreport/ui/components/review/activity-panel.tsx (WF),
 * by the codes in src/modules/medreport/core/activity-actions.ts.
 *
 * Browser-safe (no env, no server imports); neutral wording only, as activity-copy.ts. Empty until WF adds the first.
 */

/** Audit actions the release writes for reports, listed under "Reports" in the action filter. */
export const RELEASE_REPORT_AUDIT_ACTIONS: readonly string[] = [];

/** Plain-English names for them. */
export const RELEASE_REPORT_AUDIT_LABELS: Readonly<Record<string, string>> = {};

/** A short description of such an entry's details, or null (only fields known to be safe and useful). */
export const describeReleaseReportAuditDetail: (action: string, detail: Record<string, unknown>) => string | null = () => null;
