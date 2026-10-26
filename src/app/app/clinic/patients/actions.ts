"use server";
/** Patients → register a patient (the record's own changes are in [patientId]/actions.ts). */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fieldErrors, patientInputSchema } from "@/modules/pms/core/schemas";
import { ukToday } from "@/modules/pms/core/text";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { patientInputFromForm } from "@/server/pms/records/forms";
import { PATIENTS_PATH, actionError, patientPath } from "@/server/pms/records/record";
import { createPatient } from "@/server/repos/pms/patients";

export async function registerPatient(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const input = patientInputFromForm(form);
  const parsed = patientInputSchema(ukToday()).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some details need checking.", fieldErrors: fieldErrors(parsed.error) };
  let id: string;
  try {
    id = (await createPatient(actor.repo(), actor.tenantId, input, actor.actor)).id;
  } catch (err) {
    return actionError(err, "register_patient");
  }
  revalidatePath(PATIENTS_PATH);
  redirect(patientPath(id));
}
