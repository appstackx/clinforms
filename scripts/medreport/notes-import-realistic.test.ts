/**
 * Fix wave 3 – the notes reader on the exports clinics actually have (from the wave 3 end-to-end and security
 * reviews), with FICTIONAL fixtures (./notes-fixtures.ts §8):
 *  - a practice system's "Clinical Notes Report" PDF (running footer with the patient's number and "Page n of 3",
 *    a two-column patient box, funding / policy / authorisation line, notes newest first, an admin note, a missed
 *    appointment, e-signatures, a wrapped line starting "2-3/10");
 *  - a booking system's CSV ("Appointment start" date-time column, "Patient DOB", "Cancelled < 24 hrs");
 *  - a progress letter in Word (addressee, Re: line with the policy, bulleted attendance, a dated outcome table);
 *  - pain ranges at the start of a line never become dates;
 *  - every reader step is linear: a padded 200,000-character line is read in well under a second;
 *  - the per-minute limits on /connectors/file-import/*;
 *  - the record: missed appointments are appointments with their reason, consent can be recorded for uploads,
 *    short dates ("26/08") support the drafted full date, the drafting minimiser masks every name form and the
 *    clinic's patient number.
 */
import * as React from "react";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.MEDREPORT_AI_MODE = "demo";
for (const k of ["MEDREPORT_LAUNCH_SECRET", "MEDREPORT_SIGNING_SECRET", "MEDREPORT_PARTNER_KEY", "ANTHROPIC_API_KEY", "MEDREPORT_LIVE_PASSCODE", "CLINFORMS_PUBLIC_DEMO", "CLINFORMS_DB", "VERCEL", "PORT"]) {
  delete process.env[k];
}
process.env.APP_ORIGIN = "https://clinforms.test";

import { getMedreportDeps } from "@/app/api/_medreport-glue";
import { createMinimiser } from "@/modules/medreport/ai/prompts";
import { CONTENT_TYPES, FileImportReadResponseSchema, ProblemSchema } from "@/modules/medreport/api/contract";
import type { MedreportDeps } from "@/modules/medreport/api/deps";
import { handleFileImportRead } from "@/modules/medreport/api/handlers/file-import-read";
import { FILE_IMPORT_PER_ACTOR_PER_MINUTE } from "@/modules/medreport/api/handlers/file-import-response";
import { bindHandler } from "@/modules/medreport/api/http";
import { resetMemoryLimits } from "@/modules/medreport/auth/shared-limits";
import { readNotesUpload } from "@/modules/medreport/connectors/file-import/connector";
import { createFileImportConnector } from "@/modules/medreport/connectors/file-import/connector";
import { ImportError, parseImport } from "@/modules/medreport/connectors/file-import/parser";
import { bundleFromReview, splitNoteText } from "@/modules/medreport/connectors/file-import/review-bundle";
import { NotesReviewSchema, reviewAttendance, type NotesReview } from "@/modules/medreport/connectors/file-import/review-contract";
import { createConnectorRegistry } from "@/modules/medreport/connectors/registry";
import { createTm3SimConnector } from "@/modules/medreport/connectors/tm3-sim/connector";
import type { ConnectorContext } from "@/modules/medreport/connectors/types";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { createReport } from "@/modules/medreport/core/report-factory";
import type { ImportPayload } from "@/modules/medreport/core/types";
import { runDataChecks } from "@/modules/medreport/core/validation/data-checks";
import { addShortDatesToIndex, addToFigureIndex, emptyFigureIndex, figureInIndex } from "@/modules/medreport/core/validation/text";
import { hasBannedTerm } from "@/modules/medreport/core/wording";
import { SOLICITOR_RTA_TEMPLATE } from "@/modules/medreport/templates/registry";
import { NotesReviewStep } from "@/modules/medreport/ui/components/new/notes-review";
import { attendanceNotice, consentMissing, markOthersAttended, reviewBlockers, reviewClinicians, updateEntry, updateRegistration, withMemberNumbers } from "@/modules/medreport/ui/components/new/notes-review-model";
import { canRecordConsent, recordConsent } from "@/modules/medreport/ui/components/review/review-model";
import { HostHooksProvider } from "@/modules/medreport/ui/host-hooks";
import * as F from "./notes-fixtures";
import { demoBearer } from "./test-actors";

(globalThis as unknown as { React: typeof React }).React = React;

