/**
 * RED wave 1 integration: behaviour that needs more than one slice (S1 fillable-PDF anchors, S2 tables
 * and flat boxes, S3 sections and parties, S4 PMI record fields and charges, S5 demo notices, S6
 * portal question sets) – all on synthetic, fictional PDFs, never the real insurer forms.
 *
 * - A LIVE analysis (fake client, strict structured output) reaches every new anchor through
 *   post-validation: printed option labels, one-of-several tick boxes (optionFields), one-character
 *   date boxes, a table of fields, flat tick boxes – and the model's completedBy; the request carries
 *   the new output members and is stamped with the current prompt version.
 * - The appointments table of the PMI patient (S4 charges) fills fee and paid columns (S2).
 * - Rules mode gives flat-PDF box questions the section and party printed above them (S2 + S3).
 * - Map checks, answer-space keys and question counts know every new anchor and fill source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { analyseFormFile, RULES_PROMPT_VERSION } from "@/modules/medreport/ai/analyse-form";
import type { ClaudeClient } from "@/modules/medreport/ai/claude";
import { FORM_ANALYSIS_PROMPT_VERSION } from "@/modules/medreport/ai/form-analysis";
import { classifyLabel } from "@/modules/medreport/ai/form-classify";
import { AnalysisOutputSchema, type AnalysisFieldOutput, type AnalysisOutput } from "@/modules/medreport/ai/form-analysis-schema";
import { RECORDED_FORM_ANALYSIS_SOURCES } from "@/modules/medreport/ai/recorded/forms";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { buildFormAnswers, checkFormDefinition, formAnchorKey, formAnchorPdfFieldNames } from "@/modules/medreport/core/forms";
import { classifyPortalQuestion } from "@/modules/medreport/core/question-set";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { FormDefinitionSchema } from "@/modules/medreport/core/schemas";
import type { FormDefinition, FormField, InstructingParty } from "@/modules/medreport/core/types";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { fillPdf } from "@/modules/medreport/forms/pdf-fill";
import { flatBoxesPdf, tableFormPdf } from "@/modules/medreport/forms/pdf-s2-fixtures";
import { anchorFromPick } from "@/modules/medreport/ui/components/forms/mapping";
import { questionBreakdown } from "@/modules/medreport/ui/components/shared/ui-bits";
import { getDemoBundle } from "./dev-bundles";
import { buildInsurerLikePdf } from "./pdf-acro-fixtures";

const decoded = (bytes: Uint8Array) => decodeFormFile(Buffer.from(bytes).toString("base64"));

/** A strict, schema-valid field of a live analysis (every member present, as structured output gives). */
function liveField(rest: Partial<AnalysisFieldOutput> & Pick<AnalysisFieldOutput, "label">): AnalysisFieldOutput {
  return {
    section: "",
    guidance: "",
    answerType: "short_text",
    options: [],
    anchorTarget: "pdf_field",
    anchorRef: "",
    placeholderText: "",
    optionAnchors: [],
    overlay: { page: 0, x: 0, y: 0, width: 0, height: 0 },
    fillSource: "notes_narrative",
    registrationPath: "none",
    computedFact: "none",
    computedFormat: "none",
    signoffPart: "none",
    required: true,
    confidence: "high",
    note: "",
    completedBy: "unknown",
    ...rest,
  };
}

/** A fake SDK client: answers every chunk with the fields whose answer space the chunk names (or all). */
function fakeClient(fields: AnalysisFieldOutput[]): { client: ClaudeClient; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const parse = (async (body: Record<string, unknown>) => {
    calls.push(body);
    const content = (body.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0].content;
    const final = content[content.length - 1].text ?? "";
    const named = /these fields: (.*)\.$/m.exec(final.split("\n")[0])?.[1];
    const mine = named ? fields.filter((f) => f.anchorTarget !== "pdf_field" || named.includes(JSON.stringify(f.anchorRef))) : fields;
    const out: AnalysisOutput = { title: calls.length === 1 ? "Claim form (fictional)" : "", referrerName: "", referrerType: "insurer", versionLabel: "", fields: mine, warnings: [] };
    assert.equal(AnalysisOutputSchema.safeParse(out).success, true, "the fake answers in the strict live schema");
    const format = (body.output_config as { format: { parse(s: string): unknown } }).format;
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify(out) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 50 },
      parsed_output: format.parse(JSON.stringify(out)),
    };
  }) as unknown as ClaudeClient["beta"]["messages"]["parse"];
  return { client: { beta: { messages: { parse } } }, calls };
}

function byLabel(fields: FormField[], re: RegExp): FormField {
  const f = fields.find((x) => re.test(x.label));
  assert.ok(f, `no field matches ${re}: ${fields.map((x) => x.label).join(" | ")}`);
  return f;
}

