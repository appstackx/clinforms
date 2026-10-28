/**
 * The patient's pronouns and clinical flags (K2-PAT-014) for the records screens. Rules: ./access.ts.
 *
 *   patients.view  – read the pronouns (shown with the name, like the title)
 *   patients.edit  – change the pronouns
 *   clinical.view  – read the clinical flags ("Clinical: on anticoagulants") – NEVER reception (staff): the service
 *                    refuses before reading anything, and the screens leave the flags out entirely
 *   clinical.edit  – add a flag, end one that no longer applies (never deleted)
 *
 * TODO(cs-access): when configurable permissions land (feat/cs-access), clinical flags may get their own permission
 * (e.g. "see clinical flags"); today they follow the clinical-notes permissions.
 */
import { ClinicalFlagInputSchema, type ClinicalFlag, type PatientExtras } from "../../../modules/pms/records/flags";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { getAnonymisation } from "../../repos/pms/records/anonymise";
import { addClinicalFlag, endClinicalFlag, getClinicalFlag, getPatientExtras, listClinicalFlags, savePatientPronouns } from "../../repos/pms/records/patient-extras";
import { attempt, fail, guard, notFound, ok, patientInClinic, saveFailure, type RecordsActor, type Result } from "./access";

export async function patientExtrasFor(actor: RecordsActor, patientId: string): Promise<Result<PatientExtras>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("patient_extras", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await getPatientExtras(actor.repo(), actor.tenantId, patient.id));
  });
}

export async function savePronounsFor(actor: RecordsActor, patientId: string, expectedRev: number, pronouns: string | null): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "patients.edit");
  if (denied) return denied;
  return attempt("save_pronouns", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    if ((await getAnonymisation(actor.repo(), actor.tenantId, patient.id))?.status === "done") return fail("invalid", "This record is anonymised and cannot be changed.");
    const saved = await savePatientPronouns(actor.repo(), actor.tenantId, patient.id, expectedRev, pronouns, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

/** The patient's active clinical flags, decrypted (clinicians, owners, administrators only). */
export async function clinicalFlagsFor(actor: RecordsActor, patientId: string, options: { includeEnded?: boolean } = {}): Promise<Result<ClinicalFlag[]>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("clinical_flags", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await listClinicalFlags(actor.repo(), actor.tenantId, patient.id, { includeEnded: options.includeEnded === true }));
  });
}

export async function addClinicalFlagFor(actor: RecordsActor, patientId: string, text: string): Promise<Result<ClinicalFlag>> {
  const denied = guard(actor, "clinical.edit");
  if (denied) return denied;
  const parsed = ClinicalFlagInputSchema.safeParse({ text });
  if (!parsed.success) return fail("invalid", "Write the flag.", { fieldErrors: fieldErrors(parsed.error) });
  return attempt("add_clinical_flag", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await addClinicalFlag(actor.repo(), actor.tenantId, patient.id, { text }, actor.actor));
  });
}

export async function endClinicalFlagFor(actor: RecordsActor, patientId: string, flagId: string, expectedRev: number): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "clinical.edit");
  if (denied) return denied;
  return attempt("end_clinical_flag", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient || typeof flagId !== "string" || !flagId) return notFound();
    const flag = await getClinicalFlag(actor.repo(), actor.tenantId, flagId);
    if (!flag || flag.patientId !== patient.id) return notFound();
    const saved = await endClinicalFlag(actor.repo(), actor.tenantId, flag.id, expectedRev, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}
