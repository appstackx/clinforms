import "server-only";

/**
 * Synthetic PDFs for the S2 tests (tables of fields, flat forms with printed boxes) – fictional, built
 * with pdf-lib, so the tests never need the real insurer forms (which are not in git).
 *
 * Owner: S2 (pdf-tables-flat). Test fixtures only; nothing in the app imports this file.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const ROW_TOP = 700;
export const ROW_STEP = 24;

/** A claim form with a 4-row expenses table; the "paid" column is numbered bottom to top (as Freedom's YESNO7…1). */
export async function tableFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  page.drawText("3. Details of the treatment you are claiming for", { x: 40, y: 760, size: 11, font });
  page.drawText("Please attach the invoices.", { x: 40, y: 742, size: 9, font });
  page.drawText("Date of treatment", { x: 42, y: 712, size: 8, font });
  page.drawText("Treatment received", { x: 142, y: 712, size: 8, font });
  page.drawText("Amount of the bill", { x: 342, y: 712, size: 8, font });
  page.drawText("Has this bill been paid?", { x: 442, y: 712, size: 8, font });
  for (let i = 0; i < 4; i += 1) {
    const top = ROW_TOP - i * ROW_STEP;
    form.createTextField(`Date of treatmentRow${i + 1}`).addToPage(page, { x: 40, y: top - 22, width: 95, height: 22, font });
    form.createTextField(`Treatment receivedRow${i + 1}`).addToPage(page, { x: 140, y: top - 22, width: 195, height: 22, font });
    form.createTextField(`Amount of the billRow${i + 1}`).addToPage(page, { x: 340, y: top - 22, width: 95, height: 22, font });
    form.createTextField(`PAID${4 - i}`).addToPage(page, { x: 440, y: top - 22, width: 90, height: 22, font });
    page.drawText("Yes / No", { x: 465, y: top - 15, size: 9, font });
  }
  // Decoys: a pair of numbered names that is not a table, and generic "Text Field N" grids.
  form.createTextField("Surname").addToPage(page, { x: 100, y: 400, width: 200, height: 18, font });
  form.createTextField("Surname_2").addToPage(page, { x: 100, y: 340, width: 200, height: 18, font });
  for (let i = 0; i < 3; i += 1) {
    form.createTextField(`Text Field ${i + 1}`).addToPage(page, { x: 40, y: 250 - i * 24, width: 150, height: 22, font });
    form.createTextField(`Text Field ${i + 4}`).addToPage(page, { x: 200, y: 250 - i * 24, width: 150, height: 22, font });
  }
  return doc.save();
}

/** A flat form with drawn boxes: date box with slashes, answer box, Yes/No ticks, a comb, a frame, a used box, a lone tick. */
export async function flatBoxesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const box = (x: number, y: number, width: number, height: number) => page.drawRectangle({ x, y, width, height, borderColor: rgb(0, 0, 0), borderWidth: 0.8, color: rgb(1, 1, 1) });
  page.drawText("4. Medical details (to be completed by the practitioner)", { x: 40, y: 790, size: 10, font });
  page.drawText("Please complete all sections in BLOCK CAPITALS.", { x: 40, y: 775, size: 9, font });
  // Date box with two printed slashes.
  page.drawText("When did the symptoms start?", { x: 40, y: 736, size: 9, font });
  box(200, 730, 100, 17);
  page.drawLine({ start: { x: 232, y: 732 }, end: { x: 237, y: 745 }, thickness: 0.8 });
  page.drawLine({ start: { x: 264, y: 732 }, end: { x: 269, y: 745 }, thickness: 0.8 });
  // Answer box with a two-line label.
  page.drawText("Please describe the condition", { x: 40, y: 700, size: 9, font });
  page.drawText("currently suffering from", { x: 40, y: 689, size: 9, font });
  box(200, 660, 340, 50);
  // Yes / No tick boxes with their labels to the right.
  page.drawText("Is there a referral letter?", { x: 40, y: 625, size: 9, font });
  box(200, 620, 16.8, 16.8);
  page.drawText("Yes", { x: 219, y: 624, size: 9, font });
  box(246, 620, 16.8, 16.8);
  page.drawText("No", { x: 265, y: 624, size: 9, font });
  // A comb of 8 single-character cells.
  page.drawText("Membership number", { x: 40, y: 585, size: 9, font });
  for (let i = 0; i < 8; i += 1) box(200 + i * 14, 580, 14, 14);
  // A frame around a box: the frame is not an answer space, the box is.
  box(30, 400, 530, 150);
  page.drawText("Print name", { x: 40, y: 505, size: 9, font });
  box(200, 500, 200, 17);
  // A box that already holds printed text.
  box(200, 450, 200, 17);
  page.drawText("Office use only", { x: 205, y: 455, size: 9, font });
  // A lone tick box with its question to the left.
  page.drawText("Tick if you would like a copy", { x: 40, y: 303, size: 9, font });
  box(500, 300, 12, 12);
  return doc.save();
}
