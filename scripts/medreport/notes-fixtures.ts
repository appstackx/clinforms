/**
 * FICTIONAL notes in the layouts real clinics send (production wave 3, the general notes reader): a practice-system
 * printout ("Date: … Practitioner: …" blocks, as text and as a two-page PDF with running headers), a letter-style
 * Word document, a Word document with a notes table, a CSV export with one row per appointment, pasted email-style
 * notes, and a diary with uncertain details. Every person, organisation, number and address is made up:
 * organisations end "(fictional)", clinicians use PH-DEMO-0N, phones are Ofcom drama numbers, emails @example.com.
 *
 * Used by notes-import.test.ts and the browser check (scripts/e2e/notes-import-check.cjs, through
 * write-notes-fixtures.ts). Never put real data here.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/* ------------------------------------------------------------------------------------------------
 * 1. Practice-system printout (text; the PDF below prints the same)
 * ----------------------------------------------------------------------------------------------*/

export const PRACTICE_HEADER = [
  "Riverside Physiotherapy (fictional) – Clinical notes report",
  "Printed: 09/10/2026 14:22 by reception",
  "Patient: Mrs Harriet Quill   Patient ID: RP-20417",
  "Date of birth: 14/09/1984   Sex: Female",
  "Address: 12 Larch Avenue, Testford",
  "Postcode: ZZ1 1ZZ",
  "Mobile: 07700 900417   Email: harriet.quill@example.com",
  "Insurer: Northgate Health Insurance (fictional)",
  "Membership number: NGH-4471-0923",
  "Authorisation number: AUTH-55821",
  "Referred by: Dr Anna Fielding, Elm Tree Surgery (fictional)",
  "GP practice: Elm Tree Surgery (fictional)",
];

export const PRACTICE_ENTRIES = [
  [
    "Date: 01/09/2026  Time: 09:00  Practitioner: Sarah Reid (PH-DEMO-01)",
    "Appointment type: Initial assessment",
    "Status: Attended",
    "Subjective: Right shoulder pain for 6 weeks after lifting a heavy box at home. Pain worse reaching overhead.",
    "NPRS 7/10 at worst. QuickDASH 52.3. PSFS 2.7.",
    "Objective: Flexion 110 degrees, abduction 95 degrees, painful arc 70-110.",
    "Assessment: Presentation consistent with rotator cuff related shoulder pain.",
    "Plan: Education, isometric loading programme, review in 1 week.",
  ],
  [
    "Date: 08/09/2026  Time: 09:30  Practitioner: Sarah Reid (PH-DEMO-01)",
    "Appointment type: Follow-up",
    "Status: Attended",
    "S: Pain easing, sleeping better. NPRS 5/10.",
    "O: Flexion 135 degrees.",
    "P: Progress to isotonic loading.",
  ],
  [
    "Date: 15/09/2026  Time: 09:30  Practitioner: Tom Ellis (PH-DEMO-02)",
    "Appointment type: Follow-up",
    "Status: Did not attend",
    "Patient did not attend. Text reminder sent; no reply.",
  ],
  [
    "Date: 22/09/2026  Time: 10:00  Practitioner: Tom Ellis (PH-DEMO-02)",
    "Appointment type: Discharge",
    "Status: Attended",
    "S: Back to normal activities, occasional ache after long days at work.",
    "O: Full active range. NPRS 2/10. QuickDASH 18.2. PSFS 7.9.",
    "A: Good progress, goals met.",
    "P: Discharged with home programme.",
  ],
];

export const PRACTICE_PRINTOUT_TEXT = `${[...PRACTICE_HEADER, "", ...PRACTICE_ENTRIES.flatMap((e) => [...e, ""])].join("\n")}`;

