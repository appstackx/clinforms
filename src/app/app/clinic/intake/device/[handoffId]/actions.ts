"use server";
/**
 * A form handed to the patient on a clinic device: a member of staff verifies it with their password, or ends the
 * hand-off (patients.edit – the portal's clinic-device service checks the permission, the sites and the password).
 * Either way this device's one-time secret is cleared.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { clinicPublicPaths, STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { DEVICE_COOKIE, endHandoffFor, verifyHandoffFor } from "@/server/pms/portal/clinic-device";

export type HandoffAnswer = { ok: true; message?: string; next: string } | { ok: false; error: string };

function clearDevice(tenantId: string) {
  cookies().set(DEVICE_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: clinicPublicPaths(tenantId).device, maxAge: 0 });
}

export async function verifyHandoffAction(handoffId: string, password: string): Promise<HandoffAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await verifyHandoffFor(actor, String(handoffId), typeof password === "string" ? password : "");
  if (!r.ok) return r;
  clearDevice(actor.tenantId);
  revalidatePath(STAFF_PORTAL_PATHS.patientForms(r.value.patientId));
  revalidatePath(STAFF_PORTAL_PATHS.patientResponse(r.value.patientId, r.value.responseId));
  return { ok: true, message: r.message, next: STAFF_PORTAL_PATHS.patientResponse(r.value.patientId, r.value.responseId) };
}

export async function endHandoffAction(handoffId: string): Promise<HandoffAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await endHandoffFor(actor, String(handoffId));
  if (!r.ok) return r;
  clearDevice(actor.tenantId);
  revalidatePath(STAFF_PORTAL_PATHS.patientForms(r.value.patientId));
  return { ok: true, message: r.message, next: STAFF_PORTAL_PATHS.patientForms(r.value.patientId) };
}
