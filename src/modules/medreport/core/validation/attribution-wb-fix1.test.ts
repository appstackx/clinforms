/**
 * bh2 fix round 1 – WB (opinion guard and attribution): unit tables for the round-1 findings R1T-WB-01 … R1T-WB-12 and
 * R1T-WB-L1 … L4 (bh2-handover run/r1-triage.md). The safety corpus pins the end-to-end behaviour (cases/fix1-wb.jsonl);
 * these tables pin the pieces: the sign-off role confirmations, unstamped text on a release report, the wrapped-line
 * join and its conjunct breaks, whole-word opinion cues, clause labels and dashes, the anchor's frames and synonyms,
 * quotations of several note sentences, the work-status acceptance, the first person clause by clause and the one-click
 * names, the /validate handler's parity with validateReport, the regex-literal guard (the production server build's
 * mis-escaped "\\b"), the messages, and "Write in my own voice". Fictional data only (Owen Testcase, Gemma Whitlock;
 * Sarah Reid, Tom Ellis, Priya Shah; Pat Morgan as staff).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { FormDefinition, FormField, Note } from "../types";
import { inOwnClinicalWording } from "../voice";
import { confirmationText, requiredConfirmations } from "./attribution-confirmations";
import { anchorClause, quotedVerbatim } from "./attribution-anchor";
import { negativeFindings, negativeRecorded } from "./attribution-negatives";
import { contentStems, draftSentences, framesIn, hasOpinionCue, holderAt, labelGoverns, noteSentences } from "./attribution-text";
import { firstPersonOverColleagues } from "./attribution-voice";
import { authorshipOf, OPINION_PATTERNS, SUBJECT_MODAL } from "./opinion-language";
import { ackPolicyOf } from "./acknowledge";
import { buildCase } from "./__corpus__/harness/build";
import { validateBuilt } from "./__corpus__/harness/evaluate";
import { CANDIDATE_ENGINE } from "./__corpus__/harness/engine";
import { offeredFixes } from "./__corpus__/harness/fixes";
import { CaseInputSchema } from "./__corpus__/harness/types";
import { createHttpHarness } from "./__corpus__/harness/http";
import { handleValidate } from "../../api/handlers/validate";
import { bindHandler } from "../../api/http";

const SARAH = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };
const TOM = { name: "Tom Ellis", hcpc: "PH-DEMO-02" };

function note(fields: Partial<Note>, author = SARAH, id = "N-009", date = "2026-04-01"): Note {
  return { id, date, type: "follow_up", author, subjective: "", objective: "", assessment: "", plan: "", ...fields } as Note;
}

function field(id: string, label: string, fillSource: FormField["fillSource"], answerType: FormField["answerType"] = "short_text"): FormField {
  return { id, label, guidance: "The approving physiotherapist's name, from the approval.", answerType, anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id}.c1` }, fillSource, required: true, confidence: "high" } as FormField;
}

const NAME = (label: string) => field("F-11", label, { kind: "signoff", part: "name" }, "clinician_name");
const HCPC = field("F-12", "Regulator number", { kind: "signoff", part: "hcpc" }, "hcpc_number");
const ASSESSED_ON = field("F-13", "Date seen", { kind: "registration", path: "episode.firstSeen" } as FormField["fillSource"], "date");
const reportWith = (notes: Note[]) => ({ sections: [], bundleSnapshot: { notes } }) as never;
const COLLEAGUE_IA = note({ subjective: "Knee pain." }, TOM, "N-001", "2026-03-18");
COLLEAGUE_IA.type = "initial_assessment";

async function built(input: Record<string, unknown>) {
  const b = await buildCase(CaseInputSchema.parse(input));
  const res = validateBuilt(b, CANDIDATE_ENGINE, b.report);
  return { b, res, subject: res.flags.filter((f) => f.paragraphId === b.paragraphId || (f.sectionKey === b.box && !f.paragraphId)) };
}

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-01 / 02: the sign-off role confirmations
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-01: a role-named sign-off beside the assessment date asks 'I assessed this patient' (no initial-assessment note by the signer)", () => {
  const form = { title: "Physiotherapy Report", fields: [field("F-10", "Date of accident", { kind: "registration", path: "incident.date" } as FormField["fillSource"], "date"), NAME("Therapist Name"), HCPC, ASSESSED_ON] };
  assert.deepEqual(requiredConfirmations(reportWith([COLLEAGUE_IA]), form, SARAH), [{ kind: "assessed_patient", fieldId: "F-11" }]);
  // The signer wrote the initial-assessment note: nothing to confirm.
  const own = { ...COLLEAGUE_IA, author: SARAH };
  assert.deepEqual(requiredConfirmations(reportWith([own]), form, SARAH), []);
});

test("R1T-WB-01: the title decides first – an initial assessment title asks 'assessed', a final or progress title 'treated' even beside a first-seen date", () => {
  const fields = [NAME("Name of Practitioner"), HCPC, ASSESSED_ON];
  assert.equal(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "Initial Assessment Summary", fields }, SARAH)[0]?.kind, "assessed_patient");
  assert.equal(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "FINAL ASSESSMENT REPORT", fields }, SARAH)[0]?.kind, "treated_patient");
  assert.equal(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "Treatment Progress Report", fields }, SARAH)[0]?.kind, "treated_patient");
});

test("R1T-WB-01: the label's own assessor or treating wording is read first (Medcare, CLM and Proclaim shapes keep what they asked)", () => {
  assert.equal(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "Initial Assessment Report", fields: [NAME("Name of Assessor")] }, SARAH)[0]?.kind, "assessed_patient");
  assert.equal(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "Initial Assessment Report", fields: [NAME("Name of Treating Therapist")] }, SARAH)[0]?.kind, "treated_patient");
  assert.equal(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "Final Assessment Report", fields: [NAME("Treating physiotherapist")] }, SARAH)[0]?.kind, "treated_patient");
});

test("R1T-WB-01: a plain 'Name' / 'Print Name' names no role – no confirmation (no extra friction)", () => {
  for (const label of ["Name", "Print Name", "Signed by"]) {
    assert.deepEqual(requiredConfirmations(reportWith([COLLEAGUE_IA]), { title: "Discharge Report", fields: [NAME(label)] }, SARAH), [], label);
  }
});

test("R1T-WB-02: a role-named sign-off on a form with a self-management advice box asks 'I treated this patient' and names the advice the form states", () => {
  const advice = field("F-21", "Advice provided for self-management", { kind: "notes_narrative" }, "long_text");
  const form = { title: "Discharge Report", fields: [advice, NAME("Physiotherapist full name"), HCPC] };
  const req = requiredConfirmations(reportWith([note({ subjective: "Back on duties." }, TOM, "N-004")]), form, SARAH);
  assert.deepEqual(req, [{ kind: "treated_patient", fieldId: "F-11" }]);
  const text = confirmationText(req[0], form);
  assert.match(text, /^I treated this patient and gave the self-management advice the form states I gave/);
  assert.doesNotMatch(text, /AI|model|Claude/);
  // The approver wrote one of the treatment notes: nothing to confirm.
  assert.deepEqual(requiredConfirmations(reportWith([note({ subjective: "Back on duties." }, TOM, "N-004"), note({ subjective: "Pain 2/10." }, SARAH, "N-005")]), form, SARAH), []);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-03: unstamped "clinician" text on a release report
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-03: on a clinic's release report with no approver, unstamped 'clinician' text is a person's; elsewhere the approver's", () => {
  const approver = { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" };
  const clinic = { tenantId: "clinic-fictional-a", reportModel: 2 as const };
  // SEC-3's shape: a staff create with the approver left out – nothing vouches for the words.
  assert.equal(authorshipOf({ origin: "clinician" }, { ...clinic, approver: undefined }), "person");
  assert.equal(authorshipOf({ origin: "clinician" }, { tenantId: "clinic-fictional-a", approver: undefined, sections: [{ key: "F-01", condition: { controllers: ["F-02"] } } as never] }), "person");
  // Stamped by a member who may approve (the review stamps every person's paragraph): theirs; by staff: a person's.
  assert.equal(authorshipOf({ origin: "clinician", by: { memberId: "mem_sarah", role: "clinician" } as never }, { ...clinic, approver: undefined }), "approver");
  assert.equal(authorshipOf({ origin: "clinician", by: { memberId: "mem_pat", role: "staff" } as never }, { ...clinic, approver: undefined }), "person");
  // With the approver named, the store takes "clinician" text from the approver alone: theirs, stamped or not.
  assert.equal(authorshipOf({ origin: "clinician" }, { ...clinic, approver }), "approver");
  assert.equal(authorshipOf({ origin: "clinician", by: { memberId: "mem_sarah" } }, { ...clinic, approver }), "approver");
  assert.equal(authorshipOf({ origin: "clinician", by: { memberId: "mem_pat" } }, { ...clinic, approver }), "person");
  // A report from before the release, and the public demo (one fictional user): the earlier reading.
  assert.equal(authorshipOf({ origin: "clinician" }, { tenantId: "clinic-fictional-a", approver: undefined }), "approver");
  assert.equal(authorshipOf({ origin: "clinician" }, { tenantId: "demo", reportModel: 2, approver: undefined }), "approver");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-04 / 05: wrapped note lines, clause labels, dashes, whole-word cues
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-04: a printed line wrap inside a sentence is joined; a stop, a list item or a 'Label:' line is not", () => {
  const n = note({
    assessment: "Good progress. In my opinion his symptoms should\nsettle within 4-6 weeks.\nPlan: review in 2 weeks.",
    plan: "Home programme:\n- pelvic tilts\n- bridges\nAvoid lifting.\nnext review on 12/05/2026.",
  });
  const texts = noteSentences(n).map((s) => s.text);
  assert.ok(texts.includes("In my opinion his symptoms should settle within 4-6 weeks."), texts.join(" | "));
  assert.ok(texts.includes("Plan: review in 2 weeks."));
  assert.ok(!texts.some((t) => /pelvic tilts bridges/.test(t)), "list items stay apart");
  assert.ok(!texts.some((t) => /Avoid lifting\. next/.test(t)), "a line ending at a stop is not joined");
});

test("R1T-WB-04: a join is a conjunct boundary only between two whole phrases (the negation-leak guard)", () => {
  const terse = noteSentences(note({ objective: "No swelling\nknee pain on stairs." }))[0];
  assert.equal(terse.norm, "no swelling knee pain on stairs.");
  assert.equal(terse.breaks.length, 1, "two whole phrases: a boundary");
  const wrapped = noteSentences(note({ objective: "No evidence of\nnerve root signs." }))[0];
  assert.equal(wrapped.breaks.length, 0, "a wrap inside a phrase is one statement");
  // So 'no knee pain on stairs' is not recorded by the terse note, while the wrapped negative is.
  assert.equal(negativeRecorded("knee pain on stairs", [note({ objective: "No swelling\nknee pain on stairs." })]), false);
  assert.equal(negativeRecorded("nerve root signs", [note({ objective: "No evidence of\nnerve root signs." })]), true);
  assert.equal(negativeRecorded("knee pain on stairs", [note({ objective: "Mild swelling. No\nknee pain on stairs." })]), true);
});

test("R1T-WB-04: an anchor over a wrapped line keeps the stance of its own phrase", () => {
  const wrappedNot = note({ subjective: "Swelling settled. Not\nexpected to return to full duties within 4 weeks." }, TOM);
  assert.ok(anchorClause({ clause: "he was not expected to return to full duties within 4 weeks", notes: [wrappedNot] }));
  assert.equal(anchorClause({ clause: "he was expected to return to full duties within 4 weeks", notes: [wrappedNot] }), null);
  const leak = note({ subjective: "No swelling\nexpected to return to full duties within 4 weeks." }, TOM);
  assert.equal(anchorClause({ clause: "he was not expected to return to full duties within 4 weeks", notes: [leak] }), null);
});

test("R1T-WB-05: a clause before a colon is its own statement; a heading, a frame or a modifier still governs", () => {
  assert.equal(labelGoverns("not yet fit for netball"), false);
  for (const label of ["goal", "plan", "opinion on work", "red flags", "solicitor asks for an opinion", "employer has asked for a view", "possibly"]) assert.equal(labelGoverns(label), true, label);
  const s = noteSentences(note({ assessment: "Not yet fit for netball: the remaining limitation is quick changes of direction." }, TOM));
  assert.ok(anchorClause({ clause: "the remaining limitation was quick changes of direction", notes: [note({ assessment: "Not yet fit for netball: the remaining limitation is quick changes of direction." }, TOM)] }), s.map((x) => x.norm).join(" | "));
  assert.equal(anchorClause({ clause: "he was fit for light duties", notes: [note({ assessment: "Employer has asked for a view: fit for light duties." }, TOM)] }), null);
});

test("R1T-WB-05: a dash-joined note sentence anchors on its first clause, its stance kept", () => {
  assert.ok(anchorClause({ clause: "she was sleeping poorly", notes: [note({ subjective: "Sleeping poorly – wakes when turning over." })] }));
  assert.equal(anchorClause({ clause: "she was sleeping well", notes: [note({ subjective: "Not sleeping well – wakes when turning over." })] }), null);
  // "4 - 6 weeks" is a range, never a dash between clauses.
  assert.equal(noteSentences(note({ assessment: "Should settle in 4 - 6 weeks." }))[0].breaks.length, 0);
});

test("R1T-WB-05: opinion cues are whole words, never prefixes", () => {
  for (const plain of ["her shoulder range was full", "driving to viewings was uncomfortable", "pins and needles in the foot", "one session was cancelled with notice", "health insurance", "his relatives help at home", "the willow tree"]) {
    assert.equal(hasOpinionCue(plain), false, plain);
  }
  for (const cue of ["he should avoid lifting", "a full recovery", "she needs more sessions", "it was caused by the fall", "fit for light duties", "the prognosis is good", "improvement since treatment began"]) {
    assert.equal(hasOpinionCue(cue), true, cue);
  }
  // A movement described as restricted or limited is a finding, not a work restriction.
  assert.equal(hasOpinionCue("painful restricted cervical active range of movement"), false);
  assert.equal(hasOpinionCue("left side flexion was limited by pain"), false);
  assert.equal(hasOpinionCue("restricted to light duties"), true);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-06: frames, synonyms, plan acts, history facts
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-06: occasion and attribution frames are not claim content", () => {
  const people = ["Sarah Reid", "Tom Ellis", "Priya Shah"];
  const claim = (t: string) => draftSentences(t, people)[0].claim;
  assert.equal(claim("At my discharge review on 16/09/2026 I recorded the condition as now largely resolved."), "the condition as now largely resolved");
  assert.equal(claim("Priya Shah's assessment on 20/10/2026 was a sprain resolving well."), "a sprain resolving well");
  assert.equal(claim("Assessment on 08/09/2026: acute low back pain."), "acute low back pain");
  assert.equal(claim("In his assessment of the same date he recorded no nerve root signs."), "no nerve root signs");
  assert.match(claim("On 13/10/2026 Tom Ellis recorded full lumbar range and an assessment of good progress after 5 sessions."), /^full lumbar range and good progress after 5 sessions$/);
  // "I explained the diagnosis …" is the act itself, not a frame.
  assert.match(claim("On 15/07/2026 I explained the diagnosis and the expected recovery."), /diagnosis/);
});

test("R1T-WB-06: the same content in other words – a range, the home programme, back to / returned to", () => {
  const has = (draft: string, noteText: string) => {
    const want = contentStems(draft);
    const have = noteSentences(note({ subjective: noteText }))[0].stems;
    return want.every((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h)));
  };
  assert.ok(has("expected in 2 to 3 weeks", "Expected in 2–3 weeks."));
  assert.ok(has("continue the home exercise programme", "Continue the home programme."));
  assert.ok(has("had not yet returned to match play", "Not yet back to match play."));
  assert.ok(has("tenderness on palpation of the left paraspinal muscles", "Tender left paraspinal muscles."));
  assert.ok(!has("expected in 1 to 2 weeks", "Expected in 2–3 weeks."));
});

test("R1T-WB-06: a plan line's own request or referral is the plan the draft reports; told as done it is not", () => {
  const plan = note({ plan: "Request 3 further sessions from the case manager to complete the graded return to full duties." }, TOM);
  assert.ok(anchorClause({ clause: "the plan to complete the graded return to full duties", notes: [plan] }));
  assert.equal(anchorClause({ clause: "he had completed the graded return to full duties", notes: [plan] }), null);
  const referral = note({ plan: "If the knee locks or gives way repeatedly, refer back to her GP to consider a scan." }, TOM);
  assert.ok(anchorClause({ clause: "advice that if the knee locked or gave way repeatedly, she should be referred back to her gp to consider a scan", notes: [referral] }));
});

test("R1T-WB-06: a history field anchors a history fact, never an outcome", () => {
  const pmh = note({ pastMedicalHistory: "No previous knee injuries. Asthma, well controlled with an inhaler. Low back pain in 2019 that settled fully." } as Partial<Note>);
  assert.ok(anchorClause({ clause: "asthma, well controlled with an inhaler", notes: [pmh] }));
  assert.equal(anchorClause({ clause: "the low back pain settled fully", notes: [pmh] }), null, "an outcome from history needs the draft to say it is history");
  assert.ok(anchorClause({ clause: "low back pain in 2019 that settled fully", notes: [pmh], context: "in his past medical history" }));
});

test("R1T-WB-L4 / R1T-WB-06: a clinical negative joined to a second sentence denies only its own conjunct", () => {
  assert.deepEqual(negativeFindings("There was no quadriceps lag, and single-leg squat was painful and poorly controlled."), ["quadriceps lag"]);
  assert.deepEqual(negativeFindings("No head injury and no loss of consciousness."), ["head injury", "loss of consciousness"]);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-07: quotations
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-07: a quotation of consecutive note sentences is verbatim; one that leaves out a 'not' is not", () => {
  const n = note({ assessment: "Good progress after 4 sessions: the low back pain is settling. In my opinion he should be able to return to full duties within 4 weeks." }, TOM);
  const q = "good progress after 4 sessions: the low back pain is settling. in my opinion he should be able to return to full duties within 4 weeks.";
  assert.ok(quotedVerbatim(q, [n], "Tom Ellis"));
  const not = note({ assessment: "Good progress after 4 sessions: the low back pain is settling. In my opinion he should not be able to return to full duties within 4 weeks." }, TOM);
  assert.equal(quotedVerbatim(q, [not], "Tom Ellis"), null);
  assert.equal(quotedVerbatim(q, [n], "Sarah Reid"), null, "only the clinician it is framed as");
});

test("R1T-WB-07: a frame inside a quotation is the quoted clinician's words, not the drafted sentence's", () => {
  const people = ["Sarah Reid", "Tom Ellis"];
  const s = draftSentences("Tom Ellis recorded on 06/05/2026: “In my opinion he should be able to return to full duties within 4 weeks.”", people)[0];
  const at = s.norm.indexOf("should be able");
  assert.deepEqual(holderAt(s.norm, at, people, s.holder), { kind: "named", name: "Tom Ellis" });
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-08: "Accept as my note's words" from an opinion-box block
 * ----------------------------------------------------------------------------------------------*/

