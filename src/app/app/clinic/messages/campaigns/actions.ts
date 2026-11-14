"use server";
/**
 * Bulk email's server actions (tracker xt02). Each: the member, the clinic's package and the permission first
 * (contract §6), then src/server/pms/comms/campaigns/service.ts, which checks the platform switch
 * (CLINFORMS_BULK_EMAIL=on), refuses reception, and validates. Answers { ok: true, … } | { ok: false, error }.
 */
import { revalidatePath } from "next/cache";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { audienceCountFor, cancelFor, continueSendingFor, saveBulkEmailSettingsFor, saveCampaignFor, scheduleFor, setMarketingConsentFor, testSendFor } from "@/server/pms/comms/campaigns/service";

export type CampaignActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };

const BASE = `${CLINIC_BASE_PATH}/messages/campaigns`;

export async function saveBulkSettingsAction(rev: number, input: { enabled: boolean; dailyCap: number }): Promise<CampaignActionResult<{ rev: number; unscheduled: number }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveBulkEmailSettingsFor(actor, rev, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  revalidatePath(BASE);
  return { ok: true, rev: r.value.rev, unscheduled: r.value.unscheduled };
}

export async function countAudienceAction(purpose: string, audience: unknown): Promise<CampaignActionResult<{ patients: number; addresses: number }>> {
  const actor = await clinicActionActor({ permission: "messages.templates", readOnly: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await audienceCountFor(actor, purpose, audience);
  return r.ok ? { ok: true, ...r.value } : { ok: false, error: r.error };
}

export async function saveCampaignAction(id: string | null, rev: number | null, input: unknown): Promise<CampaignActionResult<{ id: string; rev: number }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveCampaignFor(actor, id, rev, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  revalidatePath(BASE);
  return { ok: true, ...r.value };
}

export async function testSendAction(id: string): Promise<CampaignActionResult<{ status: "sent" | "outbox"; to: string }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await testSendFor(actor, id);
  return r.ok ? { ok: true, ...r.value } : { ok: false, error: r.error };
}

export async function scheduleAction(id: string, rev: number, sendAt: string): Promise<CampaignActionResult<{ status: string; written: number }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await scheduleFor(actor, id, rev, sendAt);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(BASE);
  revalidatePath(`${CLINIC_BASE_PATH}/messages`);
  return {
    ok: true,
    status: r.value.status,
    written: r.value.run?.written ?? 0,
  };
}

export async function continueSendingAction(id: string): Promise<CampaignActionResult<{ written: number; capReached: boolean }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await continueSendingFor(actor, id);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(BASE);
  return { ok: true, written: r.value.written, capReached: r.value.capReached };
}

export async function cancelCampaignAction(id: string): Promise<CampaignActionResult> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await cancelFor(actor, id);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(BASE);
  return { ok: true };
}

/** The patient record's Messages tab: record or withdraw the marketing-email opt-in. */
export async function setMarketingConsentAction(patientId: string, value: boolean, how: string | null): Promise<CampaignActionResult<{ changed: boolean }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setMarketingConsentFor(actor, patientId, value, how);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  revalidatePath(`${CLINIC_BASE_PATH}/patients/${patientId}/messages`);
  return { ok: true, changed: r.value.changed };
}
