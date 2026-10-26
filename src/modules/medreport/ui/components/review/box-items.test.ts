/**
 * One item per question and "Leave optional boxes blank" (fix 10/2026, Blue Heart test run findings 2 and 3): the
 * approval gate is unchanged, the bulk action never touches required, clinical-opinion, mail-merge, opinion-wording or
 * held-back items, and records each acknowledgement exactly as a single one does.
 *
 * Fictional data only: "Example Medico-Legal (fictional)", Owen Testcase (test fixtures), Sarah Reid (PH-DEMO-01).
 *
 * Owner: studio-b agent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeFacts } from "../../../core/computed-facts";
import { formToTemplate } from "../../../core/forms";
import { listMergeTokens, listMergeTokensInWords, practiceCodeInWords } from "../../../core/merge-fields";
import { PRACTICE_CODES, humaniseMergeCodes, practiceCodeWords } from "../../../core/practice-merge-codes";
import { createFormReport } from "../../../core/report-factory";
import type { FormDefinition, FormField, Gap, Report, ReportFlag } from "../../../core/types";
import { canSign, validateReport } from "../../../core/validation";
import { testBundle } from "../../../core/validation/test-fixtures";
import { LEAVE_BLANK_REASON, leaveOptionalBoxesBlank, optionalBlankCandidates, reviewItemLines, reviewItems, type BoxItem } from "./box-items";
import { acknowledgeFlag, addClinicianParagraph, buildQuestionGroups, flattenQuestions, gapResolutionOptions, questionStatus, resolveGap, setStructuredAnswer } from "./review-model";
import { reviewReducer } from "./use-review-state";

const AT = "2026-10-06T09:00:00.000Z";
const NOW = new Date("2026-10-07T10:00:00.000Z");
const ACTOR = "Sarah Reid";
const REFERRER = "Example Medico-Legal (fictional)";

function field(id: string, spec: Partial<FormField> & Pick<FormField, "label" | "answerType" | "fillSource">): FormField {
  return { id, guidance: `Answer “${spec.label}”.`, anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` }, required: true, confidence: "high", ...spec };
}

/** A clinic-system template like Dell's: the referrer's reference and a work telephone are TM3 merge codes. */
function testForm(): FormDefinition {
  return {
    id: "frm_box_items",
    tenantId: "demo",
    referrer: { name: REFERRER, type: "mlc" },
    title: "Initial Assessment Report",
    file: { fileName: "ia.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "b".repeat(64), sizeBytes: 1000 },
    kind: "docx",
    fields: [
      field("F-01", { label: "Case Reference", answerType: "short_text", fillSource: { kind: "registration", path: "referral.reference" }, anchor: { kind: "docx", target: "replace_placeholder", blockId: "p1", placeholderText: "<<P_GROUPREF>>" } }),
      field("F-02", { label: "Claimant name", answerType: "short_text", fillSource: { kind: "registration", path: "patient.fullName" } }),
      field("F-03", { label: "Mechanism of injury", answerType: "long_text", fillSource: { kind: "notes_narrative" } }),
      field("F-04", { label: "Is the claimant taking medication?", answerType: "yes_no", options: ["Yes", "No"], fillSource: { kind: "notes_narrative" } }),
      field("F-05", { label: "Medication 2", answerType: "short_text", fillSource: { kind: "notes_narrative" }, required: false }),
      field("F-06", { label: "Medication 2 – frequency", answerType: "short_text", fillSource: { kind: "notes_narrative" }, required: false }),
      field("F-07", { label: "Treatment plan – acupuncture", answerType: "checkbox", fillSource: { kind: "clinician_opinion" }, required: false }),
      field("F-08", { label: "Work telephone", answerType: "short_text", fillSource: { kind: "registration", path: "staff.entry" }, required: false, anchor: { kind: "docx", target: "replace_placeholder", blockId: "p2", placeholderText: "<<P_WORKTEL>>" } }),
      field("F-09", { label: "Activity 2 – comments", answerType: "short_text", fillSource: { kind: "notes_narrative" }, required: false }),
      field("F-10", { label: "Prognosis", answerType: "long_text", fillSource: { kind: "clinician_opinion" } }),
      field("F-11", { label: "Pain at its worst", answerType: "single_choice", options: ["Mild", "Moderate", "Severe"], fillSource: { kind: "notes_narrative" }, required: false }),
      field("F-12", { label: "Signature", answerType: "signature", fillSource: { kind: "signoff", part: "signature" } }),
    ],
    status: "confirmed",
    analysis: {
      mode: "rules",
      promptVersion: "test",
      at: AT,
      warnings: [],
      mergeFields: [
        { text: "<<P_GROUPREF>>", where: "paragraph 2", blockId: "p1" },
        { text: "<<P_WORKTEL>>", where: "paragraph 3", blockId: "p2" },
      ],
    },
    confirmed: { by: "Practice manager (demo)", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

function gap(key: string, issue: string, suffix = "1"): Gap {
  return { id: `gap-${key}-t-${suffix}`, sectionKey: key, issue, suggestedQuestion: `What is the answer to ${key}?`, relatedNoteIds: ["N-001"], raisedBy: "ai" };
}

/** The report as drafting leaves it: one answer drafted, one with opinion wording the note does not hold, the rest left with gaps. */
function drafted(): { report: Report; form: FormDefinition; template: ReturnType<typeof formToTemplate> } {
  const form = testForm();
  const bundle = testBundle();
  const created = createFormReport({
    form,
    bundle,
    // Another organisation's referral: the referrer's own reference is left for staff (a "-referrer" gap).
    instructingParty: { type: "solicitor", name: "Harrow Lane Solicitors (fictional)", reference: "HL-77", contactName: "", address: "" },
    computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }),
    now: new Date(AT),
    id: "rpt_box_items",
  });
  const sections = created.sections.map((s) => {
    if (s.key === "F-03") return { ...s, status: "drafted" as const, paragraphs: [{ id: "F-03-p1", text: "On 18/03/2026 he reported a lifting injury at work on 12/03/2026.", sourceIds: ["N-001"], origin: "ai" as const }] };
    if (s.key === "F-09") return { ...s, status: "drafted" as const, paragraphs: [{ id: "F-09-p1", text: "He has made a full recovery.", sourceIds: ["N-001"], origin: "ai" as const }] };
    return s.status === "pending" ? { ...s, status: "needs_input" as const } : s;
  });
  const gaps = [
    ...created.gaps,
    gap("F-04", "The notes are contradictory on current medication."),
    gap("F-05", "No second medication is recorded."),
    gap("F-07", "The plan does not say whether acupuncture was planned."),
    gap("F-10", "No clinician recorded a prognosis."),
    // The draft proposed an answer that did not fit the printed options: a person decides (ai/assemble.ts "-fit").
    { ...gap("F-11", "The drafted answer “7/10” does not fit the form's options, so it has been left blank.", "fit"), raisedBy: "system" as const },
  ];
  const template = formToTemplate(form);
  const report: Report = { ...created, sections, gaps };
  return { report: { ...report, flags: validateReport(report, template, { form }).flags }, form, template };
}

const boxOf = (r: Report, form: FormDefinition, key: string): BoxItem | undefined => reviewItems(r, { template: formToTemplate(form), form }).boxes.get(key);
const revalidated = (r: Report, form: FormDefinition): Report => ({ ...r, flags: validateReport(r, formToTemplate(form), { form }).flags });

describe("one item per question", () => {
  it("the referrer's reference: the gap, 'required and no answer' and its merge code are ONE item with one plain instruction", () => {
    const { report, form, template } = drafted();
    const onF01 = canSign(report.flags, report.gaps).blocking.filter((f) => f.sectionKey === "F-01");
    assert.deepEqual(onF01.map((f) => f.code).sort(), ["MISSING_PLACEHOLDER", "MISSING_PLACEHOLDER", "OPEN_GAP"], "three checks block F-01 (the bug: three stacked warnings)");

    const items = reviewItems(report, { template, form });
    const f01 = items.boxes.get("F-01");
    assert.ok(f01);
    assert.equal(f01.heading, "Required – no answer yet");
    assert.equal(f01.instruction, `Type ${REFERRER}'s reference from their letter.`);
    assert.deepEqual(f01.gaps.map((g) => g.id), ["gap-F-01-referrer"]);
    assert.deepEqual(f01.covered.map((f) => f.evidence).sort(), ["empty section", "mail-merge field <<P_GROUPREF>> in paragraph 2"]);
    assert.equal(items.required.filter((it) => it.key === "F-01").length, 1, "listed once");
    for (const f of onF01) assert.ok(items.coveredIds.has(f.id), `${f.code} shown inside the item, not again`);
    // Never the raw code, anywhere a clinician reads it.
    const shown = [...report.flags.map((f) => f.message), ...reviewItemLines(items, report, 99), f01.heading, f01.instruction].join("\n");
    assert.doesNotMatch(shown, /<<P_|P_GROUPREF/);
    assert.match(report.flags.find((f) => f.evidence?.includes("<<P_GROUPREF>>"))?.message ?? "", /your clinic system's placeholder for the referrer's reference for this case, in paragraph 2/);
  });

  it("approval stays blocked until the reference is typed, its gap confirmed and no merge code remains", () => {
    const { report, form, template } = drafted();
    // Typed in by staff: the "no answer" and the merge code clear; the gap is still to confirm (one click).
    let r = revalidated(addClinicianParagraph(report, "F-01", "MLC-REF-0001 (fictional)", NOW).report, form);
    const typed = boxOf(r, form, "F-01");
    assert.ok(typed, "still one item: the gap");
    assert.equal(typed.heading, "Required – confirm your answer");
    assert.equal(typed.instruction, "Check your answer, then click Mark resolved.");
    assert.deepEqual(typed.covered, []);
    assert.ok(canSign(r.flags, r.gaps).blocking.some((f) => f.sectionKey === "F-01"), "still blocked");
    const g = r.gaps.find((x) => x.id === "gap-F-01-referrer");
    assert.ok(g);
    r = revalidated(resolveGap(r, g.id, "resolved", gapResolutionOptions(r, g, ACTOR).prefill, ACTOR, NOW), form);
    assert.equal(boxOf(r, form, "F-01"), undefined);
    assert.ok(!canSign(r.flags, r.gaps).blocking.some((f) => f.sectionKey === "F-01"));
    assert.ok(!r.flags.some((f) => f.evidence?.includes("<<P_GROUPREF>>")), "no merge code left");

    // Resolving the gap WITHOUT typing the reference never unblocks it: the box still needs its answer.
    const g0 = report.gaps.find((x) => x.id === "gap-F-01-referrer");
    assert.ok(g0);
    const ackOnly = revalidated(resolveGap(report, g0.id, "acknowledged", "Reference to follow from the referrer.", ACTOR, NOW), form);
    const left = boxOf(ackOnly, form, "F-01");
    assert.ok(left);
    assert.equal(left.gaps.length, 0);
    assert.equal(left.covered.length, 2, "required-and-blank and the merge code still block");
    assert.equal(reviewItems(ackOnly, { template, form }).boxes.get("F-01")?.heading, "Required – no answer yet");
  });

  it("counts and labels: required and optional apart; zero exactly when canSign allows approval", () => {
    const { report, form, template } = drafted();
    const items = reviewItems(report, { template, form });
    const blocking = canSign(report.flags, report.gaps).blocking;
    assert.ok(items.count < blocking.length, `${items.count} items for ${blocking.length} checks`);
    assert.equal(items.count, items.required.length + items.optional.length);
    // Every blocking check is in exactly one item.
    for (const f of blocking) assert.ok(items.coveredIds.has(f.id) || items.required.concat(items.optional).some((it) => it.type === "flag" && it.flag.id === f.id), f.id);
    const keys = (list: typeof items.required) => list.map((it) => it.key);
    assert.deepEqual(keys(items.optional), ["F-05", "F-07", "F-08", "F-11"]);
    assert.ok(keys(items.required).includes("F-04") && keys(items.required).includes("F-10") && keys(items.required).includes("F-09"));
    assert.equal(items.boxes.get("F-05")?.heading, "Optional – no answer yet");
    assert.equal(items.boxes.get("F-07")?.heading, "Optional – needs your opinion");
    assert.equal(items.boxes.get("F-08")?.heading, "Optional, but must be filled in");
    assert.match(items.boxes.get("F-08")?.instruction ?? "", /^Fill it in: leaving it blank would leave your clinic system's placeholder for the patient's work telephone number on the form\.$/);
    assert.equal(items.boxes.get("F-10")?.heading, "Required – needs your opinion");
    assert.equal(items.boxes.get("F-04")?.heading, "Required – no answer yet");
    assert.equal(items.boxes.get("F-04")?.instruction, "Choose the answer yourself – the notes do not settle it.");
    // The opinion wording on F-09 is its own item (it is fixed by editing, not by answering).
    assert.ok(items.required.some((it) => it.type === "flag" && it.flag.code === "OPINION_LANGUAGE" && it.key === "F-09"));
  });
});

describe("Leave optional boxes blank", () => {
  it("offers only optional boxes that are simply blank", () => {
    const { report, form, template } = drafted();
    const c = optionalBlankCandidates(report, { template, form });
    // F-05: an open gap and the warning; F-06: the warning only. Never F-04 (required), F-07 (clinical opinion), F-08
    // (merge code), F-09 (opinion wording), F-10 (required opinion), F-11 (an answer was held back).
    assert.deepEqual(c.map((x) => x.key), ["F-05", "F-06"]);
    assert.deepEqual(c[0].gaps.map((g) => g.id), ["gap-F-05-t-1"]);
    assert.equal(c[0].warning?.evidence, "optional field blank");
    assert.equal(c[1].gaps.length, 0);
    assert.equal(c[1].warning?.evidence, "optional field blank");
  });

  it("never clears required, clinical, opinion, merge-code or held-back items – whatever keys it is given", () => {
    const { report, form, template } = drafted();
    const before = canSign(report.flags, report.gaps).blocking;
    const all = report.sections.map((s) => s.key);
    const after = revalidated(leaveOptionalBoxesBlank(report, { template, form, keys: all, reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW }), form);

    const open = (key: string) => after.gaps.filter((g) => g.sectionKey === key && !g.resolution).length;
    assert.equal(open("F-05"), 0, "the optional blank box's gap is acknowledged");
    for (const key of ["F-01", "F-04", "F-07", "F-10", "F-11"]) assert.equal(open(key), 1, `${key}: its gap stays open`);
    const blocking = canSign(after.flags, after.gaps).blocking;
    assert.equal(canSign(after.flags, after.gaps).ok, false);
    for (const kind of [
      (f: ReportFlag) => f.sectionKey === "F-01" && f.evidence === "empty section",
      (f: ReportFlag) => f.evidence === "mail-merge field <<P_GROUPREF>> in paragraph 2",
      (f: ReportFlag) => f.evidence === "mail-merge field <<P_WORKTEL>> in paragraph 3",
      (f: ReportFlag) => f.sectionKey === "F-04" && f.evidence === "empty section",
      (f: ReportFlag) => f.sectionKey === "F-10" && f.evidence === "empty section",
      (f: ReportFlag) => f.code === "OPINION_LANGUAGE" && f.sectionKey === "F-09",
    ]) {
      assert.ok(before.some(kind) && blocking.some(kind), `still blocking: ${before.find(kind)?.id}`);
    }
    assert.equal(blocking.length, before.length - 1, "only F-05's gap stopped blocking");
    // Nothing but F-05 and F-06 was acknowledged.
    const acked = after.flags.filter((f) => f.acknowledged).map((f) => f.sectionKey);
    assert.deepEqual(acked.sort(), ["F-05", "F-06"]);
    assert.deepEqual(after.gaps.filter((g) => g.resolution).map((g) => g.sectionKey), ["F-05"]);
  });

  it("records one acknowledgement per item, exactly as single acknowledgements do", () => {
    const { report, form, template } = drafted();
    const bulk = leaveOptionalBoxesBlank(report, { template, form, keys: ["F-05", "F-06"], reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW });

    // The same, one at a time, as the Flags tab's "Acknowledge with a reason" does it.
    const warning = (r: Report, key: string) => r.flags.find((f) => f.sectionKey === key && f.evidence === "optional field blank");
    let single = resolveGap(report, "gap-F-05-t-1", "acknowledged", LEAVE_BLANK_REASON, ACTOR, NOW);
    single = acknowledgeFlag(single, warning(single, "F-05")?.id ?? "", LEAVE_BLANK_REASON, ACTOR, NOW);
    single = acknowledgeFlag(single, warning(single, "F-06")?.id ?? "", LEAVE_BLANK_REASON, ACTOR, NOW);

    assert.deepEqual(bulk.gaps, single.gaps);
    assert.deepEqual(bulk.flags, single.flags);
    assert.deepEqual(bulk.activity, single.activity);
    const added = bulk.activity.slice(report.activity.length);
    assert.deepEqual(added.map((a) => a.action), ["gap_acknowledged", "flag_acknowledged", "flag_acknowledged"]);
    for (const a of added) {
      assert.equal(a.actor, ACTOR);
      assert.ok(a.detail.includes(LEAVE_BLANK_REASON), a.detail);
    }
    // On the approval record: the content the receipt covers carries each acknowledgement, and they survive re-validation.
    const again = revalidated(bulk, form);
    assert.equal(again.flags.filter((f) => f.acknowledged?.reason === LEAVE_BLANK_REASON).length, 2);
    assert.equal(again.gaps.find((g) => g.id === "gap-F-05-t-1")?.resolution?.kind, "acknowledged");
    assert.equal(reviewItems(again, { template, form }).boxes.get("F-05"), undefined, "the item is gone");
  });

  it("changes nothing with a short reason, no actor, an approved report or a key that is not a candidate", () => {
    const { report, form, template } = drafted();
    const run = (r: Report, extra: Partial<{ reason: string; actor: string; keys: string[] }> = {}) =>
      leaveOptionalBoxesBlank(r, { template, form, keys: ["F-05"], reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW, ...extra });
    assert.equal(run(report, { reason: "blank" }), report);
    assert.equal(run(report, { actor: " " }), report);
    const signed = { ...report, status: "signed" as const };
    assert.equal(run(signed), signed);
    assert.equal(run(report, { keys: ["F-04", "F-07", "F-08", "F-11"] }), report);
  });

  it("a box left blank shows as “Left blank on the form”, not “Needs input”", () => {
    const { report, form, template } = drafted();
    const status = (r: Report) => {
      const qs = flattenQuestions(buildQuestionGroups(r, form, template));
      return (key: string) => {
        const q = qs.find((x) => x.key === key);
        assert.ok(q);
        return questionStatus(q, r.flags.filter((f) => f.sectionKey === key), r.gaps);
      };
    };
    const before = status(report);
    assert.deepEqual(["F-05", "F-06", "F-07"].map(before), ["needs_input", "needs_input", "needs_input"]);
    const left = revalidated(leaveOptionalBoxesBlank(report, { template, form, keys: ["F-05", "F-06"], reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW }), form);
    const after = status(left);
    assert.deepEqual(["F-05", "F-06", "F-07", "F-04"].map(after), ["blank", "blank", "needs_input", "needs_input"]);
  });

  it("acknowledging one optional box's gap also acknowledges its 'no answer' warning – never a required box's check", () => {
    const { report } = drafted();
    const one = reviewReducer(report, { type: "resolveGap", gapId: "gap-F-05-t-1", kind: "acknowledged", text: "No second medication was taken.", actor: ACTOR });
    assert.equal(one.flags.find((f) => f.sectionKey === "F-05" && f.evidence === "optional field blank")?.acknowledged?.reason, "No second medication was taken.");
    assert.deepEqual(one.activity.slice(report.activity.length).map((a) => a.action), ["gap_acknowledged", "flag_acknowledged"]);
    const req = reviewReducer(report, { type: "resolveGap", gapId: "gap-F-04-t-1", kind: "acknowledged", text: "Checked with the patient (fictional).", actor: ACTOR });
    assert.deepEqual(req.activity.slice(report.activity.length).map((a) => a.action), ["gap_acknowledged"]);
    assert.ok(!req.flags.some((f) => f.sectionKey === "F-04" && f.acknowledged), "a required box's 'no answer' is never acknowledged");
    const resolved = reviewReducer(report, { type: "resolveGap", gapId: "gap-F-05-t-1", kind: "resolved", text: "Confirmed with the patient (fictional).", actor: ACTOR });
    assert.ok(!resolved.flags.some((f) => f.acknowledged), "resolving (not acknowledging) leaves the warning as it is");
    // Typed a moment ago (the checks have not re-run yet): the box has an answer, so its stale warning is left alone.
    const typed = addClinicianParagraph(report, "F-05", "Ibuprofen 400 mg (fictional)", NOW).report;
    const ackTyped = reviewReducer(typed, { type: "resolveGap", gapId: "gap-F-05-t-1", kind: "acknowledged", text: "No second medication was taken.", actor: ACTOR });
    assert.ok(!ackTyped.flags.some((f) => f.acknowledged));
  });

  it("a box answered later supersedes its 'left blank' acknowledgement", () => {
    const { report, form, template } = drafted();
    const left = leaveOptionalBoxesBlank(report, { template, form, keys: ["F-05"], reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW });
    const answered = reviewReducer(left, { type: "addParagraph", key: "F-05", text: "Ibuprofen 400 mg (fictional)", actor: ACTOR });
    assert.equal(answered.gaps.find((g) => g.id === "gap-F-05-t-1")?.resolution?.kind, "resolved");
  });

  it("the review screen's action goes through the same re-checked path", () => {
    const { report, form, template } = drafted();
    const next = reviewReducer(report, { type: "leaveOptionalBlank", keys: ["F-04", "F-05", "F-07"], reason: LEAVE_BLANK_REASON, actor: ACTOR, template, form });
    assert.deepEqual(next.gaps.filter((g) => g.resolution).map((g) => g.sectionKey), ["F-05"]);
    // Then the rest is answered by the clinician and the report can be approved.
    let r = revalidated(next, form);
    r = addClinicianParagraph(r, "F-01", "MLC-REF-0001 (fictional)", NOW).report;
    r = addClinicianParagraph(r, "F-08", "N/A", NOW).report;
    r = setStructuredAnswer(r, "F-04", true, ACTOR, NOW);
    r = setStructuredAnswer(r, "F-07", false, ACTOR, NOW);
    r = setStructuredAnswer(r, "F-11", "Moderate", ACTOR, NOW);
    r = addClinicianParagraph(r, "F-10", "In my opinion he will recover within 6 weeks.", NOW).report;
    r = {
      ...r,
      sections: r.sections.map((s) => (s.key === "F-09" ? { ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: "He returned to the gym.", origin: "edited" as const })) } : s)),
    };
    for (const g of r.gaps.filter((x) => !x.resolution)) r = resolveGap(r, g.id, "resolved", gapResolutionOptions(r, g, ACTOR).prefill || "Confirmed with the patient (fictional).", ACTOR, NOW);
    r = revalidated(r, form);
    assert.deepEqual(canSign(r.flags, r.gaps).blocking.map((f) => f.message), []);
    assert.equal(reviewItems(r, { template, form }).count, 0);
  });
});