const WORK_OWN = { id: "N-003", author: "sarah", date: "2026-04-15", type: "follow_up", subjective: "Took 3 days off work, then back on normal duties with breaks from the desk." };
const WORK_TEXT = "He told me on 15/04/2026 that he took 3 days off work and then resumed normal duties with breaks from the desk.";

test("R1T-WB-08: the approver's own work-status line blocked in an opinion box is offered for acceptance, and the acceptance clears it", async () => {
  const { b, res } = await built({ report: "template:employer_ffw", notes: [WORK_OWN], box: "fitness_opinion", paragraph: { text: WORK_TEXT, cites: ["N-003"], basis: "patient_reported" } });
  assert.ok(res.blocking.some((f) => f.sectionKey === "fitness_opinion" && f.code === "OPINION_LANGUAGE"));
  const report = { ...b.report, flags: res.flags };
  const fixes = await offeredFixes(report, { actor: "sarah", voiceOwner: "sarah", form: b.form, template: b.template });
  const accept = fixes.find((f) => f.kind === "accept-note-words");
  assert.ok(accept, fixes.map((f) => f.kind).join(", "));
  const after = accept.apply(report);
  assert.ok((after.sections.find((s) => s.key === "fitness_opinion")?.accepted ?? []).length > 0);
  assert.equal(validateBuilt(b, CANDIDATE_ENGINE, after).blocking.filter((f) => f.sectionKey === "fitness_opinion").length, 0);
  // Never to staff, never over a colleague's note, never for a prediction.
  assert.ok(!(await offeredFixes(report, { actor: "pat", voiceOwner: "sarah", form: b.form, template: b.template })).some((f) => f.kind === "accept-note-words"));
  for (const variant of [{ notes: [{ ...WORK_OWN, author: "tom" }], text: WORK_TEXT.replace("He told me", "Tom Ellis recorded") }, { notes: [WORK_OWN], text: WORK_TEXT.replace("and then resumed", "and will resume") }]) {
    const v = await built({ report: "template:employer_ffw", notes: variant.notes, box: "fitness_opinion", paragraph: { text: variant.text, cites: ["N-003"], basis: "patient_reported" } });
    const offers = await offeredFixes({ ...v.b.report, flags: v.res.flags }, { actor: "sarah", voiceOwner: "sarah", form: v.b.form, template: v.b.template });
    assert.ok(!offers.some((f) => f.kind === "accept-note-words"), variant.text);
  }
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-09 / 10 / 11: the first person clause by clause; the one-click names
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-09: the owner's 'I' over their own notes beside a colleague named in the third person is licensed", () => {
  const bundle = { notes: [note({ objective: "Lumbar flexion 50% limited." }, SARAH, "N-001", "2026-03-18"), note({ objective: "Lumbar AROM full and pain-free. ODI 18%." }, TOM, "N-002", "2026-05-06")] };
  const p = (text: string) => ({ text, sourceIds: ["N-001", "N-002"] });
  assert.equal(firstPersonOverColleagues(p("On 18/03/2026 I recorded lumbar flexion 50% limited. On 06/05/2026 Tom Ellis, physiotherapist, recorded full and pain-free lumbar movement."), bundle, SARAH), null);
  const dated = firstPersonOverColleagues(p("On 18/03/2026 I recorded lumbar flexion 50% limited, and on 06/05/2026 I recorded full and pain-free lumbar movement."), bundle, SARAH);
  assert.equal(dated?.length, 1);
  assert.deepEqual(dated?.[0].colleagues, ["Tom Ellis"]);
  const byContent = firstPersonOverColleagues(p("I assessed Mr Testcase on 18/03/2026. Tom Ellis saw him on 06/05/2026, when I found lumbar movement full and pain-free and an ODI of 18%."), bundle, SARAH);
  assert.equal(byContent?.length, 1, "the colleague's findings in the owner's 'I' (lic-1)");
  // "covering my annual leave" beside the named colleague stays licence (ii)'s – never a clause to rename.
  const cover = firstPersonOverColleagues(p("On 06/05/2026 Tom Ellis recorded full lumbar movement while covering my annual leave."), bundle, SARAH);
  assert.equal(cover?.[0].namesColleague, true);
});

