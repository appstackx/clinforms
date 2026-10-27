/**
 * bh2 fix round 1, R1T-WF-L1 (TPN-L5): the portal summary PDF's Appendix A listed the sample patients' review notes
 * (headed "Review") as "Clinical note – Follow-up". The root was the notes import: the general notes reader reads
 * "Review" as the type follow_up (the record has no "review" type) and the heading's words were dropped on confirm.
 *
 * Now the confirm step keeps the heading's own type words (Note.heading, "Review"), and the records-reviewed list
 * (every report's and summary PDF's Appendix A, docgen/view-model.ts) names the note by them; a record without them
 * (stored earlier, or another import) keeps its type's label, exactly as before. Staff changing the type in the review
 * wins over the heading.
 *
 * Fictional data only: the corpus clinic's Owen Testcase, Sarah Reid, Tom Ellis.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { headingTypeWords, readGeneralNotes, textToBlocks } from "../connectors/file-import/general-notes";
import { readPrintedNotes } from "../connectors/file-import/pdf-notes";
import { bundleFromReview } from "../connectors/file-import/review-bundle";
import { EXAMPLE_PORTAL_QUESTIONS, createQuestionSet, parsePortalQuestions } from "../core/question-set";
import { createFormReport } from "../core/report-factory";
import { formToTemplate } from "../core/forms";
import { EpisodeBundleSchema, NoteSchema, ReportSchema } from "../core/schemas";
import type { EpisodeBundle, FormDefinition, NoteType, Report } from "../core/types";
import { CORPUS_TENANT } from "../core/validation/__corpus__/harness/fixtures";
import { renderQuestionSummaryPdf } from "./question-summary";
import { buildViewModel, noteKindLabel } from "./view-model";

const NOW = new Date("2026-10-22T09:00:00.000Z");

const NOTES = [
  "Name: Owen Testcase (fictional)",
  "Date of birth: 14/05/1984",
  "Case manager: Corpus Case Management (fictional)",
  "Reference: CORPUS-REF-02",
  "",
  "01/09/2026 10:00   Initial assessment",
  "Practitioner: Sarah Reid (PH-DEMO-01)",
  "S: Right shoulder ache after lifting boxes at work.",
  "A: Rotator cuff strain.",
  "",
  "08/09/2026 10:00   Follow-up",
  "Practitioner: Sarah Reid (PH-DEMO-01)",
  "S: Ache easing.",
  "",
  "15/09/2026 10:00   Review",
  "Practitioner: Sarah Reid (PH-DEMO-01)",
  "S: Lifting light boxes again.",
  "",
  "22/09/2026 10:00",
  "Practitioner: Tom Ellis (PH-DEMO-02)",
  "Type: Re-assessment (45 min)",
  "S: Full range of movement.",
  "",
  "29/09/2026 10:00   Discharge",
  "Practitioner: Sarah Reid (PH-DEMO-01)",
  "P: Discharged with a home programme.",
].join("\n");

function importNotes(text = NOTES, typeChanges: Record<string, NoteType> = {}): EpisodeBundle {
  const read = readGeneralNotes({ format: "text", blocks: textToBlocks(text), now: NOW });
  assert.ok(read.ok, read.ok ? "" : read.message);
  const review = { ...read.review, entries: read.review.entries.map((e) => (typeChanges[e.key] ? { ...e, type: typeChanges[e.key] } : e)) };
  const built = bundleFromReview(review, { tenantId: CORPUS_TENANT, now: NOW });
  assert.ok(built.ok, built.ok ? "" : JSON.stringify(built.issues));
  return built.bundle;
}

async function portalReport(bundle: EpisodeBundle): Promise<{ report: Report; form: FormDefinition }> {
  const form = { ...(await createQuestionSet({ referrer: { name: "Sample Insurer Portal (fictional)", type: "insurer" }, questions: parsePortalQuestions(EXAMPLE_PORTAL_QUESTIONS).questions, tenantId: CORPUS_TENANT, now: NOW, id: "form_wf_heading" })), status: "confirmed" as const };
  const report = createFormReport({ form, bundle, instructingParty: { type: bundle.referral.type, name: bundle.referral.name, reference: bundle.referral.reference, contactName: bundle.referral.contactName, address: bundle.referral.address }, computedFacts: [], author: null, approver: null, id: "rpt_wf_heading", now: NOW });
  return { report: ReportSchema.parse(report), form };
}

/** Appendix A of the rendered summary PDF, one line per row (wrapping aside). */
async function appendixLines(report: Report, form: FormDefinition): Promise<string[]> {
  const out = await renderQuestionSummaryPdf(report, form, formToTemplate(form), { now: NOW });
  const read = await readPrintedNotes(Buffer.from(out.bytes).toString("base64"));
  const lines = read.pageLines.flat().map((l) => l.replace(/\s+/g, " ").trim());
  const start = lines.findIndex((l) => l.startsWith("Appendix A"));
  assert.ok(start >= 0, "the PDF has Appendix A");
  return lines.slice(start);
}

