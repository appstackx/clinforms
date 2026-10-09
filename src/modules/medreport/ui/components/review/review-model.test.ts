/**
 * Review workspace model: grouping, statuses, the honest generation badge, the clinician's edits, and
 * the invariant that approval does not change the signed content.
 *
 * Owner: studio-b agent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeFacts } from "../../../core/computed-facts";
import { reportFingerprint } from "../../../core/fingerprint";
import { formToTemplate } from "../../../core/forms";
import { createFormReport } from "../../../core/report-factory";
import type { FormDefinition, FormField, GenerationMeta, Report, SignReceipt } from "../../../core/types";
import { validateReport } from "../../../core/validation";
import { testBundle } from "../../../core/validation/test-fixtures";
import {
  acknowledgeFlag,
  addClinicianParagraph,
  answerChangedByClinician,
  answeredByPerson,
  gapResolutionOptions,
  MIN_GAP_REASON,
  answerOptions,
  buildQuestionGroups,
  citationLabel,
  citationsBySource,
  editParagraph,
  flattenQuestions,
  generationSummary,
  markApproved,
  nextClinicianParagraphId,
  questionStatus,
  removeParagraph,
  reopenGap,
  resolveGap,
  revertParagraph,
  setStructuredAnswer,
  supersedeAcknowledgedGaps,
} from "./review-model";
import { reviewReducer } from "./use-review-state";

const AT = "2026-10-06T09:00:00.000Z";
const NOW = new Date("2026-10-07T10:00:00.000Z");

let n = 0;
function field(spec: Partial<FormField> & Pick<FormField, "label" | "answerType" | "fillSource">): FormField {
  n += 1;
  const id = `F-${String(n).padStart(2, "0")}`;
  return {
    id,
    guidance: `Answer “${spec.label}”.`,
    anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${n}.c1` },
    required: true,
    confidence: "high",
    ...spec,
  };
}

function testForm(): FormDefinition {
  n = 0;
  return {
    id: "frm_test_review",
    tenantId: "demo",
    referrer: { name: "Example Medico-Legal (fictional)", type: "mlc" },
    title: "Treating Physiotherapist Report",
    file: {
      fileName: "example.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: "a".repeat(64),
      sizeBytes: 1000,
    },
    kind: "docx",
    fields: [
      field({ label: "Claimant name", section: "Part A – Claimant", answerType: "short_text", fillSource: { kind: "registration", path: "patient.fullName" } }),
      field({ label: "Date of accident", section: "Part A – Claimant", answerType: "date", fillSource: { kind: "registration", path: "incident.date" } }),
      field({ label: "B1. Mechanism of injury", section: "Part B – Clinical", answerType: "long_text", fillSource: { kind: "notes_narrative" } }),
      field({ label: "B2. Is the claimant fit for work?", section: "Part B – Clinical", answerType: "single_choice", options: ["Yes", "No", "Modified duties"], fillSource: { kind: "clinician_opinion" } }),
      field({ label: "If modified duties, give details", section: "B2. Is the claimant fit for work?", answerType: "long_text", fillSource: { kind: "clinician_opinion" } }),
      field({ label: "B3. Prognosis", section: "Part B – Clinical", answerType: "long_text", fillSource: { kind: "clinician_opinion" } }),
      field({ label: "Reached maximum improvement?", section: "Part B – Clinical", answerType: "yes_no", options: ["Yes", "No"], fillSource: { kind: "clinician_opinion" } }),
      field({ label: "Signature", section: "Part C – Declaration", answerType: "signature", fillSource: { kind: "signoff", part: "signature" } }),
      field({ label: "Checked by (office use)", section: "Office use only", answerType: "short_text", fillSource: { kind: "leave_blank" }, required: false }),
    ],
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: "test", at: AT, warnings: [] },
    confirmed: { by: "Practice manager (demo)", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

function testReport(): { report: Report; form: FormDefinition } {
  const form = testForm();
  const bundle = testBundle();
  const report = createFormReport({
    form,
    bundle,
    instructingParty: { type: "mlc", name: form.referrer.name, reference: "EX-1", contactName: "", address: "" },
    computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }),
    now: new Date(AT),
    id: "rpt_review_test",
  });
  return { report, form };
}

/** The report after "drafting": F-03 drafted from N-001 (AI), F-04 answered from the recorded opinion, rest left. */
function drafted(): { report: Report; form: FormDefinition } {
  const { report, form } = testReport();
  const sections = report.sections.map((s) => {
    if (s.key === "F-03") {
      return {
        ...s,
        status: "drafted" as const,
        paragraphs: [{ id: "F-03-p1", text: "On 18/03/2026 he reported a lifting injury at work on 12/03/2026.", sourceIds: ["N-001"], origin: "ai" as const, basis: "patient_reported" as const }],
      };
    }
    if (s.key === "F-04") {
      return {
        ...s,
        status: "drafted" as const,
        answer: { kind: "choice" as const, value: "Modified duties" },
        paragraphs: [
          {
            id: "F-04-p1",
            text: "On 06/05/2026 Tom Ellis recorded that he was fit for a phased return to normal duties over 2 weeks.",
            sourceIds: ["N-002"],
            origin: "ai" as const,
            basis: "clinician_opinion_recorded" as const,
          },
        ],
      };
    }
    return s.status === "pending" ? { ...s, status: "needs_input" as const } : s;
  });
  return {
    report: {
      ...report,
      sections,
      gaps: [
        {
          id: "gap-F-06-ai",
          sectionKey: "F-06",
          issue: "No clinician recorded a prognosis.",
          suggestedQuestion: "What is your prognosis?",
          relatedNoteIds: ["N-002"],
          raisedBy: "ai",
        },
      ],
    },
    form,
  };
}

