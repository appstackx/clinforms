/**
 * Builds the tagged Word templates with docx@9.8.1 and writes them as base64 TS modules to
 * src/modules/medreport/templates/generated/*.docx.b64.ts, so Vercel bundles them with no extra config.
 *
 *   riverside-solicitor-v1   Treating Physiotherapist Report (RTA, solicitor) – Riverside house style
 *   riverside-employer-v1    Fitness for Work Report (employer)             – Riverside house style
 *   clinic-style-v1          "Upload your own template" sample: a visibly different house style
 *                            (Riverside Physiotherapy – Medico-legal Department (fictional))
 *   clinic-style-v1-broken   the same file with ONE unclosed tag, for the validation demo
 *
 * It also bundles the PDF font (DejaVu Sans regular + bold, Bitstream Vera licence) as base64 modules
 * in src/modules/medreport/docgen/pdf/fonts/ when the system TTFs are present. Pass --no-fonts to skip.
 *
 * Every tag is written inside a single run (docxtemplater merges split runs within one paragraph, but
 * a single run keeps the template easy to edit). Tags are documented in templates/tag-reference.ts.
 *
 * Run: npm run medreport:templates   (tsx scripts/medreport/build-templates.mjs)
 * Owner: forms-engine agent (formerly docgen).
 */
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
  LevelFormat,
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
import PizZip from "pizzip";
import { DEMO_CLINIC } from "../../src/modules/medreport/config.public.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "src/modules/medreport/templates/generated");
const FONT_OUT_DIR = path.join(ROOT, "src/modules/medreport/docgen/pdf/fonts");
const FONT_SRC_DIR = "/usr/share/fonts/truetype/dejavu";
const FONT_LICENSE_SRC = "/usr/share/doc/fonts-dejavu-core/copyright";

/** Fixed timestamp for the zip entries and core.xml so re-running the script is reproducible. */
const FIXED_DATE = new Date("2026-10-01T09:00:00.000Z");

/* ------------------------------------------------------------------------------------------------
 * House styles
 * ----------------------------------------------------------------------------------------------*/

const RIVERSIDE = {
  key: "riverside",
  font: "Calibri",
  headingFont: "Calibri",
  bodySize: 21, // half-points (10.5 pt)
  primary: "0F766E", // teal-700: prints well, AA contrast on white
  accent: "0D9488", // studio teal
  text: "1F2933",
  muted: "52606D",
  labelShade: "F0FDFA",
  headShade: "0F766E",
  rule: "99D5CF",
  draft: "B42318",
  bodyAlign: AlignmentType.LEFT,
};

const CLINIC = {
  key: "clinic",
  font: "Cambria",
  headingFont: "Georgia",
  bodySize: 22,
  primary: "1F3A5F", // navy
  accent: "7A1F3D", // burgundy
  text: "1B1B1B",
  muted: "5B5B5B",
  labelShade: "FFFFFF",
  headShade: "1F3A5F",
  rule: "1F3A5F",
  draft: "7A1F3D",
  bodyAlign: AlignmentType.JUSTIFIED,
};

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

/* ------------------------------------------------------------------------------------------------
 * Small builders
 * ----------------------------------------------------------------------------------------------*/

/** One run. `text` may hold a whole docxtemplater tag. */
function run(text, opts = {}) {
  return new TextRun({ text, ...opts });
}

function para(children, opts = {}) {
  const kids = (Array.isArray(children) ? children : [children]).map((c) => (typeof c === "string" ? run(c) : c));
  return new Paragraph({ children: kids, ...opts });
}

/** A paragraph that holds only a loop/condition marker; paragraphLoop removes it from the output. */
function marker(tag) {
  return new Paragraph({ children: [run(tag)], spacing: { before: 0, after: 0 } });
}

function cell(children, opts = {}) {
  const { width, shade, borders, align, vAlign, margins, columnSpan } = opts;
  return new TableCell({
    children: (Array.isArray(children) ? children : [children]).map((c) =>
      c instanceof Paragraph || c instanceof Table ? c : para(c, { alignment: align }),
    ),
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shade ? { type: ShadingType.CLEAR, color: "auto", fill: shade } : undefined,
    borders,
    verticalAlign: vAlign ?? VerticalAlignTable.CENTER,
    margins: margins ?? { top: 70, bottom: 70, left: 110, right: 110 },
    columnSpan,
  });
}

