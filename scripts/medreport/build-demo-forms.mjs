/**
 * Builds the bundled FICTIONAL referrer forms for the demo – the forms an MLC, insurer or case manager
 * sends a clinic, each with its own layout, wording and order – and writes them as base64 TS modules to
 * src/modules/medreport/forms/samples/generated/<id>.<ext>.b64.ts (server-only), plus a manifest with
 * each file's SHA-256 and size (generated/manifest.ts) that the pre-confirmed form maps bind to.
 *
 *   harrow-pike-treating-physio   Harrow & Pike Medico-Legal (fictional) – Treating Physiotherapist Report
 *                                 Word; letterhead, reference box, Part A details table with empty answer
 *                                 cells, Part B question | answer table (placeholders, ☐ Yes ☐ No), Part C
 *                                 declaration table, office-use box.
 *   northfield-rehab-progress     Northfield Assurance (fictional) – Rehabilitation Progress Report
 *                                 Fillable PDF (AcroForm): text, multi-line, number, check box, radio group.
 *   kingsway-rtw-assessment       Kingsway Case Management (fictional) – Return to Work Assessment
 *                                 Word; heading-based: numbered headings, "Answer: ____" lines, dotted
 *                                 continuation lines, ☐ tick-box lines, inline "Name: ____  DOB: ____".
 *   ashcroft-update-report        Ashcroft Medical Reporting (fictional) – Physiotherapy Update Report
 *                                 FLAT PDF (no form fields): printed questions and ruled answer lines;
 *                                 answers are written onto the page at fixed positions (best effort).
 *   meridian-discharge-report     Meridian Claims Services (fictional) – Physiotherapy Discharge Report
 *                                 Word; bordered section boxes, Word content controls ("Click or tap here
 *                                 to enter text."), check-box content controls. No map: the live upload demo.
 *
 * Every organisation is fictional. The files are deterministic (fixed dates), so their SHA-256 – which a
 * confirmed form map is bound to – only changes when the design changes. Plain copies are also written
 * to --out <dir> (default: none) for downloading.
 *
 * Run: node scripts/medreport/build-demo-forms.mjs [--out <dir>]
 * Owner: forms-engine agent.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PizZip from "pizzip";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "src/modules/medreport/forms/samples/generated");
const FIXED_DATE = new Date("2026-09-01T09:00:00.000Z");

/** A4 content width in twips with 2 cm side margins. */
const PAGE = { width: 11906, height: 16838, margin: 1077 };
const CONTENT_W = PAGE.width - 2 * PAGE.margin;

/* ------------------------------------------------------------------------------------------------
 * Small Word builders
 * ----------------------------------------------------------------------------------------------*/

function r(text, opts = {}) {
  return new TextRun({ text, ...opts });
}

function p(children, opts = {}) {
  const kids = (Array.isArray(children) ? children : [children]).map((c) => (typeof c === "string" ? r(c) : c));
  return new Paragraph({ children: kids, ...opts });
}

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

function line(color, size = 4) {
  return { style: BorderStyle.SINGLE, size, color };
}

function boxBorders(color, size = 4) {
  const b = line(color, size);
  return { top: b, bottom: b, left: b, right: b };
}

function tc(children, opts = {}) {
  const kids = (Array.isArray(children) ? children : [children]).map((c) =>
    c instanceof Paragraph || c instanceof Table ? c : p(c),
  );
  return new TableCell({
    children: kids.length ? kids : [p([])],
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    borders: opts.borders,
    verticalAlign: opts.vAlign ?? VerticalAlignTable.TOP,
    margins: opts.margins ?? { top: 80, bottom: 80, left: 120, right: 120 },
    columnSpan: opts.span,
  });
}

function tr(cells, opts = {}) {
  return new TableRow({
    children: cells,
    height: opts.height ? { value: opts.height, rule: HeightRule.ATLEAST } : undefined,
    cantSplit: true,
    tableHeader: opts.header,
  });
}

function table(rows, columnWidths, opts = {}) {
  return new Table({
    rows,
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: opts.borders ?? noBorders,
    alignment: opts.alignment,
  });
}

function spacer(after = 120) {
  return p([], { spacing: { before: 0, after } });
}

function pageXofY(color, size = 15) {
  return [
    r("Page ", { size, color }),
    new TextRun({ children: [PageNumber.CURRENT], size, color }),
    r(" of ", { size, color }),
    new TextRun({ children: [PageNumber.TOTAL_PAGES], size, color }),
  ];
}

/** ☐ glyph run (MS Gothic, as Word's own tick boxes use). */
function box(size = 22, color) {
  return r("☐", { font: "MS Gothic", size, color });
}

function docStyles(font, size, text, heading) {
  return {
    default: {
      document: { run: { font, size, color: text }, paragraph: { spacing: { after: 80, line: 264 } } },
      title: { run: { font, size: 36, bold: true, color: heading.color }, paragraph: { spacing: { after: 60 } } },
      heading1: {
        run: { font, size: heading.h1Size ?? 22, bold: true, color: heading.h1Color ?? heading.color },
        paragraph: { spacing: { before: 240, after: 100 }, keepNext: true },
      },
      heading2: {
        run: { font, size: heading.h2Size ?? 21, bold: true, color: heading.h2Color ?? heading.color },
        paragraph: { spacing: { before: 200, after: 60 }, keepNext: true },
      },
    },
  };
}

function wordDocument({ title, subject, styles, header, footer, children }) {
  return new Document({
    creator: "Fictional demo forms",
    title,
    subject,
    // Former product name kept on purpose: the recorded analyses and demo drafts are keyed to this file's SHA-256 (README "Renaming the product").
    description: "Fictional referrer form for the AppStackX Reports demo. Not a real organisation's form.",
    lastModifiedBy: "Fictional demo forms",
    styles,
    features: { updateFields: false },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: { top: 1300, bottom: 1100, left: PAGE.margin, right: PAGE.margin, header: 500, footer: 500 },
          },
        },
        headers: { default: new Header({ children: header }) },
        footers: { default: new Footer({ children: footer }) },
        children,
      },
    ],
  });
}

/* ------------------------------------------------------------------------------------------------
 * (a) Harrow & Pike Medico-Legal (fictional) – Treating Physiotherapist Report (Word, tables)
 * ----------------------------------------------------------------------------------------------*/

const HP = {
  font: "Arial",
  navy: "1F2A44",
  burgundy: "8A1C3B",
  text: "1B1F24",
  grey: "5B6573",
  label: "EEF1F6",
  head: "DCE2EC",
  border: "9AA5B8",
  note: "F7F3EA",
};

function hpPartHeading(text) {
  return p([r(text, { bold: true, color: "FFFFFF", size: 20, characterSpacing: 10 })], {
    heading: HeadingLevel.HEADING_1,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: HP.navy },
    spacing: { before: 280, after: 100 },
    indent: { left: 0 },
    keepNext: true,
  });
}

