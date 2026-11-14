"use server";
/**
 * Set-up → Xero: owners and admins only ("settings.setup" + the role – two-step verification is required for every
 * member). Behind the platform switch CLINFORMS_XERO=on. Every change is audited by the repositories
 * (pms.xero.settings|connect_start|disconnect|mapping_set|options|retry|skip|push).
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { XeroMappingInputSchema, XERO_COPY, type XeroMappingInput, type XeroOptionsInput } from "@/modules/pms/integration/xero";
import { actorErrorMessage, clinicActionActor, type ClinicActor } from "@/server/pms/actor";
import { redirectHost, xeroAppConfig, xeroAvailable, xeroClientFromEnv } from "@/server/pms/integration/xero/config";
import { disconnectXeroAndRevoke, startXeroConnect } from "@/server/pms/integration/xero/connect";
import { labelInLists, loadXeroLists, mayManageXero } from "@/server/pms/integration/xero/screen";
import { sendForClinic } from "@/server/pms/integration/xero/sync";
import { RepoInputError } from "@/server/repos/context";
import { retryItem, setXeroEnabled, setXeroMapping, setXeroOptions, skipItem } from "@/server/repos/pms/integration/xero";

const PATH = "/app/clinic/setup/xero";
const NOT_ALLOWED = "Only the clinic's owner or an admin can change the Xero settings.";
const GENERIC = "Something went wrong. Please try again.";

type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

type Allowed = { ok: true; actor: ClinicActor } | { ok: false; error: string };

async function allowed(): Promise<Allowed> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!xeroAvailable() || !mayManageXero(actor)) return { ok: false, error: NOT_ALLOWED };
  return { ok: true, actor };
}

export async function setXeroEnabledAction(enabled: boolean): Promise<Answer<{ enabled: boolean }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  try {
    await setXeroEnabled(a.actor.repo(), a.actor.tenantId, enabled === true, a.actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { enabled: enabled === true } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export async function startXeroConnectAction(): Promise<Answer<{ url: string }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  const config = xeroAppConfig();
  const client = xeroClientFromEnv();
  if (!config || !client) return { ok: false, error: XERO_COPY.notConfigured };
  // The session cookie is host-only: Xero must send the browser back to the host it left from.
  const h = headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  if (host !== redirectHost(config).toLowerCase()) return { ok: false, error: XERO_COPY.wrongHost(redirectHost(config)) };
  try {
    const url = await startXeroConnect(a.actor.repo(), a.actor.tenantId, client, a.actor.actor);
    if (!url) return { ok: false, error: "Switch Xero on for this clinic first." };
    return { ok: true, value: { url } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export async function disconnectXeroAction(): Promise<Answer<{ disconnected: boolean }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  try {
    const done = await disconnectXeroAndRevoke(a.actor.repo(), a.actor.tenantId, xeroClientFromEnv(), a.actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { disconnected: done } };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message : GENERIC };
  }
}

export async function setXeroMappingAction(input: XeroMappingInput): Promise<Answer<{ saved: boolean }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  const parsed = XeroMappingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That choice is not valid." };
  const client = xeroClientFromEnv();
  if (!client) return { ok: false, error: XERO_COPY.notConfigured };
  try {
    const ctx = a.actor.repo();
    let label: string | null = null;
    if (parsed.data.xeroValue) {
      // Only what the clinic's own organisation offers (active accounts, tax rates, tracking options).
      const lists = await loadXeroLists(ctx, a.actor.tenantId, client);
      if (!lists) return { ok: false, error: "Connect Xero first." };
      label = labelInLists(lists, parsed.data.kind, parsed.data.xeroValue);
      if (!label) return { ok: false, error: "That is not one of this Xero organisation's active choices. Refresh the page and choose again." };
    }
    await setXeroMapping(ctx, a.actor.tenantId, parsed.data, label, a.actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { saved: true } };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message : GENERIC };
  }
}

export async function setXeroOptionsAction(input: XeroOptionsInput): Promise<Answer<{ saved: boolean }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  try {
    await setXeroOptions(a.actor.repo(), a.actor.tenantId, input, a.actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { saved: true } };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message.replace(/^Xero options: /, "") : GENERIC };
  }
}

export async function retryXeroItemAction(id: string): Promise<Answer<{ retried: boolean }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  try {
    const retried = await retryItem(a.actor.repo(), a.actor.tenantId, String(id ?? "").slice(0, 120), a.actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { retried } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export async function skipXeroItemAction(id: string): Promise<Answer<{ skipped: boolean }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  try {
    const skipped = await skipItem(a.actor.repo(), a.actor.tenantId, String(id ?? "").slice(0, 120), a.actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { skipped } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export async function sendXeroNowAction(): Promise<Answer<{ sent: number; needsYou: number }>> {
  const a = await allowed();
  if (!a.ok) return { ok: false, error: a.error };
  const client = xeroClientFromEnv();
  if (!client) return { ok: false, error: XERO_COPY.notConfigured };
  try {
    const r = await sendForClinic(a.actor.repo(), a.actor.tenantId, client, { budgetMs: 15_000, actor: a.actor.actor });
    revalidatePath(PATH);
    if (!r.connected) return { ok: false, error: "Connect Xero first." };
    return { ok: true, value: { sent: r.done, needsYou: r.blocked + r.failed } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}
