/**
 * `pms_waiting_list` – patients waiting for an appointment (an earlier slot, a particular practitioner, a day or
 * time that suits them). Reception offers a slot (`pms_waiting_list_offers` – the offer holds the slot for the patient until answered or its hold ends), then
 * books it from the entry: bookAppointment(…, { waitingListId, offerId }) marks the entry booked and the offer
 * accepted in the same atomic write. Entries are removed (status), never deleted; offers are declined or
 * withdrawn. Notes are encrypted; lists never decrypt. Every write is audited in the same batch.
 */
import { DIARY_ID_PREFIXES as P } from "../../../../modules/pms/diary/ids";
import type { OfferStatus, TimeOfDay, WaitingPriority, WaitingStatus } from "../../../../modules/pms/diary/rules";
import {
  WaitingListInputSchema,
  WaitingListOfferAnswerSchema,
  WaitingListOfferSchema,
  WaitingListPatchSchema,
  WaitingListStatusSchema,
  type WaitingListInput,
  type WaitingListOfferAnswer,
  type WaitingListOfferInput,
  type WaitingListPatch,
  type WaitingListStatusChange,
} from "../../../../modules/pms/diary/schemas";
import { DIARY_COPY } from "../../../../modules/pms/diary/copy";
import { addMinutesIso, londonToUtc, parseHhmm } from "../../../../modules/pms/diary/time";
import type { WaitingListEntry, WaitingListOffer, WaitingListSummary } from "../../../../modules/pms/diary/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { Selectable } from "kysely";
import type { PmsWaitingListOffersTable, PmsWaitingListTable } from "../../../db/pms-schema/diary";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  decryptField,
  encryptField,
  nowIso,
  num,
  parseInput,
  pmsAuditQuery,
  pmsId,
  translateDbError,
  writeWithAudit,
  type DbContext,
  type RepoContext,
} from "../context";
import { findClashes } from "../../../../modules/pms/diary/rules";
import { OFFER_HOLD_DEFAULT_MINUTES } from "../../../../modules/pms/diary/schemas";
import { auditWhenWritten, inTheWayNear, loadCaseRef, loadPatientRef, loadPractitionerRef, loadRoomRef, loadServiceRef, loadSiteRef, newWriteId, runChange } from "./shared";

const T = "pms_waiting_list";
const OFFERS = "pms_waiting_list_offers";
const MESSAGES = { foreignKey: "A linked record (patient, case, appointment type, practitioner or site) does not exist in this clinic." };
const PRIORITY_ORDER: Record<WaitingPriority, number> = { urgent: 0, soon: 1, routine: 2 };

type Row = Selectable<PmsWaitingListTable>;

function days(value: string | null): number[] {
  return value ? value.split(",").map(Number).filter((n) => n >= 1 && n <= 7) : [];
}

function toSummary(r: Row): WaitingListSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    patientId: r.patient_id,
    caseId: r.case_id,
    serviceId: r.service_id,
    practitionerId: r.practitioner_id,
    siteId: r.site_id,
    priority: r.priority as WaitingPriority,
    preferredDays: days(r.preferred_days),
    preferredTime: r.preferred_time as TimeOfDay,
    earliestOn: r.earliest_on,
    latestOn: r.latest_on,
    status: r.status as WaitingStatus,
    hasNotes: Boolean(r.notes_enc),
    bookedAppointmentId: r.booked_appointment_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function checkRefs(ctx: DbContext, tenantId: string, patientId: string, d: { caseId?: string | null; serviceId?: string | null; practitionerId?: string | null; siteId?: string | null }): Promise<void> {
  if (d.caseId) await loadCaseRef(ctx, tenantId, d.caseId, patientId);
  if (d.serviceId) await loadServiceRef(ctx, tenantId, d.serviceId);
  if (d.practitionerId) await loadPractitionerRef(ctx, tenantId, d.practitionerId);
  if (d.siteId) await loadSiteRef(ctx, tenantId, d.siteId);
}