function rowBorders(theme, style) {
  if (style === "grid") {
    const b = { style: BorderStyle.SINGLE, size: 4, color: theme.rule };
    return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
  }
  const line = { style: BorderStyle.SINGLE, size: 4, color: theme.rule };
  return {
    top: { style: BorderStyle.SINGLE, size: 8, color: theme.primary },
    bottom: line,
    left: NO_BORDER,
    right: NO_BORDER,
    insideHorizontal: line,
    insideVertical: NO_BORDER,
  };
}

/** Key/value details table: shaded label column. */
function detailsTable(theme, rows, style = "lines") {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: rowBorders(theme, style),
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(para(run(label, { bold: true, color: theme.primary, size: theme.bodySize - 1 })), {
              width: 32,
              shade: theme.labelShade,
            }),
            cell(para(Array.isArray(value) ? value : [run(value)]), { width: 68 }),
          ],
        }),
    ),
  });
}

/**
 * Data table whose single body row is a docxtemplater row loop: `{#loop}` opens in the first cell and
 * `{/loop}` closes in the last cell, so the row repeats once per item.
 */
function loopTable(theme, { loop, columns, style = "lines", size }) {
  const fontSize = size ?? theme.bodySize - 2;
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: columns.map((c) =>
      cell(para(run(c.label, { bold: true, color: "FFFFFF", size: fontSize })), {
        width: c.width,
        shade: theme.headShade,
        align: c.align,
      }),
    ),
  });
  const body = new TableRow({
    cantSplit: true,
    children: columns.map((c, i) => {
      const text = `${i === 0 ? `{#${loop}}` : ""}${c.tag}${i === columns.length - 1 ? `{/${loop}}` : ""}`;
      return cell(para(run(text, { size: fontSize, bold: c.bold })), { width: c.width, align: c.align });
    }),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: rowBorders(theme, style),
    rows: [header, body],
  });
}

function spacer(after = 120) {
  return new Paragraph({ children: [], spacing: { before: 0, after } });
}

function pageNumberRun(theme, size = 16) {
  return new TextRun({
    children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
    size,
    color: theme.muted,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Shared blocks (both Riverside templates)
 * ----------------------------------------------------------------------------------------------*/

const addressLine = [...DEMO_CLINIC.addressLines, DEMO_CLINIC.phone, DEMO_CLINIC.email].join("  ·  ");

function riversideHeader(theme) {
  return new Header({
    children: [
      para(
        [
          run(DEMO_CLINIC.name.replace(" (fictional)", ""), { bold: true, color: theme.primary, size: 30 }),
          run("  (fictional)", { color: theme.muted, size: 18 }),
          run("\tPrivate and confidential", { color: theme.muted, size: 16 }),
        ],
        { tabStops: [{ type: TabStopType.RIGHT, position: 9638 }], spacing: { after: 40 } },
      ),
      para([run(`Physiotherapy  ·  ${DEMO_CLINIC.town}`, { color: theme.accent, size: 17, bold: true })], {
        spacing: { after: 20 },
      }),
      para([run(addressLine, { color: theme.muted, size: 15 })], {
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: theme.primary, space: 6 } },
        spacing: { after: 60 },
      }),
      para([run("{#isDraft}DRAFT – NOT SIGNED{/isDraft}", { bold: true, color: theme.draft, size: 18 })], {
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
      }),
    ],
  });
}

function riversideFooter(theme) {
  return new Footer({
    children: [
      para([run("{footer.left}", { color: theme.muted, size: 15 }), run("\t"), pageNumberRun(theme, 15)], {
        tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: theme.rule, space: 6 } },
        spacing: { after: 20 },
      }),
      para([run("{footer.right}", { color: theme.muted, size: 15 })], { spacing: { after: 0 } }),
    ],
  });
}

