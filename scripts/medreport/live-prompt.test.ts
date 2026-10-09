/**
 * The live form analysis on the RED wave 1 engine (prompt text "form-analysis-4", 10/2026): what the
 * prompt tells the model, what the fillable-PDF outline shows it (tick-box groups, tables of fields and
 * printed signature boxes as ONE answer space each, never split across chunks) and what post-validation
 * does with a live proposal whatever it says (a lone box of a tick-box group widened to the group; a list
 * of treatments made one table filled from the appointments; Initial / Current score columns; no
 * computed figure in a choice; a printed signature box; no sign-off in another party's declaration).
 * Fake client only, synthetic fictional PDFs – never the real insurer forms.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { analyseFormFile } from "@/modules/medreport/ai/analyse-form";
import type { ClaudeClient } from "@/modules/medreport/ai/claude";
import { FORM_ANALYSIS_PROMPT_VERSION, FORM_ANALYSIS_SYSTEM_PROMPT, buildFinalInstruction } from "@/modules/medreport/ai/form-analysis";
import { AnalysisOutputSchema, FILL_KINDS, type AnalysisFieldOutput, type AnalysisOutput } from "@/modules/medreport/ai/form-analysis-schema";
import { snapOverlay } from "@/modules/medreport/ai/form-boxes";
import { chunkPdfFields, pdfOutlineSpaces, renderPdfOutline } from "@/modules/medreport/ai/form-outline";
import { postValidateFields } from "@/modules/medreport/ai/form-postvalidate";
import { checkFormDefinition } from "@/modules/medreport/core/forms";
import type { FormField, PdfFormOutline } from "@/modules/medreport/core/types";
import { decodeFormFile } from "@/modules/medreport/forms/file";
import { tableFormPdf } from "@/modules/medreport/forms/pdf-s2-fixtures";
import { readPdfForm } from "@/modules/medreport/forms/pdf-outline";
import { buildInsurerLikePdf } from "./pdf-acro-fixtures";

const decoded = (bytes: Uint8Array) => decodeFormFile(Buffer.from(bytes).toString("base64"));

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
    completedBy: "clinic",
    ...rest,
  };
}

/**
 * A fake SDK client: every chunk answers with the proposals whose answer space it names (a field it
 * lists, or – for an overlay – a printed box it lists); a single call answers with all of them.
 */
