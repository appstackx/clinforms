/**
 * `pms_availability` – rotas: when each practitioner works at which site (and in which room by default), on a
 * weekday, every N weeks, from a first day to an optional last day. The diary shades the hours outside them,
 * warns about bookings outside them, and online booking offers only slots inside them.
 *
 * Never deleted: a rota entry is ended (its last day set) or switched off. Overlapping entries of one practitioner
 * are refused. Every write is audited in the same batch.
 */
import { DIARY_ID_PREFIXES as P } from "../../../../modules/pms/diary/ids";
import { rulesOverlap, windowsOn, type RotaRule, type RotaWindow } from "../../../../modules/pms/diary/rules";
import { AvailabilityInputSchema, AvailabilityPatchSchema, endMinuteOf, type AvailabilityInput, type AvailabilityPatch } from "../../../../modules/pms/diary/schemas";
import { formatHhmm, parseHhmm, weekdayName } from "../../../../modules/pms/diary/time";
import type { AvailabilityRule } from "../../../../modules/pms/diary/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { isIsoDate, ukToday } from "../../../../modules/pms/core/text";
import type { Selectable } from "kysely";
import type { PmsAvailabilityTable } from "../../../db/pms-schema/diary";
import { runBatch } from "../../../db/batch";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  isOn,
  nowIso,
  num,
  parseInput,
  pmsAuditQuery,
  pmsId,
  translateDbError,
  writeWithAudit,
  type DbContext,
} from "../context";
import { auditWhenWritten, loadPractitionerRef, loadRoomRef, loadSiteRef, newWriteId, runChange } from "./shared";
import { pmsNow } from "../../../../modules/pms/core/clock";
import { clipToOpening } from "../../../../modules/pms/reporting/opening";
import { openingInfoFor } from "../reporting/opening-hours";

const T = "pms_availability";
const MESSAGES = { foreignKey: "That practitioner, site or room does not exist in this clinic.", unique: "A rota entry with this import reference already exists." };

function toRule(r: Selectable<PmsAvailabilityTable>): AvailabilityRule {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    practitionerId: r.practitioner_id,
    siteId: r.site_id,
    roomId: r.room_id,
    weekday: num(r.weekday),
    startMinute: num(r.start_minute),
    endMinute: num(r.end_minute),
    everyWeeks: num(r.every_weeks),
    validFrom: r.valid_from,
    validTo: r.valid_to,
    onlineBookable: isOn(r.online_bookable),
    active: isOn(r.active),
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function describe(rule: RotaRule): string {
  return `${weekdayName(rule.weekday)} ${formatHhmm(rule.startMinute)}–${formatHhmm(rule.endMinute)}`;
}

async function assertNoOverlap(ctx: DbContext, tenantId: string, candidate: RotaRule, excludeId?: string): Promise<void> {
  const existing = await listAvailability(ctx, tenantId, { practitionerId: candidate.practitionerId, includeEnded: true });
  const hit = existing.find((r) => r.id !== excludeId && rulesOverlap(r, candidate));
  if (hit) throw new RepoInputError(`This overlaps the practitioner's rota entry for ${describe(hit)} (from ${hit.validFrom}). End that entry first or change the hours.`);
}

/** Adds a rota entry. */
export async function createAvailability(ctx: DbContext, tenantId: string, input: AvailabilityInput, actor: PmsActor): Promise<AvailabilityRule> {
  assertTenantId(tenantId);
  const d = parseInput(AvailabilityInputSchema, input, "Rota entry");
  await Promise.all([loadPractitionerRef(ctx, tenantId, d.practitionerId), loadSiteRef(ctx, tenantId, d.siteId)]);
  if (d.roomId) await loadRoomRef(ctx, tenantId, d.roomId, d.siteId);
  const rule: RotaRule = {
    practitionerId: d.practitionerId,
    siteId: d.siteId,
    roomId: d.roomId ?? null,
    weekday: d.weekday,
    startMinute: parseHhmm(d.startTime) ?? 0,
    endMinute: endMinuteOf(d.endTime),
    everyWeeks: d.everyWeeks ?? 1,
    validFrom: d.validFrom,
    validTo: d.validTo ?? null,
    active: true,
  };
  await assertNoOverlap(ctx, tenantId, rule);
  const id = pmsId(P.availability, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        practitioner_id: rule.practitionerId,
        site_id: rule.siteId,
        room_id: rule.roomId,
        weekday: rule.weekday,
        start_minute: rule.startMinute,
        end_minute: rule.endMinute,
        every_weeks: rule.everyWeeks,
        valid_from: rule.validFrom,
        valid_to: rule.validTo,
        online_bookable: b01(d.onlineBookable ?? true),
        active: 1,
        import_ref: d.importRef ?? null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.availability.create", targetType: "pms_availability", targetId: id, detail: { practitionerId: rule.practitionerId, siteId: rule.siteId, weekday: rule.weekday } }),
    ],
    MESSAGES,
  );
  return (await getAvailability(ctx, tenantId, id)) as AvailabilityRule;
}

