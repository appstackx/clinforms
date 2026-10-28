"use server";
/** Attached files: withdraw one (hidden from the record, kept – attachments are part of the clinical record). */
import { revalidatePath } from "next/cache";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { withdrawFileFor } from "@/server/pms/records/attachments-service";
import { text } from "@/server/pms/records/forms";
import { patientPath } from "@/server/pms/records/record";

export async function withdrawFile(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await withdrawFileFor(actor, patientId, text(form, "attachmentId"), text(form, "reason"));
  if (result.ok) revalidatePath(patientPath(patientId, "attachments"));
  return actionState(result, () => ({ ok: true, message: "The file is withdrawn. It is kept for the record." }));
}
