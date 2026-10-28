/**
 * bh2 fix round 1, owner WE (data, maps and mapping page) – regression tests for the round-1 verification findings
 * (bh2-handover/run/r1-triage.md). Fictional data only, in ClinForms' own wording.
 *
 * - R1T-WE-01: a session-date question that asks for the missed appointments too (Ascenti ML EOTS F-31) was
 *   filled by code from the attended appointments only, so a recorded DNA or late cancellation was left off the issued
 *   form, and the box was read-only. It is now drafted from the notes (production's behaviour), which the physio can
 *   correct; a list of the attended sessions is still filled by code (B2-19).
 * - R1T-WE-L1: staff saw "1 problem to fix before confirming" on a mapping when the only obstacle was who may confirm it.
 *
 * R1T-WE-02 (fixed clinical prose shown on no card) and R1T-WE-03 (other-treatment guidance) are data fixes in the
 * clinic's gitignored maps; their checks are the env-gated T3 tests in bh-maps.test.ts and the FILL-fixedtext-* corpus
 * cases (the mechanism the maps use).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { lintErrors, lintFormMap } from "@/modules/medreport/core/form-map-lint";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { asksForMissedAppointments, sessionDatesByCode, sessionQuestionOf } from "@/modules/medreport/core/session-dates";
import type { Appointment, EpisodeBundle, FormDefinition, FormField } from "@/modules/medreport/core/types";
import { buildBundle, CORPUS_TENANT } from "@/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { mappingConfirmStatus } from "@/modules/medreport/ui/components/forms/mapping";

const AT = "2026-10-27T09:00:00.000Z";

const field = (id: string, patch: Partial<FormField> = {}): FormField =>
  ({
    id,
    label: `Question ${id}`,
    guidance: "",
    answerType: "long_text",
    anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${Number(id.slice(2))}.c1` },
    fillSource: { kind: "notes_narrative" },
    required: true,
    confidence: "high",
    ...patch,
  }) as FormField;

const discharge = (fields: FormField[]): FormDefinition => ({
  id: "frm_we_fix1",
  tenantId: CORPUS_TENANT,
  referrer: { name: "Larkfield Rehab Network (fictional)", type: "case_manager" },
  title: "Discharge Report (fictional)",
  file: { fileName: "larkfield.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "b".repeat(64), sizeBytes: 100 },
  kind: "docx",
  fields,
  status: "confirmed",
  analysis: { mode: "rules", promptVersion: "test", at: AT, warnings: [] },
  createdAt: AT,
  updatedAt: AT,
});

/** Five booked appointments: attended on the 1st, 8th, 22nd and 29th; a DNA on the 15th; a same-day cancellation on the 25th. */
function bundleWithMissed(): EpisodeBundle {
  const b = buildBundle("owen", CORPUS_TENANT);
  const at = (day: string, status: Appointment["status"], i: number): Appointment => ({
    id: `A-${300 + i}`,
    date: `2026-09-${day}`,
    time: "10:00",
    status,
    ...(status === "ATT" ? { noteId: b.notes[i % b.notes.length]?.id } : { reason: "Fictional reason" }),
  });
  return { ...b, appointments: [at("01", "ATT", 0), at("08", "ATT", 1), at("15", "DNA", 2), at("22", "ATT", 3), at("25", "LCN", 4), at("29", "ATT", 5)] };
}

const facts = (bundle: EpisodeBundle) => computeFacts(bundle, { asOf: "2026-10-27" });

