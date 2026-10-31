/**
 * One row of an import file → the record it will become, with its problems. Pure: no lookups here (which patient
 * a reference points at is resolve.ts, with the clinic's data the server reads).
 *
 * Rules: required values must be readable (else an error); optional values that cannot be read are left blank
 * with a warning – an import never invents a value. Text longer than the record allows is shortened (warning).
 */
import { isPlausiblePhone } from "../core/text";
import type { PayerType } from "../core/types";
import { IMPORT_KIND_INFO, type ImportField, type ImportKind } from "./import-kinds";
import { issue, type RowIssue } from "./issues";
import type { ImportMapping } from "./mapping";
import {
  matchKey,
  minutesBetween,
  readDate,
  readEmail,
  readInt,
  readLongText,
  readMoneyPence,
  readPostcode,
  readSex,
  readText,
  readTime,
  readYesNo,
  splitFullName,
  splitTitle,
  type ImportSex,
} from "./values";

/* ------------------------------------------------------------------------------------------------
 * Status words
 * ----------------------------------------------------------------------------------------------*/

export type ImportPatientStatus = "active" | "archived" | "deceased";
export type ImportCaseStatus = "open" | "discharged" | "closed";
export type ImportAppointmentStatus = "attended" | "did_not_attend" | "late_cancellation" | "cancelled" | "booked";
export type ImportInvoiceStatus = "paid" | "part_paid" | "unpaid" | "written_off" | "void";

function lookupWord<T extends string>(raw: string | null, table: Record<string, T>): T | null | undefined {
  if (raw === null) return undefined;
  const k = matchKey(raw);
  if (!k) return undefined;
  return table[k] ?? null;
}

const PATIENT_STATUS: Record<string, ImportPatientStatus> = {
  active: "active",
  current: "active",
  yes: "active",
  y: "active",
  live: "active",
  archived: "archived",
  inactive: "archived",
  no: "archived",
  n: "archived",
  left: "archived",
  "not active": "archived",
  deceased: "deceased",
  died: "deceased",
  dead: "deceased",
};

const CASE_STATUS: Record<string, ImportCaseStatus> = {
  open: "open",
  active: "open",
  current: "open",
  ongoing: "open",
  "in progress": "open",
  discharged: "discharged",
  complete: "discharged",
  completed: "discharged",
  finished: "discharged",
  closed: "closed",
  cancelled: "closed",
  canceled: "closed",
  archived: "closed",
};

const PAYER_WORDS: Record<string, PayerType> = {
  "self pay": "self_pay",
  selfpay: "self_pay",
  self: "self_pay",
  private: "self_pay",
  patient: "self_pay",
  "self funded": "self_pay",
  insurance: "insurer",
  insurer: "insurer",
  insured: "insurer",
  pmi: "insurer",
  "private medical insurance": "insurer",
  "health insurance": "insurer",
  "medico legal": "mlc",
  medicolegal: "mlc",
  mlc: "mlc",
  "medical reporting": "mlc",
  "medical reporting agency": "mlc",
  agency: "mlc",
  legal: "mlc",
  solicitor: "solicitor",
  solicitors: "solicitor",
  "law firm": "solicitor",
  employer: "employer",
  company: "employer",
  corporate: "employer",
  "occupational health": "employer",
  other: "other",
  nhs: "other",
  charity: "other",
};

const APPOINTMENT_STATUS: Record<string, ImportAppointmentStatus> = {
  attended: "attended",
  arrived: "attended",
  completed: "attended",
  complete: "attended",
  seen: "attended",
  att: "attended",
  yes: "attended",
  dna: "did_not_attend",
  "did not attend": "did_not_attend",
  "didnt attend": "did_not_attend",
  "did not arrive": "did_not_attend",
  "no show": "did_not_attend",
  noshow: "did_not_attend",
  failed: "did_not_attend",
  "failed to attend": "did_not_attend",
  lcn: "late_cancellation",
  "late cancellation": "late_cancellation",
  "late cancel": "late_cancellation",
  "late cancelled": "late_cancellation",
  "short notice cancellation": "late_cancellation",
  cancelled: "cancelled",
  canceled: "cancelled",
  cnc: "cancelled",
  cancellation: "cancelled",
  "cancelled with notice": "cancelled",
  booked: "booked",
  confirmed: "booked",
  pending: "booked",
  scheduled: "booked",
  future: "booked",
  unconfirmed: "booked",
};

