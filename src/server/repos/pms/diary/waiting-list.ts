/**
 * `pms_waiting_list` – patients waiting for an appointment (an earlier slot, a particular practitioner, a day or
 * time that suits them). Reception offers a slot, then books it from the entry: bookAppointment(…, {
 * waitingListId }) marks the entry booked in the same atomic write. Entries are removed (status), never deleted.
 * Notes are encrypted; lists never decrypt. Every write is audited.
 */
import { DIARY_ID_PREFIXES as P } from "../../../../modules/pms/diary/ids";
import type { TimeOfDay, WaitingPriority, WaitingStatus } from "../../../../modules/pms/diary/rules";
import {
  WaitingListInputSchema,
  WaitingListPatchSchema,
  WaitingListStatusSchema,
  type WaitingListInput,
  type WaitingListPatch,
  type WaitingListStatusChange,
} from "../../../../modules/pms/diary/schemas";
import type { WaitingListEntry, WaitingListSummary } from "../../../../modules/pms/diary/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { Selectable } from "kysely";
import type { PmsWaitingListTable } from "../../../db/pms-schema/diary";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  decryptField,
  encryptField,
  guarded,
  nowIso,
  num,
  parseInput,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type DbContext,
  type RepoContext,
} from "../context";
import { loadCaseRef, loadPatientRef, loadPractitionerRef, loadServiceRef, loadSiteRef } from "./shared";

const T = "pms_waiting_list";
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
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(T)
        .set({ ...set, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .executeTakeFirst(),
    MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.waiting_list.update", targetType: "pms_waiting_list", targetId: id, detail: { fields, rev: expectedRev + 1 } });
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
  const result = await ctx.db
    .updateTable(T)
    .set({ status: d.status, removed_reason: d.status === "removed" ? (d.reason ?? null) : null, rev: d.expectedRev + 1, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("rev", "=", d.expectedRev)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.waiting_list.status", targetType: "pms_waiting_list", targetId: id, detail: { from: current.status, to: d.status } });
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
  if (q.practitionerId) query = query.where((eb) => eb.or([eb("practitioner_id", "=", q.practitionerId as string), eb("practitioner_id", "is", null)]));
  if (q.patientId) query = query.where("patient_id", "=", q.patientId);
  const rows = await query
    .orderBy("created_at")
    .orderBy("id")
    .limit(Math.min(500, Math.max(1, q.limit ?? 200)))
    .execute();
  return rows.map(toSummary).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Open entries (waiting or offered). */
export async function countWaitingList(ctx: DbContext, tenantId: string): Promise<number> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(T)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("status", "in", ["waiting", "offered"])
    .executeTakeFirst();
  return num(row?.n ?? 0);
}
