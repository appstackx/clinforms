/**
 * Plumbing shared by the diary's repositories: row mapping, the light reads of the records a booking points at
 * (patient, case, authorisation, practitioner, site, room, appointment type – all scoped to the clinic), the
 * nearby-items read behind the clash check, and the database's clash refusal (migration 0110's triggers).
 */
import type { Expression, Selectable } from "kysely";
import { OCCUPYING_STATUSES, statusOfRow, type AppointmentSource, type BlockKind, type CancelReason, type DiaryItemKind, type DiaryItemLike } from "../../../../modules/pms/diary/rules";
import type { DiaryItem } from "../../../../modules/pms/diary/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { classifyDbError } from "../../../db/errors";
import type { Database } from "../../../db/schema";
import { auditInsertWhenExists } from "../../audit";
import { ulid } from "../../context";
import type { PmsAppointmentsTable } from "../../../db/pms-schema/diary";
import { RepoInputError, assertActor, isOn, num, numOrNull, type DbContext, type PmsActor, type PmsAuditEntry } from "../context";

export const APPOINTMENTS = "pms_appointments";
export type AppointmentRow = Selectable<PmsAppointmentsTable>;

/** How far back an overlapping item can start (the longest item: one day). */
export const LOOK_BACK_MS = 86_400_000;

export const ITEM_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "kind",
  "site_id",
  "practitioner_id",
  "room_id",
  "patient_id",
  "case_id",
  "service_id",
  "authorisation_id",
  "series_id",
  "starts_at",
  "ends_at",
  "starts_on",
  "status",
  "block_kind",
  "title",
  "notes_enc",
  "source",
  "fee_due",
  "fee_pence",
  "auth_session_used",
  "cancel_reason",
  "treatment_started_at",
  "updated_at",
] as const;

export function toItem(r: Pick<AppointmentRow, (typeof ITEM_COLUMNS)[number]>): DiaryItem {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    kind: r.kind as DiaryItemKind,
    siteId: r.site_id,
    practitionerId: r.practitioner_id,
    roomId: r.room_id,
    patientId: r.patient_id,
    caseId: r.case_id,
    serviceId: r.service_id,
    authorisationId: r.authorisation_id,
    seriesId: r.series_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    startsOn: r.starts_on,
    // "In treatment" is stored as arrived + treatment_started_at (migration 0117).
    status: statusOfRow(r.status, r.treatment_started_at),
    blockKind: (r.block_kind as BlockKind | null) ?? null,
    title: r.title,
    hasNotes: Boolean(r.notes_enc),
    source: r.source as AppointmentSource,
    feeDue: isOn(r.fee_due),
    feePence: numOrNull(r.fee_pence),
    authSessionUsed: isOn(r.auth_session_used),
    cancelReason: (r.cancel_reason as CancelReason | null) ?? null,
    updatedAt: r.updated_at,
  };
}

/* ------------------------------------------------------------------------------------------------
 * A change and its audit row in ONE atomic batch
 *
 * Every change of a diary row sets a fresh write id (column write_id, migrations 0111–0114). The audit row is
 * an INSERT … SELECT … WHERE EXISTS (a row carrying that write id), sent in the same batch right after the change:
 * it is written exactly when the change was – on SQLite, D1 and Postgres alike, also when two writers race (the
 * loser's conditional UPDATE matches nothing, so its write id is nowhere and its audit row is not written).
 * ----------------------------------------------------------------------------------------------*/

export type DiaryWriteTable = "pms_appointments" | "pms_availability" | "pms_waiting_list" | "pms_waiting_list_offers";

/** A fresh write id ("w_<ULID>"). */
export function newWriteId(ctx: DbContext): string {
  return `w_${ulid(ctx.now ? ctx.now().getTime() : Date.now())}`;
}

/** Rows of `table` carrying `writeId` (and, when given, with this id). */
export function writtenRows(ctx: DbContext, tenantId: string, table: DiaryWriteTable, writeId: string, rowId?: string): Expression<unknown> {
  let q = ctx.db.selectFrom(table).select("id").where("tenant_id", "=", tenantId).where("write_id", "=", writeId);
  if (rowId !== undefined) q = q.where("id", "=", rowId);
  return q;
}

