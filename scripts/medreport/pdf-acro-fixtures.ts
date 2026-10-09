/**
 * A synthetic fillable PDF (pdf-lib) that copies the structures of real insurer forms which the PDF
 * engine used to get wrong – without the insurers' files, which are not in git:
 *
 * - a radio group whose export values Choice1…Choice6 are laid out RIGHT TO LEFT with the labels
 *   printed right of each button (Bupa's title: Other, Dr, Mr, Ms, Mrs, Miss);
 * - comb date boxes with a character limit of 8 and of 6 (Bupa's date of birth and declaration date),
 *   and an 8-character box for a reference number;
 * - ONE tick-box field with two widgets whose on-values are "no" and "Yes", each drawn with an
 *   on-appearance in white – a tick no viewer shows (AXA's "Did someone refer the patient?");
 * - separate single tick boxes acting as one choice: a column printed with options (AXA's therapist
 *   type), boxes beside the phone / e-mail boxes (AXA's preferred contact method), and a "Yes" box and
 *   a "No" box with their labels printed LEFT of the boxes (Freedom's Yes/No questions);
 * - a checklist of two tick boxes whose labels are questions (not one choice);
 * - eight touching one-character boxes for a date, printed D D M M Y Y Y Y, labelled with a drop cap
 *   (AXA's "D" + "ate of diagnosis");
 * - single-line table cells: one tall enough for two lines, one narrow.
 *
 * Every name and value is fictional.
 */
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts, type PDFCheckBox, type PDFPage, type PDFWidgetAnnotation } from "pdf-lib";

export const FIXTURE_RECTS = {
  /** Widgets of "Check Box 13": [0] = "no" (top), [1] = "Yes" (below). */
  referredNo: { x: 322.5, y: 575, width: 9, height: 9 },
  referredYes: { x: 322.5, y: 560, width: 9, height: 9 },
  charCells: Array.from({ length: 8 }, (_, i) => ({ x: 214.2 + i * 16.3, y: 262, width: 15.7, height: 16.7 })),
};

/** Rename a widget's on-state in its appearance dictionaries (e.g. "Yes" → "no"). */
function renameOnValue(widget: PDFWidgetAnnotation, from: string, to: string): void {
  const ap = widget.dict.lookup(PDFName.of("AP"), PDFDict);
  for (const key of ["N", "D"]) {
    const states = ap.lookup(PDFName.of(key));
    if (!(states instanceof PDFDict)) continue;
    const v = states.get(PDFName.of(from));
    if (v === undefined) continue;
    states.delete(PDFName.of(from));
    states.set(PDFName.of(to), v);
  }
}

/** Replace a widget's normal on-appearance with one drawn only in white (invisible on white paper). */
function whiteOnAppearance(doc: PDFDocument, widget: PDFWidgetAnnotation, onValue: string): PDFRef {
  const r = widget.getRectangle();
  const stream = doc.context.stream(`q 0 g 2 2 ${r.width - 4} ${r.height - 4} re f 1 G 1 g 3 w 2 2 ${r.width - 4} ${r.height - 4} re B Q`, {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, r.width, r.height],
  });
  const ref = doc.context.register(stream);
  const normal = widget.dict.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"), PDFDict);
  normal.set(PDFName.of(onValue), ref);
  return ref;
}

export interface InsurerLikePdf {
  bytes: Uint8Array;
  /** The white on-appearance streams put on "Check Box 13" (to check they were replaced). */
  whiteAppearances: string[];
}

