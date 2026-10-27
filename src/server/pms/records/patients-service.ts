/**
 * Patients (the shared record) for the records screens: search, the record's details, register (with the
 * possible-duplicates check), edit, status, legal hold, anonymisation. Rules: ./access.ts.
 *
 *   patients.view   – search, details, possible duplicates
 *   patients.edit   – register, edit, archive / restore / record a death
 *   settings.manage – legal hold, anonymise (owner / admin)
 */
import { fieldErrors, patientInputSchema, patientPatchSchema, type PatientInput, type PatientPatch } from "../../../modules/pms/core/schemas";
import { ukToday } from "../../../modules/pms/core/text";
import type { CaseSummary, Patient, PatientStatus, PatientSummary } from "../../../modules/pms/core/types";
import type { AnonymiseCheck } from "../../../modules/pms/records/anonymise";
import { listCasesForPatient } from "../../repos/pms/cases";
import { createPatient, searchPatients, setPatientLegalHold, setPatientStatus, updatePatient } from "../../repos/pms/patients";
import { anonymiseEligibility, anonymisePatient, getAnonymisation, type AnonymiseResult } from "../../repos/pms/records/anonymise";
import { findPossibleDuplicates, type PossibleDuplicate } from "../../repos/pms/records/duplicates";
import { attempt, fail, guard, notFound, ok, patientInClinic, saveFailure, type RecordsActor, type Result } from "./access";

const today = () => ukToday();

export interface PatientSearch {
  q?: string;
  status?: PatientStatus | "any";
  limit?: number;
  offset?: number;
}

/** The patient list / quick search (summaries: plain indexed columns, nothing decrypted). */
export async function searchPatientsFor(actor: RecordsActor, search: PatientSearch = {}): Promise<Result<PatientSummary[]>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("search_patients", async () => ok(await searchPatients(actor.repo(), actor.tenantId, { q: search.q, status: search.status, limit: search.limit, offset: search.offset })));
}

export interface PatientDetails {
  patient: Patient;
  anonymised: boolean;
  cases: CaseSummary[];
}

/** The record's details page (demographics, contacts, consent, alerts) and its cases. */
export async function getPatientDetails(actor: RecordsActor, patientId: string): Promise<Result<PatientDetails>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("patient_details", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const [anon, cases] = await Promise.all([getAnonymisation(actor.repo(), actor.tenantId, patient.id), listCasesForPatient(actor.repo(), actor.tenantId, patient.id)]);
    return ok({ patient, anonymised: anon?.status === "done", cases });
  });
}

/** Patients who may be the same person (before registering, or while editing a record's identity). */
export async function possibleDuplicatesFor(
  actor: RecordsActor,
  probe: { firstName?: string | null; lastName?: string | null; dateOfBirth?: string | null; email?: string | null; phones?: (string | null | undefined)[] },
  excludeId?: string,
): Promise<Result<PossibleDuplicate[]>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("patient_duplicates", async () => ok(await findPossibleDuplicates(actor.repo(), actor.tenantId, probe, { excludeId })));
}

export type RegisterOutcome = { kind: "created"; patient: Patient } | { kind: "possible_duplicates"; duplicates: PossibleDuplicate[] };

/**
 * Registers a patient. When patients of the clinic may be the same person, nothing is created and they are
 * answered instead – the form shows them and registers anyway only with `confirmNotDuplicate`.
 */
export async function registerPatientFor(actor: RecordsActor, input: PatientInput, options: { confirmNotDuplicate?: boolean } = {}): Promise<Result<RegisterOutcome>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  const parsed = patientInputSchema(today()).safeParse(input);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt<RegisterOutcome>("register_patient", async () => {
    if (!options.confirmNotDuplicate) {
      const d = parsed.data;
      const duplicates = await findPossibleDuplicates(actor.repo(), actor.tenantId, { firstName: d.firstName, lastName: d.lastName, dateOfBirth: d.dateOfBirth, email: d.email, phones: [d.phoneMobile, d.phoneHome, d.phoneWork] });
      if (duplicates.length > 0) return ok({ kind: "possible_duplicates" as const, duplicates });
    }
    return ok({ kind: "created" as const, patient: await createPatient(actor.repo(), actor.tenantId, input, actor.actor) });
  });
}

async function editable(actor: RecordsActor, patientId: string): Promise<Patient | Result<never>> {
  const patient = await patientInClinic(actor, patientId);
  if (!patient) return notFound();
  if ((await getAnonymisation(actor.repo(), actor.tenantId, patient.id))?.status === "done") return fail("invalid", "This record is anonymised and cannot be changed.");
  return patient;
}

/** Saves the patient's details with the revision the form saw. */
export async function updatePatientFor(actor: RecordsActor, patientId: string, expectedRev: number, patch: PatientPatch): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  const parsed = patientPatchSchema(today()).safeParse(patch);
  if (!parsed.success) return fail("invalid", "Some details need checking.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt("update_patient", async () => {
    const patient = await editable(actor, patientId);
    if ("ok" in patient) return patient;
    const saved = await updatePatient(actor.repo(), actor.tenantId, patient.id, expectedRev, patch, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

/** Archive, restore or record a death (nothing is deleted). */
export async function setPatientStatusFor(actor: RecordsActor, patientId: string, status: PatientStatus): Promise<Result<{ changed: boolean }>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  if (status !== "active" && status !== "archived" && status !== "deceased") return fail("invalid", "Choose a status.");
  return attempt("patient_status", async () => {
    const patient = await editable(actor, patientId);
    if ("ok" in patient) return patient;
    return ok({ changed: await setPatientStatus(actor.repo(), actor.tenantId, patient.id, status, actor.actor) });
  });
}

/** Puts the record on hold (kept as it is whatever the record-keeping rules say) or takes the hold off. */
export async function setLegalHoldFor(actor: RecordsActor, patientId: string, hold: boolean): Promise<Result<{ changed: boolean }>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  return attempt("patient_hold", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok({ changed: await setPatientLegalHold(actor.repo(), actor.tenantId, patient.id, hold === true, actor.actor) });
  });
}

export interface AnonymiseState {
  check: AnonymiseCheck;
  lastTreatmentOn: string | null;
  today: string;
  patientNumber: number;
}

/** Whether the record may be anonymised today, and why not. */
export async function anonymiseEligibilityFor(actor: RecordsActor, patientId: string): Promise<Result<AnonymiseState>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  return attempt("anonymise_check", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const state = await anonymiseEligibility(actor.repo(), actor.tenantId, patient.id);
    if (!state) return notFound();
    return ok({ check: state.check, lastTreatmentOn: state.lastTreatmentOn, today: state.today, patientNumber: state.patient.patientNumber });
  });
}

/** Anonymises the record after the record-keeping period (confirmed by typing the patient's number). */
export async function anonymisePatientFor(actor: RecordsActor, patientId: string, confirm: { confirmNumber: number; reviewed: boolean }): Promise<Result<AnonymiseResult>> {
  const denied = guard(actor, "settings.manage");
  if (denied) return denied;
  if (!Number.isInteger(confirm.confirmNumber)) return fail("invalid", "Type the patient's number to confirm.", { fieldErrors: { confirmNumber: "Type the number shown above." } });
  return attempt("anonymise", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await anonymisePatient(actor.repo(), actor.tenantId, patient.id, { confirmNumber: confirm.confirmNumber, reviewed: confirm.reviewed === true }, actor.actor));
  });
}
