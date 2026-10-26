"use server";
/**
 * A patient's record: edit the details, archive / restore / record a death, put the record on hold, anonymise it
 * after the record-keeping period. Every action re-checks the member, the clinic's package and the permission, and
 * reads the patient from the member's own clinic only.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fieldErrors, patientPatchSchema } from "@/modules/pms/core/schemas";
import { ukToday } from "@/modules/pms/core/text";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { checked, intField, patientInputFromForm, text } from "@/server/pms/records/forms";
import { NOT_FOUND_MESSAGE, PATIENTS_PATH, actionError, patientForAction, patientPath, saveError } from "@/server/pms/records/record";
import { setPatientLegalHold, setPatientStatus, updatePatient } from "@/server/repos/pms/patients";
import { anonymisePatient, getAnonymisation } from "@/server/repos/pms/records/anonymise";

export async function savePatientDetails(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  if ((await getAnonymisation(actor.repo(), actor.tenantId, patient.id))?.status === "done") return { ok: false, error: "This record is anonymised and cannot be changed." };
  const input = patientInputFromForm(form);
  const parsed = patientPatchSchema(ukToday()).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details need checking.", fieldErrors: fieldErrors(parsed.error) };
  try {
    const result = await updatePatient(actor.repo(), actor.tenantId, patient.id, intField(form, "expectedRev"), input, actor.actor);
    if (!result.ok) return saveError(result);
  } catch (err) {
    return actionError(err, "save_patient");
  }
  revalidatePath(patientPath(patient.id), "layout");
  redirect(patientPath(patient.id));
}

export async function changePatientStatus(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const status = text(form, "status");
  if (status !== "active" && status !== "archived" && status !== "deceased") return { ok: false, error: "Choose a status." };
  try {
    await setPatientStatus(actor.repo(), actor.tenantId, patient.id, status, actor.actor);
  } catch (err) {
    return actionError(err, "patient_status");
  }
  revalidatePath(patientPath(patient.id), "layout");
  revalidatePath(PATIENTS_PATH);
  return { ok: true, message: status === "active" ? "The record is active again." : status === "archived" ? "The record is archived. It is kept and can be restored." : "The death is recorded." };
}

export async function changeLegalHold(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const hold = text(form, "hold") === "on";
  try {
    await setPatientLegalHold(actor.repo(), actor.tenantId, patient.id, hold, actor.actor);
  } catch (err) {
    return actionError(err, "patient_hold");
  }
  revalidatePath(patientPath(patient.id), "layout");
  return { ok: true, message: hold ? "The record is on hold: it is kept as it is whatever the record-keeping rules say." : "The hold is off." };
}

export async function anonymiseRecord(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const typed = text(form, "confirmNumber").trim();
  if (!/^\d{1,9}$/.test(typed)) return { ok: false, error: "Type the patient's number to confirm.", fieldErrors: { confirmNumber: "Type the number shown above." } };
  try {
    await anonymisePatient(actor.repo(), actor.tenantId, patient.id, { confirmNumber: Number(typed), reviewed: checked(form, "reviewed") }, actor.actor);
  } catch (err) {
    return actionError(err, "anonymise");
  }
  revalidatePath(patientPath(patient.id), "layout");
  revalidatePath(PATIENTS_PATH);
  return { ok: true, message: "The record is anonymised." };
}