describe("buildQuestionGroups", () => {
  it("groups by the form's own headings, keeps sub-questions with their question and lists left-blank fields", () => {
    const { report, form } = testReport();
    const groups = buildQuestionGroups(report, form, formToTemplate(form));
    assert.deepEqual(
      groups.map((g) => [g.title, g.questions.map((q) => q.key)]),
      [
        ["Part A – Claimant", ["F-01", "F-02"]],
        ["Part B – Clinical", ["F-03", "F-04", "F-05", "F-06", "F-07"]],
        ["Part C – Declaration", ["F-08"]],
        ["Office use only", ["F-09"]],
      ],
    );
    const qs = flattenQuestions(groups);
    assert.equal(qs.find((q) => q.key === "F-05")?.context, "B2. Is the claimant fit for work?");
    assert.equal(qs.find((q) => q.key === "F-09")?.section, null);
    assert.equal(qs.find((q) => q.key === "F-01")?.number, 1);
  });

  it("puts questions printed without a heading into their own group, not the previous heading's", () => {
    const { report, form } = testReport();
    const fields = form.fields.map((f) => (f.id === "F-04" || f.id === "F-06" || f.id === "F-07" ? { ...f, section: undefined } : f));
    const groups = buildQuestionGroups(report, { fields }, formToTemplate({ ...form, fields }));
    assert.deepEqual(
      groups.map((g) => [g.title, g.questions.map((q) => q.key)]),
      [
        ["Part A – Claimant", ["F-01", "F-02"]],
        ["Part B – Clinical", ["F-03"]],
        ["Form questions", ["F-04", "F-05", "F-06", "F-07"]],
        ["Part C – Declaration", ["F-08"]],
        ["Office use only", ["F-09"]],
      ],
    );
  });

  it("shows built-in template reports as one group of sections", () => {
    const { report } = testReport();
    const builtIn = { ...report, form: undefined };
    const groups = buildQuestionGroups(builtIn, null, null);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].questions.length, report.sections.length);
  });
});

describe("questionStatus", () => {
  it("derives records / drafted / needs input / blocked / signoff / blank / pending", () => {
    const { report, form } = drafted();
    const template = formToTemplate(form);
    const result = validateReport(report, template);
    const withFlags = { ...report, flags: result.flags };
    const qs = flattenQuestions(buildQuestionGroups(withFlags, form, template));
    const status = (key: string) => {
      const q = qs.find((x) => x.key === key);
      assert.ok(q);
      return questionStatus(q, withFlags.flags, withFlags.gaps);
    };
    assert.equal(status("F-01"), "records");
    assert.equal(status("F-02"), "records");
    assert.equal(status("F-03"), "drafted");
    assert.equal(status("F-04"), "drafted");
    assert.equal(status("F-06"), "needs_input");
    assert.equal(status("F-08"), "signoff");
    assert.equal(status("F-09"), "blank");

    const { report: fresh } = testReport();
    const q3 = flattenQuestions(buildQuestionGroups(fresh, form, template)).find((q) => q.key === "F-03");
    assert.ok(q3);
    assert.equal(questionStatus(q3, [], []), "pending");

    // Answered by the clinician but the AI's gap is still open → blocked until resolved.
    const answered = addClinicianParagraph(withFlags, "F-06", "In my opinion he will continue to improve with his exercises.", NOW).report;
    const q6 = flattenQuestions(buildQuestionGroups(answered, form, template)).find((q) => q.key === "F-06");
    assert.ok(q6);
    assert.equal(questionStatus(q6, answered.flags, answered.gaps), "blocked");
    const resolved = resolveGap(answered, "gap-F-06-ai", "resolved", "Answered on the form by the treating clinician.", "Sarah Reid", NOW);
    const q6b = flattenQuestions(buildQuestionGroups(resolved, form, template)).find((q) => q.key === "F-06");
    assert.ok(q6b);
    const flags2 = validateReport(resolved, template).flags;
    assert.equal(questionStatus(q6b, flags2, resolved.gaps), "clinician");
  });
});

