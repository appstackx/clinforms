import "server-only";

/**
 * PDF form → outline for the analysis and the mapping editor.
 *
 * readPdfForm(buf): AcroForm fields via pdf-lib (name, type text/checkbox/radio/dropdown, page,
 * rect in PDF points from the bottom-left, options) plus positioned page text via pdfjs-dist's legacy
 * build (loadPdfjs() in ./pdfjs.ts) for each field's nearbyText and for flat forms.
 * classification "acroform" when the PDF has fillable fields, else "flat" (best-effort overlay).
 *
 * nearbyText: the printed labels closest to the field – to its left on the same line, above it, or (for
 * a single tick box) just to its right – nearest first, joined with " | ".
 *
 * optionLabels (tick boxes and radio buttons): the label printed beside each widget, aligned with the
 * options (radio export values; a tick box's on-values when its widgets have different ones).
 * charGroup: runs of one-character boxes (forms/pdf-widgets.ts detectCharGroups) share a group ID.
 *
 * Owner: forms-engine agent. Signature final.
 */
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  type PDFField,
  type PDFWidgetAnnotation,
} from "pdf-lib";
import { HttpError } from "../api/http";
import type { PdfBox, PdfFormOutline } from "../core/types";
import { extractPageBoxes } from "./pdf-boxes";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";
import { charGroupNearbyText, detectCharGroups, widgetOptionLabels, type CharCellCandidate } from "./pdf-widgets";
import { annotatePdfSections, outlineTextItem } from "./pdf-sections";

export type PdfClassification = "acroform" | "flat";

export interface PdfFormReadResult extends PdfFormOutline {
  classification: PdfClassification;
  /** Plain-English caveats, e.g. "XFA form: only the AcroForm fields can be filled." */
  warnings: string[];
}

type FieldType = PdfFormOutline["fields"][number]["type"];
type Rect = { x: number; y: number; width: number; height: number };
type TextItem = { str: string; x: number; y: number; w: number; h: number };

/** Open a PDF with pdf-lib, translating failures into 422 FORM_INVALID. */
export async function loadPdfDocument(buf: Uint8Array): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(buf, { updateMetadata: false });
    // pdf-lib is lenient: make sure the document structure is really there.
    if (doc.getPageCount() === 0) throw new Error("no pages");
    doc.getForm();
    return doc;
  } catch (err) {
    const encrypted = err instanceof Error && /encrypt/i.test(err.message);
    throw new HttpError(422, encrypted ? "This PDF is password-protected" : "This PDF could not be read", {
      code: "FORM_INVALID",
      detail: encrypted
        ? "Remove the password (or ask the referrer for an unprotected copy) and upload it again."
        : "The file could not be opened as a PDF. Ask the referrer for the original form, or upload it as a Word document.",
    });
  }
}

export function pdfFieldType(field: PDFField): FieldType | null {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return "dropdown";
  return null;
}

/** Page index (0-based) of each widget annotation, by object reference. */
export function widgetPageIndex(doc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const ref = annots.get(k);
      if (ref instanceof PDFRef) map.set(ref.toString(), i);
    }
  });
  return map;
}

export function widgetPage(doc: PDFDocument, widget: PDFWidgetAnnotation, index: Map<string, number>): number {
  const ref = doc.context.getObjectRef(widget.dict);
  if (ref && index.has(ref.toString())) return index.get(ref.toString())!;
  const p = widget.P();
  if (p) {
    const i = doc.getPages().findIndex((page) => page.ref.toString() === p.toString());
    if (i >= 0) return i;
  }
  return 0;
}

