/**
 * S2 forms-engine tests on synthetic PDFs (the real insurer PDFs are not in git):
 * - tables of fields in a fillable PDF: detection (rows by position, not by name; headers; label),
 *   filling, rows beyond the table and shortened rows on the continuation sheet as a table, printed
 *   "Yes / No" circled instead of overwritten;
 * - printed boxes of a flat PDF: answer boxes, tick boxes, date slots, combs; frames and boxes that
 *   hold text are not answer spaces;
 * - flat-PDF marks: dates between the printed slashes, an X in the chosen tick box, BLOCK CAPITALS,
 *   overlay tables.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { fillPdf } from "./pdf-fill";
import { datePartsForSlots, ticksFor } from "./pdf-overlay-marks";
import { readPdfForm } from "./pdf-outline";
import { detectPdfFieldTables, pdfTableAnchorOf, rowNumberedName } from "./pdf-table";
import { RULED, ROW_STEP, ROW_TOP, flatBoxesPdf, ruledBoxesPdf, tableFormPdf } from "./pdf-s2-fixtures";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high", ...rest };
}

function formOf(fields: FormField[], kind: FormDefinition["kind"], extra: Partial<FormDefinition> = {}): FormDefinition {
  return {
    id: "frm_s2",
    tenantId: "demo",
    referrer: { name: "Test Insurer (fictional)", type: "insurer" },
    title: "Test form",
    file: { fileName: "t.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind,
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...extra,
  };
}

type Item = { str: string; x: number; y: number };

async function textItems(bytes: Uint8Array): Promise<Item[][]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const pages: Item[][] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.flatMap((it) => ("str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }] : [])));
  }
  await task.destroy();
  return pages;
}

/** Straight 2-point strokes and curved paths drawn on a page (bounding boxes, no transforms used by pdf-lib's drawLine / drawEllipse). */
async function drawnPaths(bytes: Uint8Array, pageNumber: number): Promise<{ lines: Array<{ x0: number; y0: number; x1: number; y1: number }>; curves: Array<{ x0: number; y0: number; x1: number; y1: number }> }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const ol = await (await pdf.getPage(pageNumber)).getOperatorList();
  const lines: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const curves: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (let i = 0; i < ol.fnArray.length; i += 1) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === pdfjs.OPS.transform) {
      const [a, b, c, d, e, f] = args as number[];
      ctm = [ctm[0] * a + ctm[2] * b, ctm[1] * a + ctm[3] * b, ctm[0] * c + ctm[2] * d, ctm[1] * c + ctm[3] * d, ctm[0] * e + ctm[2] * f + ctm[4], ctm[1] * e + ctm[3] * f + ctm[5]];
    } else if (fn === pdfjs.OPS.constructPath) {
      const path = (args[1] as ArrayLike<unknown>)?.[0] as ArrayLike<number> | undefined;
      const mm = args[2] as number[] | null;
      if (!path || !mm) continue;
      const ops: number[] = [];
      for (let k = 0; k < path.length; ) {
        ops.push(path[k]);
        k += path[k] === 0 || path[k] === 1 ? 3 : path[k] === 2 ? 7 : path[k] === 3 ? 5 : 1;
      }
      const p = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
      const [ax, ay] = p(mm[0], mm[1]);
      const [bx, by] = p(mm[2], mm[3]);
      const bbox = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      if (ops.includes(2)) curves.push(bbox);
      // pdf-lib's drawLine writes "m m l": moves, then one line.
      else if (ops.filter((op) => op !== 0).length === 1 && ops[ops.length - 1] === 1) lines.push(bbox);
    }
  }
  await task.destroy();
  return { lines, curves };
}

/* Tables of fields ------------------------------------------------------------------------------ */

test("row-numbered names: Row1 / _2 suffixes only", () => {
  assert.deepEqual(rowNumberedName("Date of treatmentRow1"), { base: "Date of treatment", n: 1 });
  assert.deepEqual(rowNumberedName("Fee_3"), { base: "Fee", n: 3 });
  assert.deepEqual(rowNumberedName("form.Amount row 12"), { base: "Amount", n: 12 });
  assert.equal(rowNumberedName("Text Field 12"), null);
  assert.equal(rowNumberedName("YESNO7"), null);
});

