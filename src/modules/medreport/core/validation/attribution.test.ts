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
import type { Clinician, FormDefinition, Note, Paragraph, Report } from "../types";
import { anchorClaim, findAnchor, phraseForms, quotedVerbatim } from "./attribution-anchor";
import { firstPersonDatedActs, namedActs, wrongClinician } from "./attribution-clinician-named";
import { acceptNoteWords, attributionActions, noteWordsOffers, offeredFixes } from "./attribution-fixes";
import { negativeFindings, negativeRecorded } from "./attribution-negatives";
import { defaultVoiceOwner } from "./attribution-owner";
import { requiredConfirmations as confirmationsFor } from "./attribution-confirmations";
import { commentarySentences } from "./draft-fit/commentary";
import { authorshipOf, rawOpinionHits, sentenceSha } from "./opinion-language";
import { validateReport } from "./index";
import { para, testBundle, testReport, withSection } from "./test-fixtures";
import { normaliseForMatch } from "./text";
import { droppedFrames, segmentStems, stem, stemsMatch } from "./attribution-text";
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

/* ------------------------------------------------------------------------------------------------
 * check-WB review (26/10/2026): frames, conditions, truncated quotations, the wrong clinician's other forms, the
 * opinion-box rule without a word list, approver acceptance re-checked, unknown origins, hostile sizes
 * ----------------------------------------------------------------------------------------------*/

const subjectFlags = (r: Report, pid: string) => validateReport(r, SOL).blocking.filter((f) => f.paragraphId === pid && (f.code === "OPINION_LANGUAGE" || f.code === "OTHER_CLINICIAN_VOICE"));

function drafted(text: string, notes: Record<string, Partial<Note>>, opts: { box?: string; cites?: string[]; basis?: Paragraph["basis"]; origin?: Paragraph["origin"] } = {}): { report: Report; pid: string } {
  const b = testBundle();
  for (const [id, over] of Object.entries(notes)) {
    const i = b.notes.findIndex((n) => n.id === id);
    b.notes[i] = { ...b.notes[i], subjective: "", objective: "", assessment: "", plan: "", ...over } as Note;
  }
  const p = para(text, opts.cites ?? Object.keys(notes), { ...(opts.basis ? { basis: opts.basis } : {}), ...(opts.origin ? { origin: opts.origin } : {}) });
  return { report: { ...withSection(testReport(SOL, b), opts.box ?? "progress_current_status", [p]), approver: SARAH_APPROVER }, pid: p.id };
}

test("findAnchor frames (M2): someone's worry, belief, feeling, wish, report or condition does not anchor the clinician's opinion – unless the draft keeps the frame", () => {
  const rows: Array<[name: string, phrase: string, sentence: string, fields: Partial<Note>, anchored: boolean]> = [
    ["a worry", "never fully recover", "He will never fully recover.", { subjective: "Pt is worried he will never fully recover." }, false],
    ["the worry kept", "never fully recover", "He is worried he will never fully recover.", { subjective: "Pt is worried he will never fully recover." }, true],
    ["a belief", "make a full recovery", "He will make a full recovery.", { subjective: "Pt thinks he will make a full recovery." }, false],
    ["a feeling", "fully recovered", "He has fully recovered.", { subjective: "Feels fully recovered." }, false],
    ["the feeling kept", "fully recovered", "He feels fully recovered.", { subjective: "Feels fully recovered." }, true],
    ["a GP's words", "make a full recovery", "He will make a full recovery.", { subjective: "GP told him he will make a full recovery." }, false],
    ["another person", "made a full recovery", "He made a full recovery.", { subjective: "His brother made a full recovery from a similar injury." }, false],
    ["an earlier injury", "made a full recovery", "He has made a full recovery.", { subjective: "Had made a full recovery from a 2019 back injury." }, false],
    ["a risk", "chronic", "He has chronic pain.", { assessment: "Risk of chronic pain." }, false],
    ["to monitor", "chronic", "He has chronic pain.", { assessment: "Monitor for chronic pain." }, false],
    ["hopefully", "full recovery", "Full recovery in 6 weeks.", { assessment: "Hopefully full recovery in 6 weeks." }, false],
    ["a solicitor's question as the label", "permanent", "There is a permanent restriction of neck movement.", { subjective: "Solicitor asks for an opinion: permanent restriction of neck movement." }, false],
    ["a wish", "return to full duties", "He will return to full duties next month.", { subjective: "Wants to return to full duties next month." }, false],
    ["a condition (when)", "return to full duties", "He will return to full duties.", { assessment: "Return to full duties when pain allows." }, false],
    ["a condition (once)", "return to full duties", "He will return to full duties.", { assessment: "Return to full duties once symptoms settle." }, false],
    ["a lead condition", "full recovery", "Full recovery in 6 weeks.", { assessment: "Assuming no setbacks, full recovery in 6 weeks." }, false],
    ["a refusal", "return to full duties", "He will return to full duties.", { subjective: "Employer refused his request to return to full duties." }, false],
    ["a question asked", "can return", "He can return to normal duties.", { subjective: "Asking when he can return to normal duties." }, false],
    ["the clinician's own statement", "fit for full duties", "He is fit for full duties.", { assessment: "Pt keen to get back to running, lumbar ROM full, fit for full duties." }, true],
    ["a past 'after' is narrative", "fully recovered", "He fully recovered after 6 sessions.", { assessment: "Fully recovered after 6 sessions." }, true],
  ];
  for (const [name, phrase, sentence, fields, anchored] of rows) {
    const a = findAnchor({ phrase: normaliseForMatch(phrase), sentence: normaliseForMatch(sentence), notes: [note(fields)], kind: "outcome" });
    assert.equal(Boolean(a), anchored, name);
  }
});