function hpQuestion(no, question, guidance) {
  const kids = [p([r(`${no}. `, { bold: true, color: HP.burgundy, size: 19 }), r(question, { bold: true, size: 19 })], { spacing: { after: 40 } })];
  if (guidance) kids.push(p([r(guidance, { italics: true, size: 16, color: HP.grey })], { spacing: { after: 0 } }));
  return kids;
}

function harrowPike() {
  const b = line(HP.border, 4);
  const grid = { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
  const labelW = 3400;
  const answerW = CONTENT_W - labelW;

  const header = [
    p(
      [
        r("HARROW & PIKE", { bold: true, size: 34, color: HP.navy, characterSpacing: 30 }),
        r("\tMedical Reporting Agency", { size: 16, color: HP.grey }),
      ],
      { tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }], spacing: { after: 0 } },
    ),
    p(
      [
        r("MEDICO-LEGAL (fictional)", { bold: true, size: 17, color: HP.burgundy, characterSpacing: 40 }),
        r("\tPersonal Injury · Clinical Negligence · Rehabilitation", { size: 16, color: HP.grey }),
      ],
      {
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: HP.navy, space: 4 } },
        spacing: { after: 60 },
      },
    ),
    p([r("PO Box 0000 (fictional), Milton Keynes MK9 0ZZ  ·  01908 000111  ·  reports@harrowpike-ml.example", { size: 15, color: HP.grey })], {
      alignment: AlignmentType.RIGHT,
      spacing: { after: 0 },
    }),
  ];

  const footer = [
    p(
      [r("Form HPM-TP3  ·  Treating Physiotherapist Report  ·  v4.2 (03/2026)", { size: 15, color: HP.grey }), r("\t"), ...pageXofY(HP.grey)],
      {
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: HP.border, space: 4 } },
        spacing: { after: 0 },
      },
    ),
    p([r("Harrow & Pike Medico-Legal is a fictional organisation used for demonstration only.", { size: 13, color: HP.grey })], {
      spacing: { after: 0 },
    }),
  ];

  const refBox = table(
    [
      tr([
        tc(
          [
            p(
              [
                r(
                  "Please complete all three parts of this form from your clinical records and return it within 14 days of receipt. Where a question asks for your opinion, please give your own professional opinion. If you are unable to comment, please say so.",
                  { size: 17 },
                ),
              ],
              { spacing: { after: 60 } },
            ),
            p(
              [
                r("Return to: ", { bold: true, size: 17, color: HP.burgundy }),
                r("Medical Reports Team, reports@harrowpike-ml.example. ", { size: 17 }),
                r("Please quote our reference on all correspondence.", { bold: true, size: 17 }),
              ],
              { spacing: { after: 0 } },
            ),
          ],
          {
            fill: HP.note,
            width: CONTENT_W,
            borders: { top: NONE, bottom: NONE, right: NONE, left: { style: BorderStyle.SINGLE, size: 24, color: HP.burgundy } },
            margins: { top: 100, bottom: 100, left: 180, right: 160 },
          },
        ),
      ]),
    ],
    [CONTENT_W],
  );

  const partA = table(
    [
      ["Claimant name"],
      ["Date of birth"],
      ["Our reference"],
      ["Date of accident"],
      ["Date of first assessment"],
      ["Date of last treatment"],
    ].map(([label]) =>
      tr(
        [
          tc([p([r(label, { bold: true, size: 18 })], { spacing: { after: 0 } })], { fill: HP.label, width: labelW, vAlign: VerticalAlignTable.CENTER }),
          tc([p([], { spacing: { after: 0 } })], { width: answerW, vAlign: VerticalAlignTable.CENTER }),
        ],
        { height: 440 },
      ),
    ),
    [labelW, answerW],
    { borders: grid },
  );

  const qW = 3700;
  const aW = CONTENT_W - qW;
  const answerCell = (children = [p([], { spacing: { after: 0 } })]) => tc(children, { width: aW });
  const partB = table(
    [
      tr(
        [
          tc([p([r("Question", { bold: true, size: 18, color: HP.navy })], { spacing: { after: 0 } })], { fill: HP.head, width: qW }),
          tc([p([r("Your answer", { bold: true, size: 18, color: HP.navy })], { spacing: { after: 0 } })], { fill: HP.head, width: aW }),
        ],
        { header: true },
      ),
      tr([tc(hpQuestion("B1", "Mechanism of injury", "As reported to you by the claimant."), { fill: HP.label, width: qW }), answerCell()], { height: 900 }),
      tr([tc(hpQuestion("B2", "Presenting symptoms at initial assessment"), { fill: HP.label, width: qW }), answerCell()], { height: 1100 }),
      tr(
        [tc(hpQuestion("B3", "Treatment provided to date", "Including manual therapy, exercise programme and advice."), { fill: HP.label, width: qW }), answerCell()],
        { height: 1100 },
      ),
      tr(
        [
          tc(hpQuestion("B4", "Number of sessions attended / failed to attend"), { fill: HP.label, width: qW }),
          answerCell([
            p(
              [r("Attended: ", { size: 19 }), r("__________", { size: 19 }), r("        Failed to attend: ", { size: 19 }), r("__________", { size: 19 })],
              { spacing: { before: 60, after: 0 } },
            ),
          ]),
        ],
        { height: 500 },
      ),
      tr(
        [tc(hpQuestion("B5", "Current symptoms and progress", "Please include any outcome measures used."), { fill: HP.label, width: qW }), answerCell()],
        { height: 1100 },
      ),
      tr(
        [
          tc(hpQuestion("B6", "Has the claimant reached maximum medical improvement?"), { fill: HP.label, width: qW }),
          answerCell([p([box(22, HP.navy), r(" Yes", { size: 19 }), r("            "), box(22, HP.navy), r(" No", { size: 19 })], { spacing: { before: 60, after: 0 } })]),
        ],
        { height: 500 },
      ),
      tr(
        [
          tc(hpQuestion("B7", "Prognosis", "Your opinion on the likely course of recovery, including the expected time to recovery."), {
            fill: HP.label,
            width: qW,
          }),
          answerCell(),
        ],
        { height: 1100 },
      ),
      tr(
        [
          tc(hpQuestion("B8", "Functional restrictions", "Any restrictions on work, domestic, social or leisure activities."), { fill: HP.label, width: qW }),
          answerCell(),
        ],
        { height: 1000 },
      ),
      tr(
        [
          tc(hpQuestion("B9", "Treatment recommendations", "Is further treatment required? If so, please state the type and number of sessions."), {
            fill: HP.label,
            width: qW,
          }),
          answerCell(),
        ],
        { height: 1000 },
      ),
    ],
    [qW, aW],
    { borders: grid },
  );

  const partC = table(
    [
      ["Name", 440],
      ["HCPC registration number", 440],
      ["Signature", 700],
      ["Date", 440],
    ].map(([label, height]) =>
      tr(
        [
          tc([p([r(label, { bold: true, size: 18 })], { spacing: { after: 0 } })], { fill: HP.label, width: labelW, vAlign: VerticalAlignTable.CENTER }),
          tc([p([], { spacing: { after: 0 } })], { width: answerW, vAlign: VerticalAlignTable.CENTER }),
        ],
        { height },
      ),
    ),
    [labelW, answerW],
    { borders: grid },
  );

  const officeW = [1900, 2900, 1900, CONTENT_W - 6700];
  const office = table(
    [
      tr([tc([p([r("FOR OFFICE USE ONLY", { bold: true, size: 15, color: HP.grey, characterSpacing: 20 })], { spacing: { after: 0 } })], { span: 4, fill: HP.label })]),
      tr(
        [
          tc([p([r("Date received", { size: 15, color: HP.grey })], { spacing: { after: 0 } })], { width: officeW[0] }),
          tc([p([], { spacing: { after: 0 } })], { width: officeW[1] }),
          tc([p([r("Checked by", { size: 15, color: HP.grey })], { spacing: { after: 0 } })], { width: officeW[2] }),
          tc([p([], { spacing: { after: 0 } })], { width: officeW[3] }),
        ],
        { height: 360 },
      ),
    ],
    officeW,
    { borders: { ...grid, insideHorizontal: line(HP.border, 2), insideVertical: line(HP.border, 2) } },
  );

  const children = [
    p([r("TREATING PHYSIOTHERAPIST REPORT", { bold: true, size: 32, color: HP.navy, characterSpacing: 10 })], { spacing: { before: 120, after: 40 } }),
    p([r("Personal injury claim – request for a report from the treating physiotherapist", { italics: true, size: 19, color: HP.grey })], {
      spacing: { after: 160 },
    }),
    refBox,
    hpPartHeading("PART A – CLAIMANT DETAILS"),
    partA,
    hpPartHeading("PART B – CLINICAL INFORMATION"),
    p([r("Please answer each question from your clinical records. Continue on a separate sheet if necessary.", { size: 17, color: HP.grey })], {
      spacing: { after: 100 },
    }),
    partB,
    hpPartHeading("PART C – DECLARATION"),
    p(
      [
        r(
          "I confirm that the information given in this report is true to the best of my knowledge and belief, and that it has been prepared from my own clinical records of the claimant's treatment. I understand that this report may be disclosed to the parties to the claim and to the court.",
          { size: 18 },
        ),
      ],
      { spacing: { after: 120 } },
    ),
    partC,
    spacer(200),
    office,
  ];

  return wordDocument({
    title: "Treating Physiotherapist Report (Form HPM-TP3)",
    subject: "Harrow & Pike Medico-Legal (fictional)",
    styles: docStyles(HP.font, 19, HP.text, { color: HP.navy }),
    header,
    footer,
    children,
  });
}

