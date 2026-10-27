/**
 * Settings forms say how a save went right next to the button that was clicked (test run 24/10/2026: "Saved." on
 * Settings → Clinic appeared at the top of the form, out of sight after clicking Save at the bottom).
 *
 * Rendered with react-dom/server. React 18's react-dom has no useFormState/useFormStatus (Next bundles its own React),
 * so the test supplies both: useFormState returns the outcome under test, as if the server action had just answered.
 */
import * as React from "react";
import ReactDOM from "react-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The test runner compiles JSX with the classic runtime (React.createElement).
(globalThis as unknown as { React: typeof React }).React = React;

// React 18's react-dom drops a function form action (Next's React posts it) with a warning: expected here.
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (String(args[0]).startsWith("Warning: Invalid value for prop") && args[1] === "`action`") return;
  consoleError(...args);
};

let outcome: unknown = null;
Object.assign(ReactDOM, {
  useFormState: (action: unknown) => [outcome, action],
  useFormStatus: () => ({ pending: false }),
});

function render(element: ReactElement, state: unknown): string {
  outcome = state;
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text after `button` (its label) up to the next field or the end. */
function afterButton(visible: string, button: string): string {
  const at = visible.indexOf(button);
  assert.ok(at >= 0, `no "${button}" in: ${visible}`);
  return visible.slice(at + button.length).trim();
}

const CLINIC = {
  displayName: "Larch Physio (fictional)",
  legalName: "",
  address: "",
  postcode: "",
  phone: "",
  email: "",
  retentionDays: 365,
  draftingEnabled: true,
};

describe("settings forms: the outcome sits next to the button that was clicked", () => {
  it("Clinic details (with the drafting switch): 'Saved.' or the error after Save clinic details, not above the form", async () => {
    const { ClinicProfileForm } = await import("../../app/app/(clinic)/settings/clinic/form");
    const form = createElement(ClinicProfileForm, { values: CLINIC, editable: true });
    const saved = render(form, { ok: true });
    assert.equal(afterButton(saved, "Save clinic details"), "Saved.");
    assert.ok(saved.startsWith("Clinic name"), saved);
    const failed = render(form, { ok: false, error: "Enter a UK postcode." });
    assert.equal(afterButton(failed, "Save clinic details"), "Enter a UK postcode.");
    assert.equal(render(form, null).endsWith("Save clinic details"), true, "nothing before a save");
  });

  it("Members → Manage: signing details and role", async () => {
    const { RoleForm, SigningForm } = await import("../../app/app/(clinic)/settings/members/forms");
    const signing = createElement(SigningForm, { memberId: "m1", jobTitle: "Physiotherapist", hcpcNumber: "ZZ0001", canSign: true, staff: false });
    assert.equal(afterButton(render(signing, { ok: true }), "Save signing details"), "Saved.");
    assert.equal(afterButton(render(signing, { ok: false, error: "Check the HCPC number." }), "Save signing details"), "Check the HCPC number.");
    const role = createElement(RoleForm, { memberId: "m1", roles: ["admin", "clinician", "staff"], current: "clinician" });
    assert.equal(afterButton(render(role, { ok: true }), "Change role"), "Role changed.");
  });

  it("Members → Invite: 'Invitation emailed to …' right under the Invite button, before the role descriptions", async () => {
    const { InviteForm } = await import("../../app/app/(clinic)/settings/members/forms");
    const invite = createElement(InviteForm, { roles: ["admin", "clinician", "staff"] });
    const sent = { ok: true, email: "sarah.reid@example.com", role: "clinician", link: null, delivery: "sent", expiresAt: "2026-10-31T19:10:00.000Z" };
    assert.match(afterButton(render(invite, sent), "Invite"), /^Invitation emailed to sarah\.reid@example\.com\..*Administrator:/);
    assert.match(afterButton(render(invite, { ok: false, error: "Enter a valid email address." }), "Invite"), /^Enter a valid email address\. Administrator:/);
  });

  it("Security → Backup codes: the error under the button", async () => {
    const { BackupCodesForm } = await import("../../app/app/(clinic)/settings/security/forms");
    assert.equal(afterButton(render(createElement(BackupCodesForm), { ok: false, error: "Wrong password." }), "Make new backup codes"), "Wrong password.");
  });
});