describe("clinic-system codes in plain words", () => {
  it("names a known code by what it holds, an unknown one by its name in quotes, and leaves other merge fields as printed", () => {
    assert.equal(practiceCodeInWords("<<P_GROUPREF>>"), "your clinic system's placeholder for the referrer's reference for this case");
    assert.equal(practiceCodeInWords("<<P_NOT_IN_THE_DICTIONARY>>"), "your clinic system's placeholder “P_NOT_IN_THE_DICTIONARY”");
    assert.equal(practiceCodeInWords("«Patient Name»"), null);
    assert.equal(practiceCodeInWords("<<Referral Ref>>"), null);
    assert.equal(listMergeTokensInWords(["«Patient Name»", "«Referral Ref»"]), listMergeTokens(["«Patient Name»", "«Referral Ref»"]), "unchanged without clinic-system codes");
    assert.equal(listMergeTokensInWords(["<<P_TITLE>>", "<<P_SURNAME>>"]), "your clinic system's placeholder for the patient's title, your clinic system's placeholder for the patient's surname");
  });

  it("uses the same words as the staff screens for every code in the dictionary (integration 25/10)", () => {
    for (const code of Array.from(PRACTICE_CODES.keys())) {
      assert.equal(practiceCodeInWords(`<<${code}>>`), `your clinic system's placeholder for ${practiceCodeWords(code)}`, code);
      assert.doesNotMatch(humaniseMergeCodes(`Seen in <<${code}>>.`), /<<|>>/, code);
    }
    assert.equal(practiceCodeInWords("<<P_ALTERNATE_REF1>>"), "your clinic system's placeholder for alternative reference 1 (where some clinics keep the date of the accident)");
  });
});

