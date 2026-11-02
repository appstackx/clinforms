/** ICD-10 format, normalising and the picker list (HC10). Pure. Run by `npm run test:db` / `test:pms`. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMON_MSK_ICD10, OptionalIcd10Schema, icd10Label, isValidIcd10, normaliseIcd10, searchIcd10 } from "./icd10";
import { InvoiceDraftPatchSchema } from "./schemas";

describe("HC10 ICD-10 diagnosis codes", () => {
  it("accepts a letter and two digits, optionally . and one or two characters; normalises case and the full stop", () => {
    for (const [given, want] of [
      ["M54.5", "M54.5"],
      ["m54.5", "M54.5"],
      [" S93.4 ", "S93.4"],
      ["M545", "M54.5"],
      ["M54", "M54"],
      ["S93.40", "S93.40"],
      ["M17.1", "M17.1"],
    ] as const) assert.equal(normaliseIcd10(given), want, given);
    for (const bad of ["", "54.5", "MM54", "M5", "M54.", "M54.123", "M54-5", "low back pain", "M54.5 x"]) assert.equal(isValidIcd10(bad), false, bad);
  });

  it("the optional schema: blank = none, a bad code refused in plain words; invoice drafts use it", () => {
    assert.equal(OptionalIcd10Schema.parse(""), null);
    assert.equal(OptionalIcd10Schema.parse(undefined), undefined);
    assert.equal(OptionalIcd10Schema.parse("m751"), "M75.1");
    const bad = OptionalIcd10Schema.safeParse("back");
    assert.equal(bad.success, false);
    assert.match(bad.success ? "" : bad.error.issues[0].message, /ICD-10 code/);
    assert.equal(InvoiceDraftPatchSchema.parse({ diagnosisCode: "s934" }).diagnosisCode, "S93.4");
    assert.equal(InvoiceDraftPatchSchema.safeParse({ diagnosisCode: "WAD II" }).success, false);
  });

  it("the picker list: valid, unique codes; search by code or words", () => {
    assert.ok(COMMON_MSK_ICD10.length >= 10 && COMMON_MSK_ICD10.length <= 30);
    assert.equal(new Set(COMMON_MSK_ICD10.map((o) => o.code)).size, COMMON_MSK_ICD10.length);
    for (const o of COMMON_MSK_ICD10) assert.equal(normaliseIcd10(o.code), o.code, o.code);
    for (const code of ["M54.5", "M75.1", "M17.1", "S93.4"]) assert.ok(icd10Label(code), code);
    assert.deepEqual(searchIcd10("m54").map((o) => o.code).sort(), ["M54.2", "M54.3", "M54.4", "M54.5"]);
    assert.deepEqual(searchIcd10("M545").map((o) => o.code), ["M54.5"]);
    assert.ok(searchIcd10("rotator cuff").some((o) => o.code === "M75.1"));
    assert.ok(searchIcd10("ankle").some((o) => o.code === "S93.4"));
    assert.deepEqual(searchIcd10("zzz"), []);
    assert.equal(icd10Label("Q99.9"), null);
  });
});