/** The repeating report sections with their locked "from records" tables. */
function sectionsBlock(theme, { headingStyle = HeadingLevel.HEADING_1, tableStyle = "lines" } = {}) {
  return [
    marker("{#sections}"),
    new Paragraph({ heading: headingStyle, children: [run("{heading}")], keepNext: true }),
    marker("{#paragraphs}"),
    para([run("{text}")], { style: "ReportBody" }),
    marker("{/paragraphs}"),
    marker("{#showAttendance}"),
    loopTable(theme, {
      loop: "attendance",
      style: tableStyle,
      columns: [
        { label: "Date", tag: "{date}", width: 15 },
        { label: "Time", tag: "{time}", width: 10 },
        { label: "Status", tag: "{statusLabel}", width: 20, bold: false },
        { label: "Clinician", tag: "{clinician}", width: 20 },
        { label: "Reason recorded", tag: "{reason}", width: 35 },
      ],
    }),
    para([run("{attendanceSummary}", { size: theme.bodySize - 3, color: theme.muted })], {
      spacing: { before: 60, after: 160 },
    }),
    marker("{/showAttendance}"),
    marker("{#showOutcomes}"),
    loopTable(theme, {
      loop: "outcomes",
      style: tableStyle,
      columns: [
        { label: "Measure", tag: "{label}", width: 30, bold: true },
        { label: "First", tag: "{first} ({firstDate})", width: 17 },
        { label: "Latest", tag: "{latest} ({latestDate})", width: 17 },
        { label: "Change", tag: "{change}", width: 11 },
        { label: "Scores over time", tag: "{seriesText}", width: 25 },
      ],
    }),
    para([run("{#outcomes}{instrument}: {scaleNote} {/outcomes}", { size: theme.bodySize - 3, color: theme.muted })], {
      spacing: { before: 60, after: 160 },
    }),
    marker("{/showOutcomes}"),
    marker("{#showRecordsReviewed}"),
    para([run("The full list of records reviewed is in Appendix A.", { color: theme.muted })], { style: "ReportBody" }),
    marker("{/showRecordsReviewed}"),
    marker("{/sections}"),
  ];
}

function declarationBlock(theme) {
  return [
    marker("{#hasDeclaration}"),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("{declarationHeading}")], keepNext: true }),
    marker("{#declarationParagraphs}"),
    para([run("{text}")], { style: "ReportBody" }),
    marker("{/declarationParagraphs}"),
    marker("{/hasDeclaration}"),
  ];
}

function boxed(theme, children, color) {
  const b = { style: BorderStyle.SINGLE, size: 12, color };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [cell(children, { width: 100, margins: { top: 160, bottom: 160, left: 220, right: 220 } })],
      }),
    ],
  });
}

function signatureBlock(theme, { title = "Signature" } = {}) {
  const small = theme.bodySize - 3;
  return [
    marker("{#signed}"),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(title)], keepNext: true }),
    boxed(
      theme,
      [
        para([run("Signed electronically by", { color: theme.muted, size: small })], { spacing: { after: 40 } }),
        para([run("{signature.name}", { bold: true, size: 30, color: theme.primary })], { spacing: { after: 20 } }),
        para([run("{signature.role}", { size: theme.bodySize })], { spacing: { after: 20 } }),
        para([run("HCPC registration number: ", { color: theme.muted }), run("{signature.hcpc}", { bold: true })], {
          spacing: { after: 20 },
        }),
        para([run("Date and time signed: ", { color: theme.muted }), run("{signature.signedAt} (UK time)")], {
          spacing: { after: 120 },
        }),
        para([run("{signature.statement}", { size: small })], { spacing: { after: 80 } }),
        para([run("The signer confirmed that:", { size: small, color: theme.muted })], { spacing: { after: 40 } }),
        marker("{#signature.attestations}"),
        para([run("✓  ", { color: theme.accent, bold: true, size: small }), run("{text}", { size: small })], {
          indent: { left: 280, hanging: 280 },
          spacing: { after: 40 },
        }),
        marker("{/signature.attestations}"),
        para(
          [
            run("Document fingerprint  ", { color: theme.muted, size: small }),
            run("{signature.hashShort}", { bold: true, color: theme.primary, size: theme.bodySize + 1 }),
          ],
          {
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: theme.rule, space: 6 } },
            spacing: { before: 120, after: 20 },
          },
        ),
        para([run("SHA-256 {signature.hash}", { font: "Consolas", size: 14, color: theme.muted })], {
          spacing: { after: 20 },
        }),
        para(
          [
            run(
              "The fingerprint is a SHA-256 hash of the signed report content, sealed by a server-issued sign-off receipt. Any later change to the content produces a different fingerprint.",
              { size: 15, color: theme.muted },
            ),
          ],
          { spacing: { after: 0 } },
        ),
      ],
      theme.primary,
    ),
    marker("{/signed}"),
    marker("{#isDraft}"),
    spacer(120),
    boxed(
      theme,
      [
        para([run("DRAFT – NOT SIGNED", { bold: true, color: theme.draft, size: theme.bodySize + 3 })], {
          spacing: { after: 60 },
        }),
        para(
          [
            run(
              "This report has not been reviewed and signed by the treating physiotherapist. It must not be disclosed or relied on. The signature, HCPC number and document fingerprint appear here once it is signed.",
              { size: small },
            ),
          ],
          { spacing: { after: 0 } },
        ),
      ],
      theme.draft,
    ),
    marker("{/isDraft}"),
  ];
}