/** Puts a patient on the waiting list. */
export async function addToWaitingList(ctx: RepoContext, tenantId: string, input: WaitingListInput, actor: PmsActor): Promise<WaitingListEntry> {
  assertTenantId(tenantId);
  const d = parseInput(WaitingListInputSchema, input, "Waiting list");
  await loadPatientRef(ctx, tenantId, d.patientId);
  await checkRefs(ctx, tenantId, d.patientId, d);
  const id = pmsId(P.waitingList, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        patient_id: d.patientId,
        case_id: d.caseId ?? null,
        service_id: d.serviceId ?? null,
        practitioner_id: d.practitionerId ?? null,
        site_id: d.siteId ?? null,
        priority: d.priority ?? "routine",
        preferred_days: d.preferredDays && d.preferredDays.length ? d.preferredDays.join(",") : null,
        preferred_time: d.preferredTime ?? "any",
        earliest_on: d.earliestOn ?? null,
        latest_on: d.latestOn ?? null,
        status: "waiting",
        notes_enc: encryptField(ctx, tenantId, T, "notes_enc", id, d.notes),
        booked_appointment_id: null,
        removed_reason: null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.waiting_list.add", targetType: "pms_waiting_list", targetId: id, detail: { priority: d.priority ?? "routine" } }),
    ],
    MESSAGES,
  );
  return (await getWaitingListEntry(ctx, tenantId, id)) as WaitingListEntry;
}

