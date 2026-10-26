"use server";
/** Attached files: withdraw one (hidden from the record, kept – attachments are part of the clinical record). */
import { revalidatePath } from "next/cache";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { text } from "@/server/pms/records/forms";
import { NOT_FOUND_MESSAGE, actionError, patientForAction, patientPath } from "@/server/pms/records/record";
import { getAttachment, withdrawAttachment } from "@/server/repos/pms/records/attachments";

export async function withdrawFile(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const file = await getAttachment(actor.repo(), actor.tenantId, text(form, "attachmentId"));
  if (!file || file.patientId !== patient.id) return { ok: false, error: NOT_FOUND_MESSAGE };
  const reason = text(form, "reason").trim();
  if (!reason) return { ok: false, error: "Give the reason.", fieldErrors: { reason: "Give the reason." } };
  try {
    await withdrawAttachment(actor.repo(), actor.tenantId, file.id, reason, actor.actor);
  } catch (err) {
    return actionError(err, "withdraw_file");
  }
  revalidatePath(patientPath(patient.id, "attachments"));
  return { ok: true, message: "The file is withdrawn. It is kept for the record." };
}