/* ------------------------------------------------------------------------------------------------
 * (c) Kingsway Case Management (fictional) – Return to Work Assessment (Word, headings + placeholders)
 * ----------------------------------------------------------------------------------------------*/

const KW = { font: "Calibri", green: "1E5631", light: "6BA368", text: "1F2421", grey: "5F6B63" };
const DOTS = ".".repeat(176);
const ANSWER_LINE = `Answer: ${"_".repeat(78)}`;

function kwH1(text) {
  return p([r(text)], {
    heading: HeadingLevel.HEADING_1,
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: KW.light, space: 2 } },
  });
}

function kwH2(text) {
  return p([r(text)], { heading: HeadingLevel.HEADING_2 });
}

function kwBody(text, opts = {}) {
  return p([r(text, { size: opts.size ?? 21, italics: opts.italics, color: opts.color })], { spacing: { after: opts.after ?? 80 } });
}

function kingsway() {
  const header = [
    p(
      [
        r("KINGSWAY", { bold: true, size: 36, color: KW.green, characterSpacing: 20 }),
        r("  CASE MANAGEMENT (fictional)", { size: 18, color: KW.light, bold: true, characterSpacing: 30 }),
        r("\tVocational Rehabilitation · Occupational Health Case Management", { size: 16, color: KW.grey }),
      ],
      {
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: { bottom: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 18, color: KW.green, space: 4 } },
        spacing: { after: 0 },
      },
    ),
  ];
  const footer = [
    p([r("KCM-RTW-01  ·  Return to Work Assessment  ·  Rev. 2 (01/2026)", { size: 15, color: KW.grey }), r("\t"), ...pageXofY(KW.grey)], {
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      spacing: { after: 0 },
    }),
    p([r("Kingsway Case Management is a fictional organisation used for demonstration only.", { size: 13, color: KW.grey })], { spacing: { after: 0 } }),
  ];

  const children = [
    p([r("Return to Work Assessment")], { heading: HeadingLevel.TITLE, spacing: { before: 160, after: 20 } }),
    p([r("Report from the treating therapist", { size: 24, color: KW.grey })], { spacing: { after: 160 } }),
    kwBody(
      "Please complete every section. Type or write clearly in the spaces provided. This assessment will be shared with the employee and, with their consent, with their employer's HR and occupational health team.",
      { size: 19, color: KW.grey, after: 160 },
    ),
    kwBody(`Employer / client reference: ${".".repeat(34)}      Kingsway case no.: ${".".repeat(26)}`),

    kwH1("Section A – Employee details"),
    kwBody(`Employee name: ${"_".repeat(36)}     Date of birth: ${"_".repeat(16)}`),
    kwBody(`Job title: ${"_".repeat(30)}     Employer: ${"_".repeat(32)}`),
    kwBody(`Date of injury / onset: ${"_".repeat(14)}     Date first seen: ${"_".repeat(14)}     Date last seen: ${"_".repeat(14)}`),

    kwH1("Section B – Clinical findings"),
    kwH2("1. Nature of the injury and diagnosis"),
    kwBody(ANSWER_LINE),
    kwBody(DOTS),
    kwBody(DOTS),
    kwH2("2. Treatment provided to date, including the number of sessions attended"),
    kwBody(ANSWER_LINE),
    kwBody(DOTS),
    kwBody(DOTS),
    kwH2("3. Current functional capacity"),
    kwBody(
      "Please comment on lifting and carrying, bending, prolonged sitting and standing, and say whether a formal functional or lifting assessment has been carried out.",
      { italics: true, size: 19, color: KW.grey },
    ),
    kwBody(DOTS),
    kwBody(DOTS),
    kwBody(DOTS),

    kwH1("Section C – Fitness for work"),
    kwH2("4. In your opinion, is the employee fit to return to their normal duties?"),
    p([box(24, KW.green), r(" Yes", { size: 21 }), r("              "), box(24, KW.green), r(" No", { size: 21 })], { spacing: { after: 80 } }),
    kwH2("5. If not, are they fit for modified or restricted duties?"),
    p(
      [
        box(24, KW.green),
        r(" Yes, with the adjustments below", { size: 21 }),
        r("        "),
        box(24, KW.green),
        r(" No", { size: 21 }),
        r("        "),
        box(24, KW.green),
        r(" Not applicable", { size: 21 }),
      ],
      { spacing: { after: 80 } },
    ),
    kwH2("6. Recommended adjustments or restrictions"),
    kwBody("For example: lifting limits, reduced hours, tasks to avoid, and for how long.", { italics: true, size: 19, color: KW.grey }),
    p([], { spacing: { after: 80 } }),
    p([], { spacing: { after: 80 } }),
    kwH2("7. Recommended return-to-work plan and timescale"),
    kwBody(ANSWER_LINE),
    kwBody(DOTS),
    kwH2("8. Is further treatment required? If so, please give details."),
    kwBody(ANSWER_LINE),
    kwBody(DOTS),
    kwH2("9. When should the employee be reviewed?"),
    kwBody(`Answer: ${"_".repeat(40)}`),

    kwH1("Section D – Declaration"),
    kwBody("I confirm that the information in this assessment is accurate and has been completed from my own clinical records."),
    kwBody(`Therapist name: ${"_".repeat(34)}     HCPC no.: ${"_".repeat(16)}`),
    kwBody(`Signature: ${"_".repeat(38)}     Date: ${"_".repeat(16)}`),
  ];

  return wordDocument({
    title: "Return to Work Assessment (KCM-RTW-01)",
    subject: "Kingsway Case Management (fictional)",
    styles: docStyles(KW.font, 21, KW.text, { color: KW.green, h1Size: 24, h2Size: 21, h2Color: KW.text }),
    header,
    footer,
    children,
  });
}

