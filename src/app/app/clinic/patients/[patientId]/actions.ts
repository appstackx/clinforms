"use server";
/**
 * A patient's record: edit the details, archive / restore / record a death, put the record on hold, anonymise it
 * after the record-keeping period. Each action checks the member, the clinic's package and the permission
 * (clinicActionActor); the records service checks the permission again, reads the patient from the member's own
 * clinic only and validates (src/server/pms/records/patients-service.ts).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { PatientStatus } from "@/modules/pms/core/types";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { checked, intField, optional, patientInputFromForm, text } from "@/server/pms/records/forms";
import { addClinicalFlagFor, endClinicalFlagFor, savePronounsFor } from "@/server/pms/records/flags-service";
import { listNotesFor, startNoteFor } from "@/server/pms/records/notes-service";
import { ukToday } from "@/modules/pms/core/text";
import { anonymisePatientFor, setLegalHoldFor, setPatientStatusFor, updatePatientFor } from "@/server/pms/records/patients-service";
import { PATIENTS_PATH, patientPath } from "@/server/pms/records/record";

export async function savePatientDetails(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await updatePatientFor(actor, patientId, intField(form, "expectedRev"), patientInputFromForm(form));
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  revalidatePath(patientPath(patientId), "layout");
  redirect(patientPath(patientId));
}

export async function changePatientStatus(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const status = text(form, "status") as PatientStatus;
  const result = await setPatientStatusFor(actor, patientId, status);
  if (result.ok) {
    revalidatePath(patientPath(patientId), "layout");
    revalidatePath(PATIENTS_PATH);
  }
  return actionState(result, () => ({
    ok: true,
    message: status === "active" ? "The record is active again." : status === "archived" ? "The record is archived. It is kept and can be restored." : "The death is recorded.",
  }));
}

export async function changeLegalHold(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const hold = text(form, "hold") === "on";
  const result = await setLegalHoldFor(actor, patientId, hold);
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, () => ({ ok: true, message: hold ? "The record is on hold: it is kept as it is whatever the record-keeping rules say." : "The hold is off." }));
}

export async function anonymiseRecord(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.merge" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const typed = text(form, "confirmNumber").trim();
  if (!/^\d{1,9}$/.test(typed)) return { ok: false, error: "Type the patient's number to confirm.", fieldErrors: { confirmNumber: "Type the number shown above." } };
  const result = await anonymisePatientFor(actor, patientId, { confirmNumber: Number(typed), reviewed: checked(form, "reviewed") });
  if (result.ok) {
    revalidatePath(patientPath(patientId), "layout");
    revalidatePath(PATIENTS_PATH);
  }
  return actionState(result, () => ({ ok: true, message: "The record is anonymised." }));
}

/* ------------------------------------------------------------------------------------------------
 * Round-2 record header: pronouns, clinical flags (K2-PAT-014), "New note"
 * ----------------------------------------------------------------------------------------------*/

export async function savePronouns(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await savePronounsFor(actor, patientId, intField(form, "expectedRev"), text(form, "pronouns"));
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: "Pronouns saved." }));
}

/** Adds a clinical flag (clinicians, owners, administrators – never reception). */
export async function addClinicalFlag(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await addClinicalFlagFor(actor, patientId, text(form, "text"));
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, (f) => ({ ok: true, id: f.id, message: "Clinical flag added." }));
}

export async function endClinicalFlag(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await endClinicalFlagFor(actor, patientId, text(form, "flagId"), intField(form, "expectedRev"));
  if (result.ok) revalidatePath(patientPath(patientId), "layout");
  return actionState(result, () => ({ ok: true, message: "The flag is ended. It stays in the record's history." }));
}

/**
 * "New note" on the record (the member's own draft from today, if there is one, else a new one): a draft from the right template – an initial assessment when the patient has no signed
 * note in the open case yet, else a follow-up – dated today, in the open case, linked to today's appointment when
 * the form names one. Opens the note editor.
 */
export async function newNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const caseId = optional(form, "caseId");
  const notes = await listNotesFor(actor, patientId, caseId ? { caseId } : {});
  if (!notes.ok) return actionState(notes, () => ({ ok: true }));
  // The member's own draft from today is reopened rather than starting a second one.
  const mine = notes.value.find((n) => n.status === "draft" && n.authorUserId === actor.userId && n.seenOn === ukToday());
  if (mine) redirect(patientPath(patientId, `notes/${mine.id}`));
  const followUp = notes.value.some((n) => n.status === "signed");
  const result = await startNoteFor(actor, patientId, {
    templateId: followUp ? "builtin-follow-up-soap" : "builtin-initial-soap",
    seenOn: ukToday(),
    caseId,
    appointmentId: optional(form, "appointmentId"),
  });
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  revalidatePath(patientPath(patientId), "layout");
  redirect(patientPath(patientId, `notes/${result.value.id}`));
}
