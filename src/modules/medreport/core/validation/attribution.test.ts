/**
 * bh2 WB – opinion guard and attribution: unit tables for the pieces the safety corpus exercises end to end (plan WB
 * "Tests"): findAnchor (goal, aim, plan, question, negators and hedges before and after, modality, polarity, content),
 * quotation matching, the voice owner in every mode, licences (i) and (ii), the wrong clinician named, which one-click
 * fixes are offered, the rewriteInFirstPerson property, commentary vs clinical negatives, and the sign-time
 * confirmations. Fictional data only (Owen Testcase; Sarah Reid, Tom Ellis).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLICITOR_RTA_TEMPLATE } from "../../templates/registry";
import { requiredConfirmations, signVoiceOwner } from "../../api/handlers/sign/checks/voice";
import type { Clinician, FormDefinition, Note, Report } from "../types";
import { findAnchor, quotedVerbatim } from "./attribution-anchor";
import { namedActs, wrongClinician } from "./attribution-clinician-named";
import { acceptNoteWords, noteWordsOffers, offeredFixes } from "./attribution-fixes";
import { negativeFindings, negativeRecorded } from "./attribution-negatives";
import { defaultVoiceOwner } from "./attribution-owner";
import { commentarySentences } from "./draft-fit/commentary";
import { validateReport } from "./index";
import { para, testBundle, testReport, withSection } from "./test-fixtures";
import { normaliseForMatch } from "./text";
import { voiceIssue } from "./voice";
import { nameInsteadClinician, rewriteInFirstPerson } from "../voice";

const SOL = SOLICITOR_RTA_TEMPLATE;
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const TOM: Clinician = { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" };
const SARAH_APPROVER = { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" };
const SARAH_ACTOR = { memberId: "mem_sarah", name: "Sarah Reid", role: "owner" as const, canSign: true, hcpc: "PH-DEMO-01" };

function note(fields: Partial<Note>, author: Clinician = SARAH): Note {
  return { id: "N-009", date: "2026-04-01", type: "follow_up", author, subjective: "", objective: "", assessment: "", plan: "", ...fields } as Note;
}

/* ------------------------------------------------------------------------------------------------
 * findAnchor
 * ----------------------------------------------------------------------------------------------*/

test("findAnchor: a cited note sentence that asserts the same thing, with the same stance", () => {
  const rows: Array<[name: string, phrase: string, sentence: string, fields: Partial<Note>, kind: "outcome" | "opinion", anchored: boolean]> = [
    ["the note's opinion", "fit for a phased return to normal duties", "He is fit for a phased return to normal duties over 2 weeks.", { assessment: "In my opinion he is fit for a phased return to normal duties over 2 weeks." }, "opinion", true],
    ["a goal", "returned to normal duties", "He returned to normal duties.", { plan: "Goal: return to normal duties." }, "outcome", false],
    ["an aim", "fit for normal duties", "He is fit for normal duties.", { assessment: "Aim: fit for normal duties by June." }, "opinion", false],
    ["the plan field, drafted as having happened", "returned to normal duties", "He returned to normal duties.", { plan: "Return to normal duties within 2 weeks." }, "outcome", false],
    ["a question", "fit for normal duties", "He is fit for normal duties.", { assessment: "Fit for normal duties?" }, "opinion", false],
    ["a negator before", "fit for normal duties", "He is fit for normal duties.", { assessment: "Not fit for normal duties." }, "opinion", false],
    ["a negator after", "fit for normal duties", "He is fit for normal duties.", { assessment: "Fit for normal duties - not yet." }, "opinion", false],
    ["a hedge before", "fit for normal duties", "He is fit for normal duties.", { assessment: "Possibly fit for normal duties." }, "opinion", false],
    ["a hedge after", "fit for normal duties", "He is fit for normal duties.", { assessment: "Fit for normal duties, probably." }, "opinion", false],
    ["the same hedge drafted", "fit for normal duties", "He is possibly fit for normal duties.", { assessment: "Possibly fit for normal duties." }, "opinion", true],
    ["a stronger modality drafted", "be fit for normal duties", "He will be fit for normal duties.", { assessment: "He may be fit for normal duties." }, "opinion", false],
    ["the same modality", "be fit for normal duties", "He may be fit for normal duties.", { assessment: "He may be fit for normal duties." }, "opinion", true],
    ["the same negation drafted", "fit for normal duties", "He is not fit for normal duties.", { assessment: "Not fit for normal duties." }, "opinion", true],
    ["the opposite polarity", "fit for normal duties", "He is not fit for normal duties.", { assessment: "Fit for normal duties." }, "opinion", false],
    ["more content drafted than the note holds", "fit for normal duties", "He is fit for normal duties including heavy lifting.", { assessment: "Fit for normal duties." }, "opinion", false],
    ["a history field", "fit for normal duties", "He is fit for normal duties.", { pastMedicalHistory: "Fit for normal duties." } as Partial<Note>, "opinion", false],
  ];
  for (const [name, phrase, sentence, fields, kind, anchored] of rows) {
    const a = findAnchor({ phrase: normaliseForMatch(phrase), sentence: normaliseForMatch(sentence), notes: [note(fields)], kind });
    assert.equal(Boolean(a), anchored, name);
    if (a) assert.equal(a.noteId, "N-009", name);
  }
});