/* ------------------------------------------------------------------------------------------------
 * (d) Meridian Claims Services (fictional) – Physiotherapy Discharge Report (Word, boxes + content controls)
 * ----------------------------------------------------------------------------------------------*/

const MC = { font: "Cambria", slate: "2C3E50", orange: "C0561B", text: "222B33", grey: "5D6D7E", band: "2C3E50", label: "F2F4F6", border: "7F8C8D" };

/** A run-level text content control (inserted by post-processing, see injectContentControls()). */
function sdtMarker(tag, alias) {
  return r(`@@SDT:${tag}:${alias}@@`, { size: 20 });
}

/** A Word check-box content control (w14:checkbox, inserted by post-processing like Word writes it). */
function mcCheck(label) {
  return [r("@@CHK@@", { size: 20 }), r(` ${label}`, { size: 20 })];
}

function mcSection(no, title, rows, widths = [CONTENT_W]) {
  const b = line(MC.border, 6);
  return table(
    [
      tr(
        [
          tc([p([r(`${no}  `, { bold: true, color: "F5B041", size: 21 }), r(title.toUpperCase(), { bold: true, color: "FFFFFF", size: 19, characterSpacing: 20 })], { spacing: { after: 0 } })], {
            fill: MC.band,
            span: widths.length,
            margins: { top: 70, bottom: 70, left: 140, right: 140 },
          }),
        ],
        { header: false },
      ),
      ...rows,
    ],
    widths,
    { borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: line(MC.border, 2), insideVertical: line(MC.border, 2) } },
  );
}

function mcQuestionRow(question, blankLines = 2, span) {
  const kids = [p([r(question, { bold: true, size: 20 })], { spacing: { after: 60 } })];
  for (let i = 0; i < blankLines; i++) kids.push(p([], { spacing: { after: 60 } }));
  return tr([tc(kids, { span, margins: { top: 100, bottom: 80, left: 140, right: 140 } })]);
}

function mcFieldRow(label, tag, widths) {
  return tr([
    tc([p([r(label, { size: 19, bold: true })], { spacing: { after: 0 } })], { fill: MC.label, width: widths[0], vAlign: VerticalAlignTable.CENTER }),
    tc([p([sdtMarker(tag, label)], { spacing: { after: 0 } })], { width: widths[1], vAlign: VerticalAlignTable.CENTER }),
  ], { height: 400 });
}

function meridian() {
  const header = [
    p(
      [
        r("MERIDIAN", { bold: true, size: 30, color: MC.slate, characterSpacing: 40 }),
        r(" CLAIMS SERVICES (fictional)", { size: 17, color: MC.orange, bold: true }),
        r("\tPhysiotherapy Discharge Report  ·  MCS/PDR/3", { size: 16, color: MC.grey }),
      ],
      {
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: MC.orange, space: 4 } },
        spacing: { after: 0 },
      },
    ),
  ];
  const footer = [
    p([r("Meridian Claims Services (fictional) – a fictional claims handler used for demonstration only.", { size: 14, color: MC.grey }), r("\t"), ...pageXofY(MC.grey, 14)], {
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      spacing: { after: 0 },
    }),
  ];
  const two = [3300, CONTENT_W - 3300];

  const children = [
    p([r("Physiotherapy Discharge Report", { bold: true, size: 34, color: MC.slate })], { spacing: { before: 120, after: 40 } }),
    p(
      [
        r(
          "Please complete every box. Type your answers in the grey fields or in the space under each question. If a question does not apply, write N/A.",
          { size: 18, color: MC.grey, italics: true },
        ),
      ],
      { spacing: { after: 200 } },
    ),
    mcSection(
      "1",
      "Claimant and treatment details",
      [
        mcFieldRow("Claimant's full name", "claimant_name", two),
        mcFieldRow("Date of birth", "claimant_dob", two),
        mcFieldRow("Meridian claim reference", "claim_ref", two),
        mcFieldRow("Date treatment started", "start_date", two),
        mcFieldRow("Date of discharge", "discharge_date", two),
      ],
      two,
    ),
    spacer(200),
    mcSection("2", "Diagnosis", [mcQuestionRow("What was your final diagnosis? Please include the mechanism of injury as reported to you.", 2)]),
    spacer(200),
    mcSection("3", "Progress during treatment", [
      mcQuestionRow("Please summarise the claimant's progress during treatment, including any objective outcome measures.", 3),
      mcQuestionRow("Please comment on the claimant's ability to carry out normal daily activities.", 2),
      tr([
        tc(
          [
            p(
              [
                r("Sessions attended:  ", { bold: true, size: 20 }),
                sdtMarker("sessions_attended", "Sessions attended"),
                r("        Sessions missed:  ", { bold: true, size: 20 }),
                sdtMarker("sessions_missed", "Sessions missed"),
              ],
              { spacing: { after: 0 } },
            ),
          ],
          { margins: { top: 100, bottom: 100, left: 140, right: 140 } },
        ),
      ]),
    ]),
    spacer(200),
    mcSection("4", "Outcome and recommendations", [
      tr([
        tc(
          [
            p([r("Reason for discharge", { bold: true, size: 20 })], { spacing: { after: 60 } }),
            p([...mcCheck("Goals achieved"), r("     "), ...mcCheck("Plateaued"), r("     "), ...mcCheck("Self-discharged"), r("     "), ...mcCheck("Did not attend")], {
              spacing: { after: 0 },
            }),
          ],
          { margins: { top: 100, bottom: 100, left: 140, right: 140 } },
        ),
      ]),
      tr([
        tc(
          [
            p([r("Is any further treatment or investigation recommended?", { bold: true, size: 20 })], { spacing: { after: 60 } }),
            p([...mcCheck("Yes"), r("          "), ...mcCheck("No")], { spacing: { after: 60 } }),
            p([r("If yes, please give details:  ", { size: 19 }), sdtMarker("further_details", "Further treatment details")], { spacing: { after: 0 } }),
          ],
          { margins: { top: 100, bottom: 100, left: 140, right: 140 } },
        ),
      ]),
      mcQuestionRow("In your opinion, what is the likely long-term outcome for this claimant?", 2),
    ]),
    spacer(200),
    mcSection(
      "5",
      "Therapist declaration",
      [
        tr([
          tc(
            [p([r("I confirm that this report is accurate and is based on my own clinical records of the claimant's treatment.", { size: 19 })], { spacing: { after: 0 } })],
            { span: 2, margins: { top: 100, bottom: 100, left: 140, right: 140 } },
          ),
        ]),
        mcFieldRow("Name", "therapist_name", two),
        mcFieldRow("Professional registration number", "registration_no", two),
        mcFieldRow("Date", "signed_date", two),
      ],
      two,
    ),
  ];

  return wordDocument({
    title: "Physiotherapy Discharge Report (MCS/PDR/3)",
    subject: "Meridian Claims Services (fictional)",
    styles: docStyles(MC.font, 20, MC.text, { color: MC.slate }),
    header,
    footer,
    children,
  });
}

