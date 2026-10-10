/**
 * Production wave 3 – ordinary clinic notes: the general notes reader (connectors/file-import/general-notes.ts),
 * a checked review → the bundle (review-bundle.ts), POST /connectors/file-import/read and /confirm (audit
 * "notes.imported", counts only), the Studio's review step (ui/components/new/notes-review*.ts*) and its wording.
 *
 * FICTIONAL fixtures in several layouts (./notes-fixtures.ts): a practice-system printout (text and a two-page PDF
 * built with pdf-lib), a letter-style Word document, a Word notes table, a CSV appointment export, pasted
 * email-style notes and a diary with uncertain details – plus the documented format, which must still win.
 */
import * as React from "react";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.MEDREPORT_AI_MODE = "demo";
for (const k of ["MEDREPORT_LAUNCH_SECRET", "MEDREPORT_SIGNING_SECRET", "MEDREPORT_PARTNER_KEY", "ANTHROPIC_API_KEY", "MEDREPORT_LIVE_PASSCODE", "CLINFORMS_PUBLIC_DEMO", "CLINFORMS_DB", "VERCEL", "PORT"]) {
  delete process.env[k];
}
process.env.APP_ORIGIN = "https://clinforms.test";

import { Kysely } from "kysely";
import { dbAudit, dbSharedState, getMedreportDeps } from "@/app/api/_medreport-glue";
import { describeActivityDetail, activityLabel } from "@/lib/activity-copy";
import { BundleResponseSchema, CONTENT_TYPES, FileImportReadResponseSchema, ProblemSchema } from "@/modules/medreport/api/contract";
import type { AuthContext, MedreportDeps } from "@/modules/medreport/api/deps";
import { handleFileImportConfirm } from "@/modules/medreport/api/handlers/file-import-confirm";
import { handleFileImportRead } from "@/modules/medreport/api/handlers/file-import-read";
import { bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { readNotesUpload } from "@/modules/medreport/connectors/file-import/connector";
import { findScores, matchHeading, parseDateToken, parseTimeToken, parsePatientName } from "@/modules/medreport/connectors/file-import/general-notes";
import { ImportError } from "@/modules/medreport/connectors/file-import/parser";
import { bundleFromReview, splitNoteText } from "@/modules/medreport/connectors/file-import/review-bundle";
import { NotesReviewSchema, notesReviewCopyStrings, type NotesReview } from "@/modules/medreport/connectors/file-import/review-contract";
import { SAMPLE_IMPORT_FILES } from "@/modules/medreport/connectors/file-import/samples";
import { PRIYA_NAIR_NOTES_PDF_BASE64 } from "@/modules/medreport/connectors/file-import/samples/generated/priya-nair-notes.pdf.b64";
import { createConnectorRegistry } from "@/modules/medreport/connectors/registry";
import { createFileImportConnector } from "@/modules/medreport/connectors/file-import/connector";
import { createTm3SimConnector } from "@/modules/medreport/connectors/tm3-sim/connector";
import type { ConnectorContext } from "@/modules/medreport/connectors/types";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import type { ImportPayload } from "@/modules/medreport/core/types";
import { BANNED_TERM_PATTERNS, hasBannedTerm } from "@/modules/medreport/core/wording";
import { NotesReviewStep } from "@/modules/medreport/ui/components/new/notes-review";
import { applyClinician, reviewBlockers, reviewClinicians, reviewCounts, updateEntry, updateRegistration } from "@/modules/medreport/ui/components/new/notes-review-model";
import { NodeSqliteDialect, openSqliteDatabase } from "@/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "@/server/db/migrations";
import type { Database } from "@/server/db/schema";
import { listAudit } from "@/server/repos/audit";
import * as F from "./notes-fixtures";
import { demoBearer } from "./test-actors";

(globalThis as unknown as { React: typeof React }).React = React;

const NOW = new Date("2026-10-10T09:00:00.000Z");
const ctx = (): ConnectorContext => ({ tenantId: "demo", credentials: { kind: "none" }, baseUrl: "", fetch: (u, i) => fetch(u, i), trace: [] });
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function review(upload: ImportPayload): Promise<NotesReview> {
  const out = await readNotesUpload(ctx(), upload, { now: NOW });
  if (out.kind !== "review") assert.fail(`expected a review, got the documented-format bundle for ${upload.format}`);
  // Every review the reader returns is valid against the contract the Studio sends back.
  return NotesReviewSchema.parse(out.review);
}

const entry = (r: NotesReview, key: string) => {
  const e = r.entries.find((x) => x.key === key);
  assert.ok(e, `entry ${key}`);
  return e;
};
const scores = (r: NotesReview) => r.outcomes.map((o) => `${o.instrument} ${o.value} ${o.date || entry(r, o.entryKey).date}`).sort();

/* ------------------------------------------------------------------------------------------------
 * 1. Helpers: dates, times, headings, scores, names
 * ----------------------------------------------------------------------------------------------*/

describe("date headings, times, scores and names", () => {
  test("every heading style named in the brief starts a note", () => {
    const cases: Array<[string, string, string | null]> = [
      ["18/03/2026 – Initial assessment", "2026-03-18", null],
      ["8/3/26 Back pain review", "2026-03-08", null],
      ["18 March 2026", "2026-03-18", null],
      ["Mar 18 2026 - FU", "2026-03-18", null],
      ["March 18, 2026 – Sarah Reid", "2026-03-18", null],
      ["2026-03-18 Discharge", "2026-03-18", null],
      ["Tue 3 Mar 2026 9.30am - IA", "2026-03-03", "09:30"],
      ["Wednesday 18 March 2026 14:15", "2026-03-18", "14:15"],
      ["Date: 01/09/2026  Time: 09:00  Practitioner: Sarah Reid (PH-DEMO-01)", "2026-09-01", null],
      ["**18/03/2026 09:00 – Follow-up**", "2026-03-18", "09:00"],
      ["- 18-Mar-2026: telephone call", "2026-03-18", null],
    ];
    for (const [line, iso, time] of cases) {
      const h = matchHeading(line, NOW);
      assert.ok(h, line);
      assert.equal(h.date.iso, iso, line);
      assert.equal(h.time, time, line);
    }
    for (const line of ["Date of birth: 14/09/1984", "NPRS 7/10 at rest", "Review in 2/52.", "12 sessions authorised", "Sent: 10 October 2026 08:12", "DOB 03/02/1979"]) {
      assert.equal(matchHeading(line, NOW), null, line);
    }
  });

  test("dates and times parse conservatively", () => {
    assert.deepEqual(parseDateToken("18/03/2026"), { iso: "2026-03-18", twoDigitYear: false });
    assert.deepEqual(parseDateToken("03/04/85"), { iso: "2085-04-03", twoDigitYear: true });
    assert.equal(parseDateToken("03/04/85", NOW), null, "a two-digit year far in the future is not a note date");
    assert.equal(parseDateToken("31/02/2026"), null);
    assert.equal(parseDateToken("03/18/2026"), null, "month first is not read as a UK date");
    assert.equal(parseTimeToken("9.30am"), "09:30");
    assert.equal(parseTimeToken("2pm"), "14:00");
    assert.equal(parseTimeToken("12:15am"), "00:15");
    assert.equal(parseTimeToken("25:00"), null);
  });

  test("outcome scores: the written forms, ranges and other scales", () => {
    const s = (t: string) => findScores(t, NOW).map((x) => [x.instrument, x.value, x.date, x.ambiguous]);
    assert.deepEqual(s("NPRS 7/10, QuickDASH 52.3, PSFS 2.7, ODI 48%, NDI 42%"), [
      ["NPRS", 7, null, false],
      ["PSFS", 2.7, null, false],
      ["QuickDASH", 52.3, null, false],
      ["ODI", 48, null, false],
      ["NDI", 42, null, false],
    ]);
    assert.deepEqual(s("NDI 21/50"), [["NDI", 42, null, false]], "a raw NDI out of 50 is the percentage doubled");
    assert.deepEqual(s("NPRS: 7/10 (18/03/2026), 3/10 (15/04/2026)"), [
      ["NPRS", 7, "2026-03-18", false],
      ["NPRS", 3, "2026-04-15", false],
    ]);
    assert.deepEqual(s("NPRS 3-4/10"), [["NPRS", 3, null, true]]);
    assert.deepEqual(s("NPRS 70%"), [], "a pain score is never a percentage");
    assert.deepEqual(s("NPRS and PSFS 2.7"), [["PSFS", 2.7, null, false]], "a value is never attributed across another instrument's name");
    assert.deepEqual(s("NPRS not recorded. Pain 6 on stairs"), []);
  });

  test("patient names: titles, surname-first, and anything unclear left out", () => {
    assert.deepEqual(parsePatientName("Mrs Harriet Quill"), { title: "Mrs", first: "Harriet", last: "Quill" });
    assert.deepEqual(parsePatientName("QUILL, Harriet"), { title: "", first: "Harriet", last: "QUILL" });
    assert.deepEqual(parsePatientName("Mr Oliver Bramble, DOB 03/02/1979"), { title: "Mr", first: "Oliver", last: "Bramble" });
    assert.equal(parsePatientName("4417 unknown"), null);
    assert.equal(parsePatientName("Harriet"), null, "one word is not a full name");
  });
});

/* ------------------------------------------------------------------------------------------------
 * 2. The reader, layout by layout
 * ----------------------------------------------------------------------------------------------*/

describe("practice-system printout (text and PDF)", () => {
  const checkPrintout = (r: NotesReview) => {
    const reg = r.registration;
    assert.deepEqual(
      { title: reg.title, first: reg.firstName, last: reg.lastName, dob: reg.dob, sex: reg.sex, address: reg.address, postcode: reg.postcode, phone: reg.phone, email: reg.email },
      { title: "Mrs", first: "Harriet", last: "Quill", dob: "1984-09-14", sex: "female", address: "12 Larch Avenue, Testford", postcode: "ZZ1 1ZZ", phone: "07700 900417", email: "harriet.quill@example.com" },
    );
    assert.equal(reg.insurerName, "Northgate Health Insurance (fictional)");
    assert.equal(reg.membershipNumber, "NGH-4471-0923");
    assert.equal(reg.authorisationNumber, "AUTH-55821");
    assert.equal(reg.referredBy, "Dr Anna Fielding, Elm Tree Surgery (fictional)");
    assert.equal(reg.gpPractice, "Elm Tree Surgery (fictional)");
    // No instructing party is written: the insurer is offered, marked for staff to check (not counted as found).
    assert.equal(reg.instructingPartyName, "Northgate Health Insurance (fictional)");
    assert.equal(reg.instructingPartyType, "insurer");
    assert.match(r.fieldNotes?.instructingPartyName ?? "", /insurer line – check it/);
    assert.ok(!r.detected.includes("instructingPartyName"));
    assert.equal(r.entries.length, 4);
    assert.deepEqual(
      r.entries.map((e) => [e.date, e.time, e.clinicianName, e.clinicianHcpc, e.type, e.status, e.include]),
      [
        ["2026-09-01", "09:00", "Sarah Reid", "PH-DEMO-01", "initial_assessment", "ATT", true],
        ["2026-09-08", "09:30", "Sarah Reid", "PH-DEMO-01", "follow_up", "ATT", true],
        ["2026-09-15", "09:30", "Tom Ellis", "PH-DEMO-02", "follow_up", "DNA", true],
        ["2026-09-22", "10:00", "Tom Ellis", "PH-DEMO-02", "discharge", "ATT", true],
      ],
    );
    assert.equal(r.attendance, true, "every note heading names a status and a time");
    // The note's own text is kept exactly as written, heading and detail lines apart.
    assert.equal(entry(r, "E-2").body, F.PRACTICE_ENTRIES[1].slice(3).join("\n"));
    assert.deepEqual(scores(r), [
      "NPRS 2 2026-09-22",
      "NPRS 5 2026-09-08",
      "NPRS 7 2026-09-01",
      "PSFS 2.7 2026-09-01",
      "PSFS 7.9 2026-09-22",
      "QuickDASH 18.2 2026-09-22",
      "QuickDASH 52.3 2026-09-01",
    ]);
  };

  test("printed as text", async () => {
    const r = await review({ format: "text", content: F.PRACTICE_PRINTOUT_TEXT });
    checkPrintout(r);
    assert.equal(entry(r, "E-1").body, F.PRACTICE_ENTRIES[0].slice(3).join("\n"));
    assert.deepEqual(r.warnings, []);
  });

  test("printed to a two-page PDF (pdf-lib): running header and page numbers dropped, note lines on both pages kept", async () => {
    const pdf = await F.buildPracticePrintoutPdf();
    const c = ctx();
    const out = await readNotesUpload(c, { format: "pdf", content: b64(pdf), fileName: "printout.pdf" }, { now: NOW });
    assert.equal(out.kind, "review");
    if (out.kind !== "review") return;
    const r = NotesReviewSchema.parse(out.review);
    checkPrintout(r);
    assert.equal(r.pages, 2);
    assert.equal(r.fileName, "printout.pdf");
    const all = r.entries.map((e) => `${e.heading}\n${e.body}`).join("\n");
    assert.doesNotMatch(all, /Page \d of 2|Quill, Harriet - DOB/);
    assert.match(c.trace[0].note ?? "", /printed notes PDF, 2 pages · read as clinic notes – to be checked · 4 entries/);
    assert.doesNotMatch(c.trace[0].note ?? "", /Quill|Harriet|Northgate/, "the trace holds counts, never content");
  });
});

describe("letter-style Word document", () => {
  test("Re: line, details table, dated paragraphs, the letter's own date and the signature", async () => {
    const r = await review({ format: "docx", content: b64(await F.buildLetterDocx()), fileName: "letter.docx" });
    const reg = r.registration;
    assert.deepEqual([reg.title, reg.firstName, reg.lastName, reg.dob], ["Mr", "Oliver", "Bramble", "1979-02-03"]);
    assert.deepEqual([reg.instructingPartyName, reg.instructingPartyType], ["Calder & Moss Solicitors (fictional)", "solicitor"]);
    assert.equal(reg.reference, "CM/PI/2231", "their reference, not the clinic's own");
    assert.deepEqual([reg.incidentDate, reg.consent, reg.consentDate], ["2026-07-12", "yes", "2026-07-21"]);
    // The opening paragraph has no date: a block left out unless staff date it; the letter's date is not a note.
    assert.deepEqual(r.entries.map((e) => [e.key, e.date, e.include]), [
      ["E-1", "", false],
      ["E-2", "2026-07-21", true],
      ["E-3", "2026-08-04", true],
      ["E-4", "2026-08-18", true],
      ["E-5", "2026-09-01", true],
    ]);
    assert.match(entry(r, "E-1").body, /^Thank you for your instruction\./);
    assert.deepEqual(r.entries.slice(1).map((e) => e.type), ["initial_assessment", "follow_up", "telephone", "discharge"]);
    assert.equal(entry(r, "E-2").body, "Initial assessment. Neck pain and stiffness since the collision, worse turning to the left. NDI 42%. NPRS 6/10. Advised on pacing and gentle range of movement exercises.");
    // The sign-off names the clinician of the last note; fix wave 3: a LETTER's signature names the clinician of its
    // entries that name none – staff are told, and can change any of them.
    assert.deepEqual([entry(r, "E-5").clinicianName, entry(r, "E-5").clinicianHcpc], ["Sarah Reid", "PH-DEMO-01"]);
    assert.deepEqual(r.entries.slice(1, 4).map((e) => `${e.clinicianName} ${e.clinicianHcpc}`), ["Sarah Reid PH-DEMO-01", "Sarah Reid PH-DEMO-01", "Sarah Reid PH-DEMO-01"]);
    const signed = r.warnings.find((w) => w.code === "SIGNATURE_APPLIED");
    assert.equal(signed?.message, "The letter is signed by Sarah Reid, so the 3 entries that name no clinician have that clinician – check them.");
    assert.deepEqual(signed?.entryKeys, ["E-2", "E-3", "E-4"]);
    assert.ok(!r.warnings.some((w) => w.code === "NO_CLINICIAN"));
    assert.equal(r.warnings.find((w) => w.code === "NO_DATE")?.message, "no date found for 1 block – give it a date to include it, or leave it out");
    assert.equal(r.letterDate, "2026-10-09", "the letter's own date is offered for its undated paragraphs, never a note");
    assert.deepEqual(scores(r), ["NDI 12 2026-09-01", "NDI 30 2026-08-04", "NDI 42 2026-07-21", "NPRS 1 2026-09-01", "NPRS 6 2026-07-21"]);
  });

  test("a Word table of sessions is read row by row (never as the documented layout)", async () => {
    const r = await review({ format: "docx", content: b64(await F.buildTableDocx()), fileName: "record.docx" });
    assert.deepEqual([r.registration.firstName, r.registration.lastName, r.registration.dob], ["Nadia", "Fenwick", "1990-11-22"]);
    assert.deepEqual([r.registration.instructingPartyName, r.registration.instructingPartyType, r.registration.reference], ["Brightwell Case Management (fictional)", "case_manager", "BCM-7781"]);
    assert.deepEqual(
      r.entries.map((e) => [e.date, e.clinicianName, e.clinicianHcpc, e.type]),
      [
        ["2026-03-02", "Priya Shah", "PH-DEMO-03", "initial_assessment"],
        ["2026-03-16", "Priya Shah", "PH-DEMO-03", "follow_up"],
        ["2026-03-30", "Priya Shah", "PH-DEMO-03", "discharge"],
      ],
    );
    assert.equal(entry(r, "E-1").body, F.TABLE_DOC_ROWS[1][3], "the cell's text, line breaks and all");
    assert.deepEqual(scores(r), ["ODI 14 2026-03-30", "ODI 36 2026-03-16", "ODI 48 2026-03-02"]);
    assert.equal(r.attendance, false);
  });
});

describe("CSV export with one row per appointment", () => {
  test("header found below the title lines; attendance from the status column; scores from a column", async () => {
    const r = await review({ format: "csv", content: F.APPOINTMENTS_CSV, fileName: "appointments.csv" });
    assert.deepEqual([r.registration.firstName, r.registration.lastName, r.registration.dob], ["Jonah", "Pemberly", "1968-05-07"]);
    assert.deepEqual([r.registration.insurerName, r.registration.membershipNumber], ["Northgate Health Insurance (fictional)", "NGH-2210-5531"]);
    assert.equal(r.attendance, true);
    assert.deepEqual(
      r.entries.map((e) => [e.where, e.date, e.time, e.clinicianName, e.status, e.body === ""]),
      [
        ["row 8", "2026-05-05", "08:30", "Tom Ellis", "ATT", false],
        ["row 9", "2026-05-12", "08:30", "Tom Ellis", "DNA", true],
        ["row 10", "2026-05-19", "08:30", "Tom Ellis", "ATT", false],
        ["row 11", "2026-05-26", "08:30", "Tom Ellis", "CNC", true],
        ["row 12", "2026-06-02", "08:30", "Tom Ellis", "ATT", false],
      ],
    );
    assert.deepEqual(scores(r), ["NPRS 1 2026-06-02", "NPRS 4 2026-05-19", "NPRS 6 2026-05-05"]);
  });

  test("a CSV in the documented format with a mistake is still reported against that format", async () => {
    const broken = SAMPLE_IMPORT_FILES.csv.content.replace(",10:00,initial_assessment,", ",9.3,initial_assessment,");
    await assert.rejects(readNotesUpload(ctx(), { format: "csv", content: broken }, { now: NOW }), (e: unknown) => e instanceof ImportError && /"9\.3" is not a 24-hour time/.test(e.issues[0].message));
  });
});

describe("pasted email-style notes", () => {
  test("greeting left out, weekday and 12-hour times, three date styles, clinician from heading and sign-off", async () => {
    const r = await review({ format: "text", content: F.EMAIL_NOTES });
    assert.deepEqual([r.registration.title, r.registration.firstName, r.registration.lastName, r.registration.dob], ["Mr", "Felix", "Hartley", "1991-06-30"]);
    assert.deepEqual([r.registration.insurerName, r.registration.membershipNumber], ["Wexley Assurance (fictional)", "WX-889102"]);
    const greeting = entry(r, "E-1");
    assert.equal(greeting.include, false);
    assert.equal(greeting.body, "Hi both, notes for the insurer report below as requested.", "registration lines are not part of the undated block");
    assert.deepEqual(
      r.entries.slice(1).map((e) => [e.date, e.time, e.type, e.clinicianName]),
      [
        ["2026-03-03", "09:30", "initial_assessment", ""],
        ["2026-03-10", "", "follow_up", "Tom Ellis"],
        ["2026-03-24", "", "discharge", "Sarah Reid"],
      ],
    );
    assert.deepEqual(scores(r), ["NPRS 0 2026-03-24", "NPRS 6 2026-03-03"]);
  });
});

describe("uncertain details are left blank, never guessed", () => {
  test("name, two-digit-year date of birth, sex, phone, postcode and membership", async () => {
    const r = await review({ format: "text", content: F.UNCERTAIN_NOTES });
    const filled = Object.entries(r.registration).filter(([, v]) => v !== "");
    assert.deepEqual(filled, [], "nothing filled in");
    assert.deepEqual(r.detected, []);
    const messages = r.warnings.map((w) => `${w.code}: ${w.message}`);
    assert.ok(messages.includes("DOB_TWO_DIGIT_YEAR: The date of birth is written with a two-digit year, so it was left blank – enter it in full."));
    assert.ok(messages.some((m) => /^VALUE_UNCLEAR: The patient's name could not be read clearly/.test(m)));
    assert.ok(messages.some((m) => /^VALUE_UNCLEAR: The postcode could not be read clearly/.test(m)));
    assert.ok(messages.includes("AMBIGUOUS_SCORE: NPRS on 08/03/2026 is written as a range, so it was not recorded as a score."));
    assert.ok(messages.includes("AMBIGUOUS_SCORE: NPRS is written with more than one value on 22/03/2026, so it was not recorded as a score – check the note."));
    assert.ok(messages.some((m) => /^EMPTY_DATE_LINE: 1 date stands alone/.test(m)));
    assert.deepEqual(r.outcomes, []);
    assert.deepEqual(r.entries.map((e) => [e.date, e.clinicianName]), [["2026-03-08", ""], ["2026-03-22", "P. Shah"]]);
  });
});

describe("the documented format is still read first", () => {
  test("pasted notes, JSON, CSV and the printed-notes PDF in the documented layout give the bundle straight away", async () => {
    for (const upload of [
      { format: "text" as const, content: F.DOCUMENTED_TEXT },
      { format: "text" as const, content: SAMPLE_IMPORT_FILES.text.content },
      { format: "json" as const, content: SAMPLE_IMPORT_FILES.json.content },
      { format: "csv" as const, content: SAMPLE_IMPORT_FILES.csv.content },
      { format: "pdf" as const, content: PRIYA_NAIR_NOTES_PDF_BASE64 },
    ]) {
      const c = ctx();
      const out = await readNotesUpload(c, upload, { now: NOW });
      assert.equal(out.kind, "bundle", upload.format);
      if (out.kind === "bundle") assert.ok(out.bundle.notes.length >= 2);
      assert.match(c.trace[0].note ?? "", /documented layout/);
    }
  });

  test("documented-looking notes without an author on every note are read as clinic notes instead", async () => {
    const text = ["Date of birth: 02/01/1990", "Instructing party: Example & Co Solicitors (fictional)", "", "18/03/2026 – Initial assessment", "Neck pain.", "Practitioner: Sarah Reid (PH-DEMO-01)"].join("\n");
    const r = await review({ format: "text", content: text });
    assert.deepEqual([entry(r, "E-1").clinicianName, entry(r, "E-1").clinicianHcpc], ["Sarah Reid", "PH-DEMO-01"]);
  });

  test("scans and files without notes are refused in plain English", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const blank = await PDFDocument.create();
    blank.addPage();
    await assert.rejects(readNotesUpload(ctx(), { format: "pdf", content: b64(await blank.save()) }, { now: NOW }), (e: unknown) => e instanceof ImportError && /scanned notes cannot be read/.test(e.issues[0].message));
    await assert.rejects(readNotesUpload(ctx(), { format: "text", content: "hello there" }, { now: NOW }), (e: unknown) => e instanceof ImportError && /No notes were found/.test(e.issues[0].message));
    await assert.rejects(readNotesUpload(ctx(), { format: "docx", content: Buffer.from("not a zip").toString("base64") }, { now: NOW }), (e: unknown) => e instanceof ImportError && /not a Word document/.test(e.issues[0].message));
    // A long letter with no dated note at all: one undated block, nothing included until staff date it.
    const letter = await review({ format: "text", content: "Dear Sir or Madam,\nThank you for referring this patient, who was seen at the clinic for neck pain after a fall at work." });
    assert.deepEqual(letter.entries.map((e) => [e.date, e.include]), [["", false]]);
    assert.ok(reviewBlockers(letter).includes("include at least one dated note"));
  });
});

/* ------------------------------------------------------------------------------------------------
 * 3. A checked review → the bundle
 * ----------------------------------------------------------------------------------------------*/

describe("bundle from a checked review", () => {
  test("the printout: N-001… by date, appointments with attendance, scores linked, insurer details kept", async () => {
    const r = await review({ format: "text", content: F.PRACTICE_PRINTOUT_TEXT, fileName: "printout.txt" });
    const built = bundleFromReview(r, { tenantId: "demo", now: NOW });
    assert.ok(built.ok, JSON.stringify(!built.ok && built.issues));
    if (!built.ok) return;
    const b = built.bundle;
    assert.equal(b.source.connectorId, "file-import");
    assert.equal(b.source.simulated, false);
    assert.equal(b.source.label, "printout.txt");
    // Fix wave 3: the missed appointment's text is its reason – an appointment, not a clinical note.
    assert.deepEqual(b.notes.map((n) => [n.id, n.date, n.type, n.author.name]), [
      ["N-001", "2026-09-01", "initial_assessment", "Sarah Reid"],
      ["N-002", "2026-09-08", "follow_up", "Sarah Reid"],
      ["N-003", "2026-09-22", "discharge", "Tom Ellis"],
    ]);
    // Labelled sections kept: the subjective carries on until the next label, word for word.
    assert.equal(b.notes[0].subjective, "Right shoulder pain for 6 weeks after lifting a heavy box at home. Pain worse reaching overhead.\nNPRS 7/10 at worst. QuickDASH 52.3. PSFS 2.7.");
    assert.equal(b.notes[0].plan, "Education, isometric loading programme, review in 1 week.");
    assert.deepEqual(b.appointments.map((a) => [a.id, a.status, a.noteId ?? null, a.reason ?? null]), [
      ["A-001", "ATT", "N-001", null],
      ["A-002", "ATT", "N-002", null],
      ["A-003", "DNA", null, "Patient did not attend. Text reminder sent; no reply."],
      ["A-004", "ATT", "N-003", null],
    ]);
    assert.deepEqual(b.clinicians.map((c) => `${c.name} ${c.hcpc}`), ["Sarah Reid PH-DEMO-01", "Tom Ellis PH-DEMO-02"]);
    assert.deepEqual(b.outcomeMeasures.find((m) => m.instrument === "QuickDASH")?.points.map((p) => [p.value, p.noteId]), [[52.3, "N-001"], [18.2, "N-003"]]);
    assert.equal(b.episodeStatus, "discharged");
    assert.deepEqual(
      [b.referral.type, b.referral.name, b.referral.insurerName, b.referral.membershipNumber, b.referral.authorisationNumber, b.referral.referredBy],
      ["insurer", "Northgate Health Insurance (fictional)", "Northgate Health Insurance (fictional)", "NGH-4471-0923", "AUTH-55821", "Dr Anna Fielding, Elm Tree Surgery (fictional)"],
    );
    assert.equal(b.registration.gpPractice, "Elm Tree Surgery (fictional)");
    assert.equal(b.registration.title, "Mrs");
    assert.equal(b.registration.addressSummary, "12 Larch Avenue, Testford, ZZ1 1ZZ");
    assert.deepEqual(b.registration.contact, { phone: "07700 900417", email: "harriet.quill@example.com" });
    const facts = computeFacts(b, { asOf: "2026-10-10" });
    assert.match(facts.find((f) => f.id === "FACT-attendance")?.value ?? "", /^3 of 4 appointments attended \(1 DNA\)/);
    assert.match(facts.find((f) => f.id === "FACT-outcomes-QuickDASH")?.value ?? "", /52\.3\/100 → 18\.2\/100/);
    assert.deepEqual(built.counts, { notes: 3, appointments: 4, outcomeSeries: 3, clinicians: 2, scores: 7, leftOut: 0, detectedFields: 14, filledFields: 16 });
  });

  test("the letter: blocked until each note has a clinician; the undated opening stays out; a CSV DNA row is an appointment only", async () => {
    // The letter's signature names every entry's clinician; with three of them cleared, confirming is blocked.
    let r = await review({ format: "docx", content: b64(await F.buildLetterDocx()), fileName: "letter.docx" });
    assert.deepEqual(reviewBlockers(r), []);
    for (const key of ["E-2", "E-3", "E-4"]) r = updateEntry(r, key, { clinicianName: "", clinicianHcpc: "" });
    const refused = bundleFromReview(r, { tenantId: "demo", now: NOW });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.deepEqual(refused.issues.map((i) => `${i.where}: ${i.message}`), [
      "E-2 (paragraph 10): Choose the clinician for this entry.",
      "E-3 (paragraph 11): Choose the clinician for this entry.",
      "E-4 (paragraph 12): Choose the clinician for this entry.",
    ]);
    assert.deepEqual(reviewBlockers(r), ["3 entries without a clinician – choose one"]);
    r = applyClinician(r, reviewCounts(r).noClinician, reviewClinicians(r)[0]);
    assert.deepEqual(reviewBlockers(r), []);
    const built = bundleFromReview(r, { tenantId: "demo", now: NOW });
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(built.bundle.notes.length, 4);
    assert.ok(built.bundle.notes.every((n) => n.author.name === "Sarah Reid" && n.author.hcpc === "PH-DEMO-01"));
    assert.ok(!built.bundle.notes.some((n) => /Thank you for your instruction/.test(n.freeText ?? "")));
    assert.equal(built.counts.leftOut, 1);
    assert.deepEqual([built.bundle.referral.type, built.bundle.referral.reference, built.bundle.incident?.date, built.bundle.incident?.type], ["solicitor", "CM/PI/2231", "2026-07-12", "other"]);
    assert.deepEqual(built.bundle.consent, { disclosureConsentRecorded: true, date: "2026-07-21" });

    const csv = await review({ format: "csv", content: F.APPOINTMENTS_CSV });
    const fromCsv = bundleFromReview(csv, { tenantId: "demo", now: NOW });
    assert.ok(fromCsv.ok);
    if (!fromCsv.ok) return;
    assert.equal(fromCsv.bundle.notes.length, 3, "the DNA and cancelled rows hold no note");
    assert.deepEqual(fromCsv.bundle.appointments.map((a) => a.status), ["ATT", "DNA", "ATT", "CNC", "ATT"]);
    assert.deepEqual(fromCsv.bundle.clinicians.map((c) => `${c.name}|${c.hcpc}`), ["Tom Ellis|Not recorded"]);
  });

  test("required details, undated included entries, the instructing party's type and clinicians without a number", async () => {
    const base = await review({ format: "text", content: F.EMAIL_NOTES });
    let r = updateRegistration(base, "dob", "");
    r = updateRegistration(r, "instructingPartyType", "");
    const refused = bundleFromReview(updateEntry(r, "E-1", { include: true }), { tenantId: "demo", now: NOW });
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      const text = refused.issues.map((i) => `${i.where}: ${i.message}`);
      assert.ok(text.includes("Date of birth: Enter the date of birth."));
      assert.ok(text.includes("Type: Choose what kind of organisation the form is for."));
      assert.ok(text.includes("E-1 (line 6): Give this entry a date, or leave it out."));
    }
    // A medico-legal company is kept as the instructing party's type; two clinicians without numbers stay two.
    r = updateRegistration(updateRegistration(base, "instructingPartyName", "Medicolegal Partners (fictional)"), "instructingPartyType", "mlc");
    r = updateEntry(r, "E-2", { clinicianName: "Alex Morgan", clinicianHcpc: "" });
    r = updateEntry(r, "E-4", { clinicianName: "Sam Ward", clinicianHcpc: "" });
    const built = bundleFromReview(r, { tenantId: "demo", now: NOW });
    assert.ok(built.ok, JSON.stringify(!built.ok && built.issues));
    if (!built.ok) return;
    assert.equal(built.bundle.referral.type, "mlc");
    assert.deepEqual(built.bundle.clinicians.map((c) => c.name), ["Alex Morgan", "Tom Ellis", "Sam Ward"]);
  });

  test("labelled sections are split, everything else is kept as the note's other text", () => {
    assert.deepEqual(splitNoteText("Seen with partner.\nS: Pain 6/10\non stairs.\nO: ROM full.\nTreatment: manual therapy.\nPlan – review 2/52"), {
      subjective: "Pain 6/10\non stairs.",
      objective: "ROM full.\nTreatment: manual therapy.",
      assessment: "",
      plan: "review 2/52",
      past_medical_history: "",
      social_history: "",
      free_text: "Seen with partner.",
    });
    assert.equal(splitNoteText("S-shaped scar noted.").free_text, "S-shaped scar noted.", "one-letter labels need a colon");
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4. The endpoints: demo session and a clinic's member (audit rows hold counts only)
 * ----------------------------------------------------------------------------------------------*/

describe("POST /connectors/file-import/read and /confirm", () => {
  const MEMBER: AuthContext = {
    userId: "u_staff_n",
    authSessionId: "s_staff_n",
    tenantId: "clinic-notes",
    role: "staff",
    name: "Pat Desk (fictional)",
    twoFactorVerified: true,
  };
  let tmpDir: string;
  let db: Kysely<Database>;
  let deps: MedreportDeps;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-notes-"));
    const raw = openSqliteDatabase(path.join(tmpDir, "notes.db"));
    applySqliteMigrations(raw);
    db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: raw }) });
    deps = {
      connectors: createConnectorRegistry([createTm3SimConnector(), createFileImportConnector()]),
      createConnectorContext: getMedreportDeps().createConnectorContext,
      authenticate: async (req) => (req.headers.get("x-test-member") === "staff" ? MEMBER : null),
      clinicProfile: async () => null,
      sharedState: dbSharedState(() => db),
      audit: dbAudit(() => db),
    };
  });
  after(async () => {
    await db?.destroy();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function call(handler: MedreportHandler, url: string, body: unknown, who: "demo" | "staff" | "nobody"): Promise<Response> {
    const headers: Record<string, string> = { "content-type": CONTENT_TYPES.json };
    if (who === "demo") headers.authorization = demoBearer();
    if (who === "staff") headers["x-test-member"] = "staff";
    const req = new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers, body: JSON.stringify(body) });
    return bindHandler(handler, () => deps)(req, { params: {} });
  }

  test("nobody signed in: 401 on both", async () => {
    assert.equal((await call(handleFileImportRead, "/connectors/file-import/read", { format: "text", content: "x" }, "nobody")).status, 401);
    assert.equal((await call(handleFileImportConfirm, "/connectors/file-import/confirm", { review: {} }, "nobody")).status, 401);
  });

  test("public demo: notes to check, then the bundle; the documented format straight away; no audit rows", async () => {
    const read = FileImportReadResponseSchema.parse(await (await call(handleFileImportRead, "/connectors/file-import/read", { format: "text", content: F.PRACTICE_PRINTOUT_TEXT }, "demo")).json());
    assert.equal(read.result, "review");
    if (read.result !== "review") return;
    assert.equal(read.trace[0].url, "file-import/text");
    const res = await call(handleFileImportConfirm, "/connectors/file-import/confirm", { review: read.review }, "demo");
    assert.equal(res.status, 200, await res.clone().text());
    const data = BundleResponseSchema.parse(await res.json());
    assert.equal(data.bundle.tenantId, "demo");
    assert.equal(data.bundle.notes.length, 3, "the missed appointment is an appointment with its reason, not a note");
    assert.ok(data.computedFacts.some((f) => f.id === "FACT-attendance"));
    assert.match(data.trace[0].note ?? "", /^checked and confirmed by staff · 3 notes · 4 appointments · 7 outcome scores$/);

    const documented = FileImportReadResponseSchema.parse(await (await call(handleFileImportRead, "/connectors/file-import/read", { format: "json", content: SAMPLE_IMPORT_FILES.json.content }, "demo")).json());
    assert.equal(documented.result, "bundle");
    assert.deepEqual(await listAudit({ db }, "demo"), []);
  });

  test("a clinic's member: the bundle is the clinic's, and 'notes.imported' records counts and format only", async () => {
    const pdf = b64(await F.buildPracticePrintoutPdf());
    const read = FileImportReadResponseSchema.parse(await (await call(handleFileImportRead, "/connectors/file-import/read", { format: "pdf", content: pdf, fileName: "quill-printout.pdf" }, "staff")).json());
    assert.equal(read.result, "review");
    if (read.result !== "review") return;
    assert.deepEqual(await listAudit({ db }, MEMBER.tenantId), [], "reading the notes records nothing yet");
    const data = BundleResponseSchema.parse(await (await call(handleFileImportConfirm, "/connectors/file-import/confirm", { review: read.review }, "staff")).json());
    assert.equal(data.bundle.tenantId, MEMBER.tenantId);
    const rows = await listAudit({ db }, MEMBER.tenantId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "notes.imported");
    assert.equal(rows[0].userId, MEMBER.userId);
    assert.deepEqual(rows[0].detail, { format: "pdf", layout: "general", notes: 3, appointments: 4, outcomeScores: 7, clinicians: 2, entriesLeftOut: 0, detailsFound: 14, detailsFilled: 16 });
    assert.doesNotMatch(JSON.stringify(rows[0]), /Quill|Harriet|Northgate|quill-printout|07700|PH-DEMO/, "no patient details, file names or clinicians");
    assert.equal(activityLabel("notes.imported"), "Patient notes imported");
    assert.equal(describeActivityDetail("notes.imported", rows[0].detail), "3 notes, 4 appointments, 7 outcome scores · from a PDF · checked before use");

    // The documented format through /read is recorded too.
    await call(handleFileImportRead, "/connectors/file-import/read", { format: "csv", content: SAMPLE_IMPORT_FILES.csv.content }, "staff");
    const documented = (await listAudit({ db }, MEMBER.tenantId)).find((r) => r.detail && (r.detail as Record<string, unknown>).layout === "documented");
    assert.deepEqual(documented?.detail, { format: "csv", layout: "documented", notes: 6, appointments: 7, outcomeScores: 6, clinicians: 1 });
  });

  test("confirm re-checks the review: missing details are 422 IMPORT_INVALID with plain-English issues", async () => {
    const read = FileImportReadResponseSchema.parse(await (await call(handleFileImportRead, "/connectors/file-import/read", { format: "text", content: F.UNCERTAIN_NOTES }, "staff")).json());
    if (read.result !== "review") return assert.fail("expected a review");
    const res = await call(handleFileImportConfirm, "/connectors/file-import/confirm", { review: read.review }, "staff");
    assert.equal(res.status, 422);
    const problem = ProblemSchema.parse(await res.json());
    assert.equal(problem.code, "IMPORT_INVALID");
    assert.ok((problem.issues ?? []).some((i) => i.path === "Date of birth" && i.message === "Enter the date of birth."));
    // A review tampered with beyond the contract is refused before anything is built.
    const bad = await call(handleFileImportConfirm, "/connectors/file-import/confirm", { review: { ...read.review, entries: [{ ...read.review.entries[0], key: "../x" }] } }, "staff");
    assert.equal(bad.status, 422);
    assert.equal(ProblemSchema.parse(await bad.json()).code, "VALIDATION_FAILED");
  });
});

