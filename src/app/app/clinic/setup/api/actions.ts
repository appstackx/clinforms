"use server";
/**
 * Set-up → API keys (tracker xt03): the clinic's OWNER only (two-step verification is required for every clinic
 * member; "settings.owner" is never granted to another role). Behind the platform switch CLINFORMS_CLINIC_API=on.
 * Every change is audited by the repositories (pms.api_settings.update, pms.api_key.create|revoke|rotate).
 */
import { revalidatePath } from "next/cache";
import type { CreateApiKeyInput } from "@/modules/pms/integration/api";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { clinicApiAvailable, mayManageApi } from "@/server/pms/integration/api/screen";
import { RepoInputError } from "@/server/repos/context";
import { createApiKey, revokeApiKey, rotateApiKey, setApiEnabled } from "@/server/repos/pms/integration/api-keys";

const PATH = "/app/clinic/setup/api";
const NOT_ALLOWED = "Only the clinic's owner can manage API keys.";
const GENERIC = "Something went wrong. Please try again.";

type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

export async function setApiEnabledAction(enabled: boolean): Promise<Answer<{ enabled: boolean }>> {
  const actor = await clinicActionActor({ permission: "settings.owner" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!clinicApiAvailable() || !mayManageApi(actor)) return { ok: false, error: NOT_ALLOWED };
  try {
    await setApiEnabled(actor.repo(), actor.tenantId, enabled === true, actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { enabled: enabled === true } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export async function createApiKeyAction(input: CreateApiKeyInput): Promise<Answer<{ key: string; name: string }>> {
  const actor = await clinicActionActor({ permission: "settings.owner" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!clinicApiAvailable() || !mayManageApi(actor)) return { ok: false, error: NOT_ALLOWED };
  try {
    const created = await createApiKey(actor.repo(), actor.tenantId, input, actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { key: created.key, name: created.name } };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message.replace(/^API key: /, "") : GENERIC };
  }
}

export async function revokeApiKeyAction(id: string): Promise<Answer<{ revoked: boolean }>> {
  const actor = await clinicActionActor({ permission: "settings.owner" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!clinicApiAvailable() || !mayManageApi(actor)) return { ok: false, error: NOT_ALLOWED };
  try {
    const revoked = await revokeApiKey(actor.repo(), actor.tenantId, String(id ?? ""), actor.actor);
    revalidatePath(PATH);
    return { ok: true, value: { revoked } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export async function rotateApiKeyAction(id: string): Promise<Answer<{ key: string; name: string }>> {
  const actor = await clinicActionActor({ permission: "settings.owner" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!clinicApiAvailable() || !mayManageApi(actor)) return { ok: false, error: NOT_ALLOWED };
  try {
    const created = await rotateApiKey(actor.repo(), actor.tenantId, String(id ?? ""), actor.actor);
    if (!created) return { ok: false, error: "That key cannot be replaced: it is revoked, expired or already replaced." };
    revalidatePath(PATH);
    return { ok: true, value: { key: created.key, name: created.name } };
  } catch {
    return { ok: false, error: GENERIC };
  }
}