test("findAnchor: only the cited notes, and the holder's own notes when the draft names whose opinion it is", () => {
  const b = testBundle();
  const phrase = normaliseForMatch("fit for a phased return to normal duties");
  const sentence = normaliseForMatch("He is fit for a phased return to normal duties over 2 weeks.");
  assert.equal(findAnchor({ phrase, sentence, notes: b.notes.filter((n) => n.id === "N-002") })?.noteId, "N-002");
  assert.equal(findAnchor({ phrase, sentence, notes: b.notes.filter((n) => n.id === "N-001") }), null, "not the uncited note");
  assert.equal(findAnchor({ phrase, sentence, notes: b.notes, holder: "Sarah Reid" }), null, "Sarah Reid wrote no note that holds it");
  assert.equal(findAnchor({ phrase, sentence, notes: b.notes, holder: "Tom Ellis" })?.noteId, "N-002");
});

/* ------------------------------------------------------------------------------------------------
 * Quotation matching
 * ----------------------------------------------------------------------------------------------*/

test("quotedVerbatim: word for word in one sentence of the holder's note – normalised, shorthand written out", () => {
  const notes = testBundle().notes;
  const q = (s: string) => normaliseForMatch(s);
  assert.equal(quotedVerbatim(q("fit for a phased return to normal duties over 2 weeks"), notes, "Tom Ellis")?.noteId, "N-002", "verbatim");
  assert.equal(quotedVerbatim(q("Fit for a phased return to normal duties over 2 weeks."), notes, null)?.noteId, "N-002", "case and the closing full stop");
  assert.equal(quotedVerbatim(q("home exercise programme: pelvic tilts"), notes, "Sarah Reid")?.noteId, "N-001", "the note's shorthand (HEP) written out");
  assert.equal(quotedVerbatim(q("fit for a phased return to normal duties over 2 weeks"), notes, "Sarah Reid"), null, "another clinician's words");
  assert.equal(quotedVerbatim(q("fit for a phased return to full duties"), notes, null), null, "one word changed");
});

/* ------------------------------------------------------------------------------------------------
 * The voice owner
 * ----------------------------------------------------------------------------------------------*/

const TOLD_ME = "Mr Testcase told me on 06/05/2026 that his back pain was 2/10 at worst after shifts.";

function toldMeReport(extra: Partial<Report> = {}): { report: Report; pid: string } {
  const p = para(TOLD_ME, ["N-002"], { basis: "patient_reported" });
  return { report: { ...withSection(testReport(SOL), "progress_current_status", [p]), ...extra }, pid: p.id };
}

