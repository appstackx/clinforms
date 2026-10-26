/**
 * bh2 WD: assembly safety with hand-written DraftOutput – meta-wording held back (never dropped), no band or opinion
 * tick, grade scales never ticked, the time point held back by citation date, every gap with a kind, the approver as
 * voice owner, and nothing reidentified or edited sent to the drafting call. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "../core/computed-facts";
import { formToTemplate } from "../core/forms";
import type { FormDefinition, FormDraftGroupOutput, FormField } from "../core/types";
import { TEST_FACTS_DATE, testBundle } from "../core/validation/test-fixtures";
import { assembleDraft } from "./assemble";
import { buildFormPromptParts, FORM_DRAFT_PROMPT_VERSION } from "./form-prompts";

const AT = "2026-10-06T09:00:00.000Z";
const f = (id: string, label: string, rest: Partial<FormField> & Pick<FormField, "answerType" | "fillSource">): FormField => ({
  id,
  label,
  guidance: "",
  anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` },
  required: false,
  confidence: "high",
  ...rest,
});
function form(title: string): FormDefinition {
  return {
    id: "frm_asm",
    tenantId: "demo",
    referrer: { name: "Example Case Services (fictional)", type: "mlc" },
    title,
    file: { fileName: "asm.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "c".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields: [
      f("F-10", "Prognosis", { answerType: "long_text", fillSource: { kind: "clinician_opinion" }, anchor: { kind: "docx", target: "after_paragraph", blockId: "p10" } }),
      f("F-11", "Expected recovery time", { answerType: "single_choice", options: ["0-3 months", "4-6 months", "Over 6 months"], fillSource: { kind: "clinician_opinion" } }),
      f("F-12", "Pain now (0-10)", { answerType: "short_text", fillSource: { kind: "notes_narrative" } }),
      f("F-13", "Severity", { answerType: "single_choice", options: ["Mild", "Moderate", "Severe"], fillSource: { kind: "notes_narrative" } }),
      f("F-14", "Current medication", { answerType: "long_text", fillSource: { kind: "notes_narrative" }, anchor: { kind: "docx", target: "after_paragraph", blockId: "p14" } }),
      f("F-15", "Objective findings", { answerType: "long_text", fillSource: { kind: "notes_narrative" }, anchor: { kind: "docx", target: "after_paragraph", blockId: "p15" } }),
    ],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

function assemble(fm: FormDefinition, output: FormDraftGroupOutput, approver: { name: string; hcpc: string } | null = { name: "Sarah Reid", hcpc: "PH-DEMO-01" }) {
  const bundle = testBundle(); // N-001 Sarah Reid 18/03/2026 (initial assessment), N-002 Tom Ellis 06/05/2026 (discharge)
  const keys = Array.from(new Set([...output.sections.map((s) => s.sectionKey), ...output.gaps.map((g) => g.sectionKey)]));
  return assembleDraft({
    template: formToTemplate(fm),
    bundle,
    instructingParty: bundle.referral,
    sectionKeys: keys,
    computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }),
    output,
    meta: { mode: "demo_prewritten", sectionKeys: keys, at: AT, promptVersion: FORM_DRAFT_PROMPT_VERSION },
    form: fm,
    idSeed: "asm",
    approver,
  });
}

test("S-META: meta-wording is held back as an audited gap; the rest of the answer and its checks stay", () => {
  const res = assemble(form("Treatment Summary Report"), {
    sections: [{ sectionKey: "F-15", answer: "", paragraphs: [{ text: "Lumbar movement was full and pain-free at discharge. These are recorded-opinion questions.", sourceIds: ["N-002"], basis: "clinician_observed" }] }],
    gaps: [],
  });
  assert.equal(res.sections[0].paragraphs[0].text, "Lumbar movement was full and pain-free at discharge.");
  const gap = res.gaps.find((g) => g.kind === "meta_held_back");
  assert.ok(gap);
  assert.match(gap.issue, /^Drafted text held back – check it: “These are recorded-opinion questions\.”/);
  assert.deepEqual(gap.relatedNoteIds, ["N-002"]);
  // The ordinary phrase is kept.
  const kept = assemble(form("Treatment Summary Report"), {
    sections: [{ sectionKey: "F-10", answer: "", paragraphs: [{ text: "Tom Ellis's recorded opinion on 06/05/2026 was a phased return to normal duties over 2 weeks.", sourceIds: ["N-002"], basis: "clinician_opinion_recorded" }] }],
    gaps: [],
  });
  assert.equal(kept.sections[0].paragraphs.length, 1);
  assert.deepEqual(kept.gaps, []);
});

test("S-BAND / S-SCALE: no band tick or one-click on an opinion box; a grade scale is never ticked", () => {
  const res = assemble(form("Treatment Summary Report"), {
    sections: [
      { sectionKey: "F-11", answer: "0-3 months", paragraphs: [{ text: "Tom Ellis recorded a review in 6 weeks.", sourceIds: ["N-002"], basis: "clinician_opinion_recorded" }] },
      { sectionKey: "F-13", answer: "Moderate", paragraphs: [{ text: "Sarah Reid recorded moderate pain on stairs.", sourceIds: ["N-001"], basis: "clinician_observed" }] },
    ],
    gaps: [],
  });
  for (const key of ["F-11", "F-13"]) {
    const s = res.sections.find((x) => x.key === key)!;
    assert.equal(s.answer?.value, null, key);
    const g = res.gaps.find((x) => x.sectionKey === key)!;
    assert.equal(g.kind, "band");
    assert.equal(g.suggestedAnswer, undefined, `${key}: no one-click`);
  }
});

test("S-ASAT: on a discharge form a 'now' value from the first note is held back; on an initial assessment form a later note is", () => {
  const dc = assemble(form("Treatment Summary Report"), {
    sections: [{ sectionKey: "F-12", answer: "", paragraphs: [{ text: "7/10 at worst", sourceIds: ["N-001"], basis: "patient_reported" }] }],
    gaps: [],
  });
  assert.deepEqual(dc.sections[0].paragraphs, []);
  assert.match(dc.gaps[0].issue, /^From the note of 18\/03\/2026 – check it at the latest note \(06\/05\/2026\)/);
  assert.equal(dc.gaps[0].kind, "record_value");
  const fresh = assemble(form("Treatment Summary Report"), {
    sections: [{ sectionKey: "F-12", answer: "", paragraphs: [{ text: "2/10 at worst", sourceIds: ["N-002"], basis: "patient_reported" }] }],
    gaps: [],
  });
  assert.equal(fresh.sections[0].paragraphs[0].text, "2/10 at worst");

  const ia = assemble(form("Initial Assessment Report"), {
    sections: [{ sectionKey: "F-14", answer: "", paragraphs: [{ text: "He was working amended duties.", sourceIds: ["N-002"], basis: "patient_reported" }] }],
    gaps: [],
  });
  assert.deepEqual(ia.sections[0].paragraphs, []);
  assert.match(ia.gaps[0].issue, /^From a later note of 06\/05\/2026, not the record as it stood on the assessment day \(18\/03\/2026\)/);
});

test("every gap carries a kind", () => {
  const res = assemble(form("Treatment Summary Report"), {
    sections: [{ sectionKey: "F-14", answer: "", paragraphs: [] }],
    gaps: [{ sectionKey: "F-10", issue: "No clinician recorded a prognosis.", suggestedQuestion: "What is your prognosis?", relatedNoteIds: ["N-002"] }],
  });
  assert.ok(res.gaps.length >= 2);
  for (const g of res.gaps) assert.ok(g.kind, `${g.sectionKey}: ${g.issue}`);
});

test("the approver is the voice owner; with neither approver nor author nothing is guessed (and nothing is rewritten)", () => {
  const text = "On 06/05/2026 I recorded that lumbar movement was full and pain-free.";
  const asTom = assemble(form("Treatment Summary Report"), { sections: [{ sectionKey: "F-15", answer: "", paragraphs: [{ text, sourceIds: ["N-002"], basis: "clinician_observed" }] }], gaps: [] }, { name: "Tom Ellis", hcpc: "PH-DEMO-02" });
  assert.equal(asTom.sections[0].paragraphs[0].text, text, "kept as drafted");
  assert.ok(!asTom.flags.some((x) => x.code === "OTHER_CLINICIAN_VOICE"), "Tom Ellis's own note in his own voice");
  const asSarah = assemble(form("Treatment Summary Report"), { sections: [{ sectionKey: "F-15", answer: "", paragraphs: [{ text, sourceIds: ["N-002"], basis: "clinician_observed" }] }], gaps: [] });
  assert.ok(asSarah.flags.some((x) => x.code === "OTHER_CLINICIAN_VOICE" && x.sectionKey === "F-15"), "Tom Ellis's note in Sarah Reid's first person");
  const nobody = assemble(form("Treatment Summary Report"), { sections: [{ sectionKey: "F-15", answer: "", paragraphs: [{ text, sourceIds: ["N-002"], basis: "clinician_observed" }] }], gaps: [] }, null);
  assert.equal(nobody.sections[0].paragraphs[0].text, text, "never made plain from a guessed owner");
});

test("nothing reidentified or edited reaches the drafting call: the episode block is pseudonymised and built from the record only", () => {
  const bundle = testBundle();
  const fm = form("Treatment Summary Report");
  const parts = buildFormPromptParts({ form: fm, template: formToTemplate(fm), bundle, instructingParty: bundle.referral, sectionKeys: ["F-15"], computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } });
  const all = `${parts.system}\n${parts.template}\n${parts.episode}\n${parts.final}`;
  for (const secret of ["Owen", "Testcase", "1985-05-14", "14/05/1985", "1 Test Street"]) assert.ok(!all.includes(secret), `${secret} is never sent`);
  assert.match(parts.final, /The clinician who will approve this form: Sarah Reid \(PH-DEMO-01\)/);
  assert.doesNotMatch(parts.template, /kind="(?:recorded opinion only|narrative from the record)"/, "question kinds are tags the drafting never writes in prose");
  assert.match(parts.system, /12\. Time bands and grades\./);
  assert.match(parts.system, /13\. Time point\./);
});

test("B2-5: a yes-or-no question answered in words is never answered with a list of facts nobody called by that name", () => {
  const fm = form("Initial Assessment Report");
  fm.fields.push(f("F-20", "Are there obstacles to getting better?", { answerType: "long_text", guidance: "Give details – or “No”.", fillSource: { kind: "notes_narrative" }, anchor: { kind: "docx", target: "after_paragraph", blockId: "p20" } }));
  const res = assemble(fm, { sections: [{ sectionKey: "F-20", answer: "", paragraphs: [{ text: "He lives with his partner and was off work.", sourceIds: ["N-001"], basis: "patient_reported" }] }], gaps: [] });
  assert.deepEqual(res.sections[0].paragraphs, []);
  assert.match(res.gaps[0].issue, /needs a Yes or a No first\. Related details are in the notes \(“He lives with his partner and was off work\.”\)/);
  const yes = assemble(fm, { sections: [{ sectionKey: "F-20", answer: "", paragraphs: [{ text: "No – none were found.", sourceIds: ["N-001"], basis: "record" }] }], gaps: [] });
  assert.equal(yes.sections[0].paragraphs.length, 1);
});
