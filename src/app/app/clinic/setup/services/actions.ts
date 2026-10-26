"use server";
/** Set-up → Appointment types. Owners and administrators who cover the whole clinic. Audited by the repository. */
import { revalidatePath } from "next/cache";
import { ServiceInputSchema, ServicePatchSchema } from "@/modules/pms/core/schemas";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { checkbox, integer, poundsToPence, text, textOrNull, type FormResult } from "@/modules/pms/reporting/forms";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { NOT_FOUND, NOT_WHOLE_CLINIC, failed, invalid } from "@/server/pms/reporting/action-results";
import { coversWholeClinic, siteScopeOf } from "@/server/pms/reporting/scope";
import { createService, updateService } from "@/server/repos/pms/directory";

const PATH = `${SETUP_PATH}/services`;

function fields(form: FormData) {
  return {
    name: text(form, "name"),
    code: textOrNull(form, "code"),
    category: text(form, "category"),
    durationMinutes: integer(form, "durationMinutes"),
    bufferMinutes: integer(form, "bufferMinutes"),
    defaultPricePence: poundsToPence(text(form, "price")),
    colour: textOrNull(form, "colour"),
    onlineBookable: checkbox(form, "onlineBookable"),
    sortOrder: integer(form, "sortOrder"),
  };
}

export async function createServiceAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const input = fields(form);
  const parsed = ServiceInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const s = await createService(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(PATH);
    return { ok: true, message: `${s.name} added.`, id: s.id };
  } catch (err) {
    return failed(err, "service.create");
  }
}

export async function updateServiceAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const patch = { ...fields(form), active: checkbox(form, "active") };
  const parsed = ServicePatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const s = await updateService(actor.repo(), actor.tenantId, text(form, "serviceId") ?? "", patch as never, actor.actor);
    if (!s) return NOT_FOUND;
    revalidatePath(PATH);
    return { ok: true, message: "Appointment type saved." };
  } catch (err) {
    return failed(err, "service.update");
  }
}
