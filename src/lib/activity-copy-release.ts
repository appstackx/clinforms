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
 * The codes (bh2 WF): the server audit rows the plan names, for the workstream that writes them to use as they are –
 *   report.issue_refused     /render refused a FINAL copy whose issued content or acknowledgements no longer match the
 *                            receipt (409 ISSUED_COPY_CHANGED – WA1 design 7, "audited")
 *   report.approver_takeover a member took over as the report's approver ("Take over as approver" – WC design 1)
 *   report.superseded        an approved version was superseded when its amended version was stored approved (WC design 8)
 * Every audit action the app writes needs a label and a filter group (src/server/admin/admin.test.ts finds them in the
 * code), so a new one is added here, labelled, in that change.
 *
 * Browser-safe (no env, no server imports); neutral wording only, as activity-copy.ts.
 */

/** Audit actions the release writes for reports, listed under "Reports" in the action filter. */
export const RELEASE_REPORT_AUDIT_ACTIONS: readonly string[] = ["report.issue_refused", "report.approver_takeover", "report.superseded"];

/** Plain-English names for them. */
export const RELEASE_REPORT_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "report.issue_refused": "Final document refused – the approved content no longer matched",
  "report.approver_takeover": "Approver taken over",
  "report.superseded": "Approved report replaced by an amended version",
};

const FORMATS: Readonly<Record<string, string>> = { pdf: "PDF", docx: "Word", original: "In the referrer's own format" };

/** A short description of such an entry's details, or null (only fields known to be safe and useful). */
export const describeReleaseReportAuditDetail: (action: string, detail: Record<string, unknown>) => string | null = (action, detail) => {
  switch (action) {
    case "report.issue_refused":
      return typeof detail.format === "string" && FORMATS[detail.format] ? FORMATS[detail.format] : null;
    case "report.superseded":
      return typeof detail.version === "number" && Number.isInteger(detail.version) && detail.version > 1 ? `By version ${detail.version}` : null;
    default:
      return null;
  }
};
