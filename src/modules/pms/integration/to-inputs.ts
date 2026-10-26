/**
 * Import plans → the shared record's own inputs (src/modules/pms/core/schemas.ts), and the check that the record
 * would accept them – run at the check step, so the import itself never meets a value the record refuses. Pure.
 */
import { AuthorisationInputSchema, CaseInputSchema, patientInputSchema, type AuthorisationInput, type CaseInput, type PatientInput } from "../core/schemas";
import { issue, type RowIssue } from "./issues";
import type { CasePlan, PatientPlan } from "./resolve";

/** The import reference a case's authorisation gets (unique per clinic, like the case's). */
export function authorisationImportRef(caseRef: string): string {
  return `auth:${caseRef}`.slice(0, 80);
}

export function patientInputOf(plan: PatientPlan): PatientInput {
  const r = plan.record;
  const marketing = r.marketingEmail || r.marketingSms;
  return {
    title: r.title,
    firstName: r.firstName,
    lastName: r.lastName,
    preferredName: r.preferredName,
    dateOfBirth: r.dateOfBirth,
    sex: r.sex,
    email: r.email,
    phoneMobile: r.phoneMobile,
    phoneHome: r.phoneHome,
    phoneWork: r.phoneWork,
    address: r.address,
    postcode: r.postcode,
    occupation: r.occupation,
    employer: r.employer,
    emergencyName: r.emergencyName,
    emergencyPhone: r.emergencyPhone,
    emergencyRelationship: r.emergencyRelationship,
    gpName: r.gpName,
    gpPractice: r.gpPractice,
    ...(r.reminderSms === null ? {} : { reminderSms: r.reminderSms }),
    ...(r.reminderEmail === null ? {} : { reminderEmail: r.reminderEmail }),
    marketingEmail: r.marketingEmail,
    marketingSms: r.marketingSms,
    marketingConsentSource: marketing ? "import" : null,
    alerts: r.alerts,
    notes: r.notes,
    importRef: r.ref,
  };
}

export function caseInputOf(plan: CasePlan, ids: { payerReferrerId: string | null; referrerId: string | null }): CaseInput {
  const r = plan.record;
  return {
    patientId: plan.patientId,
    title: r.title,
    status: r.status,
    openedOn: r.openedOn,
    closedOn: r.closedOn,
    practitionerId: plan.practitionerId,
    siteId: plan.siteId,
    payerType: plan.payerType,
    payerReferrerId: plan.payerType === "self_pay" ? null : ids.payerReferrerId,
    membershipNumber: r.membershipNumber,
    claimReference: r.claimReference,
    excessPence: r.excessPence,
    referrerId: ids.referrerId,
    referralReceivedOn: r.referralReceivedOn,
    injuryOn: r.injuryOn,
    referralReason: r.referralReason,
    notes: r.notes,
    importRef: r.ref,
  };
}

export function authorisationInputOf(plan: CasePlan, caseId: string, payerReferrerId: string | null): (AuthorisationInput & { patientId: string; sessionsUsed: number }) | null {
  const a = plan.record.authorisation;
  if (!a) return null;
  return {
    caseId,
    patientId: plan.patientId,
    referrerId: payerReferrerId,
    code: a.code,
    sessionsAuthorised: a.sessionsAuthorised,
    sessionsUsed: a.sessionsUsed,
    expiresOn: a.expiresOn,
    importRef: authorisationImportRef(plan.record.ref),
  };
}

/** Field of an import kind that a record field comes from (for the issue shown when the record refuses a value). */
const PATIENT_FIELD_OF: Record<string, string> = { address: "address1", marketingConsentSource: "marketingEmail", importRef: "ref" };
const CASE_FIELD_OF: Record<string, string> = { importRef: "ref", payerReferrerId: "payerName", referrerId: "referrerName", patientId: "patientRef", practitionerId: "practitionerName", siteId: "siteName", excessPence: "excess" };

function refused(path: PropertyKey[], fallback: string, map: Record<string, string>): RowIssue {
  const first = typeof path[0] === "string" ? path[0] : "";
  return issue("INVALID_VALUE", "error", map[first] ?? (first || fallback));
}

/** Problems the shared record would refuse for a patient plan (none in normal use – a backstop). */
export function patientRecordIssues(plan: PatientPlan, today: string): RowIssue[] {
  const result = patientInputSchema(today).safeParse(patientInputOf(plan));
  return result.success ? [] : result.error.issues.slice(0, 3).map((i) => refused(i.path, "ref", PATIENT_FIELD_OF));
}

/** Problems the shared record would refuse for a case plan (directory ids not made yet are stood in for). */
export function caseRecordIssues(plan: CasePlan): RowIssue[] {
  const stand = "ref_00000000000000000000000000";
  const input = caseInputOf(plan, {
    payerReferrerId: plan.payer ? ("id" in plan.payer ? plan.payer.id : stand) : null,
    referrerId: plan.referrer ? ("id" in plan.referrer ? plan.referrer.id : stand) : null,
  });
  const out: RowIssue[] = [];
  const c = CaseInputSchema.safeParse(input);
  if (!c.success) out.push(...c.error.issues.slice(0, 3).map((i) => refused(i.path, "ref", CASE_FIELD_OF)));
  const auth = authorisationInputOf(plan, "case_00000000000000000000000000", null);
  if (auth) {
    const a = AuthorisationInputSchema.safeParse(auth);
    if (!a.success) out.push(issue("INVALID_VALUE", "error", "authorisationCode"));
  }
  return out;
}