const NOW = new Date("2026-10-10T09:00:00.000Z");
const ctx = (): ConnectorContext => ({ tenantId: "demo", credentials: { kind: "none" }, baseUrl: "", fetch: (u, i) => fetch(u, i), trace: [] });
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function review(upload: ImportPayload): Promise<NotesReview> {
  const out = await readNotesUpload(ctx(), upload, { now: NOW });
  if (out.kind !== "review") assert.fail(`expected a review, got the documented-format bundle for ${upload.format}`);
  return NotesReviewSchema.parse(out.review);
}
const scoreList = (r: NotesReview) =>
  r.outcomes.map((o) => `${o.instrument} ${o.value} ${o.date || r.entries.find((e) => e.key === o.entryKey)?.date}`).sort();

/* ------------------------------------------------------------------------------------------------
 * 1. The practice system's Clinical Notes Report (PDF)
 * ----------------------------------------------------------------------------------------------*/

describe("a practice system's Clinical Notes Report (PDF)", () => {
  test("patient box, funding line, headings, signatures, the admin note and the missed appointment", async () => {
    const r = await review({ format: "pdf", content: b64(await F.buildClinicalNotesReportPdf()), fileName: "report.pdf" });
    const reg = r.registration;
    assert.deepEqual(
      [reg.title, reg.firstName, reg.lastName, reg.dob, reg.sex, reg.address, reg.postcode, reg.phone, reg.email, reg.occupation, reg.employer],
      ["Mr", "Rowan Lewis", "Tate", "1983-11-22", "male", "14 Ashdown Close, Testford, Kent", "ZZ3 9LT", "07700 900314", "r.tate@example.com", "Warehouse supervisor", "Brightwater Logistics (fictional)"],
      "the address carried on beside 'Employer:' is read, and so is the employer",
    );
    assert.deepEqual([reg.insurerName, reg.membershipNumber, reg.authorisationNumber, reg.incidentDate], ["Northfield Assurance (fictional)", "NFA-88213407", "AUTH-55120", "2026-08-02"]);
    assert.deepEqual([reg.instructingPartyName, reg.instructingPartyType], ["Northfield Assurance (fictional)", "insurer"], "never the claims handler's name");
    assert.deepEqual(r.otherDetails, ["Case: Lower back - injury at work (opened 13/08/2026)"], "an unrecognised header line is shown, not dropped");

    assert.deepEqual(
      r.entries.map((e) => [e.date, e.time, e.type, `${e.clinicianName} ${e.clinicianHcpc}`.trim(), e.status, e.include]),
      [
        ["2026-09-17", "10:30", "follow_up", "Amara Okafor PH-DEMO-03", "", true],
        ["2026-09-10", "14:00", "telephone", "Amara Okafor PH-DEMO-03", "", true],
        ["2026-09-03", "09:45", "follow_up", "Daniel Kerr PH-DEMO-04", "", true],
        ["2026-09-02", "16:05", "other", "", "", false],
        ["2026-08-27", "10:30", "follow_up", "Amara Okafor PH-DEMO-03", "DNA", true],
        ["2026-08-20", "10:30", "follow_up", "Amara Okafor PH-DEMO-03", "", true],
        ["2026-08-13", "10:15", "initial_assessment", "Amara Okafor PH-DEMO-03", "", true],
      ],
    );
    assert.equal(r.entries[4].reason, "No contact from patient. SMS reminder had been sent 26/08");
    assert.ok(r.warnings.some((w) => w.code === "ADMIN_LEFT_OUT" && w.entryKeys?.[0] === "E-4"));
    // The wrapped "2-3/10" line is part of the 17/09 note – never a note dated 2010.
    assert.ok(r.entries.every((e) => !e.date || e.date >= "2026-01-01"));
    assert.match(r.entries[0].body, /Pain mostly\n2-3\/10, flares to 5\/10/);
    // The running footer (the patient's name and clinic number, "Printed … Page n of 3") is in no note.
    const all = r.entries.map((e) => `${e.heading}\n${e.body}`).join("\n");
    assert.doesNotMatch(all, /CONFIDENTIAL|AP-004127|Printed 09\/10\/2026|Page \d of \d|ASHGROVE/);
    assert.deepEqual(scoreList(r), ["NPRS 3 2026-09-17", "NPRS 5 2026-08-20", "NPRS 7 2026-08-13", "ODI 22 2026-09-17", "ODI 46 2026-08-13"]);
    assert.ok(!r.warnings.some((w) => w.code === "DATE_OUTLIER"));
    assert.equal(reviewBlockers(r).length, 0);
  });

  test("attendance: set for one entry, the others marked attended in one step; the missed one is an appointment with its reason", async () => {
    const r0 = await review({ format: "pdf", content: b64(await F.buildClinicalNotesReportPdf()), fileName: "report.pdf" });
    assert.equal(r0.attendance, false);
    assert.deepEqual(attendanceNotice(r0), { text: "Attendance is set for 1 of 6 entries. Set it for every entry to count the appointments – until then none are counted.", canMarkOthers: true });
    const r = markOthersAttended(r0);
    assert.equal(r.attendance, true);
    assert.equal(attendanceNotice(r), null);
    assert.ok(consentMissing(r), "the notes record no consent: the review says so before anything is drafted");
    const built = bundleFromReview(r, { tenantId: "demo", now: NOW });
    assert.ok(built.ok, JSON.stringify(!built.ok && built.issues));
    if (!built.ok) return;
    const b = built.bundle;
    assert.deepEqual(b.appointments.map((a) => [a.date, a.status, a.reason ?? null]), [
      ["2026-08-13", "ATT", null],
      ["2026-08-20", "ATT", null],
      ["2026-08-27", "DNA", "No contact from patient. SMS reminder had been sent 26/08"],
      ["2026-09-03", "ATT", null],
      ["2026-09-10", "ATT", null],
      ["2026-09-17", "ATT", null],
    ]);
    assert.equal(b.notes.length, 5, "the admin note is left out and the missed appointment is not a clinical note");
    assert.deepEqual(b.clinicians.map((c) => `${c.name} ${c.hcpc}`), ["Amara Okafor PH-DEMO-03", "Daniel Kerr PH-DEMO-04"]);
    // Section headings printed alone on their line fill the record's fields.
    const first = b.notes.find((n) => n.date === "2026-09-17");
    assert.match(first?.subjective ?? "", /^Back to work on modified duties/);
    assert.match(first?.plan ?? "", /^2 further sessions/);
    assert.match(first?.assessment ?? "", /^Resolving mechanical low back pain/);
    const facts = computeFacts(b, { asOf: "2026-10-10" });
    assert.match(facts.find((f) => f.id === "FACT-outcomes-NPRS")?.value ?? "", /7\/10 → 5\/10 → 3\/10/);
    assert.match(facts.find((f) => f.id === "FACT-attendance")?.value ?? "", /^5 of 6 appointments attended \(1 DNA\)/);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 2. A booking system's CSV export
 * ----------------------------------------------------------------------------------------------*/

describe("a booking system's CSV export", () => {
  test("'Appointment start' with the time, 'Patient DOB', attendance words, a late cancellation with its reason", async () => {
    const r = await review({ format: "csv", content: F.bookingCsv(), fileName: "export.csv" });
    assert.deepEqual([r.registration.firstName, r.registration.lastName, r.registration.dob], ["Jenna", "Holloway", "1991-03-07"]);
    assert.deepEqual(
      r.entries.map((e) => [e.date, e.time, e.type, e.status]),
      [
        ["2026-07-28", "08:30", "initial_assessment", "ATT"],
        ["2026-08-04", "08:30", "follow_up", "ATT"],
        ["2026-08-11", "08:30", "follow_up", "DNA"],
        ["2026-08-13", "17:15", "follow_up", "LCN"],
        ["2026-08-18", "08:30", "follow_up", "ATT"],
        ["2026-09-01", "08:30", "follow_up", "ATT"],
      ],
    );
    assert.equal(r.attendance, true);
    assert.deepEqual(scoreList(r), ["NPRS 1 2026-09-01", "NPRS 3 2026-08-18", "NPRS 6 2026-07-28", "QuickDASH 15.9 2026-09-01", "QuickDASH 56.8 2026-07-28"]);
    let checked = updateRegistration(updateRegistration(r, "instructingPartyName", "Northfield Assurance (fictional)"), "instructingPartyType", "insurer");
    checked = updateRegistration(checked, "incidentMechanism", "Fell off her bike cycling to work");
    const built = bundleFromReview(checked, { tenantId: "demo", now: NOW });
    assert.ok(built.ok, JSON.stringify(!built.ok && built.issues));
    if (!built.ok) return;
    assert.equal(built.bundle.notes.length, 4, "the missed and the late-cancelled appointments hold no clinical note");
    assert.deepEqual(built.bundle.appointments.filter((a) => a.status !== "ATT").map((a) => [a.status, a.reason ?? null]), [
      ["DNA", null],
      ["LCN", "Pt cancelled by phone - childcare issue. Rebooked."],
    ]);
    assert.notEqual(built.bundle.incident?.type, "workplace", "cycling to work is not an injury at work");
  });

  test("other date headers, a date column found by its content, and a file without dates refused in plain English", async () => {
    for (const header of ["Date/Time", "Start date", "Appointment Date", "Visit on"]) {
      const r = await review({ format: "csv", content: F.bookingCsv(header) });
      assert.equal(r.entries.filter((e) => e.date).length, 6, header);
      assert.equal(r.registration.dob, "1991-03-07", header);
    }
    const noDates = `Patient,Practitioner,Notes\r\nJenna Holloway,Ben Ferraro,Shoulder pain after a fall from her bike\r\nJenna Holloway,Ben Ferraro,Much better now\r\n`;
    await assert.rejects(readNotesUpload(ctx(), { format: "csv", content: noDates }, { now: NOW }), (e: unknown) =>
      e instanceof ImportError && /No column of appointment dates was found in this file \(columns: "Patient", "Practitioner", "Notes"\)/.test(e.issues[0].message),
    );
  });

  test("a clinic's own clinicians are offered, and a member named in the notes gets their HCPC number", async () => {
    const r = await review({ format: "csv", content: F.bookingCsv() });
    const members = [
      { name: "Ben Ferraro", hcpc: "PH-DEMO-06" },
      { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
    ];
    const withNumbers = withMemberNumbers(r, members);
    assert.ok(withNumbers.entries.every((e) => e.clinicianHcpc === "PH-DEMO-06"));
    assert.deepEqual(reviewClinicians(withNumbers, members).map((c) => `${c.name} ${c.hcpc}`), ["Ben Ferraro PH-DEMO-06", "Sarah Reid PH-DEMO-01"]);
    // In a clinic's Studio the members come from the host and are listed for every entry.
    const html = renderToStaticMarkup(
      createElement(HostHooksProvider, {
        hooks: { mode: "tenant", clinic: { tenantId: "clinic-a", name: "Clinic A (fictional)", clinicians: members } },
        children: createElement(NotesReviewStep, { review: r, tenant: true, busy: false, error: null, onConfirm: () => undefined, onBack: () => undefined }),
      }),
    );
    assert.match(html, /Sarah Reid \(PH-DEMO-01\)/);
    assert.match(html, /Ben Ferraro \(PH-DEMO-06\)/);
    assert.match(html, /Needed for approval/, "consent is asked for before anything is drafted");
    assert.match(html, /The report cannot be approved until the patient&#x27;s consent to share it is recorded/);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 3. A progress letter (Word)
 * ----------------------------------------------------------------------------------------------*/

describe("a progress letter in Word", () => {
  test("addressee, Re: line, bulleted attendance, the dated outcome table and the closing paragraphs", async () => {
    const r = await review({ format: "docx", content: b64(await F.buildProgressLetterDocx()), fileName: "letter.docx" });
    const reg = r.registration;
    assert.equal(r.letterDate, "2026-10-09");
    assert.deepEqual([reg.title, reg.firstName, reg.lastName, reg.dob], ["Mrs", "Priya", "Dhaliwal", "1972-04-15"]);
    assert.deepEqual([reg.membershipNumber, reg.authorisationNumber, reg.reference], ["NFA-77310288", "AUTH-60412", "NFA-77310288"]);
    assert.deepEqual([reg.instructingPartyName, reg.instructingPartyType, r.fieldNotes?.instructingPartyName], ["Northfield Assurance (fictional)", "insurer", "Taken from the letter's address – check it"]);
    const dated = r.entries.filter((e) => e.date);
    assert.deepEqual(
      dated.map((e) => [e.date, e.status, e.reason, `${e.clinicianName} ${e.clinicianHcpc}`]),
      [
        ["2026-07-01", "ATT", "", "Sophie Lang PH-DEMO-05"],
        ["2026-07-08", "ATT", "", "Sophie Lang PH-DEMO-05"],
        ["2026-07-15", "ATT", "", "Sophie Lang PH-DEMO-05"],
        ["2026-07-22", "DNA", "unwell, telephoned on the day", "Sophie Lang PH-DEMO-05"],
        ["2026-07-29", "ATT", "", "Sophie Lang PH-DEMO-05"],
        ["2026-08-12", "ATT", "", "Sophie Lang PH-DEMO-05"],
      ],
    );
    assert.ok(r.warnings.some((w) => w.code === "SIGNATURE_APPLIED"));
    // The bulleted entry ends with its list: the recommendation is NOT dated 12/08/2026.
    const review12 = dated[dated.length - 1];
    assert.doesNotMatch(`${review12.heading}\n${review12.body}`, /Recommendation|fit for her normal work|Measure/);
    const closing = r.entries.find((e) => !e.date && /Recommendation: I recommend/.test(e.body));
    assert.ok(closing && !closing.include, "the closing paragraphs are a block of their own, left out until dated");
    // Each score has its own column's date; the latest value is never dropped.
    assert.deepEqual(scoreList(r), ["NPRS 2 2026-08-12", "NPRS 6 2026-07-01", "QuickDASH 22.7 2026-08-12", "QuickDASH 54.5 2026-07-01"]);
    assert.ok(r.warnings.some((w) => w.code === "SCORE_TABLE"));
    // No times in a letter: attendance is not counted until staff add them (said plainly, not a blocker).
    assert.equal(r.attendance, false);
    assert.equal(attendanceNotice(r)?.text, "6 appointments have no time. Add the times to count the appointments – until then none are counted.");
    // The letter's date is offered for its undated paragraphs.
    const html = renderToStaticMarkup(createElement(NotesReviewStep, { review: r, tenant: true, busy: false, error: null, onConfirm: () => undefined, onBack: () => undefined }));
    assert.match(html, /Use the letter&#x27;s date \(09\/10\/2026\)/);
    const datedClosing = updateEntry(r, closing.key, { date: "2026-10-09", include: true });
    assert.equal(datedClosing.entries.find((e) => e.key === closing.key)?.date, "2026-10-09");
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4. Pain ranges at the start of a line
 * ----------------------------------------------------------------------------------------------*/

describe("pain ranges at the start of a wrapped line are never dates", () => {
  test("'1-2/10' and '2-3/10' stay in their notes; '2/3/10' far from every other date is kept as text with a warning", async () => {
    const r = await review({ format: "text", content: F.WRAPPED_RANGES_NOTES });
    assert.deepEqual(r.entries.map((e) => e.date), ["2026-08-13", "2026-09-03", "2026-09-17"]);
    assert.match(r.entries[0].body, /^Low back pain after lifting at home\. Pain at rest\n1-2\/10, worse bending/);
    assert.match(r.entries[1].body, /\n2-3\/10, flares after long shifts\.$/);
    assert.match(r.entries[2].body, /\n2\/3\/10 days this week/);
    assert.ok(r.warnings.some((w) => w.code === "DATE_OUTLIER" && /02\/03\/2010/.test(w.message)));
    assert.deepEqual(scoreList(r), ["NPRS 2 2026-09-17", "NPRS 6 2026-08-13"]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 5. Linear time on padded lines (security review: one small upload kept the server busy for minutes)
 * ----------------------------------------------------------------------------------------------*/

describe("the readers take linear time", () => {
  const PAD = " ".repeat(200_000);
  const LIMIT_MS = 1_500;
  const timed = async (label: string, run: () => Promise<unknown> | unknown) => {
    const t = Date.now();
    try {
      await run();
    } catch {
      // A refusal is fine – only the time matters here.
    }
    const ms = Date.now() - t;
    assert.ok(ms < LIMIT_MS, `${label} took ${ms} ms`);
  };

  test("200,000-character padded lines in every format, and on confirm", async () => {
    const cases: Array<[string, ImportPayload]> = [
      ["heading text", { format: "text", content: `18/03/2026 x${PAD}y` }],
      ["leading spaces", { format: "text", content: `18/03/2026 Sarah Reid (PH-DEMO-01)\n${PAD}x` }],
      ["a name line", { format: "text", content: `Name: Jane${PAD}x\n18/03/2026 – Sarah Reid (PH-DEMO-01)\nok` }],
      ["a date of birth", { format: "text", content: `DOB${PAD}x\n18/03/2026 – Sarah Reid (PH-DEMO-01)\nok` }],
      ["a signature", { format: "text", content: `18/03/2026\ntext\nSigned${PAD}:` }],
      ["bars", { format: "text", content: `18/03/2026 a${" | ".repeat(70_000)}b` }],
      ["dashes", { format: "text", content: `18/03/2026 a${" - ".repeat(70_000)}b` }],
      ["separator runs", { format: "text", content: `18/03/2026 a${"-|•".repeat(70_000)} b` }],
      ["many scores", { format: "text", content: `18/03/2026 – Sarah Reid (PH-DEMO-01)\n${"NPRS 1, ".repeat(30_000)}` }],
      ["blank lines", { format: "text", content: `18/03/2026 – Sarah Reid (PH-DEMO-01)\na${"\n".repeat(200_000)}b` }],
      ["a CSV cell", { format: "csv", content: `Date,Notes\n18/03/2026,"a${PAD}b"\n` }],
      ["a CSV header", { format: "csv", content: `Date${PAD}x,Notes\n18/03/2026,ab\n` }],
      ["a CSV score cell", { format: "csv", content: `Date,Notes,NPRS\n18/03/2026,ab,"5${PAD}/10"\n` }],
    ];
    for (const [label, upload] of cases) await timed(label, () => readNotesUpload(ctx(), upload, { now: NOW }));
    await timed("the documented-format parser", () => parseImport({ format: "text", content: `18/03/2026 x${PAD}y` }, { tenantId: "demo", now: NOW }));
    await timed("splitting a note's sections", () => splitNoteText(`Subjective${PAD}x\nS: a${"\n".repeat(200_000)}b`));
    const r = await review({ format: "text", content: F.PRACTICE_PRINTOUT_TEXT });
    const padded = updateEntry(r, "E-1", { body: `Subjective${PAD}x\n${"\n".repeat(100_000)}Plan${PAD}:` });
    await timed("confirming a padded note", () => bundleFromReview(padded, { tenantId: "demo", now: NOW }));
  });
});

/* ------------------------------------------------------------------------------------------------
 * 6. Per-minute limits on reading uploads (any actor, the public demo included)
 * ----------------------------------------------------------------------------------------------*/

describe("POST /connectors/file-import/read is limited per minute", () => {
  test(`a demo session gets 429 RATE_LIMITED after ${FILE_IMPORT_PER_ACTOR_PER_MINUTE} reads in a minute`, async () => {
    resetMemoryLimits();
    const deps: MedreportDeps = {
      connectors: createConnectorRegistry([createTm3SimConnector(), createFileImportConnector()]),
      createConnectorContext: getMedreportDeps().createConnectorContext,
    };
    const bearer = demoBearer();
    const call = () =>
      bindHandler(handleFileImportRead, () => deps)(
        new Request("http://localhost/api/reports/v1/connectors/file-import/read", {
          method: "POST",
          headers: { "content-type": CONTENT_TYPES.json, authorization: bearer },
          body: JSON.stringify({ format: "text", content: F.EMAIL_NOTES }),
        }),
        { params: {} },
      );
    for (let i = 0; i < FILE_IMPORT_PER_ACTOR_PER_MINUTE; i++) {
      const res = await call();
      assert.equal(res.status, 200, `read ${i + 1}`);
      FileImportReadResponseSchema.parse(await res.json());
    }
    const limited = await call();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    const problem = ProblemSchema.parse(await limited.json());
    assert.equal(problem.code, "RATE_LIMITED");
    assert.ok(!hasBannedTerm(`${problem.title} ${problem.detail ?? ""}`));
    resetMemoryLimits();
  });
});

/* ------------------------------------------------------------------------------------------------
 * 7. The record: consent for uploads, short dates, the drafting minimiser
 * ----------------------------------------------------------------------------------------------*/

describe("the record built from uploaded notes", () => {
  test("missing consent: a plain message for uploads, recorded on the report by the approver, kept in its activity", async () => {
    const r = markOthersAttended(await review({ format: "pdf", content: b64(await F.buildClinicalNotesReportPdf()) }));
    const built = bundleFromReview(r, { tenantId: "demo", now: NOW });
    if (!built.ok) return assert.fail(JSON.stringify(built.issues));
    const check = runDataChecks(built.bundle).find((c) => c.code === "CONSENT_NOT_RECORDED");
    assert.match(check?.message ?? "", /^The uploaded notes do not show the patient's consent .* record it here \(Record consent\) before the report is approved\.$/);
    const report = createReport({ template: SOLICITOR_RTA_TEMPLATE, bundle: built.bundle, instructingParty: built.bundle.referral, computedFacts: computeFacts(built.bundle) });
    assert.ok(canRecordConsent(report));
    assert.equal(recordConsent(report, "2099-01-01", "Amara Okafor"), report, "never a date in the future");
    const recorded = recordConsent(report, "2026-10-09", "Amara Okafor");
    assert.deepEqual(recorded.bundleSnapshot.consent, { disclosureConsentRecorded: true, date: "2026-10-09" });
    assert.ok(!runDataChecks(recorded.bundleSnapshot).some((c) => c.code === "CONSENT_NOT_RECORDED"));
    const last = recorded.activity[recorded.activity.length - 1];
    assert.deepEqual([last.action, last.actor], ["consent_recorded", "Amara Okafor"]);
    assert.match(last.detail, /given on 09\/10\/2026 \(the uploaded notes did not record it\)/);
    assert.ok(!canRecordConsent(recorded));
    // A report from a clinic system is never changed this way.
    const other = { ...report, bundleSnapshot: { ...report.bundleSnapshot, source: { ...report.bundleSnapshot.source, connectorId: "tm3-sim" as const } } };
    assert.equal(recordConsent(other, "2026-10-09", "Amara Okafor"), other);
  });

  test("a note's short dates support the drafted full date; pain scores and shorthand never do", () => {
    const idx = addShortDatesToIndex(addToFigureIndex(emptyFigureIndex(), "SMS reminder had been sent 26/08. Pain 7/10. Review 6/52, 3/12. Keep appointment 07/10."), "SMS reminder had been sent 26/08. Pain 7/10. Review 6/52, 3/12. Keep appointment 07/10.", "2026-08-27");
    const date = (iso: string) => figureInIndex({ kind: "date", key: iso, raw: iso, index: 0 }, idx);
    assert.ok(date("2026-08-26"));
    assert.ok(date("2026-10-07"), "two digits on both sides: a date");
    assert.ok(!date("2026-10-07".replace("07", "08")));
    const pain = addShortDatesToIndex(emptyFigureIndex(), "Pain 7/10, review 3/12", "2026-08-27");
    assert.equal(pain.dates.size, 0);
    // A short date late in the year in a January note is last year's.
    const jan = addShortDatesToIndex(emptyFigureIndex(), "Seen 28/12 out of hours.", "2026-01-05");
    assert.ok(jan.dates.has("2025-12-28"));
  });

  test("the drafting minimiser masks a first name with a middle name, the first name alone and the clinic's patient number", () => {
    const minimise = createMinimiser({
      title: "Mr",
      firstName: "Rowan Lewis",
      lastName: "Tate",
      fullName: "Rowan Lewis Tate",
      dob: "1983-11-22",
    } as Parameters<typeof createMinimiser>[0]);
    const out = minimise("Patient: Rowan Tate (AP-004127). Rowan reports less pain. Policy NFA-88213407. Lewis is his middle name.");
    assert.doesNotMatch(out, /Rowan|Tate|Lewis|AP-004127|NFA-88213407/);
    assert.match(out, /\[ID\]/);
  });

  test("every new message is neutral", async () => {
    const messages: string[] = [];
    for (const upload of [
      { format: "pdf" as const, content: b64(await F.buildClinicalNotesReportPdf()) },
      { format: "csv" as const, content: F.bookingCsv() },
      { format: "docx" as const, content: b64(await F.buildProgressLetterDocx()) },
      { format: "text" as const, content: F.WRAPPED_RANGES_NOTES },
    ]) {
      const r = await review(upload);
      messages.push(...r.warnings.map((w) => w.message), ...Object.values(r.fieldNotes ?? {}).map(String));
      const notice = attendanceNotice(r);
      if (notice) messages.push(notice.text);
    }
    assert.ok(messages.length >= 8);
    assert.deepEqual(messages.filter(hasBannedTerm), []);
    assert.ok(reviewAttendance({ entries: [] }).on === false);
  });
});