test("the overlap rule (M1): a pattern with its own allow never absorbs the prediction beside it", () => {
  const labels = (t: string) => rawOpinionHits(normaliseForMatch(t)).map((h) => `${h.label}:${h.phrase}`);
  assert.deepEqual(labels("He will return to full duties."), ["prediction:will return", "return to normal work or activity:return to full duties"]);
  assert.deepEqual(labels("He is expected to return to normal duties."), ["prediction:is expected", "return to normal work or activity:return to normal duties"], "two predictions sharing words are one claim");
  for (const [n, text] of [
    ["Return to full duties when pain allows.", "He will return to full duties."],
    ["Wants to return to full duties next month.", "He will return to full duties next month."],
    ["Employer refused his request to return to full duties.", "He will return to full duties."],
    ["Asked about being back on full duties next month.", "He should be back on full duties next month."],
  ] as const) {
    const r = drafted(text, { "N-001": { assessment: n } });
    assert.ok(subjectFlags(r.report, r.pid).length > 0, `${text} | ${n}`);
  }
  const ok = drafted("He will return to full duties next month.", { "N-001": { assessment: "Will return to full duties next month." } });
  assert.deepEqual(subjectFlags(ok.report, ok.pid), [], "the note records the same prediction");
});

test("quotations (M3): a quotation that leaves out a negator, hedge, '?', goal label, weaker modal or condition is a misquotation", () => {
  const q = (s: string) => normaliseForMatch(s);
  const rows: Array<[name: string, quoted: string, fields: Partial<Note>, ok: boolean, outside?: string]> = [
    ["'not' left out", "fit for full duties", { assessment: "Not fit for full duties." }, false],
    ["the whole statement", "not fit for full duties", { assessment: "Not fit for full duties." }, true],
    ["'not' kept outside the quotation", "fit for full duties", { assessment: "Not fit for full duties." }, true, "he was not"],
    ["'unlikely' left out", "make a full recovery", { assessment: "Unlikely to make a full recovery." }, false],
    ["'?' left out", "permanent restriction of lumbar flexion", { assessment: "?Permanent restriction of lumbar flexion." }, false],
    ["'Goal:' left out", "full recovery in 6 weeks", { plan: "Goal: full recovery in 6 weeks." }, false],
    ["the label quoted", "goal: full recovery in 6 weeks", { plan: "Goal: full recovery in 6 weeks." }, true],
    ["a condition left out", "full recovery expected in 6 weeks", { assessment: "Full recovery expected in 6 weeks if he complies with HEP." }, false],
    ["a lead condition left out", "full recovery in 6 weeks", { assessment: "Assuming no setbacks, full recovery in 6 weeks." }, false],
    ["'should' left out", "make a full recovery", { assessment: "Should make a full recovery." }, false],
    ["the patient's worry left out", "he will never fully recover", { subjective: "Pt is worried he will never fully recover." }, false],
    ["another conjunct's negative is not this statement's", "fit for full duties", { assessment: "Lumbar ROM full, no neurological signs, fit for full duties." }, true],
  ];
  for (const [name, quoted, fields, ok, outside] of rows) {
    assert.equal(Boolean(quotedVerbatim(q(quoted), [note(fields, TOM)], "Tom Ellis", outside ?? "")), ok, name);
  }
  const box = drafted("Tom Ellis recorded on 06/05/2026: “fit for full duties”.", { "N-002": { assessment: "Not fit for full duties." } }, { box: "prognosis", basis: "clinician_opinion_recorded" });
  assert.ok(subjectFlags(box.report, box.pid).length > 0, "in the opinion box");
  const inline = drafted("The pain was “caused by the lifting incident”.", { "N-001": { assessment: "Not caused by the lifting incident." } });
  assert.ok(subjectFlags(inline.report, inline.pid).length > 0, "inline, the approver's own note");
});