/* ------------------------------------------------------------------------------------------------
 * Live analysis → the new anchors
 * ----------------------------------------------------------------------------------------------*/

test("live analysis of a fillable PDF: printed radio labels, one-of-several tick boxes, character boxes and the model's party", async () => {
  const { bytes } = await buildInsurerLikePdf();
  const { client, calls } = fakeClient([
    liveField({
      label: "Title (please tick)",
      answerType: "single_choice",
      options: ["Miss", "Mrs", "Ms", "Mr", "Dr", "Other (please state)"],
      anchorRef: "Radio Button 1",
      fillSource: "registration",
      registrationPath: "patient.title",
    }),
    liveField({ label: "Membership number", anchorRef: "Text Field 4", fillSource: "registration", registrationPath: "referral.membershipNumber" }),
    liveField({
      label: "Do you have any other health insurance which may cover these costs?",
      answerType: "yes_no",
      options: ["Yes", "No"],
      anchorRef: "Check Box5",
      optionAnchors: [
        { option: "Yes", ref: "Check Box5", glyphIndex: 0 },
        { option: "No", ref: "Check Box6", glyphIndex: 0 },
      ],
      fillSource: "leave_blank",
      completedBy: "policyholder",
    }),
    liveField({ label: "Date of diagnosis", answerType: "date", anchorRef: "Text Field 20", fillSource: "notes_narrative", completedBy: "clinic" }),
    liveField({ label: "Telephone number", anchorRef: "Text Field 15", fillSource: "registration", registrationPath: "patient.phone", completedBy: "policyholder" }),
  ]);
  const { form, live } = await analyseFormFile({ file: decoded(bytes), fileName: "claim.pdf", mode: "live", client });
  assert.ok(live && !live.lenient, "the strict structured output parsed");
  assert.equal(form.analysis.mode, "live");
  assert.equal(form.analysis.promptVersion, FORM_ANALYSIS_PROMPT_VERSION);
  assert.equal(FORM_ANALYSIS_PROMPT_VERSION, "form-analysis-4");

  // The request: the output schema carries completedBy and the PMI record paths.
  for (const body of calls) {
    const schema = JSON.stringify((body.output_config as { format: { schema: unknown } }).format.schema);
    assert.ok(schema.includes('"completedBy"'), "completedBy is in the live output schema");
    // (The SDK may move a long enum into the property description, so match the bare value.)
    for (const path of ["patient.title", "patient.phone", "referral.membershipNumber", "referral.authorisationNumber"]) assert.ok(schema.includes(path), path);
    assert.ok(!schema.includes('"table"'), "tables are never proposed by the analysis");
  }

  const title = byLabel(form.fields, /^Title/);
  assert.equal(title.anchor.kind, "pdf_field");
  if (title.anchor.kind === "pdf_field") assert.deepEqual(title.anchor.optionLabels, ["Other (please state)", "Dr", "Mr", "Ms", "Mrs", "Miss"]);
  assert.deepEqual(title.fillSource, { kind: "registration", path: "patient.title" });

  assert.deepEqual(byLabel(form.fields, /^Membership number$/).fillSource, { kind: "registration", path: "referral.membershipNumber" });

  const other = byLabel(form.fields, /other health insurance/);
  assert.equal(other.anchor.kind, "pdf_field");
  if (other.anchor.kind === "pdf_field") {
    assert.deepEqual(
      other.anchor.optionFields?.map((o) => [o.option, o.fieldName]),
      [
        ["Yes", "Check Box5"],
        ["No", "Check Box6"],
      ],
    );
  }
  assert.equal(other.completedBy, "policyholder");

  const diagnosis = byLabel(form.fields, /^Date of diagnosis$/);
  assert.equal(diagnosis.anchor.kind, "pdf_char_fields");
  if (diagnosis.anchor.kind === "pdf_char_fields") {
    assert.equal(diagnosis.anchor.fieldNames.length, 8);
    assert.equal(diagnosis.anchor.format, "DDMMYYYY");
  }

  // The model says the phone box is the policyholder's: left blank, whatever source it proposed.
  const phone = byLabel(form.fields, /^Telephone number$/);
  assert.equal(phone.completedBy, "policyholder");
  assert.deepEqual(phone.fillSource, { kind: "leave_blank" });
});

