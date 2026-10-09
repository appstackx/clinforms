/**
 * Demonstration footer (forms/demo-notice.ts via forms/render-form.ts): a form with demoNotice carries
 * the line on every page of its draft and final renders (PDF: bottom margin, continuation sheets,
 * rotated and cropped pages; Word: a footer paragraph on every footer the sections show), and a form
 * without one comes out byte-for-byte as the fill produced it. Synthetic files only (pdf-lib / PizZip).
 */
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import PizZip from "pizzip";
import type { FormAnchor, FormDefinition, FormField } from "../core/types";
import { demoFormNotice } from "../core/wording";
import { addDocxDemoNotice, normaliseDemoNotice, stampPdfDemoNotice } from "./demo-notice";
import { buildDocxOutline } from "./docx-outline";
import { fillDocx } from "./docx-fill";
import type { DecodedFormFile } from "./file";
import { fillPdf } from "./pdf-fill";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";
import { formFileBaseName, renderFormFile } from "./render-form";

const NOTICE = demoFormNotice("Example Health Insurance (fictional)");
const PDF_MIME = "application/pdf" as const;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function field(id: string, label: string, anchor: FormAnchor, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high", ...rest };
}

function form(kind: FormDefinition["kind"], fields: FormField[], demoNotice?: string): FormDefinition {
  return {
    id: "frm_demo_notice_test",
    tenantId: "demo",
    referrer: { name: "Example Health Insurance (fictional)", type: "insurer" },
    title: "Therapy update",
    file: { fileName: kind === "docx" ? "t.docx" : "t.pdf", mimeType: kind === "docx" ? DOCX_MIME : PDF_MIME, sha256: "0".repeat(64), sizeBytes: 1 },
    kind,
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...(demoNotice !== undefined && { demoNotice }),
  };
}

const decoded = (bytes: Uint8Array, mimeType: DecodedFormFile["mimeType"]): DecodedFormFile =>
  ({ bytes, mimeType, sha256: "0".repeat(64), sizeBytes: bytes.length }) as DecodedFormFile;

/* PDF ------------------------------------------------------------------------------------------ */

/** Two pages: a fillable name box and a small multi-line box (a long answer overflows to a continuation sheet). */
async function twoPageForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  p1.drawText("Patient name", { x: 40, y: 760, size: 9, font });
  const pdfForm = doc.getForm();
  pdfForm.createTextField("name").addToPage(p1, { x: 120, y: 754, width: 200, height: 18, font });
  const p2 = doc.addPage([595, 842]);
  p2.drawText("Progress", { x: 40, y: 760, size: 9, font });
  const progress = pdfForm.createTextField("progress");
  progress.enableMultiline();
  progress.addToPage(p2, { x: 40, y: 700, width: 200, height: 40, font });
  return doc.save();
}

const PDF_FIELDS = [
  field("F-01", "Patient name", { kind: "pdf_field", fieldName: "name", fieldType: "text" }),
  field("F-02", "Progress", { kind: "pdf_field", fieldName: "progress", fieldType: "text" }, { answerType: "long_text" }),
];
const LONG = Array.from({ length: 60 }, (_, i) => `Session ${i + 1} went to plan.`).join(" ");

interface Placed {
  str: string;
  /** Position in the displayed page (viewport, y down) and the text direction. */
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  pageHeight: number;
}

async function pageItems(bytes: Uint8Array): Promise<Placed[][]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const out: Placed[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: Placed[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const m = pdfjs.Util.transform(viewport.transform, it.transform) as number[];
      items.push({ str: it.str, x: m[4], y: m[5], dirX: m[0], dirY: m[1], pageHeight: viewport.height });
    }
    out.push(items);
  }
  await task.destroy();
  return out;
}

const joined = (items: Placed[]) => items.map((i) => i.str).join(" ");