/** Changes a rota entry's hours, room, repeat or last day (with the revision the editor saw). */
export async function updateAvailability(ctx: DbContext, tenantId: string, id: string, expectedRev: number, patch: AvailabilityPatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "rota entry id");
  const d = parseInput(AvailabilityPatchSchema, patch, "Rota entry");
  const current = await getAvailability(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const next: RotaRule = {
    ...current,
    roomId: d.roomId === undefined ? current.roomId : d.roomId,
    startMinute: d.startTime === undefined ? current.startMinute : (parseHhmm(d.startTime) ?? current.startMinute),
    endMinute: d.endTime === undefined ? current.endMinute : endMinuteOf(d.endTime),
    everyWeeks: d.everyWeeks ?? current.everyWeeks,
    validTo: d.validTo === undefined ? current.validTo : d.validTo,
  };
  if (next.endMinute <= next.startMinute) throw new RepoInputError("Rota entry: the end must be after the start.");
  if (next.validTo !== null && next.validTo < next.validFrom) throw new RepoInputError("Rota entry: the last day must be on or after the first.");
  if (next.roomId && next.roomId !== current.roomId) await loadRoomRef(ctx, tenantId, next.roomId, current.siteId);
  await assertNoOverlap(ctx, tenantId, next, id);
  const fields: string[] = (["roomId", "startMinute", "endMinute", "everyWeeks", "validTo"] as const).filter((k) => next[k] !== current[k]);
  const onlineBookable = d.onlineBookable ?? current.onlineBookable;
  if (onlineBookable !== current.onlineBookable) fields.push("onlineBookable");
  if (fields.length === 0) return { ok: true, rev: current.rev, updatedAt: current.updatedAt };
  const at = nowIso(ctx);
  const writeId = newWriteId(ctx);
  let updated: number;
  try {
    [updated] = await runChange(ctx, [
      ctx.db
        .updateTable(T)
        .set({
          room_id: next.roomId,
          start_minute: next.startMinute,
          end_minute: next.endMinute,
          every_weeks: next.everyWeeks,
          valid_to: next.validTo,
          online_bookable: b01(onlineBookable),
          rev: expectedRev + 1,
          write_id: writeId,
          updated_at: at,
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev),
      auditWhenWritten(ctx, tenantId, actor, { action: "pms.availability.update", targetType: "pms_availability", targetId: id, detail: { fields, rev: expectedRev + 1 } }, T, writeId, id),
    ]);
  } catch (err) {
    throw translateDbError(err, MESSAGES);
  }
  if (updated === 0) {
    const now = await getAvailability(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/**
 * Ends a rota entry after `lastDate` (bookings already made stay). A last day before the entry's first day
 * switches it off altogether.
 */
export async function endAvailability(ctx: DbContext, tenantId: string, id: string, expectedRev: number, lastDate: string, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "rota entry id");
  if (!isIsoDate(lastDate)) throw new RepoInputError("Enter the last day as YYYY-MM-DD.");
  const current = await getAvailability(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const switchOff = lastDate < current.validFrom;
  const at = nowIso(ctx);
  const writeId = newWriteId(ctx);
  const [updated] = await runChange(ctx, [
    ctx.db
      .updateTable(T)
      .set(switchOff ? { active: 0, rev: expectedRev + 1, write_id: writeId, updated_at: at } : { valid_to: lastDate, rev: expectedRev + 1, write_id: writeId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev),
    auditWhenWritten(ctx, tenantId, actor, { action: "pms.availability.end", targetType: "pms_availability", targetId: id, detail: { switchedOff: switchOff, rev: expectedRev + 1 } }, T, writeId, id),
  ]);
  if (updated === 0) {
    const now = await getAvailability(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

export async function getAvailability(ctx: DbContext, tenantId: string, id: string): Promise<AvailabilityRule | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toRule(row) : null;
}

export interface ListAvailabilityOptions {
  practitionerId?: string;
  /** Only these practitioners (at most 90). */
  practitionerIds?: readonly string[];
  siteId?: string;
  /** Include entries whose last day has passed (default: only current and future ones). */
  includeEnded?: boolean;
  /** "Today" for includeEnded = false (default: today in the UK). */
  today?: string;
}

/** Active rota entries (by practitioner, weekday, start), at most 500. */
export async function listAvailability(ctx: DbContext, tenantId: string, options: ListAvailabilityOptions = {}): Promise<AvailabilityRule[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("active", "=", 1);
  if (options.practitionerId) q = q.where("practitioner_id", "=", options.practitionerId);
  if (options.practitionerIds) {
    if (options.practitionerIds.length === 0) return [];
    q = q.where("practitioner_id", "in", options.practitionerIds.slice(0, 90) as string[]);
  }
  if (options.siteId) q = q.where("site_id", "=", options.siteId);
  if (!options.includeEnded) {
    const today = options.today ?? ukToday(ctx.now ? ctx.now() : pmsNow());
    q = q.where((eb) => eb.or([eb("valid_to", "is", null), eb("valid_to", ">=", today)]));
  }
  const rows = await q.orderBy("practitioner_id").orderBy("weekday").orderBy("start_minute").orderBy("id").limit(500).execute();
  return rows.map(toRule);
}

/** The working windows on each date (rota entries in force), e.g. for a day or a week of the diary. */
/**
 * The rota's working windows on the dates, clipped to the sites' opening hours and closures (Set-up → Sites and
 * hours – the ONE opening-hours source, src/modules/pms/reporting/opening.ts): free slots, the booking check, online
 * booking, the diary's shading and utilisation all read this. A site without opening hours is not limited.
 */
export async function availabilityWindows(ctx: DbContext, tenantId: string, dates: readonly string[], options: { siteId?: string; practitionerIds?: readonly string[] } = {}): Promise<RotaWindow[]> {
  if (dates.length === 0) return [];
  const sorted = dates.slice().sort();
  const rules = await listAvailability(ctx, tenantId, { siteId: options.siteId, practitionerIds: options.practitionerIds, today: sorted[0] });
  const windows = sorted.flatMap((date) => windowsOn(date, rules));
  if (windows.length === 0) return windows;
  const siteIds = Array.from(new Set(windows.map((w) => w.siteId)));
  const info = await openingInfoFor(ctx, tenantId, siteIds, sorted[0], sorted[sorted.length - 1]);
  return clipToOpening(windows, info);
}

/** Rota entries in bulk (demo seed, import): batches of 40 + one audit row each. No overlap check (single writer). */
export async function bulkCreateAvailability(ctx: DbContext, tenantId: string, inputs: AvailabilityInput[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<string[]> {
  assertTenantId(tenantId);
  const parsed = inputs.map((input, i) => parseInput(AvailabilityInputSchema, input, `Rota entry ${i + 1}`));
  const ids: string[] = [];
  const at = nowIso(ctx);
  for (let i = 0; i < parsed.length; i += 40) {
    const rows = parsed.slice(i, i + 40).map((d) => {
      const id = pmsId(P.availability, ctx);
      ids.push(id);
      return {
        tenant_id: tenantId,
        id,
        rev: 1,
        practitioner_id: d.practitionerId,
        site_id: d.siteId,
        room_id: d.roomId ?? null,
        weekday: d.weekday,
        start_minute: parseHhmm(d.startTime) ?? 0,
        end_minute: endMinuteOf(d.endTime),
        every_weeks: d.everyWeeks ?? 1,
        valid_from: d.validFrom,
        valid_to: d.validTo ?? null,
        online_bookable: b01(d.onlineBookable ?? true),
        active: 1,
        import_ref: d.importRef ?? null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      };
    });
    try {
      await runBatch(ctx.db, [
        ...rows.map((row) => ctx.db.insertInto(T).values(row)),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.availability.bulk_create", targetType: "pms_availability", targetId: rows[0].id, detail: { ...detail, count: rows.length } }),
      ]);
    } catch (err) {
      throw translateDbError(err, MESSAGES);
    }
  }
  return ids;
}
