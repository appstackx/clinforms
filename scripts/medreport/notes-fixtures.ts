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

/* ------------------------------------------------------------------------------------------------
 * 8. Fix wave 3 – the exports a clinic actually has (from the wave 3 end-to-end review), FICTIONAL
 * ----------------------------------------------------------------------------------------------*/

/** One note of the practice-system "Clinical Notes Report" (newest first, section headings on their own lines). */
interface ReportEntry {
  head: string;
  body: Array<[string, string]>;
  sig: string;
}

export const REPORT_ENTRIES: ReportEntry[] = [
  {
    head: "17/09/2026  10:30  Follow Up (30 min)  -  Amara Okafor (Physiotherapist)",
    body: [
      // "\n": the printout wraps here, so a line starts with the pain range "2-3/10".
      ["Subjective", "Back to work on modified duties since 07/09/2026 (no lifting over 15 kg). Pain mostly\n2-3/10, flares to 5/10 after a full shift on his feet. Sleeping through. Wants to get back to full duties."],
      ["Objective", "Lumbar flexion fingertips to mid-shin, extension full. SLR 80 degrees bilaterally. Lifting 15 kg floor to waist with good technique."],
      ["Outcome Measures", "ODI 22%. NPRS 3/10."],
      ["Clinical Impression", "Resolving mechanical low back pain. Good progress."],
      ["Plan", "2 further sessions over 4 weeks. Fit for modified duties now; phased return to full duties from 05/10/2026 if progress continues."],
    ],
    sig: "Electronically signed by Amara Okafor MCSP, HCPC PH-DEMO-03 on 17/09/2026 11:12",
  },
  {
    head: "10/09/2026  14:00  Telephone Review  -  Amara Okafor (Physiotherapist)",
    body: [["Notes", "Called pt as planned. Started modified duties 07/09. Managing well. Keep appointment 17/09."]],
    sig: "Electronically signed by Amara Okafor MCSP, HCPC PH-DEMO-03 on 10/09/2026 14:18",
  },
  {
    head: "03/09/2026  09:45  Follow Up (30 min)  -  Daniel Kerr (Physiotherapist)",
    body: [
      ["Subjective", "Seen by DK covering AO annual leave. Pain 4/10 at worst, 1-2/10 at rest. Walking 30 min without increase."],
      ["Plan", "Return to modified duties as offered. Telephone review in 1 week (AO)."],
    ],
    sig: "Electronically signed by Daniel Kerr HCPC PH-DEMO-04 on 03/09/2026 10:20",
  },
  {
    head: "02/09/2026  16:05  Admin Note  -  Reception",
    body: [["", "Pt called to rebook missed appt from 27/08. Booked 03/09 with DK."]],
    sig: "",
  },
  {
    head: "27/08/2026  10:30  Follow Up (30 min)  -  Amara Okafor (Physiotherapist)",
    body: [["Status", "Did Not Attend. No contact from patient. SMS reminder had been sent 26/08."]],
    sig: "Electronically signed by Amara Okafor MCSP, HCPC PH-DEMO-03 on 27/08/2026 11:05",
  },
  {
    head: "20/08/2026  10:30  Follow Up (30 min)  -  Amara Okafor (Physiotherapist)",
    body: [
      ["Subjective", "Better than last week. Pain now 5/10 at worst, mainly mornings."],
      ["Outcome Measures", "NPRS 5/10."],
      ["Plan", "Continue. Review 1/52."],
    ],
    sig: "Electronically signed by Amara Okafor MCSP, HCPC PH-DEMO-03 on 20/08/2026 11:01",
  },
  {
    head: "13/08/2026  10:15  Initial Assessment (45 min)  -  Amara Okafor (Physiotherapist)",
    body: [
      ["Presenting Condition", "R sided low back pain following lifting a 25 kg box from a pallet at work on 02/08/2026. Reported via employer accident book."],
      ["Past Medical History", "Nil significant."],
      ["Outcome Measures", "NPRS 7/10 at worst, 4/10 at rest. ODI 46%."],
      ["Plan", "Weekly for 4-6 sessions. Goal: return to full duties in 6-8 weeks."],
    ],
    sig: "Electronically signed by Amara Okafor MCSP, HCPC PH-DEMO-03 on 13/08/2026 11:32",
  },
];

/**
 * A practice system's "Clinical Notes Report" printed to PDF: a running header (clinic name and address) and a
 * running FOOTER that names the patient and their clinic number and numbers the pages ("Page 1 of 3"); a two-column
 * patient box (the address carries on to the next line beside "Employer:"); a funding line with the policy and
 * authorisation numbers; a referrer line naming a claims handler; a case line; notes newest first with the type, a
 * duration and "Name (Physiotherapist)" in the heading, section headings on their own lines, wrapped lines (one
 * starts "2-3/10"), an admin note, a missed appointment and e-signatures with the HCPC number.
 */