test("PDF: the demo notice is on every page of the draft and the final render, continuation sheet included", async () => {
  const bytes = await twoPageForm();
  for (const draft of [true, false]) {
    const out = await renderFormFile({
      form: form("pdf_acroform", PDF_FIELDS, NOTICE),
      file: decoded(bytes, PDF_MIME),
      answers: { "F-01": { text: "Alex Example" }, "F-02": { text: LONG } },
      draft,
      format: "original",
    });
    assert.ok(out.warnings.some((w) => /continuation sheet/.test(w)), "the long answer overflowed");
    const pages = await pageItems(out.bytes);
    assert.equal(pages.length, 3, "two form pages and a continuation sheet");
    pages.forEach((items, i) => {
      const notice = items.find((it) => it.str.includes("Public form used for demonstration only"));
      assert.ok(notice, `page ${i + 1} (${draft ? "draft" : "final"}) carries the notice: ${joined(items).slice(0, 200)}`);
      assert.ok(joined(items).includes("not affiliated with or endorsed by Example Health Insurance (fictional). Fictional patient data."));
      // In the bottom margin, horizontal, below everything else on the page.
      assert.ok(notice.pageHeight - notice.y <= 12, `page ${i + 1}: ${notice.pageHeight - notice.y} pt from the bottom`);
      assert.ok(notice.dirX > 0 && Math.abs(notice.dirY) < 1e-6);
      const draftLine = items.find((it) => it.str.startsWith("DRAFT - awaiting clinician approval"));
      if (draft) {
        assert.ok(draftLine, "the DRAFT line is still there");
        assert.ok(notice.y > draftLine.y + 4, "the notice sits below the DRAFT line, not on it");
      } else {
        assert.equal(draftLine, undefined);
      }
    });
  }
});

test("PDF: a form without demoNotice is byte-for-byte what the fill produced", async () => {
  const bytes = await twoPageForm();
  const answers = { "F-01": { text: "Alex Example" }, "F-02": { text: LONG } };
  for (const draft of [true, false]) {
    const plain = form("pdf_acroform", PDF_FIELDS);
    const filled = await fillPdf(bytes, plain, answers, { draft, flatten: true });
    // The fill is deterministic, so the render can be compared with it byte for byte.
    assert.deepEqual(await fillPdf(bytes, plain, answers, { draft, flatten: true }), filled);
    const rendered = await renderFormFile({ form: plain, file: decoded(bytes, PDF_MIME), answers, draft, format: "original" });
    assert.ok(Buffer.from(rendered.bytes).equals(Buffer.from(filled)), `render = fill (${draft ? "draft" : "final"})`);
    for (const blank of ["", "   "]) {
      const same = await renderFormFile({ form: form("pdf_acroform", PDF_FIELDS, blank), file: decoded(bytes, PDF_MIME), answers, draft, format: "original" });
      assert.ok(Buffer.from(same.bytes).equals(Buffer.from(filled)), "an empty notice changes nothing");
    }
    assert.ok(!joined((await pageItems(rendered.bytes)).flat()).includes("demonstration"));
  }
  const input = new Uint8Array([1, 2, 3]);
  assert.equal(await stampPdfDemoNotice(input, undefined, { draft: false }), input, "no notice: the same bytes object back");
});

test("PDF: rotated and cropped pages get the notice upright at their visible bottom edge", async () => {
  const doc = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const page = doc.addPage([600, 800]);
    page.setRotation(degrees(angle));
    page.setCropBox(20, 30, 560, 740);
    page.drawText(`Rotated ${angle}`, { x: 100, y: 400, size: 12 });
  }
  const stamped = await stampPdfDemoNotice(await doc.save(), NOTICE, { draft: false });
  const pages = await pageItems(stamped);
  assert.equal(pages.length, 4);
  pages.forEach((items, i) => {
    const notice = items.find((it) => it.str.includes("Public form used for demonstration only"));
    assert.ok(notice, `page ${i + 1}`);
    // Reads left to right on the displayed page, within 12 pt of its bottom edge.
    assert.ok(notice.dirX > 0 && Math.abs(notice.dirY) < 1e-6, `page ${i + 1} direction ${notice.dirX},${notice.dirY}`);
    assert.ok(notice.pageHeight - notice.y > 0 && notice.pageHeight - notice.y <= 12, `page ${i + 1}: ${notice.pageHeight - notice.y} pt from the bottom`);
  });
});