describe("fix round 1 (B0-2): what a box left blank prints", () => {
  it("leaving optional boxes blank (one by one or in one step) passes an explicit blank to the forms engine; undecided boxes stay as printed", async () => {
    const { buildFormAnswers } = await import("../../../core/forms");
    const { report, form, template } = drafted();
    // Before anyone decides: F-05 and F-06 are just unanswered.
    assert.deepEqual(buildFormAnswers(report, form)["F-05"], {});
    const bulk = leaveOptionalBoxesBlank(report, { template, form, keys: ["F-05", "F-06"], reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW });
    const answers = buildFormAnswers(bulk, form);
    assert.deepEqual(answers["F-05"], { leftBlank: true }, "its gap was acknowledged");
    assert.deepEqual(answers["F-06"], { leftBlank: true }, "its “optional and has no answer” warning was acknowledged");
    assert.deepEqual(answers["F-09"].leftBlank, undefined, "a box with an answer is written as answered");
    // An approved report: every box without an answer is left blank on the form, whatever was decided.
    const approved = buildFormAnswers({ ...report, status: "signed" }, form);
    assert.deepEqual(approved["F-07"], { leftBlank: true });
    assert.deepEqual(approved["F-12"], {}, "sign-off parts come from the receipt");
  });

  it("the review says what leaving a box blank removes from the printed form", async () => {
    const { leftBlankEffect } = await import("../../../core/forms");
    assert.equal(leftBlankEffect({ anchor: { kind: "docx", target: "mark_cell", blockId: "t0.r0.c1", optionCells: [{ option: "x", blockId: "t0.r0.c1" }] } }), "no box is marked – a mark printed there is removed");
    assert.equal(leftBlankEffect({ anchor: { kind: "docx", target: "delete_options", blockId: "t0.r1.c2", placeholderText: "Restricted / Unable to perform" } }), "the printed “Restricted / Unable to perform” is removed");
    assert.equal(leftBlankEffect({ anchor: { kind: "docx", target: "replace_placeholder", blockId: "t0.r2.c2", placeholderText: "30 minutes" } }), "the printed “30 minutes” is removed");
    assert.equal(leftBlankEffect({ anchor: { kind: "docx", target: "replace_placeholder", blockId: "p0", placeholderText: "________" } }), null);
    assert.equal(leftBlankEffect({ anchor: { kind: "docx", target: "table_cell", blockId: "t0.r2.c1" } }), null);
  });
});