function appendixBlock(theme, { tableStyle = "lines", heading = "Appendix A – Records reviewed" } = {}) {
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(heading)], pageBreakBefore: true, keepNext: true }),
    para(
      [
        run(
          "Every record held for this episode of care was reviewed in preparing this report. Records relied on in the report are marked ✓. Notes are listed by date with their author.",
        ),
      ],
      { style: "ReportBody" },
    ),
    loopTable(theme, {
      loop: "recordsReviewed",
      style: tableStyle,
      columns: [
        { label: "Date", tag: "{date}", width: 14 },
        { label: "Record", tag: "{description}", width: 40 },
        { label: "Author", tag: "{author}", width: 34 },
        { label: "Relied on", tag: "{citedMark}", width: 12, align: AlignmentType.CENTER },
      ],
    }),
    para([run("Source of records: ", { bold: true, size: 16, color: theme.muted }), run("{provenance}", { size: 16, color: theme.muted })], {
      spacing: { before: 120, after: 0 },
    }),
  ];
}

function reviewCopyNotice(theme) {
  return [
    marker("{#reviewCopy}"),
    para(
      [
        run("Internal review copy. ", { bold: true, color: theme.draft }),
        run(
          "Dates in square brackets after each paragraph show the source records it relies on. Remove before disclosure: download a standard copy instead.",
          { color: theme.draft },
        ),
      ],
      { style: "ReportBody", shading: { type: ShadingType.CLEAR, color: "auto", fill: "FEF3F2" } },
    ),
    marker("{/reviewCopy}"),
  ];
}

function documentStyles(theme) {
  return {
    default: {
      document: { run: { font: theme.font, size: theme.bodySize, color: theme.text } },
      title: { run: { font: theme.headingFont, size: 40, bold: true, color: theme.primary } },
      heading1: {
        run: { font: theme.headingFont, size: 26, bold: true, color: theme.primary },
        paragraph: { spacing: { before: 300, after: 120 }, keepNext: true },
      },
      heading2: {
        run: { font: theme.headingFont, size: 23, bold: true, color: theme.primary },
        paragraph: { spacing: { before: 200, after: 80 }, keepNext: true },
      },
    },
    paragraphStyles: [
      {
        id: "ReportBody",
        name: "Report body",
        basedOn: "Normal",
        quickFormat: true,
        run: { font: theme.font, size: theme.bodySize },
        paragraph: { spacing: { after: 140, line: 288 }, alignment: theme.bodyAlign },
      },
    ],
  };
}

const PAGE = {
  size: { width: 11906, height: 16838 }, // A4 in twips
  margin: { top: 1700, bottom: 1300, left: 1134, right: 1134, header: 567, footer: 567 },
};

/* ------------------------------------------------------------------------------------------------
 * Riverside templates (solicitor + employer)
 * ----------------------------------------------------------------------------------------------*/

