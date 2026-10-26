"use server";
/** Set-up → Practitioners. Owners and administrators who cover the whole clinic. Audited by the repository. */
import { revalidatePath } from "next/cache";
import { PractitionerInputSchema, PractitionerPatchSchema } from "@/modules/pms/core/schemas";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { checkbox, integer, text, textOrNull, type FormResult } from "@/modules/pms/reporting/forms";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { NOT_FOUND, NOT_WHOLE_CLINIC, failed, invalid } from "@/server/pms/reporting/action-results";
import { coversWholeClinic, siteScopeOf } from "@/server/pms/reporting/scope";
import { isClinicMember } from "@/server/pms/reporting/staff";
import { createPractitioner, updatePractitioner } from "@/server/repos/pms/directory";

const PATH = `${SETUP_PATH}/practitioners`;

function fields(form: FormData) {
  return {
    displayName: text(form, "displayName"),
    profession: text(form, "profession"),
    registrationNumber: textOrNull(form, "registrationNumber") ?? null,
    email: text(form, "email"),
    phone: text(form, "phone"),
    colour: textOrNull(form, "colour") ?? null,
    defaultSiteId: textOrNull(form, "defaultSiteId") ?? null,
    userId: textOrNull(form, "userId") ?? null,
    bookable: checkbox(form, "bookable"),
    onlineBookable: checkbox(form, "onlineBookable"),
    sortOrder: integer(form, "sortOrder"),
  };
}

export async function createPractitionerAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const input = fields(form);
  const parsed = PractitionerInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (input.userId && !(await isClinicMember(actor, input.userId))) return { ok: false, error: "That person is not a member of this clinic.", fieldErrors: { userId: "Not a member of this clinic" } };
  try {
    const p = await createPractitioner(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(PATH);
    return { ok: true, message: `${p.displayName} added.`, id: p.id };
  } catch (err) {
    return failed(err, "practitioner.create");
  }
}

export async function updatePractitionerAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const patch = { ...fields(form), active: checkbox(form, "active") };
  const parsed = PractitionerPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  if (patch.userId && !(await isClinicMember(actor, patch.userId))) return { ok: false, error: "That person is not a member of this clinic.", fieldErrors: { userId: "Not a member of this clinic" } };
  try {
    const p = await updatePractitioner(actor.repo(), actor.tenantId, text(form, "practitionerId") ?? "", patch as never, actor.actor);
    if (!p) return NOT_FOUND;
    revalidatePath(PATH);
    return { ok: true, message: "Practitioner saved." };
  } catch (err) {
    return failed(err, "practitioner.update");
  }
}
