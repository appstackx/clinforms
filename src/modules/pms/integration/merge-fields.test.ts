/** One merge-field engine (K2-LTR-007): template names → comms letter fields (src/modules/pms/integration/merge-fields.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MERGE_FIELDS, renderTemplate } from "../comms/merge-fields";
import { formatLatestOutcomes } from "../comms/outcomes-field";
import { LETTER_FIELD_KEYS, MERGE_ALIASES, applyMergeToText, mergeNameKey, mergeReportProblems, resolveMergeName, type MergeReport } from "./merge-fields";

const VALUES: Record<string, string> = {
  "patient.title": "Mrs",
  "patient.first_name": "Megan",
  "patient.last_name": "Hart",
  "patient.full_name": "Mrs Megan Hart",
  "patient.date_of_birth": "14/03/1991",
  "case.claim_reference": "HP/RTA/2291",
  "case.discharge_date": "21/10/2026",
  latest_outcomes: "NPRS 7/10 → 2/10",
  "author.name": "Sarah Reid",
  "patient.address": "",
};

describe("one merge-field list", () => {
  it("every alias points at a comms letter field (no second list)", () => {
    for (const key of Object.keys(MERGE_ALIASES)) assert.ok(LETTER_FIELD_KEYS.includes(key), key);
    for (const key of LETTER_FIELD_KEYS) assert.equal(resolveMergeName(key), key, key);
    assert.ok(LETTER_FIELD_KEYS.length > 20);
  });
  it("latest_outcomes and the discharge date are letter fields only; outcomes are marked clinical", () => {
    const lo = MERGE_FIELDS.find((f) => f.key === "latest_outcomes");
    assert.deepEqual(lo?.contexts, ["letter"]);
    assert.equal(lo?.clinical, true);
    assert.deepEqual(MERGE_FIELDS.find((f) => f.key === "case.discharge_date")?.contexts, ["letter"]);
    assert.equal(renderTemplate("Scores: {{latest_outcomes}}", VALUES, { missing: "marker" }).text, "Scores: NPRS 7/10 → 2/10");
  });
});

describe("template names", () => {
  it("common names match regardless of case, spaces, underscores and CamelCase", () => {
    assert.equal(mergeNameKey("PatientName"), "patient name");
    assert.equal(mergeNameKey("PatientDOB"), "patient dob");
    for (const [name, key] of [
      ["Patient_Name", "patient.full_name"],
      ["PATIENT NAME", "patient.full_name"],
      ["patient_name", "patient.full_name"],
      ["patient_dob", "patient.date_of_birth"],
      ["Forename", "patient.first_name"],
      ["first_name", "patient.first_name"],
      ["DOB", "patient.date_of_birth"],
      ["gp_name", "gp.name"],
      ["first_visit", "case.first_visit"],
      ["discharge_date", "case.discharge_date"],
      ["latest_outcomes", "latest_outcomes"],
      ["practitioner", "author.name"],
      ["DateOfAccident", "case.injury_on"],
      ["Your Ref", "case.claim_reference"],
      ["HCPC", "author.registration"],
      ["Insurer", "case.payer"],
      ["Today", "today"],
    ] as const) {
      assert.equal(resolveMergeName(name), key, name);
    }
    assert.equal(resolveMergeName("Flux Capacitor"), null, "an unknown name is not guessed");
    assert.equal(resolveMergeName("Flux Capacitor", { "flux capacitor": "patient.number" }), "patient.number", "staff's own choice");
    assert.equal(resolveMergeName("Flux Capacitor", { "flux capacitor": "not.a.field" }), null);
    assert.equal(resolveMergeName("Flux Capacitor", { "flux capacitor": "appointment.time" }), null, "a message-only field is not a letter field");
  });
});

describe("filling text", () => {
  it("fills «Name» and <<Name>> from the comms values, keeps unknown names, reports empty ones", () => {
    const report: MergeReport = { fields: [] };
    const out = applyMergeToText("Dear «Title» «Surname», re: <<Claim No>> (DOB «DOB»). «Mystery» «Address»", VALUES, report);
    assert.equal(out, "Dear Mrs Hart, re: HP/RTA/2291 (DOB 14/03/1991). «Mystery» ");
    assert.deepEqual(mergeReportProblems(report), { unknown: ["Mystery"], empty: ["Address"] });
    assert.equal(report.fields.find((f) => f.name === "Surname")?.key, "patient.last_name");
  });
  it("text without merge fields is unchanged", () => {
    const report: MergeReport = { fields: [] };
    assert.equal(applyMergeToText("Plain text with << spaces >> and « » only", VALUES, report), "Plain text with << spaces >> and « » only");
    assert.deepEqual(report.fields, []);
  });
});

describe("{{latest_outcomes}}", () => {
  it("first → latest per measure with units; errors left out; one score alone", () => {
    const text = formatLatestOutcomes([
      { measure: "odi", takenOn: "2026-09-01", scoreTenths: 460 },
      { measure: "nprs", takenOn: "2026-10-20", scoreTenths: 20 },
      { measure: "nprs", takenOn: "2026-09-01", scoreTenths: 70 },
      { measure: "odi", takenOn: "2026-10-20", scoreTenths: 120 },
      { measure: "odi", takenOn: "2026-10-21", scoreTenths: 900, status: "entered_in_error" },
      { measure: "quickdash", takenOn: "2026-09-01", scoreTenths: 477 },
    ]);
    assert.equal(text, "ODI 46% → 12% · NPRS 7/10 → 2/10 · QuickDASH 47.7/100");
    assert.equal(formatLatestOutcomes([]), "");
  });
});