/** The audit INSERT of a change: written in the same batch only when a row of `table` carries `writeId`. */
export function auditWhenWritten(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry, table: DiaryWriteTable, writeId: string, rowId?: string): BatchQuery {
  const who = assertActor(actor);
  return auditInsertWhenExists(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId }, writtenRows(ctx, tenantId, table, writeId, rowId)).query;
}

/** The audit INSERT of a new row: written in the same batch only when that row exists (a conditional insert ran). */
export function auditWhenInserted(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry, table: DiaryWriteTable, rowId: string): BatchQuery {
  const who = assertActor(actor);
  const exists = ctx.db.selectFrom(table).select("id").where("tenant_id", "=", tenantId).where("id", "=", rowId);
  return auditInsertWhenExists(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId }, exists).query;
}

/** INSERT … SELECT <values> WHERE EXISTS (…): the row is inserted only while the condition holds (same batch). */
export function insertWhenExists<T extends DiaryWriteTable | "pms_appointment_series">(ctx: DbContext, table: T, row: Record<string, unknown>, whenExists: Expression<unknown>): BatchQuery {
  const columns = Object.keys(row);
  const db = ctx.db as unknown as import("kysely").Kysely<Database>;
  return db
    .insertInto(table)
    .columns(columns as never)
    .expression(db.selectNoFrom((eb) => columns.map((c) => eb.val(row[c]).as(c)) as never).where((eb) => eb.exists(whenExists)) as never);
}

/** Runs a batch; the rows each statement changed. */
export async function runChange(ctx: DbContext, queries: readonly BatchQuery[]): Promise<number[]> {
  const results = await runBatch(ctx.db, queries);
  return results.map((r) => Number(r.numAffectedRows ?? 0));
}

/** True when a write was refused by the clash triggers (practitioner or room already taken). */
export function isClashError(err: unknown): boolean {
  if (classifyDbError(err) !== "CONSTRAINT_CHECK") return false;
  const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? "");
  const constraint = (err as { constraint?: unknown })?.constraint;
  return /pms_appointments_(practitioner|room)_clash/.test(message) || (typeof constraint === "string" && /_clash$/.test(constraint));
}

/* ------------------------------------------------------------------------------------------------
 * Nearby items (the clash check before a write; the database checks again)
 * ----------------------------------------------------------------------------------------------*/

export interface NearbyQuery {
  spans: readonly { startsAt: string; endsAt: string }[];
  practitionerId?: string | null;
  roomId?: string | null;
  patientId?: string | null;
  /** The item being changed (left out). */
  excludeId?: string;
}

/** Occupying items that overlap any of the spans and share the practitioner, the room or the patient. */
export async function occupyingNear(ctx: DbContext, tenantId: string, q: NearbyQuery): Promise<DiaryItemLike[]> {
  const resources: [string, string][] = [];
  if (q.practitionerId) resources.push(["practitioner_id", q.practitionerId]);
  if (q.roomId) resources.push(["room_id", q.roomId]);
  if (q.patientId) resources.push(["patient_id", q.patientId]);
  if (resources.length === 0 || q.spans.length === 0) return [];
  const out = new Map<string, DiaryItemLike>();
  // Groups of 20 spans: 3 parameters each + the rest stays under D1's 100 bound parameters.
  for (let i = 0; i < q.spans.length; i += 20) {
    const group = q.spans.slice(i, i + 20);
    let query = ctx.db
      .selectFrom(APPOINTMENTS)
      .select(["id", "kind", "status", "treatment_started_at", "practitioner_id", "room_id", "patient_id", "starts_at", "ends_at"])
      .where("tenant_id", "=", tenantId)
      .where("status", "in", OCCUPYING_STATUSES as unknown as string[])
      .where((eb) => eb.or(resources.map(([column, value]) => eb(column as "practitioner_id", "=", value))))
      .where((eb) =>
        eb.or(
          group.map((s) =>
            eb.and([eb("starts_at", "<", s.endsAt), eb("ends_at", ">", s.startsAt), eb("starts_at", ">", new Date(Date.parse(s.startsAt) - LOOK_BACK_MS).toISOString())]),
          ),
        ),
      );
    if (q.excludeId) query = query.where("id", "!=", q.excludeId);
    const rows = await query.orderBy("starts_at").limit(500).execute();
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        kind: r.kind as DiaryItemKind,
        status: statusOfRow(r.status, r.treatment_started_at),
        practitionerId: r.practitioner_id,
        roomId: r.room_id,
        patientId: r.patient_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      });
    }
  }
  return Array.from(out.values());
}

