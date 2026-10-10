/**
 * Writes the FICTIONAL notes fixtures (./notes-fixtures.ts) as files for the browser check
 * (scripts/e2e/notes-import-check.cjs): a two-page printout PDF, a letter-style Word document, a Word notes table,
 * a CSV appointment export and email-style notes as text, plus the pasted texts.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/write-notes-fixtures.ts <dir>
 *
 * Never point it at real data; the output goes to a gitignored folder (.e2e-out/…).
 */
import fs from "node:fs";
import path from "node:path";
import * as F from "./notes-fixtures";

async function main() {
  const dir = path.resolve(process.argv[2] ?? ".e2e-out/notes-import/inputs");
  fs.mkdirSync(dir, { recursive: true });
  const files: Record<string, Uint8Array | string> = {
    "practice-printout.pdf": await F.buildPracticePrintoutPdf(),
    "treatment-letter.docx": await F.buildLetterDocx(),
    "treatment-record-table.docx": await F.buildTableDocx(),
    "appointments-export.csv": F.APPOINTMENTS_CSV,
    "email-notes.txt": F.EMAIL_NOTES,
    "paste-practice.txt": F.PRACTICE_PRINTOUT_TEXT,
    "paste-uncertain.txt": F.UNCERTAIN_NOTES,
    "paste-documented.txt": F.DOCUMENTED_TEXT,
    // Fix wave 3: the exports a clinic actually has.
    "clinical-notes-report.pdf": await F.buildClinicalNotesReportPdf(),
    "booking-export.csv": F.bookingCsv(),
    "progress-letter.docx": await F.buildProgressLetterDocx(),
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  console.log(`Wrote ${Object.keys(files).length} fictional fixtures to ${dir}`);
}

void main();
