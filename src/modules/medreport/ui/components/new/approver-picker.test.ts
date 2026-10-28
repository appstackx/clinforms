/**
 * bh2 WC design 1: a new report's approving clinician – who can be chosen, and the default. Fictional members only.
 */
import * as React from "react";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApproverPicker, approverOf, approverOptions, defaultApproverId, demoApprover } from "./approver-picker";

// The test runner compiles JSX with the classic runtime (React.createElement).
(globalThis as unknown as { React: typeof React }).React = React;

const CLINIC = {
  signers: [
    { userId: "usr_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" },
    { userId: "usr_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" },
  ],
};
const SARAH = { name: "Sarah Reid", userId: "usr_sarah", role: "owner" as const, hcpc: "PH-DEMO-01", canSign: true };
const PAT = { name: "Pat Morgan", userId: "usr_pat", role: "staff" as const, canSign: false };
const PRIYA = { name: "Priya Shah", userId: "usr_priya", role: "clinician" as const, hcpc: "PH-DEMO-03", canSign: false };

describe("approver picker", () => {
  it("offers the members who may approve; it starts as the member themselves when they may sign – staff always choose", () => {
    const options = approverOptions(CLINIC, SARAH);
    assert.deepEqual(options.map((o) => o.memberId), ["usr_sarah", "usr_tom"]);
    assert.equal(defaultApproverId(options, SARAH), "usr_sarah");
    assert.equal(defaultApproverId(approverOptions(CLINIC, PAT), PAT), null, "staff never approve, so they choose");
    assert.equal(defaultApproverId(approverOptions(CLINIC, PRIYA), PRIYA), null, "a clinician who may not sign chooses too");
    assert.ok(!approverOptions(CLINIC, PAT).some((o) => o.memberId === "usr_pat"));
    assert.deepEqual(approverOf(options[1]), { memberId: "usr_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" });
  });
  it("the public demo's one fictional user approves", () => {
    assert.deepEqual(demoApprover({ name: "Sarah Reid", hcpc: "PH-DEMO-01" }), { memberId: "demo", name: "Sarah Reid", hcpc: "PH-DEMO-01" });
    assert.equal(demoApprover(null), null);
  });
  it("says what to do when no member may approve yet; lists the choices otherwise", () => {
    const none = renderToStaticMarkup(createElement(ApproverPicker, { options: [], value: null, onChange: () => undefined, memberIsStaff: true }));
    assert.match(none, /No member of your clinic can approve this form yet/);
    const some = renderToStaticMarkup(createElement(ApproverPicker, { options: approverOptions(CLINIC, PAT), value: null, onChange: () => undefined, memberIsStaff: true }));
    assert.match(some, /Approving clinician/);
    assert.match(some, /Tom Ellis \(HCPC PH-DEMO-02\)/);
    assert.match(some, /waits for them to adopt it/);
  });
});