function fakeClient(fields: AnalysisFieldOutput[]): { client: ClaudeClient; finals: string[] } {
  const finals: string[] = [];
  const parse = (async (body: Record<string, unknown>) => {
    const content = (body.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0].content;
    const final = content[content.length - 1].text ?? "";
    finals.push(final);
    const line = final.split("\n")[0];
    const chunked = /^Map only/.test(line);
    const mine = !chunked
      ? fields
      : fields.filter((f) => (f.anchorTarget === "pdf_overlay" ? /printed box/.test(line) : line.includes(JSON.stringify(f.anchorRef))));
    const out: AnalysisOutput = { title: finals.length === 1 ? "Treatment plan (fictional)" : "", referrerName: "", referrerType: "insurer", versionLabel: "", fields: mine, warnings: [] };
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
  return { client: { beta: { messages: { parse } } }, finals };
}

function byLabel(fields: FormField[], re: RegExp): FormField {
  const f = fields.find((x) => re.test(x.label));
  assert.ok(f, `no field matches ${re}: ${fields.map((x) => x.label).join(" | ")}`);
  return f;
}

/** A fillable treatment plan whose signature is a PRINTED box (no field) under the given heading – as AXA's. */
async function printedSignatureForm(heading: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  page.drawText("Treatment plan (fictional)", { x: 40, y: 790, size: 16, font });
  page.drawText("Initial score", { x: 40, y: 760, size: 9, font });
  form.createTextField("initialScore").addToPage(page, { x: 140, y: 752, width: 120, height: 18, font });
  page.drawText("Current score", { x: 300, y: 760, size: 9, font });
  form.createTextField("currentScore").addToPage(page, { x: 400, y: 752, width: 120, height: 18, font });
  page.drawText("Level of pain (0-10)", { x: 40, y: 730, size: 9, font });
  const pain = form.createDropdown("painLevel");
  pain.addOptions(["Please select", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  pain.addToPage(page, { x: 140, y: 722, width: 60, height: 18, font });
  page.drawText("Treatment provided", { x: 40, y: 705, size: 9, font });
  form.createTextField("treatment").addToPage(page, { x: 40, y: 660, width: 500, height: 40, font });
  page.drawText(heading, { x: 40, y: 640, size: 12, font });
  page.drawText("Signature", { x: 40, y: 610, size: 9, font });
  page.drawRectangle({ x: 40, y: 550, width: 220, height: 55, borderColor: rgb(0.1, 0.1, 0.5), borderWidth: 0.8 });
  page.drawText("Please print name", { x: 300, y: 610, size: 9, font });
  form.createTextField("printName").addToPage(page, { x: 300, y: 585, width: 220, height: 18, font });
  page.drawText("Date", { x: 300, y: 570, size: 9, font });
  form.createTextField("signedDate").addToPage(page, { x: 300, y: 548, width: 120, height: 18, font });
  return doc.save();
}

/* ------------------------------------------------------------------------------------------------
 * The prompt
 * ----------------------------------------------------------------------------------------------*/

test("form-analysis-4 prompt text: the RED wave 1 outline markers, record paths, parties and answer spaces", () => {
  assert.equal(FORM_ANALYSIS_PROMPT_VERSION, "form-analysis-4", "never recorded under this label, so the text changed in place");
  const p = FORM_ANALYSIS_SYSTEM_PROMPT;
  // Outline markers.
  for (const marker of ["printed=[…]", "character-boxes=<n>", "tick-box group", "table of fields", "printed box with no field", "answer boxes:", "slots=<n>", "lines=<n>", "tick boxes:", "completedBy=<party>"]) {
    assert.ok(p.includes(marker), marker);
  }
  // The eight record paths added for insurer forms.
  for (const path of ["patient.title", "phone / email (the patient's own", "clinic.name / address / phone / email", "insurerName", "membershipNumber", "authorisationNumber"]) {
    assert.ok(p.includes(path), path);
  }
  // Who completes it, and the multi-party rule.
  assert.match(p, /5\. completedBy/);
  assert.match(p, /Another party's part is ALWAYS leave_blank/);
  assert.match(p, /signoff: the clinic's OWN declaration or signature block only/);
  assert.match(p, /optionAnchors lists EVERY box/);
  assert.ok(!/map the question to the "Yes" box/i.test(p), "the old one-box rule is gone");
  assert.match(p, /first_score \/ latest_score/);
  assert.match(p, /appointments_table: a table of fields that lists the treatments/);
  assert.match(p, /BLOCK CAPITALS/);
  assert.match(p, /never mention block IDs, field names, coordinates, other readers or how the form was divided/);
  // The structured output can say so.
  assert.ok((FILL_KINDS as readonly string[]).includes("appointments_table"));
  assert.ok(!(FILL_KINDS as readonly string[]).includes("fixed"), "fixed answers are set by staff, never proposed");
});

/* ------------------------------------------------------------------------------------------------
 * The fillable-PDF outline
 * ----------------------------------------------------------------------------------------------*/

test("outline: a tick-box group is ONE answer space listing every box; a checklist stays box by box; never split across chunks", async () => {
  const outline = await readPdfForm((await buildInsurerLikePdf()).bytes);
  const text = renderPdfOutline(outline, "pdf_acroform");
  assert.match(text, /tick-box group page 1 \(.*list EVERY box in optionAnchors.*\) boxes: "Check Box 4"="Physiotherapist", "Check Box 5"="Chiropractor", "Check Box 6"="Osteopath"/);
  assert.match(text, /tick-box group page 1 .* boxes: "Check Box5"="Yes", "Check Box6"="No"/);
  assert.doesNotMatch(text, /^field "Check Box 5"/m, "no line per box of a group");
  // The checklist's labels are questions: not one choice.
  assert.match(text, /^field "Check Box 2" checkbox/m);
  assert.match(text, /^field "Check Box 3" checkbox/m);
  const spaces = pdfOutlineSpaces(outline);
  assert.equal(spaces.filter((s) => s.kind === "options").length >= 2, true);
  for (const chunk of chunkPdfFields(outline)) {
    if (chunk.kind !== "fields") continue;
    const types = chunk.names.filter((n) => /^Check Box [456]$/.test(n));
    assert.ok(types.length === 0 || types.length === 3, "a tick-box group stays in one chunk");
  }
});

test("outline: a table of fields is ONE answer space named by its first cell, in one chunk", async () => {
  const outline = await readPdfForm(await tableFormPdf());
  const text = renderPdfOutline(outline, "pdf_acroform");
  assert.match(text, /^table of fields page 1 rows=4 columns=\["Date of treatment","Treatment received","Amount of the bill","Has this bill been paid\?"\] \(ONE question for the whole table: anchorRef "Date of treatmentRow1"/m);
  assert.doesNotMatch(text, /^field "Treatment receivedRow2"/m);
  const holding = chunkPdfFields(outline).filter((c) => c.kind === "fields" && c.names.some((n) => /Row\d|^PAID/.test(n)));
  assert.equal(holding.length, 1);
  assert.equal(holding[0].kind === "fields" && holding[0].names.filter((n) => /Row\d|^PAID/.test(n)).length, 16);
});

test("outline: a printed signature box no field covers is listed with its section and given to a chunk", async () => {
  const outline = await readPdfForm(await printedSignatureForm("6 Your signature"));
  const text = renderPdfOutline(outline, "pdf_acroform");
  assert.match(text, /^printed box with no field \(map it as pdf_overlay with this box\) page 1 box x=40 y=550 w=220 h=55 near="Signature" section="6 Your signature"/m);
  const lines = text.split("\n");
  assert.ok(lines.findIndex((l) => l.startsWith("printed box")) > lines.findIndex((l) => l.includes('"treatment"')), "in reading order");
  const chunks = chunkPdfFields(outline);
  const withBox = chunks.filter((c) => c.kind === "fields" && c.boxes?.length);
  assert.equal(withBox.length, 1);
  assert.deepEqual(withBox[0].kind === "fields" && withBox[0].boxes, ["page 1 box x=40 y=550 w=220 h=55"]);
  // A chunk's instruction names its printed box (a chunk may hold only the box).
  const box = "page 1 box x=40 y=550 w=220 h=55";
  assert.match(
    buildFinalInstruction({ fileName: "x.pdf" }, { kind: "fields", names: ["printName"], boxes: [box] }, 1, 2),
    /^Map only the questions answered in these fields: "printName"; and in the printed box with no field at page 1 box x=40 y=550 w=220 h=55\./,
  );
  assert.match(buildFinalInstruction({ fileName: "x.pdf" }, { kind: "fields", names: [], boxes: [box] }, 1, 2), /^Map only the questions answered in the printed box with no field at page 1 box/);
  // A logo or a table heading without a signature label is not listed.
  const noBoxes: PdfFormOutline = { ...outline, boxes: [{ page: 1, kind: "box", x: 400, y: 780, width: 80, height: 50 }] };
  assert.doesNotMatch(renderPdfOutline(noBoxes, "pdf_acroform"), /printed box/);
});

/* ------------------------------------------------------------------------------------------------
 * Post-validation of a live proposal
 * ----------------------------------------------------------------------------------------------*/

test("live proposal: a tick-box group proposed box by box becomes one question over every box, without a clash warning", async () => {
  const { bytes } = await buildInsurerLikePdf();
  const { client } = fakeClient([
    liveField({ label: "Therapist type: Physiotherapist", answerType: "checkbox", anchorRef: "Check Box 4", fillSource: "registration", registrationPath: "clinician.profession" }),
    liveField({ label: "Therapist type: Chiropractor", answerType: "checkbox", anchorRef: "Check Box 5", fillSource: "registration", registrationPath: "clinician.profession" }),
    liveField({ label: "Do you have any other health insurance which may cover these costs?", answerType: "yes_no", options: ["Yes", "No"], anchorRef: "Check Box5", fillSource: "leave_blank", completedBy: "policyholder" }),
  ]);
  const { form } = await analyseFormFile({ file: decoded(bytes), fileName: "plan.pdf", mode: "live", client });
  const type = byLabel(form.fields, /^Therapist type/);
  assert.equal(type.answerType, "single_choice");
  assert.deepEqual(type.options, ["Physiotherapist", "Chiropractor", "Osteopath"]);
  assert.deepEqual(type.anchor.kind === "pdf_field" && type.anchor.optionFields?.map((o) => o.fieldName), ["Check Box 4", "Check Box 5", "Check Box 6"]);
  assert.equal(form.fields.filter((f) => /^Therapist type/.test(f.label)).length, 1, "the second box merged into the same question");
  assert.ok(!form.analysis.warnings.some((w) => /same answer space/.test(w)), form.analysis.warnings.join(" | "));
  // A Yes/No pair proposed on its "Yes" box only: both boxes, Yes first; the policyholder's – left blank.
  const other = byLabel(form.fields, /other health insurance/);
  assert.equal(other.answerType, "yes_no");
  assert.deepEqual(other.anchor.kind === "pdf_field" && other.anchor.optionFields?.map((o) => [o.option, o.fieldName]), [
    ["Yes", "Check Box5"],
    ["No", "Check Box6"],
  ]);
  assert.deepEqual(other.fillSource, { kind: "leave_blank" });
  assert.deepEqual(checkFormDefinition({ ...form, status: "confirmed" }), []);
});

test("live proposal: a list of treatments mapped once is one table filled from the appointments; elsewhere it is drafted and flagged", async () => {
  const { client } = fakeClient([
    liveField({ label: "Details of the treatment you are claiming for", answerType: "long_text", anchorRef: "Date of treatmentRow1", fillSource: "appointments_table" }),
    liveField({ label: "Surname", anchorRef: "Surname", fillSource: "registration", registrationPath: "patient.lastName" }),
    liveField({ label: "Other treatment received", answerType: "long_text", anchorRef: "Text Field 1", fillSource: "appointments_table" }),
  ]);
  const { form } = await analyseFormFile({ file: decoded(await tableFormPdf()), fileName: "claim.pdf", mode: "live", client });
  const table = form.fields.find((f) => f.answerType === "table");
  assert.ok(table, "one table question");
  assert.equal(table.anchor.kind, "pdf_table");
  assert.deepEqual(table.fillSource, { kind: "appointments_table", columns: { date: "date", service: "service", amount: "amount", paid: "paid" } });
  assert.equal(table.completedBy, "clinic");
  const elsewhere = byLabel(form.fields, /^Other treatment received$/);
  assert.deepEqual(elsewhere.fillSource, { kind: "notes_narrative" });
  assert.equal(elsewhere.confidence, "low");
  assert.match(elsewhere.note ?? "", /No table of fields was found/);
  assert.deepEqual(checkFormDefinition({ ...form, status: "confirmed" }), []);
});

test("live proposal: Initial / Current score boxes get the first / latest score; a drop-down is never a computed figure", async () => {
  const outline = await readPdfForm(await printedSignatureForm("6 Your signature"));
  const parsed = { kind: "pdf_acroform" as const, pdf: outline, warnings: [] };
  const res = postValidateFields(parsed, [
    liveField({ label: "Outcome measures – Initial score", section: "Assessment", anchorRef: "initialScore", fillSource: "computed_fact", computedFact: "FACT-outcomes-PSFS", computedFormat: "summary" }),
    liveField({ label: "Outcome measures – Current score", section: "Assessment", anchorRef: "currentScore", fillSource: "computed_fact", computedFact: "FACT-outcomes-PSFS", computedFormat: "first_score" }),
    liveField({ label: "Level of pain (0-10)", answerType: "single_choice", anchorRef: "painLevel", fillSource: "computed_fact", computedFact: "FACT-outcomes-NPRS", computedFormat: "latest_score" }),
  ]);
  assert.deepEqual(byLabel(res.fields, /Initial score/).fillSource, { kind: "computed_fact", factId: "FACT-outcomes-PSFS", format: "first_score" });
  const current = byLabel(res.fields, /Current score/);
  assert.deepEqual(current.fillSource, { kind: "computed_fact", factId: "FACT-outcomes-PSFS", format: "latest_score" });
  assert.match(current.note ?? "", /latest score is used/);
  const pain = byLabel(res.fields, /Level of pain/);
  assert.deepEqual(pain.fillSource, { kind: "notes_narrative" });
  assert.match(pain.note ?? "", /picked from the notes/);
});

test("live proposal: the approval goes into the clinic's printed signature box, never into another party's", async () => {
  const proposal = () => [
    liveField({ label: "Treatment provided", answerType: "long_text", anchorRef: "treatment" }),
    liveField({ label: "Signature", answerType: "signature", anchorTarget: "pdf_overlay", overlay: { page: 1, x: 40, y: 550, width: 220, height: 55 }, fillSource: "signoff", signoffPart: "signature" }),
    liveField({ label: "Please print name", answerType: "clinician_name", anchorRef: "printName", fillSource: "signoff", signoffPart: "name" }),
    liveField({ label: "Date", answerType: "date_signed", anchorRef: "signedDate", fillSource: "signoff", signoffPart: "date" }),
  ];
  const ours = await analyseFormFile({ file: decoded(await printedSignatureForm("6 Your signature")), fileName: "plan.pdf", mode: "live", client: fakeClient(proposal()).client });
  const sig = byLabel(ours.form.fields, /^Signature$/);
  assert.deepEqual(sig.fillSource, { kind: "signoff", part: "signature" });
  assert.ok(sig.anchor.kind === "pdf_overlay" && sig.anchor.x === 42 && sig.anchor.y === 552 && sig.anchor.width === 216, "inside the printed box (inset)");
  assert.match(sig.note ?? "", /^Printed box with no fillable field:/);
  assert.equal(ours.form.fields.filter((f) => f.fillSource.kind === "signoff").length, 3);
  assert.deepEqual(checkFormDefinition({ ...ours.form, status: "confirmed" }), []);

  // The same proposal (sign-off, "clinic") under the policyholder's declaration: nothing of the approval is written.
  const theirs = await analyseFormFile({ file: decoded(await printedSignatureForm("Policyholder's declaration")), fileName: "claim.pdf", mode: "live", client: fakeClient(proposal()).client });
  const blank = theirs.form.fields.filter((f) => /^(?:Signature|Please print name|Date)$/.test(f.label));
  assert.equal(blank.length, 3);
  for (const f of blank) {
    assert.deepEqual(f.fillSource, { kind: "leave_blank" }, f.label);
    assert.equal(f.completedBy, "policyholder", f.label);
  }
  assert.equal(theirs.form.fields.filter((f) => f.fillSource.kind === "signoff").length, 0, "no wrong-party sign-off");
});

test("live proposal: a planned count, an 'Other – please specify' box and numbers the record does not hold are never filled from the record", async () => {
  const outline = await readPdfForm((await buildInsurerLikePdf()).bytes);
  const parsed = { kind: "pdf_acroform" as const, pdf: outline, warnings: [] };
  const res = postValidateFields(parsed, [
    // Under a treatment plan, "Number of sessions" is the number planned.
    liveField({ label: "Number of sessions", section: "5 Treatment Plan", answerType: "number", anchorRef: "Text Field 4", fillSource: "computed_fact", computedFact: "FACT-attendance", computedFormat: "sessions_attended" }),
    liveField({ label: "Other, please specify below", section: "2 Therapist details", anchorRef: "Text Field 15", fillSource: "registration", registrationPath: "clinician.profession" }),
    liveField({ label: "Scheme number", anchorRef: "Text Field 18", fillSource: "registration", registrationPath: "referral.reference" }),
  ]);
  const planned = byLabel(res.fields, /^Number of sessions$/);
  assert.deepEqual(planned.fillSource, { kind: "notes_narrative" });
  assert.match(planned.note ?? "", /sessions planned/);
  const other = byLabel(res.fields, /^Other, please specify/);
  assert.deepEqual(other.fillSource, { kind: "leave_blank" });
  assert.match(other.note ?? "", /only when “Other” is the answer/);
  const scheme = byLabel(res.fields, /^Scheme number$/);
  assert.deepEqual(scheme.fillSource, { kind: "leave_blank" });
  assert.match(scheme.note ?? "", /does not hold this/);
  // Sessions attended so far are still counted by code.
  const attended = postValidateFields(parsed, [
    liveField({ label: "Number of sessions to date", section: "About the treatment", answerType: "number", anchorRef: "Text Field 4", fillSource: "computed_fact", computedFact: "FACT-attendance", computedFormat: "sessions_attended" }),
  ]);
  assert.deepEqual(attended.fields[0].fillSource, { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" });
});

test("live proposal: a drop-down's prompt entry is not an option; an overlay only clipping a printed box is not snapped onto it", async () => {
  const outline = await readPdfForm(await printedSignatureForm("6 Your signature"));
  const res = postValidateFields({ kind: "pdf_acroform", pdf: outline, warnings: [] }, [
    liveField({ label: "Level of pain (0-10)", answerType: "single_choice", options: ["Please select", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], anchorRef: "painLevel" }),
  ]);
  assert.deepEqual(res.fields[0].options, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

  // A flat page: one printed box (the e-mail line) under three unprinted address lines.
  const flat: PdfFormOutline = { pages: 1, fields: [], pageText: [{ page: 1, items: [] }], boxes: [{ page: 1, kind: "box", x: 193, y: 437, width: 391, height: 17 }] };
  // The address region (three lines) clips the top of the e-mail box: kept where it was proposed.
  assert.equal(snapOverlay({ page: 1, x: 193, y: 440, width: 391, height: 45 }, flat, "long_text", []), null);
  // An overlay on the box, a little off: written inside the box.
  const on = snapOverlay({ page: 1, x: 195, y: 439, width: 387, height: 14 }, flat, "short_text", []);
  assert.deepEqual(on?.anchor, { kind: "pdf_overlay", page: 1, x: 195, y: 439, width: 387, height: 13 });
  // A one-line overlay inside a tall box: the whole box.
  const tall: PdfFormOutline = { ...flat, boxes: [{ page: 1, kind: "box", x: 191, y: 262, width: 392, height: 66 }] };
  assert.equal(snapOverlay({ page: 1, x: 200, y: 300, width: 300, height: 14 }, tall, "long_text", [])?.anchor.kind, "pdf_overlay");
  assert.deepEqual(snapOverlay({ page: 1, x: 200, y: 300, width: 300, height: 14 }, tall, "long_text", [])?.anchor, { kind: "pdf_overlay", page: 1, x: 193, y: 264, width: 388, height: 62 });
});