export async function buildInsurerLikePdf(): Promise<InsurerLikePdf> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page: PDFPage = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  const text = (s: string, x: number, y: number, size = 9) => page.drawText(s, { x, y, size, font });

  // Title: radio buttons right to left, labels printed right of each button.
  text("Title (please tick)", 27, 700);
  const titles: Array<[string, number, string]> = [
    ["Choice1", 330, "Other (please state)"],
    ["Choice2", 290, "Dr"],
    ["Choice3", 250, "Mr"],
    ["Choice4", 210, "Ms"],
    ["Choice5", 165, "Mrs"],
    ["Choice6", 120, "Miss"],
  ];
  const radio = form.createRadioGroup("Radio Button 1");
  for (const [option, x, label] of titles) {
    radio.addOptionToPage(option, page, { x, y: 698, width: 11, height: 11 });
    text(label, x + 15, 700);
  }

  // Comb date boxes (8 and 6 characters) and an 8-character reference box.
  text("Date of birth", 27, 660);
  const dob = form.createTextField("Text Field 3");
  dob.setMaxLength(8);
  dob.enableCombing();
  dob.addToPage(page, { x: 111, y: 655, width: 166, height: 14, font });
  text("Membership number", 27, 630);
  const member = form.createTextField("Text Field 4");
  member.setMaxLength(8);
  member.addToPage(page, { x: 141, y: 625, width: 200, height: 16, font });
  text("Date", 27, 165);
  const short = form.createTextField("Text Field 30");
  short.setMaxLength(6);
  short.enableCombing();
  short.addToPage(page, { x: 111, y: 160, width: 120, height: 14, font });

  // One tick box, two widgets: "no" on top, "Yes" below, both with a white on-appearance.
  text("Did someone refer the patient?", 322, 600);
  const referred = form.createCheckBox("Check Box 13");
  referred.addToPage(page, FIXTURE_RECTS.referredNo);
  referred.addToPage(page, FIXTURE_RECTS.referredYes);
  const [noWidget, yesWidget] = referred.acroField.getWidgets();
  renameOnValue(noWidget, "Yes", "no");
  const whiteAppearances = [whiteOnAppearance(doc, noWidget, "no").toString(), whiteOnAppearance(doc, yesWidget, "Yes").toString()];
  text("No", 339, 577);
  text("Yes", 339, 562);

  // A column of tick boxes printed with the options of one question.
  text("Therapist type", 56, 520);
  const types: Array<[string, number, string]> = [
    ["Check Box 4", 500, "Physiotherapist"],
    ["Check Box 5", 485, "Chiropractor"],
    ["Check Box 6", 470, "Osteopath"],
  ];
  for (const [name, y, label] of types) {
    form.createCheckBox(name).addToPage(page, { x: 56.5, y, width: 9, height: 9 });
    text(label, 70, y + 1);
  }

  // Tick boxes beside the phone and e-mail boxes: the option is the label of the box to the left.
  text("Please tick how we should contact you here", 100, 440);
  text("Telephone number", 56, 420);
  form.createTextField("Text Field 15").addToPage(page, { x: 56.7, y: 398, width: 191.6, height: 16, font });
  form.createCheckBox("Check Box 10").addToPage(page, { x: 258, y: 398, width: 16, height: 16 });
  text("Email", 56, 380);
  form.createTextField("Text Field 18").addToPage(page, { x: 56.7, y: 358, width: 191.6, height: 16, font });
  form.createCheckBox("Check Box 12").addToPage(page, { x: 258, y: 358, width: 16, height: 16 });

  // A "Yes" box and a "No" box with their labels printed LEFT of the boxes.
  text("Are you covered by another insurance policy that may pay for this?", 40, 322);
  text("Yes", 437, 322, 10);
  form.createCheckBox("Check Box5").addToPage(page, { x: 461.8, y: 314, width: 28, height: 25 });
  text("No", 507, 322, 10);
  form.createCheckBox("Check Box6").addToPage(page, { x: 537.8, y: 314, width: 28, height: 25 });

  // A checklist: labels are questions, so the boxes are NOT one choice.
  text("Before you send this form:", 400, 520);
  form.createCheckBox("Check Box 2").addToPage(page, { x: 400, y: 500, width: 9, height: 9 });
  text("every question answered?", 413, 501);
  form.createCheckBox("Check Box 3").addToPage(page, { x: 400, y: 482, width: 9, height: 9 });
  text("form signed and dated?", 413, 483);

  // Eight touching one-character boxes, printed D D M M Y Y Y Y, labelled with a drop cap.
  page.drawText("D", { x: 56.7, y: 270, size: 12, font });
  text("ate of diagnosis", 56.7 + font.widthOfTextAtSize("D", 12), 270, 12);
  text("(dd/mm/yyyy)", 56.7, 258);
  FIXTURE_RECTS.charCells.forEach((r, i) => {
    form.createTextField(`Text Field ${20 + i}`).addToPage(page, { ...r, font });
    text("DDMMYYYY"[i], r.x + 11, r.y + 1, 5);
  });

  // Single-line table cells.
  text("Treatment given", 204, 230);
  form.createTextField("Treatment Row1").addToPage(page, { x: 204, y: 200, width: 184.9, height: 23.1, font });
  form.createTextField("Amount Row1").addToPage(page, { x: 391, y: 200, width: 54.5, height: 14, font });
  return { bytes: await doc.save(), whiteAppearances };
}

/** A tick box's widgets as "onValue->state". */
export function widgetStates(cb: PDFCheckBox): string[] {
  return cb.acroField.getWidgets().map((w) => `${w.getOnValue()?.decodeText() ?? "?"}->${w.getAppearanceState()?.decodeText() ?? "?"}`);
}