const voiceFlags = (report: Report, pid: string, opts: Parameters<typeof validateReport>[2] = {}) =>
  validateReport(report, SOL, opts).flags.filter((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === pid);

test("voice owner: the approver; else a signed report's signer; else the author (a report made before approvers); else strict mode", () => {
  const base = testReport(SOL);
  assert.equal(defaultVoiceOwner({ ...base, approver: SARAH_APPROVER, author: TOM })?.name, "Sarah Reid", "the approver wins over the author");
  assert.equal(defaultVoiceOwner({ ...base, author: TOM })?.name, "Tom Ellis");
  assert.equal(defaultVoiceOwner(base), null, "strict mode");
  const receipt = { signer: TOM } as unknown as NonNullable<Report["receipt"]>;
  assert.equal(defaultVoiceOwner({ ...base, status: "signed", receipt })?.name, "Tom Ellis", "a signed report: its signer");
  assert.equal(defaultVoiceOwner({ ...base, status: "signed", receipt, approver: SARAH_APPROVER })?.name, "Sarah Reid");
  assert.equal(defaultVoiceOwner({ ...base, status: "draft", receipt }), null, "a receipt on a report that is not signed does not count");
  // /sign: the approver, else the signer approving it now.
  assert.equal(signVoiceOwner({ approver: SARAH_APPROVER }, TOM).name, "Sarah Reid");
  assert.equal(signVoiceOwner({}, TOM).name, "Tom Ellis");
});

test("voice owner at review and /validate: Tom Ellis's 'told me' is his own; Sarah Reid's report flags it; no owner flags it for the approving clinician", () => {
  const tomApproves = toldMeReport({ approver: { memberId: "mem_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" } });
  assert.deepEqual(voiceFlags(tomApproves.report, tomApproves.pid), []);
  const sarahApproves = toldMeReport({ approver: SARAH_APPROVER });
  const flagged = voiceFlags(sarahApproves.report, sarahApproves.pid);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].ackPolicy, "never", "drafted text");
  // Takeover: the new approver's voice (WC's takeOverApprover sets Report.approver).
  assert.deepEqual(voiceFlags({ ...sarahApproves.report, approver: { memberId: "mem_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" } }, sarahApproves.pid), []);
  const strict = toldMeReport();
  const s = voiceFlags(strict.report, strict.pid);
  assert.equal(s.length, 1);
  assert.match(s[0].message, /No approving clinician is chosen yet/);
  // An explicit owner (the /render path passes the receipt's signer) wins.
  assert.deepEqual(voiceFlags(strict.report, strict.pid, { voice: { owner: TOM } }), []);
});

/* ------------------------------------------------------------------------------------------------
 * Licences (i) and (ii)
 * ----------------------------------------------------------------------------------------------*/

test("licence (i): the first person only when every cited note is the owner's", () => {
  const b = testBundle();
  assert.equal(voiceIssue({ text: "I found lumbar flexion 50% limited on 18/03/2026.", sourceIds: ["N-001"] }, b, SARAH), null);
  assert.deepEqual(voiceIssue({ text: "I assessed Mr Testcase on 18/03/2026. Tom Ellis saw him on 06/05/2026, when I found lumbar movement full and pain-free.", sourceIds: ["N-001", "N-002"] }, b, SARAH)?.others, ["Tom Ellis"], "lic-1");
  assert.deepEqual(voiceIssue({ text: "We agreed a home exercise programme.", sourceIds: ["N-002"] }, b, SARAH)?.others, ["Tom Ellis"], "we / our (C-ATTR-7)");
  assert.deepEqual(voiceIssue({ text: TOLD_ME, sourceIds: ["N-002"] }, b, null)?.others, ["Tom Ellis"], "strict mode");
});