describe("generationSummary", () => {
  const meta = (m: Partial<GenerationMeta>): GenerationMeta => ({ mode: "live", sectionKeys: ["F-03"], at: AT, promptVersion: "p1", ...m });

  it("reports live drafting as the wall time from the first start to the last finish", () => {
    const s = generationSummary([
      meta({ at: "2026-10-06T09:00:00.000Z", durationMs: 20_000, model: "claude-opus-5-5" }),
      meta({ at: "2026-10-06T09:00:01.000Z", durationMs: 33_000, sectionKeys: ["F-04", "F-05"] }),
    ]);
    assert.ok(s);
    assert.equal(s.tone, "live");
    assert.equal(s.label, "Drafted from the notes in 34 s");
    assert.equal(s.lines[0], "F-03 · drafted 06/10/2026 10:00 · 20 s");
    // Customer-facing: never a vendor or model name (core/wording.ts, DISCLOSURE "neutral").
    assert.ok(!/claude|opus|model|tokens/i.test(s.lines.join(" ")));
  });

  it("is honest about prepared demo and sample drafts", () => {
    const recorded = generationSummary([meta({ mode: "demo_recorded", recordedAt: "2026-10-05T12:00:00.000Z", durationMs: 6_000, model: "drafting-service" })]);
    assert.equal(recorded?.label, "Prepared demo draft (05/10/2026)");
    assert.equal(recorded?.lines[0], "F-03 · prepared demo draft · drafted 05/10/2026 13:00 · 6 s");
    assert.equal(generationSummary([meta({ mode: "demo_prewritten" })])?.label, "Sample draft (demo)");
    assert.equal(generationSummary([]), null);
    assert.equal(
      generationSummary([meta({ durationMs: 5000 }), meta({ mode: "demo_prewritten" })])?.label,
      "Drafted from the notes in 5 s (+1 other group)",
    );
  });
});