/** Changes an entry's preferences (with the revision the editor saw). */
export async function updateWaitingListEntry(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: WaitingListPatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "waiting-list id");
  const d = parseInput(WaitingListPatchSchema, patch, "Waiting list");
  const current = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  if (current.status !== "waiting" && current.status !== "offered") throw new RepoInputError("This entry has been booked or removed – it can no longer be changed.");
  await checkRefs(ctx, tenantId, current.patient_id, d);
  const set: Record<string, unknown> = {};
  const fields: string[] = [];
  const put = (key: string, column: string, value: unknown) => {
    set[column] = value;
    fields.push(key);
  };
  if (d.caseId !== undefined) put("caseId", "case_id", d.caseId);
  if (d.serviceId !== undefined) put("serviceId", "service_id", d.serviceId);
  if (d.practitionerId !== undefined) put("practitionerId", "practitioner_id", d.practitionerId);
  if (d.siteId !== undefined) put("siteId", "site_id", d.siteId);
  if (d.priority !== undefined) put("priority", "priority", d.priority);
  if (d.preferredDays !== undefined) put("preferredDays", "preferred_days", d.preferredDays.length ? d.preferredDays.join(",") : null);
  if (d.preferredTime !== undefined) put("preferredTime", "preferred_time", d.preferredTime);
  if (d.earliestOn !== undefined) put("earliestOn", "earliest_on", d.earliestOn);
  if (d.latestOn !== undefined) put("latestOn", "latest_on", d.latestOn);
  if (d.notes !== undefined) put("notes", "notes_enc", encryptField(ctx, tenantId, T, "notes_enc", id, d.notes));
  const earliest = d.earliestOn === undefined ? current.earliest_on : d.earliestOn;
  const latest = d.latestOn === undefined ? current.latest_on : d.latestOn;
  if (earliest && latest && earliest > latest) throw new RepoInputError("Waiting list: the latest date must be on or after the earliest.");
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updated_at };
  const at = nowIso(ctx);
  const writeId = newWriteId(ctx);
  let updated: number;
  try {
    [updated] = await runChange(ctx, [
      ctx.db
        .updateTable(T)
        .set({ ...set, rev: expectedRev + 1, write_id: writeId, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .where("status", "in", ["waiting", "offered"]),
      auditWhenWritten(ctx, tenantId, actor, { action: "pms.waiting_list.update", targetType: "pms_waiting_list", targetId: id, detail: { fields, rev: expectedRev + 1 } }, T, writeId, id),
    ]);
  } catch (err) {
    throw translateDbError(err, MESSAGES);
  }
  if (updated === 0) return stale(ctx, tenantId, id);
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** Marks an entry offered, back to waiting, or removed (with a short reason). */
export async function setWaitingListStatus(ctx: DbContext, tenantId: string, id: string, change: WaitingListStatusChange, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "waiting-list id");
  const d = parseInput(WaitingListStatusSchema, change, "Waiting list");
  const current = await ctx.db.selectFrom(T).select(["rev", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (num(current.rev) !== d.expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  if (current.status === "booked") throw new RepoInputError("This entry has been booked already.");
  if (current.status === d.status) return { ok: true, rev: d.expectedRev, updatedAt: nowIso(ctx) };
  const at = nowIso(ctx);
  const writeId = newWriteId(ctx);
  const queries = [
    ctx.db
      .updateTable(T)
      .set({ status: d.status, removed_reason: d.status === "removed" ? (d.reason ?? null) : null, rev: d.expectedRev + 1, write_id: writeId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", d.expectedRev)
      .where("status", "=", current.status),
    auditWhenWritten(ctx, tenantId, actor, { action: "pms.waiting_list.status", targetType: "pms_waiting_list", targetId: id, detail: { from: current.status, to: d.status } }, T, writeId, id),
  ];
  // Removing an entry (or putting it back to waiting) withdraws its open offers in the same batch.
  queries.push(withdrawOpenOffers(ctx, tenantId, id, writeId, at));
  const [updated] = await runChange(ctx, queries);
  if (updated === 0) return stale(ctx, tenantId, id);
  return { ok: true, rev: d.expectedRev + 1, updatedAt: at };
}

/** One entry, notes decrypted. */
export async function getWaitingListEntry(ctx: RepoContext, tenantId: string, id: string): Promise<WaitingListEntry | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  return { ...toSummary(row), notes: decryptField(ctx, tenantId, T, "notes_enc", id, row.notes_enc), removedReason: row.removed_reason, createdBy: row.created_by };
}

export interface WaitingListQuery {
  /** "open" = waiting or offered (default). */
  status?: WaitingStatus | "open";
  siteId?: string;
  /** Only entries for these sites or for any site (a member limited to some sites – at most 90). */
  siteIds?: readonly string[];
  practitionerId?: string;
  patientId?: string;
  /** Default 200, at most 500. */
  limit?: number;
}

/** Entries, most urgent first, then the longest waiting. */
export async function listWaitingList(ctx: DbContext, tenantId: string, q: WaitingListQuery = {}): Promise<WaitingListSummary[]> {
  assertTenantId(tenantId);
  let query = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  const status = q.status ?? "open";
  query = status === "open" ? query.where("status", "in", ["waiting", "offered"]) : query.where("status", "=", status);
  if (q.siteId) query = query.where((eb) => eb.or([eb("site_id", "=", q.siteId as string), eb("site_id", "is", null)]));
  if (q.siteIds) {
    const ids = q.siteIds.slice(0, 90) as string[];
    query = ids.length ? query.where((eb) => eb.or([eb("site_id", "in", ids), eb("site_id", "is", null)])) : query.where("site_id", "is", null);
  }
  if (q.practitionerId) query = query.where((eb) => eb.or([eb("practitioner_id", "=", q.practitionerId as string), eb("practitioner_id", "is", null)]));
  if (q.patientId) query = query.where("patient_id", "=", q.patientId);
  const rows = await query
    .orderBy("created_at")
    .orderBy("id")
    .limit(Math.min(500, Math.max(1, q.limit ?? 200)))
    .execute();
  return rows.map(toSummary).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Open entries (waiting or offered) – optionally only those for some sites or for any site. */
export async function countWaitingList(ctx: DbContext, tenantId: string, options: { siteIds?: readonly string[] } = {}): Promise<number> {
  assertTenantId(tenantId);
  let q = ctx.db
    .selectFrom(T)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("status", "in", ["waiting", "offered"]);
  if (options.siteIds) {
    const ids = options.siteIds.slice(0, 90) as string[];
    q = ids.length ? q.where((eb) => eb.or([eb("site_id", "in", ids), eb("site_id", "is", null)])) : q.where("site_id", "is", null);
  }
  const row = await q.executeTakeFirst();
  return num(row?.n ?? 0);
}

async function stale(ctx: DbContext, tenantId: string, id: string): Promise<Exclude<PmsSaveResult, { ok: true }>> {
  const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
}

/* ------------------------------------------------------------------------------------------------
 * Offers: a free slot offered to a waiting patient
 * ----------------------------------------------------------------------------------------------*/

function toOffer(r: Selectable<PmsWaitingListOffersTable>): WaitingListOffer {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    waitingListId: r.waiting_list_id,
    siteId: r.site_id,
    practitionerId: r.practitioner_id,
    roomId: r.room_id,
    serviceId: r.service_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status as OfferStatus,
    appointmentId: r.appointment_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    holdUntil: r.hold_until ?? null,
  };
}

function withdrawOpenOffers(ctx: DbContext, tenantId: string, entryId: string, writeId: string, at: string) {
  return ctx.db
    .updateTable(OFFERS)
    .set((eb) => ({ status: "withdrawn", rev: eb("rev", "+", 1), write_id: writeId, updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("waiting_list_id", "=", entryId)
    .where("status", "=", "open");
}

/** When a hold made at `at` for `minutes` ends: never after the slot starts. */
export function offerHoldUntil(at: string, startsAt: string, minutes: number): string {
  const until = new Date(Date.parse(at) + minutes * 60_000).toISOString();
  return until < startsAt ? until : startsAt;
}

/**
 * Moves an open offer's hold on to `until` (a text held for quiet hours: the patient still gets the whole hold once
 * it goes). Only later, only while open; audited in the same batch. False when nothing changed.
 */
export async function extendOfferHold(ctx: DbContext, tenantId: string, offerId: string, until: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(offerId, "offer id");
  const offer = await ctx.db.selectFrom(OFFERS).select(["waiting_list_id", "hold_until", "starts_at"]).where("tenant_id", "=", tenantId).where("id", "=", offerId).executeTakeFirst();
  if (!offer || !offer.hold_until || until <= offer.hold_until || until > offer.starts_at) return false;
  const at = nowIso(ctx);
  const writeId = newWriteId(ctx);
  const [changed] = await runChange(ctx, [
    ctx.db
      .updateTable(OFFERS)
      .set((eb) => ({ hold_until: until, rev: eb("rev", "+", 1), write_id: writeId, updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", offerId)
      .where("status", "=", "open")
      .where("hold_until", "<", until),
    auditWhenWritten(ctx, tenantId, actor, { action: "pms.waiting_list.offer_hold", targetType: "pms_waiting_list", targetId: offer.waiting_list_id, detail: { offerId, holdUntil: until } }, OFFERS, writeId, offerId),
  ]);
  return changed > 0;
}

export type OfferResult = { ok: true; offer: WaitingListOffer; entryRev: number } | Exclude<PmsSaveResult, { ok: true }>;

/**
 * Offers a slot to a waiting patient: the offer is recorded and the entry marked "offered" (one batch, with the
 * entry's revision). The slot is HELD for the patient (M9b) until `holdMinutes` from now (default 2 hours), never
 * past its start: while the offer is open nobody else can book, move or block over it (0181's triggers); accepting
 * it books it (bookAppointment with waitingListId + offerId); declining or withdrawing releases it; expiry releases
 * it by itself. The slot must be free (no appointment, blocked time or other hold in the way). No message is sent
 * from here.
 */
export async function offerWaitingListSlot(ctx: RepoContext, tenantId: string, entryId: string, input: WaitingListOfferInput, actor: PmsActor): Promise<OfferResult> {
  assertTenantId(tenantId);
  assertId(entryId, "waiting-list id");
  const d = parseInput(WaitingListOfferSchema, input, "Offer");
  const entry = await ctx.db.selectFrom(T).select(["rev", "status", "service_id"]).where("tenant_id", "=", tenantId).where("id", "=", entryId).executeTakeFirst();
  if (!entry) return { ok: false, reason: "not_found" };
  if (num(entry.rev) !== d.expectedRev) return { ok: false, reason: "conflict", currentRev: num(entry.rev) };
  if (entry.status !== "waiting" && entry.status !== "offered") throw new RepoInputError("This entry has been booked or removed already.");
  const serviceId = d.serviceId === undefined ? entry.service_id : d.serviceId;
  await Promise.all([loadSiteRef(ctx, tenantId, d.siteId), loadPractitionerRef(ctx, tenantId, d.practitionerId)]);
  if (d.roomId) await loadRoomRef(ctx, tenantId, d.roomId, d.siteId);
  const duration = d.durationMinutes ?? (serviceId ? (await loadServiceRef(ctx, tenantId, serviceId)).durationMinutes : null);
  if (!duration) throw new RepoInputError("Choose an appointment type or a length.");
  if (serviceId && d.durationMinutes !== undefined) await loadServiceRef(ctx, tenantId, serviceId);
  const start = londonToUtc(d.date, parseHhmm(d.startTime) ?? 0);
  if (!start.ok) throw new RepoInputError(DIARY_COPY.gap);
  const at = nowIso(ctx);
  if (start.iso <= at) throw new RepoInputError("That time has passed – choose a later slot.");
  const endsAt = addMinutesIso(start.iso, duration);
  const holdUntil = offerHoldUntil(at, start.iso, d.holdMinutes ?? OFFER_HOLD_DEFAULT_MINUTES);
  const patient = await ctx.db.selectFrom(T).select("patient_id").where("tenant_id", "=", tenantId).where("id", "=", entryId).executeTakeFirstOrThrow();
  const inTheWay = findClashes(
    { startsAt: start.iso, endsAt, practitionerId: d.practitionerId, roomId: d.roomId ?? null },
    await inTheWayNear(ctx, tenantId, { spans: [{ startsAt: start.iso, endsAt }], practitionerId: d.practitionerId, roomId: d.roomId ?? null, exceptPatientId: patient.patient_id }),
  );
  if (inTheWay.length > 0) {
    throw new RepoInputError(inTheWay.some((c) => c.withKind === "hold") ? "That slot is already held for another waiting patient." : "That slot is no longer free – choose another.");
  }
  const id = pmsId(P.offer, ctx);
  const writeId = newWriteId(ctx);
  let changed: number[];
  try {
    changed = await runChange(ctx, [
      ctx.db
        .updateTable(T)
        .set({ status: "offered", rev: d.expectedRev + 1, write_id: writeId, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", entryId)
        .where("rev", "=", d.expectedRev)
        .where("status", "in", ["waiting", "offered"]),
      ctx.db
        .insertInto(OFFERS)
        .columns(["tenant_id", "id", "rev", "waiting_list_id", "site_id", "practitioner_id", "room_id", "service_id", "starts_at", "ends_at", "status", "appointment_id", "write_id", "created_by", "created_at", "updated_at", "hold_until"])
        .expression(
          ctx.db
            .selectNoFrom((eb) => [
              eb.val(tenantId).as("tenant_id"),
              eb.val(id).as("id"),
              eb.val(1).as("rev"),
              eb.val(entryId).as("waiting_list_id"),
              eb.val(d.siteId).as("site_id"),
              eb.val(d.practitionerId).as("practitioner_id"),
              eb.val(d.roomId ?? null).as("room_id"),
              eb.val(serviceId ?? null).as("service_id"),
              eb.val(start.iso).as("starts_at"),
              eb.val(endsAt).as("ends_at"),
              eb.val("open").as("status"),
              eb.val(null).as("appointment_id"),
              eb.val(writeId).as("write_id"),
              eb.val(actor.userId).as("created_by"),
              eb.val(at).as("created_at"),
              eb.val(at).as("updated_at"),
              eb.val(holdUntil).as("hold_until"),
            ])
            .where((eb) => eb.exists(eb.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", entryId).where("write_id", "=", writeId))),
        ),
      auditWhenWritten(ctx, tenantId, actor, { action: "pms.waiting_list.offer", targetType: "pms_waiting_list", targetId: entryId, detail: { offerId: id, rev: d.expectedRev + 1, holdUntil } }, T, writeId, entryId),
    ]);
  } catch (err) {
    throw translateDbError(err, MESSAGES);
  }
  if (changed[0] === 0) return stale(ctx, tenantId, entryId);
  const row = await ctx.db.selectFrom(OFFERS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return { ok: true, offer: toOffer(row), entryRev: d.expectedRev + 1 };
}

/**
 * The patient declined an offer, or the clinic withdrew it: the offer is closed and the entry goes back to
 * "waiting" once it has no other open offer (one batch, with the entry's revision).
 */
export async function answerWaitingListOffer(ctx: DbContext, tenantId: string, offerId: string, answer: WaitingListOfferAnswer, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(offerId, "offer id");
  const d = parseInput(WaitingListOfferAnswerSchema, answer, "Offer");
  const offer = await ctx.db.selectFrom(OFFERS).select(["waiting_list_id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", offerId).executeTakeFirst();
  if (!offer) return { ok: false, reason: "not_found" };
  if (offer.status !== "open") throw new RepoInputError("That offer has been answered already.");
  const entryId = offer.waiting_list_id;
  const entry = await ctx.db.selectFrom(T).select(["rev", "status"]).where("tenant_id", "=", tenantId).where("id", "=", entryId).executeTakeFirst();
  if (!entry) return { ok: false, reason: "not_found" };
  if (num(entry.rev) !== d.expectedRev) return { ok: false, reason: "conflict", currentRev: num(entry.rev) };
  const at = nowIso(ctx);
  const writeId = newWriteId(ctx);
  const [updated] = await runChange(ctx, [
    // The entry first (revision check, carries the write id) – the offer and the audit row follow only if it changed.
    ctx.db
      .updateTable(T)
      .set((eb) => ({
        status: eb.case().when(eb.exists(eb.selectFrom(OFFERS).select("id").where("tenant_id", "=", tenantId).where("waiting_list_id", "=", entryId).where("status", "=", "open").where("id", "!=", offerId))).then(eb.ref("status")).else("waiting").end(),
        rev: d.expectedRev + 1,
        write_id: writeId,
        updated_at: at,
      }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", entryId)
      .where("rev", "=", d.expectedRev)
      .where("status", "=", "offered"),
    ctx.db
      .updateTable(OFFERS)
      .set((eb) => ({ status: d.status, rev: eb("rev", "+", 1), write_id: writeId, updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", offerId)
      .where("status", "=", "open")
      .where((eb) => eb.exists(eb.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", entryId).where("write_id", "=", writeId))),
    auditWhenWritten(ctx, tenantId, actor, { action: `pms.waiting_list.offer_${d.status === "declined" ? "decline" : "withdraw"}`, targetType: "pms_waiting_list", targetId: entryId, detail: { offerId, rev: d.expectedRev + 1 } }, T, writeId, entryId),
  ]);
  if (updated === 0) {
    if (entry.status !== "offered") throw new RepoInputError("This entry has been booked or removed already.");
    return stale(ctx, tenantId, entryId);
  }
  return { ok: true, rev: d.expectedRev + 1, updatedAt: at };
}

/** An entry's offers, newest first (at most 50). */
export async function listWaitingListOffers(ctx: DbContext, tenantId: string, entryId: string): Promise<WaitingListOffer[]> {
  assertTenantId(tenantId);
  assertId(entryId, "waiting-list id");
  const rows = await ctx.db.selectFrom(OFFERS).selectAll().where("tenant_id", "=", tenantId).where("waiting_list_id", "=", entryId).orderBy("created_at", "desc").orderBy("id", "desc").limit(50).execute();
  return rows.map(toOffer);
}

export async function getWaitingListOffer(ctx: DbContext, tenantId: string, offerId: string): Promise<WaitingListOffer | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(OFFERS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", offerId).executeTakeFirst();
  return row ? toOffer(row) : null;
}