test("the wrong clinician (M4): stated / wrote / reported, 'according to', 'per', title and surname, a role between, an attribution suffix", () => {
  const people = ["Sarah Reid", "Tom Ellis"];
  const n1 = testBundle().notes.filter((n) => n.id === "N-001");
  for (const t of [
    "Tom Ellis stated that lumbar flexion was 50% limited.",
    "Tom Ellis wrote that lumbar flexion was 50% limited.",
    "Tom Ellis reported that lumbar flexion was 50% limited.",
    "According to Tom Ellis, lumbar flexion was 50% limited.",
    "Lumbar flexion was 50% limited, per Tom Ellis.",
    "Mr Ellis recorded that lumbar flexion was 50% limited.",
    "Tom Ellis, our senior physiotherapist, recorded that lumbar flexion was 50% limited.",
    "Lumbar flexion was 50% limited (Tom Ellis, 18/03/2026).",
  ]) {
    const acts = namedActs(t, people, { patientSurname: "Testcase" });
    assert.ok(acts.length > 0 && acts.some((a) => wrongClinician(a, n1)), t);
  }
  assert.deepEqual(namedActs("Mr Testcase reported pain of 7/10.", ["Sarah Reid", "Tom Testcase"], { patientSurname: "Testcase" }), [], "the patient's surname is never a clinician's");
  const seen = drafted("He was seen by Tom Ellis on 01/04/2026, who advised rest.", { "N-001": { subjective: "Seen by Tom Ellis on 01/04/2026 while SR on leave; advised rest." } });
  assert.deepEqual(validateReport(seen.report, SOL).flags.filter((f) => f.paragraphId === seen.pid && /names Tom Ellis/.test(f.evidence ?? "")), [], "the cited note's own account of his act");
});

test("the opinion-box rule (M5): every content segment is held by a cited note or the record – no word list", () => {
  for (const text of ["He is doing well.", "Excellent progress.", "Normal function.", "His back is as good as new.", "His presentation was consistent with a lumbar disc prolapse."]) {
    const r = drafted(text, { "N-001": testBundle().notes[0] }, { box: "prognosis", basis: "clinician_opinion_recorded" });
    assert.ok(subjectFlags(r.report, r.pid).length > 0, text);
  }
  const ok = drafted("His presentation was consistent with acute mechanical low back pain.", { "N-001": testBundle().notes[0] }, { box: "prognosis", basis: "clinician_opinion_recorded" });
  assert.deepEqual(subjectFlags(ok.report, ok.pid), [], "held by the approver's own cited note");
  for (const text of [
    "His injuries are consistent with a rear-end collision.",
    "His symptoms are in keeping with the lifting incident.",
    "The lifting incident is responsible for his back pain.",
    "His pain originates from the lifting incident.",
    "He has been cleared for work.",
    "He has been signed off as fit.",
    "He has no ongoing limitations at work.",
    "He has regained full function.",
    "The stiffness is there for good.",
    "The pain is not going to go away.",
  ]) {
    const r = drafted(text, { "N-001": testBundle().notes[0] });
    assert.ok(subjectFlags(r.report, r.pid).length > 0, text);
  }
});