describe("edits", () => {
  it("turns edited AI text into 'edited', keeps the AI wording, and reverts", () => {
    const { report } = drafted();
    const edited = editParagraph(report, "F-03", "F-03-p1", "On 18/03/2026 he reported a lifting injury at work.", NOW);
    const p = edited.sections.find((s) => s.key === "F-03")?.paragraphs[0];
    assert.equal(p?.origin, "edited");
    assert.equal(p?.originalText, "On 18/03/2026 he reported a lifting injury at work on 12/03/2026.");
    assert.equal(edited.updatedAt, NOW.toISOString());

    const back = editParagraph(edited, "F-03", "F-03-p1", "On 18/03/2026 he reported a lifting injury at work on 12/03/2026.", NOW);
    assert.equal(back.sections.find((s) => s.key === "F-03")?.paragraphs[0].origin, "ai");

    const reverted = revertParagraph(edited, "F-03", "F-03-p1", NOW);
    assert.equal(reverted.sections.find((s) => s.key === "F-03")?.paragraphs[0].text, p?.originalText);
    assert.equal(reverted.sections.find((s) => s.key === "F-03")?.paragraphs[0].origin, "ai");
  });

  it("never edits text filled from the records", () => {
    const { report } = drafted();
    const reg = report.sections.find((s) => s.key === "F-01");
    assert.ok(reg?.paragraphs[0]);
    assert.equal(editParagraph(report, "F-01", reg.paragraphs[0].id, "Someone else", NOW), report);
    assert.equal(removeParagraph(report, "F-01", reg.paragraphs[0].id, NOW), report);
  });

  it("adds clinician paragraphs with predictable IDs and removes them", () => {
    const { report } = drafted();
    const section = report.sections.find((s) => s.key === "F-06");
    assert.ok(section);
    const predicted = nextClinicianParagraphId(section);
    const added = addClinicianParagraph(report, "F-06", "My opinion.", NOW);
    assert.equal(added.paragraphId, predicted);
    const s = added.report.sections.find((x) => x.key === "F-06");
    assert.equal(s?.paragraphs[0].origin, "clinician");
    assert.deepEqual(s?.paragraphs[0].sourceIds, []);
    assert.equal(s?.status, "complete");
    const removed = removeParagraph(added.report, "F-06", predicted, NOW);
    assert.equal(removed.sections.find((x) => x.key === "F-06")?.paragraphs.length, 0);
    assert.equal(removed.sections.find((x) => x.key === "F-06")?.status, "needs_input");
  });

  it("records structured answer changes in the activity log", () => {
    const { report } = drafted();
    assert.equal(answerChangedByClinician(report, "F-04"), false);
    const changed = setStructuredAnswer(report, "F-04", "Yes", "Sarah Reid", NOW);
    assert.equal(changed.sections.find((s) => s.key === "F-04")?.answer?.value, "Yes");
    assert.equal(answerChangedByClinician(changed, "F-04"), true);
    assert.match(changed.activity[changed.activity.length - 1].detail, /^F-04: answer to “B2\. Is the claimant fit for work\?” set to Yes \(was Modified duties\)\.$/);
    assert.equal(setStructuredAnswer(changed, "F-04", "Yes", "Sarah Reid", NOW), changed);
  });

  it("resolves, reopens and acknowledges", () => {
    const { report, form } = drafted();
    const resolved = resolveGap(report, "gap-F-06-ai", "acknowledged", "Not recorded; stated on the form.", "Sarah Reid", NOW);
    assert.equal(resolved.gaps[0].resolution?.kind, "acknowledged");
    assert.equal(resolveGap(report, "gap-F-06-ai", "resolved", "  ", "x", NOW), report);
    const reopened = reopenGap(resolved, "gap-F-06-ai", "Sarah Reid", NOW);
    assert.equal(reopened.gaps[0].resolution, undefined);

    // OPINION_LANGUAGE on edited text: the reason also goes on the paragraph.
    const template = formToTemplate(form);
    const edited = editParagraph(report, "F-03", "F-03-p1", "On 18/03/2026 he reported a lifting injury; he will make a full recovery.", NOW);
    const flags = validateReport(edited, template).flags;
    const opinion = flags.find((f) => f.code === "OPINION_LANGUAGE");
    assert.ok(opinion, "expected an OPINION_LANGUAGE flag on the edited text");
    const acked = acknowledgeFlag({ ...edited, flags }, opinion.id, "My own opinion from my assessment.", "Sarah Reid", NOW);
    assert.equal(acked.sections.find((s) => s.key === "F-03")?.paragraphs[0].ackReason, "My own opinion from my assessment.");
    const after = validateReport(acked, template).flags.find((f) => f.code === "OPINION_LANGUAGE");
    assert.ok(after?.acknowledged);
  });
});

describe("approval", () => {
  it("does not change the fingerprinted content, and locks the report", async () => {
    const { report } = drafted();
    const receipt: SignReceipt = {
      reportId: report.id,
      tenantId: "demo",
      contentSha256: await reportFingerprint(report),
      signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
      signedAt: NOW.toISOString(),
      statementAccepted: true,
      attestations: ["x"],
      mac: "test",
    };
    const approved = markApproved(report, receipt, [], { isForm: true, now: NOW });
    assert.equal(approved.status, "signed");
    assert.equal(await reportFingerprint(approved), receipt.contentSha256);
    assert.equal(approved.activity[approved.activity.length - 1].action, "approved");

    // A signed report ignores content edits.
    assert.equal(reviewReducer(approved, { type: "editParagraph", key: "F-03", paragraphId: "F-03-p1", text: "changed" }), approved);
    assert.equal(reviewReducer(approved, { type: "setAnswer", key: "F-04", value: "No", actor: "x" }), approved);
    // Activity (downloads, filing) is still recorded.
    const logged = reviewReducer(approved, { type: "activity", action: "filed", detail: "Saved", actor: "Sarah Reid" });
    assert.equal(logged.activity.length, approved.activity.length + 1);
    assert.equal(await reportFingerprint(logged), receipt.contentSha256);
  });
});

describe("labels and options", () => {
  it("formats citation chips and maps citations to questions", () => {
    const { report } = drafted();
    assert.equal(citationLabel("N-001", report.bundleSnapshot), "N-001 · 18/03");
    assert.equal(citationLabel("FACT-attendance", report.bundleSnapshot), "Attendance record");
    assert.equal(citationLabel("FACT-outcomes-QuickDASH", report.bundleSnapshot), "QuickDASH scores");
    assert.equal(citationLabel("REG", report.bundleSnapshot), "Registration");
    const by = citationsBySource(report);
    assert.deepEqual(by.get("N-001"), ["F-03"]);
    assert.deepEqual(by.get("REG"), ["F-01", "F-02"]);
  });

  it("offers the printed options for yes/no and single choice", () => {
    assert.deepEqual(answerOptions({ answerType: "yes_no", options: ["Yes", "No"] }), [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ]);
    assert.deepEqual(answerOptions({ answerType: "yes_no" }).map((o) => o.value), [true, false]);
    assert.deepEqual(answerOptions({ answerType: "single_choice", options: ["A", "B"] }).map((o) => o.value), ["A", "B"]);
  });
});