test("R1T-WB-09 / 11: 'Name Tom Ellis' renames only the colleague's clause; never a possessive the owner may own", async () => {
  const { b, res } = await built({ box: "examination_findings", paragraph: { text: "On 18/03/2026 I recorded lumbar flexion 50% limited, and on 06/05/2026 I recorded full and pain-free lumbar movement.", cites: ["N-001", "N-002"] } });
  const report = { ...b.report, flags: res.flags };
  const fix = (await offeredFixes(report, { actor: "sarah", voiceOwner: "sarah", form: b.form, template: b.template })).find((f) => f.kind === "name-instead");
  assert.ok(fix);
  const text = fix.apply(report).sections.find((s) => s.key === "examination_findings")?.paragraphs[0].text;
  assert.equal(text, "On 18/03/2026 I recorded lumbar flexion 50% limited, and on 06/05/2026 Tom Ellis recorded full and pain-free lumbar movement.");
  const cover = await built({ notes: [{ id: "N-003", author: "tom", date: "2026-04-15", type: "follow_up", subjective: "Covering Sarah Reid's annual leave.", objective: "Lumbar flexion 80%." }], box: "treatment_provided", paragraph: { text: "On 18/03/2026 I recorded a home exercise programme of pelvic tilts. On 15/04/2026 Tom Ellis, physiotherapist, recorded lumbar flexion of 80% while covering my annual leave.", cites: ["N-001", "N-003"] } });
  const coverFixes = await offeredFixes({ ...cover.b.report, flags: cover.res.flags }, { actor: "sarah", voiceOwner: "sarah", form: cover.b.form, template: cover.b.template });
  assert.ok(!coverFixes.some((f) => f.kind === "name-instead"), "'my annual leave' is never renamed");
});

