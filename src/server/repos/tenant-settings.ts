/** `tenant_settings` – per-tenant settings (today: the referrer → form links of the Studio). */
import { assertTenantId, jsonOrNull, nowIso, type DbContext } from "./context";

export interface TenantSettings<L = unknown> {
  tenantId: string;
  referrerLinks: L;
  updatedAt: string;
}

const MAX_SETTINGS_BYTES = 256 * 1024;

export async function getTenantSettings<L = unknown>(ctx: DbContext, tenantId: string): Promise<TenantSettings<L> | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom("tenant_settings")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
  if (!row) return null;
  return { tenantId: row.tenant_id, referrerLinks: JSON.parse(row.referrer_links_json) as L, updatedAt: row.updated_at };
}

export async function putTenantSettings<L>(ctx: DbContext, tenantId: string, referrerLinks: L): Promise<TenantSettings<L>> {
  assertTenantId(tenantId);
  const json = jsonOrNull(referrerLinks ?? {}, "referrerLinks", MAX_SETTINGS_BYTES) ?? "{}";
  const at = nowIso(ctx);
  await ctx.db
    .insertInto("tenant_settings")
    .values({ tenant_id: tenantId, referrer_links_json: json, updated_at: at })
    .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ referrer_links_json: json, updated_at: at }))
    .execute();
  return { tenantId, referrerLinks, updatedAt: at };
}

export async function deleteTenantSettings(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const result = await ctx.db.deleteFrom("tenant_settings").where("tenant_id", "=", tenantId).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