function riversideTemplate({ title, subtitle, detailsRows, intro }) {
  const theme = RIVERSIDE;
  return new Document({
    creator: DEMO_CLINIC.name,
    title,
    description: "Tagged report template for ClinForms (docxtemplater tags in braces).",
    styles: documentStyles(theme),
    numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•" }] }] },
    sections: [
      {
        properties: { page: PAGE },
        headers: { default: riversideHeader(theme) },
        footers: { default: riversideFooter(theme) },
        children: [
          para([run(title, { bold: true, size: 40, color: theme.primary, font: theme.headingFont })], {
            heading: HeadingLevel.TITLE,
            spacing: { before: 120, after: 60 },
          }),
          para([run(subtitle, { size: 22, color: theme.muted })], { spacing: { after: 240 } }),
          ...reviewCopyNotice(theme),
          detailsTable(theme, detailsRows),
          spacer(120),
          para([run(intro, { size: theme.bodySize - 2, color: theme.muted })], { style: "ReportBody" }),
          ...sectionsBlock(theme),
          ...declarationBlock(theme),
          ...signatureBlock(theme),
          ...appendixBlock(theme),
        ],
      },
    ],
  });
}

const incidentDateTag = "{#incident.present}{incident.date}{/incident.present}{^incident.present}Not recorded{/incident.present}";

function solicitorTemplate() {
  return riversideTemplate({
    title: "Treating Physiotherapist Report",
    subtitle: "Road traffic accident – personal injury claim  ·  Factual report from the clinical record",
    detailsRows: [
      ["Claimant", [run("{patient.fullName}", { bold: true })]],
      ["Date of birth", "{patient.dob} (aged {patient.age})"],
      ["Occupation", "{patient.occupation}"],
      ["Instructing party", "{instructingParty.name}"],
      ["Your reference", "{instructingParty.reference}"],
      ["Date of incident", incidentDateTag],
      ["Treatment period", "{episode.firstAppointment} to {episode.lastAppointment} ({episode.statusLabel})"],
      ["Treating clinicians", "{episode.clinicianNames}"],
      ["Date of report", "{report.date}"],
    ],
    intro:
      "This is a factual report by the treating physiotherapist, prepared from the clinic's records of the episode of care. It is not a MedCo initial medical report. Statements are attributed to the patient (as reported) or to the clinician who recorded them.",
  });
}

function employerTemplate() {
  return riversideTemplate({
    title: "Fitness for Work Report",
    subtitle: "Prepared for the employer with the employee's consent  ·  Fitness for work only",
    detailsRows: [
      ["Employee", [run("{patient.fullName}", { bold: true })]],
      ["Date of birth", "{patient.dob} (aged {patient.age})"],
      ["Job role", "{patient.occupation}"],
      ["Employer", "{instructingParty.name}"],
      ["Employer reference", "{instructingParty.reference}"],
      ["Date of injury", incidentDateTag],
      ["Treatment period", "{episode.firstAppointment} to {episode.lastAppointment} ({episode.statusLabel})"],
      ["Treating clinicians", "{episode.clinicianNames}"],
      ["Date of report", "{report.date}"],
    ],
    intro:
      "This report covers fitness for work only. In line with the employee's consent, it does not disclose unrelated health information. Statements are attributed to the employee (as reported) or to the clinician who recorded them.",
  });
}

/* ------------------------------------------------------------------------------------------------
 * Clinic-style sample ("upload your own template")
 * ----------------------------------------------------------------------------------------------*/

const CLINIC_LETTERHEAD = "Riverside Physiotherapy – Medico-legal Department (fictional)";