let sdtId = 7301;

/**
 * Replace each @@SDT:tag:alias@@ marker run with a Word plain-text content control showing its placeholder,
 * and each @@CHK@@ marker run with a Word check-box content control (☐ in MS Gothic, as Word writes it).
 */
function injectContentControls(xml) {
  const withChecks = xml.replace(
    /<w:r>(?:<w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr>)?<w:t xml:space="preserve">@@CHK@@<\/w:t><\/w:r>/g,
    (_m, rPr) => {
      const id = sdtId++;
      const size = /<w:sz [^>]*\/>/.exec(rPr ?? "")?.[0] ?? "";
      return (
        `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w14:checkbox><w14:checked w14:val="0"/>` +
        `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
        `<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/>${size}</w:rPr>` +
        `<w:t>☐</w:t></w:r></w:sdtContent></w:sdt>`
      );
    },
  );
  return withChecks.replace(
    /<w:r>(?:<w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr>)?<w:t xml:space="preserve">@@SDT:([a-z_]+):([^@<]+)@@<\/w:t><\/w:r>/g,
    (_m, rPr, tag, alias) => {
      const id = sdtId++;
      const base = rPr ?? "";
      return (
        `<w:sdt><w:sdtPr><w:rPr>${base}</w:rPr><w:alias w:val="${alias}"/><w:tag w:val="${tag}"/><w:id w:val="${id}"/>` +
        `<w:placeholder><w:docPart w:val="DefaultPlaceholder_-1854013440"/></w:placeholder><w:showingPlcHdr/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/>${base}<w:color w:val="808080"/><w:shd w:val="clear" w:color="auto" w:fill="EDEFF2"/></w:rPr>` +
        `<w:t>Click or tap here to enter text.</w:t></w:r></w:sdtContent></w:sdt>`
      );
    },
  );
}

/** Adds the PlaceholderText character style Word uses for content-control placeholders. */
function addPlaceholderStyle(stylesXml) {
  if (stylesXml.includes('w:styleId="PlaceholderText"')) return stylesXml;
  const style =
    '<w:style w:type="character" w:styleId="PlaceholderText"><w:name w:val="Placeholder Text"/><w:basedOn w:val="DefaultParagraphFont"/>' +
    '<w:uiPriority w:val="99"/><w:semiHidden/><w:rPr><w:color w:val="808080"/></w:rPr></w:style>';
  return stylesXml.replace("</w:styles>", `${style}</w:styles>`);
}

/* ------------------------------------------------------------------------------------------------
 * (b) Northfield Assurance (fictional) – Rehabilitation Progress Report (fillable PDF)
 * ----------------------------------------------------------------------------------------------*/

const NA = {
  indigo: rgb(0.169, 0.227, 0.549),
  gold: rgb(0.949, 0.718, 0.02),
  text: rgb(0.11, 0.13, 0.17),
  grey: rgb(0.38, 0.42, 0.48),
  strip: rgb(0.91, 0.93, 0.97),
  fieldBg: rgb(0.965, 0.973, 0.992),
  fieldBorder: rgb(0.62, 0.66, 0.76),
  white: rgb(1, 1, 1),
};

async function northfield() {
  const doc = await PDFDocument.create();
  doc.setTitle("Rehabilitation Progress Report (NA-RPR-2)");
  doc.setAuthor("Northfield Assurance (fictional)");
  // Former product name kept on purpose: the recorded analyses and demo drafts are keyed to this file's SHA-256 (README "Renaming the product").
  doc.setSubject("Fictional insurer form for the AppStackX Reports demo");
  doc.setCreator("Northfield Assurance forms (fictional)");
  doc.setProducer("Northfield Assurance forms (fictional)");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setLanguage("en-GB");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const W = 595.28;
  const H = 841.89;
  const L = 40;
  const R = W - 40;
  const CW = R - L;

  const text = (page, s, x, y, size = 9, font = helv, color = NA.text) => page.drawText(s, { x, y, size, font, color });
  const textRight = (page, s, xr, y, size, font, color) => text(page, s, xr - font.widthOfTextAtSize(s, size), y, size, font, color);
  const fieldStyle = { borderColor: NA.fieldBorder, backgroundColor: NA.fieldBg, borderWidth: 0.75, textColor: NA.text, font: helv };

  const textField = (page, name, x, y, w, h, { multiline = false, size = 10, maxLength } = {}) => {
    const f = form.createTextField(name);
    if (multiline) f.enableMultiline();
    if (maxLength) f.setMaxLength(maxLength);
    f.addToPage(page, { x, y, width: w, height: h, ...fieldStyle });
    f.setFontSize(size);
    return f;
  };
  const strip = (page, label, y) => {
    page.drawRectangle({ x: L, y: y - 4, width: CW, height: 17, color: NA.strip });
    page.drawRectangle({ x: L, y: y - 4, width: 3, height: 17, color: NA.indigo });
    text(page, label, L + 9, y + 1, 9, bold, NA.indigo);
  };
  const label = (page, s, x, y, size = 8) => text(page, s, x, y, size, helv, NA.grey);
  const footer = (page, n) => {
    page.drawLine({ start: { x: L, y: 40 }, end: { x: R, y: 40 }, thickness: 0.5, color: NA.fieldBorder });
    text(page, "Northfield Assurance (fictional) - a fictional insurer used for demonstration only.  Form NA-RPR-2 (Rev. 05/2026)", L, 28, 7, helv, NA.grey);
    textRight(page, `Page ${n} of 2`, R, 28, 7, helv, NA.grey);
  };

  /* Page 1 ------------------------------------------------------------------------------------ */
  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: H - 76, width: W, height: 76, color: NA.indigo });
  p1.drawRectangle({ x: 0, y: H - 80, width: W, height: 4, color: NA.gold });
  text(p1, "NORTHFIELD ASSURANCE", L, H - 38, 19, bold, NA.white);
  text(p1, "(fictional)  ·  Personal Injury Rehabilitation Services", L, H - 56, 9, helv, NA.white);
  textRight(p1, "REHABILITATION", R, H - 34, 12, bold, NA.white);
  textRight(p1, "PROGRESS REPORT", R, H - 49, 12, bold, NA.white);
  textRight(p1, "Form NA-RPR-2", R, H - 63, 8, helv, NA.white);
  text(
    p1,
    "Please complete this form electronically or in BLOCK CAPITALS and return it to rehab@northfield-assurance.example within 10 working days",
    L,
    H - 100,
    8,
    helv,
    NA.grey,
  );
  text(p1, "of each review. All sections must be completed by the treating therapist.", L, H - 110, 8, helv, NA.grey);

  let y = H - 136;
  strip(p1, "CLAIM DETAILS", y);
  y -= 38;
  const colW = (CW - 12) / 2;
  const fieldRow = (lab1, name1, lab2, name2, yy) => {
    label(p1, lab1, L, yy + 20);
    textField(p1, name1, L, yy, colW, 17);
    if (lab2) {
      label(p1, lab2, L + colW + 12, yy + 20);
      textField(p1, name2, L + colW + 12, yy, colW, 17);
    }
  };
  fieldRow("Policy / claim no.", "txtPolicyNo", "Date of injury", "txtInjuryDate", y);
  y -= 34;
  fieldRow("Claimant", "txtClaimant", "Date of birth", "txtDOB", y);
  y -= 34;
  fieldRow("Date of first treatment", "txtFirstSeen", "Date of this report", "txtReportDate", y);

  y -= 34;
  strip(p1, "1.  DIAGNOSIS / WORKING DIAGNOSIS", y);
  y -= 70;
  textField(p1, "txtQ1Diagnosis", L, y, CW, 62, { multiline: true, size: 9 });

  y -= 28;
  strip(p1, "2.  TREATMENT TO DATE AND ATTENDANCE", y);
  label(p1, "Type of treatment, exercise programme and advice given", L + 250, y + 1, 7.5);
  y -= 94;
  textField(p1, "txtQ2Treatment", L, y, CW, 86, { multiline: true, size: 9 });
  y -= 26;
  label(p1, "Sessions attended", L, y + 5, 8.5);
  textField(p1, "numAttended", L + 78, y, 40, 17, { maxLength: 3 });
  label(p1, "Sessions missed (DNA)", L + 140, y + 5, 8.5);
  textField(p1, "numDNA", L + 238, y, 40, 17, { maxLength: 3 });
  const chk = form.createCheckBox("chkDischarged");
  chk.addToPage(p1, { x: L + 305, y: y + 3, width: 11, height: 11, borderColor: NA.fieldBorder, backgroundColor: NA.fieldBg, borderWidth: 0.75 });
  label(p1, "Treatment completed - claimant discharged", L + 321, y + 5, 8.5);

  y -= 32;
  strip(p1, "3.  FUNCTIONAL LIMITATIONS AFFECTING WORK AND DAILY ACTIVITIES", y);
  y -= 94;
  textField(p1, "txtQ3Limitations", L, y, CW, 86, { multiline: true, size: 9 });

  y -= 28;
  strip(p1, "4.  IS THE CLAIMANT FIT FOR WORK?", y);
  y -= 24;
  const rg = form.createRadioGroup("rdoFitForWork");
  const opts = [
    ["Yes", L],
    ["No", L + 90],
    ["Modified duties", L + 180],
  ];
  for (const [opt, x] of opts) {
    rg.addOptionToPage(opt, p1, { x, y, width: 11, height: 11, borderColor: NA.fieldBorder, backgroundColor: NA.fieldBg, borderWidth: 0.75 });
    text(p1, opt, x + 16, y + 2, 9.5, helv, NA.text);
  }
  y -= 18;
  label(p1, "If modified duties, please give details (duties, hours and expected duration)", L, y);
  y -= 50;
  textField(p1, "txtQ4Details", L, y, CW, 44, { multiline: true, size: 9 });
  footer(p1, 1);

  /* Page 2 ------------------------------------------------------------------------------------ */
  const p2 = doc.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: H - 34, width: W, height: 34, color: NA.indigo });
  p2.drawRectangle({ x: 0, y: H - 37, width: W, height: 3, color: NA.gold });
  text(p2, "NORTHFIELD ASSURANCE (fictional)", L, H - 22, 10, bold, NA.white);
  textRight(p2, "Rehabilitation Progress Report - continued", R, H - 22, 9, helv, NA.white);

  y = H - 66;
  strip(p2, "5.  RECOMMENDED FURTHER TREATMENT AND ESTIMATED SESSIONS", y);
  y -= 94;
  textField(p2, "txtQ5Further", L, y, CW, 86, { multiline: true, size: 9 });
  y -= 26;
  label(p2, "Estimated number of further sessions", L, y + 5, 8.5);
  textField(p2, "numFurtherSessions", L + 150, y, 40, 17, { maxLength: 3 });

  y -= 34;
  strip(p2, "6.  EXPECTED RECOVERY TIMESCALE (PROGNOSIS)", y);
  y -= 86;
  textField(p2, "txtQ6Prognosis", L, y, CW, 78, { multiline: true, size: 9 });

  y -= 30;
  strip(p2, "DECLARATION", y);
  y -= 18;
  text(p2, "I confirm that the information given in this report is accurate and is based on my own clinical records.", L, y, 8.5, helv, NA.text);
  y -= 34;
  const declRow = (lab1, name1, lab2, name2, yy) => {
    label(p2, lab1, L, yy + 20);
    textField(p2, name1, L, yy, colW, 17);
    label(p2, lab2, L + colW + 12, yy + 20);
    textField(p2, name2, L + colW + 12, yy, colW, 17);
  };
  declRow("Therapist name", "txtTherapistName", "HCPC registration no.", "txtHCPC", y);
  y -= 34;
  declRow("Signature (typed)", "txtSignature", "Date", "txtSignedDate", y);

  y -= 40;
  p2.drawRectangle({ x: L, y: y - 30, width: CW, height: 44, borderColor: NA.fieldBorder, borderWidth: 0.5, borderDashArray: [2, 2] });
  text(p2, "FOR NORTHFIELD ASSURANCE USE ONLY", L + 8, y + 2, 7.5, bold, NA.grey);
  label(p2, "Claims handler", L + 8, y - 18, 8);
  textField(p2, "txtOfficeHandler", L + 80, y - 23, 150, 16, { size: 9 });
  label(p2, "Date received", L + 260, y - 18, 8);
  textField(p2, "txtOfficeReceived", L + 330, y - 23, 100, 16, { size: 9 });
  footer(p2, 2);

  form.updateFieldAppearances(helv);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}


/* ------------------------------------------------------------------------------------------------
 * Ashcroft Medical Reporting (fictional) – Physiotherapy Update Report: a FLAT (non-fillable) PDF.
 * Printed questions with ruled answer lines – no form fields. Answers are written onto the page at the
 * positions in ASHCROFT_LAYOUT (also written to generated/ashcroft-layout.ts for the hand-made map).
 * ----------------------------------------------------------------------------------------------*/

const AM = {
  green: rgb(0.086, 0.396, 0.337),
  text: rgb(0.12, 0.13, 0.16),
  grey: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.62, 0.66, 0.7),
  strip: rgb(0.92, 0.95, 0.94),
  white: rgb(1, 1, 1),
};

/** Answer spaces (PDF points, origin bottom-left; page 1-based) – the map's overlay boxes. */
const ASHCROFT_LAYOUT = {
  claimantName: { page: 1, x: 202, y: 671, width: 350, height: 14 },
  dob: { page: 1, x: 202, y: 649, width: 150, height: 14 },
  solicitorRef: { page: 1, x: 202, y: 627, width: 200, height: 14 },
  accidentDate: { page: 1, x: 202, y: 605, width: 150, height: 14 },
  b1Symptoms: { page: 1, x: 42, y: 458, width: 511, height: 82 },
  b2Treatment: { page: 1, x: 42, y: 330, width: 511, height: 82 },
  b3Sessions: { page: 1, x: 252, y: 297, width: 60, height: 14 },
  b4Current: { page: 1, x: 42, y: 170, width: 511, height: 82 },
  c1Prognosis: { page: 2, x: 42, y: 668, width: 511, height: 82 },
  c2Further: { page: 2, x: 352, y: 633, width: 90, height: 14 },
  c3Details: { page: 2, x: 42, y: 540, width: 511, height: 46 },
  d1Name: { page: 2, x: 112, y: 455, width: 190, height: 14 },
  d1Hcpc: { page: 2, x: 392, y: 455, width: 160, height: 14 },
  d2Signature: { page: 2, x: 112, y: 427, width: 190, height: 14 },
  d2Date: { page: 2, x: 392, y: 427, width: 160, height: 14 },
  officeRef: { page: 2, x: 152, y: 366, width: 150, height: 14 },
};

async function ashcroft() {
  const doc = await PDFDocument.create();
  doc.setTitle("Physiotherapy Update Report (AMR-PU-2)");
  doc.setAuthor("Ashcroft Medical Reporting (fictional)");
  // Former product name kept on purpose: the recorded analyses and demo drafts are keyed to this file's SHA-256 (README "Renaming the product").
  doc.setSubject("Fictional medico-legal form for the AppStackX Reports demo (flat PDF, no form fields)");
  doc.setCreator("Ashcroft Medical Reporting (fictional)");
  doc.setProducer("Ashcroft Medical Reporting (fictional)");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setLanguage("en-GB");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const L = 40;
  const R = W - 40;
  const text = (page, str, x, y, size = 9, font = helv, color = AM.text) => page.drawText(str, { x, y, size, font, color });
  const rule = (page, x1, x2, y) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: AM.rule });
  const strip = (page, label, y) => {
    page.drawRectangle({ x: L, y: y - 5, width: R - L, height: 18, color: AM.strip });
    text(page, label, L + 8, y, 9.5, bold, AM.green);
  };
  /** A label with a ruled line for the answer under the box `b`. */
  const inline = (page, label, b) => {
    text(page, label, L, b.y + 3, 9);
    rule(page, b.x - 2, b.x + b.width + 2, b.y - 1);
  };
  /** A question followed by ruled lines filling box `b`. */
  const block = (page, question, b, hint) => {
    text(page, question, L, b.y + b.height + 12, 9.5, bold);
    if (hint) text(page, hint, L, b.y + b.height + 2, 7.5, helv, AM.grey);
    for (let y = b.y + b.height - 14; y >= b.y; y -= 16) rule(page, b.x, b.x + b.width, y);
  };
  const footer = (page, n) => {
    text(page, "Ashcroft Medical Reporting (fictional) – a fictional agency used for demonstration only.  AMR-PU-2 (03/2026)", L, 30, 7, helv, AM.grey);
    const t = `Page ${n} of 2`;
    text(page, t, R - helv.widthOfTextAtSize(t, 7), 30, 7, helv, AM.grey);
  };
  const A = ASHCROFT_LAYOUT;

  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: AM.green });
  text(p1, "ASHCROFT MEDICAL REPORTING", L, H - 36, 18, bold, AM.white);
  text(p1, "(fictional)  ·  Independent medical reporting for personal injury claims", L, H - 53, 8.5, helv, AM.white);
  const t1 = "PHYSIOTHERAPY UPDATE REPORT";
  text(p1, t1, R - bold.widthOfTextAtSize(t1, 11), H - 36, 11, bold, AM.white);
  text(p1, "Form AMR-PU-2", R - helv.widthOfTextAtSize("Form AMR-PU-2", 8), H - 52, 8, helv, AM.white);
  text(p1, "To be completed by the treating physiotherapist. Please print clearly and return within 10 working days.", L, H - 92, 8.5, helv, AM.grey);

  strip(p1, "SECTION A – CLAIMANT", 706);
  inline(p1, "Claimant name:", A.claimantName);
  inline(p1, "Date of birth:", A.dob);
  inline(p1, "Instructing solicitor's reference:", A.solicitorRef);
  inline(p1, "Date of accident:", A.accidentDate);

  strip(p1, "SECTION B – TREATMENT", 575);
  block(p1, "B1. Presenting symptoms at the first assessment", A.b1Symptoms);
  block(p1, "B2. Treatment provided", A.b2Treatment, "Type of treatment, home exercise programme and advice");
  text(p1, "B3. Number of treatment sessions attended", L, A.b3Sessions.y + 3, 9.5, bold);
  rule(p1, A.b3Sessions.x - 2, A.b3Sessions.x + A.b3Sessions.width + 2, A.b3Sessions.y - 1);
  block(p1, "B4. Current symptoms and level of function", A.b4Current);
  footer(p1, 1);

  const p2 = doc.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: H - 30, width: W, height: 30, color: AM.green });
  text(p2, "ASHCROFT MEDICAL REPORTING (fictional) – Physiotherapy Update Report, continued", L, H - 20, 9, bold, AM.white);
  strip(p2, "SECTION C – OPINION", 786);
  block(p2, "C1. Prognosis", A.c1Prognosis, "Your professional opinion on the expected course of recovery");
  text(p2, "C2. Is further treatment recommended? (Yes / No)", L, A.c2Further.y + 3, 9.5, bold);
  rule(p2, A.c2Further.x - 2, A.c2Further.x + A.c2Further.width + 2, A.c2Further.y - 1);
  block(p2, "C3. If yes, please give details", A.c3Details);

  strip(p2, "SECTION D – DECLARATION", 510);
  text(p2, "I confirm that the information in this report is accurate and based on the clinical records.", L, 486, 8.5);
  inline(p2, "Name:", A.d1Name);
  text(p2, "HCPC no.:", 330, A.d1Hcpc.y + 3, 9);
  rule(p2, A.d1Hcpc.x - 2, A.d1Hcpc.x + A.d1Hcpc.width + 2, A.d1Hcpc.y - 1);
  inline(p2, "Signature:", A.d2Signature);
  text(p2, "Date:", 330, A.d2Date.y + 3, 9);
  rule(p2, A.d2Date.x - 2, A.d2Date.x + A.d2Date.width + 2, A.d2Date.y - 1);

  p2.drawRectangle({ x: L, y: 352, width: R - L, height: 44, borderColor: AM.rule, borderWidth: 0.5, borderDashArray: [2, 2] });
  text(p2, "FOR ASHCROFT USE ONLY", L + 8, 384, 7.5, bold, AM.grey);
  text(p2, "File ref.:", L + 8, A.officeRef.y + 3, 8, helv, AM.grey);
  rule(p2, A.officeRef.x - 2, A.officeRef.x + A.officeRef.width + 2, A.officeRef.y - 1);
  footer(p2, 2);

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/* ------------------------------------------------------------------------------------------------
 * Output
 * ----------------------------------------------------------------------------------------------*/

/** Pin core.xml dates and zip entry dates; optionally transform XML parts. */
function normalise(buffer, transform = {}) {
  const src = new PizZip(buffer);
  const out = new PizZip();
  const stamp = FIXED_DATE.toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const name of Object.keys(src.files)) {
    const f = src.files[name];
    if (f.dir) continue;
    if (name === "docProps/core.xml") {
      const xml = f
        .asText()
        .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/, `$1${stamp}$2`)
        .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${stamp}$2`);
      out.file(name, xml, { date: FIXED_DATE });
    } else if (transform[name]) {
      out.file(name, transform[name](f.asText()), { date: FIXED_DATE });
    } else {
      out.file(name, f.asUint8Array(), { date: FIXED_DATE, binary: true });
    }
  }
  return out.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function moduleSource({ constName, note, b64 }) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 160) lines.push(`  "${b64.slice(i, i + 160)}",`);
  return [
    'import "server-only";',
    "/* eslint-disable */",
    "// GENERATED by scripts/medreport/build-demo-forms.mjs – do not edit by hand.",
    `// ${note}`,
    `export const ${constName} =\n[\n${lines.join("\n")}\n].join("");`,
    "",
  ].join("\n");
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

