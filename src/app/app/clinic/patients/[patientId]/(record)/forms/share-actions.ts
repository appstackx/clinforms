"use server";
/**
 * "Share with the patient" on the record's Attachments tab (PORTAL-004 – the portal module's actions, used by the
 * records module's tab): share a file attached to the record into the patient's portal, withdraw a share.
 * clinical.view + clinical.write (the portal's staff-shares service checks them, the sites and the file again).
 */
import { revalidatePath } from "next/cache";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { shareAttachmentFor, withdrawShareFor } from "@/server/pms/portal/staff-shares";

export type ShareAnswer = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function done(patientId: string) {
  revalidatePath(`/app/clinic/patients/${patientId}/attachments`);
}

export async function shareAttachmentAction(patientId: string, attachmentId: string, input: { title: string; message?: string; notify?: boolean }): Promise<ShareAnswer> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await shareAttachmentFor(actor, String(patientId), String(attachmentId), { title: String(input?.title ?? ""), message: typeof input?.message === "string" ? input.message : null, notify: input?.notify === true });
  if (r.ok) done(patientId);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function withdrawShareAction(patientId: string, shareId: string): Promise<ShareAnswer> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await withdrawShareFor(actor, String(patientId), String(shareId));
  if (r.ok) done(patientId);
  return r.ok ? { ok: true, message: r.message } : r;
}
