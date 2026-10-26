"use server";
/** Set-up → Record keeping: how long clinical records are kept (never shorter than the minimums). */
import { revalidatePath } from "next/cache";
import { PmsSettingsInputSchema } from "@/modules/pms/core/schemas";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { integer, type FormResult } from "@/modules/pms/reporting/forms";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { NOT_WHOLE_CLINIC, failed, invalid } from "@/server/pms/reporting/action-results";
import { coversWholeClinic, siteScopeOf } from "@/server/pms/reporting/scope";
import { updatePmsSettings } from "@/server/repos/pms/settings";

export async function saveRecordKeepingAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const input = { retentionAdultYears: integer(form, "retentionAdultYears"), retentionChildUntilAge: integer(form, "retentionChildUntilAge") };
  const parsed = PmsSettingsInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await updatePmsSettings(actor.repo(), actor.tenantId, parsed.data, actor.actor);
    revalidatePath(`${SETUP_PATH}/records`);
    return { ok: true, message: "Record keeping saved." };
  } catch (err) {
    return failed(err, "settings.update");
  }
}