function union(rects: Rect[]): Rect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Labels near a field, nearest first. */
function nearbyText(rect: Rect, items: TextItem[], type: FieldType, widgetRects: Rect[]): string {
  const scored: { text: string; score: number }[] = [];
  const midY = rect.y + rect.height / 2;
  for (const it of items) {
    const right = it.x + it.w;
    const sameLine = it.y >= rect.y - 4 && it.y <= rect.y + Math.max(rect.height, 10) + 2 && Math.abs(it.y + it.h / 2 - midY) < Math.max(rect.height, 14);
    if (sameLine && right <= rect.x + 3 && rect.x - right < 220) scored.push({ text: it.str, score: rect.x - right });
    const above = it.y >= rect.y + rect.height - 3 && it.y - (rect.y + rect.height) < 34;
    const overlapsX = it.x < rect.x + rect.width && right > rect.x - 12;
    if (above && overlapsX) scored.push({ text: it.str, score: (it.y - (rect.y + rect.height)) * 1.2 + Math.max(0, it.x - rect.x) * 0.02 });
  }
  // Tick boxes and radio buttons: the option label printed to the right of each box.
  if (type === "checkbox" || type === "radio") {
    for (const wr of widgetRects) {
      for (const it of items) {
        const sameLine = Math.abs(it.y + it.h / 2 - (wr.y + wr.height / 2)) < Math.max(wr.height, 10);
        if (sameLine && it.x >= wr.x + wr.width - 2 && it.x - (wr.x + wr.width) < 40) scored.push({ text: it.str, score: it.x - (wr.x + wr.width) - 5 });
      }
    }
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => a.score - b.score)
    .map((s) => s.text.trim())
    .filter((t) => t && !seen.has(t) && (seen.add(t), true))
    .slice(0, 4)
    .join(" | ")
    .slice(0, 240);
}

async function pageTextItems(buf: Uint8Array, warnings: string[], boxes?: PdfBox[]): Promise<{ page: number; items: TextItem[] }[]> {
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument(pdfjsDocumentParams(buf));
    try {
      const pdf = await task.promise;
      const pages: { page: number; items: TextItem[] }[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const items: TextItem[] = [];
        for (const raw of content.items) {
          if (!("str" in raw) || !raw.str.trim()) continue;
          const [, , , d, e, f] = raw.transform as number[];
          items.push({ str: raw.str, x: round(e), y: round(f), w: round(raw.width), h: round(raw.height || Math.abs(d) || 8) });
        }
        pages.push({ page: n, items });
        // Flat PDFs: the printed answer boxes and tick boxes (forms/pdf-boxes.ts).
        if (boxes) boxes.push(...(await extractPageBoxes(page, n, pdfjs.OPS as unknown as Record<string, number>, items).catch(() => [])));
      }
      return pages;
    } finally {
      await task.destroy();
    }
  } catch {
    warnings.push("The text printed on the PDF could not be read, so field labels may be missing. The fields themselves were found.");
    return [];
  }
}