test("PDF: the red DRAFT line sits in the visible page of a print-ready file (crop box inside the media box, rotated)", async () => {
  // As Aviva CM016: media box 652 × 899 with crop marks, crop box 607 × 853 offset by 22.68 pt.
  const doc = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const page = doc.addPage([652, 899]);
    page.setCropBox(22.68, 22.68, 607, 853);
    page.setRotation(degrees(angle));
  }
  const out = await renderFormFile({ form: form("pdf_flat", [], NOTICE), file: decoded(await doc.save(), PDF_MIME), answers: {}, draft: true, format: "original" });
  const pages = await pageItems(out.bytes);
  assert.equal(pages.length, 4);
  pages.forEach((items, i) => {
    const line = items.find((it) => it.str.startsWith("DRAFT - awaiting clinician approval"));
    assert.ok(line, `page ${i + 1}: ${joined(items)}`);
    const fromBottom = line.pageHeight - line.y;
    assert.ok(fromBottom > 4 && fromBottom <= 20, `page ${i + 1}: the DRAFT line is ${fromBottom} pt above the visible bottom edge`);
    assert.ok(line.dirX > 0 && Math.abs(line.dirY) < 1e-6, `page ${i + 1} reads left to right`);
    const notice = items.find((it) => it.str.includes("Public form used for demonstration only"));
    assert.ok(notice && notice.y > line.y + 4, `page ${i + 1}: the notice sits below the DRAFT line`);
    // The diagonal watermark crosses the visible page at 45° (pdf.js may split its first letter off).
    const mark = items.find((it) => it.str.includes("NOT A"));
    assert.ok(mark, `page ${i + 1}: the watermark`);
    assert.ok(mark.dirX > 0 && mark.dirY < 0 && Math.abs(mark.dirX + mark.dirY) < 1e-6, `page ${i + 1}: up and to the right`);
    assert.ok(mark.x > 0 && mark.x < (i % 2 ? 853 : 607) / 2, `page ${i + 1}: starts in the left half of the visible page`);
  });
});

test("normaliseDemoNotice: one printable line", () => {
  assert.equal(normaliseDemoNotice("  A\n notice\t here "), "A notice here");
  assert.equal(normaliseDemoNotice(undefined), "");
  assert.equal(demoFormNotice(), "Public form used for demonstration only – not affiliated with or endorsed by its publisher. Fictional patient data.");
  assert.equal(demoFormNotice("Bupa"), "Public form used for demonstration only – not affiliated with or endorsed by Bupa. Fictional patient data.");
});

/* Word ------------------------------------------------------------------------------------------ */

const CT_BASE =
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>';
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const TABLE = `<w:tbl><w:tr><w:tc>${p("Progress")}</w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`;
const DOCX_FIELDS = [field("F-01", "Progress", { kind: "docx", target: "table_cell", blockId: "t0.r0.c1" }, { answerType: "long_text" })];

function docx(opts: { body: string; footers?: Record<string, string>; rels?: string; settings?: string; ctExtra?: string }): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${CT_BASE}${opts.ctExtra ?? ""}</Types>`);
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${opts.body}</w:body></w:document>`);
  if (opts.rels !== undefined) {
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${opts.rels}</Relationships>`);
  }
  if (opts.settings) zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="${W}">${opts.settings}</w:settings>`);
  for (const [name, inner] of Object.entries(opts.footers ?? {})) {
    zip.file(`word/${name}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}" xmlns:r="${R}">${inner}</w:ftr>`);
  }
  return zip.generate({ type: "uint8array" });
}

const textOf = (xml: string) => Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g), (m) => m[1]).join("");
const FOOTER_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";

/** Footer part name per (section index, type), resolved through the relationships like Word does. */
function sectionFooters(bytes: Uint8Array): Array<Record<string, string>> {
  const zip = new PizZip(bytes);
  const rels = zip.file("word/_rels/document.xml.rels")?.asText() ?? "";
  const target = new Map(Array.from(rels.matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*\/>/g), (m) => [m[1], m[2]]));
  const docXml = zip.file("word/document.xml")!.asText();
  return Array.from(docXml.matchAll(/<w:sectPr\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:sectPr>)/g), (m) => {
    const out: Record<string, string> = {};
    for (const ref of Array.from((m[1] ?? "").matchAll(/<w:footerReference [^>]*?w:type="(\w+)"[^>]*?r:id="([^"]+)"[^>]*\/>/g))) out[ref[1]] = `word/${target.get(ref[2])}`;
    return out;
  });
}

