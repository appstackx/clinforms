"use server";
/**
 * A form handed to the patient on a clinic device: a member of staff verifies it with their password, or ends the
 * hand-off (patients.edit – the portal's clinic-device service checks the permission, the sites and the password), or
 * asks for a code that pairs the clinic device (M10 H3 – the device is a separate browser, never this staff one).
 */
import { revalidatePath } from "next/cache";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { endHandoffFor, newPairingCodeFor, verifyHandoffFor } from "@/server/pms/portal/clinic-device";

export type HandoffAnswer = { ok: true; message?: string; next: string } | { ok: false; error: string };

export async function verifyHandoffAction(handoffId: string, password: string): Promise<HandoffAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await verifyHandoffFor(actor, String(handoffId), typeof password === "string" ? password : "");
  if (!r.ok) return r;
  revalidatePath(STAFF_PORTAL_PATHS.patientForms(r.value.patientId));
  revalidatePath(STAFF_PORTAL_PATHS.patientResponse(r.value.patientId, r.value.responseId));
  return { ok: true, message: r.message, next: STAFF_PORTAL_PATHS.patientResponse(r.value.patientId, r.value.responseId) };
}

export async function endHandoffAction(handoffId: string): Promise<HandoffAnswer> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await endHandoffFor(actor, String(handoffId));
  if (!r.ok) return r;
  revalidatePath(STAFF_PORTAL_PATHS.patientForms(r.value.patientId));
  return { ok: true, message: r.message, next: STAFF_PORTAL_PATHS.patientForms(r.value.patientId) };
}

/** A new code for the clinic device (shown once on this screen; the earlier code stops working). */
export async function newPairingCodeAction(handoffId: string): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await newPairingCodeFor(actor, String(handoffId));
  return r.ok ? { ok: true, code: r.value.code, expiresAt: r.value.expiresAt } : r;
}