describe("fix round 1 (B0-10): a merge code blames the question that replaces it", () => {
  it("“Claimant <<P_TITLE>> … Reference <<P_GROUPREF>>” on one line: the title is filled and not blocked; the reference's question is", async () => {
    const { unresolvedMergeFields } = await import("../../../core/merge-fields");
    const line = (id: string, label: string, code: string, path: "patient.title" | "staff.entry"): FormField =>
      field(id, { label, answerType: "short_text", fillSource: { kind: "registration", path }, anchor: { kind: "docx", target: "replace_placeholder", blockId: "p4", placeholderText: code }, required: path === "patient.title" });
    const base = testForm();
    const form: FormDefinition = {
      ...base,
      fields: [line("F-01", "Patient's title", "<<P_TITLE>>", "patient.title"), line("F-02", "Group reference", "<<P_GROUPREF>>", "staff.entry")],
      analysis: { ...base.analysis, mergeFields: [{ text: "<<P_TITLE>>", where: "paragraph 5", blockId: "p4" }, { text: "<<P_GROUPREF>>", where: "paragraph 5", blockId: "p4" }] },
    };
    const bundle = testBundle();
    const created = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), now: new Date(AT), id: "rpt_merge_owner" });
    const report = revalidated(created, form);
    assert.deepEqual(unresolvedMergeFields(form, report).map((u) => [u.text, u.fieldId]), [["<<P_GROUPREF>>", "F-02"]]);
    const merge = report.flags.filter((f) => f.evidence?.startsWith("mail-merge field "));
    assert.deepEqual(merge.map((f) => f.sectionKey), ["F-02"]);
    const groups = buildQuestionGroups(report, form, formToTemplate(form));
    const status = (key: string) => {
      const q = flattenQuestions(groups).find((x) => x.key === key)!;
      return questionStatus(q, report.flags, report.gaps);
    };
    assert.equal(status("F-01"), "records", "the filled title is not “Blocked – check required”");
    assert.notEqual(status("F-02"), "records");
  });
});