test("Word: a form without footers gets a footer with the notice; the body and its answer spaces are unchanged", () => {
  const bytes = docx({ body: `${p("Therapy update")}${TABLE}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>` });
  const filled = fillDocx(bytes, form("docx", DOCX_FIELDS), { "F-01": { text: "Improving steadily." } }, { draft: false });
  const out = addDocxDemoNotice(filled, NOTICE);
  const zip = new PizZip(out);
  const footers = sectionFooters(out);
  assert.equal(footers.length, 1);
  assert.ok(footers[0].default, "the section now shows a default footer");
  const footerXml = zip.file(footers[0].default)!.asText();
  assert.equal(textOf(footerXml), NOTICE);
  assert.match(footerXml, /<w:color w:val="6B7280"\/>/);
  assert.match(footerXml, /<w:jc w:val="center"\/>/);
  assert.match(zip.file("[Content_Types].xml")!.asText(), new RegExp(`PartName="/${footers[0].default}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer\\+xml"`));
  assert.match(zip.file("word/_rels/document.xml.rels")!.asText(), new RegExp(`Type="${FOOTER_REL}"`));
  // footerReference comes before the page size in w:sectPr (schema order).
  assert.match(zip.file("word/document.xml")!.asText(), /<w:sectPr><w:footerReference [^>]*\/><w:pgSz /);
  const outline = (b: Uint8Array) => buildDocxOutline(b).blocks.map((x) => `${x.id}:${x.text}`);
  assert.deepEqual(outline(out), outline(filled));
});

