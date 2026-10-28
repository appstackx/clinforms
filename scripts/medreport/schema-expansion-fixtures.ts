/**
 * TESTS ONLY (schema-expansion.test.ts, plan W0.3): records as this build stores them before the bh2 schema expansion
 * ("old"), and the same records holding every field and enum member the expansion adds ("full"). All fictional – made-up
 * clinic, clinicians (PH-DEMO numbers), patient and referrer; wording written for these tests.
 *
 * The old builders are frozen: schema-expansion.test.ts pins their canonical SHA-256s, the receipt MAC and the form-map
 * hash as computed on bd929a3 (release/bh-trial-2 before the expansion). Do not edit them; add new cases instead.
 */
import type { Actor, FormDefinition, Report } from "@/modules/medreport/core/types";

export const OLD_AT = "2026-10-20T09:00:00.000Z";
export const NEW_AT = "2026-10-28T10:00:00.000Z";
/** A made-up signing secret for receipts minted in these tests (never a real one). */
export const TEST_SECRET = "schema-expansion-test-secret-not-real-0001";
const sha = (c: string) => c.repeat(64);

const SARAH = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Physiotherapist" };
const TOM = { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist" };
const REFERRER = { name: "Fernhill Case Management (fictional)", type: "case_manager" as const, reference: "FCM/0042" };

/** A form report as this build stores it: every optional key the fix rounds added, none of the expansion's. */
export function oldFormReport(): Report {
  return {
    id: "rpt_schema_old_1",
    tenantId: "demo",
    templateId: "form:frm_schema_old",
    templateVersion: "1",
    patientLabel: "Robin Ashby",
    episodeRef: { connectorId: "tm3-sim", patientId: "sim-pat-901", episodeId: "ep-901" },
    instructingParty: { type: "case_manager", name: REFERRER.name, reference: REFERRER.reference, contactName: "", address: "" },
    bundleSnapshot: {
      tenantId: "demo",
      source: { connectorId: "tm3-sim", simulated: true, fetchedAt: OLD_AT, externalPatientId: "sim-pat-901", externalEpisodeId: "ep-901", label: "Simulated TM3 sandbox" },
      registration: {
        id: "REG",
        externalPatientId: "sim-pat-901",
        title: "Mx",
        firstName: "Robin",
        lastName: "Ashby",
        fullName: "Robin Ashby",
        dob: "1988-04-12",
        sex: "not_recorded",
        addressSummary: "4 Quarry Lane, Lowbridge, LB1 2QQ",
        occupation: "Bakery supervisor",
      },
      referral: { type: "case_manager", name: REFERRER.name, reference: REFERRER.reference, contactName: "", address: "" },
      incident: { date: "2026-08-03", mechanism: "Lifted a heavy tray at work and felt a twinge in the lower back.", type: "workplace" },
      clinicians: [SARAH, TOM],
      notes: [
        {
          id: "N-001",
          date: "2026-08-10",
          time: "09:00",
          type: "initial_assessment",
          author: SARAH,
          subjective: "Lower back ache since the tray lift, worse on bending. Pain 6/10 at worst.",
          objective: "Lumbar flexion limited to mid shin. Neuro screen clear.",
          assessment: "Mechanical low back pain.",
          plan: "Graded walking, core exercises, review in one week. Expect steady progress over six weeks.",
        },
        {
          id: "N-002",
          date: "2026-08-24",
          time: "09:30",
          type: "follow_up",
          author: TOM,
          subjective: "Ache now 3/10, managing half shifts.",
          objective: "Flexion to ankles.",
          assessment: "Improving.",
          plan: "Progress exercises.",
        },
      ],
      appointments: [
        { id: "A-1", date: "2026-08-10", time: "09:00", status: "ATT", noteId: "N-001", clinician: SARAH },
        { id: "A-2", date: "2026-08-17", time: "09:00", status: "DNA" },
        { id: "A-3", date: "2026-08-24", time: "09:30", status: "ATT", noteId: "N-002", clinician: TOM },
      ],
      outcomeMeasures: [{ id: "O-1", instrument: "NPRS", unit: "/10", higherIsWorse: true, points: [{ date: "2026-08-10", value: 6, noteId: "N-001" }, { date: "2026-08-24", value: 3, noteId: "N-002" }] }],
      consent: { disclosureConsentRecorded: true, date: "2026-08-10" },
      episodeStatus: "open",
    },
    sections: [
      {
        key: "F-01",
        fieldId: "F-01",
        title: "Patient name",
        kind: "from_records",
        status: "complete",
        paragraphs: [{ id: "F-01-p1", text: "Robin Ashby", sourceIds: ["REG"], origin: "from_records", basis: "record" }],
      },
      {
        key: "F-02",
        fieldId: "F-02",
        title: "Working again since the injury?",
        kind: "ai_narrative",
        status: "complete",
        answer: { kind: "yes_no", value: true },
        paragraphs: [],
      },
      {
        key: "F-03",
        fieldId: "F-03",
        title: "If yes, which duties are they doing?",
        kind: "ai_narrative",
        status: "drafted",
        paragraphs: [
          {
            id: "F-03-p1",
            text: "On 24/08/2026 Tom Ellis recorded that Robin was managing half shifts.",
            sourceIds: ["N-002"],
            origin: "edited",
            basis: "patient_reported",
            originalText: "Robin was managing half shifts (24/08/2026).",
          },
        ],
      },
      {
        key: "F-04",
        fieldId: "F-04",
        title: "Expected recovery time",
        kind: "clinician_opinion",
        status: "needs_input",
        paragraphs: [
          {
            id: "F-04-p1",
            text: "Steady progress over six weeks is expected.",
            sourceIds: ["N-001"],
            origin: "ai",
            basis: "clinician_opinion_recorded",
            ackReason: "My own recorded view at the first appointment.",
          },
        ],
      },
      { key: "F-05", fieldId: "F-05", title: "Second address line", kind: "from_records", status: "complete", paragraphs: [], blankFromRecords: true },
    ],
    gaps: [
      {
        id: "gap-1",
        sectionKey: "F-04",
        issue: "The notes give no expected date for full duties.",
        suggestedQuestion: "When do you expect full duties to resume?",
        relatedNoteIds: ["N-001"],
        raisedBy: "ai",
        resolution: { kind: "acknowledged", text: "Left for the physiotherapist.", at: OLD_AT, leftBlank: true },
      },
      {
        id: "gap-2",
        sectionKey: "F-03",
        issue: "Which duties are not recorded.",
        suggestedQuestion: "Which duties is Robin doing?",
        relatedNoteIds: [],
        raisedBy: "system",
        suggestedAnswer: "Light duties",
        resolution: { kind: "resolved", text: "Answered in the box.", at: OLD_AT, byAnswer: true, notApplicable: false },
      },
    ],
    flags: [
      {
        id: "flag-1",
        code: "OPINION_LANGUAGE",
        severity: "blocking",
        sectionKey: "F-04",
        paragraphId: "F-04-p1",
        message: "Opinion wording – check the cited note records it.",
        evidence: "is expected",
        acknowledged: { reason: "Recorded in my own note.", at: OLD_AT },
      },
      { id: "flag-2", code: "DRAFT_FIT", severity: "warning", sectionKey: "F-03", message: "Check it fits the box." },
    ],
    status: "draft",
    generation: [{ mode: "demo_prewritten", sectionKeys: ["F-03", "F-04"], at: OLD_AT, promptVersion: "forms-test-1" }],
    activity: [{ at: OLD_AT, actor: "Sarah Reid", action: "created", detail: "Report started." }],
    createdAt: OLD_AT,
    updatedAt: OLD_AT,
    form: { formId: "frm_schema_old", title: "Return to Work Update (fictional)", referrer: REFERRER, fileSha256: sha("a"), kind: "docx", mapSha256: sha("9") },
    author: SARAH,
    version: 2,
    amends: { reportId: "rpt_schema_old_0", version: 1, approvedAt: "2026-10-15T12:00:00.000Z" },
  };
}

/** A small built-in report (no form) as this build stores it. */
export function oldBuiltInReport(): Report {
  const base = oldFormReport();
  return {
    ...base,
    id: "rpt_schema_old_2",
    templateId: "solicitor-rta-treating-physio",
    templateVersion: "1.0.0",
    sections: [
      {
        key: "prognosis",
        title: "Prognosis",
        kind: "clinician_opinion",
        status: "complete",
        paragraphs: [{ id: "prognosis-p1", text: "I expect steady progress over six weeks.", sourceIds: ["N-001"], origin: "clinician" }],
      },
    ],
    gaps: [],
    flags: [],
    form: undefined,
    version: undefined,
    amends: undefined,
  };
}

/** A form map as this build stores it, with the record paths that take a `part`. */
export function oldFormDefinition(): FormDefinition {
  const cell = (r: number) => ({ kind: "docx" as const, target: "table_cell" as const, blockId: `t0.r${r}.c1` });
  return {
    id: "frm_schema_old",
    tenantId: "demo",
    referrer: REFERRER,
    title: "Return to Work Update (fictional)",
    versionLabel: "v2 (2026)",
    file: { fileName: "return-to-work-update.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: sha("a"), sizeBytes: 31_000 },
    kind: "docx",
    fields: [
      { id: "F-01", label: "Patient name", guidance: "The patient's full name.", answerType: "short_text", anchor: cell(0), fillSource: { kind: "registration", path: "patient.fullName" }, required: true, confidence: "high" },
      {
        id: "F-02",
        label: "Working again since the injury?",
        guidance: "Yes or No, from the notes.",
        answerType: "yes_no",
        options: ["Yes", "No"],
        anchor: { kind: "docx", target: "checkbox_glyph", blockId: "t0.r1.c1", optionGlyphs: [{ option: "Yes", blockId: "t0.r1.c1", glyphIndex: 0 }, { option: "No", blockId: "t0.r1.c1", glyphIndex: 1 }] },
        fillSource: { kind: "notes_narrative" },
        required: true,
        confidence: "high",
      },
      { id: "F-03", label: "If yes, which duties are they doing?", guidance: "The duties as the notes record them.", answerType: "long_text", anchor: cell(2), fillSource: { kind: "notes_narrative" }, required: false, confidence: "medium" },
      { id: "F-04", label: "Expected recovery time", guidance: "Only a view a physiotherapist recorded.", answerType: "short_text", anchor: cell(3), fillSource: { kind: "clinician_opinion" }, required: true, confidence: "medium" },
      { id: "F-05", label: "Second address line", guidance: "", answerType: "short_text", anchor: cell(4), fillSource: { kind: "registration", path: "patient.addressLines", part: { index: 2, of: 3 } }, required: false, confidence: "high" },
      { id: "F-06", label: "Third session date", guidance: "", answerType: "date", anchor: cell(5), fillSource: { kind: "registration", path: "episode.attendedDate", part: { index: 3, of: 8 } }, required: false, confidence: "high" },
      { id: "F-07", label: "Third session time", guidance: "", answerType: "short_text", anchor: cell(6), fillSource: { kind: "registration", path: "episode.attendedTime", part: { index: 3, of: 8 } }, required: false, confidence: "high" },
      { id: "F-08", label: "Approving physiotherapist", guidance: "", answerType: "clinician_name", anchor: cell(7), fillSource: { kind: "signoff", part: "name" }, required: true, confidence: "high", completedBy: "clinic" },
      { id: "F-09", label: "Office use", guidance: "", answerType: "short_text", anchor: cell(8), fillSource: { kind: "leave_blank" }, required: false, confidence: "high", note: "For the referrer only." },
    ],
    status: "confirmed",
    analysis: {
      mode: "rules",
      promptVersion: "rules-1",
      at: OLD_AT,
      warnings: ["Two answer boxes found for F-03; using the larger one."],
      mergeFields: [{ text: "<<P_REF>>", where: "table 1, row 9", blockId: "t0.r8.c1" }],
    },
    confirmed: { by: "Practice manager (demo)", at: OLD_AT },
    createdAt: OLD_AT,
    updatedAt: OLD_AT,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The same records with every field and enum member of the expansion (plan W0.3)
 * ----------------------------------------------------------------------------------------------*/

export const APPROVER_ACTOR: Actor = { memberId: "mem_sarah_demo", name: "Sarah Reid", role: "clinician", canSign: true, hcpc: "PH-DEMO-01" };
export const STAFF_ACTOR: Actor = { memberId: "mem_pat_demo", name: "Pat Morgan", role: "staff", canSign: false };
export const OTHER_CLINICIAN_ACTOR: Actor = { memberId: "mem_tom_demo", name: "Tom Ellis", role: "clinician", canSign: true, hcpc: "PH-DEMO-02" };

/**
 * oldFormReport() with every report-side field and member of the expansion: approver and reportModel; per-box
 * disposition (with its controller snapshot), accepted phrases, adoption and answerBy; paragraph by / ownWords / fixes
 * and the "staff" origin; every Gap.kind, with gap resolutions and flag acknowledgements stamped `by`.
 */
export function fullFormReport(): Report {
  const report = oldFormReport();
  report.approver = { memberId: APPROVER_ACTOR.memberId, name: APPROVER_ACTOR.name, hcpc: "PH-DEMO-01" };
  report.reportModel = 2;
  const [f01, f02, f03, f04, f05] = report.sections;
  f02.answerBy = APPROVER_ACTOR;
  f03.disposition = {
    kind: "applies_anyway",
    by: APPROVER_ACTOR,
    at: NEW_AT,
    reason: "Half shifts count as a return here.",
    controllerSnapshot: [{ sectionKey: "F-02", answer: { kind: "yes_no", value: true } }],
  };
  f03.paragraphs[0].by = OTHER_CLINICIAN_ACTOR;
  f03.paragraphs.push({
    id: "F-03-p2",
    text: "Packing and labelling only.",
    sourceIds: [],
    origin: "staff",
    by: STAFF_ACTOR,
  });
  f03.adoptedBy = { by: APPROVER_ACTOR, at: NEW_AT, contentSha: sha("d") };
  f04.accepted = [
    { check: "OPINION_LANGUAGE", phrase: "is expected", sentenceSha: sha("c"), noteId: "N-001", by: APPROVER_ACTOR, at: NEW_AT, reason: "My own note of 10/08/2026." },
    { check: "OPINION_LANGUAGE", phrase: "steady progress", sentenceSha: sha("e"), by: APPROVER_ACTOR, at: NEW_AT },
  ];
  f04.paragraphs[0].by = APPROVER_ACTOR;
  f04.paragraphs[0].fixes = [
    { kind: "note_prefix", by: APPROVER_ACTOR, at: NEW_AT, edits: [{ start: 0, end: 0, text: "Sarah Reid's note (10/08/2026): " }] },
    { kind: "shorten", by: APPROVER_ACTOR, at: NEW_AT },
  ];
  f04.paragraphs.push({ id: "F-04-p2", text: "I expect full duties by mid October.", sourceIds: [], origin: "clinician", by: APPROVER_ACTOR, ownWords: { by: APPROVER_ACTOR, at: NEW_AT } });
  f05.disposition = { kind: "left_blank", by: STAFF_ACTOR, at: NEW_AT };
  report.sections.push({
    key: "F-06",
    fieldId: "F-06",
    title: "Third session date",
    kind: "from_records",
    status: "complete",
    paragraphs: [],
    disposition: { kind: "not_applicable", by: APPROVER_ACTOR, at: NEW_AT, reason: "Only two sessions so far.", controllerSnapshot: [{ sectionKey: "F-02" }] },
  });
  report.gaps[0].kind = "no_opinion_recorded";
  report.gaps[0].resolution = { ...report.gaps[0].resolution!, by: APPROVER_ACTOR };
  report.gaps[1].kind = "choice_held_back";
  report.gaps[1].resolution = { ...report.gaps[1].resolution!, by: STAFF_ACTOR };
  const kinds = ["opinion_not_fitting_options", "condition", "band", "record_value", "staff_entry", "meta_held_back"] as const;
  kinds.forEach((kind, i) =>
    report.gaps.push({ id: `gap-k${i + 1}`, sectionKey: "F-04", issue: `Test gap of kind ${kind}.`, suggestedQuestion: "Please check this box.", relatedNoteIds: [], raisedBy: "system", kind }),
  );
  report.flags[0].acknowledged = { ...report.flags[0].acknowledged!, by: APPROVER_ACTOR };
  return report;
}

/** oldFormDefinition() with the form-side fields: converter stamp, printed leads, source hash, and the session paths. */
export function fullFormDefinition(): FormDefinition {
  const form = oldFormDefinition();
  form.file.sourceSha256 = sha("b");
  form.analysis.convertedWith = "rtf-docx-3";
  form.analysis.printedLeads = { "F-03": "Duties now:", "F-04": "Expected in" };
  const cell = (r: number) => ({ kind: "docx" as const, target: "table_cell" as const, blockId: `t0.r${r}.c1` });
  form.fields.push(
    { id: "F-10", label: "Session 14 date", guidance: "", answerType: "date", anchor: cell(9), fillSource: { kind: "registration", path: "episode.attendedDate", part: { index: 14, of: 30 } }, required: false, confidence: "high" },
    { id: "F-11", label: "Session 30 time", guidance: "", answerType: "short_text", anchor: cell(10), fillSource: { kind: "registration", path: "episode.attendedTime", part: { index: 30, of: 30 } }, required: false, confidence: "high" },
    { id: "F-12", label: "Follow-up appointment dates", guidance: "", answerType: "long_text", anchor: cell(11), fillSource: { kind: "registration", path: "episode.attendedDates", sessions: { fromSession: 2 } }, required: false, confidence: "high" },
    { id: "F-13", label: "First eight follow-up dates", guidance: "", answerType: "long_text", anchor: cell(12), fillSource: { kind: "registration", path: "episode.attendedDates", sessions: { fromSession: 2, of: 8 } }, required: false, confidence: "high" },
  );
  return form;
}