describe("gap resolution never claims a clinician answer that does not exist", () => {
  it("an opinion gap with only an AI draft or nothing cannot be 'resolved' – only acknowledged with a reason", () => {
    const { report } = drafted();
    const gap = report.gaps.find((g) => g.id === "gap-F-06-ai")!;
    assert.equal(answeredByPerson(report, "F-06"), false);
    const opts = gapResolutionOptions(report, gap, "Sarah Reid");
    assert.equal(opts.canResolve, false);
    assert.equal(opts.prefill, "");
    assert.ok(opts.hint && /write your opinion/i.test(opts.hint));

    // An AI-drafted paragraph is not a clinician answer either.
    const aiOnly = { ...report, sections: report.sections.map((s) => (s.key === "F-06" ? { ...s, paragraphs: [{ id: "F-06-p1", text: "The record notes good progress.", sourceIds: ["N-002"], origin: "ai" as const }] } : s)) };
    assert.equal(gapResolutionOptions(aiOnly, gap, "Sarah Reid").canResolve, false);
  });

  it("once the clinician writes the answer, 'Mark resolved' is offered and says who answered", () => {
    const { report } = drafted();
    const gap = report.gaps.find((g) => g.id === "gap-F-06-ai")!;
    const added = addClinicianParagraph(report, "F-06", "In my opinion she will recover fully within 12 months.", NOW).report;
    assert.equal(answeredByPerson(added, "F-06"), true);
    const opts = gapResolutionOptions(added, gap, "Sarah Reid");
    assert.equal(opts.canResolve, true);
    assert.equal(opts.prefill, "Answered on the form by Sarah Reid.");
  });

  it("a structured opinion answer counts only when a person set it", () => {
    const { report } = drafted();
    const gap = { id: "gap-F-04-x", sectionKey: "F-04", issue: "Check the answer.", suggestedQuestion: "", relatedNoteIds: [], raisedBy: "system" as const };
    assert.equal(gapResolutionOptions(report, gap, "Tom Ellis").canResolve, false, "the AI proposed 'Modified duties'");
    const set = setStructuredAnswer(report, "F-04", "Yes", "Tom Ellis", NOW);
    assert.equal(gapResolutionOptions(set, gap, "Tom Ellis").canResolve, true);
  });

  it("other gaps can be resolved, but only with the person's own words of a useful length", () => {
    const { report } = drafted();
    const gap = { id: "gap-F-03-x", sectionKey: "F-03", issue: "Mechanism unclear.", suggestedQuestion: "", relatedNoteIds: [], raisedBy: "ai" as const };
    const opts = gapResolutionOptions(report, gap, "Sarah Reid");
    assert.equal(opts.canResolve, true);
    assert.equal(opts.prefill, "");
    assert.equal(opts.minLength, MIN_GAP_REASON);
  });
});

describe("supersedeAcknowledgedGaps", () => {
  it("a value entered after a 'left blank' acknowledgement replaces the acknowledgement", () => {
    const { report } = drafted();
    const acked = resolveGap(report, "gap-F-06-ai", "acknowledged", "Left blank for the office to add later.", "Sarah Reid", NOW);
    // Nothing entered yet: the acknowledgement stays.
    assert.equal(supersedeAcknowledgedGaps(acked, "F-06", "Sarah Reid", NOW), acked);
    const typed = addClinicianParagraph(acked, "F-06", "In my opinion he will keep improving.", NOW).report;
    const next = supersedeAcknowledgedGaps(typed, "F-06", "Sarah Reid", NOW);
    const gap = next.gaps.find((g) => g.id === "gap-F-06-ai");
    assert.equal(gap?.resolution?.kind, "resolved");
    assert.match(gap?.resolution?.text ?? "", /^Answered on the form by Sarah Reid \(replaces “Left blank for the office to add later\.”\)\.$/);
    assert.match(next.activity[next.activity.length - 1].detail, /no longer applies/);
    // The reducer does it when the edit is logged.
    const viaReducer = reviewReducer(typed, { type: "logEdit", key: "F-06", actor: "Sarah Reid" });
    assert.equal(viaReducer.gaps.find((g) => g.id === "gap-F-06-ai")?.resolution?.kind, "resolved");
  });
});
