/**
 * Section headings and who completes each part of a PDF form (forms/pdf-sections.ts, hooked into
 * readPdfForm): synthetic multi-party forms built with pdf-lib – numbered headings larger than the body
 * text, a numbered sub-heading, a section carried onto the next page, a running header that is not a
 * heading, a declaration found by its signer, office use, and a wrapped title on a flat PDF.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { readPdfForm } from "./pdf-outline";
import { detectPdfSections, pdfSectionAt, pdfSectionTitles } from "./pdf-sections";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";

const POLICYHOLDER = "A. Member’s information – to be completed by the policyholder";

async function multiPartyForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const text = (page: PDFPage, s: string, x: number, y: number, size = 10, f: PDFFont = font) => page.drawText(s, { x, y, size, font: f });
  const box = (page: PDFPage, name: string, x: number, y: number, width = 220) =>
    form.createTextField(name).addToPage(page, { x, y: y - 5, width, height: 16, font });
  const furniture = (page: PDFPage) => {
    text(page, "Example Health (fictional) claim form", 40, 800, 16, bold);
    text(page, "Example Health (fictional). Registered address: 1 Example Street, Exampletown EX1 1AA. Company registration number: 01234567.", 40, 30, 7);
  };

  const p1 = doc.addPage([595, 842]);
  furniture(p1);
  text(p1, POLICYHOLDER.replace("’", "'"), 40, 760, 12, bold);
  text(p1, "Surname:", 40, 735);
  box(p1, "surname", 140, 735);
  text(p1, "Date of birth:", 40, 710);
  box(p1, "dob", 140, 710);
  text(p1, "2. Treatment details", 40, 680, 12, bold);
  text(p1, "Treatment start date:", 40, 655);
  box(p1, "start", 160, 655);
  [
    "Please give the dates of every appointment and the treatment provided at each one, with the",
    "number of sessions attended so far. Attach the invoices for the sessions you are claiming for and",
    "keep a copy of this form for your own records. Incomplete forms may delay the claim.",
  ].forEach((line, i) => text(p1, line, 40, 625 - i * 14));
  text(p1, "2.1 About the claim", 40, 560, 10, bold);
  text(p1, "When did your symptoms start?", 40, 540);
  box(p1, "symptoms", 260, 540, 280);

  const p2 = doc.addPage([595, 842]);
  furniture(p2);
  text(p2, "Number of sessions:", 40, 770);
  box(p2, "sessions", 160, 770);
  text(p2, "3. Therapist's declaration", 40, 730, 12, bold);
  text(p2, "I confirm that the information I have provided is correct to the best of my knowledge.", 40, 710);
  text(p2, "Therapist's name:", 40, 690);
  box(p2, "thname", 160, 690);
  text(p2, "Date:", 40, 670);
  box(p2, "thdate", 160, 670);
  text(p2, "4. Signature", 40, 630, 12, bold);
  text(p2, "Please read the declaration before signing.", 40, 612);
  text(p2, "The policyholder named in section 1 must sign and date below.", 40, 598);
  text(p2, "Policyholder's signature:", 40, 575);
  box(p2, "phsig", 170, 575);
  text(p2, "Date:", 40, 555);
  box(p2, "phdate", 170, 555);
  text(p2, "For office use only", 40, 520, 9, bold);
  text(p2, "Date received:", 40, 500);
  box(p2, "received", 160, 500);
  return doc.save();
}

test("readPdfForm gives every field its section heading and who completes it", async () => {
  const outline = await readPdfForm(await multiPartyForm());
  const by = Object.fromEntries(outline.fields.map((f) => [f.name, f]));
  const policyholder = POLICYHOLDER.replace("’", "'");
  assert.deepEqual([by.surname.section, by.surname.completedBy], [policyholder, "policyholder"]);
  assert.deepEqual([by.dob.section, by.dob.completedBy], [policyholder, "policyholder"]);
  assert.deepEqual([by.start.section, by.start.completedBy], ["2. Treatment details", undefined]);
  assert.deepEqual([by.symptoms.section, by.symptoms.completedBy], ["2.1 About the claim", undefined], "a numbered sub-heading at body size");
  assert.equal(by.sessions.section, "2.1 About the claim", "carried onto the next page (the running header is not a heading)");
  assert.deepEqual([by.thname.section, by.thname.completedBy], ["3. Therapist's declaration", "clinic"]);
  assert.deepEqual([by.thdate.section, by.thdate.completedBy], ["3. Therapist's declaration", "clinic"]);
  assert.deepEqual([by.phsig.section, by.phsig.completedBy], ["4. Signature", "policyholder"], "the signer named under the heading");
  assert.deepEqual([by.phdate.section, by.phdate.completedBy], ["4. Signature", "policyholder"]);
  assert.deepEqual([by.received.section, by.received.completedBy], ["For office use only", "insurer"]);

  // The text items carry the same, and positions can be looked up afterwards (flat-PDF boxes).
  const surnameLabel = outline.pageText[0].items.find((i) => i.str === "Surname:");
  assert.equal(surnameLabel?.completedBy, "policyholder");
  assert.equal(pdfSectionAt(outline, 2, 760).section, "2.1 About the claim");
  assert.deepEqual(pdfSectionAt(outline, 2, 560), { section: "4. Signature", completedBy: "policyholder" });
  assert.deepEqual(pdfSectionAt(outline, 1, 820), {}, "above the first heading");
  assert.deepEqual(pdfSectionTitles(outline), [policyholder, "2. Treatment details", "2.1 About the claim", "3. Therapist's declaration", "4. Signature", "For office use only"]);
  assert.ok(!pdfSectionTitles(outline).some((t) => /Example Health/.test(t)), "running header");
});

async function flatForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const text = (s: string, y: number, size = 9, f: PDFFont = font) => page.drawText(s, { x: 50, y, size, font: f });
  text("Example private medical", 790, 24, bold);
  text("insurance report form", 764, 24, bold);
  text("Is this the patient's first claim this year?", 735, 14, bold);
  for (let i = 0; i < 4; i += 1) text("Please answer every question in black ink and return the form to the claims team within 10 working days.", 715 - i * 12);
  text("3. Medical history", 650, 11, bold);
  text("3.1 Current condition – to be completed by the GP", 630, 9, bold);
  text("Diagnosis:", 610);
  text("3.2 Previous treatment", 560, 9, bold);
  text("Treatment given:", 540);
  text("I declare that the information above is correct and complete.", 500);
  text("Doctor's signature:", 480);
  text("Date:", 460);
  return doc.save();
}

test("flat PDF: wrapped title, numbered sub-sections and a declaration found by its signer", async () => {
  const outline = await readPdfForm(await flatForm());
  assert.equal(outline.classification, "flat");
  const at = (str: string) => outline.pageText[0].items.find((i) => i.str === str);
  assert.equal(at("Diagnosis:")?.section, "3.1 Current condition – to be completed by the GP");
  assert.equal(at("Diagnosis:")?.completedBy, "doctor");
  assert.equal(at("Treatment given:")?.section, "3.2 Previous treatment");
  assert.equal(at("Treatment given:")?.completedBy, undefined, "a sub-heading inherits only its own section's party");
  assert.equal(at("Date:")?.section, "I declare that the information above is correct and complete.");
  assert.equal(at("Date:")?.completedBy, "doctor", "the declaration's signer is the doctor");
  const titles = pdfSectionTitles(outline);
  assert.equal(titles[0], "Example private medical insurance report form", "a title wrapped over two lines is one heading");
  assert.ok(!titles.some((t) => /first claim/.test(t)), "a question is never a heading");
});

test("detectPdfSections works on raw positioned text (sizes from pdfjs)", async () => {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(await multiPartyForm()));
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items.flatMap((it) =>
      "str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, h: it.height }] : [],
    );
    pages.push({ page: n, items });
  }
  await task.destroy();
  const sections = detectPdfSections(pages);
  assert.deepEqual(
    sections.map((s) => [s.page, s.level, s.title.slice(0, 20), s.completedBy ?? "-", s.signoff]),
    [
      [1, 1, "A. Member's informat", "policyholder", false],
      [1, 1, "2. Treatment details", "-", false],
      [1, 2, "2.1 About the claim", "-", false],
      [2, 1, "3. Therapist's decla", "clinic", true],
      [2, 1, "4. Signature", "policyholder", true],
      [2, 1, "For office use only", "insurer", false],
    ],
  );
});

test("a heading repeated at the same height on every page is a running header; at other heights it is a heading", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const y of [700, 450]) {
    const page = doc.addPage([595, 842]);
    page.drawText("Example Rehab (fictional) report", { x: 40, y: 800, size: 16, font: bold });
    page.drawText("Patient declaration", { x: 40, y, size: 14, font: bold });
    for (let i = 1; i <= 4; i += 1) page.drawText("Please read the notes overleaf before you complete and sign this part of the form.", { x: 40, y: y - 20 * i, size: 10, font });
  }
  const outline = await readPdfForm(await doc.save());
  assert.deepEqual(pdfSectionTitles(outline), ["Patient declaration"]);
  assert.deepEqual(pdfSectionAt(outline, 2, 420), { section: "Patient declaration", completedBy: "patient" });
  assert.equal(pdfSectionAt(outline, 2, 600).section, "Patient declaration", "carried from page 1 until the heading on page 2");
});
