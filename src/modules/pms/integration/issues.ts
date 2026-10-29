/**
 * Problems found in an import row. Stored with the row as codes and field keys only (never the values – the row's
 * data is encrypted, its issues are not), and turned into plain words here for the check screen. Pure.
 *
 *   error   – the row is not imported (fix the file or the mapping and start again, or import the other rows);
 *   warning – the row is imported with the change described (a value left out, shortened or added).
 */
import { IMPORT_KIND_INFO, type ImportKind } from "./import-kinds";

export const ISSUE_CODES = [
  "REQUIRED",
  "INVALID_DATE",
  "INVALID_TIME",
  "INVALID_MONEY",
  "INVALID_NUMBER",
  "INVALID_EMAIL",
  "INVALID_PHONE",
  "INVALID_POSTCODE",
  "INVALID_VALUE",
  "DATE_OF_BIRTH_RANGE",
  "SHORTENED",
  "NAME_SPLIT",
  "DUPLICATE_IN_FILE",
  "ALREADY_IMPORTED",
  "PATIENT_NOT_FOUND",
  "CASE_NOT_FOUND",
  "CASE_OF_OTHER_PATIENT",
  "PRACTITIONER_NOT_FOUND",
  "SITE_NOT_FOUND",
  "ROOM_NOT_FOUND",
  "SERVICE_NOT_FOUND",
  "PAYER_ADDED",
  "REFERRER_ADDED",
  "ENDS_BEFORE_START",
  "LENGTH_UNKNOWN",
  "BALANCE_MISMATCH",
  "AUTHORISATION_INCOMPLETE",
  "USED_OVER_AUTHORISED",
  "MARKETING_IMPORTED",
  "NOT_WRITTEN",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export type IssueSeverity = "error" | "warning";

export interface RowIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** The field key it is about (null: the whole row). */
  field: string | null;
}

export function issue(code: IssueCode, severity: IssueSeverity, field: string | null = null): RowIssue {
  return { code, severity, field };
}

export function hasError(issues: readonly RowIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Issues from storage: only known codes and severities (anything else is dropped). */
export function cleanIssues(raw: unknown): RowIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is { code: string; severity: string; field?: unknown } => Boolean(i) && typeof i === "object" && typeof (i as { code?: unknown }).code === "string")
    .filter((i) => (ISSUE_CODES as readonly string[]).includes(i.code) && (i.severity === "error" || i.severity === "warning"))
    .map((i) => ({ code: i.code as IssueCode, severity: i.severity as IssueSeverity, field: typeof i.field === "string" ? i.field : null }));
}

function fieldLabel(kind: ImportKind, field: string | null): string {
  if (!field) return "";
  return IMPORT_KIND_INFO[kind].fields.find((f) => f.key === field)?.label ?? field;
}

/** Plain words for one issue (no values – they are shown next to it from the row itself). */
export function issueMessage(kind: ImportKind, i: RowIssue): string {
  const label = fieldLabel(kind, i.field);
  switch (i.code) {
    case "REQUIRED":
      return `${label || "A required value"} is missing.`;
    case "INVALID_DATE":
      return `${label} is not a date that can be read (use DD/MM/YYYY).${i.severity === "warning" ? " Left blank." : ""}`;
    case "INVALID_TIME":
      return `${label} is not a time that can be read (use HH:MM).`;
    case "INVALID_MONEY":
      return `${label} is not an amount that can be read (e.g. 55.00).${i.severity === "warning" ? " Left blank." : ""}`;
    case "INVALID_NUMBER":
      return `${label} is not a whole number.${i.severity === "warning" ? " Left blank." : ""}`;
    case "INVALID_EMAIL":
      return `${label} is not an email address. Left blank.`;
    case "INVALID_PHONE":
      return `${label} is not a UK phone number (or an international one starting with +). Left blank.`;
    case "INVALID_POSTCODE":
      return `${label} is not a UK postcode. Left blank.`;
    case "INVALID_VALUE":
      return `${label} has a value that is not recognised.${i.severity === "warning" ? " The usual value is used instead." : ""}`;
    case "DATE_OF_BIRTH_RANGE":
      return "The date of birth is in the future or before 1900. Left blank.";
    case "SHORTENED":
      return `${label} is longer than the record allows and was shortened.`;
    case "NAME_SPLIT":
      return "The full name was split into a first and a last name – check it.";
    case "DUPLICATE_IN_FILE":
      return "Another row of this file has the same reference. Only the first one is imported.";
    case "ALREADY_IMPORTED":
      return "A record with this reference is already in the clinic. Skipped.";
    case "PATIENT_NOT_FOUND":
      return "No patient with this reference has been imported. Import the patients first.";
    case "CASE_NOT_FOUND":
      return "No case with this reference has been imported. Imported without a case.";
    case "CASE_OF_OTHER_PATIENT":
      return "The case belongs to a different patient. Imported without a case.";
    case "PRACTITIONER_NOT_FOUND":
      return i.severity === "error" ? "The practitioner is not one of the clinic's practitioners. Add them under Set-up first." : "The practitioner is not one of the clinic's practitioners. Left blank.";
    case "SITE_NOT_FOUND":
      return "The site is not one of the clinic's sites. Left blank.";
    case "ROOM_NOT_FOUND":
      return "The room is not one of that site's rooms. Left blank.";
    case "SERVICE_NOT_FOUND":
      return "The appointment type is not one of the clinic's. Left blank.";
    case "PAYER_ADDED":
      return "The payer is not in the clinic's directory yet and will be added.";
    case "REFERRER_ADDED":
      return "The referrer is not in the clinic's directory yet and will be added.";
    case "ENDS_BEFORE_START":
      return `${label || "The end"} is before the start.`;
    case "LENGTH_UNKNOWN":
      return "The length of the appointment is not given and there is no appointment type to take it from.";
    case "BALANCE_MISMATCH":
      return "Total minus paid does not equal the balance. The balance from the file is used.";
    case "AUTHORISATION_INCOMPLETE":
      return "Authorisation details are given without an authorisation code. Left out.";
    case "USED_OVER_AUTHORISED":
      return "More sessions are used than authorised. Counted as all sessions used.";
    case "MARKETING_IMPORTED":
      return "Marketing consent is taken from the earlier system – it is recorded as given there.";
    case "NOT_WRITTEN":
      return "The record could not be written. Run the import again, or check this row.";
    default:
      return "Check this row.";
  }
}