test("detectPdfFieldTables: one table, rows by position (reversed names follow the page), headers and label", async () => {
  const outline = await readPdfForm(await tableFormPdf());
  assert.equal(outline.classification, "acroform");
  assert.equal(outline.boxes, undefined, "boxes are read for flat PDFs only");
  const tables = detectPdfFieldTables(outline);
  assert.equal(tables.length, 1, "decoys (Surname/Surname_2, Text Field grids) are not tables");
  const t = tables[0];
  assert.deepEqual(
    t.columns.map((c) => [c.key, c.header]),
    [
      ["date", "Date of treatment"],
      ["service", "Treatment received"],
      ["amount", "Amount of the bill"],
      ["paid", "Has this bill been paid?"],
    ],
  );
  assert.deepEqual(
    t.rows.map((r) => [r.date, r.paid]),
    [
      ["Date of treatmentRow1", "PAID4"],
      ["Date of treatmentRow2", "PAID3"],
      ["Date of treatmentRow3", "PAID2"],
      ["Date of treatmentRow4", "PAID1"],
    ],
  );
  // Widget rectangles include their border: tops within a point of the drawn rows.
  [700, 676, 652, 628].forEach((top, i) => assert.ok(Math.abs(t.rowTops[i] - top) <= 1, `row ${i + 1} top ${t.rowTops[i]}`));
  assert.ok(Math.abs(t.rowHeight - 22) <= 1);
  assert.equal(t.label, "Details of the treatment you are claiming for");
  assert.equal(t.guidance, "Please attach the invoices.");
  assert.equal(t.fieldNames.length, 16);
});