function clinicStyleTemplate({ broken }) {
  const theme = CLINIC;
  const double = { style: BorderStyle.DOUBLE, size: 6, color: theme.primary, space: 4 };
  const header = new Header({
    children: [
      para([run(CLINIC_LETTERHEAD.toUpperCase(), { font: theme.headingFont, size: 22, bold: true, color: theme.primary, characterSpacing: 20 })], {
        alignment: AlignmentType.CENTER,
        spacing: { after: 30 },
      }),
      para([run(`${DEMO_CLINIC.addressLines.join(", ")}  |  Tel ${DEMO_CLINIC.phone}`, { size: 15, color: theme.muted, italics: true })], {
        alignment: AlignmentType.CENTER,
        border: { bottom: double },
        spacing: { after: 60 },
      }),
      para([run("{#isDraft}*** DRAFT – NOT SIGNED ***{/isDraft}", { bold: true, color: theme.draft, size: 17 })], {
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
      }),
    ],
  });
  const footer = new Footer({
    children: [
      para([run("Medico-legal Department  ·  Private and confidential  ·  ", { size: 15, color: theme.muted, italics: true }), pageNumberRun(theme, 15)], {
        alignment: AlignmentType.CENTER,
        border: { top: double },
        spacing: { after: 20 },
      }),
      para([run("{footer.right}", { size: 14, color: theme.muted })], { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
    ],
  });

  const referenceTag = broken ? "{instructingParty.reference" : "{instructingParty.reference}";
  const letterRows = [
    para([run("Our ref: ", { bold: true }), run("RPMD/{report.dateIso}")], { spacing: { after: 0 } }),
    para([run("Your ref: ", { bold: true }), run(referenceTag)], { spacing: { after: 0 } }),
    para([run("Date: ", { bold: true }), run("{report.date}")], { spacing: { after: 200 } }),
    para([run("{instructingParty.name}", { bold: true })], { spacing: { after: 0 } }),
    para([run("{instructingParty.address}")], { spacing: { after: 240 } }),
  ];

  return new Document({
    creator: CLINIC_LETTERHEAD,
    title: "Medico-legal report (clinic house style)",
    description: "Sample clinic template for the ClinForms upload demo.",
    styles: {
      default: {
        document: { run: { font: theme.font, size: theme.bodySize, color: theme.text } },
        title: { run: { font: theme.headingFont, size: 34, color: theme.accent, allCaps: true } },
        heading1: {
          run: { font: theme.headingFont, size: 22, bold: true, color: theme.primary, smallCaps: true },
          paragraph: {
            spacing: { before: 320, after: 120 },
            keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: theme.accent, space: 2 } },
          },
        },
        heading2: { run: { font: theme.headingFont, size: 21, bold: true, color: theme.accent } },
      },
      paragraphStyles: [
        {
          id: "ReportBody",
          name: "Report body",
          basedOn: "Normal",
          quickFormat: true,
          run: { font: theme.font, size: theme.bodySize },
          paragraph: { spacing: { after: 160, line: 300 }, alignment: theme.bodyAlign },
        },
      ],
    },
    sections: [
      {
        properties: { page: { ...PAGE, margin: { ...PAGE.margin, left: 1418, right: 1418 } } },
        headers: { default: header },
        footers: { default: footer },
        children: [
          ...letterRows,
          para([run("{report.title}", { font: theme.headingFont, size: 34, color: theme.accent, allCaps: true })], {
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
          para([run("Re: {patient.fullName}  ·  Date of birth {patient.dob}", { italics: true, color: theme.primary })], {
            alignment: AlignmentType.CENTER,
            spacing: { after: 280 },
          }),
          ...reviewCopyNotice(theme),
          detailsTable(
            theme,
            [
              ["Patient", "{patient.fullName}"],
              ["Occupation", "{patient.occupation}"],
              ["Date of incident", incidentDateTag],
              ["Period of treatment", "{episode.firstAppointment} – {episode.lastAppointment}"],
              ["Clinicians", "{episode.clinicianNames}"],
            ],
            "grid",
          ),
          ...sectionsBlock(theme, { tableStyle: "grid" }),
          ...declarationBlock(theme),
          ...signatureBlock(theme, { title: "Signed" }),
          ...appendixBlock(theme, { tableStyle: "grid", heading: "Schedule of records reviewed" }),
        ],
      },
    ],
  });
}

/* ------------------------------------------------------------------------------------------------
 * Output
 * ----------------------------------------------------------------------------------------------*/

const TEMPLATES = [
  {
    id: "riverside-solicitor-v1",
    constName: "RIVERSIDE_SOLICITOR_V1_DOCX_BASE64",
    doc: solicitorTemplate,
    note: "Treating Physiotherapist Report (RTA, solicitor) – Riverside Physiotherapy (fictional) house style.",
  },
  {
    id: "riverside-employer-v1",
    constName: "RIVERSIDE_EMPLOYER_V1_DOCX_BASE64",
    doc: employerTemplate,
    note: "Fitness for Work Report (employer) – Riverside Physiotherapy (fictional) house style.",
  },
  {
    id: "clinic-style-v1",
    constName: "CLINIC_STYLE_V1_DOCX_BASE64",
    doc: () => clinicStyleTemplate({ broken: false }),
    note: `Sample clinic template for the upload demo – "${CLINIC_LETTERHEAD}".`,
  },
  {
    id: "clinic-style-v1-broken",
    constName: "CLINIC_STYLE_V1_BROKEN_DOCX_BASE64",
    doc: () => clinicStyleTemplate({ broken: true }),
    note: "The clinic-style sample with ONE deliberately unclosed tag ({instructingParty.reference) for the validation demo.",
  },
];

/** Pin core.xml dates and zip entry dates so re-runs only change the file when the design changes. */
function normalise(buffer) {
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
    } else {
      out.file(name, f.asUint8Array(), { date: FIXED_DATE, binary: true });
    }
  }
  return out.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function wrapBase64(b64, width = 120) {
  const lines = [];
  for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines;
}

function moduleSource({ constName, note, b64, serverOnly, extra = "", width = 160 }) {
  // An array joined at load time (not a long "+" chain, which nests deeply in parsers).
  const body = `[\n${wrapBase64(b64, width)
    .map((l) => `  "${l}",`)
    .join("\n")}\n].join("")`;
  return [
    serverOnly ? 'import "server-only";\n' : "",
    "/* eslint-disable */",
    "// GENERATED by scripts/medreport/build-templates.mjs – do not edit by hand.",
    `// ${note}`,
    extra,
    `export const ${constName} =\n${body};`,
    "",
  ]
    .filter((l) => l !== "")
    .join("\n")
    .concat("\n");
}

async function buildTemplates() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const t of TEMPLATES) {
    const raw = await Packer.toBuffer(t.doc());
    const bytes = normalise(raw);
    const file = path.join(OUT_DIR, `${t.id}.docx.b64.ts`);
    fs.writeFileSync(file, moduleSource({ constName: t.constName, note: t.note, b64: bytes.toString("base64"), serverOnly: false }));
    console.log(`template  ${t.id.padEnd(24)} ${String(bytes.length).padStart(7)} bytes → ${path.relative(ROOT, file)}`);
  }
}

