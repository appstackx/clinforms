/** Pure rules of data import (src/modules/pms/integration): CSV, values, mapping, rows, resolving, statuses. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsvError, detectDelimiter, parseCsv, toCsv } from "./csv";
import { IMPORT_KINDS, IMPORT_KIND_INFO, templateHeaders } from "./import-kinds";
import { canDo, cleanCounts, describeCounts, emptyCounts, sampleRowNumbers, stepOf } from "./import-status";
import { cleanIssues, hasError, issueMessage, ISSUE_CODES } from "./issues";
import { cleanMapping, suggestMapping, validateMapping, type ImportMapping } from "./mapping";
import { findPractitioner, findSite, guessPayerType, nameKey, resolveAppointment, resolveCase, resolveInvoice, resolvePatient, type ImportLookups } from "./resolve";
import { readAppointmentRow, readCaseRow, readInvoiceRow, readPatientRow } from "./rows";
import { matchKey, readDate, readEmail, readMoneyPence, readSex, readTime, readYesNo, splitFullName } from "./values";

describe("CSV", () => {
  it("reads quotes, doubled quotes, line breaks inside quotes, CRLF and a byte-order mark", () => {
    const t = parseCsv('﻿Patient ID,Name,Notes\r\n1,"Hart, Megan","Line one\nline ""two"""\r\n2,Daniel Brooks,\r\n\r\n');
    assert.deepEqual(t.headers, ["Patient ID", "Name", "Notes"]);
    assert.deepEqual(t.rows, [
      ["1", "Hart, Megan", 'Line one\nline "two"'],
      ["2", "Daniel Brooks", ""],
    ]);
    assert.equal(t.delimiter, ",");
  });
  it("detects semicolons and tabs; pads short rows; refuses rows that do not line up", () => {
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
    assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
    assert.equal(detectDelimiter('"a,b";c;d\n'), ";");
    assert.deepEqual(parseCsv("a;b;c\n1;2").rows, [["1", "2", ""]]);
    assert.deepEqual(parseCsv("a,b\n1,2,,\n").rows, [["1", "2"]], "trailing empty cells are fine");
    assert.throws(() => parseCsv("a,b\n1,2,3\n"), (e: unknown) => e instanceof CsvError && e.code === "ROW_TOO_LONG" && e.line === 2);
  });
  it("refuses an empty file, duplicate column names, an unclosed quote and oversized input", () => {
    assert.throws(() => parseCsv("  \n"), (e: unknown) => e instanceof CsvError && e.code === "EMPTY");
    assert.throws(() => parseCsv("Name,name\n1,2"), (e: unknown) => e instanceof CsvError && e.code === "DUPLICATE_HEADER");
    assert.throws(() => parseCsv('a,b\n1,"open\n'), (e: unknown) => e instanceof CsvError && e.code === "UNCLOSED_QUOTE");
    assert.throws(() => parseCsv("a\n1\n2\n3", { limits: { maxRows: 2 } }), (e: unknown) => e instanceof CsvError && e.code === "TOO_MANY_ROWS");
    assert.throws(() => parseCsv("a,b,c", { limits: { maxColumns: 2 } }), (e: unknown) => e instanceof CsvError && e.code === "TOO_MANY_COLUMNS");
    assert.throws(() => parseCsv(`a\n${"x".repeat(20)}`, { limits: { maxFieldLength: 10 } }), (e: unknown) => e instanceof CsvError && e.code === "FIELD_TOO_LONG");
  });
  it("writes CSV that reads back, and defuses formula-looking values", () => {
    const text = toCsv([
      ["Name", "Note"],
      ["Hart, Megan", 'says "hi"'],
      ["=HYPERLINK()", "-12.50"],
    ]);
    assert.deepEqual(parseCsv(text).rows, [
      ["Hart, Megan", 'says "hi"'],
      ["'=HYPERLINK()", "-12.50"],
    ]);
  });
});

describe("values", () => {
  it("dates: UK day first, ISO, month names, 2-digit years, a time after the date; never a wrong guess", () => {
    assert.equal(readDate("03/04/2026"), "2026-04-03");
    assert.equal(readDate("3-4-26"), "2026-04-03");
    assert.equal(readDate("03.04.1986"), "1986-04-03");
    assert.equal(readDate("12/07/55"), "1955-07-12");
    assert.equal(readDate("2026-04-03"), "2026-04-03");
    assert.equal(readDate("2026-04-03T09:30:00"), "2026-04-03");
    assert.equal(readDate("3 Apr 2026"), "2026-04-03");
    assert.equal(readDate("03-April-2026"), "2026-04-03");
    assert.equal(readDate("03/04/2026 09:30"), "2026-04-03");
    for (const bad of ["31/02/2026", "13/13/2026", "2026/04/03x", "April 3rd", "", "3 Foo 2026"]) assert.equal(readDate(bad), null, bad);
  });
  it("times, money, yes/no, sex, email", () => {
    assert.equal(readTime("9:30"), "09:30");
    assert.equal(readTime("0930"), "09:30");
    assert.equal(readTime("2:15 PM"), "14:15");
    assert.equal(readTime("12am"), "00:00");
    assert.equal(readTime("03/04/2026 14:05"), "14:05");
    assert.equal(readTime("9"), null);
    assert.equal(readTime("25:00"), null);
    assert.equal(readMoneyPence("£1,234.50"), 123450);
    assert.equal(readMoneyPence("55"), 5500);
    assert.equal(readMoneyPence("-12.5"), -1250);
    assert.equal(readMoneyPence("(40.00)"), -4000);
    assert.equal(readMoneyPence("GBP 40"), 4000);
    for (const bad of ["12.5.0", "abc", "1.234", "1,23"]) assert.equal(readMoneyPence(bad), null, bad);
    assert.equal(readYesNo("Y"), true);
    assert.equal(readYesNo("opted out"), false);
    assert.equal(readYesNo("maybe"), null);
    assert.equal(readSex("F"), "female");
    assert.equal(readSex("Prefer not to say"), "unknown");
    assert.equal(readSex("q"), null);
    assert.equal(readEmail(" Megan.Hart@Example.com "), "megan.hart@example.com");
    assert.equal(readEmail("not an email"), null);
  });
  it("names: 'Surname, First', titles, one word refused; match keys", () => {
    assert.deepEqual(splitFullName("Hart, Megan"), { title: null, firstName: "Megan", lastName: "Hart" });
    assert.deepEqual(splitFullName("Mrs Megan Jane Hart"), { title: "Mrs", firstName: "Megan Jane", lastName: "Hart" });
    assert.equal(splitFullName("Megan"), null);
    assert.equal(matchKey("  Patient_Surname "), "patient surname");
    assert.equal(nameKey("Bletchley (fictional)"), "bletchley");
  });
});

describe("mapping", () => {
  it("suggests exact matches only, each column once; our own template matches every field", () => {
    const m = suggestMapping("patients", ["Patient ID", "Forename", "Surname", "DOB", "Mobile", "Post Code", "Something else", "Patient Email"]);
    assert.equal(m.ref, 0);
    assert.equal(m.firstName, 1);
    assert.equal(m.lastName, 2);
    assert.equal(m.dateOfBirth, 3);
    assert.equal(m.phoneMobile, 4);
    assert.equal(m.postcode, 5);
    assert.equal(m.email, 7, "\"Patient Email\" matches email with the patient prefix taken off");
    assert.equal(Object.values(m).filter((v) => v === 6).length, 0, "an unknown column is never guessed");
    for (const kind of IMPORT_KINDS) {
      const headers = templateHeaders(kind);
      const t = suggestMapping(kind, headers);
      IMPORT_KIND_INFO[kind].fields.forEach((f, i) => assert.equal(t[f.key], i, `${kind}.${f.key}`));
    }
  });
  it("cases: 'Patient ID' is the patient reference, 'Case ID' the case's own", () => {
    const m = suggestMapping("cases", ["Case ID", "Patient ID", "Start Date", "Insurer"]);
    assert.deepEqual([m.ref, m.patientRef, m.openedOn, m.payerName], [0, 1, 2, 3]);
  });
  it("validates: required fields, a name, one column per field; cleans stored mappings", () => {
    const base: ImportMapping = cleanMapping("patients", { ref: 0, firstName: 1 }, 5);
    assert.deepEqual(
      validateMapping("patients", base).map((p) => p.field),
      ["lastName"],
    );
    assert.deepEqual(validateMapping("patients", { ...base, fullName: 2, firstName: null }), []);
    const dup = validateMapping("patients", { ...base, lastName: 1 });
    assert.ok(dup.some((p) => /Column 2 is chosen for more than one field/.test(p.message)));
    assert.equal(cleanMapping("patients", { ref: 9, firstName: "1", bogus: 2 }, 5).ref, null, "out of range");
    assert.equal(cleanMapping("patients", { firstName: "1" }, 5).firstName, 1);
    assert.equal("bogus" in cleanMapping("patients", { bogus: 2 }, 5), false);
    assert.deepEqual(
      validateMapping("appointments", cleanMapping("appointments", { ref: 0, patientRef: 1, date: 2 }, 5)).map((p) => p.field),
      ["practitionerName"],
    );
  });
});

const TODAY = "2026-10-24";

describe("rows", () => {
  const pm = suggestMapping("patients", templateHeaders("patients"));
  const cells = (kind: (typeof IMPORT_KINDS)[number], values: Record<string, string>) => {
    const headers = templateHeaders(kind);
    return IMPORT_KIND_INFO[kind].fields.map((f) => values[f.key] ?? "").slice(0, headers.length);
  };

  it("a patient row: values read, invalid optional values left blank with warnings, never invented", () => {
    const r = readPatientRow(
      cells("patients", {
        ref: "sim-pat-001",
        title: "",
        firstName: "Mrs Megan",
        lastName: "Hart",
        dateOfBirth: "14/03/1991",
        sex: "F",
        email: "megan.hart@example",
        phoneMobile: "07700 900123",
        phoneHome: "123",
        address1: "4 Willow Bank",
        town: "Milton Keynes",
        postcode: "mk3 9zz",
        marketingEmail: "Y",
        alerts: "Latex allergy",
        status: "inactive",
      }),
      pm,
      TODAY,
    );
    assert.ok(r.record);
    assert.equal(r.record.title, "Mrs");
    assert.equal(r.record.firstName, "Megan");
    assert.equal(r.record.dateOfBirth, "1991-03-14");
    assert.equal(r.record.sex, "female");
    assert.equal(r.record.email, null);
    assert.equal(r.record.phoneMobile, "07700 900123");
    assert.equal(r.record.phoneHome, null);
    assert.deepEqual(r.record.address, ["4 Willow Bank", "Milton Keynes"]);
    assert.equal(r.record.postcode, "MK3 9ZZ");
    assert.equal(r.record.marketingEmail, true);
    assert.equal(r.record.status, "archived");
    assert.deepEqual(
      r.issues.map((i) => `${i.code}:${i.severity}:${i.field}`).sort(),
      ["INVALID_EMAIL:warning:email", "INVALID_PHONE:warning:phoneHome", "MARKETING_IMPORTED:warning:marketingEmail"],
    );
    assert.equal(hasError(r.issues), false);
  });

  it("a patient row without a reference or name, or with a future date of birth", () => {
    const r = readPatientRow(cells("patients", { firstName: "Megan" }), pm, TODAY);
    assert.equal(r.record, null);
    assert.deepEqual(r.issues.map((i) => `${i.code}:${i.field}`), ["REQUIRED:ref", "REQUIRED:lastName"]);
    const f = readPatientRow(cells("patients", { ref: "9", fullName: "Hart, Megan", dateOfBirth: "01/01/2030" }), pm, TODAY);
    assert.equal(f.record?.lastName, "Hart");
    assert.equal(f.record?.dateOfBirth, null);
    assert.deepEqual(f.issues.map((i) => i.code).sort(), ["DATE_OF_BIRTH_RANGE", "NAME_SPLIT"]);
  });

  it("a case row: status from the end date, authorisation, used never above authorised", () => {
    const cm = suggestMapping("cases", templateHeaders("cases"));
    const r = readCaseRow(cells("cases", { ref: "C-1", patientRef: "sim-pat-001", title: "Neck pain", openedOn: "18/03/2026", closedOn: "07/07/2026", payerType: "Insurance", payerName: "Northwell Health Insurance (fictional)", authorisationCode: "NW-1", sessionsAuthorised: "6", sessionsUsed: "8" }), cm);
    assert.ok(r.record);
    assert.equal(r.record.status, "discharged");
    assert.equal(r.record.closedOn, "2026-07-07");
    assert.equal(r.record.payerType, "insurer");
    assert.deepEqual(r.record.authorisation, { code: "NW-1", sessionsAuthorised: 6, sessionsUsed: 6, expiresOn: null });
    assert.deepEqual(r.issues.map((i) => i.code), ["USED_OVER_AUTHORISED"]);
    const bad = readCaseRow(cells("cases", { ref: "C-2", patientRef: "p", openedOn: "not a date" }), cm);
    assert.equal(bad.record, null);
    assert.deepEqual(bad.issues.map((i) => `${i.code}:${i.severity}`), ["INVALID_DATE:error"]);
  });

  it("an appointment row: time from the date column, length from the end time, the end before the start refused", () => {
    const am = suggestMapping("appointments", ["Appointment ID", "Patient ID", "Date", "End Time", "Practitioner", "Status"]);
    const r = readAppointmentRow(["A-1", "sim-pat-001", "03/04/2026 09:30", "10:15", "Sarah Reid", "DNA"], am);
    assert.equal(r.record?.startTime, "09:30");
    assert.equal(r.record?.durationMinutes, 45);
    assert.equal(r.record?.status, "did_not_attend");
    const back = readAppointmentRow(["A-2", "p", "03/04/2026 09:30", "09:00", "Sarah Reid", ""], am);
    assert.equal(back.record, null);
    assert.deepEqual(back.issues.map((i) => i.code), ["ENDS_BEFORE_START"]);
    const noTime = readAppointmentRow(["A-3", "p", "03/04/2026", "", "Sarah Reid", ""], am);
    assert.deepEqual(noTime.issues.map((i) => `${i.code}:${i.field}`), ["REQUIRED:startTime"]);
  });

  it("an invoice row: balance and status worked out, a mismatch noted, void owes nothing", () => {
    const im = suggestMapping("invoices", ["Invoice No", "Patient ID", "Invoice Date", "Total", "Paid", "Balance", "Status"]);
    assert.deepEqual(
      (({ totalPence, paidPence, balancePence, status }) => ({ totalPence, paidPence, balancePence, status }))(readInvoiceRow(["INV-1", "p", "01/09/2026", "70.00", "20", "", ""], im).record!),
      { totalPence: 7000, paidPence: 2000, balancePence: 5000, status: "part_paid" },
    );
    const mism = readInvoiceRow(["INV-2", "p", "01/09/2026", "70.00", "20", "10", ""], im);
    assert.equal(mism.record?.balancePence, 1000);
    assert.deepEqual(mism.issues.map((i) => i.code), ["BALANCE_MISMATCH"]);
    assert.equal(readInvoiceRow(["INV-3", "p", "01/09/2026", "70", "0", "70", "Void"], im).record?.balancePence, 0);
    assert.equal(readInvoiceRow(["INV-4", "p", "01/09/2026", "", "", "", ""], im).record, null);
  });
});

describe("resolving against the clinic's data", () => {
  const lookups: ImportLookups = {
    today: TODAY,
    existingRefs: new Set(["dup-1"]),
    patientsByRef: new Map([
      ["sim-pat-001", "pat_A"],
      ["sim-pat-002", "pat_B"],
    ]),
    casesByRef: new Map([["C-1", { id: "case_A", patientId: "pat_A" }]]),
    practitioners: [
      { id: "prac_1", displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: "site_1", importRef: null },
      { id: "prac_2", displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", defaultSiteId: null, importRef: "T-ELLIS" },
    ],
    sites: [{ id: "site_1", name: "Bletchley (fictional)", code: "BLE", importRef: null }],
    rooms: [{ id: "room_1", siteId: "site_1", name: "Room 1" }],
    services: [{ id: "svc_1", name: "Follow-up", code: "FU", durationMinutes: 30, importRef: null }],
    referrers: [
      { id: "ref_nw", name: "Northwell Health Insurance (fictional)", kind: "insurer" },
      { id: "ref_hp", name: "Harrow & Pike Solicitors (fictional)", kind: "solicitor" },
    ],
  };

  it("finds practitioners, sites and payers by name, number, code or 'Surname, First'", () => {
    assert.equal(findPractitioner(lookups.practitioners, "Reid, Sarah")?.id, "prac_1");
    assert.equal(findPractitioner(lookups.practitioners, "ph-demo-02")?.id, "prac_2");
    assert.equal(findPractitioner(lookups.practitioners, "Sarah Reid (PH-DEMO-01)")?.id, "prac_1");
    assert.equal(findPractitioner(lookups.practitioners, "T-ELLIS")?.id, "prac_2");
    assert.equal(findPractitioner(lookups.practitioners, "Nobody"), null);
    assert.equal(findSite(lookups.sites, "ble")?.id, "site_1");
    assert.equal(findSite(lookups.sites, "Bletchley")?.id, "site_1");
    assert.equal(guessPayerType("Kestrel Healthcare (fictional)"), "insurer");
    assert.equal(guessPayerType("Calder Medico-Legal (fictional)"), "mlc");
    assert.equal(guessPayerType("Fenwick Law (fictional)"), "solicitor");
    assert.equal(guessPayerType("Ashby Freight Ltd"), null);
  });

  it("patients: a reference already in the clinic is skipped", () => {
    const pm = suggestMapping("patients", ["Patient ID", "First name", "Last name"]);
    const dup = resolvePatient(readPatientRow(["dup-1", "A", "B"], pm, TODAY).record!, lookups);
    assert.equal(dup.duplicate, true);
    assert.equal(resolvePatient(readPatientRow(["new-1", "A", "B"], pm, TODAY).record!, lookups).plan?.kind, "patients");
  });

  it("cases: patient required; payer found or added; site from the practitioner", () => {
    const cm = suggestMapping("cases", ["Case ID", "Patient ID", "Start Date", "Insurer", "Referred by", "Practitioner"]);
    const ok = resolveCase(readCaseRow(["C-9", "sim-pat-001", "01/09/2026", "northwell health insurance", "Bletchley Medical Centre (fictional)", "Sarah Reid"], cm).record!, lookups);
    assert.equal(ok.plan?.patientId, "pat_A");
    assert.deepEqual(ok.plan?.payer, { id: "ref_nw" });
    assert.equal(ok.plan?.payerType, "insurer", "the type comes from the matched payer");
    assert.deepEqual(ok.plan?.referrer, { add: { name: "Bletchley Medical Centre (fictional)", kind: "gp" } });
    assert.equal(ok.plan?.siteId, "site_1");
    assert.deepEqual(ok.issues.map((i) => i.code), ["REFERRER_ADDED"]);
    const added = resolveCase(readCaseRow(["C-10", "sim-pat-002", "01/09/2026", "Kestrel Healthcare (fictional)", "", ""], cm).record!, lookups);
    assert.deepEqual(added.plan?.payer, { add: { name: "Kestrel Healthcare (fictional)", kind: "insurer" } });
    const orphan = resolveCase(readCaseRow(["C-11", "nobody", "01/09/2026", "", "", ""], cm).record!, lookups);
    assert.equal(orphan.plan, null);
    assert.deepEqual(orphan.issues.map((i) => `${i.code}:${i.severity}`), ["PATIENT_NOT_FOUND:error"]);
  });

  it("appointments: status from the date when blank, length from the type, other patients' cases refused", () => {
    const am = suggestMapping("appointments", ["Appointment ID", "Patient ID", "Case ID", "Date", "Start Time", "Practitioner", "Appointment type", "Room"]);
    const past = resolveAppointment(readAppointmentRow(["A-1", "sim-pat-001", "C-1", "01/09/2026", "09:00", "Sarah Reid", "FU", "Room 1"], am).record!, lookups);
    assert.equal(past.plan?.status, "attended");
    assert.equal(past.plan?.durationMinutes, 30);
    assert.equal(past.plan?.caseId, "case_A");
    assert.equal(past.plan?.roomId, "room_1");
    const future = resolveAppointment(readAppointmentRow(["A-2", "sim-pat-002", "C-1", "01/11/2026", "09:00", "Sarah Reid", "FU", ""], am).record!, lookups);
    assert.equal(future.plan?.status, "booked");
    assert.equal(future.plan?.caseId, null);
    assert.deepEqual(future.issues.map((i) => i.code), ["CASE_OF_OTHER_PATIENT"]);
    const noLength = resolveAppointment(readAppointmentRow(["A-3", "sim-pat-002", "", "01/11/2026", "09:00", "Tom Ellis", "", ""], am).record!, lookups);
    assert.equal(noLength.plan, null);
    assert.deepEqual(noLength.issues.map((i) => i.code), ["LENGTH_UNKNOWN"]);
  });

  it("invoices: the patient pays unless a payer is named", () => {
    const im = suggestMapping("invoices", ["Invoice No", "Patient ID", "Invoice Date", "Total", "Bill to"]);
    const self = resolveInvoice(readInvoiceRow(["I-1", "sim-pat-001", "01/09/2026", "55", ""], im).record!, lookups);
    assert.deepEqual([self.plan?.payerType, self.plan?.payer], ["self_pay", null]);
    const ins = resolveInvoice(readInvoiceRow(["I-2", "sim-pat-001", "01/09/2026", "55", "Harrow & Pike Solicitors (fictional)"], im).record!, lookups);
    assert.deepEqual([ins.plan?.payerType, ins.plan?.payer], ["solicitor", { id: "ref_hp" }]);
  });
});

describe("issues and statuses", () => {
  it("every issue code has its own words; stored issues are cleaned", () => {
    for (const code of ISSUE_CODES) assert.notEqual(issueMessage("patients", { code, severity: "warning", field: "ref" }), "Check this row.", code);
    assert.deepEqual(cleanIssues([{ code: "REQUIRED", severity: "error", field: "ref" }, { code: "NOPE", severity: "error" }, { code: "REQUIRED", severity: "fatal" }, null]), [
      { code: "REQUIRED", severity: "error", field: "ref" },
    ]);
  });
  it("batch actions follow the status; counts and steps", () => {
    assert.equal(canDo("uploading", "add_rows"), true);
    assert.equal(canDo("checked", "import"), false, "no import without the staff check");
    assert.equal(canDo("approved", "import"), true);
    assert.equal(canDo("imported", "cancel"), false);
    assert.equal(canDo("imported", "undo"), true);
    assert.equal(canDo("undone", "undo"), false);
    assert.equal(stepOf("checked"), 3);
    assert.deepEqual(cleanCounts({ total: 3, ready: -1, errors: "2" }), { ...emptyCounts(3) });
    assert.equal(describeCounts({ ...emptyCounts(10), ready: 7, warnings: 2, errors: 1, duplicates: 2 }, "patients"), "7 ready (2 with warnings), 1 will not be imported, 2 already in the clinic");
  });
  it("the staff-check sample is spread out, stable for a batch and includes the first and last rows", () => {
    const rows = Array.from({ length: 200 }, (_, i) => i + 1);
    const s1 = sampleRowNumbers(rows, "imp_01");
    assert.equal(s1.length, 8);
    assert.deepEqual(sampleRowNumbers(rows, "imp_01"), s1);
    assert.ok(s1.includes(1) && s1.includes(200));
    assert.deepEqual(sampleRowNumbers([4, 5], "imp_01"), [4, 5]);
  });
});
