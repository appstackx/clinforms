/**
 * bh2 WF (AC-CPY-2): the clinic's activity page (/app/settings/activity) shows the release's report audit actions by
 * name – each has its own label, sits in the Reports filter and describes only known, safe detail fields. Neutral
 * wording (core/wording.ts). The review's Activity tab is tested in
 * src/modules/medreport/ui/components/review/activity-labels.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasBannedTerm } from "../modules/medreport/core/wording";
import { ACTIVITY_GROUPS, ACTIVITY_LABELS, activityLabel, describeActivityDetail } from "./activity-copy";
import { RELEASE_REPORT_AUDIT_ACTIONS, RELEASE_REPORT_AUDIT_LABELS } from "./activity-copy-release";

test("the release's report audit actions have their own labels, a filter group and safe details", () => {
  const reports = ACTIVITY_GROUPS.find((g) => g.label === "Reports");
  assert.deepEqual([...RELEASE_REPORT_AUDIT_ACTIONS].sort(), Object.keys(RELEASE_REPORT_AUDIT_LABELS).sort(), "every listed action has a label");
  for (const code of RELEASE_REPORT_AUDIT_ACTIONS) {
    assert.ok(ACTIVITY_LABELS[code], code);
    assert.equal(activityLabel(code), RELEASE_REPORT_AUDIT_LABELS[code], `${code}: its own label, not a name made from the code`);
    assert.ok(reports?.actions.includes(code), `${code} in the Reports filter`);
    assert.equal(hasBannedTerm(RELEASE_REPORT_AUDIT_LABELS[code]), false);
  }
  assert.equal(activityLabel("report.issue_refused"), "Final document refused – the approved content no longer matched");
  assert.equal(describeActivityDetail("report.issue_refused", { format: "original", reportId: "rpt_1" }), "In the referrer's own format");
  assert.equal(describeActivityDetail("report.issue_refused", { reason: "x" }), null, "unknown fields are never shown");
  assert.equal(describeActivityDetail("report.superseded", { version: 2 }), "By version 2");
  assert.equal(describeActivityDetail("report.superseded", { version: "2" }), null);
  assert.equal(describeActivityDetail("report.approver_takeover", { from: "mem_tom" }), null);
});