test("live analysis: per-cell questions of a table of fields become one table question; flat tick boxes become X marks", async () => {
  // Fillable table: the model maps every cell (as a reader of the outline might); code merges them.
  const cells: AnalysisFieldOutput[] = [];
  for (let i = 1; i <= 4; i += 1) {
    cells.push(liveField({ label: "Date of treatment", answerType: "date", anchorRef: `Date of treatmentRow${i}` }));
    cells.push(liveField({ label: "Treatment received", anchorRef: `Treatment receivedRow${i}` }));
    cells.push(liveField({ label: "Amount of the bill", anchorRef: `Amount of the billRow${i}` }));
    cells.push(liveField({ label: "Has this bill been paid?", answerType: "yes_no", options: ["Yes", "No"], anchorRef: `PAID${5 - i}` }));
  }
  cells.push(liveField({ label: "Surname", anchorRef: "Surname", fillSource: "registration", registrationPath: "patient.lastName" }));
  const table = await analyseFormFile({ file: decoded(await tableFormPdf()), fileName: "claim.pdf", mode: "live", client: fakeClient(cells).client });
  const t = table.form.fields.find((f) => f.answerType === "table");
  assert.ok(t, "one table question");
  assert.equal(t.anchor.kind, "pdf_table");
  assert.deepEqual(t.fillSource, { kind: "appointments_table", columns: { date: "date", service: "service", amount: "amount", paid: "paid" } });
  assert.equal(formAnchorPdfFieldNames(t.anchor).length, 16, "every cell is part of the answer space");
  assert.ok(!table.form.fields.some((f) => f.anchor.kind === "pdf_field" && /Row\d|^PAID/.test(f.anchor.fieldName)));
  assert.deepEqual(checkFormDefinition(table.form), []);

  // Flat PDF: a live-style estimate over the Yes/No boxes becomes tick marks, the date box gets its slots.
  const flat = await analyseFormFile({
    file: decoded(await flatBoxesPdf()),
    fileName: "flat.pdf",
    mode: "live",
    client: fakeClient([
      liveField({ label: "When did the symptoms start?", answerType: "date", anchorTarget: "pdf_overlay", overlay: { page: 1, x: 205, y: 731, width: 120, height: 14 }, completedBy: "clinic" }),
      liveField({
        label: "Is there a referral letter?",
        answerType: "yes_no",
        options: ["Yes", "No"],
        anchorTarget: "pdf_overlay",
        overlay: { page: 1, x: 198, y: 618, width: 90, height: 20 },
        completedBy: "clinic",
      }),
    ]).client,
  });
  const ticks = byLabel(flat.form.fields, /referral letter/);
  assert.equal(ticks.anchor.kind, "pdf_overlay_ticks");
  const date = byLabel(flat.form.fields, /symptoms start/);
  assert.ok(date.anchor.kind === "pdf_overlay" && date.anchor.dateSlots?.length === 3);
  assert.equal(flat.form.uppercase, true);
  // The section printed above the boxes says the practitioner completes it.
  assert.equal(ticks.completedBy, "clinic");
});

