/**
 * Blue Heart fix round 3 – assembling drafted answers (no live call):
 * - B2-5: a yes-or-no question answered in words, drafted as a list of facts, is left to the clinician;
 * - B2-8: "To return to returning to work…" – the restated verb is taken off;
 * - B2-9: reasoning and internal terms in a gap ("… wait, the 4th…", "These are recorded-opinion questions.");
 * - B2-10: a duration recorded in weeks against printed time bands – the band that contains it is offered;
 * - B2-16: a "…/10" value drafted with a trailing attribution keeps the value only;
 * - B2-18: "[CLAIMANT] told me … that [CLAIMANT] was working" – the second mention is "he".
 * Texts as drafted on Blue Heart's forms in the round-2 test run; fictional record (test fixtures).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftsResponseSchema } from "../api/contract";
import { computeFacts } from "../core/computed-facts";
import { bandFor, durationBands, recordedDuration } from "../core/duration-bands";
import { formToTemplate } from "../core/forms";
import type { FormDefinition, FormDraftGroupOutput, FormField, GenerationMeta } from "../core/types";
import { TEST_FACTS_DATE, testBundle } from "../core/validation/test-fixtures";
import { assembleDraft, hasMetaWording } from "./assemble";
import { FORM_DRAFT_PROMPT_VERSION, FORM_DRAFT_SYSTEM_PROMPT, buildFormBlock } from "./form-prompts";

const AT = "2026-10-25T09:00:00.000Z";

const field = (id: string, label: string, rest: Partial<FormField>): FormField => ({
  id,
  label,
  guidance: "",
  answerType: "short_text",
  anchor: { kind: "docx", target: "after_paragraph", blockId: `p${id.slice(2)}` },
  fillSource: { kind: "notes_narrative" },
  required: false,
  confidence: "high",
  ...rest,
});

const FORM: FormDefinition = {
  id: "frm_asm3",
  tenantId: "demo",
  referrer: { name: "Proclaim Care (fictional)", type: "mlc" },
  title: "End of Treatment Report",
  file: { fileName: "eots.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "f".repeat(64), sizeBytes: 1 },
  kind: "docx",
  fields: [
    field("F-09", "Benefits of treatment – activities to return to", {
      anchor: { kind: "docx", target: "replace_placeholder", blockId: "t3.r1.c0.p0", placeholderText: "…" },
      guidance: "The activities the claimant wants to return to (their goals as recorded at the assessment), in a few words; it replaces “…” in “To return to … with 75% reduced difficulty…”.",
    }),
    field("F-16", "Pain score (VAS)", { anchor: { kind: "docx", target: "replace_placeholder", blockId: "t1.r2.c1.p0", placeholderText: "/10" }, guidance: "The pain score, written as “N/10” in place of the printed “/10”." }),
    field("F-24", "Session date 4", { answerType: "date" }),
    field("F-36", "If symptoms are not fully resolved: expected time to that recovery", { answerType: "single_choice", options: ["0-3 MONTHS", "4-6 MONTHS", "7-9 MONTHS", "10-12 MONTHS"], fillSource: { kind: "clinician_opinion" } }),
    field("F-47", "Is there any evidence if psychosocial factors in this case?", { answerType: "long_text", guidance: "Psychosocial factors recorded (attitudes, beliefs, mood, social, work) – or “No”: it replaces the printed default “No”." }),
    field("F-48", "Any additional comments.", { answerType: "long_text" }),
  ],
  status: "confirmed",
  analysis: { mode: "demo_prewritten", promptVersion: "test", at: AT, warnings: [] },
  confirmed: { by: "Test", at: AT },
  createdAt: AT,
  updatedAt: AT,
};

const META: GenerationMeta = { mode: "demo_prewritten", sectionKeys: [], at: AT, promptVersion: FORM_DRAFT_PROMPT_VERSION };

function assemble(output: FormDraftGroupOutput, keys: string[]) {
  const bundle = testBundle();
  return DraftsResponseSchema.parse(
    assembleDraft({ template: formToTemplate(FORM), bundle, instructingParty: bundle.referral, sectionKeys: keys, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), output, meta: { ...META, sectionKeys: keys }, form: FORM, idSeed: "r3" }),
  );
}

test("B2-8 and B2-16: a compact value without the printed verb or a trailing attribution (Medcare IA F-09, Proclaim IA F-16)", () => {
  const res = assemble(
    {
      sections: [
        { sectionKey: "F-09", answer: "", paragraphs: [{ text: "returning to work as a delivery driver", sourceIds: ["N-001"], basis: "patient_reported" }] },
        { sectionKey: "F-16", answer: "", paragraphs: [{ text: "7/10 at worst, as recorded by Sarah Reid using the Numeric Pain Rating Scale", sourceIds: ["N-001"], basis: "clinician_observed" }] },
      ],
      gaps: [],
    },
    ["F-09", "F-16"],
  );
  assert.equal(res.sections[0].paragraphs[0].text, "work as a delivery driver");
  assert.equal(res.sections[1].paragraphs[0].text, "7/10 at worst");
  assert.deepEqual(res.sections[1].paragraphs[0].sourceIds, ["N-001"], "the citation keeps who recorded it");
  // The prompt says so for the blank.
  assert.match(buildFormBlock(FORM, formToTemplate(FORM)), /which already starts "To return to": give what follows it – for "To return to …" the activities themselves/);
});

test("B2-9: reasoning and internal terms never reach a gap – the plain gap instead (CLM Discharge F-24, 10Bridge IA F-49)", () => {
  assert.equal(hasMetaWording("Only four attended sessions are recorded, so there is no 4th... wait, the 4th attended session after the assessment is 13/10/2026"), true);
  assert.equal(hasMetaWording("These are recorded-opinion questions. Priya Shah's initial assessment records…"), true);
  assert.equal(hasMetaWording("Actually, the note says otherwise."), true);
  for (const ok of ["She is on a waiting list for an MRI scan.", "The 4th session was on 13/10/2026.", "No clinician recorded an opinion on recovery."]) assert.equal(hasMetaWording(ok), false, ok);
  const res = assemble(
    {
      sections: [{ sectionKey: "F-24", answer: "", paragraphs: [] }, { sectionKey: "F-48", answer: "", paragraphs: [{ text: "Hmm, actually, no further comments.", sourceIds: ["N-002"], basis: "record" }] }],
      gaps: [
        { sectionKey: "F-24", issue: "Only four attended sessions after the initial assessment are recorded, so there is no 4th... wait, the 4th attended session after the assessment is 13/10/2026.", suggestedQuestion: "Which date?", relatedNoteIds: ["N-002"] },
        { sectionKey: "F-48", issue: "These are recorded-opinion questions. Nothing else was recorded.", suggestedQuestion: "Anything to add?", relatedNoteIds: [] },
      ],
    },
    ["F-24", "F-48"],
  );
  const gap24 = res.gaps.find((g) => g.sectionKey === "F-24");
  assert.equal(gap24?.issue, "The record does not answer “Session date 4”.");
  assert.deepEqual(gap24?.relatedNoteIds, ["N-002"]);
  assert.equal(res.gaps.find((g) => g.sectionKey === "F-48")?.issue, "The record does not answer “Any additional comments”.");
  assert.deepEqual(res.sections.find((s) => s.key === "F-48")?.paragraphs, [], "a drafted paragraph of reasoning is not kept");
  assert.match(FORM_DRAFT_SYSTEM_PROMPT, /Gap wording is read by the clinician: plain, finished sentences about the patient's record – never your reasoning, second thoughts or corrections/);
});

test("B2-10: printed time bands – a recorded 4–6 weeks is within “0-3 MONTHS”, and only that band is offered (Proclaim EOTS F-36)", () => {
  const bands = ["0-3 MONTHS", "4-6 MONTHS", "7-9 MONTHS", "10-12 MONTHS"];
  assert.equal(durationBands(bands)?.length, 4);
  assert.equal(durationBands(["Yes", "No"]), null);
  assert.deepEqual(recordedDuration("should settle within 4–6 weeks"), { lo: 0, hi: 42, text: "4–6 weeks" });
  assert.deepEqual(bandFor(bands, "settle within 4–6 weeks"), { option: "0-3 MONTHS", duration: "4–6 weeks" });
  assert.deepEqual(bandFor(bands, "about 5 months"), { option: "4-6 MONTHS", duration: "5 months" });
  assert.equal(bandFor(bands, "3–4 months"), null, "across two bands: not decided for the clinician");
  const res = assemble(
    {
      sections: [{ sectionKey: "F-36", answer: "", paragraphs: [] }],
      gaps: [
        {
          sectionKey: "F-36",
          issue: "On 16/09/2026 Sarah Reid recorded that in her opinion the remaining occasional stiffness should settle within 4–6 weeks with the home exercise programme. This is a timescale of 4–6 weeks, which does not match the printed options (0-3 MONTHS, 4-6 MONTHS, 7-9 MONTHS, 10-12 MONTHS), so the option cannot be chosen from the record.",
          suggestedQuestion: "Sarah Reid's discharge note of 16/09/2026 recorded that the remaining occasional stiffness should settle within 4–6 weeks. Which option do you wish to tick: 0-3 MONTHS or 4-6 MONTHS?",
          relatedNoteIds: ["N-002"],
        },
      ],
    },
    ["F-36"],
  );
  const gap = res.gaps[0];
  assert.doesNotMatch(gap.issue, /does not match/);
  assert.match(gap.issue, /4–6 weeks is within the printed “0-3 MONTHS”\.$/);
  assert.equal(gap.suggestedQuestion, "Is “0-3 MONTHS” the right option? The note records 4–6 weeks, which is within it – tick it if that is your opinion, or choose another option.");
  assert.doesNotMatch(gap.suggestedQuestion, /4-6 MONTHS/);
  assert.equal(gap.suggestedAnswer, "0-3 MONTHS", "one click – the clinician's choice");
  assert.deepEqual(res.sections[0].answer, { kind: "choice", value: null }, "never ticked for them");
  assert.match(FORM_DRAFT_SYSTEM_PROMPT, /4–6 weeks is within "0-3 MONTHS"\. Never say such a duration does not fit the options/);
});

test("B2-5: a yes-or-no question drafted as a list of facts is the clinician's to answer (CLM Discharge F-47)", () => {
  const res = assemble(
    {
      sections: [{ sectionKey: "F-47", answer: "", paragraphs: [{ text: "Mrs Whitlock lives with her partner, works 12-hour shifts and was sleeping poorly.", sourceIds: ["N-001"], basis: "patient_reported" }] }],
      gaps: [],
    },
    ["F-47"],
  );
  assert.deepEqual(res.sections[0].paragraphs, [], "no list printed as “psychosocial factors”");
  assert.match(res.gaps[0].issue, /^“Is there any evidence if psychosocial factors in this case\?” is answered Yes or No\. The notes record related details/);
  // A clear "Yes – …" or "No" is kept.
  const yes = assemble({ sections: [{ sectionKey: "F-47", answer: "", paragraphs: [{ text: "No.", sourceIds: ["N-001"], basis: "record" }] }], gaps: [] }, ["F-47"]);
  assert.equal(yes.sections[0].paragraphs[0].text, "No.");
  assert.match(buildFormBlock(FORM, formToTemplate(FORM)), /It is a yes-or-no question answered in words: start with "Yes – "/);
  assert.match(FORM_DRAFT_SYSTEM_PROMPT, /13\. Barriers, psychosocial factors and yellow flags\. A box about barriers to recovery or psychosocial factors lists only what a clinician recorded as such/);
});

test("B2-18: “[CLAIMANT] told me … that [CLAIMANT] was working” – the second mention is “he” (Ascenti Discharge F-47)", () => {
  const res = assemble(
    { sections: [{ sectionKey: "F-48", answer: "", paragraphs: [{ text: "[CLAIMANT] told me on 06/05/2026 that [CLAIMANT] was working amended duties.", sourceIds: ["N-002"], basis: "patient_reported" }] }], gaps: [] },
    ["F-48"],
  );
  assert.match(res.sections[0].paragraphs[0].text, /^Mr Testcase told .* on 06\/05\/2026 that he was working amended duties\.$/);
});