test("licence (ii): a possessive the cited note names the owner for may be acknowledged by the approver; a subject 'I' never", () => {
  const b = testBundle();
  b.notes.push(note({ id: "N-003", date: "2026-04-15", subjective: "Covering Sarah Reid's annual leave. Pain 3/10.", objective: "Lumbar flexion 80%." }, TOM));
  const covering = voiceIssue({ text: "Tom Ellis, physiotherapist, saw Mr Testcase on 15/04/2026 while covering my annual leave.", sourceIds: ["N-003"] }, b, SARAH);
  assert.equal(covering?.possessiveLicence, true);
  const subject = voiceIssue({ text: "Tom Ellis covered my annual leave on 15/04/2026, and I found lumbar flexion 80%.", sourceIds: ["N-003"] }, b, SARAH);
  assert.equal(subject?.possessiveLicence, false, "'I found' is a clinical act in the owner's voice");
  const unnamed = testBundle();
  unnamed.notes.push(note({ id: "N-003", date: "2026-04-15", subjective: "Pain 3/10.", objective: "Lumbar flexion 80%." }, TOM));
  assert.equal(voiceIssue({ text: "Tom Ellis, physiotherapist, saw Mr Testcase on 15/04/2026 while covering my annual leave.", sourceIds: ["N-003"] }, unnamed, SARAH)?.possessiveLicence, false, "the note does not name the owner");
});

/* ------------------------------------------------------------------------------------------------
 * The wrong clinician named (C-ATTR-2)
 * ----------------------------------------------------------------------------------------------*/

test("wrong clinician: a named act needs a cited note that clinician wrote – of that date when a date is given", () => {
  const notes = testBundle().notes;
  const people = ["Sarah Reid", "Tom Ellis"];
  const acts = (s: string) => namedActs(s, people);
  const n1 = notes.filter((n) => n.id === "N-001");
  const n2 = notes.filter((n) => n.id === "N-002");
  assert.match(wrongClinician(acts("Tom Ellis recorded lumbar flexion 50% limited.")[0], n1) ?? "", /Tom Ellis recorded.*written by Sarah Reid/, "Sarah Reid wrote the cited note");
  assert.equal(wrongClinician(acts("Sarah Reid recorded lumbar flexion 50% limited.")[0], n1), null);
  assert.equal(wrongClinician(acts("On 06/05/2026 Tom Ellis recorded full lumbar movement.")[0], n2), null);
  assert.ok(wrongClinician(acts("On 18/03/2026 Tom Ellis recorded full lumbar movement.")[0], n2), "Tom Ellis's cited note is of another date");
  assert.match(wrongClinician(acts("Tom Ellis's assessment was a recovering mechanical back pain.")[0], n1) ?? "", /Tom Ellis/, "the holder of '<Name>'s assessment'");
});

/* ------------------------------------------------------------------------------------------------
 * One-click fixes
 * ----------------------------------------------------------------------------------------------*/

test("'Use my name' is never offered; 'Name X instead' only when every cited note is X's and no own-opinion wording", () => {
  const b = testBundle();
  assert.equal(nameInsteadClinician({ text: TOLD_ME, sourceIds: ["N-002"] }, b, SARAH)?.name, "Tom Ellis");
  assert.equal(nameInsteadClinician({ text: TOLD_ME, sourceIds: ["N-001", "N-002"] }, b, SARAH), null, "notes by two clinicians");
  assert.equal(nameInsteadClinician({ text: `${TOLD_ME} In my opinion he is fit for normal duties.`, sourceIds: ["N-002"] }, b, SARAH), null, "B2-1");
  assert.equal(nameInsteadClinician({ text: TOLD_ME, sourceIds: ["N-001"] }, b, SARAH), null, "the owner's own note");
  assert.equal(nameInsteadClinician({ text: TOLD_ME, sourceIds: ["N-002"], origin: "ai" }, b, SARAH)?.name, "Tom Ellis");
  assert.equal(nameInsteadClinician({ text: TOLD_ME, sourceIds: ["N-002"], origin: "edited" }, b, SARAH), null, "a person's own words: never by a click");
  const { report } = toldMeReport({ approver: SARAH_APPROVER });
  const validated = { ...report, flags: validateReport(report, SOL).flags };
  const kinds = offeredFixes(validated, { actor: SARAH_ACTOR, template: SOL }).map((f) => f.kind);
  assert.ok(!kinds.includes("use-my-name"), kinds.join(", "));
});

