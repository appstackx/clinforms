/**
 * Set-up → API keys (/app/clinic/setup/api, tracker xt03): what the page and its server actions call. Rules:
 *   1. the platform switch CLINFORMS_CLINIC_API=on – else the page is the 404 page and every action refuses;
 *   2. the clinic's OWNER only ("settings.owner" – never granted to another role) with two-step verification (the
 *      clinic actor requires it for every member; checked again here);
 *   3. ids from the form are read back from the owner's own clinic (the repositories scope every statement).
 */
import "server-only";
import { clinicApiSwitchOn } from "../../../../modules/pms/integration/api";
import type { ApiKeyRow, ApiScreenView } from "../../../../modules/pms/integration/api-view";
import { londonDate } from "../../../../modules/pms/diary/time";
import { listClinicMembers } from "../../../auth/membership";
import { getDb } from "../../../db";
import { listSites } from "../../../repos/pms/directory";
import { apiKeyActive, apiKeyUsage, getApiSettings, listApiKeys, type ApiKeyInfo } from "../../../repos/pms/integration/api-keys";
import { nowIso } from "../../../repos/pms/context";
import type { ClinicActor } from "../../actor";

export function clinicApiAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return clinicApiSwitchOn(env);
}

/** May this member manage the clinic's API keys? The owner, with two-step verification on. */
export function mayManageApi(actor: Pick<ClinicActor, "role" | "can">): boolean {
  return actor.role === "owner" && actor.can("settings.owner");
}

export type { ApiKeyRow, ApiScreenView };

function stateOf(k: ApiKeyInfo, at: string): ApiKeyRow["state"] {
  if (k.revokedAt) return "revoked";
  if (!apiKeyActive(k, at)) return "expired";
  return k.replacedById ? "replaced" : "active";
}

export async function apiScreenFor(actor: ClinicActor): Promise<ApiScreenView> {
  const ctx = actor.repo();
  const at = nowIso(ctx);
  const [settings, keys, sites, members, usage] = await Promise.all([
    getApiSettings(ctx, actor.tenantId),
    listApiKeys(ctx, actor.tenantId),
    listSites(ctx, actor.tenantId),
    listClinicMembers(getDb(), actor.organizationId).catch(() => []),
    apiKeyUsage(ctx, actor.tenantId, londonDate(at)),
  ]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  return {
    enabled: settings.enabled,
    sites: sites.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
    keys: keys.map((k) => {
      const u = usage.get(k.id);
      return {
        id: k.id,
        name: k.name,
        label: `${k.prefix}…${k.last4}`,
        scopes: k.scopes,
        sites: k.siteIds ? k.siteIds.map((id) => siteName.get(id) ?? "a removed site") : null,
        createdAt: k.createdAt,
        createdBy: (k.createdBy && memberName.get(k.createdBy)) || "a former member",
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        useCount: k.useCount,
        callsToday: u?.today ?? 0,
        calls30: u?.last30 ?? 0,
        patientReads30: u?.patientReads30 ?? 0,
        state: stateOf(k, at),
      };
    }),
  };
}
