/**
 * Blue Heart fix round 3 – the review: provenance, statuses, wording and amendments.
 * B2-15 evidence codes, B2-20 who answered, B2-21 staff entries, B2-22 source lines, B2-23 "Needs clinician input",
 * B2-24 not applicable counts, B2-25 amended versions, B2-26 the discharge date, B2-29 headings, B2-32 possessives after a
 * bracket, B2-33 doubled punctuation, B2-34 tick guidance as printed. Fictional record (test fixtures).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyEntries, questionLead } from "../../../core/answer-copy";
import { computeFacts } from "../../../core/computed-facts";
import { currentGuidance, formToTemplate, sectionHeadings, SIGNOFF_HEADING } from "../../../core/forms";
import { validateReport } from "../../../core/validation";
import { tidyPunctuation, withoutEndPunctuation } from "../../../core/labels";
import { namedThing, NamedThing } from "../../../core/possessive";
import { createFormReport } from "../../../core/report-factory";
import type { FormDefinition, FormField, Report, SignReceipt } from "../../../core/types";
import { testBundle } from "../../../core/validation/test-fixtures";
import { activityLabel } from "./activity-panel";
import { reviewItems } from "./box-items";
import {
  amendmentStartedEntry,
  amendmentState,
  answerReplacedDraft,
  buildQuestionGroups,
  clinicOverrideUntyped,
  countStatuses,
  createAmendedVersion,
  flagEvidenceText,
  flattenQuestions,
  markSupersededBy,
  needsClinicianText,
  overrideRecordValue,
  questionStatus,
  setStructuredAnswer,
} from "./review-model";
import { reviewReducer } from "./use-review-state";

const AT = "2026-10-25T09:00:00.000Z";
let n = 0;
const field = (label: string, rest: Partial<FormField> & Pick<FormField, "answerType" | "fillSource">): FormField => {
  n += 1;
  return { id: `F-${String(n).padStart(2, "0")}`, label, guidance: "", anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${n}.c1` }, required: true, confidence: "high", ...rest };
};
function formOf(fields: FormField[], title = "End of Treatment Report"): FormDefinition {
  return {
    id: "frm_rev3",
    tenantId: "demo",
    referrer: { name: "TPN (The Physiotherapy Network)", type: "mlc" },
    title,
    file: { fileName: "f.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "d".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    createdAt: AT,
    updatedAt: AT,
  } as FormDefinition;
}
const reportOf = (form: FormDefinition, bundle = testBundle()): Report =>
  createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), id: "rpt_rev3", now: new Date(AT), author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } });

describe("fix round 3 (B2-15): warnings never show internal evidence codes", () => {
  it("shows the words a check found, never “shorten”, “repeat F-28”, “sessions 7”, “not applicable” or an ISO date", () => {
    for (const [code, evidence] of [
      ["DRAFT_FIT", "shorten"],
      ["DRAFT_FIT", "comment"],
      ["DRAFT_FIT", "wording"],
      ["DRAFT_FIT", "earlier note 2026-08-19"],
      ["DRAFT_FIT", "later note 2026-09-16"],
      ["DRAFT_FIT", "repeat F-28"],
      ["OTHER_CLINICIAN_VOICE", "sessions 7"],
      ["OTHER_CLINICIAN_VOICE", "named Tom Ellis"],
      ["NOT_APPLICABLE_ANSWERED", "not applicable"],
      ["NOT_APPLICABLE_ANSWERED", "condition does not hold"],
    ] as const) {
      assert.equal(flagEvidenceText({ code, evidence }), null, `${code} ${evidence}`);
    }
    assert.equal(flagEvidenceText({ code: "OPINION_LANGUAGE", evidence: "full recovery" }), "full recovery");
    assert.equal(flagEvidenceText({ code: "FIGURE_NOT_IN_SOURCE", evidence: "date 2026-08-19" }), "date 19/08/2026", "never an ISO date");
  });
});

describe("fix round 3 (B2-20, B2-21, B2-24): statuses say who answered, what staff type in and what does not apply", () => {
  it("a choice a person set is theirs even with drafted supporting text; “Answer changed” only over a drafted value", () => {
    n = 27;
    const form = formOf([field("Are the treatment goals achieved?", { answerType: "yes_no", options: ["Yes", "No"], fillSource: { kind: "notes_narrative" } })]);
    const base = reportOf(form);
    const drafted: Report = { ...base, sections: base.sections.map((s) => ({ ...s, status: "drafted" as const, answer: { kind: "yes_no" as const, value: null }, paragraphs: [{ id: "F-28-p1", text: "On 06/05/2026 Tom Ellis recorded discharge to self-management.", sourceIds: ["N-002"], origin: "ai" as const }] })) };
    const chosen = setStructuredAnswer(drafted, "F-28", true, "Sarah Reid");
    const q = flattenQuestions(buildQuestionGroups(chosen, form, null))[0];
    assert.equal(questionStatus({ ...q, section: chosen.sections[0] }, [], [], true), "clinician", "it stayed “Drafted from the notes” (Ascenti Discharge F-28)");
    assert.equal(answerReplacedDraft(chosen, "F-28"), false, "a first answer: “Answered by the clinician”");
    assert.equal(activityLabel("answer_set", chosen.activity[chosen.activity.length - 1].detail), "Answer entered");
    const replaced = setStructuredAnswer({ ...drafted, sections: drafted.sections.map((s) => ({ ...s, answer: { kind: "yes_no" as const, value: true } })) }, "F-28", false, "Sarah Reid");
    assert.equal(answerReplacedDraft(replaced, "F-28"), true);
    assert.equal(activityLabel("answer_set", replaced.activity[replaced.activity.length - 1].detail), "Answer changed");
    // A first answer typed into an empty text box is entered, not edited.
    n = 13;
    const textForm = formOf([field("Pain VAS", { answerType: "short_text", fillSource: { kind: "notes_narrative" } })]);
    const empty = reportOf(textForm);
    const typed = reviewReducer(reviewReducer(empty, { type: "addParagraph", key: "F-14", text: "6/10", actor: "Sarah Reid" }), { type: "logEdit", key: "F-14", actor: "Sarah Reid" });
    assert.match(typed.activity[typed.activity.length - 1].detail, /^F-14: entered the answer to “Pain VAS”\.$/);
    const again = reviewReducer(typed, { type: "logEdit", key: "F-14", actor: "Sarah Reid" });
    assert.match(again.activity[again.activity.length - 1].detail, /^F-14: edited the answer/);
  });

  it("an unanswered staff entry is “To be entered by staff”, never “Needs clinician input”; a box that does not apply is “Not applicable”, out of the share answered", () => {
    n = 0;
    const form = formOf([
      field("Your reference", { answerType: "short_text", fillSource: { kind: "registration", path: "staff.entry" } as never }),
      field("Work status", { answerType: "single_choice", options: ["Working", "Off work"], guidance: "Chosen by the physiotherapist on each report.", fillSource: { kind: "registration", path: "staff.entry" } as never }),
      field("Is further treatment recommended?", { answerType: "yes_no", fillSource: { kind: "clinician_opinion" } }),
      field("If yes, please detail", { answerType: "long_text", required: false, fillSource: { kind: "clinician_opinion" } }),
    ]);
    const report = setStructuredAnswer(reportOf(form), "F-03", false, "Sarah Reid");
    const qs = flattenQuestions(buildQuestionGroups(report, form, null));
    const status = (key: string) => questionStatus(qs.find((q) => q.key === key)!, report.flags, report.gaps, false, false, report);
    assert.equal(status("F-01"), "staff_entry");
    assert.equal(status("F-02"), "needs_input", "a physiotherapist's choice still waits for the clinician");
    assert.equal(status("F-04"), "not_applicable");
    const counts = countStatuses(qs.map((q) => questionStatus(q, report.flags, report.gaps, false, true, report)));
    assert.equal(counts.counts.not_applicable, 1);
    assert.equal(counts.counts.left_blank, 2, "the not-applicable box is not counted as left blank (approved)");
  });
});

describe("fix round 3 (B2-22, B2-26, B2-34): guidance and source lines follow where a value really comes from", () => {
  it("“Filled from the record” for a staff entry or the clinic's details, a withheld reference, and tick options as printed", () => {
    const staff = { fillSource: { kind: "registration", path: "staff.entry" } as FormField["fillSource"], answerType: "short_text" as const };
    assert.equal(currentGuidance("Printed as “Case Ref”. Filled from the record: the referrer's reference for this case.", { fillSource: { kind: "registration", path: "referral.reference" } }, { withheldReference: true }), "Printed as “Case Ref”. Typed in by staff from the referrer's letter: the referrer's reference for this case.");
    assert.equal(currentGuidance("Filled from the record: the alternate reference.", staff), "Entered by staff on each report: the alternate reference.");
    assert.equal(currentGuidance("Printed as “Location of Treatment”. Filled from the record: the clinic (site) the patient attends.", { fillSource: { kind: "registration", path: "clinic.name" } }), "Printed as “Location of Treatment”. From your Clinic details: the clinic (site) the patient attends.");
    assert.equal(currentGuidance("Filled from the record: the patient's postcode.", { fillSource: { kind: "registration", path: "patient.postcode" } }), "Filled from the record: the patient's postcode.", "the patient's record is the record");
    assert.equal(currentGuidance("Ticked when tens was provided; unanswered, the printed default stays.", { fillSource: { kind: "notes_narrative" }, answerType: "checkbox", options: ["TENS"] }), "Ticked when TENS was provided; left blank, the printed default is removed.");
    assert.equal(currentGuidance("Ticked when joint mobilisations was provided; unanswered, the printed default stays.", { fillSource: { kind: "notes_narrative" }, answerType: "checkbox", options: ["Joint mobilisations"] }), "Ticked when joint mobilisations were provided; left blank, the printed default is removed.");
    assert.equal(currentGuidance("Ticked when the treatment plan includes tens; unanswered, the printed default stays.", { fillSource: { kind: "clinician_opinion" }, answerType: "checkbox", options: ["TENS"] }), "Ticked when the treatment plan includes TENS; left blank, the printed default is removed.");
    // The review shows the withheld reference's guidance that way.
    n = 0;
    const form = formOf([field("Case Ref", { answerType: "short_text", guidance: "Printed as “Case Ref”. Filled from the record: the referrer's reference for this case.", fillSource: { kind: "registration", path: "referral.reference" } as never })]);
    const q = flattenQuestions(buildQuestionGroups(reportOf(form), form, null))[0];
    assert.match(q.guidance, /Typed in by staff from the referrer's letter/);
  });

  it("“Change it for this patient's site” is not “Typed in by …” until something is typed", () => {
    n = 0;
    const bundle = { ...testBundle(), clinic: { name: "Blue Heart Clinics Test Ltd (fictional)", addressLines: ["1 Test Street (fictional)"], postcode: "ZZ1 1ZZ" } } as never;
    const form = formOf([field("Location of Treatment", { answerType: "short_text", fillSource: { kind: "registration", path: "clinic.name" } as never })]);
    const report = reportOf(form, bundle);
    assert.equal(report.sections[0].paragraphs[0]?.text, "Blue Heart Clinics Test Ltd (fictional)");
    const opened = overrideRecordValue(report, "F-01", "Sarah Reid");
    assert.equal(clinicOverrideUntyped(opened, "F-01"), true);
    const typed = { ...opened, sections: opened.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: "Blue Heart Aylesbury (fictional)" })) })) };
    assert.equal(clinicOverrideUntyped(typed, "F-01"), false);
  });

  it("the date treatment was completed: the date, or N/A while treatment goes on (Physio-Link Discharge F-07)", () => {
    n = 6;
    const form = formOf([field("Date treatment completed", { answerType: "date", fillSource: { kind: "registration", path: "episode.dischargeDate" } as never })]);
    const report = reportOf(form, { ...testBundle(), episodeStatus: "active" } as never);
    const gap = report.gaps.find((g) => g.sectionKey === "F-07");
    assert.equal(gap?.suggestedQuestion, "Type the date treatment was completed, or N/A if treatment is still going on.");
    const box = reviewItems(report, { template: null, form }).boxes.get("F-07");
    assert.equal(box?.instruction, "Type the date treatment was completed, or N/A if treatment is still going on – the notes have no discharge.");
    assert.doesNotMatch(box?.instruction ?? "", /clinic record does not hold it/);
  });
});

describe("fix round 3 (B2-23): “Needs clinician input” is worded from the box's gap", () => {
  it("says the signer recorded an opinion when the gap quotes the signer's own note", () => {
    const own = [{ id: "g", sectionKey: "F-36", issue: "On 06/05/2026 Tom Ellis recorded that in his opinion the stiffness should settle within 4–6 weeks.", suggestedQuestion: "", relatedNoteIds: ["N-002"], raisedBy: "ai" as const }];
    assert.match(needsClinicianText(own, testBundle(), "Tom Ellis"), /^Your own note records an opinion on this/);
    assert.match(needsClinicianText(own, testBundle(), "Sarah Reid"), /^No clinician recorded an opinion on this in the notes/);
  });
});

describe("fix round 3 (B2-25): amended versions", () => {
  it("no raw ID in the log; superseded only once the amended version is approved – then it says so", () => {
    const approved = { ...reportOf(formOf([])), status: "signed" as const, receipt: { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, signedAt: "2026-10-25T10:00:00.000Z" } as SignReceipt };
    const v2 = createAmendedVersion(approved, "Sarah Reid", "rpt_v2");
    const entry = amendmentStartedEntry(v2, "Sarah Reid");
    assert.equal(entry.detail, "Amended version 2 started. This approval stays final until version 2 is approved.");
    assert.doesNotMatch(entry.detail, /rpt_/);
    assert.equal(entry.action, "amendment_started", "not “superseded” yet");
    const v1 = { ...approved, activity: [...approved.activity, { ...entry, at: AT }] };
    assert.deepEqual(amendmentState(v1), { kind: "open", reportId: "rpt_v2", version: 2 });
    const v2Approved = { ...v2, status: "signed" as const, receipt: { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, signedAt: "2026-10-26T10:00:00.000Z" } as SignReceipt };
    const superseded = markSupersededBy(v1, v2Approved);
    assert.equal(superseded.activity[superseded.activity.length - 1].detail, "Superseded by version 2 – approved by Sarah Reid on 26/10/2026.");
    assert.deepEqual(amendmentState(superseded), { kind: "superseded", reportId: "rpt_v2", version: 2, approvedOn: "26/10/2026" });
    assert.equal(activityLabel("superseded"), "Replaced by a newer version");
  });
});

describe("fix round 3 (B2-29): headings – the sign-off is its own group; a form with no heading shows none", () => {
  it("CLM Discharge: further assessment, psychosocial and findings questions are not under the treatment modalities", () => {
    const fields = [
      { section: "Please indicate which treatment modalities have been used:", label: "Exercise", answerType: "checkbox" as const, fillSource: { kind: "notes_narrative" as const } },
      { section: "Please indicate which treatment modalities have been used:", label: "Other (please specify)", answerType: "short_text" as const, fillSource: { kind: "leave_blank" as const } },
      { section: null, label: "Is further assessment, treatment or investigation recommended?", answerType: "long_text" as const, fillSource: { kind: "clinician_opinion" as const } },
      { section: null, label: "Name of Treating Therapist", answerType: "clinician_name" as const, fillSource: { kind: "signoff" as const, part: "name" } },
      { section: null, label: "Signature", answerType: "signature" as const, fillSource: { kind: "signoff" as const, part: "signature" } },
    ] as never;
    const h = sectionHeadings(fields);
    assert.deepEqual(h.slice(2), ["", SIGNOFF_HEADING, SIGNOFF_HEADING]);
    // A sign-off under a heading that holds sign-off questions keeps it (Medcare's "Statement of Truth").
    const truth = sectionHeadings([
      { section: "Statement of Truth", label: "Signed", answerType: "signature", fillSource: { kind: "signoff", part: "signature" } },
      { section: null, label: "Date", answerType: "date_signed", fillSource: { kind: "signoff", part: "date" } },
    ] as never);
    assert.deepEqual(truth, ["Statement of Truth", "Statement of Truth"]);
    // A portal set with no heading at all: no "Other questions" / "Form questions" title.
    n = 0;
    const portal = formOf([field("Current symptoms", { answerType: "long_text", fillSource: { kind: "notes_narrative" } }), field("Prognosis", { answerType: "long_text", fillSource: { kind: "clinician_opinion" } })]);
    assert.deepEqual(buildQuestionGroups(reportOf(portal), portal, null).map((g) => g.title), [""]);
  });
});

describe("fix round 3 (B2-32, B2-33): possessives after a bracket and doubled punctuation", () => {
  it("“the reference from TPN (The Physiotherapy Network)”, never “…Network)'s”", () => {
    assert.equal(namedThing("TPN (The Physiotherapy Network)", "reference"), "the reference from TPN (The Physiotherapy Network)");
    assert.equal(NamedThing("Harbourside Case Management (fictional)", "reference", "of"), "The reference of Harbourside Case Management (fictional)");
    assert.equal(namedThing("Bodycare Clinics", "reference"), "Bodycare Clinics' reference");
    assert.equal(namedThing("Ascenti", "form"), "Ascenti's form");
    n = 2;
    const form = formOf([field("TPN reference", { answerType: "short_text", fillSource: { kind: "registration", path: "referral.reference" } as never })]);
    const report = reportOf(form);
    for (const g of report.gaps) assert.doesNotMatch(`${g.issue} ${g.suggestedQuestion}`, /\)'s/);
    const box = reviewItems(report, { template: null, form }).boxes.get("F-03");
    assert.equal(box?.instruction, "Type the reference of TPN (The Physiotherapy Network) from their letter.");
  });

  it("no “symptoms..”, “details.”.” or “comments.:”", () => {
    assert.equal(tidyPunctuation("The record does not answer “If no for either of the above, please provide brief details.”."), "The record does not answer “If no for either of the above, please provide brief details”.");
    assert.equal(tidyPunctuation("choose one of At work / Not at work due to current symptoms.."), "choose one of At work / Not at work due to current symptoms.");
    assert.equal(tidyPunctuation("Wait… and so on... fine."), "Wait… and so on... fine.", "an ellipsis stays");
    assert.equal(withoutEndPunctuation("Not at work due to current symptoms."), "Not at work due to current symptoms");
    assert.equal(questionLead("If no for either of the above, please provide brief details."), "If no for either of the above, please provide brief details:");
    assert.equal(questionLead("Any additional comments."), "Any additional comments:");
    assert.equal(questionLead("Is the patient fit for work?"), "Is the patient fit for work?");
    n = 11;
    const form = formOf([field("Current work status", { answerType: "single_choice", options: ["At work on full duties/hours.", "Not at work due to current symptoms."], fillSource: { kind: "notes_narrative" } })]);
    const drafted = { ...reportOf(form), sections: reportOf(form).sections.map((s) => ({ ...s, status: "needs_input" as const })) };
    const validated = { ...drafted, flags: validateReport(drafted, formToTemplate(form), { form }).flags };
    const box = reviewItems(validated, { template: formToTemplate(form), form }).boxes.get("F-12");
    assert.ok(box);
    assert.equal(box.instruction, "This form requires an answer – choose one of At work on full duties/hours / Not at work due to current symptoms.");
    assert.equal(copyEntries({ ...reportOf(form), receipt: undefined }, form)[0].question, "Current work status");
  });
});
