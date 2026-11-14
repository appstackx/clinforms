/**
 * "Send a message" (14/11/2026 fix): choosing a patient in the search reset the form to empty. Every server action on
 * the clinic pages renews the session cookie, so Next refreshes the route and the page hands the form a NEW view for
 * the same request – without the chosen patient – and the form replaced its own view with it. mergeSendFormView keeps
 * the chosen patient unless the server names one itself. Run by `npm run test:pms`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { mergeSendFormView, type SendFormView } from "./view";

const patient = (id: string, name: string) =>
  ({ id, name, mobile: "07700 900123", email: null, sms: null, emailService: "No email address", smsMarketing: "No consent", emailMarketing: "No email address" }) as unknown as NonNullable<SendFormView["patient"]>;
const view = (p: SendFormView["patient"], templates: SendFormView["templates"] = []): SendFormView => ({ patient: p, templates, shortName: "Larkfield", clinicName: "Larkfield Physio (fictional)" });

describe("send form – the patient chosen in the search survives a page refresh", () => {
  it("a refreshed page without a patient keeps the chosen patient, with the page's new templates", () => {
    const chosen = view(patient("pat_1", "Olivia Bennett"));
    const tpl = [{ id: "t1", name: "Message (text)", channel: "sms" as const, purpose: "service" as const, subject: null, body: "Hello" }];
    const merged = mergeSendFormView(chosen, view(null, tpl));
    assert.equal(merged.patient?.id, "pat_1");
    assert.deepEqual(merged.templates, tpl);
  });
  it("a patient named by the server (?patient= or the record's) replaces the chosen one", () => {
    assert.equal(mergeSendFormView(view(patient("pat_1", "Olivia Bennett")), view(patient("pat_2", "Megan Hart"))).patient?.id, "pat_2");
  });
  it("no patient anywhere: the empty form", () => {
    assert.equal(mergeSendFormView(view(null), view(null)).patient, null);
  });
  it("the form uses it, and 'Someone else' clears the chosen patient itself", () => {
    const src = fs.readFileSync(path.resolve("src/components/pms/comms/send-form.tsx"), "utf8");
    assert.match(src, /React\.useEffect\(\(\) => setView\(\(current\) => mergeSendFormView\(current, initial\)\), \[initial\]\);/);
    assert.doesNotMatch(src, /React\.useEffect\(\(\) => setView\(initial\), \[initial\]\)/, "the old reset is gone");
    assert.match(src, /setView\(\(v\) => \(\{ \.\.\.v, patient: null \}\)\);\s*router\.push\(`\$\{MESSAGES_PATH\}\?tab=send`\);/);
  });
});