/* ------------------------------------------------------------------------------------------------
 * 5. The Studio's review step and its wording
 * ----------------------------------------------------------------------------------------------*/

describe("the review step in the Studio", () => {
  const DEMO_ONLY = /\bdemo\b|demonstration|fictional|simulated|sandbox|In this demo|passcode|\bTM3\b/i;
  const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

  test("a clinic's Studio: neutral wording, live counts and warnings, confirm blocked until fixed", async () => {
    let r = await review({ format: "docx", content: b64(await F.buildLetterDocx()), fileName: "letter.docx" });
    for (const key of ["E-2", "E-3", "E-4"]) r = updateEntry(r, key, { clinicianName: "", clinicianHcpc: "" });
    const html = renderToStaticMarkup(createElement(NotesReviewStep, { review: r, tenant: true, busy: false, error: null, onConfirm: () => undefined, onBack: () => undefined }));
    const text = visible(html);
    assert.match(text, /Check the notes before they are used/);
    assert.match(text, /4 entries · 1 clinician · 5 outcome scores/);
    assert.match(text, /3 entries without a clinician – choose one/);
    assert.match(text, /Who the form is for/);
    assert.match(text, /From the notes/);
    assert.match(html, /data-testid="notes-review-confirm"[^>]*disabled=""|disabled=""[^>]*data-testid="notes-review-confirm"/);
    // The fictional fixture's clinician numbers (PH-DEMO-0N) are data, not wording.
    assert.equal(text.replace(/PH-DEMO-\d+/g, "").match(DEMO_ONLY), null, "no demo wording in a clinic's Studio");
    assert.deepEqual(BANNED_TERM_PATTERNS.filter((re) => re.test(text)).map(String), []);
  });

  test("the public demo says the data is fictional; a ready review can be confirmed", async () => {
    const r = await review({ format: "text", content: F.PRACTICE_PRINTOUT_TEXT });
    const html = renderToStaticMarkup(createElement(NotesReviewStep, { review: r, tenant: false, busy: false, error: null, onConfirm: () => undefined, onBack: () => undefined }));
    assert.match(visible(html), /Fictional data only/);
    assert.match(visible(html), /Ready to use/);
    assert.doesNotMatch(html, /data-testid="notes-review-confirm"[^>]*disabled=""/);
  });

  test("every message of the review step and of the reader is neutral", async () => {
    const warnings: string[] = [];
    for (const upload of [
      { format: "text" as const, content: F.PRACTICE_PRINTOUT_TEXT },
      { format: "text" as const, content: F.EMAIL_NOTES },
      { format: "text" as const, content: F.UNCERTAIN_NOTES },
      { format: "csv" as const, content: F.APPOINTMENTS_CSV },
      { format: "docx" as const, content: b64(await F.buildLetterDocx()) },
    ]) {
      const r = await review(upload);
      warnings.push(...r.warnings.map((w) => w.message), ...Object.values(r.fieldNotes ?? {}).map(String));
    }
    const strings = [...notesReviewCopyStrings(), ...warnings];
    assert.ok(strings.length > 40);
    assert.deepEqual(strings.filter(hasBannedTerm), []);
  });
});