function buildFonts() {
  const fonts = [
    { src: "DejaVuSans.ttf", id: "dejavu-sans", constName: "DEJAVU_SANS_TTF_BASE64" },
    { src: "DejaVuSans-Bold.ttf", id: "dejavu-sans-bold", constName: "DEJAVU_SANS_BOLD_TTF_BASE64" },
  ];
  const missing = fonts.filter((f) => !fs.existsSync(path.join(FONT_SRC_DIR, f.src)));
  if (missing.length > 0) {
    console.warn(`fonts     skipped: ${missing.map((f) => f.src).join(", ")} not found in ${FONT_SRC_DIR} (committed modules kept)`);
    return;
  }
  fs.mkdirSync(FONT_OUT_DIR, { recursive: true });
  for (const f of fonts) {
    const bytes = fs.readFileSync(path.join(FONT_SRC_DIR, f.src));
    const file = path.join(FONT_OUT_DIR, `${f.id}.b64.ts`);
    fs.writeFileSync(
      file,
      moduleSource({
        constName: f.constName,
        note: `${f.src} (DejaVu fonts 2.37, Bitstream Vera licence – see LICENSE-DejaVu.txt). Unmodified.`,
        b64: bytes.toString("base64"),
        serverOnly: true,
        width: 1000,
      }),
    );
    console.log(`font      ${f.id.padEnd(24)} ${String(bytes.length).padStart(7)} bytes → ${path.relative(ROOT, file)}`);
  }
  if (fs.existsSync(FONT_LICENSE_SRC)) {
    fs.copyFileSync(FONT_LICENSE_SRC, path.join(FONT_OUT_DIR, "LICENSE-DejaVu.txt"));
  }
}

await buildTemplates();
if (!process.argv.includes("--no-fonts")) buildFonts();
