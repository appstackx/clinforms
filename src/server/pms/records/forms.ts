/**
 * Form fields → the shared record's inputs (server actions of the records module). Field names are the schemas'
 * own keys, so the schemas' field errors land next to the right box. Check boxes send "on"; empty boxes clear a
 * value (the schemas turn "" into null).
 */
import "server-only";
import { addressLines, poundsToPence, wholeNumber } from "../../../modules/pms/records/form-values";
import type { AuthorisationInput, CaseInput, PatientInput } from "../../../modules/pms/core/schemas";

export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export function optional(form: FormData, name: string): string | null {
  const v = text(form, name).trim();
  return v === "" ? null : v;
}

export function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on";
}

export function intField(form: FormData, name: string): number {
  const n = Number(text(form, name));
  return Number.isInteger(n) ? n : Number.NaN;
}

const PATIENT_TEXT = [
  "title",
  "firstName",
  "lastName",
  "preferredName",
  "dateOfBirth",
  "email",
  "phoneMobile",
  "phoneHome",
  "phoneWork",
  "postcode",
  "occupation",
  "employer",
  "emergencyName",
  "emergencyPhone",
  "emergencyRelationship",
  "gpName",
  "gpPractice",
  "gpPhone",
  "gpPostcode",
  "alerts",
  "notes",
] as const;

const PATIENT_FLAGS = ["consentTreatment", "consentShareGp", "reminderSms", "reminderEmail", "marketingEmail", "marketingSms"] as const;

/** Every field of the patient form (create and edit send the whole form). */
export function patientInputFromForm(form: FormData): PatientInput {
  const out: Record<string, unknown> = {};
  for (const name of PATIENT_TEXT) out[name] = text(form, name);
  // The design's date of birth is typed as DD/MM/YYYY; the record stores YYYY-MM-DD.
  const dob = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(out.dateOfBirth ?? "").trim());
  if (dob) out.dateOfBirth = `${dob[3]}-${dob[2].padStart(2, "0")}-${dob[1].padStart(2, "0")}`;
  for (const name of PATIENT_FLAGS) out[name] = checked(form, name);
  const sex = text(form, "sex");
  out.sex = sex === "" ? null : sex;
  const source = text(form, "marketingConsentSource");
  out.marketingConsentSource = source === "" ? null : source;
  out.address = addressLines(text(form, "address"));
  out.gpAddress = addressLines(text(form, "gpAddress"));
  return out as PatientInput;
}

const id = (form: FormData, name: string) => optional(form, name);

export function caseInputFromForm(form: FormData, patientId: string): CaseInput {
  return {
    patientId,
    title: text(form, "title"),
    status: (optional(form, "status") ?? undefined) as CaseInput["status"],
    openedOn: text(form, "openedOn"),
    closedOn: text(form, "closedOn"),
    practitionerId: id(form, "practitionerId"),
    siteId: id(form, "siteId"),
    payerType: (optional(form, "payerType") ?? "self_pay") as CaseInput["payerType"],
    payerReferrerId: id(form, "payerReferrerId"),
    membershipNumber: text(form, "membershipNumber"),
    claimReference: text(form, "claimReference"),
    excessPence: poundsToPence(text(form, "excess")),
    priceListId: id(form, "priceListId"),
    referrerId: id(form, "referrerId"),
    referralReceivedOn: text(form, "referralReceivedOn"),
    injuryOn: text(form, "injuryOn"),
    referralReason: text(form, "referralReason"),
    notes: text(form, "notes"),
  };
}

export function authorisationInputFromForm(form: FormData, caseId: string): AuthorisationInput {
  return {
    caseId,
    referrerId: id(form, "referrerId"),
    code: text(form, "code"),
    sessionsAuthorised: wholeNumber(text(form, "sessionsAuthorised")),
    valueAuthorisedPence: poundsToPence(text(form, "valueAuthorised")),
    validFrom: text(form, "validFrom"),
    expiresOn: text(form, "expiresOn"),
    notes: text(form, "notes"),
  };
}

/** Field errors keyed by the form's own names (money boxes are named in pounds). */
export function renameErrors(errors: Record<string, string>, renames: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) out[renames[k] ?? k] = v;
  return out;
}