test("Word: existing footers keep their content and get the notice; first-page and even-page footers are covered; inherited footers stay inherited", () => {
  const bytes = docx({
    body: [
      p("Section one"),
      `<w:p><w:pPr><w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:titlePg/></w:sectPr></w:pPr></w:p>`,
      p("Section two"),
      TABLE,
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`,
    ].join(""),
    rels: `<Relationship Id="rIdF1" Type="${FOOTER_REL}" Target="footer1.xml"/>`,
    footers: { "footer1.xml": p("Form ABC-1 (06/2026) Page 1") },
    settings: "<w:evenAndOddHeaders/>",
    ctExtra: '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
  });
  const out = addDocxDemoNotice(bytes, NOTICE);
  const zip = new PizZip(out);
  const [one, two] = sectionFooters(out);
  assert.equal(one.default, "word/footer1.xml");
  assert.ok(one.first && one.first !== one.default, "a first-page footer was added (titlePg)");
  assert.ok(one.even && one.even !== one.default, "an even-page footer was added (evenAndOddHeaders)");
  assert.deepEqual(two, {}, "section two still inherits section one's footers");
  assert.equal(textOf(zip.file("word/footer1.xml")!.asText()), `Form ABC-1 (06/2026) Page 1${NOTICE}`);
  assert.equal(textOf(zip.file(one.first)!.asText()), NOTICE);
  assert.equal(textOf(zip.file(one.even)!.asText()), NOTICE);
});

test("Word: render-form puts the notice on drafts and finals; without demoNotice the file is byte-for-byte the fill's", async () => {
  // PizZip stamps entry times: freeze the clock so two fills can be compared byte for byte.
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z").getTime() });
  try {
    const bytes = docx({ body: `${TABLE}<w:sectPr/>` });
    const answers = { "F-01": { text: "Improving steadily." } };
    for (const draft of [true, false]) {
      const labelled = await renderFormFile({ form: form("docx", DOCX_FIELDS, NOTICE), file: decoded(bytes, DOCX_MIME), answers, draft, format: "original" });
      const [footers] = sectionFooters(labelled.bytes);
      assert.equal(textOf(new PizZip(labelled.bytes).file(footers.default)!.asText()), NOTICE, draft ? "draft" : "final");

      const plain = form("docx", DOCX_FIELDS);
      const filled = fillDocx(bytes, plain, answers, { draft });
      const rendered = await renderFormFile({ form: plain, file: decoded(bytes, DOCX_MIME), answers, draft, format: "original" });
      assert.ok(Buffer.from(rendered.bytes).equals(Buffer.from(filled)), `render = fill (${draft ? "draft" : "final"})`);
      assert.deepEqual(sectionFooters(rendered.bytes), [{}]);
    }
  } finally {
    mock.timers.reset();
  }
  const input = new Uint8Array([1, 2, 3]);
  assert.equal(addDocxDemoNotice(input, "  "), input, "no notice: the same bytes object back");
});

test("PDF DRAFT: the red line moves above a printed page number; continuation sheets take the crop box's size", async () => {
  // A print-ready page (crop box inside the media box) with its page number where the red line goes.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([652, 899]);
  page.setCropBox(22.68, 22.68, 607, 853);
  page.drawText("3", { x: 22.68 + 300, y: 22.68 + 10, size: 9, font });
  const pdfForm = doc.getForm();
  const box = pdfForm.createTextField("progress");
  box.enableMultiline();
  box.addToPage(page, { x: 60, y: 700, width: 200, height: 40, font });
  const bytes = await doc.save();
  const out = await fillPdf(bytes, form("pdf_acroform", [field("F-01", "Progress", { kind: "pdf_field", fieldName: "progress", fieldType: "text" }, { answerType: "long_text" })]), { "F-01": { text: LONG } }, { draft: true, flatten: true });
  const pages = await pageItems(out);
  const line = pages[0].find((it) => it.str.startsWith("DRAFT - awaiting clinician approval"));
  const number = pages[0].find((it) => it.str === "3");
  assert.ok(line && number);
  // Viewport y runs down: the line's baseline sits above the top of the printed "3" (9 pt type).
  assert.ok(line.y < number.y - 9 * 0.7, `the red line (${line.y}) clears the page number (${number.y})`);
  assert.ok(line.pageHeight - line.y <= 34, "still at the foot of the page");
  // The continuation sheet is shown at the same size as the form's page.
  const filled = await PDFDocument.load(out);
  assert.equal(filled.getPageCount(), 2);
  const sheet = filled.getPage(1);
  assert.deepEqual([Math.round(sheet.getWidth()), Math.round(sheet.getHeight())], [607, 853]);
  const crop = sheet.getCropBox();
  assert.deepEqual([Math.round(crop.width), Math.round(crop.height)], [607, 853]);
});

test("an approved form the clinic only prefills is named _PREFILLED, never _SIGNED", () => {
  const report = { bundleSnapshot: { registration: { firstName: "Rebecca", lastName: "Lane" } }, version: 1 } as unknown as Parameters<typeof formFileBaseName>[0];
  const claim = form("pdf_acroform", [
    field("F-01", "Member's name", { kind: "pdf_field", fieldName: "name", fieldType: "text" }, { fillSource: { kind: "registration", path: "patient.fullName" } }),
    field("F-02", "Member's signature", { kind: "pdf_field", fieldName: "sig", fieldType: "text" }, { fillSource: { kind: "leave_blank" }, answerType: "signature", completedBy: "policyholder" }),
  ]);
  assert.equal(formFileBaseName(report, claim, { signed: true, dateIso: "2026-10-09" }), "Lane_R_Therapy-update_2026-10-09_PREFILLED");
  assert.equal(formFileBaseName(report, claim, { signed: false, dateIso: "2026-10-09" }), "Lane_R_Therapy-update_2026-10-09_DRAFT");
  assert.equal(formFileBaseName({ ...report, version: 2 }, claim, { signed: true, dateIso: "2026-10-09" }), "Lane_R_Therapy-update_2026-10-09_AMENDED-v2_PREFILLED");
  const own = form("pdf_acroform", [...claim.fields, field("F-03", "Therapist's signature", { kind: "pdf_field", fieldName: "tsig", fieldType: "text" }, { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature" })]);
  assert.equal(formFileBaseName(report, own, { signed: true, dateIso: "2026-10-09" }), "Lane_R_Therapy-update_2026-10-09_SIGNED");
});