test("rewriteInFirstPerson: only the owner's own name becomes 'I' – every other actor is unchanged – and it is idempotent", () => {
  const texts = [
    "On 18/03/2026 Sarah Reid, physiotherapist, recorded lumbar flexion 50% limited. Tom Ellis recorded full lumbar movement on 06/05/2026.",
    "Sarah Reid assessed him on 18/03/2026; she recorded advice to keep active. His GP, Dr Hale, examined him on 20/03/2026 and she advised rest.",
    "Mr Testcase told Sarah Reid that he lifted a 20 kg parcel. Tom Ellis advised a phased return.",
    "At the initial assessment Sarah Reid found tenderness at L4/5, and she treated him with mobilisations.",
  ];
  const VERB = /\b(recorded|assessed|examined|found|measured|noted|treated|advised|discharged)\b/g;
  const subjects = (t: string) => Array.from(t.matchAll(VERB), (m) => t.slice(0, m.index).trim().split(/\s+/).slice(-2).join(" "));
  for (const t of texts) {
    const out = rewriteInFirstPerson(t, "Sarah Reid");
    assert.equal(rewriteInFirstPerson(out, "Sarah Reid"), out, `idempotent: ${out}`);
    const before = subjects(t);
    const after = subjects(out);
    assert.equal(after.length, before.length, out);
    before.forEach((s, i) => {
      const owner = /Sarah Reid|physiotherapist,$|Reid,? physiotherapist,?$/.test(s) || /^Reid$/.test(s.split(" ").pop() ?? "");
      if (owner) assert.match(after[i], /\bI$/, `${t} → ${out}`);
      else assert.equal(after[i], s, `the actor of “${t}” changed: ${out}`);
    });
    assert.equal((out.match(/Tom Ellis|Dr Hale/g) ?? []).length, (t.match(/Tom Ellis|Dr Hale/g) ?? []).length, "other clinicians stay named");
  }
});

test("'Accept as my note's words': only the approver, only a narrated return their own cited note records – recorded in section.accepted", () => {
  const b = testBundle();
  b.notes.push(note({ id: "N-003", date: "2026-03-20", subjective: "Took 3 days off work after the lifting incident, then back on normal duties with breaks from lifting." }));
  const p = para("He took 3 days off work before going back to normal duties.", ["N-003"], { basis: "patient_reported" });
  const report = withSection({ ...testReport(SOL, b), approver: SARAH_APPROVER }, "incident_history", [p]);
  const opinion = (r: Report) => validateReport(r, SOL).flags.filter((f) => f.code === "OPINION_LANGUAGE" && f.paragraphId === p.id);
  assert.equal(opinion(report).length, 1, "never accepted automatically (R-safety-4)");
  const staff = { memberId: "mem_pat", name: "Pat Morgan", role: "staff" as const, canSign: false };
  const tom = { memberId: "mem_tom", name: "Tom Ellis", role: "clinician" as const, canSign: true, hcpc: "PH-DEMO-02" };
  assert.deepEqual(noteWordsOffers(report, staff), []);
  assert.deepEqual(noteWordsOffers(report, tom), [], "another clinician who may sign");
  const [offer, ...more] = noteWordsOffers(report, SARAH_ACTOR);
  assert.equal(more.length, 0);
  assert.equal(offer.noteId, "N-003");
  assert.equal(acceptNoteWords(report, offer, staff), report, "nobody else can record it");
  const accepted = acceptNoteWords(report, offer, SARAH_ACTOR, new Date("2026-10-26T10:00:00.000Z"));
  const entry = accepted.sections.find((s) => s.key === "incident_history")?.accepted?.[0];
  assert.equal(entry?.by?.memberId, "mem_sarah");
  assert.equal(entry?.noteId, "N-003");
  assert.deepEqual(opinion(accepted), []);
  // A changed sentence is no longer the accepted one.
  const edited = withSection(accepted, "incident_history", [{ ...p, text: "He took 3 days off work before going back to normal duties full time." }]);
  assert.equal(opinion({ ...edited, sections: edited.sections.map((s) => (s.key === "incident_history" ? { ...s, accepted: entry ? [entry] : [] } : s)) }).length > 0, true);
  // Sarah Reid's acceptance never covers a colleague's note.
  const tomsNote = withSection({ ...testReport(SOL, b), approver: SARAH_APPROVER }, "incident_history", [{ ...p, sourceIds: ["N-002"] }]);
  assert.deepEqual(noteWordsOffers(tomsNote, SARAH_ACTOR), []);
});

