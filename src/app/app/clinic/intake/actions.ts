"use server";
/** Set-up → Intake forms (settings.setup – the service checks again): new form, starter copies, save / publish. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fieldErrors } from "@/modules/pms/core/schemas";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { IntakeTemplatePatchSchema } from "@/modules/pms/portal/schemas";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { addStarterFormFor, createIntakeFormFor, saveIntakeFormFor } from "@/server/pms/portal/staff";

export type IntakeAnswer = { ok: true; message?: string; rev?: number } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function addStarterFormAction(key: string): Promise<IntakeAnswer> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await addStarterFormFor(actor, String(key));
  if (!r.ok) return r;
  revalidatePath(STAFF_PORTAL_PATHS.intake);
  redirect(STAFF_PORTAL_PATHS.intakeForm(r.value.id));
}

export async function newIntakeFormAction(): Promise<IntakeAnswer> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const name = `New form ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
  const r = await createIntakeFormFor(actor, { name, kind: "intake", status: "draft", definition: { fields: [{ id: "about_you", type: "heading", label: "About you" }, { id: "q1", type: "text", label: "Your question", required: false }] } });
  if (!r.ok) return r;
  redirect(STAFF_PORTAL_PATHS.intakeForm(r.value.id));
}

export async function saveIntakeFormAction(id: string, expectedRev: number, patch: unknown): Promise<IntakeAnswer> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const parsed = IntakeTemplatePatchSchema.safeParse(patch);
  if (!parsed.success) {
    const errs = fieldErrors(parsed.error);
    return { ok: false, error: Object.values(errs)[0] ?? "Please check the form.", fieldErrors: errs };
  }
  const r = await saveIntakeFormFor(actor, String(id), Number(expectedRev), parsed.data);
  if (r.ok) {
    revalidatePath(STAFF_PORTAL_PATHS.intake);
    revalidatePath(STAFF_PORTAL_PATHS.intakeForm(id));
  }
  return r.ok ? { ok: true, message: r.message, rev: r.value.rev } : r;
}
