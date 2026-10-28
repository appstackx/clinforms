"use server";
/**
 * A patient's record → Forms (portal module): send a form (patients.edit), send an outcome questionnaire to the
 * portal (clinical.write), mark a completed form checked, copy answers to the record (patients.edit), portal access
 * on/off (patients.edit), hand a waiting form to the patient on this clinic device (patients.edit – the device then
 * shows only that form). The portal's staff service checks the permission and the patient again.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { OutcomeMeasureIdSchema } from "@/modules/pms/records/outcomes";
import { RECORD_FIELD_KEYS, type RecordField } from "@/modules/pms/portal/forms";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { patientVisible } from "@/server/pms/portal/staff-scope";
import { applyResponseFor, reviewResponseFor, sendFormFor, sendOutcomeFor, setPortalAccessFor } from "@/server/pms/portal/staff";
import { DEVICE_COOKIE, startHandoffFor } from "@/server/pms/portal/clinic-device";

export type FormsAnswer = { ok: true; message?: string } | { ok: false; error: string };
const GONE = "This record no longer exists in this clinic.";

function done(patientId: string, extra?: string) {
  revalidatePath(STAFF_PORTAL_PATHS.patientForms(patientId));
  revalidatePath(`/app/clinic/patients/${patientId}`);
  if (extra) revalidatePath(extra);
}

export async function sendFormAction(patientId: string, templateId: string): Promise<FormsAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const r = await sendFormFor(actor, patientId, String(templateId));
  if (r.ok) done(patientId);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function sendOutcomeAction(patientId: string, measure: string, caseId: string | null): Promise<FormsAnswer> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const m = OutcomeMeasureIdSchema.safeParse(measure);
  if (!m.success) return { ok: false, error: "Choose a measure." };
  const r = await sendOutcomeFor(actor, patientId, m.data, typeof caseId === "string" && caseId ? caseId : null);
  if (r.ok) done(patientId, `/app/clinic/patients/${patientId}/outcomes`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function reviewResponseAction(patientId: string, responseId: string): Promise<FormsAnswer> {
  const actor = await clinicActionActor({ permission: "patients.view" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const r = await reviewResponseFor(actor, patientId, String(responseId));
  if (r.ok) done(patientId, STAFF_PORTAL_PATHS.patientResponse(patientId, responseId));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function applyResponseAction(patientId: string, responseId: string, fields: string[]): Promise<FormsAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const chosen = (Array.isArray(fields) ? fields : []).filter((f): f is RecordField => (RECORD_FIELD_KEYS as string[]).includes(f));
  const r = await applyResponseFor(actor, patientId, String(responseId), chosen);
  if (r.ok) done(patientId, STAFF_PORTAL_PATHS.patientResponse(patientId, responseId));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function setPortalAccessAction(patientId: string, on: boolean): Promise<FormsAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const r = await setPortalAccessFor(actor, patientId, Boolean(on));
  if (r.ok) done(patientId);
  return r.ok ? { ok: true, message: r.message } : r;
}

/** "Complete in the clinic": starts a hand-off and gives THIS device its one-time secret (cookie on the device page only). */
export async function startHandoffAction(patientId: string, responseId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const r = await startHandoffFor(actor, patientId, String(responseId));
  if (!r.ok) return r;
  cookies().set(DEVICE_COOKIE, r.value.secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: r.value.cookiePath,
    expires: new Date(r.value.expiresAt),
  });
  done(patientId);
  return { ok: true, path: r.value.path };
}