describe("fix round 1 (B0-19, B0-4): staff entries, physiotherapists' choices and the clinic's details in their own words", () => {
  it("a staff entry is never “the record does not hold it (the patient's registration details)”; the source chip says what it is", async () => {
    const { recordSourceOf } = await import("../../../core/forms");
    const { report, form, template } = drafted();
    const gap = report.gaps.find((g) => g.sectionKey === "F-08");
    assert.equal(gap?.issue, "“Work telephone” is entered by staff on each report.");
    assert.doesNotMatch(`${gap?.issue} ${gap?.suggestedQuestion}`, /registration details|does not hold/);
    // (F-08 also holds a clinic-system code, so its item says to fill it in: leaving it blank would leave the code.)
    assert.match(reviewItems(report, { template, form }).boxes.get("F-08")?.instruction ?? "", /^Fill it in/);
    const f = (path: "staff.entry" | "clinic.name" | "patient.fullName", guidance = "") => ({ fillSource: { kind: "registration" as const, path }, guidance });
    assert.equal(recordSourceOf(f("staff.entry")), "staff_entry");
    assert.equal(recordSourceOf(f("staff.entry", "Chosen by the physiotherapist on each report: the other options are deleted from the form.")), "physio_choice");
    assert.equal(recordSourceOf(f("clinic.name")), "clinic");
    assert.equal(recordSourceOf(f("patient.fullName")), null);
  });

  it("a value from the Clinic details can be changed for this report only: entered by staff, audited, printed instead", async () => {
    const { buildFormAnswers } = await import("../../../core/forms");
    const { overrideRecordValue } = await import("./review-model");
    const base = testForm();
    const form: FormDefinition = { ...base, fields: [...base.fields, field("F-13", { label: "Therapist location – site", answerType: "short_text", fillSource: { kind: "registration", path: "clinic.name" } })] };
    const bundle = { ...testBundle(), clinic: { name: "Blue Heart Clinics Test Ltd (fictional)" } } as ReturnType<typeof testBundle>;
    const created = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), now: new Date(AT), id: "rpt_clinic_site" });
    const site = created.sections.find((s) => s.key === "F-13");
    assert.equal(site?.paragraphs[0]?.origin, "from_records", "filled from the Clinic details");
    const changed = overrideRecordValue(created, "F-13", ACTOR, NOW);
    const p = changed.sections.find((s) => s.key === "F-13")?.paragraphs[0];
    assert.equal(p?.origin, "clinician");
    assert.equal(p?.text, site?.paragraphs[0]?.text, "starts from the setting, ready to change");
    assert.match(changed.activity[changed.activity.length - 1].detail, /^F-13: “Therapist location – site” changed for this report only \(was “.+” from the Clinic details\) – entered by staff\.$/);
    const typed = reviewReducer(changed, { type: "editParagraph", key: "F-13", paragraphId: p!.id, text: "Blue Heart Clinics – Aylesbury site (fictional)" });
    assert.equal(buildFormAnswers(typed, form)["F-13"].text, "Blue Heart Clinics – Aylesbury site (fictional)");
    assert.equal(overrideRecordValue(typed, "F-13", ACTOR, NOW), typed, "only while it still holds the value filled by code");
  });
});