export async function buildClinicalNotesReportPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2026-10-09T15:42:00Z"));
  doc.setModificationDate(new Date("2026-10-09T15:42:00Z"));
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 42;
  const pages: PDFPage[] = [];
  let page: PDFPage = doc.addPage([W, H]);
  let y = 0;
  const header = (p: PDFPage) => {
    p.drawText("ASHGROVE PHYSIOTHERAPY (fictional)", { x: M, y: H - 40, size: 11, font: bold });
    p.drawText("Clinical Notes Report", { x: W - M - bold.widthOfTextAtSize("Clinical Notes Report", 11), y: H - 40, size: 11, font: bold });
    p.drawText("Unit 4, Mill Lane, Testford ZZ3 7PQ - Tel 01632 960118", { x: M, y: H - 54, size: 7.5, font: reg, color: rgb(0.35, 0.35, 0.35) });
  };
  pages.push(page);
  header(page);
  y = H - 80;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    header(page);
    y = H - 80;
  };
  const text = (t: string, opts: { font?: PDFFont; size?: number; x?: number } = {}) => {
    const font = opts.font ?? reg;
    const size = opts.size ?? 9.5;
    const x = opts.x ?? M;
    for (const l of t.split("\n").flatMap((part) => wrap(winAnsi(part), font, size, W - x - M))) {
      if (y < 80) newPage();
      page.drawText(l, { x, y, size, font });
      y -= size + 3;
    }
  };
  const box: Array<[string, string, string, string]> = [
    ["Name:", "Mr Rowan Lewis Tate", "Patient no.:", "AP-004127"],
    ["Date of birth:", "22/11/1983 (42 yrs)", "Sex:", "Male"],
    ["Address:", "14 Ashdown Close", "Occupation:", "Warehouse supervisor"],
    ["", "Testford, Kent ZZ3 9LT", "Employer:", "Brightwater Logistics (fictional)"],
    ["Mobile:", "07700 900314", "GP:", "Dr R. Malik, Riverside Medical Centre (fictional)"],
    ["Email:", "r.tate@example.com", "", ""],
  ];
  for (const [l1, v1, l2, v2] of box) {
    if (l1) page.drawText(l1, { x: M + 6, y, size: 9, font: bold });
    page.drawText(v1, { x: M + 78, y, size: 9, font: reg });
    if (l2) page.drawText(l2, { x: M + 270, y, size: 9, font: bold });
    if (v2) page.drawText(v2, { x: M + 335, y, size: 9, font: reg });
    y -= 15;
  }
  y -= 10;
  text("Case: Lower back - injury at work (opened 13/08/2026)", { font: bold, size: 10 });
  text("Funding: Northfield Assurance (fictional)   Policy no.: NFA-88213407   Authorisation: AUTH-55120 (6 sessions)");
  text("Date of injury: 02/08/2026");
  text("Referrer: Northfield Assurance (fictional) - J. Barker, Claims Handler");
  y -= 6;
  for (const e of REPORT_ENTRIES) {
    if (y < 140) newPage();
    text(e.head, { font: bold, size: 10 });
    y -= 4;
    for (const [h, b] of e.body) {
      if (h) text(h, { font: bold });
      text(b, { x: M + 10 });
      y -= 3;
    }
    if (e.sig) text(e.sig, { size: 8 });
    y -= 10;
  }
  pages.forEach((p, i) => {
    p.drawText("Patient: Rowan Tate (AP-004127)   CONFIDENTIAL - contains patient identifiable information", { x: M, y: 38, size: 7.5, font: reg });
    const r = `Printed 09/10/2026 16:42 by Amara Okafor   Page ${i + 1} of ${pages.length}`;
    p.drawText(r, { x: W - M - reg.widthOfTextAtSize(r, 7.5), y: 26, size: 7.5, font: reg });
  });
  return doc.save({ useObjectStreams: false });
}

/** A booking system's CSV export: BOM, CRLF, a combined date-time "Appointment start", "Patient DOB", an attendance column. */
export const BOOKING_HEADER = ["Patient", "Patient DOB", "Appointment start", "Practitioner", "Appointment type", "Attendance", "Treatment note"];
export const BOOKING_ROWS: string[][] = [
  ["Jenna Holloway", "07/03/1991", "28/07/2026 08:30", "Ben Ferraro", "Initial Consultation (45 min)", "Arrived", "Subjective:\nL shoulder pain 5 weeks. Fell off bike (cycling to work) on 21/06/2026.\nAssessment:\nQuickDASH 56.8. NPRS 6/10.\nPlan:\nIsometrics. 1/52."],
  ["Jenna Holloway", "07/03/1991", "04/08/2026 08:30", "Ben Ferraro", "Follow up (30 min)", "Arrived", "S: Isometrics done 2x day. Pain 5/10.\nP: review 1 week"],
  ["Jenna Holloway", "07/03/1991", "11/08/2026 08:30", "Ben Ferraro", "Follow up (30 min)", "Did not arrive", ""],
  ["Jenna Holloway", "07/03/1991", "13/08/2026 17:15", "Ben Ferraro", "Follow up (30 min)", "Cancelled < 24 hrs", "Pt cancelled by phone - childcare issue. Rebooked."],
  ["Jenna Holloway", "07/03/1991", "18/08/2026 08:30", "Ben Ferraro", "Follow up (30 min)", "Arrived", "S: Much better. NPRS 3/10.\nP: 2 more sessions."],
  ["Jenna Holloway", "07/03/1991", "01/09/2026 08:30", "Ben Ferraro", "Review (30 min)", "Arrived", "S: Back to normal at work.\nQuickDASH 15.9. NPRS 1/10.\nA: Goals met.\nP: Discharge with HEP."],
];