const INVOICE_STATUS: Record<string, ImportInvoiceStatus> = {
  paid: "paid",
  settled: "paid",
  "paid in full": "paid",
  "part paid": "part_paid",
  "partly paid": "part_paid",
  "partially paid": "part_paid",
  "part payment": "part_paid",
  unpaid: "unpaid",
  outstanding: "unpaid",
  open: "unpaid",
  due: "unpaid",
  overdue: "unpaid",
  issued: "unpaid",
  "written off": "written_off",
  "write off": "written_off",
  "bad debt": "written_off",
  void: "void",
  voided: "void",
  cancelled: "void",
  canceled: "void",
  credited: "void",
};

/** "Insurance" → insurer… (null when the word is not one of the usual ones). */
export function readPayerType(raw: string | null | undefined): PayerType | null {
  const v = lookupWord(typeof raw === "string" ? raw : null, PAYER_WORDS);
  return v ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Records
 * ----------------------------------------------------------------------------------------------*/

export interface PatientImportRecord {
  ref: string;
  title: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  sex: ImportSex | null;
  email: string | null;
  phoneMobile: string | null;
  phoneHome: string | null;
  phoneWork: string | null;
  address: string[] | null;
  postcode: string | null;
  occupation: string | null;
  employer: string | null;
  gpName: string | null;
  gpPractice: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelationship: string | null;
  reminderSms: boolean | null;
  reminderEmail: boolean | null;
  marketingEmail: boolean;
  marketingSms: boolean;
  alerts: string | null;
  notes: string | null;
  status: ImportPatientStatus;
}

export interface CaseImportRecord {
  ref: string;
  patientRef: string;
  title: string;
  openedOn: string;
  closedOn: string | null;
  status: ImportCaseStatus;
  payerType: PayerType | null;
  payerName: string | null;
  membershipNumber: string | null;
  claimReference: string | null;
  authorisation: { code: string; sessionsAuthorised: number | null; sessionsUsed: number; expiresOn: string | null } | null;
  excessPence: number | null;
  referrerName: string | null;
  referralReceivedOn: string | null;
  injuryOn: string | null;
  referralReason: string | null;
  practitionerName: string | null;
  siteName: string | null;
  notes: string | null;
}

export interface AppointmentImportRecord {
  ref: string;
  patientRef: string;
  caseRef: string | null;
  date: string;
  startTime: string;
  /** From the length, the end time, or (null) the appointment type – resolve.ts fills it in. */
  durationMinutes: number | null;
  practitionerName: string;
  siteName: string | null;
  roomName: string | null;
  serviceName: string | null;
  /** null = not given: attended for a past date, booked for a future one (resolve.ts). */
  status: ImportAppointmentStatus | null;
  cancellationReason: string | null;
  chargePence: number | null;
  notes: string | null;
}

export interface InvoiceImportRecord {
  ref: string;
  patientRef: string;
  caseRef: string | null;
  issuedOn: string;
  dueOn: string | null;
  payerType: PayerType | null;
  payerName: string | null;
  totalPence: number;
  paidPence: number;
  balancePence: number;
  description: string | null;
  status: ImportInvoiceStatus;
}

export type ImportRecordOf<K extends ImportKind> = K extends "patients"
  ? PatientImportRecord
  : K extends "cases"
    ? CaseImportRecord
    : K extends "appointments"
      ? AppointmentImportRecord
      : InvoiceImportRecord;

export type AnyImportRecord = PatientImportRecord | CaseImportRecord | AppointmentImportRecord | InvoiceImportRecord;

export interface ReadRowResult<R> {
  /** null when the row has an error that leaves nothing to import. */
  record: R | null;
  /** The earlier system's reference of the row (for duplicates and links), when it has one. */
  ref: string | null;
  issues: RowIssue[];
}

/* ------------------------------------------------------------------------------------------------
 * Reading cells
 * ----------------------------------------------------------------------------------------------*/

class Cells {
  readonly issues: RowIssue[] = [];
  constructor(
    private readonly kind: ImportKind,
    private readonly cells: readonly string[],
    private readonly mapping: ImportMapping,
  ) {}

  private field(key: string): ImportField {
    const f = IMPORT_KIND_INFO[this.kind].fields.find((x) => x.key === key);
    if (!f) throw new Error(`Unknown import field ${this.kind}.${key}`);
    return f;
  }

  /** The raw cell for a field ("" when the field is not mapped or the cell is empty). */
  raw(key: string): string {
    const col = this.mapping[key];
    if (col === null || col === undefined) return "";
    return (this.cells[col] ?? "").trim();
  }

  has(key: string): boolean {
    return this.raw(key) !== "";
  }

  text(key: string, required = false): string | null {
    const f = this.field(key);
    const raw = this.raw(key);
    const max = f.max ?? 200;
    const value = f.type === "longtext" ? readLongText(raw, Number.MAX_SAFE_INTEGER) : readText(raw, Number.MAX_SAFE_INTEGER);
    if (value === null) {
      if (required) this.issues.push(issue("REQUIRED", "error", key));
      return null;
    }
    if (value.length > max) {
      this.issues.push(issue("SHORTENED", "warning", key));
      return value.slice(0, max).trim();
    }
    return value;
  }

  date(key: string, required = false): string | null {
    const raw = this.raw(key);
    if (!raw) {
      if (required) this.issues.push(issue("REQUIRED", "error", key));
      return null;
    }
    const v = readDate(raw);
    if (!v) this.issues.push(issue("INVALID_DATE", required ? "error" : "warning", key));
    return v;
  }

  time(key: string): { value: string | null; given: boolean } {
    const raw = this.raw(key);
    if (!raw) return { value: null, given: false };
    const v = readTime(raw);
    if (!v) this.issues.push(issue("INVALID_TIME", "error", key));
    return { value: v, given: true };
  }

  money(key: string, required = false): number | null {
    const raw = this.raw(key);
    if (!raw) {
      if (required) this.issues.push(issue("REQUIRED", "error", key));
      return null;
    }
    const v = readMoneyPence(raw);
    if (v === null) this.issues.push(issue("INVALID_MONEY", required ? "error" : "warning", key));
    return v;
  }

  int(key: string, min: number, max: number): number | null {
    const raw = this.raw(key);
    if (!raw) return null;
    const v = readInt(raw, min, max);
    if (v === null) this.issues.push(issue("INVALID_NUMBER", "warning", key));
    return v;
  }

  yesNo(key: string): boolean | null {
    const raw = this.raw(key);
    if (!raw) return null;
    const v = readYesNo(raw);
    if (v === null) this.issues.push(issue("INVALID_VALUE", "warning", key));
    return v;
  }

  email(key: string): string | null {
    const raw = this.raw(key);
    if (!raw) return null;
    const v = readEmail(raw);
    if (!v) this.issues.push(issue("INVALID_EMAIL", "warning", key));
    return v;
  }

  phone(key: string): string | null {
    const raw = this.raw(key).replace(/\s+/g, " ");
    if (!raw) return null;
    if (!isPlausiblePhone(raw)) {
      this.issues.push(issue("INVALID_PHONE", "warning", key));
      return null;
    }
    return raw;
  }

  postcode(key: string): string | null {
    const raw = this.raw(key);
    if (!raw) return null;
    const v = readPostcode(raw);
    if (!v) this.issues.push(issue("INVALID_POSTCODE", "warning", key));
    return v;
  }

  /** A status/enum word: undefined when blank, the fallback (warning) when not recognised. */
  word<T extends string>(key: string, table: Record<string, T>): T | undefined | "unrecognised" {
    const raw = this.raw(key);
    if (!raw) return undefined;
    const v = lookupWord(raw, table);
    if (v === null || v === undefined) {
      this.issues.push(issue("INVALID_VALUE", "warning", key));
      return "unrecognised";
    }
    return v;
  }
}

function known<T extends string>(v: T | undefined | "unrecognised"): T | undefined {
  return v === "unrecognised" ? undefined : v;
}

/* ------------------------------------------------------------------------------------------------
 * Per kind
 * ----------------------------------------------------------------------------------------------*/

export function readPatientRow(cells: readonly string[], mapping: ImportMapping, today: string): ReadRowResult<PatientImportRecord> {
  const c = new Cells("patients", cells, mapping);
  const ref = c.text("ref", true);
  let title = c.text("title");
  let firstName = c.text("firstName");
  let lastName = c.text("lastName");
  if ((!firstName || !lastName) && c.has("fullName")) {
    const split = splitFullName(c.raw("fullName"));
    if (split) {
      firstName = firstName ?? split.firstName.slice(0, 80);
      lastName = lastName ?? split.lastName.slice(0, 80);
      title = title ?? split.title;
      c.issues.push(issue("NAME_SPLIT", "warning", "fullName"));
    }
  } else if (firstName && !title) {
    // "Mrs Megan" in a first-name column.
    const t = splitTitle(firstName);
    if (t.title && t.rest) {
      title = t.title;
      firstName = t.rest;
    }
  }
  if (!firstName) c.issues.push(issue("REQUIRED", "error", mapping.firstName !== null && mapping.firstName !== undefined ? "firstName" : "fullName"));
  if (!lastName) c.issues.push(issue("REQUIRED", "error", mapping.lastName !== null && mapping.lastName !== undefined ? "lastName" : "fullName"));
  let dateOfBirth = c.date("dateOfBirth");
  if (dateOfBirth && (dateOfBirth > today || dateOfBirth < "1900-01-01")) {
    c.issues.push(issue("DATE_OF_BIRTH_RANGE", "warning", "dateOfBirth"));
    dateOfBirth = null;
  }
  const sexRaw = c.raw("sex");
  const sex = sexRaw ? readSex(sexRaw) : null;
  if (sexRaw && !sex) c.issues.push(issue("INVALID_VALUE", "warning", "sex"));
  const address = ["address1", "address2", "address3", "town", "county"].map((k) => c.text(k)).filter((l): l is string => Boolean(l));
  const marketingEmail = c.yesNo("marketingEmail") === true;
  const marketingSms = c.yesNo("marketingSms") === true;
  if (marketingEmail || marketingSms) c.issues.push(issue("MARKETING_IMPORTED", "warning", marketingEmail ? "marketingEmail" : "marketingSms"));
  // Every value is read (and its problems noted) before deciding whether the row can be imported.
  const values = {
    preferredName: c.text("preferredName"),
    email: c.email("email"),
    phoneMobile: c.phone("phoneMobile"),
    phoneHome: c.phone("phoneHome"),
    phoneWork: c.phone("phoneWork"),
    postcode: c.postcode("postcode"),
    occupation: c.text("occupation"),
    employer: c.text("employer"),
    gpName: c.text("gpName"),
    gpPractice: c.text("gpPractice"),
    emergencyName: c.text("emergencyName"),
    emergencyPhone: c.phone("emergencyPhone"),
    emergencyRelationship: c.text("emergencyRelationship"),
    reminderSms: c.yesNo("reminderSms"),
    reminderEmail: c.yesNo("reminderEmail"),
    alerts: c.text("alerts"),
    notes: c.text("notes"),
    status: known(c.word("status", PATIENT_STATUS)) ?? "active",
  };
  const record: PatientImportRecord | null =
    ref && firstName && lastName
      ? { ref, title, firstName, lastName, dateOfBirth, sex, address: address.length ? address.slice(0, 6) : null, marketingEmail, marketingSms, ...values }
      : null;
  return { record, ref, issues: c.issues };
}

export function readCaseRow(cells: readonly string[], mapping: ImportMapping): ReadRowResult<CaseImportRecord> {
  const c = new Cells("cases", cells, mapping);
  const ref = c.text("ref", true);
  const patientRef = c.text("patientRef", true);
  const title = c.text("title") ?? "Case from the earlier system";
  const openedOn = c.date("openedOn", true);
  let closedOn = c.date("closedOn");
  if (openedOn && closedOn && closedOn < openedOn) {
    c.issues.push(issue("ENDS_BEFORE_START", "warning", "closedOn"));
    closedOn = null;
  }
  const statusWord = known(c.word("status", CASE_STATUS));
  const status: ImportCaseStatus = statusWord ?? (closedOn ? "discharged" : "open");
  const payerTypeWord = known(c.word("payerType", PAYER_WORDS));
  const payerName = c.text("payerName");
  const payerType: PayerType | null = payerTypeWord ?? null;
  const code = c.text("authorisationCode");
  const sessionsAuthorised = c.int("sessionsAuthorised", 0, 999);
  const sessionsUsed = c.int("sessionsUsed", 0, 999);
  const authorisationExpiresOn = c.date("authorisationExpiresOn");
  if (!code && (sessionsAuthorised !== null || sessionsUsed !== null || authorisationExpiresOn)) c.issues.push(issue("AUTHORISATION_INCOMPLETE", "warning", "authorisationCode"));
  const excess = c.money("excess");
  if (code && sessionsAuthorised !== null && sessionsUsed !== null && sessionsUsed > sessionsAuthorised) c.issues.push(issue("USED_OVER_AUTHORISED", "warning", "sessionsUsed"));
  const values = {
    membershipNumber: c.text("membershipNumber"),
    claimReference: c.text("claimReference"),
    referrerName: c.text("referrerName"),
    referralReceivedOn: c.date("referralReceivedOn"),
    injuryOn: c.date("injuryOn"),
    referralReason: c.text("referralReason"),
    practitionerName: c.text("practitionerName"),
    siteName: c.text("siteName"),
    notes: c.text("notes"),
  };
  const record: CaseImportRecord | null =
    ref && patientRef && openedOn
      ? {
          ref,
          patientRef,
          title,
          openedOn,
          closedOn: status === "open" ? null : closedOn,
          status,
          payerType,
          payerName,
          authorisation: code
            ? {
                code,
                sessionsAuthorised,
                // Never more used than authorised (the record refuses it).
                sessionsUsed: Math.min(sessionsUsed ?? 0, sessionsAuthorised ?? Number.MAX_SAFE_INTEGER),
                expiresOn: authorisationExpiresOn,
              }
            : null,
          excessPence: excess !== null && excess >= 0 ? excess : null,
          ...values,
        }
      : null;
  return { record, ref, issues: c.issues };
}

export function readAppointmentRow(cells: readonly string[], mapping: ImportMapping): ReadRowResult<AppointmentImportRecord> {
  const c = new Cells("appointments", cells, mapping);
  const ref = c.text("ref", true);
  const patientRef = c.text("patientRef", true);
  const date = c.date("date", true);
  const start = c.time("startTime");
  // No start column (or it is blank): the time may be in the date column ("03/04/2026 09:30").
  const startTime = start.value ?? (start.given ? null : readTime(c.raw("date")));
  if (!start.given && !startTime) c.issues.push(issue("REQUIRED", "error", "startTime"));
  const end = c.time("endTime");
  let durationMinutes = c.int("durationMinutes", 5, 480);
  if (durationMinutes === null && startTime && end.value) {
    durationMinutes = minutesBetween(startTime, end.value);
    if (durationMinutes === null) c.issues.push(issue("ENDS_BEFORE_START", "error", "endTime"));
  }
  const practitionerName = c.text("practitionerName", true);
  const status = known(c.word("status", APPOINTMENT_STATUS)) ?? null;
  const charge = c.money("charge");
  const values = {
    caseRef: c.text("caseRef"),
    siteName: c.text("siteName"),
    roomName: c.text("roomName"),
    serviceName: c.text("serviceName"),
    cancellationReason: c.text("cancellationReason"),
    notes: c.text("notes"),
  };
  const record: AppointmentImportRecord | null =
    ref && patientRef && date && startTime && practitionerName && !c.issues.some((i) => i.severity === "error")
      ? { ref, patientRef, date, startTime, durationMinutes, practitionerName, status, chargePence: charge !== null && charge >= 0 ? charge : null, ...values }
      : null;
  return { record, ref, issues: c.issues };
}

export function readInvoiceRow(cells: readonly string[], mapping: ImportMapping): ReadRowResult<InvoiceImportRecord> {
  const c = new Cells("invoices", cells, mapping);
  const ref = c.text("ref", true);
  const patientRef = c.text("patientRef", true);
  const issuedOn = c.date("issuedOn", true);
  const dueOn = c.date("dueOn");
  const total = c.money("total", true);
  const paidRaw = c.money("paid");
  const balanceRaw = c.money("balance");
  const paid = paidRaw ?? (total !== null && balanceRaw !== null ? total - balanceRaw : 0);
  let balance = balanceRaw ?? (total !== null ? total - paid : 0);
  if (total !== null && balanceRaw !== null && paidRaw !== null && total - paidRaw !== balanceRaw) c.issues.push(issue("BALANCE_MISMATCH", "warning", "balance"));
  const statusWord = known(c.word("status", INVOICE_STATUS));
  const status: ImportInvoiceStatus = statusWord ?? (balance <= 0 ? "paid" : paid > 0 ? "part_paid" : "unpaid");
  // A void or written-off invoice is owed by nobody any more.
  if (status === "void" || status === "written_off") balance = 0;
  const values = {
    caseRef: c.text("caseRef"),
    dueOn,
    payerType: known(c.word("payerType", PAYER_WORDS)) ?? null,
    payerName: c.text("payerName"),
    description: c.text("description"),
  };
  const record: InvoiceImportRecord | null =
    ref && patientRef && issuedOn && total !== null ? { ref, patientRef, issuedOn, totalPence: total, paidPence: paid, balancePence: balance, status, ...values } : null;
  return { record, ref, issues: c.issues };
}

/** Reads one row of any kind. */
export function readImportRow(kind: ImportKind, cells: readonly string[], mapping: ImportMapping, today: string): ReadRowResult<AnyImportRecord> {
  switch (kind) {
    case "patients":
      return readPatientRow(cells, mapping, today);
    case "cases":
      return readCaseRow(cells, mapping);
    case "appointments":
      return readAppointmentRow(cells, mapping);
    case "invoices":
      return readInvoiceRow(cells, mapping);
  }
}