describe("fix round 1 (B0-17): why a gap was raised, by its kind", () => {
  it("a held-back choice is not “the clinic record does not hold this value”", async () => {
    const { gapProvenance } = await import("./issues");
    const g = (id: string) => ({ id, raisedBy: "system" as const });
    assert.equal(gapProvenance(g("gap-F-10-ab12-choice")), "Raised by the system: the notes do not use the option's own words, so a person ticks it.");
    assert.equal(gapProvenance(g("gap-F-10-ab12-fit")), "Raised by the system: the drafted answer does not fit the printed options, so a person chooses.");
    assert.equal(gapProvenance(g("gap-F-10-ab12-cite")), "Raised by the system: the drafted answer cites no source, so a person confirms it.");
    assert.equal(gapProvenance(g("gap-F-01-record")), "Raised by the system: the clinic record does not hold this value.");
    assert.equal(gapProvenance(g("gap-F-08-staff")), "Raised by the system: this is entered by staff on each report.");
    assert.match(gapProvenance({ id: "gap-F-02-ab12-1", raisedBy: "ai" }), /^Raised while drafting/);
  });
});

describe("fix round 1 (B0-28, B0-8): the leave-blank card counts every optional box without an answer", () => {
  it("says how many can go in one step, which ask for the clinician's opinion (offered unticked) and which need a decision first", async () => {
    const { emptyOptionalSummary, optionalOpinionBlankCandidates } = await import("./box-items");
    const { leaveBlankSummaryText } = await import("./flags-panel");
    const { report, form, template } = drafted();
    const plain = optionalBlankCandidates(report, { template, form });
    const opinion = optionalOpinionBlankCandidates(report, { template, form });
    assert.deepEqual(plain.map((c) => c.key), ["F-05", "F-06"]);
    assert.deepEqual(opinion.map((c) => [c.key, c.opinion]), [["F-07", true]], "the acupuncture plan is offered, for the clinician to tick");
    const candidates = [...plain, ...opinion];
    const summary = emptyOptionalSummary(report, { template, form }, candidates);
    assert.deepEqual(summary, { total: 5, opinion: 1, other: 2 }, "F-08 (a clinic-system code) and F-11 (a held-back answer) need a decision");
    assert.equal(
      leaveBlankSummaryText(candidates.length, summary),
      "5 optional boxes have no answer: 2 can be left blank in one step, with one reason; 1 asks for your opinion – tick it in the list only if you decide to leave it blank; the other 2 need a decision first.",
    );
    assert.equal(
      leaveBlankSummaryText(4, { total: 4, opinion: 3, other: 0 }),
      "4 optional boxes have no answer: 1 can be left blank in one step, with one reason; 3 ask for your opinion – tick them in the list only if you decide to leave them blank.",
    );
    assert.match(leaveBlankSummaryText(2, { total: 2, opinion: 0, other: 0 }), /^2 optional boxes have no answer\. You can leave them blank/);
  });

  it("an opinion box is left blank only when the clinician ticks it themselves (opinionKeys), never through the one-step keys", () => {
    const { report, form, template } = drafted();
    const viaKeys = leaveOptionalBoxesBlank(report, { template, form, keys: ["F-05", "F-07"], reason: LEAVE_BLANK_REASON, actor: ACTOR, now: NOW });
    assert.equal(viaKeys.gaps.find((g) => g.sectionKey === "F-07")?.resolution, undefined);
    const ticked = leaveOptionalBoxesBlank(report, { template, form, keys: [], opinionKeys: ["F-07"], reason: "No plan for acupuncture – left blank.", actor: ACTOR, now: NOW });
    assert.equal(ticked.gaps.find((g) => g.sectionKey === "F-07")?.resolution?.kind, "acknowledged");
    assert.equal(ticked.gaps.find((g) => g.sectionKey === "F-05")?.resolution, undefined, "only what was ticked");
  });
});

describe("fix round 1 (B0-3): a required choice the notes do not settle is answered, never acknowledged blank", () => {
  it("“WAD grade” for a knee injury: the item names the options up front, offers no acknowledgement, and keeps saying so after one", async () => {
    const { requiredAnswerFirst, resolutionOptionsFor } = await import("./review-model");
    const { report: base, form: baseForm } = drafted();
    const form: FormDefinition = {
      ...baseForm,
      fields: baseForm.fields.map((f) => (f.id === "F-11" ? { ...f, label: "WAD grade", required: true, options: ["0", "I", "IIa", "IIb", "III", "IV"] } : f)),
    };
    const template = formToTemplate(form);
    const report = revalidated({ ...base, gaps: base.gaps.map((g) => (g.sectionKey === "F-11" ? { ...g, id: "gap-F-11-t-1", raisedBy: "ai" as const, issue: "No WAD grade is recorded (a knee injury)." } : g)) }, form);
    const box = reviewItems(report, { template, form }).boxes.get("F-11");
    assert.equal(box?.heading, "Required – no answer yet");
    assert.equal(box?.instruction, "This form requires an answer – choose one of 0 / I / IIa / IIb / III / IV.");
    const options = requiredAnswerFirst(resolutionOptionsFor({ own: false, opinion: false, gap: box!.gaps[0], actor: ACTOR }));
    assert.equal(options.canAcknowledge, false, "no “Acknowledge with a reason” that would leave a required box blank");
    // Acknowledged anyway (an older report): still the same instruction, never a dead end.
    const acked = revalidated(resolveGap(report, "gap-F-11-t-1", "acknowledged", "Not applicable – knee injury.", ACTOR, NOW), form);
    assert.equal(reviewItems(acked, { template, form }).boxes.get("F-11")?.instruction, "This form requires an answer – choose one of 0 / I / IIa / IIb / III / IV.");
    assert.equal(canSign(acked.flags, acked.gaps).ok, false, "approval stays blocked until it is answered");
  });
});