const SAMPLES = [
  {
    id: "harrow-pike-treating-physio",
    fileName: "Harrow-Pike-ML_Treating-Physiotherapist-Report_HPM-TP3.docx",
    mimeType: DOCX,
    constName: "HARROW_PIKE_TREATING_PHYSIO_DOCX_BASE64",
    note: "Harrow & Pike Medico-Legal (fictional) – Treating Physiotherapist Report (Word, tables).",
    build: async () => normalise(await Packer.toBuffer(harrowPike())),
  },
  {
    id: "northfield-rehab-progress",
    fileName: "Northfield-Assurance_Rehabilitation-Progress-Report_NA-RPR-2.pdf",
    mimeType: PDF,
    constName: "NORTHFIELD_REHAB_PROGRESS_PDF_BASE64",
    note: "Northfield Assurance (fictional) – Rehabilitation Progress Report (fillable PDF).",
    build: northfield,
  },
  {
    id: "kingsway-rtw-assessment",
    fileName: "Kingsway-CM_Return-to-Work-Assessment_KCM-RTW-01.docx",
    mimeType: DOCX,
    constName: "KINGSWAY_RTW_ASSESSMENT_DOCX_BASE64",
    note: "Kingsway Case Management (fictional) – Return to Work Assessment (Word, headings and placeholders).",
    build: async () => normalise(await Packer.toBuffer(kingsway())),
  },
  {
    id: "ashcroft-update-report",
    fileName: "Ashcroft-MR_Physiotherapy-Update-Report_AMR-PU-2.pdf",
    mimeType: PDF,
    constName: "ASHCROFT_UPDATE_REPORT_PDF_BASE64",
    note: "Ashcroft Medical Reporting (fictional) – Physiotherapy Update Report (FLAT PDF, no form fields).",
    build: ashcroft,
  },
  {
    id: "meridian-discharge-report",
    fileName: "Meridian-Claims_Physiotherapy-Discharge-Report_MCS-PDR-3.docx",
    mimeType: DOCX,
    constName: "MERIDIAN_DISCHARGE_REPORT_DOCX_BASE64",
    note: "Meridian Claims Services (fictional) – Physiotherapy Discharge Report (Word, boxes and content controls).",
    build: async () => {
      sdtId = 7301;
      return normalise(await Packer.toBuffer(meridian()), {
        "word/document.xml": injectContentControls,
        "word/styles.xml": addPlaceholderStyle,
      });
    },
  },
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const copyDir = argValue("--out");
  if (copyDir) fs.mkdirSync(copyDir, { recursive: true });
  const manifest = {};
  for (const s of SAMPLES) {
    const bytes = await s.build();
    const ext = s.mimeType === PDF ? "pdf" : "docx";
    const file = path.join(OUT_DIR, `${s.id}.${ext}.b64.ts`);
    fs.writeFileSync(file, moduleSource({ constName: s.constName, note: s.note, b64: bytes.toString("base64") }));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    manifest[s.id] = { fileName: s.fileName, mimeType: s.mimeType, sha256, sizeBytes: bytes.length, constName: s.constName };
    if (copyDir) fs.writeFileSync(path.join(copyDir, s.fileName), bytes);
    console.log(`form  ${s.id.padEnd(30)} ${String(bytes.length).padStart(7)} bytes  sha256 ${sha256.slice(0, 12)}…  → ${path.relative(ROOT, file)}`);
  }
  const entries = Object.entries(manifest)
    .map(
      ([id, m]) =>
        `  "${id}": {\n    fileName: "${m.fileName}",\n    mimeType: "${m.mimeType}",\n    sha256: "${m.sha256}",\n    sizeBytes: ${m.sizeBytes},\n  },`,
    )
    .join("\n");
  const manifestSrc = [
    "/* eslint-disable */",
    "// GENERATED by scripts/medreport/build-demo-forms.mjs – do not edit by hand.",
    "// File facts of the bundled fictional referrer forms; the pre-confirmed form maps bind to these SHA-256s.",
    'import type { FormFile } from "../../../core/types";',
    "",
    "export const SAMPLE_FORM_FILES = {",
    entries,
    "} as const satisfies Record<string, FormFile>;",
    "",
    "export type SampleFormFileId = keyof typeof SAMPLE_FORM_FILES;",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "manifest.ts"), manifestSrc);
  // The flat PDF's answer spaces, for its hand-made map (forms/samples/maps/ashcroft.ts).
  fs.writeFileSync(
    path.join(OUT_DIR, "ashcroft-layout.ts"),
    [
      "/* eslint-disable */",
      "// GENERATED by scripts/medreport/build-demo-forms.mjs – do not edit by hand.",
      "// Answer spaces of the flat Ashcroft PDF (PDF points, origin bottom-left, page 1-based).",
      `export const ASHCROFT_LAYOUT = ${JSON.stringify(ASHCROFT_LAYOUT, null, 2)} as const;`,
      "",
    ].join("\n"),
  );
  console.log(`manifest → ${path.relative(ROOT, path.join(OUT_DIR, "manifest.ts"))}`);
}

await main();