test("R1T-WB-09: an 'I' dated to the owner's note and to a colleague's only ('… on 18/03/2026 and on 06/05/2026') is flagged once, and never renamed by a click", async () => {
  const { b, res, subject } = await built({ box: "examination_findings", paragraph: { text: "I recorded lumbar flexion 50% limited on 18/03/2026 and on 06/05/2026.", cites: ["N-001", "N-002"] } });
  const voice = subject.filter((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.severity === "blocking");
  assert.ok(voice.length >= 1, JSON.stringify(subject.map((f) => f.evidence)));
  assert.ok(!res.canSign);
  const fixes = await offeredFixes({ ...b.report, flags: res.flags }, { actor: "sarah", voiceOwner: "sarah", form: b.form, template: b.template });
  assert.ok(!fixes.some((f) => f.kind === "name-instead"), "the owner's part would be renamed with it");
  // The colleague's date alone in the owner's "I": one flag (the voice check's), so its one-click answers it.
  const one = await built({ box: "examination_findings", paragraph: { text: "On 18/03/2026 I recorded lumbar flexion 50% limited, and on 06/05/2026 I recorded full and pain-free lumbar movement.", cites: ["N-001", "N-002"] } });
  assert.deepEqual(one.subject.filter((f) => f.code === "OTHER_CLINICIAN_VOICE").map((f) => f.evidence), ["Tom Ellis"]);
});

test("R1T-WB-06: whose finding a sentence is reads its words as written – a shared 'return' never makes it a colleague's opinion", async () => {
  // "Getting back to …" anchors a note's "return to …" (the same content), but beside "phased return to normal duties" it is
  // not Tom Ellis's opinion: the patient's own report ("Working amended duties") holds it as well.
  const { subject } = await built({ report: "form:cf-discharge", box: "F-32", paragraph: { text: "Getting back to light duties at work.", cites: ["N-002"] } });
  assert.ok(!subject.some((f) => f.code === "OTHER_CLINICIAN_VOICE" && (f.evidence ?? "").startsWith("unattributed")), JSON.stringify(subject.map((f) => f.evidence)));
  // A recommendation never reports a discussion; the plan reported as the plan keeps the plan line's own acts unsaid.
  assert.equal(anchorClause({ clause: "surgery was recommended", notes: [note({ plan: "Discuss surgery with GP." })] }), null);
  assert.ok(anchorClause({ clause: "the plan to discuss surgery with his gp", notes: [note({ plan: "Discuss surgery with GP." })] }));
});

test("R1T-WB-09: the message for supporting text that is not printed never says it prints", async () => {
  const { subject } = await built({ report: "form:cf-discharge", answers: { "F-38": true }, box: "F-38", paragraph: { text: "On 06/05/2026 I recorded that a home exercise programme was given.", cites: ["N-002"] } });
  const voice = subject.find((f) => f.code === "OTHER_CLINICIAN_VOICE");
  assert.ok(voice);
  assert.match(voice.message, /not printed on the form/);
  assert.doesNotMatch(voice.message, /^.*On the signed form/);
});

test("R1T-WB-10: on a staff-prepared report and one drafted for another clinician the approver – never staff – is offered the name", async () => {
  for (const author of [null, "tom"]) {
    const { b, res } = await built({ author, box: "prognosis", paragraph: { text: "He is fit for a phased return to normal duties over 2 weeks.", cites: ["N-002"], basis: "clinician_opinion_recorded" } });
    const report = { ...b.report, flags: res.flags };
    const prefix = (await offeredFixes(report, { actor: "sarah", voiceOwner: "sarah", form: b.form, template: b.template })).find((f) => f.kind === "attribution-prefix");
    assert.ok(prefix, `author ${author}`);
    assert.equal(prefix.apply(report).sections.find((s) => s.key === "prognosis")?.paragraphs[0].text, "Tom Ellis recorded that he is fit for a phased return to normal duties over 2 weeks.");
    assert.ok(!(await offeredFixes(report, { actor: "pat", voiceOwner: "sarah", form: b.form, template: b.template })).some((f) => f.kind === "attribution-prefix"), "never to staff");
  }
});

test("R1T-WB-11: a pronoun or an occasion label becomes the name; a compact cell citing one colleague gets the suffix", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ bundle: "gemma", box: "examination_findings", paragraph: { text: "Her assessment was a grade I-II sprain of the right MCL, with possible medial meniscus irritation.", cites: ["N-101"] } }, "Priya Shah's assessment was a grade I-II sprain of the right MCL, with possible medial meniscus irritation."],
    [{ bundle: "gemma", box: "examination_findings", paragraph: { text: "Assessment on 01/09/2026: grade I-II sprain of the right MCL.", cites: ["N-101"] } }, "Priya Shah's assessment on 01/09/2026: grade I-II sprain of the right MCL."],
    [{ report: "form:cf-discharge", box: "F-14", paragraph: { text: "Normal range", cites: ["N-002"] } }, "Normal range (Tom Ellis)"],
    [{ bundle: "gemma", box: "examination_findings", paragraph: { text: "Tenderness over the medial joint line.", cites: ["N-101"] } }, "Priya Shah recorded tenderness over the medial joint line."],
  ];
  for (const [input, want] of cases) {
    const { b, res } = await built(input);
    const report = { ...b.report, flags: res.flags };
    const prefix = (await offeredFixes(report, { actor: "sarah", voiceOwner: "sarah", form: b.form, template: b.template })).find((f) => f.kind === "attribution-prefix");
    assert.ok(prefix, JSON.stringify(input));
    const after = prefix.apply(report);
    assert.equal(after.sections.find((s) => s.key === b.box)?.paragraphs[0].text, want);
    assert.equal(validateBuilt(b, CANDIDATE_ENGINE, after).blocking.filter((f) => f.sectionKey === b.box && f.code === "OTHER_CLINICIAN_VOICE").length, 0, "it clears the flag (I8)");
  }
});