describe("fix round 1 (B0-8): answering a box settles its own gaps in the same step", () => {
  it("typing or choosing an answer resolves the box's open gaps (audited); removing the answer reopens them; a drafted answer's gap stays to check", () => {
    const { report, form, template } = drafted();
    const before = reviewItems(report, { template, form }).count;
    // F-10 Prognosis (required opinion, no answer, one gap): the clinician writes their opinion.
    const typed = revalidated(reviewReducer(report, { type: "addParagraph", key: "F-10", text: "In my opinion he will recover fully within 6 weeks.", actor: ACTOR }), form);
    const gap = typed.gaps.find((g) => g.sectionKey === "F-10");
    assert.equal(gap?.resolution?.kind, "resolved");
    assert.equal(gap?.resolution?.text, "Answered on the form by Sarah Reid.");
    assert.equal(gap?.resolution?.byAnswer, true);
    assert.ok(typed.activity.some((a) => a.action === "gap_resolved" && a.detail.startsWith("F-10: resolved gap")), "audited like “Mark resolved”");
    assert.equal(reviewItems(typed, { template, form }).count, before - 1, "the count falls as boxes are answered");
    assert.equal(reviewItems(typed, { template, form }).boxes.get("F-10"), undefined, "no “confirm your answer” item left");
    // The answer removed again: the gap is open again.
    const pid = typed.sections.find((s) => s.key === "F-10")!.paragraphs[0].id;
    const removed = reviewReducer(typed, { type: "removeParagraph", key: "F-10", paragraphId: pid, actor: ACTOR });
    assert.equal(removed.gaps.find((g) => g.sectionKey === "F-10")?.resolution, undefined);
    // A choice: F-04 (yes/no, no answer, one gap).
    const chosen = reviewReducer(report, { type: "setAnswer", key: "F-04", value: true, actor: ACTOR });
    assert.equal(chosen.gaps.find((g) => g.sectionKey === "F-04")?.resolution?.text, "Answered on the form by Sarah Reid.");
    // Drafting is not a person: applying a draft never resolves a gap.
    // A box that already had an answer (F-09, drafted) keeps its gaps when the person edits it.
    const withGap: Report = { ...report, gaps: [...report.gaps, { id: "gap-F-09-t-2", sectionKey: "F-09", issue: "Which activity?", suggestedQuestion: "Which?", relatedNoteIds: [], raisedBy: "ai" }] };
    const edited = reviewReducer(withGap, { type: "editParagraph", key: "F-09", paragraphId: "F-09-p1", text: "He has made good progress.", actor: ACTOR });
    assert.equal(edited.gaps.find((g) => g.id === "gap-F-09-t-2")?.resolution, undefined);
  });

  it("a held-back drafted choice is ticked in one click – the person's decision, audited", () => {
    const { report } = drafted();
    const held = { id: "gap-F-11-ab12-choice", sectionKey: "F-11", issue: "The suggested answer “Moderate” is not stated in the cited notes…", suggestedQuestion: "Which?", relatedNoteIds: [], raisedBy: "system" as const, suggestedAnswer: "Moderate" };
    const withHeld: Report = { ...report, gaps: [...report.gaps.filter((g) => g.sectionKey !== "F-11"), held] };
    const ticked = reviewReducer(withHeld, { type: "setAnswer", key: "F-11", value: held.suggestedAnswer, actor: ACTOR });
    assert.deepEqual(ticked.sections.find((s) => s.key === "F-11")?.answer, { kind: "choice", value: "Moderate" });
    assert.equal(ticked.gaps.find((g) => g.id === held.id)?.resolution?.kind, "resolved");
    assert.ok(ticked.activity.some((a) => a.action === "answer_set" && /set to Moderate/.test(a.detail)));
  });
});

describe("safety amendment (NEW-1 stop-gap): staff answering never settles a clinician gap", () => {
  const STAFF = "Pat Morgan (fictional)";
  it("staff typing an opinion box leaves its gap open (approval stays blocked); the same answer by the clinician settles it", () => {
    const { report, form } = drafted();
    const typedByStaff = revalidated(reviewReducer(report, { type: "addParagraph", key: "F-10", text: "He will recover fully within 6 weeks.", actor: STAFF, actorIsStaff: true }), form);
    const gap = typedByStaff.gaps.find((g) => g.sectionKey === "F-10");
    assert.equal(gap?.resolution, undefined, "the clinician gap stays open");
    assert.equal(typedByStaff.activity.some((a) => a.action === "gap_resolved" && a.detail.startsWith("F-10:")), false);
    assert.ok(canSign(typedByStaff.flags, typedByStaff.gaps).blocking.some((f) => f.code === "OPEN_GAP" && f.sectionKey === "F-10"), "approval stays blocked on it");
    // A tick-box opinion (F-07, clinician_opinion checkbox) ticked by staff: open too.
    const tickedByStaff = reviewReducer(report, { type: "setAnswer", key: "F-07", value: true, actor: STAFF, actorIsStaff: true });
    assert.equal(tickedByStaff.gaps.find((g) => g.sectionKey === "F-07")?.resolution, undefined);
    // Negative twins: the clinician's own answer settles it (fix round 1, B0-8), and staff still settle an ordinary box.
    const byClinician = reviewReducer(report, { type: "addParagraph", key: "F-10", text: "He will recover fully within 6 weeks.", actor: ACTOR });
    assert.equal(byClinician.gaps.find((g) => g.sectionKey === "F-10")?.resolution?.text, "Answered on the form by Sarah Reid.");
    const staffChoice = reviewReducer(report, { type: "setAnswer", key: "F-04", value: true, actor: STAFF, actorIsStaff: true });
    assert.equal(staffChoice.gaps.find((g) => g.sectionKey === "F-04")?.resolution?.text, `Answered on the form by ${STAFF}.`);
  });

  it("the physiotherapist's choice on each report (“-physio” gap) is a clinician gap", async () => {
    const { isClinicianGap } = await import("./review-model");
    const base = testForm();
    const choice = field("F-13", { label: "Duties status – fit or not fit", answerType: "single_choice", options: ["Fit", "Not fit"], fillSource: { kind: "registration", path: "staff.entry" }, guidance: "To be chosen by the clinician." });
    const form: FormDefinition = { ...base, fields: [...base.fields, choice] };
    const bundle = testBundle();
    const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), now: new Date(AT), id: "rpt_physio_choice" });
    const physio = report.gaps.find((g) => g.sectionKey === "F-13");
    assert.ok(physio?.id.endsWith("-physio"), "report-factory raises the physiotherapist's-choice gap");
    assert.equal(isClinicianGap(report, physio!), true);
    const byStaff = reviewReducer(report, { type: "setAnswer", key: "F-13", value: "Fit", actor: STAFF, actorIsStaff: true });
    assert.equal(byStaff.gaps.find((g) => g.id === physio!.id)?.resolution, undefined);
    const byClinician = reviewReducer(report, { type: "setAnswer", key: "F-13", value: "Fit", actor: ACTOR });
    assert.equal(byClinician.gaps.find((g) => g.id === physio!.id)?.resolution?.kind, "resolved");
    // An ordinary staff entry (no clinician choice in its guidance) is not a clinician gap.
    assert.equal(isClinicianGap(report, { id: "gap-F-08-staff", sectionKey: "F-08" }), false);
  });
});

