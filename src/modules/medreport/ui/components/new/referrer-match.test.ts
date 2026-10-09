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
