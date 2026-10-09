import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "../templates/registry";
import { applyScope, removeSentencesWithTerms, scopeExcludeTerms } from "./scope";
import { testBundle } from "./validation/test-fixtures";

test("scope: employer template strips history fields and sentences with excluded terms, without mutating", () => {
  const bundle = testBundle();
  const before = JSON.stringify(bundle);
  const scoped = applyScope(bundle, EMPLOYER_FFW_TEMPLATE);
  assert.equal(JSON.stringify(bundle), before, "input not mutated");
  assert.equal(scoped.notes[0].pastMedicalHistory, undefined);
  assert.equal(scoped.notes[0].socialHistory, undefined);
  // "Non-smoker; drinks alcohol at weekends." is removed; the rest of the line stays.
  assert.equal(
    scoped.notes[0].subjective,
    "Lifting injury at work on 12/03/2026. Central LBP, NPRS 7/10 at worst. Sitting tolerance 20 min. Off work since 13/03/2026.",
  );
  const all = JSON.stringify(scoped).toLowerCase();
  for (const term of scopeExcludeTerms(EMPLOYER_FFW_TEMPLATE)) {
    assert.ok(!new RegExp(`\\b${term.toLowerCase()}\\b`).test(all), `"${term}" survived`);
  }
  assert.equal(scoped.notes[1].assessment, bundle.notes[1].assessment);
});

test("scope: solicitor template has no scope and returns the bundle unchanged", () => {
  const bundle = testBundle();
  assert.equal(applyScope(bundle, SOLICITOR_RTA_TEMPLATE), bundle);
  assert.deepEqual(scopeExcludeTerms(SOLICITOR_RTA_TEMPLATE), []);
});

test("scope: excludeTerms list adds the terms implied by excluded fields, de-duplicated", () => {
  const terms = scopeExcludeTerms(EMPLOYER_FFW_TEMPLATE);
  assert.ok(terms.indexOf("social history") >= 0);
  assert.equal(terms.filter((t) => t.toLowerCase() === "pmh").length, 1);
  const custom = { ...EMPLOYER_FFW_TEMPLATE, scope: { excludeFields: ["note.socialHistory" as const], excludeTerms: [] } };
  assert.deepEqual(scopeExcludeTerms(custom), ["social history"]);
});

test("scope: sentence removal matches whole words and keeps unrelated text", () => {
  const terms = ["smoker", "alcohol", "PMH"];
  assert.equal(removeSentencesWithTerms("Walks daily. Smoker 10/day. Works nights.", terms), "Walks daily. Works nights.");
  assert.equal(removeSentencesWithTerms("PMH: nil.\nPlan: HEP.", terms), "Plan: HEP.");
  assert.equal(removeSentencesWithTerms("Smokers' corner avoided.", ["smoker"]), "Smokers' corner avoided.");
  assert.equal(removeSentencesWithTerms("", terms), "");
});