test("fillPdf pdf_table: rows into the fields, printed Yes / No circled, extra and shortened rows on the continuation sheet", async () => {
  const bytes = await tableFormPdf();
  const table = detectPdfFieldTables(await readPdfForm(bytes))[0];
  const f = field("F-01", table.label, pdfTableAnchorOf(table), {
    answerType: "table",
    fillSource: { kind: "appointments_table", columns: { date: "date", service: "service", amount: "amount", paid: "paid" } },
  });
  const long = "Physiotherapy follow-up session with manual therapy, soft tissue release, taping and a home exercise programme review";
  const rows = [
    { date: "18/03/2026", service: "Physiotherapy initial assessment", amount: "£75.00", paid: "Yes" },
    { date: "25/03/2026", service: long, amount: "£55.00", paid: "No" },
    { date: "01/04/2026", service: "Physiotherapy follow-up session", amount: "£55.00", paid: "Yes" },
    { date: "08/04/2026", service: "Physiotherapy follow-up session", amount: "£55.00", paid: "Yes" },
    { date: "22/04/2026", service: "Physiotherapy follow-up session", amount: "£55.00", paid: "No" },
    { date: "06/05/2026", service: "Physiotherapy session and discharge", amount: "", paid: "" },
  ];
  const warnings: string[] = [];
  const out = await fillPdf(bytes, formOf([f], "pdf_acroform"), { "F-01": { text: "", rows } }, { draft: true, flatten: false, onWarning: (m) => warnings.push(m) });
  const doc = await PDFDocument.load(out);
  const form = doc.getForm();
  assert.equal(form.getTextField("Date of treatmentRow1").getText(), "18/03/2026");
  assert.equal(form.getTextField("Amount of the billRow4").getText(), "£55.00");
  assert.equal(form.getTextField("Treatment receivedRow1").getText(), "Physiotherapy initial assessment");
  // The long answer is shortened in its cell (two lines at most, ending "…").
  assert.match(form.getTextField("Treatment receivedRow2").getText() ?? "", /…$/);
  // Printed "Yes / No": nothing written over it – the chosen word is circled.
  assert.equal(form.getTextField("PAID4").getText() ?? "", "");
  assert.equal(form.getTextField("PAID3").getText() ?? "", "");
  const { curves } = await drawnPaths(out, 1);
  const inPaidColumn = curves.filter((c) => c.x0 >= 455 && c.x1 <= 520 && c.y0 >= ROW_TOP - 4 * ROW_STEP && c.y1 <= ROW_TOP);
  assert.equal(inPaidColumn.length, 4, "one circle per printed Yes / No answered");
  const yesCircle = inPaidColumn.find((c) => c.y1 <= ROW_TOP && c.y0 >= ROW_TOP - ROW_STEP)!;
  assert.ok(yesCircle.x1 < 485, "row 1: Yes circled (left word)");
  const noCircle = inPaidColumn.find((c) => c.y1 <= ROW_TOP - ROW_STEP && c.y0 >= ROW_TOP - 2 * ROW_STEP)!;
  assert.ok(noCircle.x0 > 480, "row 2: No circled (right word)");

  assert.equal(doc.getPageCount(), 2, "continuation sheet added");
  const text = (await textItems(out))[1].map((i) => i.str).join(" ");
  assert.match(text, /Details of the treatment you are claiming for \(continued\)/);
  assert.match(text, /Rows shortened on the form, in full, and rows 5 onwards/);
  assert.match(text, /22\/04\/2026/);
  assert.match(text, /06\/05\/2026/);
  assert.match(text, /home exercise/, "the shortened row in full");
  assert.ok(!/18\/03\/2026/.test(text), "rows that fit are not repeated");
  assert.ok(warnings.some((w) => /has 4 rows; the other 2 rows are on the continuation sheet/.test(w)));
  assert.ok(warnings.some((w) => /1 row was too long for the table's cells/.test(w)));
});

/* Flat PDFs: printed boxes ---------------------------------------------------------------------- */

test("readPdfForm (flat): answer boxes, tick boxes, date slots and combs; frames and used boxes are not answer spaces", async () => {
  const outline = await readPdfForm(await flatBoxesPdf());
  assert.equal(outline.classification, "flat");
  const boxes = outline.boxes ?? [];
  const at = (x: number, y: number) => boxes.find((b) => Math.abs(b.x - x) < 1.5 && Math.abs(b.y - y) < 1.5);
  const date = at(200, 730);
  assert.equal(date?.kind, "box");
  assert.equal(date?.slots?.length, 3);
  assert.ok(Math.abs(date!.slots![0].width - 32) < 1.5 && Math.abs(date!.slots![1].x - 237) < 1.5);
  assert.equal(at(200, 660)?.kind, "box");
  assert.equal(at(200, 620)?.kind, "tick");
  assert.equal(at(246, 620)?.kind, "tick");
  const comb = at(200, 580);
  assert.equal(comb?.kind, "box");
  assert.equal(comb?.slots?.length, 8);
  assert.ok(Math.abs(comb!.width - 112) < 1.5);
  assert.equal(at(200, 500)?.kind, "box", "the box inside the frame");
  assert.equal(at(30, 400), undefined, "the frame");
  assert.equal(at(200, 450), undefined, "a box with printed text in it");
  assert.equal(at(500, 300)?.kind, "tick");
  assert.equal(boxes.filter((b) => b.kind === "tick").length, 3);
});

test("flat marks: date parts per slot; ticks for yes/no, choices and single boxes", () => {
  assert.deepEqual(datePartsForSlots("2026-03-18", 3), ["18", "03", "2026"]);
  assert.deepEqual(datePartsForSlots("2026-03-18", 2), ["03", "2026"]);
  assert.deepEqual(datePartsForSlots("2026-03-18", 8), ["1", "8", "0", "3", "2", "0", "2", "6"]);
  assert.equal(datePartsForSlots("2026-03-18", 4), null);
  assert.deepEqual(ticksFor({ value: true }, ["Yes", "No"]), ["Yes"]);
  assert.deepEqual(ticksFor({ value: false }, ["Yes", "No"]), ["No"]);
  assert.deepEqual(ticksFor({ text: "Claims", value: "Claims" }, ["Policy administration", "Claims", "Specific Claim"]), ["Claims"]);
  assert.deepEqual(ticksFor({ value: true }, ["Physiotherapist"]), ["Physiotherapist"]);
  assert.deepEqual(ticksFor({ value: false }, ["Physiotherapist"]), []);
  assert.deepEqual(ticksFor({ text: "Not recorded" }, ["Yes", "No"]), [], "unknown answers tick nothing");
});

test("fillPdf on a flat PDF: dates between the slashes, an X in the chosen box, BLOCK CAPITALS, overlay table rows", async () => {
  const bytes = await flatBoxesPdf();
  const fields = [
    field("F-01", "When did the symptoms start?", { kind: "pdf_overlay", page: 1, x: 202, y: 732, width: 96, height: 13, dateSlots: [{ x: 200, width: 32 }, { x: 237, width: 27 }, { x: 269, width: 31 }] }, { answerType: "date" }),
    field("F-02", "Please describe the condition", { kind: "pdf_overlay", page: 1, x: 202, y: 662, width: 336, height: 46 }, { answerType: "long_text" }),
    field("F-03", "Is there a referral letter?", { kind: "pdf_overlay_ticks", page: 1, options: [{ option: "Yes", x: 200, y: 620, size: 16.8 }, { option: "No", x: 246, y: 620, size: 16.8 }] }, { answerType: "yes_no", options: ["Yes", "No"] }),
    field(
      "F-04",
      "Sessions",
      { kind: "pdf_overlay_table", page: 1, columns: [{ key: "date", header: "Date", x: 40, width: 80 }, { key: "service", header: "Treatment", x: 120, width: 200 }], rowTops: [380, 360], rowHeight: 20 },
      { answerType: "table", fillSource: { kind: "appointments_table", columns: { date: "date", service: "service" } } },
    ),
  ];
  const warnings: string[] = [];
  const out = await fillPdf(
    bytes,
    formOf(fields, "pdf_flat", { uppercase: true }),
    {
      "F-01": { text: "18/03/2026", value: "2026-03-18" },
      "F-02": { text: "Neck pain and stiffness after a collision." },
      "F-03": { text: "Yes", value: true },
      "F-04": { text: "", rows: [{ date: "18/03/2026", service: "Initial assessment" }, { date: "25/03/2026", service: "Follow-up" }, { date: "01/04/2026", service: "Discharge" }] },
    },
    { draft: false, flatten: true, onWarning: (m) => warnings.push(m) },
  );
  const pages = await textItems(out);
  const page1 = pages[0];
  const find = (s: string) => page1.find((i) => i.str === s);
  assert.ok(find("18") && find("18")!.x > 200 && find("18")!.x < 232, "DD in the first slot");
  assert.ok(find("03") && find("03")!.x > 237 && find("03")!.x < 264, "MM in the second slot");
  assert.ok(find("2026") && find("2026")!.x > 269 && find("2026")!.x < 300, "YYYY in the third slot");
  assert.ok(!page1.some((i) => i.str.includes("18/03/2026") && i.y > 700), "the date is not written over the slashes");
  assert.ok(page1.some((i) => i.str === "NECK PAIN AND STIFFNESS AFTER A COLLISION."), "BLOCK CAPITALS");
  // Overlay table: two printed rows, the third on the continuation sheet.
  assert.ok(find("INITIAL ASSESSMENT") && Math.abs(find("INITIAL ASSESSMENT")!.x - 122) < 1);
  assert.ok(find("25/03/2026") && find("25/03/2026")!.y < 360 && find("25/03/2026")!.y > 340);
  assert.equal(pages.length, 2);
  assert.match(pages[1].map((i) => i.str).join(" "), /01\/04\/2026 .*Discharge/);
  assert.ok(warnings.some((w) => /has 2 rows; the other 1 row is on the continuation sheet/.test(w)));
  // The X is in the Yes box, not the No box.
  const { lines } = await drawnPaths(out, 1);
  const inBox = (x: number) => lines.filter((l) => l.x0 >= x && l.x1 <= x + 16.8 && l.y0 >= 620 && l.y1 <= 636.8 && l.x1 - l.x0 > 4);
  assert.equal(inBox(200).length, 2, "two strokes of the X in Yes");
  assert.equal(inBox(246).length, 0, "nothing in No");
});

test("ruled answer boxes: the printed writing lines are read, and an answer is written one line per row, on the line", async () => {
  const bytes = await ruledBoxesPdf();
  const outline = await readPdfForm(bytes);
  const box = (outline.boxes ?? []).find((b) => Math.abs(b.x - RULED.history.x) < 1.5 && Math.abs(b.y - RULED.history.y) < 1.5);
  assert.ok(box);
  // Five rows of 18 pt: four rules inside the box, top to bottom.
  assert.deepEqual(box.rules, [492, 474, 456, 438]);
  const address = (outline.boxes ?? []).find((b) => Math.abs(b.x - RULED.address.x) < 1.5);
  assert.deepEqual(address?.rules, [334, 317]);

  const rows = [492, 474, 456, 438, 420].map((y, i) => ({ y, height: i === 0 ? 18 : 18 }));
  const history = "Right rotator cuff related shoulder pain after lifting a 12 kg cabin case into an overhead locker on 22/08/2026. No red flags; cervical spine cleared. Improving with exercise-based physiotherapy: NPRS 7/10 to 4/10, QuickDASH 52.3 to 29.5, PSFS 2.7 to 5.3. Other condition of note: hypothyroidism, controlled on levothyroxine.";
  const form = formOf(
    [field("F-01", "Full history", { kind: "pdf_overlay", page: 1, x: 76, y: 422, width: 506, height: 86, ruledRows: rows }, { answerType: "long_text" })],
    "pdf_flat",
    { uppercase: true },
  );
  const warnings: string[] = [];
  const out = await fillPdf(bytes, form, { "F-01": { text: history } }, { draft: false, flatten: true, onWarning: (m) => warnings.push(m) });
  const written = (await textItems(out))[0].filter((i) => i.x > 70 && i.x < 80 && i.y > 420 && i.y < 510);
  assert.ok(written.length >= 3, "the answer takes several rows");
  for (const line of written) {
    const row = rows.find((r) => line.y > r.y && line.y < r.y + r.height);
    assert.ok(row, `"${line.str}" sits in a row`);
    const lift = line.y - row.y;
    assert.ok(lift >= 2.4 && lift <= 4.1, `"${line.str}" sits ${lift.toFixed(1)} pt above its rule (never struck through)`);
  }
  assert.equal(new Set(written.map((l) => Math.round(l.y))).size, written.length, "one line of text per row");
  assert.match(written[0].str, /^RIGHT ROTATOR CUFF/);
  assert.deepEqual(warnings, []);

  // Longer than the rows: leading words with a marker, the full answer on the continuation sheet.
  const longWarnings: string[] = [];
  const long = await fillPdf(bytes, form, { "F-01": { text: `${history} ${history} ${history}` } }, { draft: false, flatten: true, onWarning: (m) => longWarnings.push(m) });
  const pages = await textItems(long);
  assert.equal(pages.length, 2);
  assert.ok(pages[0].filter((i) => i.x > 70 && i.x < 80 && i.y > 420 && i.y < 510).length <= rows.length);
  assert.ok(longWarnings.some((w) => /longer than the printed lines/.test(w)));

  // A box moved away from its rows (staff edited the position): written as a plain box.
  const moved = formOf([field("F-01", "Full history", { kind: "pdf_overlay", page: 1, x: 76, y: 200, width: 506, height: 86, ruledRows: rows }, { answerType: "long_text" })], "pdf_flat");
  const plain = (await textItems(await fillPdf(bytes, moved, { "F-01": { text: "Short answer" } }, { draft: false, flatten: true })))[0];
  assert.ok(plain.some((i) => i.str === "Short answer" && i.y > 200 && i.y < 286));
});