test("the import keeps a note's own type words; the summary PDF's Appendix A names the review note 'Review', not 'Follow-up'", async () => {
  const bundle = importNotes();
  assert.deepEqual(
    bundle.notes.map((n) => [n.date, n.type, n.heading ?? null]),
    [
      ["2026-09-01", "initial_assessment", "Initial assessment"],
      ["2026-09-08", "follow_up", "Follow-up"],
      ["2026-09-15", "follow_up", "Review"],
      ["2026-09-22", "follow_up", "Re-assessment"],
      ["2026-09-29", "discharge", "Discharge"],
    ],
    "the type is unchanged (drafting, counts and checks read it); the heading's words are kept as written, the duration taken off",
  );
  const { report, form } = await portalReport(bundle);
  const lines = await appendixLines(report, form);
  const row = (date: string) => lines.find((l) => l.startsWith(date)) ?? "";
  assert.match(row("15/09/2026"), /Clinical note – Review\b/);
  assert.match(row("22/09/2026"), /Clinical note – Re-assessment\b/);
  assert.match(row("08/09/2026"), /Clinical note – Follow-up\b/);
  assert.match(row("01/09/2026"), /Clinical note – Initial assessment\b/);
  assert.match(row("29/09/2026"), /Clinical note – Discharge\b/);
  assert.doesNotMatch(row("15/09/2026"), /Follow-up/);
  assert.doesNotMatch(row("22/09/2026"), /Follow-up/);
});

test("staff changed the type in the review: the list shows their type (the heading's words no longer name it)", () => {
  const bundle = importNotes(NOTES, { "E-3": "discharge" });
  const review = bundle.notes.find((n) => n.date === "2026-09-15")!;
  assert.equal(review.type, "discharge");
  assert.equal(review.heading, undefined);
  assert.equal(noteKindLabel(review), "Discharge");
});

test("a record without heading words (stored before this release, or another import) keeps its type's label – Word and PDF alike", async () => {
  const bundle = importNotes();
  const legacy: EpisodeBundle = EpisodeBundleSchema.parse({ ...bundle, notes: bundle.notes.map(({ heading: _heading, ...n }) => n) });
  const { report, form } = await portalReport(legacy);
  const vm = buildViewModel(report, legacy, formToTemplate(form), { now: NOW });
  assert.deepEqual(
    vm.recordsReviewed.filter((r) => r.description.startsWith("Clinical note")).map((r) => `${r.date} ${r.description}`),
    [
      "01/09/2026 Clinical note – Initial assessment",
      "08/09/2026 Clinical note – Follow-up",
      "15/09/2026 Clinical note – Follow-up",
      "22/09/2026 Clinical note – Follow-up",
      "29/09/2026 Clinical note – Discharge",
    ],
    "unchanged from production for a record without Note.heading",
  );
  assert.equal(noteKindLabel({ type: "follow_up", heading: " review   appointment " }), "Review appointment", "spacing flattened, first letter capitalised");
});

test("headingTypeWords reads the type words the reader read the type from – and nothing else", () => {
  assert.equal(headingTypeWords("13/10/2026 10:30   Review", "follow_up"), "Review");
  assert.equal(headingTypeWords("13/10/2026 10:30 – Follow Up (30 min) – Sarah Reid (PH-DEMO-01)", "follow_up"), "Follow Up");
  assert.equal(headingTypeWords("13/10/2026 10:30\nPractitioner: Tom Ellis (PH-DEMO-02)\nType: Re-assessment", "follow_up"), "Re-assessment");
  assert.equal(headingTypeWords("13/10/2026 Telephone review", "telephone"), "Telephone review");
  assert.equal(headingTypeWords("13/10/2026 10:30   Review", "discharge"), null, "staff chose another type");
  assert.equal(headingTypeWords("13/10/2026 10:30\nPractitioner: Tom Ellis (PH-DEMO-02)", "other"), null, "no type words");
  assert.equal(headingTypeWords("13/10/2026 10:30   Clinical notes", "other"), null, "words that name no type");
  assert.equal(headingTypeWords("13/10/2026 Follow-up – reports the knee locked on the stairs twice", "follow_up"), "Follow-up", "the type segment only, never the note's text");
  assert.equal(headingTypeWords("", "follow_up"), null);
  assert.equal(headingTypeWords("not a heading at all", "follow_up"), null);
});

test("Note.heading is optional and bounded (display only)", () => {
  const base = importNotes().notes[2];
  assert.equal(NoteSchema.safeParse({ ...base, heading: undefined }).success, true);
  assert.equal(NoteSchema.safeParse({ ...base, heading: "" }).success, false);
  assert.equal(NoteSchema.safeParse({ ...base, heading: "R".repeat(61) }).success, false);
});