/** The booking CSV with another header for the date column (or the default "Appointment start"). */
export function bookingCsv(dateHeader = "Appointment start"): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = BOOKING_HEADER.map((h) => (h === "Appointment start" ? dateHeader : h));
  return `﻿${[header, ...BOOKING_ROWS].map((r) => r.map(q).join(",")).join("\r\n")}\r\n`;
}

/**
 * A progress letter to the insurer as a Word document: a letterhead in the page header, the letter's date, the
 * addressee (the insurer), "Our ref / Your ref", a "Re:" line with the date of birth, the policy and the
 * authorisation, narrative paragraphs, a BULLETED attendance list ("(attended)", "did not attend (reason)"), an
 * outcome table whose columns carry their dates, closing paragraphs (recommendation, prognosis) and a signature with
 * the HCPC number on its own line.
 */
export async function buildProgressLetterDocx(): Promise<Uint8Array> {
  const { Document, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = await import("docx");
  const p = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const bullet = (t: string) => new Paragraph({ children: [new TextRun(t)], bullet: { level: 0 } });
  const cell = (t: string) => new TableCell({ children: [p(t)] });
  const table = new Table({
    rows: [
      ["Measure", "Initial (01/07/2026)", "Latest (12/08/2026)"],
      ["QuickDASH", "54.5", "22.7"],
      ["NPRS (worst)", "6/10", "2/10"],
      ["Grip strength R (kg)", "14", "26"],
    ].map((r) => new TableRow({ children: r.map(cell) })),
  });
  const doc = new Document({
    creator: "ClinForms tests (fictional)",
    sections: [
      {
        headers: { default: new Header({ children: [p("Ashgrove Physiotherapy (fictional)"), p("Unit 4, Mill Lane, Testford ZZ3 7PQ | 01632 960118")] }) },
        children: [
          p("9 October 2026"),
          p("Claims Team"),
          p("Northfield Assurance (fictional)"),
          p("PO Box 0000, Testford ZZ1 2AB"),
          p("Our ref: AP-003958        Your ref: NFA-77310288"),
          p("Dear Claims Team,"),
          p("Re: Mrs Priya Dhaliwal, DOB 15/04/1972 – Policy NFA-77310288 – Authorisation AUTH-60412"),
          p("Thank you for referring Mrs Dhaliwal, who sustained a fracture of the right distal radius when she slipped on a wet floor in a supermarket on 19 May 2026."),
          p("I first assessed Mrs Dhaliwal on 1 July 2026. Her QuickDASH score was 54.5 and pain was 6/10 at worst. Attendance to date:"),
          bullet("01/07/2026 – initial assessment (attended)"),
          bullet("08/07/2026 – treatment session (attended)"),
          bullet("15/07/2026 – treatment session (attended)"),
          bullet("22/07/2026 – did not attend (unwell, telephoned on the day)"),
          bullet("29/07/2026 – treatment session (attended)"),
          bullet("12/08/2026 – review (attended)"),
          p("Outcome measures:"),
          table,
          p("At review on 12 August 2026 wrist extension had improved from 35 to 60 degrees. She is driving again and has returned to full duties at work."),
          p("Recommendation: I recommend four further sessions over six weeks. I would anticipate a full functional recovery within three months of the date of this letter. She is fit for her normal work."),
          p("Yours sincerely,"),
          p("Sophie Lang"),
          p("Clinical Lead Physiotherapist, MCSP"),
          p("HCPC: PH-DEMO-05"),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** Notes with a pain range wrapped onto the start of a line ("2-3/10", "1-2/10") and one "2/3/10" written like a date. */
export const WRAPPED_RANGES_NOTES = [
  "Name: Mr Owen Pell",
  "Date of birth: 02/02/1980",
  "",
  "13/08/2026 – Initial assessment – Sarah Reid (PH-DEMO-01)",
  "Low back pain after lifting at home. Pain at rest",
  "1-2/10, worse bending. NPRS 6/10.",
  "",
  "03/09/2026 – Follow-up – Sarah Reid (PH-DEMO-01)",
  "Improving. Pain mostly",
  "2-3/10, flares after long shifts.",
  "",
  "17/09/2026 – Follow-up – Sarah Reid (PH-DEMO-01)",
  "Pain on lifting",
  "2/3/10 days this week, otherwise settled. NPRS 2/10.",
].join("\n");