const winAnsi = (s: string) => s.replace(/–/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/**
 * The printout as a two-page A4 PDF: a running header with the patient's name and date of birth and a
 * "Page n of 2" footer on every page; the first two notes on page 1, the rest on page 2.
 */
export async function buildPracticePrintoutPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2026-10-09T14:22:00Z"));
  doc.setModificationDate(new Date("2026-10-09T14:22:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 50;
  const size = 9.5;
  const lh = 13;
  const pages: PDFPage[] = [doc.addPage([W, H]), doc.addPage([W, H])];
  pages.forEach((page, i) => {
    page.drawText(winAnsi("Riverside Physiotherapy (fictional) - Quill, Harriet - DOB 14/09/1984"), { x: M, y: H - 30, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(`Page ${i + 1} of 2`, { x: W - M - 50, y: 25, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  });
  let page = pages[0];
  let y = H - 60;
  const write = (text: string, f: PDFFont = font) => {
    for (const line of wrap(winAnsi(text), f, size, W - 2 * M)) {
      page.drawText(line, { x: M, y, size, font: f });
      y -= lh;
    }
  };
  // Header lines with two columns ("Label: value   Label: value") are drawn as separate text runs.
  for (const h of PRACTICE_HEADER.slice(0, 1)) write(h, bold);
  y -= 4;
  for (const h of PRACTICE_HEADER.slice(1)) {
    const parts = h.split(/\s{3,}/);
    parts.forEach((part, i) => page.drawText(winAnsi(part), { x: M + i * 250, y, size, font }));
    y -= lh;
  }
  PRACTICE_ENTRIES.forEach((entry, i) => {
    if (i === 2) {
      page = pages[1];
      y = H - 60;
    }
    y -= 8;
    write(entry[0], bold);
    entry.slice(1).forEach((l) => write(l));
  });
  return doc.save({ useObjectStreams: false });
}

/* ------------------------------------------------------------------------------------------------
 * 2. Letter-style Word document (docx library, built in the test)
 * ----------------------------------------------------------------------------------------------*/

export const LETTER_PARAGRAPHS = [
  "Brookside Sports Physiotherapy (fictional)",
  "4 Mill Lane, Testbury",
  "9 October 2026",
  "Calder & Moss Solicitors (fictional)",
  "Our ref: BSP/112",
  "Your ref: CM/PI/2231",
  "Dear Sir or Madam,",
  "Re: Mr Oliver Bramble, DOB 03/02/1979",
  "Thank you for your instruction. I set out below the treatment Mr Bramble has received at this clinic following the road traffic accident on 12/07/2026, as recorded in his clinical notes.",
  "21 July 2026 – Initial assessment. Neck pain and stiffness since the collision, worse turning to the left. NDI 42%. NPRS 6/10. Advised on pacing and gentle range of movement exercises.",
  "4 August 2026 – Follow-up. Neck improving; headaches now occasional. NDI 30%. Started progressive strengthening.",
  "18 August 2026 – Telephone review. Patient reports he has returned to driving short distances.",
  "1 September 2026 – Discharge. Full range of movement, minimal discomfort at the end of the day. NDI 12%. NPRS 1/10. Discharged with a home exercise programme.",
  "Yours faithfully,",
  "Sarah Reid",
  "Physiotherapist, HCPC PH-DEMO-01",
];

export const LETTER_DETAILS_TABLE: Array<[string, string]> = [
  ["Instructing party", "Calder & Moss Solicitors (fictional)"],
  ["Date of accident", "12/07/2026"],
  ["Consent to disclose", "Yes, signed 21/07/2026"],
];

export async function buildLetterDocx(): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = await import("docx");
  const para = (text: string) => new Paragraph({ children: [new TextRun(text)] });
  const table = new Table({
    rows: LETTER_DETAILS_TABLE.map(([k, v]) => new TableRow({ children: [new TableCell({ children: [para(k)] }), new TableCell({ children: [para(v)] })] })),
  });
  const before = LETTER_PARAGRAPHS.slice(0, 8).map(para);
  const after = LETTER_PARAGRAPHS.slice(8).map(para);
  const doc = new Document({ creator: "ClinForms tests (fictional)", sections: [{ children: [...before, table, ...after] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------------------------------------------------
 * 3. Word document with a notes table (one row per session)
 * ----------------------------------------------------------------------------------------------*/

export const TABLE_DOC_ROWS: string[][] = [
  ["Date", "Clinician", "Session type", "Clinical notes"],
  ["02/03/2026", "Priya Shah (PH-DEMO-03)", "New patient assessment", "S: Low back pain after a fall on ice.\nO: Lumbar flexion limited to knees. ODI 48%.\nA: Mechanical low back pain.\nP: Walking programme, review 2/52."],
  ["16/03/2026", "Priya Shah (PH-DEMO-03)", "Follow-up", "Walking 20 minutes daily. ODI 36%. Progressed to core exercises."],
  ["30/03/2026", "Priya Shah (PH-DEMO-03)", "Discharge", "Back to work full duties. ODI 14%. Discharged."],
];

export async function buildTableDocx(): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = await import("docx");
  const cell = (text: string) => new TableCell({ children: text.split("\n").map((l) => new Paragraph({ children: [new TextRun(l)] })) });
  const doc = new Document({
    creator: "ClinForms tests (fictional)",
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("Treatment record – Lakeside Physio (fictional)")] }),
          new Paragraph({ children: [new TextRun("Patient name: Nadia Fenwick")] }),
          new Paragraph({ children: [new TextRun("DOB: 22/11/1990")] }),
          new Paragraph({ children: [new TextRun("Case manager: Brightwell Case Management (fictional)")] }),
          new Paragraph({ children: [new TextRun("Claim number: BCM-7781")] }),
          new Table({ rows: TABLE_DOC_ROWS.map((r) => new TableRow({ children: r.map(cell) })) }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------------------------------------------------
 * 4. CSV export, one row per appointment
 * ----------------------------------------------------------------------------------------------*/

export const APPOINTMENTS_CSV = [
  "Appointment history export",
  "Patient,Jonah Pemberly",
  "Date of birth,07/05/1968",
  "Insurer,Northgate Health Insurance (fictional)",
  "Policy number,NGH-2210-5531",
  "",
  "Appointment Date,Start Time,Practitioner,Appointment Type,Status,Treatment Notes,NPRS",
  '05/05/2026,08:30,Tom Ellis,Initial assessment,Attended,"Left knee pain after a hiking trip, 3 weeks. Swelling medial joint line. Plan: quads programme.",6',
  "12/05/2026,08:30,Tom Ellis,Follow-up,Did not attend,,",
  '19/05/2026,08:30,Tom Ellis,Follow-up,Attended,"Swelling reduced, stairs easier. Progressed to step-ups.",4',
  "26/05/2026,08:30,Tom Ellis,Follow-up,Cancelled,,",
  '02/06/2026,08:30,Tom Ellis,Discharge,Attended,"Pain free on stairs, back to walking 5 miles. Discharged.",1',
].join("\r\n");

/* ------------------------------------------------------------------------------------------------
 * 5. Pasted email-style notes
 * ----------------------------------------------------------------------------------------------*/

export const EMAIL_NOTES = [
  "From: Sarah Reid <sarah.reid@example.com>",
  "Sent: 10 October 2026 08:12",
  "To: Reports team <reports@example.com>",
  "Subject: Notes for Mr Felix Hartley",
  "",
  "Hi both, notes for the insurer report below as requested.",
  "",
  "Name: Mr Felix Hartley",
  "D.O.B. 30/06/1991",
  "Health insurer: Wexley Assurance (fictional)",
  "Membership no: WX-889102",
  "",
  "Tue 3 Mar 2026 9.30am - IA",
  "Ankle sprain playing five-a-side on Saturday. Lateral ankle swelling, tender ATFL. NPRS 6/10.",
  "",
  "Mar 10 2026 - FU - Tom Ellis",
  "Walking without a limp. Balance work started.",
  "",
  "2026-03-24 Discharge",
  "Back to training, no pain. NPRS 0/10.",
  "",
  "Kind regards",
  "Sarah Reid",
].join("\n");

/* ------------------------------------------------------------------------------------------------
 * 6. A diary with uncertain details (left blank, never guessed)
 * ----------------------------------------------------------------------------------------------*/

export const UNCERTAIN_NOTES = [
  "Name: 4417 unknown",
  "DOB: 03/04/85",
  "Sex: unknown",
  "Phone: call reception",
  "Postcode: not given",
  "Membership number: see letter",
  "",
  "8/3/26 Back pain review. NPRS 3-4/10. QuickDASH n/a.",
  "Seen with daughter.",
  "",
  "15/03/2026",
  "",
  "22/03/2026 – Follow-up",
  "NPRS improved from 6/10 to 3/10.",
  "Signed: P. Shah",
].join("\n");

/* ------------------------------------------------------------------------------------------------
 * 7. Pasted notes in the DOCUMENTED format (the strict reader must still win)
 * ----------------------------------------------------------------------------------------------*/

export const DOCUMENTED_TEXT = [
  "Date of birth: 02/01/1990",
  "Instructing party: Example & Co Solicitors (fictional)",
  "Instructing party type: solicitor",
  "",
  "18/03/2026 09:00 – Initial assessment – Sarah Reid (PH-DEMO-01)",
  "S: Neck pain after a rear-end collision.",
  "Outcome measures: NDI 40%",
  "",
  "02/04/2026 – Discharge – Sarah Reid (PH-DEMO-01)",
  "S: Much better.",
  "Outcome measures: NDI 10%",
].join("\n");
