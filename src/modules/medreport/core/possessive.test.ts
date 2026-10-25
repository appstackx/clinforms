/** Fix round 2 (B1-20): "Bodycare Clinics'" reference, never "Bodycare Clinics's". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { possessive } from "./possessive";

test("an organisation's name ending in a plural takes only an apostrophe", () => {
  assert.equal(possessive("Bodycare Clinics"), "Bodycare Clinics'");
  assert.equal(possessive("Kent Physio Services"), "Kent Physio Services'");
  assert.equal(possessive("Proclaim Care"), "Proclaim Care's");
  assert.equal(possessive("10Bridge"), "10Bridge's");
  assert.equal(possessive("Ascenti"), "Ascenti's");
  assert.equal(possessive("Larkhill Medical Reporting (fictional)"), "Larkhill Medical Reporting (fictional)'s");
  assert.equal(possessive("Harrow & Pike Solicitors (fictional)"), "Harrow & Pike Solicitors (fictional)'s");
  assert.equal(possessive("Sports Express"), "Sports Express's");
});