test("R1T-WB-L3: the attribution never doubles 'recorded'", async () => {
  const { b, res } = await built({ box: "outcome_measures", paragraph: { text: "Outcome measures recorded were an Oswestry Disability Index of 18%.", cites: ["N-002"] } });
  const report = { ...b.report, flags: res.flags };
  const prefix = (await offeredFixes(report, { actor: "sarah", voiceOwner: "sarah", form: b.form, template: b.template })).find((f) => f.kind === "attribution-prefix");
  if (prefix) assert.doesNotMatch(prefix.apply(report).sections.find((s) => s.key === "outcome_measures")?.paragraphs[0].text ?? "", /recorded that .*recorded/);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-12: the server and the review read the same body the same way
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-12: POST /validate gives exactly validateReport's flags on the same body (fictional recorded bodies)", async () => {
  const bodies: Array<Record<string, unknown>> = [
    { box: "prognosis", paragraph: { text: "Her opinion was that he would be playing full football again in 4–6 weeks.", cites: ["N-002"], origin: "edited", by: "sarah", basis: "clinician_opinion_recorded" } },
    { box: "prognosis", paragraph: { text: "He will make a full recovery within 6 weeks.", cites: ["N-002"] } },
    { report: "form:cf-discharge", box: "F-10", paragraph: { text: "On 06/05/2026 Tom Ellis recorded that in his opinion he is fit for a phased return to normal duties over 2 weeks.", cites: ["N-002"] } },
  ];
  for (const input of bodies) {
    const { b, res } = await built(input);
    const h = createHttpHarness();
    const req = new Request("http://localhost/api/reports/v1/validate", { method: "POST", headers: { "content-type": "application/json", "x-corpus-member": "sarah" }, body: JSON.stringify({ report: b.report, ...(b.form ? { form: b.form } : {}) }) });
    const out = (await (await bindHandler(handleValidate, () => h.deps)(req, { params: {} })).json()) as { flags: Array<{ id: string; acknowledged?: unknown }>; canSign: boolean };
    assert.deepEqual(out.flags.map((f) => `${f.id}:${Boolean(f.acknowledged)}`).sort(), res.flags.map((f) => `${f.id}:${Boolean(f.acknowledged)}`).sort(), JSON.stringify(input));
    assert.equal(out.canSign, res.canSign);
  }
});