describe("safety amendment (C-REV-2 stop-gap): a paragraph staff add is checked as edited text, never the clinician's own words", () => {
  const STAFF = "Pat Morgan (fictional)";
  it("staff text in a drafted or opinion box is origin “edited” and blocks like edited text; the clinician's own paragraph and a staff entry do not", () => {
    const { report, form, template } = drafted();
    const opinion = "He has made a full recovery and is fit for normal duties.";
    const paragraphOf = (r: Report, key: string) => r.sections.find((s) => s.key === key)!.paragraphs.at(-1)!;
    // Staff type an opinion into "Prognosis" (clinician_opinion) and into "Mechanism of injury" (a drafted narrative box).
    for (const key of ["F-10", "F-03"]) {
      const byStaff = revalidated(reviewReducer(report, { type: "addParagraph", key, text: opinion, actor: STAFF, actorIsStaff: true }), form);
      const p = paragraphOf(byStaff, key);
      assert.equal(p.origin, "edited", `${key}: staff text is not the clinician's own words`);
      const blocking = canSign(byStaff.flags, byStaff.gaps).blocking.filter((f) => f.paragraphId === p.id);
      assert.ok(blocking.some((f) => f.code === "UNCITED_PARAGRAPH"), `${key}: checked for its citation`);
      assert.ok(byStaff.flags.some((f) => f.paragraphId === p.id && f.code === "OPINION_LANGUAGE"), `${key}: checked for opinion wording`);
    }
    // Negative twins: the same words added by the clinician are their own (fix round 1 behaviour unchanged)…
    const byClinician = revalidated(reviewReducer(report, { type: "addParagraph", key: "F-10", text: opinion, actor: ACTOR }), form);
    const own = paragraphOf(byClinician, "F-10");
    assert.equal(own.origin, "clinician");
    assert.deepEqual(byClinician.flags.filter((f) => f.paragraphId === own.id && (f.code === "UNCITED_PARAGRAPH" || f.code === "OPINION_LANGUAGE")), []);
    // …and a value staff type into a records box (F-08 Work telephone, a staff entry) stays "Entered by staff".
    const entry = revalidated(reviewReducer(report, { type: "addParagraph", key: "F-08", text: "01632 960123", actor: STAFF, actorIsStaff: true }), form);
    const typed = paragraphOf(entry, "F-08");
    assert.equal(typed.origin, "clinician");
    assert.equal(entry.flags.some((f) => f.paragraphId === typed.id && f.code === "UNCITED_PARAGRAPH"), false);
    assert.equal(validateReport(entry, template, { form }).flags.some((f) => f.paragraphId === typed.id && f.severity === "blocking"), false);
  });
});

describe("fix round 1 (B0-15): appointment times are record values", () => {
  it("the first attended appointment's time, and the Nth attended appointment's date and time; a session the record does not have is left empty", async () => {
    const { resolveRegistrationValue } = await import("../../../core/forms");
    const { ANALYSIS_REGISTRATION_PATHS } = await import("../../../ai/form-analysis-schema");
    const bundle = testBundle(); // attended 18/03/2026 09:00 (N-001) and 06/05/2026 09:00 (N-002); 01/04/2026 not attended
    const ctx = { bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), reportDate: "2026-10-06" };
    assert.deepEqual(resolveRegistrationValue("episode.firstSeenTime", ctx), { text: "09:00", value: "09:00", sourceIds: ["N-001"] });
    assert.equal(resolveRegistrationValue("episode.attendedDate", ctx, "date", { index: 2, of: 8 })?.value, "2026-05-06", "the 2nd ATTENDED one, not the missed one");
    assert.equal(resolveRegistrationValue("episode.attendedTime", ctx, "short_text", { index: 2, of: 8 })?.text, "09:00");
    assert.equal(resolveRegistrationValue("episode.attendedTime", ctx, "short_text", { index: 7, of: 8 })?.blank, true, "session 7 of a 2-session episode prints nothing");
    // A Medcare-like form: session 7's time is answered by design (nothing to type), session 2's from the record.
    const base = testForm();
    const time = (id: string, n: number): FormField => field(id, { label: `Session ${n} – time`, answerType: "short_text", fillSource: { kind: "registration", path: "episode.attendedTime", part: { index: n, of: 8 } }, required: false });
    const form: FormDefinition = { ...base, fields: [...base.fields, time("F-13", 2), time("F-14", 7)] };
    const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: ctx.computedFacts, now: new Date(AT), id: "rpt_session_times" });
    assert.equal(report.sections.find((s) => s.key === "F-13")?.paragraphs[0]?.text, "09:00");
    assert.equal(report.sections.find((s) => s.key === "F-14")?.blankFromRecords, true);
    assert.equal(report.gaps.some((g) => g.sectionKey === "F-13" || g.sectionKey === "F-14"), false, "staff no longer retype times the notes hold");
    // The live form reading is offered exactly the paths it was before.
    assert.equal((ANALYSIS_REGISTRATION_PATHS as readonly string[]).includes("episode.attendedTime"), false);
  });
});
