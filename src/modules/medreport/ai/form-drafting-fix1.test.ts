/**
 * bh2 fix round 1 (WD): the round-1 findings on the 17 Blue Heart forms with the 3 sample patients, pinned on fictional
 * forms and notes in ClinForms' own wording.
 * - R1T-WD-03: a record yes/no whose own supporting text contradicts it, whose printed condition does not hold, or
 *   that answers "any other treatment" from the physiotherapy being reported, is held back – never entered unflagged.
 * - R1T-WD-04: the body area treated and the modalities used are facts of the whole episode, never held back as "the
 *   position now"; a question that asks for the position now still is.
 * - R1T-WD-05: an opinion box never prints a paragraph of the record's figures alone.
 * - R1T-WD-L2: a comment about the record in a printed answer is held back, never a clinical negative.
 * - R1T-WD-L3: "N of N appointments" and "with 1 did not attend" are advised against.
 * - R1T-WD-L4: a gap on a single tick box that says nothing was recorded is "no opinion recorded".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleDraft } from "./assemble";
import { draftedGapKind, latestWorkState, recordYesNoProblem, workStateOfClause } from "./form-drafting-answers";
import { holdBackMeta } from "./form-drafting-wording";
import { computeFacts } from "../core/computed-facts";
import { formToTemplate } from "../core/forms";
import { formTimeKind, timePointOf } from "../core/forms/answer-shape";
import type { FormDefinition, FormField, Note, Paragraph } from "../core/types";
import { attendanceFramingPart } from "../core/validation/draft-fit/measure";
import { TEST_FACTS_DATE, testBundle } from "../core/validation/test-fixtures";

const AT = "2026-10-06T09:00:00.000Z";
const SARAH = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };

function yesNo(id: string, label: string, rest: Partial<FormField> = {}): FormField {
  return {
    id,
    label,
    guidance: "",
    answerType: "yes_no",
    options: ["Yes", "No"],
    anchor: { kind: "docx", target: "checkbox_glyph", blockId: `t0.r${id.slice(2)}.c1`, optionGlyphs: [{ option: "Yes", blockId: `t0.r${id.slice(2)}.c1`, glyphIndex: 0 }, { option: "No", blockId: `t0.r${id.slice(2)}.c1`, glyphIndex: 1 }] },
    fillSource: { kind: "notes_narrative" },
    required: true,
    confidence: "high",
    ...rest,
  };
}
function cell(id: string, label: string, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest };
}
function form(title: string, fields: FormField[]): FormDefinition {
  return {
    id: "frm_wd_fix1",
    tenantId: "demo",
    referrer: { name: "Eastbrook Case Services (fictional)", type: "mlc" },
    title,
    file: { fileName: "wd.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "a".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}
const note = (id: string, date: string, subjective: string): Note => ({ id, date, type: "follow_up", author: { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Physiotherapist" }, subjective, objective: "", assessment: "", plan: "" }) as Note;
const support = (text: string): Paragraph[] => [{ id: "p1", text, sourceIds: ["N-001"], origin: "ai", basis: "patient_reported" }];
const problem = (label: string, value: string, text: string, notes: Note[]) => recordYesNoProblem({ field: yesNo("F-27", label), label, value, paragraphs: support(text), citedNotes: notes });

function assemble(f: FormDefinition, keys: string[], output: { sections: unknown[]; gaps?: unknown[] }) {
  const bundle = testBundle();
  return assembleDraft({
    template: formToTemplate(f),
    bundle,
    instructingParty: bundle.referral,
    sectionKeys: keys,
    computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }),
    output: { sections: output.sections as never, gaps: (output.gaps ?? []) as never },
    meta: { mode: "demo_prewritten", sectionKeys: keys, at: AT, promptVersion: "t" },
    form: f,
    idSeed: "fix1",
    approver: SARAH,
  });
}

/* ------------------------------------------------------------------------------------------------
 * R1T-WD-03
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WD-03: work states are read clause by clause, the latest last; a negation turns a phrase around", () => {
  assert.equal(workStateOfClause("he was not off work at the time of the assessment"), "at_work");
  assert.equal(workStateOfClause("Off work since 02/09/2026 with a fit note"), "off_work");
  assert.equal(workStateOfClause("he has not returned to work"), "off_work");
  assert.equal(workStateOfClause("was working from home at present"), "at_work");
  assert.equal(workStateOfClause("He was working on his balance exercises daily"), null, "exercise is not work");
  assert.equal(workStateOfClause("Not yet back at netball"), null);
  assert.equal(latestWorkState("Mr Testcase took 3 days off work and then returned to normal duties.")?.state, "at_work");
  assert.equal(latestWorkState("Off work 3 days, now back to work.")?.state, "at_work");
});

test("R1T-WD-03: a question that prints its own condition is held back when the record says the condition does not hold (round 1's F-27 shape)", () => {
  const label = "a. If the patient was off work when first seen, is the patient back at work now?";
  const notOff = problem(label, "No", "On 15/07/2026 I recorded that Mr Testcase took 3 days off work and then returned to normal duties, so he was not off work at the time of the assessment.", [note("N-001", "2026-07-15", "Took 3 days off work, then returned to normal duties.")]);
  assert.equal(notOff?.kind, "condition");
  assert.match(notOff!.issue, /has not been entered: the question applies only if the patient was off work when first seen, and the record says that does not hold – “he was not off work at the time of the assessment”\.$/);
  assert.match(notOff!.suggestedQuestion, /^Does “a\. If the patient was off work when first seen, is the patient back at work now\?” apply to this patient\?/);
  // Twin: off work at the first assessment, back at work later – the condition holds and "Yes" is entered.
  assert.equal(problem(label, "Yes", "Tom Ellis recorded that Mrs Whitlock was off work since 02/09/2026. On 13/10/2026 she was back at work on a graded return.", [note("N-001", "2026-09-08", "Off work since 02/09/2026 with a fit note."), note("N-002", "2026-10-13", "Back at work on a graded return.")]), null);
  // The condition read from the notes when the support says nothing about it: at the start of the episode, the latest
  // state the earliest note gives ("took 3 days off, then returned" = at work when first seen).
  assert.equal(problem(label, "No", "Mr Testcase was working full time at discharge.", [note("N-001", "2026-07-15", "Took 3 days off work, then returned to normal duties."), note("N-002", "2026-09-16", "Working full time.")])?.kind, "condition");
  // A present condition ("If the patient is at work, …").
  const tasks = "b. If the patient is at work, can they do all of their usual tasks?";
  assert.equal(problem(tasks, "Yes", "Mr Testcase was working full time with no restrictions.", [note("N-001", "2026-09-16", "Working full time, no restrictions.")]), null);
  assert.equal(problem(tasks, "Yes", "Mr Testcase remained off work.", [note("N-001", "2026-09-16", "Remains off work.")])?.kind, "condition");
});

test("R1T-WD-03: a work-status answer that says the opposite of its own support is held back (round 1's IA F-27 shape); a matching one is entered", () => {
  const label = "Is the patient back at work?";
  const home = problem(label, "No", "On 01/09/2026 Priya Shah, physiotherapist, recorded that Mr Testcase was working from home at present.", [note("N-001", "2026-09-01", "Working from home at present.")]);
  assert.equal(home?.kind, "choice_held_back");
  assert.match(home!.issue, /its own supporting text says the opposite – “On 01\/09\/2026 Priya Shah, physiotherapist, recorded that Mr Testcase was working from home at present”\.$/);
  assert.equal(problem(label, "No", "On 01/09/2026 Priya Shah, physiotherapist, recorded that Mr Testcase had not returned to work.", []), null);
  assert.equal(problem(label, "Yes", "Mr Testcase returned to normal duties on 20/09/2026.", []), null);
  assert.equal(problem("c. Is the patient still off work?", "Yes", "Mr Testcase returned to normal duties on 20/09/2026.", [])?.kind, "choice_held_back");
  // A question that asks more than the work state is never read this way ("at work but unable to do all duties").
  assert.equal(problem("d. Is the patient at work but unable to do all duties?", "No", "Mr Testcase was working full time with no restrictions.", []), null);
  // Exercise is not work.
  assert.equal(problem(label, "No", "Mr Testcase was working on his balance exercises daily.", []), null);
});

test("R1T-WD-03: 'any other treatment' answered Yes from the physiotherapy being reported is held back (round 1's EOTS F-24 shape)", () => {
  const label = "Is the patient receiving any other treatment?";
  const physio = problem(label, "Yes", "On 13/10/2026 Tom Ellis, physiotherapist, recorded a request for 3 further sessions over 6 weeks, and the episode of care remained open with physiotherapy ongoing.", []);
  assert.equal(physio?.kind, "choice_held_back");
  assert.match(physio!.issue, /its supporting text is about the physiotherapy being reported, not other treatment/);
  assert.equal(problem(label, "Yes", "On 08/09/2026 Tom Ellis, physiotherapist, recorded that Mrs Whitlock was also seeing an osteopath weekly.", []), null);
  assert.equal(problem(label, "No", "On 13/10/2026 Tom Ellis, physiotherapist, recorded that physiotherapy was ongoing.", []), null);
});

test("R1T-WD-03 through assembly: the held-back answer is not entered, its support stays on the card, and no one-click is offered", () => {
  const f = form("Progress and Discharge Summary", [yesNo("F-02", "a. If the patient was off work when first seen, is the patient back at work now?"), yesNo("F-04", "Is the patient receiving any other treatment?")]);
  const res = assemble(f, ["F-02", "F-04"], {
    sections: [
      { sectionKey: "F-02", answer: "No", paragraphs: [{ text: "On 18/03/2026 I recorded that Mr Testcase was not off work at the time of the assessment.", sourceIds: ["N-001"], basis: "patient_reported" }] },
      { sectionKey: "F-04", answer: "Yes", paragraphs: [{ text: "On 06/05/2026 Tom Ellis, physiotherapist, recorded that Mr Testcase was discharged to self-management with his home exercise programme.", sourceIds: ["N-002"], basis: "record" }] },
    ],
  });
  for (const key of ["F-02", "F-04"]) {
    const s = res.sections.find((x) => x.key === key)!;
    assert.equal(s.answer?.value, null, key);
    assert.equal(s.paragraphs.length, 1, `${key}: the support is shown, not lost`);
    const g = res.gaps.find((x) => x.sectionKey === key)!;
    assert.ok(g && !g.suggestedAnswer, `${key}: held back with no one-click`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WD-04
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WD-04: the area treated and the modalities used report the whole episode; 'improvement for that area' and 'now' still report the latest", () => {
  const kind = formTimeKind({ title: "Progress and Discharge Summary" });
  assert.equal(kind, "later");
  const tick = (label: string, guidance = "") => ({ ...cell("F-07", label, { guidance }), answerType: "checkbox" as const, options: [label] });
  assert.equal(timePointOf(cell("F-05", "Movement – area affected 1", { guidance: "Which part of the body was treated." }), kind), "episode");
  assert.equal(timePointOf(cell("F-05", "Injured region 2"), kind), "episode");
  assert.equal(timePointOf(cell("F-05", "Area treated 1"), kind), "episode");
  assert.equal(timePointOf(cell("F-05", "Site of injury"), kind), "episode");
  assert.equal(timePointOf(tick("Hydrotherapy", "Tick it if this modality was given during treatment."), kind), "episode");
  assert.equal(timePointOf(tick("Modalities given – Hydrotherapy"), kind), "episode");
  // Twins: the position now.
  assert.equal(timePointOf(cell("F-06", "Area treated 1 – improvement the patient reports (%)"), kind), "latest");
  assert.equal(timePointOf(cell("F-06", "Affected area now"), kind), "latest");
  assert.equal(timePointOf(cell("F-06", "Pain now (0-10)"), kind), "latest");
  assert.equal(timePointOf(tick("Hydrotherapy", "Mark it if hydrotherapy is still being used now."), kind), "latest");
});

test("R1T-WD-04 through assembly: an area from the first note prints on a discharge form; a 'now' cell from the first note is held back", () => {
  const f = form("Progress and Discharge Summary", [cell("F-05", "Area treated 1"), cell("F-06", "Area treated 1 – improvement the patient reports (%)")]);
  const res = assemble(f, ["F-05", "F-06"], {
    sections: [
      { sectionKey: "F-05", paragraphs: [{ text: "Lower back", sourceIds: ["N-001"], basis: "clinician_observed" }] },
      { sectionKey: "F-06", paragraphs: [{ text: "50%", sourceIds: ["N-001"], basis: "patient_reported" }] },
    ],
  });
  assert.deepEqual(res.sections.find((s) => s.key === "F-05")?.paragraphs.map((p) => p.text), ["Lower back"]);
  assert.deepEqual(res.sections.find((s) => s.key === "F-06")?.paragraphs, []);
  assert.match(res.gaps.find((g) => g.sectionKey === "F-06")?.issue ?? "", /because this question asks for the position now/);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WD-05
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WD-05: an opinion box never prints a paragraph of the record's figures alone – it is left out with a notice; a note's paragraph stays", () => {
  const f = form("Progress and Discharge Summary", [cell("F-08", "How well did the patient take part in treatment?", { answerType: "long_text", fillSource: { kind: "clinician_opinion" } })]);
  const res = assemble(f, ["F-08"], {
    sections: [
      {
        sectionKey: "F-08",
        paragraphs: [
          { text: "On 06/05/2026 Tom Ellis, physiotherapist, recorded that in his opinion he is fit for a phased return to normal duties over 2 weeks.", sourceIds: ["N-002"], basis: "clinician_opinion_recorded" },
          { text: "2 of 3 appointments were attended, with 1 did not attend on 01/04/2026.", sourceIds: ["FACT-attendance"], basis: "record" },
        ],
      },
    ],
  });
  const s = res.sections[0];
  assert.equal(s.paragraphs.length, 1);
  assert.match(s.paragraphs[0].text, /^On 06\/05\/2026 Tom Ellis/);
  const notice = res.flags.find((x) => x.evidence === "record figures in an opinion box");
  assert.ok(notice && notice.severity === "warning", "said on the draft, never silently");
  assert.match(notice!.message, /\(“2 of 3 appointments were attended, with 1 did not attend on 01\/04\/2026\.”\) was left out of this box/);
  // Alone in the box: left out, and the box gets the ordinary "no opinion recorded" gap.
  const alone = assemble(f, ["F-08"], { sections: [{ sectionKey: "F-08", paragraphs: [{ text: "2 of 3 appointments were attended.", sourceIds: ["FACT-attendance"], basis: "record" }] }] });
  assert.deepEqual(alone.sections[0].paragraphs, []);
  assert.equal(alone.gaps[0]?.kind, "no_opinion_recorded");
  // A narrative box keeps the attendance it cites.
  const narrative = form("Progress and Discharge Summary", [cell("F-14", "Summary of attendance", { answerType: "long_text" })]);
  const kept = assemble(narrative, ["F-14"], { sections: [{ sectionKey: "F-14", paragraphs: [{ text: "2 of 3 appointments were attended.", sourceIds: ["FACT-attendance"], basis: "record" }] }] });
  assert.equal(kept.sections[0].paragraphs.length, 1);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WD-L2
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WD-L2: a comment about the record in a printed answer is held back; clinical negatives and facts are never", () => {
  for (const [text, kept] of [
    ["The record does not hold a separate set of further measurements from me beyond the discharge review.", ""],
    ["The frequency of use was not stated.", ""],
    ["He used ibuprofen, but the frequency of use was not stated.", "He used ibuprofen."],
    ["The notes do not give the dose.", ""],
    ["Lumbar flexion was 50% limited. The record does not hold a later measurement.", "Lumbar flexion was 50% limited."],
  ] as const) {
    const out = holdBackMeta(text, { recordCommentary: true });
    assert.equal(out.text, kept, text);
    assert.equal(out.heldBack.length, 1, text);
  }
  for (const text of [
    "No red flags were reported.",
    "No neurological deficit was noted.",
    "Swelling was not present.",
    "Swelling was not recorded on examination.",
    "No clinician opinion on prognosis was recorded.",
    "The frequency of his headaches was reduced to once a week.",
    "The knee did not give way on stairs.",
    "He did not take any medication.",
  ]) assert.deepEqual(holdBackMeta(text, { recordCommentary: true }), { text, heldBack: [], retracted: [] }, text);
  // A gap's wording may say what the notes lack (the option is off there).
  assert.equal(holdBackMeta("The notes do not give the dose.").text, "The notes do not give the dose.");
});

test("R1T-WD-L2 through assembly: held back in a text answer as 'Drafted text held back'; a tick's supporting paragraph is left as it is", () => {
  const f = form("Progress and Discharge Summary", [cell("F-14", "Summary of attendance", { answerType: "long_text" }), yesNo("F-04", "Is the patient receiving any other treatment?")]);
  const res = assemble(f, ["F-14", "F-04"], {
    sections: [
      { sectionKey: "F-14", paragraphs: [{ text: "Mr Testcase took naproxen. The frequency of use was not stated.", sourceIds: ["N-001"], basis: "patient_reported" }] },
      { sectionKey: "F-04", answer: "No", paragraphs: [{ text: "On 06/05/2026 Tom Ellis recorded no other treatment; the record does not hold more.", sourceIds: ["N-002"], basis: "record" }] },
    ],
  });
  assert.deepEqual(res.sections.find((s) => s.key === "F-14")?.paragraphs.map((p) => p.text), ["Mr Testcase took naproxen."]);
  assert.match(res.gaps.find((g) => g.sectionKey === "F-14")?.issue ?? "", /^Drafted text held back – check it: “The frequency of use was not stated\.”/);
  assert.ok(!res.gaps.some((g) => g.sectionKey === "F-04" && /held back – check it/.test(g.issue)));
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WD-L3
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WD-L3: 'N of N appointments' and 'with 1 did not attend' are advised against; '2 of 3' is not", () => {
  const bundle = testBundle();
  const computedFacts = computeFacts(bundle, { asOf: TEST_FACTS_DATE });
  const part = attendanceFramingPart({ computedFacts } as never);
  const section = { key: "F-14", title: "Summary of attendance", kind: "narrative", paragraphs: [], status: "drafted" } as never;
  const flags = (text: string) => part.paragraph!({ id: "p", text, sourceIds: ["FACT-attendance"], origin: "ai", basis: "record" }, section);
  const nOfN = flags("7 of 7 appointments were attended, with 1 cancelled with notice.");
  assert.equal(nOfN.length, 1);
  assert.equal(nOfN[0].severity, "warning");
  assert.match(nOfN[0].message, /^“7 of 7 appointments” reads as if those were all the appointments – the attendance record gives “2 of 3 appointments attended \(1 DNA\)”: say “7 appointments were attended and none was missed”, or keep it\.$/);
  const dna = flags("5 of 6 appointments were attended, with 1 did not attend on 22/09/2026.");
  assert.deepEqual(dna.map((f) => f.evidence), ["attendance wording"]);
  assert.match(dna[0].message, /say “1 appointment was missed \(did not attend\)” with the date/);
  assert.deepEqual(flags("2 of 3 appointments were attended and 1 was missed (did not attend) on 01/04/2026."), []);
  assert.deepEqual(flags("6 sessions were authorised, the 6th of 6 on 20/10/2026."), []);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WD-L4
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WD-L4: a gap on a single tick box that says nothing was planned is 'no opinion recorded'; a recorded opinion that does not fit Yes/No keeps its kind", () => {
  const tickBox = { fillSource: { kind: "clinician_opinion" as const }, guidance: "", options: ["Shockwave"], answerType: "checkbox" as const };
  assert.equal(draftedGapKind(tickBox, "Sarah Reid's note of 15/07/2026 records soft tissue release and a home programme, but does not mention shockwave as a planned modality.", ["N-001"]), "no_opinion_recorded");
  assert.equal(draftedGapKind(tickBox, "Tom Ellis recorded a phased plan; it fits neither option.", ["N-001"]), "no_opinion_recorded", "a single tick box has no options to fit");
  const yn = { fillSource: { kind: "clinician_opinion" as const }, guidance: "", options: ["Yes", "No"], answerType: "yes_no" as const };
  assert.equal(draftedGapKind(yn, "Tom Ellis's note of 08/09/2026 does not mention a review.", ["N-001"]), "no_opinion_recorded");
  assert.equal(draftedGapKind(yn, "Tom Ellis's note makes no mention of it.", ["N-001"]), "no_opinion_recorded");
  assert.equal(draftedGapKind(yn, "Tom Ellis recorded a graded return over 4 weeks, which is not a plain Yes or No.", ["N-001"]), "opinion_not_fitting_options");
  assert.equal(draftedGapKind(yn, "Tom Ellis recorded a phased return over 2 weeks; it fits neither Yes nor No.", ["N-001"]), "opinion_not_fitting_options");
});
