/**
 * `pms_booking_sites` – per site: whether the booking page offers it, and its map position (for "distance from
 * you", which the patient's BROWSER works out from the patient's location or postcode – nothing about the patient
 * is sent or stored). No row = offered online, no position. Saved with the revision the screen showed; audited in
 * the same batch.
 */
import type { Selectable } from "kysely";
import { BookingSiteInputSchema, type BookingSiteInput } from "../../../../modules/pms/portal/schemas";
import type { BookingSite } from "../../../../modules/pms/portal/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { PmsBookingSitesTable } from "../../../db/pms-schema/portal";
import { classifyDbError } from "../../../db/errors";
import { assertTenantId, b01, isOn, nowIso, num, numOrNull, parseInput, pmsAuditQuery, writeWithAudit, type DbContext } from "../context";
import { changeWithAudit, portalAuditWhen } from "./shared";

const T = "pms_booking_sites";

function toSite(r: Selectable<PmsBookingSitesTable>): BookingSite {
  const lat = numOrNull(r.lat_e6);
  const lng = numOrNull(r.lng_e6);
  return { tenantId: r.tenant_id, siteId: r.site_id, rev: num(r.rev), online: isOn(r.online), latitude: lat === null ? null : lat / 1e6, longitude: lng === null ? null : lng / 1e6 };
}

/** Every site's online settings (sites without a row are not listed – treat them as online, no position). */
export async function listBookingSites(ctx: DbContext, tenantId: string): Promise<Map<string, BookingSite>> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).limit(500).execute();
  return new Map(rows.map((r) => [r.site_id, toSite(r)]));
}

const e6 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 1e6));

/** Saves one site's switch and position. `expectedRev` 0 = no row yet. */
export async function saveBookingSite(ctx: DbContext, tenantId: string, expectedRev: number, input: BookingSiteInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  const d = parseInput(BookingSiteInputSchema, input, "Site");
  const at = nowIso(ctx);
  const values = { online: b01(d.online), lat_e6: e6(d.latitude), lng_e6: e6(d.longitude) };
  const detail = { siteId: d.siteId, online: d.online, position: d.latitude != null };
  if (expectedRev === 0) {
    try {
      await writeWithAudit(
        ctx,
        [
          ctx.db.insertInto(T).values({ tenant_id: tenantId, site_id: d.siteId, rev: 1, ...values, updated_by: actor.userId, created_at: at, updated_at: at }),
          pmsAuditQuery(ctx, tenantId, actor, { action: "pms.booking_site.update", targetType: "pms_booking_site", targetId: d.siteId, detail: { ...detail, rev: 1 } }),
        ],
        { foreignKey: "That site does not exist in this clinic." },
      );
    } catch (err) {
      if (classifyDbError(err) === "CONSTRAINT_UNIQUE" || /already exists/.test(String(err))) {
        const now = (await listBookingSites(ctx, tenantId)).get(d.siteId);
        return { ok: false, reason: "conflict", currentRev: now?.rev ?? 0 };
      }
      throw err;
    }
    return { ok: true, rev: 1, updatedAt: at };
  }
  const next = expectedRev + 1;
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(T)
      .set({ ...values, rev: next, updated_by: actor.userId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("site_id", "=", d.siteId)
      .where("rev", "=", expectedRev),
    portalAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.booking_site.update", targetType: "pms_booking_site", targetId: d.siteId, detail: { ...detail, rev: next } },
      ctx.db.selectFrom(T).select("site_id").where("tenant_id", "=", tenantId).where("site_id", "=", d.siteId).where("rev", "=", next).where("updated_at", "=", at),
    ),
  ]);
  if (changed === 0) {
    const now = (await listBookingSites(ctx, tenantId)).get(d.siteId);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: next, updatedAt: at };
}