test("R1T-WB-12: the modal pattern is a regex literal holding SUBJECT_MODAL, and it finds a modal clause", () => {
  const modal = OPINION_PATTERNS.find((p) => p.label === "need, plan or prediction");
  assert.ok(modal);
  assert.ok(modal.re.source.startsWith(`\\b${SUBJECT_MODAL}`), "the literal keeps the same alternation");
  assert.match("he would be playing full football again", new RegExp(modal.re.source));
  // The past-tense reading the time frames use (no "\\b" lost): a told-in-the-past "after" is narrative.
  assert.deepEqual(framesIn("fully recovered after 6 sessions."), []);
  assert.deepEqual(framesIn("return to full duties after 2 more sessions."), ["after!"]);
});

test("R1T-WB-12 guard: no WB regex is built from a template literal with \"\\\\b\" and a one-use module constant (the production server build mis-escapes it)", () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const files = [
    ...fs.readdirSync(dir).filter((f) => /^(?:attribution-[a-z-]+|opinion-language|voice)\.ts$/.test(f)).map((f) => path.join(dir, f)),
    path.join(dir, "..", "voice.ts"),
  ];
  const problems: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of Array.from(src.matchAll(/new RegExp\(\s*`([^`]*)`/g))) {
      if (!m[1].includes("\\\\b")) continue;
      // Only a template every substitution of which is a module constant can be folded whole into a string literal.
      const subs = Array.from(m[1].matchAll(/\$\{([^}]*)\}/g), (x) => x[1].trim());
      if (subs.length === 0 || !subs.every((x) => /^[A-Z][A-Z0-9_]*$/.test(x) && new RegExp(`^(?:export )?const ${x}\\b`, "m").test(src))) continue;
      for (const id of subs) {
        const uses = (src.match(new RegExp(`\\b${id}\\b`, "g")) ?? []).length;
        // The definition and one use: the minifier inlines it and folds the template into a mis-escaped string.
        if (uses <= 2) problems.push(`${path.basename(f)}: ${id} in \`${m[1].slice(0, 60)}…\``);
      }
    }
  }
  assert.deepEqual(problems, []);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WB-L1 / L2 / L4
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WB-L1: an opinion kept from the draft in a person's edit says it cannot be acknowledged; the person's own says it can", async () => {
  const drafted = "He will make a full recovery within 6 weeks.";
  // The drafted sentence kept beside the person's own sentence: drafted residue, effective policy "never".
  const kept = await built({ box: "prognosis", paragraph: { text: `${drafted} Pain has settled to 2/10.`, cites: ["N-001"], origin: "edited", originalText: drafted, by: "sarah" } });
  const op = kept.subject.filter((f) => f.code === "OPINION_LANGUAGE" && drafted.toLowerCase().includes((f.evidence ?? "").toLowerCase()));
  assert.ok(op.length > 0);
  for (const f of op) {
    assert.equal(ackPolicyOf(f, kept.b.report), "never");
    assert.doesNotMatch(f.message, /acknowledge it with a reason/);
    assert.match(f.message, /cannot be acknowledged/);
  }
  // The person's own sentence beside it ("has settled"): the acknowledgement its message offers is real.
  const mine = kept.subject.filter((f) => f.code === "OPINION_LANGUAGE" && !drafted.toLowerCase().includes((f.evidence ?? "").toLowerCase()));
  for (const f of mine) {
    assert.equal(ackPolicyOf(f, kept.b.report), "approver");
    assert.match(f.message, /acknowledge it with a reason/);
  }
});

