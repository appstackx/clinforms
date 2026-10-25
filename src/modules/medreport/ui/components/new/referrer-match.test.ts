import { test } from "node:test";
import assert from "node:assert/strict";
import type { FormDefinition } from "../../../core/types";
import { distinctiveTokens, matchReferrerForm, normaliseOrgName } from "./referrer-match";

function form(id: string, name: string, updatedAt = "2026-10-01T09:00:00.000Z"): FormDefinition {
  return { id, referrer: { name, type: "mlc" }, updatedAt } as unknown as FormDefinition;
}

const FORMS = [
  form("hp", "Harrow & Pike Medico-Legal (fictional)"),
  form("nf", "Northfield Assurance (fictional)"),
  form("kw", "Kingsway Case Management (fictional)"),
];

test("normalises organisation names and drops generic words", () => {
  assert.equal(normaliseOrgName("Harrow & Pike Solicitors (fictional)"), "harrow and pike solicitors");
  assert.deepEqual(distinctiveTokens("Harrow & Pike Solicitors (fictional)"), ["harrow", "pike"]);
  assert.deepEqual(distinctiveTokens("Ashby Freight Ltd (fictional)"), ["ashby"]);
});

test("the solicitor's referral matches the same firm's medico-legal form (two distinctive words)", () => {
  const m = matchReferrerForm({ name: "Harrow & Pike Solicitors (fictional)" }, FORMS);
  assert.equal(m?.form.id, "hp");
  assert.equal(m?.reason, "similar_name");
});

test("one shared word is not enough (employer vs an unrelated insurer)", () => {
  assert.equal(matchReferrerForm({ name: "Ashby Freight Ltd (fictional)" }, FORMS), null);
  assert.equal(matchReferrerForm({ name: "Northfield Freight Ltd (fictional)" }, FORMS), null);
});

test("the referrer's own form wins over a remembered choice; a remembered choice is used when no name matches", () => {
  assert.equal(matchReferrerForm({ name: "Kingsway Case Management" }, FORMS)?.reason, "same_name");
  const remembered = matchReferrerForm({ name: "Ashby Freight Ltd (fictional)" }, FORMS, "kw");
  assert.equal(remembered?.form.id, "kw");
  assert.equal(remembered?.reason, "remembered");
  // A remembered form that is no longer offered is ignored.
  assert.equal(matchReferrerForm({ name: "Ashby Freight Ltd (fictional)" }, FORMS, "gone"), null);
});

test("a form used once for another purpose does not replace the referrer's own form", () => {
  // Megan's solicitor once had an insurer's form completed: Harrow & Pike's own form stays the default.
  const m = matchReferrerForm({ name: "Harrow & Pike Solicitors (fictional)" }, FORMS, "nf");
  assert.equal(m?.form.id, "hp");
  assert.equal(m?.reason, "similar_name");
});

test("fix round 1 (B0-20): remembered per referrer and kind of report; the note names each provider, neutrally", async () => {
  const { formChoiceNote, notesReportKind, reportKindOf } = await import("./referrer-match");
  const titled = (id: string, provider: string, title: string) => ({ ...form(id, provider), title, status: "confirmed" }) as unknown as FormDefinition;
  const medcareIa = titled("mc-ia", "Medcare", "Initial Assessment Report");
  const medcareEots = titled("mc-eots", "Medcare", "Final Discharge Report");
  const tenBridgeIa = titled("tb-ia", "10Bridge", "Initial Assessment Report");
  const forms = [medcareIa, medcareEots, tenBridgeIa];
  assert.equal(reportKindOf("INITIAL ASSESSMENT REPORT"), "initial");
  assert.equal(reportKindOf("Physiotherapy Assessment Report"), "initial");
  assert.equal(reportKindOf("FINAL ASSESSMENT REPORT"), "discharge");
  assert.equal(reportKindOf("Discharge Report"), "discharge");
  assert.equal(reportKindOf("Treatment Progress Report"), null);
  assert.equal(notesReportKind({ episodeStatus: "discharged", notes: [] }), "discharge");
  assert.equal(notesReportKind({ episodeStatus: "open", notes: [{ type: "initial_assessment" }] } as never), "initial");

  const party = { name: "Harbourside Case Management (fictional)" };
  // The IA form remembered for this referrer is never pre-selected for notes that run to discharge.
  assert.equal(matchReferrerForm(party, forms, "mc-ia", "discharge"), null);
  assert.deepEqual(matchReferrerForm(party, forms, "mc-ia", "initial"), { form: medcareIa, reason: "remembered" });
  assert.deepEqual(matchReferrerForm(party, forms, "mc-ia", null), { form: medcareIa, reason: "remembered" });
  // The provider is named; another form chosen this time is said plainly, not as a warning.
  const match = { form: medcareIa, reason: "remembered" as const };
  // Fix round 3 (B2-32): no "'s" after a closing bracket (it was "Harbourside Case Management (fictional)'s case").
  assert.equal(formChoiceNote({ party, match, selected: medcareIa, kind: "initial" }), "Last time, the case from Harbourside Case Management (fictional) used Medcare's “Initial Assessment Report”. These notes cover the initial assessment.");
  assert.equal(
    formChoiceNote({ party, match, selected: tenBridgeIa, kind: null }),
    "Last time, the case from Harbourside Case Management (fictional) used Medcare's “Initial Assessment Report”. You have chosen 10Bridge's “Initial Assessment Report” this time.",
  );
  assert.doesNotMatch(formChoiceNote({ party, match, selected: medcareEots, kind: "discharge" }), /not .*own form/);
});