test("approver acceptance (minor 1): a stored entry clears only a narrated return the accepted note records", () => {
  const text = "He will never fully recover and the accident caused his permanent disability.";
  const r = drafted(text, { "N-001": testBundle().notes[0] });
  const by = { memberId: "mem_sarah", name: "Sarah Reid", role: "clinician" as const, canSign: true };
  const before = subjectFlags(r.report, r.pid);
  assert.ok(before.length > 0);
  const accepted = before.map((f) => ({ check: "OPINION_LANGUAGE", phrase: (f.evidence ?? "").toLowerCase(), sentenceSha: sentenceSha(text), noteId: "N-001", by, at: "2026-10-26T10:00:00.000Z" }));
  const forged = { ...r.report, sections: r.report.sections.map((s) => (s.key === "progress_current_status" ? { ...s, accepted } : s)) } as Report;
  assert.equal(subjectFlags(forged, r.pid).length, before.length, "nothing else is ever accepted");
});

test("an unknown paragraph origin is checked (minor 2: fail closed)", () => {
  assert.equal(authorshipOf({ origin: "imported" as never }, { approver: SARAH_APPROVER }), "person");
  assert.equal(authorshipOf({ origin: "clinician" }, { approver: SARAH_APPROVER }), "approver");
});

test("sign-time confirmations (minor 7): the generic assessor, treating and registration labels", () => {
  const b = testBundle();
  const tomOnly = { ...b, notes: b.notes.map((n) => ({ ...n, author: TOM })) };
  const ask = (label: string, fillSource: unknown, value = "") =>
    confirmationsFor({ sections: value ? [{ key: "R1", paragraphs: [{ text: value }] }] : [], bundleSnapshot: tomOnly } as unknown as Report, { fields: [{ id: "R1", label, fillSource, answerType: "short_text" }] } as unknown as Pick<FormDefinition, "fields">, SARAH).map((c) => c.kind);
  for (const label of ["Physiotherapist who saw the claimant", "Clinician who carried out the assessment", "Physiotherapist conducting the initial assessment"]) assert.deepEqual(ask(label, { kind: "signoff", part: "name" }), ["assessed_patient"], label);
  for (const label of ["Clinician providing treatment", "Physio responsible for treatment"]) assert.deepEqual(ask(label, { kind: "signoff", part: "name" }), ["treated_patient"], label);
  for (const label of ["Reg. no", "Professional body number"]) assert.deepEqual(ask(label, { kind: "static" }, "PH-DEMO-02"), ["own_registration_number"], label);
  assert.deepEqual(ask("Name of the person who completed this form", { kind: "signoff", part: "name" }), [], "not an assessor label");
});

test("'Accept as my note's words' and 'Remove the note link' are report actions any review engine can list (minor 6)", () => {
  const b = testBundle();
  b.notes.push(note({ id: "N-003", date: "2026-03-20", subjective: "Took 3 days off work after the lifting incident, then back on normal duties with breaks from lifting." }));
  const p = para("He took 3 days off work before going back to normal duties.", ["N-003"], { basis: "patient_reported" });
  const report = withSection({ ...testReport(SOL, b), approver: SARAH_APPROVER }, "incident_history", [p]);
  const validated = { ...report, flags: validateReport(report, SOL).flags };
  assert.deepEqual(attributionActions(validated, { actor: SARAH_ACTOR }).map((a) => a.kind), ["accept-note-words"]);
  assert.ok(offeredFixes(validated, { actor: SARAH_ACTOR, template: SOL }).some((f) => f.kind === "accept-note-words"));
});

