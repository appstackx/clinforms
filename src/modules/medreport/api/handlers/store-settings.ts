import "server-only";

/**
 * /api/reports/v1/store/settings (signed-in clinic member, two-step verified)
 * GET → {referrerLinks, updatedAt}
 * PUT {referrerLinks} → {referrerLinks, updatedAt}: replaces the clinic's remembered referrer → form links
 *     (normalised referrer name → form map id; at most STORE_MAX_REFERRER_LINKS). Last write wins: the Studio
 *     sends the whole map. Audited (the number of links only).
 *
 * Owner: store slice (wave 2).
 */
import { json, parseBody, type MedreportHandler } from "../http";
import { ReferrerLinksSchema, StoreSettingsPutRequestSchema, type StoreSettings } from "../store-contract";
import { assertContentType, auditStore, requireTenantActor } from "./store-actor";

export const handleStoreSettingsGet: MedreportHandler = async (req, _ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const stored = await t.store.getSettings(t.tenantId);
  const links = ReferrerLinksSchema.safeParse(stored?.referrerLinks ?? {});
  const body: StoreSettings = { referrerLinks: links.success ? links.data : {}, updatedAt: stored?.updatedAt ?? null };
  return json(body);
};

export const handleStoreSettingsPut: MedreportHandler = async (req, _ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const parsed = await parseBody(req, StoreSettingsPutRequestSchema, { maxBytes: 256 * 1024 });
  if (!parsed.ok) return parsed.response;
  const { updatedAt } = await t.store.putSettings(t.tenantId, parsed.data.referrerLinks);
  await auditStore(t, { action: "settings.update", targetType: "tenant_settings", targetId: t.tenantId, detail: { referrerLinks: Object.keys(parsed.data.referrerLinks).length } });
  const body: StoreSettings = { referrerLinks: parsed.data.referrerLinks, updatedAt };
  return json(body);
};