describe("R1T-WE-01: a session-date box that asks for the missed appointments too is drafted, never filled from the attended ones", () => {
  test("asksForMissedAppointments reads the label and the guidance; words that leave the missed ones out do not count", () => {
    const asks = (label: string, guidance = "") => asksForMissedAppointments({ label, guidance });
    for (const label of [
      "Dates of every appointment, any failure to attend included",
      "Treatment dates (DNAs included)",
      "Dates of the visits, with any non-attendance",
      "Appointment dates – include any the patient did not attend",
      "Session dates and cancellations",
      "Dates booked, missed ones too",
      "Dates of the appointments, no-shows marked",
    ]) {
      assert.equal(asks(label), true, label);
    }
    assert.equal(asks("Dates of the visits", "List every visit booked, late cancellations too."), true, "the guidance asks for them");
    for (const label of ["Dates of the visits", "Dates of the attended sessions", "Session 4 – date", "Dates of the sessions attended (excluding DNAs)", "Session dates, not counting cancellations", "Treatment dates other than missed ones"]) {
      assert.equal(asks(label), false, label);
    }
  });

  test("sessionQuestionOf: a list (or a numbered appointment) that includes the missed ones is not a question about the attended sessions", () => {
    const q = (label: string, answerType: FormField["answerType"] = "long_text", guidance = "") => sessionQuestionOf({ label, answerType, guidance });
    assert.equal(q("Dates of every appointment, any failure to attend included"), null);
    assert.equal(q("Treatment dates (DNAs included)"), null);
    assert.equal(q("Dates of the visits", "long_text", "Every visit booked; mark the ones missed."), null);
    assert.equal(q("Appointment 3 – date (a missed one counts)", "date"), null, "the 3rd booked appointment is not the 3rd attended one");
    // Unchanged: the attended sessions, and the first appointment.
    assert.deepEqual(q("Dates of the visits"), { kind: "session_dates", afterAssessment: false });
    assert.deepEqual(q("Dates of the sessions attended (excluding DNAs)"), { kind: "session_dates", afterAssessment: false });
    assert.deepEqual(q("Session 4 – date", "date"), { kind: "session_date", n: 4, afterAssessment: false });
    assert.deepEqual(q("Date first seen", "date"), { kind: "first_date" });
  });

  test("never filled by code (the recorded DNA and late cancellation would be left out); the attended list still is (B2-19)", () => {
    const bundle = bundleWithMissed();
    const all = field("F-05", { label: "Dates of every appointment, any failure to attend included", guidance: "Each booked appointment, the ones not attended marked." });
    const attended = field("F-06", { label: "Dates of the attended sessions" });
    const form = discharge([all, attended]);
    assert.equal(sessionDatesByCode({ field: all, form, bundle, computedFacts: facts(bundle) }), null);
    assert.equal(sessionDatesByCode({ field: attended, form, bundle, computedFacts: facts(bundle) })?.text, "01/09/2026, 08/09/2026, 22/09/2026, 29/09/2026");
    // Through the report factory (the seam): the box is a drafted box the physio can correct – not a locked record box.
    const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: facts(bundle), now: new Date(AT) });
    const s5 = report.sections.find((s) => s.key === "F-05");
    assert.equal(s5?.kind, "ai_narrative");
    assert.equal(s5?.status, "pending");
    assert.deepEqual(s5?.paragraphs, []);
    const s6 = report.sections.find((s) => s.key === "F-06");
    assert.equal(s6?.kind, "from_records");
    assert.equal(s6?.paragraphs[0]?.text, "01/09/2026, 08/09/2026, 22/09/2026, 29/09/2026");
  });

  test("the map lint no longer suggests the attended-dates record path for such a box (L6), and still does for the attended list", () => {
    const errors = lintErrors(
      lintFormMap(discharge([field("F-05", { label: "Treatment dates (DNAs included)" }), field("F-06", { label: "Dates of the attended sessions" })])),
    );
    assert.deepEqual(
      errors.filter((i) => i.rule === "L6").map((i) => i.fieldId),
      ["F-06"],
    );
  });

  test("bounded: a hostile label or guidance is read in linear time", () => {
    const long = `${"missed ".repeat(20_000)}x`;
    const started = Date.now();
    asksForMissedAppointments({ label: long, guidance: `${"excluding ".repeat(20_000)}missed` });
    sessionQuestionOf({ label: `Dates of the visits ${long}`, answerType: "long_text", guidance: long });
    assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
  });
});

describe("R1T-WE-L1: who may confirm a mapping is never counted as a problem to fix", () => {
  const ROLE = "An owner, administrator or clinician confirms forms.";
  const JUDGEMENT = "This mapping accepts a clinical judgement as worded on question F-12: a clinician (or a member who may sign) confirms it.";
  const status = (patch: Partial<Parameters<typeof mappingConfirmStatus>[0]> = {}) =>
    mappingConfirmStatus({ fixable: [], judgementObstacle: null, mayConfirm: true, dirty: false, confirmed: false, confirmRole: ROLE, ...patch });

  test("staff on a map that accepts a clinical judgement: only who confirms it, no problem count (TPN-L4)", () => {
    const s = status({ mayConfirm: false, judgementObstacle: JUDGEMENT });
    assert.equal(s.status, JUDGEMENT);
    assert.equal(s.roleNote, null);
    assert.doesNotMatch(`${s.status} ${s.roleNote ?? ""}`, /problem/);
  });

  test("a member who may confirm forms but not accept a judgement (no registration number): told who confirms it", () => {
    const s = status({ judgementObstacle: JUDGEMENT });
    assert.equal(s.status, JUDGEMENT);
    assert.doesNotMatch(s.status, /problem/);
  });

  test("staff on a map without judgements: ready for someone else, with the role line (as before)", () => {
    assert.deepEqual(status({ mayConfirm: false }), { status: "Ready for an owner, administrator or clinician to confirm", roleNote: ROLE });
  });

  test("problems the member can fix are counted – only those – and who confirms is said under them", () => {
    assert.deepEqual(status({ fixable: ["Name the referrer."], mayConfirm: false, judgementObstacle: JUDGEMENT }), { status: "1 problem to fix before confirming", roleNote: JUDGEMENT });
    assert.deepEqual(status({ fixable: ["a", "b"], mayConfirm: false }), { status: "2 problems to fix before confirming", roleNote: ROLE });
    assert.deepEqual(status({ fixable: ["a"] }), { status: "1 problem to fix before confirming", roleNote: null });
  });

  test("unsaved changes, a confirmed map and a clinician who may confirm read as before", () => {
    assert.deepEqual(status({ dirty: true, mayConfirm: false, judgementObstacle: JUDGEMENT }), { status: "Unsaved changes", roleNote: JUDGEMENT });
    assert.deepEqual(status({ confirmed: true }), { status: "No changes", roleNote: null });
    assert.deepEqual(status(), { status: "Ready to confirm", roleNote: null });
  });
});