/** Read a PDF form: fillable fields (pdf-lib) and positioned page text (pdfjs). */
export async function readPdfForm(buf: Uint8Array): Promise<PdfFormReadResult> {
  const doc = await loadPdfDocument(buf);
  const warnings: string[] = [];
  const form = doc.getForm();
  if (form.hasXFA()) warnings.push("This is an XFA (dynamic) form: only its standard fillable fields are used, and the dynamic layout is removed when it is filled.");
  const pageIndex = widgetPageIndex(doc);
  // A form without fillable fields is flat: its printed boxes are read too (forms/pdf-boxes.ts).
  const boxes: PdfBox[] | undefined = form.getFields().some((f) => pdfFieldType(f) !== null) ? undefined : [];
  const pageText = await pageTextItems(buf, warnings, boxes);
  const itemsByPage = new Map(pageText.map((p) => [p.page, p.items]));

  const fields: PdfFormOutline["fields"] = [];
  const charCells: CharCellCandidate[] = [];
  let signatures = 0;
  let buttons = 0;
  for (const field of form.getFields()) {
    const type = pdfFieldType(field);
    if (!type) {
      if (field instanceof PDFSignature) signatures++;
      else buttons++;
      continue;
    }
    const widgets = field.acroField.getWidgets();
    if (widgets.length === 0) continue;
    const page = widgetPage(doc, widgets[0], pageIndex);
    const rects = widgets.filter((w) => widgetPage(doc, w, pageIndex) === page).map((w) => w.getRectangle());
    const rect = union(rects);
    let options: string[] | undefined;
    if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) options = field.getOptions();
    // A tick box with several widgets and different on-values ("Yes" box and "no" box of one field):
    // its on-values are its options, like a radio group's export values.
    if (field instanceof PDFCheckBox) {
      const onValues = widgets.map((w) => (w.getOnValue() ?? PDFName.of("Yes")).decodeText());
      if (new Set(onValues).size > 1) options = onValues;
    }
    // The label printed beside each tick box / radio button, aligned with the options.
    let optionLabels: string[] | undefined;
    if (type === "checkbox" || type === "radio") {
      const labels = widgetOptionLabels(
        widgets.map((w) => ({ page: widgetPage(doc, w, pageIndex) + 1, rect: w.getRectangle() })),
        itemsByPage,
      );
      const aligned = type !== "radio" || options?.length === labels.length;
      if (aligned && labels.some(Boolean)) optionLabels = labels;
    }
    const name = field.getName();
    if (field instanceof PDFTextField && widgets.length === 1 && !field.isMultiline()) charCells.push({ name, page: page + 1, rect });
    fields.push({
      name,
      type,
      page: page + 1,
      rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
      ...(options && options.length > 0 && { options }),
      // Several widgets: their own labels are in optionLabels, so the nearby text leads with the question.
      nearbyText: nearbyText(rect, itemsByPage.get(page + 1) ?? [], type, widgets.length > 1 ? [] : rects),
      ...(optionLabels && { optionLabels }),
    });
  }
  // One-character boxes (D D M M Y Y Y Y): one group ID, and the group's label as every member's nearby text.
  for (const names of detectCharGroups(charCells)) {
    const members = names.map((n) => fields.find((f) => f.name === n)).filter((f): f is PdfFormOutline["fields"][number] => f !== undefined);
    const cells = names.map((n) => charCells.find((c) => c.name === n)).filter((c): c is CharCellCandidate => c !== undefined);
    if (members.length !== names.length || cells.length !== names.length) continue;
    const near = charGroupNearbyText(union(cells.map((c) => c.rect)), itemsByPage.get(cells[0].page) ?? []);
    for (const m of members) {
      m.charGroup = names[0];
      if (near) m.nearbyText = near;
    }
  }
  // Reading order: page, then top to bottom, then left to right.
  fields.sort((a, b) => a.page - b.page || b.rect.y + b.rect.height - (a.rect.y + a.rect.height) || a.rect.x - b.rect.x);
  annotatePdfSections(fields, pageText); // section headings and who completes each part (forms/pdf-sections.ts)

  if (signatures > 0) {
    warnings.push(
      `${signatures} digital signature field${signatures === 1 ? " is" : "s are"} left for the referrer's own process; the clinician's approval is written into the name, registration and date fields.`,
    );
  }
  if (buttons > 0) warnings.push(`${buttons} button${buttons === 1 ? "" : "s"} (e.g. "Print" or "Submit") ${buttons === 1 ? "was" : "were"} ignored.`);
  const classification: PdfClassification = fields.length > 0 ? "acroform" : "flat";
  if (classification === "flat") {
    warnings.push("This PDF has no fillable fields. Answers are written at the positions chosen in the mapping (best effort); a Word or fillable version of the form gives the neatest result.");
  }
  return {
    pages: doc.getPageCount(),
    fields,
    pageText: pageText.map((p) => ({ page: p.page, items: p.items.map(outlineTextItem) })),
    ...(boxes && classification === "flat" && { boxes }),
    classification,
    warnings,
  };
}