test("hostile sizes (M6): an opinion box of thousands of comma segments and a note sentence of thousands are validated in linear time", () => {
  for (const n of [400, 4000]) {
    const commas = Array.from({ length: n }, (_, i) => `w${i}`).join(", ");
    const r = drafted(`He will recover, ${commas}.`, { "N-001": testBundle().notes[0] }, { box: "prognosis", basis: "clinician_opinion_recorded" });
    const t0 = Date.now();
    const flags = subjectFlags(r.report, r.pid);
    const ms = Date.now() - t0;
    // Linear: well under a second here; the O(S^4) search took 52 s at 400 segments.
    assert.ok(ms < 10_000, `${n} segments: ${ms} ms`);
    assert.ok(flags.length > 0, "a claim no note holds still blocks");
    const claim = anchorClaim({ clause: `He will recover, ${commas}`, notes: [testBundle().notes[0]] });
    assert.ok(claim.segments.every((g) => g.anchor === null));
  }
  const long = Array.from({ length: 3000 }, (_, i) => `x${i}`).join(", ");
  const r = drafted("He will make a full recovery.", { "N-001": { assessment: `Will make a full recovery, ${long}.` } });
  const t0 = Date.now();
  subjectFlags(r.report, r.pid);
  assert.ok(Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
});

/* ------------------------------------------------------------------------------------------------
 * harden-WB (check2-WB, 26/10/2026): faithful text from the sample notes and recorded drafts anchors; the dates a clause
 * reports are not the record's date; bounded work on hostile notes
 * ----------------------------------------------------------------------------------------------*/

test("faithful drafts anchor (N1, N2): light verbs, tense, a count of sessions, plan instructions, reported advice, 'as if'", () => {
  const rows: Array<[name: string, text: string, notes: Record<string, Partial<Note>>, opts?: Parameters<typeof drafted>[2]]> = [
    ["made good progress", "He made good progress with the home exercises.", { "N-001": { assessment: "Good progress with the home exercises." } }],
    ["making steady progress, a lead date", "By 01/04/2026 he was making steady progress.", { "N-001": { assessment: "Steady progress." } }],
    ["a lead occasion is not content", "By the review on 18/03/2026 he had made good progress.", { "N-001": { assessment: "Good progress." } }],
    ["a count of sessions beside a past clause (D8)", "On 06/05/2026 Tom Ellis recorded good progress after 4 sessions and that the back pain was easing.", { "N-002": { assessment: "Good progress after 4 sessions: the back pain is easing." } }],
    ["had settled / has settled", "By then his sleep had settled.", { "N-001": { subjective: "Sleep has settled." } }],
    ["felt / feels", "He said his neck felt almost back to normal.", { "N-001": { subjective: "Neck feels almost back to normal." } }],
    ["would / will, 'as if'", "He said it felt as if the knee would give way on stairs.", { "N-001": { subjective: "Knee feels as if it will give way on stairs." } }],
    ["'a feeling that' over 'feels as if'", "He described a feeling that the knee might give way on stairs.", { "N-001": { subjective: "Knee feels as if it might give way on stairs." } }],
    ["should over a plan line", "On 18/03/2026 Sarah Reid recorded a plan that he should avoid heavy lifting.", { "N-001": { plan: "Avoid heavy lifting." } }],
    ["a plan to continue", "On 06/05/2026 Tom Ellis recorded a plan to continue the home exercises daily.", { "N-002": { plan: "Continue the home exercises daily." } }],
    ["would, reported as the plan", "On 18/03/2026 Sarah Reid recorded in the plan that sessions would be fortnightly.", { "N-001": { plan: "Fortnightly sessions." } }],
    ["an outcome in the plan field, reported as explained", "Tom Ellis recorded in the plan that he explained that the outlook is good.", { "N-002": { plan: "Explained that the outlook is good." } }],
    ["a request to complete a graded return", "Tom Ellis requested 2 further sessions from the employer to complete the graded return to his usual role.", { "N-002": { plan: "Request 2 further sessions from the employer to complete the graded return to his usual role." } }],
    ["advice reported in an opinion box", "On 18/03/2026 Sarah Reid recorded in the plan that ice was advised for the swelling.", { "N-001": { plan: "Ice for the swelling." } }, { box: "prognosis", basis: "clinician_opinion_recorded" }],
    ["Yes – resolved", "Yes – resolved", { "N-001": { assessment: "Neck pain resolved." } }],
    ["a direction is not permanence", "He turned sharply to the left with his foot planted.", { "N-001": { subjective: "Turned sharply to the left with foot planted." } }, { box: "incident_history", basis: "patient_reported" }],
  ];
  for (const [name, text, notes, opts] of rows) {
    const r = drafted(text, notes, opts);
    assert.deepEqual(subjectFlags(r.report, r.pid).map((f) => f.evidence), [], name);
  }
});

test("what still blocks beside the N1/N2 readings: conditions, frames, a stronger modal, a plan line read only with a plan modal", () => {
  const rows: Array<[name: string, text: string, notes: Record<string, Partial<Note>>, opts?: Parameters<typeof drafted>[2]]> = [
    ["hoped-for progress", "He made good progress.", { "N-001": { assessment: "Hoping for good progress." } }],
    ["progress expected after more sessions", "Tom Ellis recorded good progress after 4 sessions.", { "N-002": { assessment: "Good progress expected after 4 more sessions." } }],
    ["a count that conditions a fitness", "He is fit for normal duties.", { "N-001": { assessment: "Fit for normal duties after 2 sessions." } }],
    ["a future condition told as past", "He was fit for normal duties after 2 more sessions.", { "N-001": { assessment: "Fit for normal duties after 2 more sessions." } }],
    ["a condition told as past", "He returned to full duties when his pain allowed.", { "N-001": { assessment: "Return to full duties when pain allows." } }],
    ["has not settled", "By then his sleep had settled.", { "N-001": { subjective: "Sleep has not settled." } }],
    ["will over would", "He will recover with rest.", { "N-001": { assessment: "Would recover with rest." } }],
    ["someone else's feeling", "His neck was almost back to normal.", { "N-001": { subjective: "Wife feels his neck is almost back to normal." } }],
    ["a real condition beside 'as if'", "He described a feeling that the knee might give way on stairs.", { "N-001": { subjective: "Knee feels as if it might give way on stairs if he rushes." } }],
    ["should over a conditional plan", "He should return to full duties.", { "N-001": { plan: "Return to full duties when pain allows." } }],
    ["should over a finding", "He should avoid lifting.", { "N-001": { subjective: "Avoids lifting at home." } }],
    ["will, not reported as the plan", "He will avoid heavy lifting.", { "N-001": { plan: "Avoid heavy lifting." } }],
    ["must is stronger than the plan", "He must avoid heavy lifting.", { "N-001": { plan: "Avoid heavy lifting." } }],
    ["can is not a plan", "He can return to full duties.", { "N-001": { plan: "Return to full duties." } }],
    ["a goal is not a plan instruction", "He needs to return to full duties.", { "N-001": { plan: "Goal: return to full duties." } }],
    ["the patient's wish", "He should have 3 more sessions.", { "N-001": { plan: "Pt would like 3 more sessions." } }],
    ["a third party's request", "He should have 3 more sessions.", { "N-001": { plan: "Solicitor requests 3 more sessions." } }],
    ["a negated plan modal", "He should not return to work.", { "N-001": { plan: "Return to work." } }],
    ["drafted as having happened, plan-framed", "Sarah Reid recorded in the plan that he returned to full duties.", { "N-001": { plan: "Return to full duties within 2 weeks." } }],
    ["an explained outlook with a condition", "Tom Ellis recorded in the plan that the outlook is good.", { "N-002": { plan: "Explained the outlook is good if he keeps active." } }],
    ["advice over a discussion", "Surgery was recommended.", { "N-001": { plan: "Discuss surgery with GP." } }, { box: "prognosis", basis: "clinician_opinion_recorded" }],
    ["advice over a finding", "Rest was advised.", { "N-001": { subjective: "Rest helps." } }, { box: "prognosis", basis: "clinician_opinion_recorded" }],
    ["'left with' over 'to the left with'", "He was left with a pull in the knee.", { "N-001": { subjective: "Turned sharply to the left with foot planted; felt a pull in the knee." } }],
    ["Yes – resolved over not resolved", "Yes – resolved", { "N-001": { assessment: "Neck pain not resolved." } }],
  ];
  for (const [name, text, notes, opts] of rows) {
    const r = drafted(text, notes, opts);
    assert.ok(subjectFlags(r.report, r.pid).length > 0, name);
  }
});

test("text helpers (harden-WB): tense forms of a phrase, irregular verbs, plurals, time frames per conjunct", () => {
  assert.deepEqual(phraseForms("had settled"), ["had settled", "has settled", "have settled", "settled"]);
  assert.deepEqual(phraseForms("would give"), ["would give", "will give"]);
  assert.deepEqual(phraseForms("should avoid"), ["should avoid"]);
  assert.equal(stem("felt"), stem("feels"));
  assert.ok(stemsMatch(stem("knees"), stem("knee")));
  assert.ok(stemsMatch(stem("gives"), stem("give")));
  assert.ok(stemsMatch(stem("wakes"), stem("waking")));
  assert.ok(stemsMatch(stem("gave"), stem("gives")));
  assert.ok(!stemsMatch(stem("left"), stem("leave")), "a side is not leave");
  // "when" / "after": a condition only about an outcome to come, never a count of the sessions given or a symptom's behaviour.
  const dropped = (n: string, d: string) => droppedFrames(normaliseForMatch(n), normaliseForMatch(d));
  // An outcome's condition ("when!"): kept only in a conjunct not told in the past; an attribution verb is not the claim's tense.
  assert.deepEqual(dropped("Return to full duties when pain allows.", "he will return to full duties"), ["when!"]);
  assert.deepEqual(dropped("Return to full duties when pain allows.", "tom ellis recorded that she would return to full duties when pain allows"), []);
  assert.deepEqual(dropped("Return to full duties when pain allows.", "she returned to full duties when pain allowed"), ["when!"]);
  assert.deepEqual(dropped("Return to full duties when settled.", "she will return to full duties"), ["when!"], "a participle after the word is the condition's own");
  assert.deepEqual(dropped("Fit for full duties after 2 sessions.", "he is fit for full duties"), ["after!"]);
  // A count of the treatment given is narrative; a past conjunct is narrative.
  assert.deepEqual(dropped("Good progress after 5 sessions: the pain is easing.", "good progress and the pain was easing"), []);
  assert.deepEqual(dropped("Fully recovered after 6 sessions.", "he fully recovered"), []);
  // A finding's condition ("after"): kept whenever the draft has the word, in any tense.
  assert.deepEqual(dropped("Pain worse after lifting.", "his pain was worse after lifting"), []);
  assert.deepEqual(dropped("Pain worse after lifting.", "his pain was worse"), ["after"]);
  assert.deepEqual(dropped("Normal function when healed.", "he has normal function"), ["when"]);
  // Notes are not cached by a copy of their text; a long drafted text is not kept at all.
  const long = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(", ");
  assert.notEqual(segmentStems(long), segmentStems(long), "a long text is not remembered");
  assert.equal(segmentStems("a short claim, kept"), segmentStems("a short claim, kept"));
});

test("dates (N3): a date in what a clinician recorded is not the record's date; a date that leads or follows the act is", () => {
  const people = ["Sarah Reid", "Tom Ellis", "Priya Shah"];
  const tom = note({ id: "N-002", date: "2026-05-06", subjective: "Back on amended duties since 20/04/2026." }, TOM);
  const sarah = note({ id: "N-001", date: "2026-03-18", subjective: "Lifting injury at work on 12/03/2026." }, SARAH);
  const act = (t: string, name: string) => namedActs(t, people).find((a) => a.name === name) as ReturnType<typeof namedActs>[number];
  assert.equal(wrongClinician(act("Tom Ellis recorded that he had been back on amended duties since 20/04/2026.", "Tom Ellis"), [tom]), null, "the note gives the date");
  assert.equal(wrongClinician(act("Sarah Reid recorded that the lifting injury happened at work on 12/03/2026.", "Sarah Reid"), [sarah]), null, "the incident's date in her own note");
  assert.equal(act("Tom Ellis's assessment was mechanical back pain following an incident at work on 12/03/2026.", "Tom Ellis").dateRole, "content");
  for (const t of ["On 20/04/2026 Tom Ellis recorded amended duties.", "Tom Ellis recorded on 20/04/2026 that he was on amended duties.", "Tom Ellis's note of 20/04/2026 recorded amended duties.", "Amended duties (Tom Ellis, 20/04/2026).", "At the review on 20/04/2026, Tom Ellis recorded amended duties.", "There were no red flags and on 20/04/2026 Tom Ellis recorded amended duties."]) {
    const a = act(t, "Tom Ellis");
    assert.equal(a.dateRole, "record", t);
    assert.match(wrongClinician(a, [tom]) ?? "", /dates Tom Ellis's record to 20\/04\/2026/, t);
  }
  const elsewhere = act("Tom Ellis recorded mobilisations on 18/03/2026.", "Tom Ellis");
  assert.match(wrongClinician(elsewhere, [tom, sarah]) ?? "", /gives 18\/03\/2026 in what Tom Ellis recorded/, "a date neither of his notes gives");
  assert.deepEqual(firstPersonDatedActs("On 12/03/2026 I recorded that the injury happened at work.").map((a) => a.date), ["2026-03-12"]);
  assert.deepEqual(firstPersonDatedActs("I recorded that the injury happened at work on 12/03/2026."), [], "a date in what is reported");
  const own = drafted("On 12/03/2026 I recorded that the lifting injury happened at work.", { "N-001": { subjective: "Lifting injury at work on 12/03/2026." } });
  assert.match(subjectFlags(own.report, own.pid).map((f) => f.message).join(" "), /dates your record to 12\/03\/2026/);
});

test("hostile sizes (N4, m3): many quotations over a long note sentence that repeats them, and thousands of time words, stay bounded", () => {
  const sentence = `not ${Array.from({ length: 4000 }, () => "pain").join(" ")}.`;
  const r = drafted(`Tom Ellis recorded ${Array.from({ length: 40 }, () => "“pain pain pain”").join(" and ")}.`, { "N-002": { subjective: sentence } });
  let t0 = Date.now();
  subjectFlags(r.report, r.pid);
  assert.ok(Date.now() - t0 < 10_000, `40 quotations over a 20 KB sentence: ${Date.now() - t0} ms (64 s before)`);
  assert.equal(quotedVerbatim("pain pain pain", [note({ subjective: sentence }, TOM)], "Tom Ellis"), null, "every place drops the 'not': never verbatim");
  const box = drafted("Tom Ellis recorded on 06/05/2026: “pain pain pain”.", { "N-002": { subjective: sentence } }, { box: "prognosis", basis: "clinician_opinion_recorded" });
  t0 = Date.now();
  assert.ok(subjectFlags(box.report, box.pid).length > 0);
  assert.ok(Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
  const after = drafted("He is fit for full duties.", { "N-001": { assessment: `Fit for full duties ${Array.from({ length: 20000 }, () => "after").join(" ")} rest.` } });
  t0 = Date.now();
  assert.ok(subjectFlags(after.report, after.pid).length > 0, "a condition past the bound fails closed");
  assert.ok(Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
});

test("a pronoun act after a lead date continues the named colleague; 'Name X' puts the name in the pronoun's place (harden-WB)", () => {
  const n2 = { plan: "Continue the home exercises daily.", objective: "Lumbar AROM full and pain-free." };
  const ok = drafted("On 06/05/2026 Tom Ellis recorded that lumbar AROM was full and pain-free. On 06/05/2026 he recorded a plan to continue the home exercises daily.", { "N-002": n2 });
  assert.deepEqual(subjectFlags(ok.report, ok.pid).map((f) => f.evidence), [], "the second sentence's 'he' is Tom Ellis");
  const lone = drafted("He recorded that, in his opinion, he is fit for a phased return to normal duties over 2 weeks.", { "N-002": testBundle().notes[1] });
  const own = { ...lone.report, author: SARAH };
  const validated = { ...own, flags: validateReport(own, SOL).flags };
  assert.ok(validated.flags.some((f) => f.paragraphId === lone.pid && /^unattributed Tom Ellis/.test(f.evidence ?? "")), "no one named before: unattributed");
  const prefix = offeredFixes(validated, { actor: SARAH_ACTOR, template: SOL }).find((f) => f.kind === "attribution-prefix");
  assert.ok(prefix, "the approver is offered 'Name Tom Ellis'");
  const text = prefix.apply(validated).sections.flatMap((s) => s.paragraphs).find((p) => p.id === lone.pid)?.text ?? "";
  assert.equal(text, "Tom Ellis recorded that, in his opinion, he is fit for a phased return to normal duties over 2 weeks.");
});