test("R1T-WB-L2: 'Write in my own voice' gives a grammatical sentence or leaves it as written", () => {
  const rows: Array<[string, string]> = [
    ["On 16/09/2026 I recorded the whiplash associated disorder grade II as now largely resolved.", "On 16/09/2026, the whiplash associated disorder grade II was now largely resolved."],
    ["Sarah Reid recorded on 16/09/2026 that Mr Ellery was discharged with a maintenance home programme.", "On 16/09/2026, Mr Ellery was discharged with a maintenance home programme."],
    ["I recorded a Neck Disability Index score of 44% and a Numeric Pain Rating Scale score of 7/10, and I planned to repeat the outcome measures in about 4 weeks.", "I recorded a Neck Disability Index score of 44% and a Numeric Pain Rating Scale score of 7/10, and I planned to repeat the outcome measures in about 4 weeks."],
    ["On 15/07/2026 I recorded an assessment of whiplash associated disorder grade II, and that the symptoms were consistent with the mechanism he describes.", "Assessment on 15/07/2026: whiplash associated disorder grade II; the symptoms were consistent with the mechanism he describes."],
  ];
  for (const [input, want] of rows) {
    const out = inOwnClinicalWording(input, "Sarah Reid");
    assert.equal(out, want);
    assert.doesNotMatch(out, /\d{4} that\b|: the .* as now/);
  }
});

test("R1T-WB-L4: no clinical-negative warning on an administrative box (a staff entry)", async () => {
  const { subject } = await built({ report: "form:cf-discharge", box: "F-25", paragraph: { text: "No hospital number given.", cites: [], origin: "staff", by: "pat" } });
  assert.ok(!subject.some((f) => f.code === "TERM_NOT_IN_SOURCE"));
});

test("fixture sanity: the fictional forms used above are the corpus's own", async () => {
  const { b } = await built({ report: "form:cf-discharge", box: "F-14", paragraph: { text: "Normal range", cites: ["N-002"] } });
  assert.ok((b.form as FormDefinition).title.includes("fictional"));
});
