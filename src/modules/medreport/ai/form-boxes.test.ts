/**
 * S2 analysis tests on synthetic PDFs: flat forms mapped from their printed boxes (rules mode), live-
 * style overlays snapped onto the boxes in post-validation, the boxes in the prompt outline, BLOCK
 * CAPITALS, and tables of fields in a fillable PDF combined into one table question.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formMapSha256 } from "../auth/attestations";
import { checkFormDefinition } from "../core/forms";
import type { FormField } from "../core/types";
import { decodeFormFile } from "../forms/file";
import { RULED, flatBoxesPdf, ruledBoxesPdf, tableFormPdf } from "../forms/pdf-s2-fixtures";
import { analyseFormFile, parseFormFile } from "./analyse-form";
import type { AnalysisFieldOutput } from "./form-analysis-schema";
import { asksForBlockCapitals, flatBoxQuestions } from "./form-boxes";
import { renderPdfOutline } from "./form-outline";
import { postValidateFields } from "./form-postvalidate";
import { proposeFieldsByRules } from "./form-rules";

const decoded = (bytes: Uint8Array) => decodeFormFile(Buffer.from(bytes).toString("base64"));

function byLabel(fields: FormField[], re: RegExp): FormField {
  const f = fields.find((x) => re.test(x.label));
  assert.ok(f, `no field matches ${re}`);
  return f;
}

test("rules mode on a flat PDF: one question per printed box and tick row, labelled from the label column", async () => {
  const { form } = await analyseFormFile({ file: decoded(await flatBoxesPdf()), fileName: "flat.pdf", mode: "demo", rulesOnly: true });
  assert.equal(form.kind, "pdf_flat");
  assert.equal(form.uppercase, true, "the form asks for BLOCK CAPITALS");
  assert.deepEqual(checkFormDefinition(form), []);

  const date = byLabel(form.fields, /^When did the symptoms start\?$/);
  assert.equal(date.answerType, "date");
  assert.equal(date.anchor.kind, "pdf_overlay");
  if (date.anchor.kind === "pdf_overlay") {
    assert.equal(date.anchor.dateSlots?.length, 3);
    assert.ok(Math.abs(date.anchor.x - 202) < 1 && Math.abs(date.anchor.width - 96) < 1.5, "inside the box, inset 2 pt");
  }
  const describe = byLabel(form.fields, /^Please describe the condition currently suffering from$/);
  assert.equal(describe.answerType, "long_text");
  assert.deepEqual(describe.anchor.kind === "pdf_overlay" && [Math.round(describe.anchor.y), Math.round(describe.anchor.height)], [662, 46]);

  const referral = byLabel(form.fields, /^Is there a referral letter\?$/);
  assert.equal(referral.answerType, "yes_no");
  assert.equal(referral.anchor.kind, "pdf_overlay_ticks");
  if (referral.anchor.kind === "pdf_overlay_ticks") {
    assert.deepEqual(referral.anchor.options.map((o) => [o.option, Math.round(o.x)]), [["Yes", 200], ["No", 246]]);
  }
  const copy = byLabel(form.fields, /^Tick if you would like a copy$/);
  assert.equal(copy.answerType, "checkbox");
  assert.equal(copy.anchor.kind, "pdf_overlay_ticks");

  assert.ok(byLabel(form.fields, /^Membership number$/));
  assert.ok(byLabel(form.fields, /^Print name$/));
  assert.ok(!form.fields.some((f) => /office use/i.test(f.label)), "a box with printed text is not an answer space");
  assert.ok(!form.fields.some((f) => /^4\. Medical details/.test(f.label)), "headings are not questions");
});

test("post-validation snaps proposed overlays onto the printed boxes (dates, ticks), and keeps others", async () => {
  const parsed = await parseFormFile(decoded(await flatBoxesPdf()));
  assert.ok(asksForBlockCapitals(parsed));
  const base = proposeFieldsByRules(parsed)[0];
  const raw = (label: string, answerType: AnalysisFieldOutput["answerType"], overlay: AnalysisFieldOutput["overlay"], options: string[] = []): AnalysisFieldOutput => ({
    ...base,
    label,
    answerType,
    options,
    anchorTarget: "pdf_overlay",
    overlay,
    fillSource: "notes_narrative",
    registrationPath: "none",
    computedFact: "none",
    computedFormat: "none",
    signoffPart: "none",
    confidence: "high",
  });
  const out = postValidateFields(parsed, [
    // A live-style estimate: right of the label, a little off the box.
    raw("When did the symptoms start?", "date", { page: 1, x: 205, y: 731, width: 120, height: 14 }),
    raw("Is there a referral letter?", "yes_no", { page: 1, x: 198, y: 618, width: 90, height: 20 }, ["Yes", "No"]),
    raw("Somewhere else", "short_text", { page: 1, x: 300, y: 200, width: 100, height: 14 }),
  ]);
  const [date, ticks, other] = out.fields;
  assert.equal(date.anchor.kind, "pdf_overlay");
  assert.ok(date.anchor.kind === "pdf_overlay" && date.anchor.dateSlots?.length === 3 && Math.abs(date.anchor.x - 202) < 1);
  assert.match(date.note ?? "", /between the printed separators/);
  assert.equal(ticks.anchor.kind, "pdf_overlay_ticks");
  assert.deepEqual(ticks.options, ["Yes", "No"]);
  assert.deepEqual(other.anchor, { kind: "pdf_overlay", page: 1, x: 300, y: 200, width: 100, height: 14 }, "no printed box there: kept as proposed");
});

test("a box ruled with writing lines is mapped with its rows, so the answer is written on the lines", async () => {
  const { form } = await analyseFormFile({ file: decoded(await ruledBoxesPdf()), fileName: "ruled.pdf", mode: "demo", rulesOnly: true });
  const gp = byLabel(form.fields, /^Name and full address of GP's surgery$/);
  assert.equal(gp.anchor.kind, "pdf_overlay");
  if (gp.anchor.kind === "pdf_overlay") {
    assert.deepEqual(gp.anchor.ruledRows, [
      { y: 334, height: 17 },
      { y: 317, height: 17 },
      { y: RULED.address.y, height: 17 },
    ]);
  }
  assert.match(gp.note ?? "", /3 printed lines/);
  const history = form.fields.find((f) => f.anchor.kind === "pdf_overlay" && Math.abs(f.anchor.x - (RULED.history.x + 2)) < 1);
  assert.ok(history && history.anchor.kind === "pdf_overlay");
  assert.equal(history.anchor.ruledRows?.length, 5);
  assert.deepEqual(checkFormDefinition(form), []);
});

test("the live outline of a flat PDF lists its printed boxes compactly", async () => {
  const parsed = await parseFormFile(decoded(await flatBoxesPdf()));
  assert.equal(parsed.kind, "pdf_flat");
  if (parsed.kind !== "pdf_flat") return;
  const text = renderPdfOutline(parsed.pdf, "pdf_flat");
  assert.match(text, /answer boxes: .*\[x=200 y=730 w=100 h=17 slots=3\]/);
  assert.match(text, /tick boxes: .*\[x=200 y=620 s=17 "Yes"\] \[x=246 y=620 s=17 "No"\]/);
  // Date, description, Yes/No row, comb, print name, lone tick.
  assert.equal(flatBoxQuestions(parsed.pdf).length, 6);
});

test("a fillable PDF's table of fields becomes one table question filled from the appointments", async () => {
  const { form } = await analyseFormFile({ file: decoded(await tableFormPdf()), fileName: "claim.pdf", mode: "demo", rulesOnly: true });
  assert.equal(form.kind, "pdf_acroform");
  const tables = form.fields.filter((f) => f.answerType === "table");
  assert.equal(tables.length, 1);
  const t = tables[0];
  assert.equal(t.label, "Details of the treatment you are claiming for");
  assert.deepEqual(t.fillSource, { kind: "appointments_table", columns: { date: "date", service: "service", amount: "amount", paid: "paid" } });
  assert.equal(t.anchor.kind, "pdf_table");
  assert.equal(t.confidence, "low", "rules mode stays low confidence");
  // The 16 cells are no longer separate questions; the decoys still are.
  assert.ok(!form.fields.some((f) => f.anchor.kind === "pdf_field" && /Row\d|^PAID/.test(f.anchor.fieldName)));
  for (const name of ["Surname", "Surname_2", "Text Field 1", "Text Field 6"]) assert.ok(form.fields.some((f) => f.anchor.kind === "pdf_field" && f.anchor.fieldName === name), name);
  assert.ok(form.analysis.warnings.some((w) => /The 4-row table .* is one question \(16 cell questions were combined\)/.test(w)));
  assert.deepEqual(checkFormDefinition(form), []);
  // IDs stay in document order: the table sits where its first cell was.
  assert.deepEqual(form.fields.map((f) => f.id), form.fields.map((_, i) => `F-${String(i + 1).padStart(2, "0")}`));
  assert.equal(form.fields[0].answerType, "table");
});

test("a table whose cells were all left for the referrer stays blank", async () => {
  const parsed = await parseFormFile(decoded(await tableFormPdf()));
  const raws = proposeFieldsByRules(parsed).map((r) => (/Row\d|^PAID/.test(r.anchorRef) ? { ...r, fillSource: "leave_blank" as const } : r));
  const { fields } = postValidateFields(parsed, raws);
  const t = fields.find((f) => f.answerType === "table");
  assert.deepEqual(t?.fillSource, { kind: "leave_blank" });
  assert.equal(t?.required, false);
});

test("BLOCK CAPITALS is part of the attested map only when set (existing map hashes are unchanged)", async () => {
  const { form } = await analyseFormFile({ file: decoded(await flatBoxesPdf()), fileName: "flat.pdf", mode: "demo", rulesOnly: true });
  const { uppercase, ...without } = form;
  assert.equal(uppercase, true);
  assert.equal(formMapSha256(without), formMapSha256({ ...without, uppercase: false }), "absent and false hash alike");
  assert.notEqual(formMapSha256(form), formMapSha256(without), "switching capitals on changes the attested map");
});