test("recorded analyses (form-analysis-3) still load under the current schemas, unchanged", () => {
  const sources = Object.values(RECORDED_FORM_ANALYSIS_SOURCES) as Array<{ promptVersion: string; form: unknown }>;
  assert.equal(sources.length, 4);
  for (const rec of sources) {
    assert.equal(rec.promptVersion, "form-analysis-3", "recordings keep their own stamp");
    const parsed = FormDefinitionSchema.safeParse(rec.form);
    assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Rules mode: sections and parties on flat-PDF boxes (S2 boxes + S3 sections)
 * ----------------------------------------------------------------------------------------------*/

test("rules mode: flat-PDF box questions carry the section printed above them and who completes it", async () => {
  const { form } = await analyseFormFile({ file: decoded(await flatBoxesPdf()), fileName: "flat.pdf", mode: "demo", rulesOnly: true });
  assert.equal(form.analysis.promptVersion, RULES_PROMPT_VERSION);
  const date = byLabel(form.fields, /^When did the symptoms start\?$/);
  assert.match(date.section ?? "", /Medical details/);
  assert.equal(date.completedBy, "clinic");
  assert.notEqual(date.fillSource.kind, "leave_blank");
});

/* ------------------------------------------------------------------------------------------------
 * PMI patient (S4) on a table of fields (S2): fees and paid from the appointment charges
 * ----------------------------------------------------------------------------------------------*/

function tableForm(): FormDefinition {
  const field: FormField = {
    id: "F-01",
    label: "Details of the treatment you are claiming for",
    guidance: "",
    answerType: "table",
    anchor: {
      kind: "pdf_table",
      columns: [
        { key: "date", header: "Date of treatment" },
        { key: "service", header: "Treatment received" },
        { key: "amount", header: "Amount of the bill" },
        { key: "paid", header: "Has this bill been paid?" },
      ],
      rows: [1, 2, 3, 4].map((n) => ({ date: `Date of treatmentRow${n}`, service: `Treatment receivedRow${n}`, amount: `Amount of the billRow${n}`, paid: `PAID${5 - n}` })),
    },
    fillSource: { kind: "appointments_table", columns: { date: "date", service: "service", amount: "amount", paid: "paid" } },
    required: true,
    confidence: "high",
  };
  return FormDefinitionSchema.parse({
    id: "frm_table_test",
    tenantId: "demo",
    referrer: { name: "Bupa", type: "insurer" },
    title: "Claim form (synthetic test form)",
    file: { fileName: "claim.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields: [field],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-06T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-06T09:00:00.000Z",
    updatedAt: "2026-10-06T09:00:00.000Z",
  });
}

test("Case C: the appointments table lists each attended session with its fee and whether it was paid", async () => {
  const form = tableForm();
  assert.deepEqual(checkFormDefinition(form), []);
  const bundle = getDemoBundle("rebecca-lane");
  const { type, name, reference, contactName, address } = bundle.referral;
  const party: InstructingParty = { type, name, reference, contactName, address };
  const report = createFormReport({ form, bundle, instructingParty: party, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), now: new Date("2026-10-06T09:00:00.000Z") });
  const section = report.sections.find((s) => s.key === "F-01");
  assert.ok(section?.answer && section.answer.kind === "rows" && Array.isArray(section.answer.value));
  const rows = section.answer.value as Array<Record<string, string>>;
  assert.deepEqual(
    rows.map((r) => [r.date, r.amount, r.paid]),
    [
      ["01/09/2026", "£70.00", "Yes"],
      ["08/09/2026", "£55.00", "Yes"],
      ["15/09/2026", "£55.00", "Yes"],
      ["24/09/2026", "£55.00", "Yes"],
      ["01/10/2026", "£55.00", "No"],
    ],
  );
  assert.ok(!report.gaps.some((g) => g.sectionKey === "F-01"), "nothing missing from the record");

  // Written into the fillable table: four printed rows, the fifth on the continuation sheet.
  const answers = buildFormAnswers(report, form);
  const warnings: string[] = [];
  const out = await fillPdf(await tableFormPdf(), form, answers, { draft: false, flatten: true, onWarning: (m) => void warnings.push(m) });
  const doc = await PDFDocument.load(out);
  assert.ok(doc.getPageCount() >= 2, "a continuation sheet");
  assert.ok(warnings.some((w) => /other 1 row is on the continuation sheet/.test(w)), warnings.join(" | "));
});

/* ------------------------------------------------------------------------------------------------
 * Map helpers that switch over every anchor and fill source
 * ----------------------------------------------------------------------------------------------*/

test("map helpers: table cells are the table's answer space; a fixed answer on a table is one problem; counts", () => {
  const form = tableForm();
  const table = form.fields[0];
  assert.ok(formAnchorKey(table.anchor).startsWith("pdftable:"));
  // Picking one of the table's own cells in the preview keeps the table.
  assert.deepEqual(anchorFromPick(table.anchor, { kind: "pdf_field", fieldName: "Amount of the billRow3", fieldType: "text" }), table.anchor);
  // Any other field replaces it.
  assert.equal(anchorFromPick(table.anchor, { kind: "pdf_field", fieldName: "Surname", fieldType: "text" }).kind, "pdf_field");

  const fixedTable = { ...form, fields: [{ ...table, fillSource: { kind: "fixed" as const, value: "Yes" } }] };
  assert.deepEqual(checkFormDefinition(fixedTable), ["F-01 (“Details of the treatment you are claiming for”): a table is filled from the appointment record, or left blank."]);

  // A table filled from the appointments counts as answered from the records.
  assert.deepEqual(questionBreakdown(form), { toAnswer: 1, fromRecords: 1, fromNotes: 0, onApproval: 0, referrerUse: 0 });
});

test("portal question sets use the PMI record values for membership and authorisation numbers", () => {
  assert.deepEqual(classifyPortalQuestion("Bupa membership number").fillSource, { kind: "registration", path: "referral.membershipNumber" });
  assert.deepEqual(classifyPortalQuestion("Pre-authorisation code").fillSource, { kind: "registration", path: "referral.authorisationNumber" });
  assert.deepEqual(classifyPortalQuestion("Claim reference").fillSource, { kind: "registration", path: "referral.reference" });
});

test("rules mode maps the patient's title to the record (S4 path), not to a drafted answer", () => {
  for (const label of ["Title (please tick)", "Title", "Patient's title", "Title:"]) {
    assert.deepEqual(classifyLabel(label, "About the patient").fillSource, { kind: "registration", path: "patient.title" }, label);
  }
  assert.notDeepEqual(classifyLabel("Title", "Therapist’s details").fillSource, { kind: "registration", path: "patient.title" }, "a clinician's title");
  assert.deepEqual(classifyLabel("Job title").fillSource, { kind: "registration", path: "patient.occupation" });
  assert.notDeepEqual(classifyLabel("Title of the report").fillSource, { kind: "registration", path: "patient.title" });
});