/* ------------------------------------------------------------------------------------------------
 * Commentary and clinical negatives
 * ----------------------------------------------------------------------------------------------*/

test("commentary is about the notes; a clinical negative is never commentary", () => {
  for (const negative of [
    "No red flags.",
    "There were no red flags.",
    "No swelling was noted on examination.",
    "No head injury and no loss of consciousness.",
    "No neurological deficit was found.",
    "No further sessions were planned.",
    "No restriction on driving was advised.",
  ]) {
    assert.deepEqual(commentarySentences(negative), [], negative);
  }
  for (const comment of [
    "No frequency was recorded in that note.",
    "The notes are written by Sarah Reid.",
    "Tom Ellis's note did not record any restriction on driving.",
    "No limits on his work duties were recorded in his notes.",
  ]) {
    assert.equal(commentarySentences(comment).length, 1, comment);
  }
});

test("clinical negatives: each finding a 'No …' sentence denies needs a cited note that records its absence", () => {
  assert.deepEqual(negativeFindings("No head injury and no loss of consciousness were reported."), ["head injury", "loss of consciousness"]);
  assert.deepEqual(negativeFindings("No further sessions were planned."), [], "a plan, not a finding");
  assert.deepEqual(negativeFindings("No restrictions were recorded."), [], "a statement about the record");
  const notes = testBundle().notes;
  assert.equal(negativeRecorded("red flags", notes), true);
  assert.equal(negativeRecorded("swelling", notes), false);
});

/* ------------------------------------------------------------------------------------------------
 * Sign-time confirmations (design 13)
 * ----------------------------------------------------------------------------------------------*/

test("sign-time confirmations: an assessor sign-off the approver did not assess, and a registration number not from their profile", () => {
  const field = (id: string, label: string, fillSource: unknown, answerType = "short_text") => ({ id, label, guidance: "", answerType, anchor: { kind: "docx", target: "table_cell", blockId: id }, fillSource, required: false, confidence: "high" });
  const form = {
    fields: [
      field("F-01", "Assessing physiotherapist", { kind: "signoff", part: "name" }),
      field("F-02", "Treating physiotherapist", { kind: "signoff", part: "name" }),
      field("F-03", "HCPC registration number", { kind: "notes_narrative" }, "hcpc_number"),
    ],
  } as unknown as Pick<FormDefinition, "fields">;
  const report = (hcpc: string): Report => ({ ...testReport(SOL), sections: [{ key: "F-03", title: "HCPC", kind: "ai_narrative", status: "drafted", paragraphs: [{ id: "p", text: hcpc, sourceIds: [], origin: "ai" }] }] }) as unknown as Report;
  // Tom Ellis wrote the discharge note but not the initial assessment (Sarah Reid's).
  assert.deepEqual(requiredConfirmations(report("PH-DEMO-02"), form, TOM).map((c) => c.kind), ["assessed_patient"]);
  assert.deepEqual(requiredConfirmations(report("PH-DEMO-01"), form, SARAH).map((c) => c.kind), [], "Sarah Reid assessed him and the number is hers");
  const other = requiredConfirmations(report("PH-DEMO-07"), form, SARAH);
  assert.deepEqual(other.map((c) => [c.kind, c.value]), [["own_registration_number", "PH-DEMO-07"]]);
  assert.deepEqual(requiredConfirmations(report("PH-DEMO-01"), null, SARAH), [], "no form, nothing to confirm");
});
