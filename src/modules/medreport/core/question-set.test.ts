/**
 * Portal question sets (FormKind "questions"): parsing pasted questions, the conservative fill-source
 * classifier, the placeholder file (SHA-256 of the canonical question list) and anchors, the map checks
 * and the template a question set becomes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_ATTESTATIONS, QUESTION_SET_ATTESTATIONS, checkFormDefinition, formAnchorKeys, formToTemplate } from "./forms";
import {
  EXAMPLE_PORTAL_QUESTIONS,
  MAX_PORTAL_QUESTIONS,
  QUESTION_SET_FILE_NAME,
  QUESTION_SET_MIME_TYPE,
  QUESTION_SET_PARSER_VERSION,
  canonicalQuestionList,
  classifyPortalQuestion,
  createQuestionSet,
  inferAnswerType,
  isQuestionAnchor,
  isQuestionSet,
  nextQuestionAnchor,
  parsePortalQuestions,
  questionAnchor,
  questionFields,
  questionSetFile,
  questionSetSha256,
  withQuestionSetFile,
} from "./question-set";
import { FormDefinitionSchema, FormFieldSchema, FormKindSchema } from "./schemas";
import type { FormDefinition } from "./types";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const REFERRER = { name: "Northbridge Health Insurance (fictional)", type: "insurer" as const };

test("the form kind enum gains 'questions' (additive)", () => {
  assert.deepEqual(FormKindSchema.options, ["docx", "pdf_acroform", "pdf_flat", "questions"]);
  assert.equal(isQuestionSet({ kind: "questions" }), true);
  assert.equal(isQuestionSet({ kind: "docx" }), false);
  assert.equal(isQuestionSet(null), false);
});

test("pasted questions: one per line, numbering and bullets removed, # headings, blank lines ignored, CRLF", () => {
  const text = [
    "# Patient details",
    "1. Patient's full name",
    "2) Date of birth",
    "",
    "Q3: Membership number",
    "# Clinical update",
    "• Current symptoms and progress",
    "- Objective findings",
    "a) Pain score",
    "Question 9 - Prognosis",
  ].join("\r\n");
  const parsed = parsePortalQuestions(text);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(
    parsed.questions.map((q) => [q.label, q.section, q.line]),
    [
      ["Patient's full name", "Patient details", 2],
      ["Date of birth", "Patient details", 3],
      ["Membership number", "Patient details", 5],
      ["Current symptoms and progress", "Clinical update", 7],
      ["Objective findings", "Clinical update", 8],
      ["Pain score", "Clinical update", 9],
      ["Prognosis", "Clinical update", 10],
    ],
  );
  // A number that is part of the question is kept.
  assert.equal(parsePortalQuestions("2x weekly exercises completed?").questions[0].label, "2x weekly exercises completed?");
});

test("answer type hints: [date] [yes/no] [number] [long] [short] [choice: …] [tick] and [optional]", () => {
  const parsed = parsePortalQuestions(
    [
      "Expected discharge date [date] [optional]",
      "Is further treatment requested? [Yes/No]",
      "Sessions requested [number]",
      "Treatment plan [long]",
      "Diagnosis [short]",
      "Treatment type [choice: Face to face | Video | Telephone]",
      "Physiotherapist [tick]",
      "Mode [choice: Clinic / Home]",
    ].join("\n"),
  );
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.questions.map((q) => [q.label, q.answerType, q.required, q.hinted, q.options ?? null]),
    [
      ["Expected discharge date", "date", false, true, null],
      ["Is further treatment requested?", "yes_no", true, true, null],
      ["Sessions requested", "number", true, true, null],
      ["Treatment plan", "long_text", true, true, null],
      ["Diagnosis", "short_text", true, true, null],
      ["Treatment type", "single_choice", true, true, ["Face to face", "Video", "Telephone"]],
      ["Physiotherapist", "checkbox", true, true, null],
      ["Mode", "single_choice", true, true, ["Clinic", "Home"]],
    ],
  );
});

test("without a hint the type comes from the wording; unknown hints are kept and warned about", () => {
  assert.equal(inferAnswerType("Date of initial assessment"), "date");
  assert.equal(inferAnswerType("Treatment start date"), "date");
  assert.equal(inferAnswerType("Number of sessions attended to date"), "number");
  assert.equal(inferAnswerType("How many sessions were attended?"), "number");
  assert.equal(inferAnswerType("Patient's full name"), "short_text");
  assert.equal(inferAnswerType("Current symptoms"), "long_text");

  const parsed = parsePortalQuestions("Pain today [0-10]\n[date]\nCurrent symptoms [long] [date]");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.questions[0].label, "Pain today [0-10]");
  assert.equal(parsed.questions[1].answerType, "long_text");
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.warnings.length, 3, parsed.warnings.join("\n"));
  assert.match(parsed.warnings[0], /Line 1: “\[0-10\]” is not a recognised answer type/);
  assert.match(parsed.warnings[1], /Line 2 has an answer type but no question/);
  assert.match(parsed.warnings[2], /Line 3: more than one answer type – “long” is used/);
});

test("problems that stop a question set being added: nothing pasted, too long, too many; repeats are a warning", () => {
  assert.deepEqual(parsePortalQuestions("  \n\n# Only a heading\n").errors, ["Paste or type at least one question."]);
  assert.match(parsePortalQuestions(`Short one\n${"x".repeat(501)}`).errors[0], /Line 2 is longer than 500 characters/);
  const many = Array.from({ length: MAX_PORTAL_QUESTIONS + 1 }, (_, i) => `Question ${i + 1} text`).join("\n");
  assert.match(parsePortalQuestions(many).errors[0], new RegExp(`up to ${MAX_PORTAL_QUESTIONS} questions; this has ${MAX_PORTAL_QUESTIONS + 1}`));
  const repeated = parsePortalQuestions("Current symptoms\ncurrent symptoms\n# Later\nCurrent symptoms");
  assert.equal(repeated.questions.length, 3);
  assert.deepEqual(repeated.warnings, ["Line 2 repeats line 1; both are kept."]);
});

test("where answers come from: identifiers and dates by code, counts and scores computed, opinions for the clinician", () => {
  const src = (label: string) => classifyPortalQuestion(label).fillSource;
  assert.deepEqual(src("Patient's full name"), { kind: "registration", path: "patient.fullName" });
  assert.deepEqual(src("Member’s name"), { kind: "registration", path: "patient.fullName" });
  assert.deepEqual(src("Date of birth"), { kind: "registration", path: "patient.dob" });
  assert.deepEqual(src("Date of initial assessment"), { kind: "registration", path: "episode.firstSeen" });
  assert.deepEqual(src("Treatment start date"), { kind: "registration", path: "episode.firstSeen" });
  assert.deepEqual(src("Date of last appointment"), { kind: "registration", path: "episode.lastSeen" });
  assert.deepEqual(src("Date of injury"), { kind: "registration", path: "incident.date" });
  assert.deepEqual(src("Treating physiotherapist's name"), { kind: "registration", path: "clinician.name" });
  assert.deepEqual(src("HCPC registration number"), { kind: "registration", path: "clinician.hcpc" });
  const membership = classifyPortalQuestion("Membership number");
  assert.deepEqual(membership.fillSource, { kind: "registration", path: "referral.reference" });
  assert.equal(membership.confidence, "low");
  assert.match(membership.note ?? "", /one referral reference/);
  assert.deepEqual(src("Authorisation code"), { kind: "registration", path: "referral.reference" });

  assert.deepEqual(src("Number of sessions attended to date"), { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" });
  assert.deepEqual(src("Number of missed appointments"), { kind: "computed_fact", factId: "FACT-attendance", format: "dna_count" });
  assert.deepEqual(src("Latest NDI score"), { kind: "computed_fact", factId: "FACT-outcomes-NDI", format: "summary" });

  // Further sessions, prognosis and anything forward-looking: only a recorded opinion.
  assert.deepEqual(src("Number of further sessions requested"), { kind: "clinician_opinion" });
  assert.deepEqual(src("Prognosis"), { kind: "clinician_opinion" });
  assert.deepEqual(src("Is the patient fit to return to work?"), { kind: "clinician_opinion" });
  const expected = classifyPortalQuestion("Expected discharge date");
  assert.deepEqual(expected.fillSource, { kind: "clinician_opinion" });
  assert.equal(expected.answerType, "date");

  assert.deepEqual(src("Bank sort code"), { kind: "leave_blank" });
  assert.deepEqual(src("Signature"), { kind: "signoff", part: "signature" });
  assert.deepEqual(src("Current symptoms and progress"), { kind: "notes_narrative" });
  assert.equal(classifyPortalQuestion("Current symptoms and progress").confidence, "high");
});

test("fields: F-01…, virtual anchors p0…, valid schema; a hint beats the wording's type", () => {
  const parsed = parsePortalQuestions("Date of birth\nPrognosis [yes/no]\nBank details\nCurrent symptoms");
  const fields = questionFields(parsed.questions);
  assert.deepEqual(fields.map((f) => f.id), ["F-01", "F-02", "F-03", "F-04"]);
  assert.deepEqual(fields.map((f) => f.anchor), [questionAnchor(0), questionAnchor(1), questionAnchor(2), questionAnchor(3)]);
  for (const f of fields) assert.ok(FormFieldSchema.safeParse(f).success, f.id);
  assert.equal(fields[0].answerType, "date");
  assert.equal(fields[1].answerType, "yes_no");
  assert.equal(fields[1].fillSource.kind, "clinician_opinion");
  // A question for the insurer's use is not required of the clinic.
  assert.equal(fields[2].fillSource.kind, "leave_blank");
  assert.equal(fields[2].required, false);
  assert.ok(fields.every((f) => isQuestionAnchor(f.anchor)));
  assert.deepEqual(nextQuestionAnchor(fields), questionAnchor(4));
  assert.deepEqual(nextQuestionAnchor([]), questionAnchor(0));
  assert.equal(isQuestionAnchor({ kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }), false);
  assert.equal(isQuestionAnchor({ kind: "pdf_overlay", page: 1, x: 0, y: 0, width: 1, height: 1 }), false);
});

test("createQuestionSet: a proposed map with the documented placeholder file", async () => {
  const parsed = parsePortalQuestions(EXAMPLE_PORTAL_QUESTIONS);
  assert.deepEqual(parsed.errors, []);
  const form = await createQuestionSet({ referrer: REFERRER, questions: parsed.questions, warnings: ["A note"], now: NOW, id: "form-qs-1" });
  assert.ok(FormDefinitionSchema.safeParse(form).success, JSON.stringify(FormDefinitionSchema.safeParse(form).error?.issues));
  assert.equal(form.kind, "questions");
  assert.equal(form.status, "proposed");
  assert.equal(form.tenantId, "demo");
  assert.equal(form.title, "Northbridge Health Insurance (fictional) – portal questions");
  assert.equal(form.fields.length, parsed.questions.length);
  assert.deepEqual(form.analysis, { mode: "rules", promptVersion: QUESTION_SET_PARSER_VERSION, at: NOW.toISOString(), warnings: ["A note"] });
  assert.equal(form.file.fileName, QUESTION_SET_FILE_NAME);
  assert.equal(form.file.mimeType, QUESTION_SET_MIME_TYPE);
  assert.equal(form.file.sha256, await questionSetSha256(form.fields));
  assert.equal(form.file.sizeBytes, new TextEncoder().encode(canonicalQuestionList(form.fields)).byteLength);
  assert.deepEqual(form.file, await questionSetFile(form.fields));
  assert.equal(form.confirmed, undefined);
  // A named question set keeps its name.
  const named = await createQuestionSet({ referrer: REFERRER, title: "  Treatment update  ", questions: parsed.questions, now: NOW });
  assert.equal(named.title, "Treatment update");
  assert.notEqual(named.id, form.id);
});

test("the placeholder SHA-256 is the question list's version: wording, heading, type, options and order – not fill sources", async () => {
  const base = questionFields(parsePortalQuestions("# A\nDate of birth\nCurrent symptoms [long]\nMode [choice: Clinic | Home]").questions);
  const sha = await questionSetSha256(base);
  assert.match(sha, /^[0-9a-f]{64}$/);
  const same = base.map((f) => ({ ...f, label: `  ${f.label.replace(/ /g, "  ")} `, fillSource: { kind: "notes_narrative" as const }, required: !f.required }));
  assert.equal(await questionSetSha256(same), sha, "whitespace, fill source and required do not change the version");
  const changes = [
    base.map((f, i) => (i === 1 ? { ...f, label: "Current symptoms today" } : f)),
    base.map((f, i) => (i === 1 ? { ...f, section: "B" } : f)),
    base.map((f, i) => (i === 1 ? { ...f, answerType: "short_text" as const } : f)),
    base.map((f, i) => (i === 2 ? { ...f, options: ["Clinic", "Home", "Video"] } : f)),
    base.slice().reverse(),
  ];
  for (const changed of changes) assert.notEqual(await questionSetSha256(changed), sha);
});

test("withQuestionSetFile recomputes a stale placeholder and leaves file forms alone", async () => {
  const form = await createQuestionSet({ referrer: REFERRER, questions: parsePortalQuestions("Date of birth\nPrognosis").questions, now: NOW });
  assert.equal(await withQuestionSetFile(form), form, "unchanged when current");
  const edited: FormDefinition = { ...form, fields: form.fields.map((f) => (f.id === "F-02" ? { ...f, label: "Prognosis and expected outcome" } : f)) };
  const fixed = await withQuestionSetFile(edited);
  assert.notEqual(fixed.file.sha256, form.file.sha256);
  assert.equal(fixed.file.sha256, await questionSetSha256(edited.fields));
  const fileForm = { ...form, kind: "docx" as const, file: { ...form.file, fileName: "x.docx" } };
  assert.equal(await withQuestionSetFile(fileForm), fileForm);
});

test("map checks for question sets: virtual anchors only, one place each", async () => {
  const form = await createQuestionSet({ referrer: REFERRER, questions: parsePortalQuestions(EXAMPLE_PORTAL_QUESTIONS).questions, now: NOW });
  assert.deepEqual(checkFormDefinition(form), []);
  assert.equal(new Set(Array.from(formAnchorKeys(form).values())).size, form.fields.length, "every question has its own answer space");

  const intoFile: FormDefinition = { ...form, fields: form.fields.map((f, i) => (i === 0 ? { ...f, anchor: { kind: "pdf_field", fieldName: "Text1", fieldType: "text" } } : f)) };
  assert.match(checkFormDefinition(intoFile)[0], /^F-01 .*a portal question cannot point into a file/);
  const shared: FormDefinition = { ...form, fields: form.fields.map((f, i) => (i === 1 ? { ...f, anchor: questionAnchor(0) } : f)) };
  assert.match(checkFormDefinition(shared)[0], /^F-02 .*shares its place in the summary with F-01/);
  const nothing: FormDefinition = { ...form, fields: form.fields.map((f) => ({ ...f, fillSource: { kind: "leave_blank" } })) };
  assert.ok(checkFormDefinition(nothing).includes("No question on this form is set to be completed."));
});

test("a question set's template: portal wording and its own attestations; file forms unchanged", async () => {
  const form = await createQuestionSet({ referrer: REFERRER, questions: parsePortalQuestions("Current symptoms\nPrognosis").questions, now: NOW });
  const t = formToTemplate(form);
  assert.equal(t.description, "Northbridge Health Insurance (fictional)'s portal questions, answered for entry in the portal.");
  assert.deepEqual(t.attestations, [...QUESTION_SET_ATTESTATIONS]);
  assert.deepEqual(t.attestations.slice(0, 3), FORM_ATTESTATIONS.slice(0, 3));
  assert.match(t.attestations[3], /entered in the referrer's portal/);
  assert.deepEqual(t.sections.map((s) => [s.key, s.kind]), [
    ["F-01", "ai_narrative"],
    ["F-02", "clinician_opinion"],
  ]);
  const docx = formToTemplate({ ...form, kind: "docx" });
  assert.deepEqual(docx.attestations, [...FORM_ATTESTATIONS]);
  assert.match(docx.description, /completed in its original layout/);
});