/* ------------------------------------------------------------------------------------------------
 * The records a booking points at (light reads, scoped to the clinic)
 * ----------------------------------------------------------------------------------------------*/

export async function loadPatientRef(ctx: DbContext, tenantId: string, id: string): Promise<{ id: string; status: string }> {
  const row = await ctx.db.selectFrom("pms_patients").select(["id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) throw new RepoInputError("That patient does not exist in this clinic.");
  if (row.status !== "active") throw new RepoInputError("This patient's record is archived. Restore it before booking.");
  return row;
}

export async function loadServiceRef(ctx: DbContext, tenantId: string, id: string): Promise<{ id: string; durationMinutes: number }> {
  const row = await ctx.db.selectFrom("pms_services").select(["id", "duration_minutes", "active"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) throw new RepoInputError("That appointment type does not exist in this clinic.");
  if (!isOn(row.active)) throw new RepoInputError("That appointment type is no longer in use.");
  return { id: row.id, durationMinutes: num(row.duration_minutes) };
}

export async function loadPractitionerRef(ctx: DbContext, tenantId: string, id: string): Promise<{ id: string; displayName: string }> {
  const row = await ctx.db
    .selectFrom("pms_practitioners")
    .select(["id", "display_name", "active", "bookable"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new RepoInputError("That practitioner does not exist in this clinic.");
  if (!isOn(row.active) || !isOn(row.bookable)) throw new RepoInputError("That practitioner is not taking appointments.");
  return { id: row.id, displayName: row.display_name };
}

export async function loadSiteRef(ctx: DbContext, tenantId: string, id: string): Promise<{ id: string }> {
  const row = await ctx.db.selectFrom("pms_sites").select(["id", "active"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) throw new RepoInputError("That site does not exist in this clinic.");
  if (!isOn(row.active)) throw new RepoInputError("That site is closed.");
  return { id: row.id };
}

export async function loadRoomRef(ctx: DbContext, tenantId: string, id: string, siteId: string): Promise<{ id: string }> {
  const row = await ctx.db.selectFrom("pms_rooms").select(["id", "site_id", "active"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) throw new RepoInputError("That room does not exist in this clinic.");
  if (row.site_id !== siteId) throw new RepoInputError("That room is at another site.");
  if (!isOn(row.active)) throw new RepoInputError("That room is no longer in use.");
  return { id: row.id };
}

export async function loadCaseRef(ctx: DbContext, tenantId: string, id: string, patientId: string): Promise<{ id: string; status: string }> {
  const row = await ctx.db.selectFrom("pms_cases").select(["id", "patient_id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row || row.patient_id !== patientId) throw new RepoInputError("That case is not one of this patient's cases.");
  if (row.status === "closed") throw new RepoInputError("That case is closed.");
  return { id: row.id, status: row.status };
}

export interface AuthorisationRef {
  id: string;
  sessionsAuthorised: number | null;
  sessionsUsed: number;
  expiresOn: string | null;
}

export async function loadAuthorisationRef(ctx: DbContext, tenantId: string, id: string, caseId: string): Promise<AuthorisationRef> {
  const row = await ctx.db
    .selectFrom("pms_authorisations")
    .select(["id", "case_id", "status", "sessions_authorised", "sessions_used", "expires_on"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row || row.case_id !== caseId) throw new RepoInputError("That authorisation does not belong to this case.");
  if (row.status !== "active") throw new RepoInputError("That authorisation has been cancelled.");
  return { id: row.id, sessionsAuthorised: numOrNull(row.sessions_authorised), sessionsUsed: num(row.sessions_used), expiresOn: row.expires_on };
}

/** Appointments booked (not yet attended) against an authorisation. */
export async function pendingAuthorisationBookings(ctx: DbContext, tenantId: string, authorisationId: string, excludeId?: string): Promise<number> {
  let q = ctx.db
    .selectFrom(APPOINTMENTS)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("authorisation_id", "=", authorisationId)
    .where("status", "in", ["booked", "arrived"]);
  if (excludeId) q = q.where("id", "!=", excludeId);
  const row = await q.executeTakeFirst();
  return num(row?.n ?? 0);
}
