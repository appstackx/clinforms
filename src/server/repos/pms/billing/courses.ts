/**
 * Courses (PK02, migrations 0231–0233 and 0238, docs/clinic-system/courses-giftcards-products.md): course types, the
 * courses sold to patients, the visits used from them and what an invoice line sells.
 *
 * - Selling: an ordinary `item` line on a draft invoice + a pms_invoice_line_refs row (written by createDraftInvoice
 *   in the same batch). The patient's course is made in the ISSUE batch (courseStartQueries) – sold = issued.
 * - Using: one pms_course_uses row per appointment while not reversed (unique index). The insert reads in SQL that
 *   the course is active, in date and has a session left, and that no invoice line holds the appointment: when it
 *   does not, a NOT NULL column gets NULL and the whole batch is refused (D1 has no interactive transactions). On
 *   Postgres the batch first updates the course row (a row lock), so two uses of the last session queue up.
 * - Never deleted: a use is reversed (reversed_at), a course cancelled, a course type archived.
 *
 * A release can reach a database before these migrations: reads answer "no courses" when a table is missing
 * (readOrEmpty), and nothing is added to an invoice's batches unless the invoice has course rows; only course
 * saves fail until the migration is applied.
 */
import { sql, type Expression, type RawBuilder, type SqlBool } from "kysely";
import { isPostgresDb } from "../../../db/dialect-kind";
import {
  CourseTypeInputSchema,
  courseExpiry,
  parseServiceIds,
  type CourseStatus,
  type CourseType,
  type CourseTypeInput,
  type CourseUse,
  type CourseVatCode,
  type PatientCourse,
} from "../../../../modules/pms/billing/courses";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { RepoInputError, assertId, assertTenantId, nowIso, num, numOrNull, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";
import { readOrEmpty } from "./healthcode";
import { ensureSettingsQuery } from "./settings";
import { affected, billingAuditWhen, billingBatch, chunks, todayOf } from "./shared";

export const COURSE_TYPES = "pms_course_types";
export const COURSES = "pms_patient_courses";
export const USES = "pms_course_uses";
export const REFS = "pms_invoice_line_refs";

export type LineRefType = "course" | "gift_card" | "product";

/* ------------------------------------------------------------------------------------------------
 * Course types (Set-up → Courses)
 * ----------------------------------------------------------------------------------------------*/

function toCourseType(r: { id: string; rev: unknown; name: string; service_ids_json: string; sessions: unknown; price_pence: unknown; vat_code: string; valid_days: unknown; active: unknown; updated_at: unknown }): CourseType {
  return {
    id: r.id,
    rev: num(r.rev),
    name: r.name,
    serviceIds: parseServiceIds(r.service_ids_json),
    sessions: num(r.sessions),
    pricePence: num(r.price_pence),
    vatCode: r.vat_code as CourseVatCode,
    validDays: numOrNull(r.valid_days),
    active: num(r.active) === 1,
    updatedAt: String(r.updated_at),
  };
}

/** The clinic's course types (archived ones too when asked), by name. No table yet → none. */
export async function listCourseTypes(ctx: RepoContext, tenantId: string, options: { includeArchived?: boolean } = {}): Promise<CourseType[]> {
  assertTenantId(tenantId);
  return readOrEmpty(COURSE_TYPES, [] as CourseType[], async () => {
    let q = ctx.db.selectFrom(COURSE_TYPES).selectAll().where("tenant_id", "=", tenantId);
    if (!options.includeArchived) q = q.where("active", "=", 1);
    const rows = await q.orderBy("name").orderBy("id").limit(500).execute();
    return rows.map(toCourseType);
  });
}

export async function getCourseType(ctx: RepoContext, tenantId: string, id: string): Promise<CourseType | null> {
  assertTenantId(tenantId);
  return readOrEmpty(COURSE_TYPES, null as CourseType | null, async () => {
    const r = await ctx.db.selectFrom(COURSE_TYPES).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return r ? toCourseType(r) : null;
  });
}

/** The services named must be this clinic's. */
async function checkServices(ctx: RepoContext, tenantId: string, serviceIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(serviceIds));
  const found = new Set<string>();
  for (const group of chunks(unique)) {
    const rows = await ctx.db.selectFrom("pms_services").select("id").where("tenant_id", "=", tenantId).where("id", "in", group).execute();
    for (const r of rows) found.add(r.id);
  }
  if (unique.some((s) => !found.has(s))) throw new RepoInputError("Course: serviceIds: A service chosen does not exist in this clinic.");
  return unique;
}

export async function createCourseType(ctx: RepoContext, tenantId: string, input: CourseTypeInput, actor: PmsActor): Promise<CourseType> {
  assertTenantId(tenantId);
  const d = parseInput(CourseTypeInputSchema, input, "Course");
  const services = await checkServices(ctx, tenantId, d.serviceIds);
  const id = pmsId(P.courseType, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    // The type hangs off the clinic's billing settings row (offboarding deletes it with that row).
    ensureSettingsQuery(ctx, tenantId, at),
    ctx.db.insertInto(COURSE_TYPES).values({
      tenant_id: tenantId,
      id,
      rev: 1,
      name: d.name,
      service_ids_json: JSON.stringify(services),
      sessions: d.sessions,
      price_pence: d.pricePence,
      vat_code: d.vatCode ?? "exempt",
      valid_days: d.validDays ?? null,
      active: d.active === false ? 0 : 1,
      updated_by: actor.userId,
      created_at: at,
      updated_at: at,
    }),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.course_type.create", targetType: "pms_course_type", targetId: id, detail: { sessions: d.sessions, pricePence: d.pricePence, services: services.length } }),
  ]);
  return (await getCourseType(ctx, tenantId, id)) as CourseType;
}

export type CourseSaveResult = { ok: true; rev: number } | { ok: false; reason: "conflict"; currentRev: number } | { ok: false; reason: "not_found" };

/** Changes a course type (courses already sold keep their sessions and expiry). Optimistic on `expectedRev`. */
export async function updateCourseType(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, input: CourseTypeInput, actor: PmsActor): Promise<CourseSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "course id");
  const d = parseInput(CourseTypeInputSchema, input, "Course");
  const current = await getCourseType(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const services = await checkServices(ctx, tenantId, d.serviceIds);
  const at = nowIso(ctx);
  const results = await billingBatch(ctx, [
    ctx.db
      .updateTable(COURSE_TYPES)
      .set({
        name: d.name,
        service_ids_json: JSON.stringify(services),
        sessions: d.sessions,
        price_pence: d.pricePence,
        vat_code: d.vatCode ?? current.vatCode,
        valid_days: d.validDays === undefined ? current.validDays : d.validDays,
        active: d.active === undefined ? (current.active ? 1 : 0) : d.active ? 1 : 0,
        rev: expectedRev + 1,
        updated_by: actor.userId,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev),
    billingAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.course_type.update", targetType: "pms_course_type", targetId: id, detail: { rev: expectedRev + 1, active: d.active ?? current.active } },
      ctx.db.selectFrom(COURSE_TYPES).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
    ),
  ]);
  if (affected(results[0]) === 0) {
    const now = await getCourseType(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1 };
}

/* ------------------------------------------------------------------------------------------------
 * What invoice lines sell (pms_invoice_line_refs)
 * ----------------------------------------------------------------------------------------------*/

/** What a course line sells, fixed when the draft is made (a later change to the course type never changes it). */
export interface CourseSnapshot {
  sessions: number;
  serviceIds: string[];
  validDays: number | null;
}

export interface LineRef {
  invoiceLineId: string;
  refType: LineRefType;
  refId: string;
  /** Courses: what was sold (null on rows made before the snapshot existed – the course type is read then). */
  snapshot?: CourseSnapshot | null;
}

export function courseSnapshotOf(t: Pick<CourseType, "sessions" | "serviceIds" | "validDays">): CourseSnapshot {
  return { sessions: t.sessions, serviceIds: t.serviceIds.slice(), validDays: t.validDays };
}

function parseSnapshot(json: string | null | undefined): CourseSnapshot | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<CourseSnapshot>;
    if (typeof v.sessions !== "number" || !Number.isInteger(v.sessions) || v.sessions < 1) return null;
    return { sessions: v.sessions, serviceIds: parseServiceIds(JSON.stringify(v.serviceIds ?? [])), validDays: typeof v.validDays === "number" ? v.validDays : null };
  } catch {
    return null;
  }
}

/** The insert of a line's reference (createDraftInvoice puts it in the draft's batch). */
export function lineRefInsert(ctx: RepoContext, tenantId: string, ref: LineRef, at: string): BatchQuery {
  return ctx.db.insertInto(REFS).values({ tenant_id: tenantId, invoice_line_id: ref.invoiceLineId, ref_type: ref.refType, ref_id: ref.refId, snapshot_json: ref.snapshot ? JSON.stringify(ref.snapshot) : null, created_at: at });
}

/** The references of an invoice's lines (none when the table does not exist yet). */
export async function invoiceLineRefs(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<LineRef[]> {
  assertTenantId(tenantId);
  return readOrEmpty(REFS, [] as LineRef[], async () => {
    const rows = await ctx.db
      .selectFrom(`${REFS} as r`)
      .innerJoin("pms_invoice_lines as l", (j) => j.onRef("l.tenant_id", "=", "r.tenant_id").onRef("l.id", "=", "r.invoice_line_id"))
      .select(["r.invoice_line_id", "r.ref_type", "r.ref_id", "r.snapshot_json"])
      .where("r.tenant_id", "=", tenantId)
      .where("l.tenant_id", "=", tenantId)
      .where("l.invoice_id", "=", invoiceId)
      .limit(100)
      .execute();
    return rows.map((r) => ({ invoiceLineId: r.invoice_line_id, refType: r.ref_type as LineRefType, refId: r.ref_id, snapshot: parseSnapshot(r.snapshot_json) }));
  });
}

/* ------------------------------------------------------------------------------------------------
 * The sale: courses start when their invoice is issued; a sale line credited in full closes its course
 * ----------------------------------------------------------------------------------------------*/

/**
 * The statements that start an invoice's courses, for the ISSUE batch: one patient course per course line. Each
 * row's sold_on is read from the invoice in the statement itself – NULL (refused, the whole issue rolled back) unless
 * this very issue applied (its edit token is on the row) – so a stale issue starts nothing. [] when the invoice sells
 * no course (or the tables do not exist yet).
 */
export async function courseStartQueries(
  ctx: RepoContext,
  tenantId: string,
  inv: { id: string; patientId: string; caseId: string | null; lines: { id: string; kind: string; quantity: number }[] },
  issuedOn: string,
  actor: PmsActor,
  at: string,
): Promise<(token: string) => BatchQuery[]> {
  // The reads happen once, here; the statements are built per issue attempt (each carries that attempt's token).
  const refs = (await invoiceLineRefs(ctx, tenantId, inv.id)).filter((r) => r.refType === "course");
  if (refs.length === 0) return () => [];
  const sales: { line: { id: string }; type: CourseType; sold: CourseSnapshot }[] = [];
  for (const ref of refs) {
    const line = inv.lines.find((l) => l.id === ref.invoiceLineId);
    if (!line) continue;
    if (line.kind !== "item" || line.quantity !== 1) throw new RepoInputError("A course is sold on a line of its own, one course per line.");
    const type = await getCourseType(ctx, tenantId, ref.refId);
    if (!type) throw new RepoInputError("A course on this invoice no longer exists in this clinic.");
    // What the draft sold (its snapshot), not what the course type says now.
    sales.push({ line, type, sold: ref.snapshot ?? courseSnapshotOf(type) });
  }
  return (token) => {
    const queries: BatchQuery[] = [];
    const soldOn = sql<string>`(select issued_on from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and edit_token = ${token} and status = 'issued')`;
    for (const { line, type, sold } of sales) {
      const id = pmsId(P.patientCourse, ctx);
      queries.push(
        ctx.db.insertInto(COURSES).values({
          tenant_id: tenantId,
          id,
          rev: 1,
          patient_id: inv.patientId,
          course_type_id: type.id,
          case_id: inv.caseId,
          sale_invoice_id: inv.id,
          sale_line_id: line.id,
          sessions_total: sold.sessions,
          service_ids_json: JSON.stringify(sold.serviceIds),
          sold_on: soldOn,
          expires_on: courseExpiry(issuedOn, sold.validDays),
          status: "active",
          created_by: actor.userId,
          created_at: at,
          updated_at: at,
        }),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.course.start", targetType: "pms_patient_course", targetId: id, detail: { invoiceId: inv.id, courseTypeId: type.id, sessions: sold.sessions } }),
      );
    }
    return queries;
  };
}

/**
 * For a credit note that releases lines (credit, void): the courses sold on lines that end up credited in full are
 * closed (cancelled) in the same batch. [] when none of the lines sold a course.
 */
export async function courseCloseOnCreditQueries(ctx: RepoContext, tenantId: string, invoiceId: string, lineIds: string[], at: string): Promise<BatchQuery[]> {
  const sold = await readOrEmpty(COURSES, [] as { id: string; sale_line_id: string }[], async () => {
    const out: { id: string; sale_line_id: string }[] = [];
    for (const group of chunks(lineIds)) {
      if (group.length === 0) continue;
      out.push(...(await ctx.db.selectFrom(COURSES).select(["id", "sale_line_id"]).where("tenant_id", "=", tenantId).where("sale_line_id", "in", group).where("status", "<>", "cancelled").execute()));
    }
    return out;
  });
  return sold.map((c) =>
    ctx.db
      .updateTable(COURSES)
      .set((eb) => ({ status: "cancelled", cancelled_at: at, rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", c.id)
      .where("status", "<>", "cancelled")
      .where(sql<boolean>`exists (select 1 from pms_invoice_lines where tenant_id = ${tenantId} and id = ${c.sale_line_id} and invoice_id = ${invoiceId} and credited_pence >= total_pence)`),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Patients' courses
 * ----------------------------------------------------------------------------------------------*/

const COURSE_COLUMNS = [
  "c.id",
  "c.rev",
  "c.patient_id",
  "c.course_type_id",
  "c.case_id",
  "c.sale_invoice_id",
  "c.sale_line_id",
  "c.sessions_total",
  "c.sold_on",
  "c.expires_on",
  "c.status",
  "c.cancelled_at",
  "c.cancel_credit_note_id",
  "c.service_ids_json as sold_service_ids_json",
  "t.name",
  "t.service_ids_json",
] as const;

type CourseRow = {
  id: string;
  rev: unknown;
  patient_id: string;
  course_type_id: string;
  case_id: string | null;
  sale_invoice_id: string;
  sale_line_id: string;
  sessions_total: unknown;
  sold_on: string;
  expires_on: string | null;
  status: string;
  cancelled_at: unknown;
  cancel_credit_note_id: string | null;
  sold_service_ids_json: string | null;
  name: string;
  service_ids_json: string;
};

async function usedCounts(ctx: RepoContext, tenantId: string, courseIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const group of chunks(courseIds)) {
    if (group.length === 0) continue;
    const rows = await ctx.db
      .selectFrom(USES)
      .select((eb) => ["patient_course_id", eb.fn.countAll<number>().as("n")])
      .where("tenant_id", "=", tenantId)
      .where("patient_course_id", "in", group)
      .where("reversed_at", "is", null)
      .groupBy("patient_course_id")
      .execute();
    for (const r of rows) out.set(r.patient_course_id, num(r.n));
  }
  return out;
}

function toCourse(r: CourseRow, used: number): PatientCourse {
  return {
    id: r.id,
    rev: num(r.rev),
    patientId: r.patient_id,
    courseTypeId: r.course_type_id,
    name: r.name,
    // The services sold with the course (fixed at the sale); older rows fall back to the course type's.
    serviceIds: parseServiceIds(r.sold_service_ids_json ?? r.service_ids_json),
    caseId: r.case_id,
    saleInvoiceId: r.sale_invoice_id,
    saleLineId: r.sale_line_id,
    sessionsTotal: num(r.sessions_total),
    sessionsUsed: used,
    soldOn: r.sold_on,
    expiresOn: r.expires_on,
    status: r.status as CourseStatus,
    cancelledAt: r.cancelled_at === null || r.cancelled_at === undefined ? null : r.cancelled_at instanceof Date ? r.cancelled_at.toISOString() : String(r.cancelled_at),
    cancelCreditNoteId: r.cancel_credit_note_id,
  };
}

/**
 * Patients' courses with the sessions used, newest sale first. `usable` = only courses a visit may still be used from
 * (active, or expired – a visit dated on or before the expiry still counts; expiry and sessions left are checked per
 * visit).
 */
export async function listPatientCourses(ctx: RepoContext, tenantId: string, patientIds: readonly string[], options: { usable?: boolean } = {}): Promise<PatientCourse[]> {
  assertTenantId(tenantId);
  return readOrEmpty(COURSES, [] as PatientCourse[], async () => {
    const rows: CourseRow[] = [];
    for (const group of chunks(Array.from(new Set(patientIds)))) {
      if (group.length === 0) continue;
      let q = ctx.db
        .selectFrom(`${COURSES} as c`)
        .innerJoin(`${COURSE_TYPES} as t`, (j) => j.onRef("t.tenant_id", "=", "c.tenant_id").onRef("t.id", "=", "c.course_type_id"))
        .select(COURSE_COLUMNS)
        .where("c.tenant_id", "=", tenantId)
        .where("t.tenant_id", "=", tenantId)
        .where("c.patient_id", "in", group);
      if (options.usable) q = q.where("c.status", "in", ["active", "expired"]);
      rows.push(...((await q.orderBy("c.sold_on", "desc").orderBy("c.id", "desc").limit(500).execute()) as CourseRow[]));
    }
    const used = await usedCounts(
      ctx,
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toCourse(r, used.get(r.id) ?? 0));
  });
}

export async function getPatientCourse(ctx: RepoContext, tenantId: string, id: string): Promise<PatientCourse | null> {
  assertTenantId(tenantId);
  return readOrEmpty(COURSES, null as PatientCourse | null, async () => {
    const r = (await ctx.db
      .selectFrom(`${COURSES} as c`)
      .innerJoin(`${COURSE_TYPES} as t`, (j) => j.onRef("t.tenant_id", "=", "c.tenant_id").onRef("t.id", "=", "c.course_type_id"))
      .select(COURSE_COLUMNS)
      .where("c.tenant_id", "=", tenantId)
      .where("t.tenant_id", "=", tenantId)
      .where("c.id", "=", id)
      .executeTakeFirst()) as CourseRow | undefined;
    if (!r) return null;
    return toCourse(r, (await usedCounts(ctx, tenantId, [r.id])).get(r.id) ?? 0);
  });
}

/** A course's uses (reversed ones too), oldest first. */
export async function listCourseUses(ctx: RepoContext, tenantId: string, courseIds: readonly string[]): Promise<CourseUse[]> {
  assertTenantId(tenantId);
  return readOrEmpty(USES, [] as CourseUse[], async () => {
    const out: CourseUse[] = [];
    for (const group of chunks(Array.from(new Set(courseIds)))) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(USES).selectAll().where("tenant_id", "=", tenantId).where("patient_course_id", "in", group).orderBy("used_on").orderBy("id").limit(1000).execute();
      out.push(
        ...rows.map((r) => ({
          id: r.id,
          patientCourseId: r.patient_course_id,
          appointmentId: r.appointment_id,
          usedOn: r.used_on,
          reversedAt: r.reversed_at === null ? null : (r.reversed_at as unknown) instanceof Date ? (r.reversed_at as unknown as Date).toISOString() : String(r.reversed_at),
          createdAt: (r.created_at as unknown) instanceof Date ? (r.created_at as unknown as Date).toISOString() : String(r.created_at),
        })),
      );
    }
    return out;
  });
}

/** Of these appointments, the ones used from a course (not reversed). */
export async function courseUsedAppointmentIds(ctx: RepoContext, tenantId: string, appointmentIds: readonly string[]): Promise<Set<string>> {
  assertTenantId(tenantId);
  return readOrEmpty(USES, new Set<string>(), async () => {
    const out = new Set<string>();
    for (const group of chunks(Array.from(new Set(appointmentIds)))) {
      if (group.length === 0) continue;
      const rows = await ctx.db.selectFrom(USES).select("appointment_id").where("tenant_id", "=", tenantId).where("appointment_id", "in", group).where("reversed_at", "is", null).execute();
      for (const r of rows) out.add(r.appointment_id);
    }
    return out;
  });
}

const INSTALLED = new WeakMap<object, true>();

/**
 * coursesInstalled, remembered per database once true (a table, once made, is never dropped by the app): the invoice
 * paths ask on every draft, and an invoice must not cost an extra request each time. False is never remembered (the
 * migration can arrive while the process runs).
 */
export async function coursesInstalledCached(ctx: RepoContext, tenantId: string): Promise<boolean> {
  if (INSTALLED.has(ctx.db)) return true;
  const yes = await coursesInstalled(ctx, tenantId);
  if (yes) INSTALLED.set(ctx.db, true);
  return yes;
}

/** Whether the course tables exist (a one-row probe; false before migration 0233). */
export async function coursesInstalled(ctx: RepoContext, tenantId: string): Promise<boolean> {
  return readOrEmpty(USES, false, async () => {
    await ctx.db.selectFrom(USES).select("id").where("tenant_id", "=", tenantId).limit(1).execute();
    return true;
  });
}

/**
 * "This appointment is neither on an invoice nor used from a course" – billing's test for the visit source's
 * uninvoiced list (the diary puts it in its own query). Only once the course tables exist (coursesInstalled).
 */
export function notBilledNorUsed(notOnAnInvoice: (a: { tenantId: Expression<string>; id: Expression<string> }) => Expression<SqlBool>) {
  return (appointment: { tenantId: Expression<string>; id: Expression<string> }): Expression<SqlBool> =>
    sql<SqlBool>`(${notOnAnInvoice(appointment)} and not exists (select 1 from pms_course_uses as used where used.tenant_id = ${appointment.tenantId} and used.appointment_id = ${appointment.id} and used.reversed_at is null))`;
}

/**
 * Postgres only: one transaction-scoped advisory lock per appointment, taken FIRST in a batch that invoices visits or
 * uses one from a course, so the two queue up (READ COMMITTED would otherwise let each pass its NOT EXISTS check on the
 * other's uncommitted row). SQLite and D1 run one write batch at a time: [] there. Sorted, so two batches never
 * deadlock. The statement touches no clinic table.
 */
export function visitLockQueries(ctx: RepoContext, tenantId: string, appointmentIds: readonly string[]): BatchQuery[] {
  if (!isPostgresDb(ctx.db)) return [];
  return Array.from(new Set(appointmentIds))
    .sort()
    .map((a) => sql`select pg_advisory_xact_lock(hashtext(${`pms-visit:${tenantId}:${a}`}))`.compile(ctx.db));
}

/**
 * The invoice id for an invoice line that holds a visit: NULL (refused – NOT NULL – and the whole batch rolled back)
 * when the visit is used from a course (not reversed) at the moment the statement runs. Closes the race between
 * invoicing a visit and using it from a course (recordCourseUse checks invoice lines the same way). Only once the
 * course tables exist (coursesInstalled).
 */
export function invoiceIdUnlessCourseUsed(tenantId: string, invoiceId: string | Expression<string>, appointmentId: string): RawBuilder<string> {
  return sql<string>`(select gi.id from pms_invoices gi where gi.tenant_id = ${tenantId} and gi.id = ${invoiceId} and not exists (select 1 from pms_course_uses cu where cu.tenant_id = ${tenantId} and cu.appointment_id = ${appointmentId} and cu.reversed_at is null))`;
}

/** Draft invoices of these patients that sell a course (not started until issued). */
export async function pendingCourseSales(ctx: RepoContext, tenantId: string, patientId: string): Promise<{ invoiceId: string; courseTypeId: string; totalPence: number }[]> {
  assertTenantId(tenantId);
  return readOrEmpty(REFS, [] as { invoiceId: string; courseTypeId: string; totalPence: number }[], async () => {
    const rows = await ctx.db
      .selectFrom("pms_invoices as i")
      .innerJoin("pms_invoice_lines as l", (j) => j.onRef("l.tenant_id", "=", "i.tenant_id").onRef("l.invoice_id", "=", "i.id"))
      .innerJoin(`${REFS} as r`, (j) => j.onRef("r.tenant_id", "=", "l.tenant_id").onRef("r.invoice_line_id", "=", "l.id"))
      .select(["i.id", "r.ref_id", "l.total_pence"])
      .where("i.tenant_id", "=", tenantId)
      .where("l.tenant_id", "=", tenantId)
      .where("r.tenant_id", "=", tenantId)
      .where("i.patient_id", "=", patientId)
      .where("i.status", "=", "draft")
      .where("r.ref_type", "=", "course")
      .orderBy("i.created_at", "desc")
      .limit(50)
      .execute();
    return rows.map((r) => ({ invoiceId: r.id, courseTypeId: r.ref_id, totalPence: num(r.total_pence) }));
  });
}

/* ------------------------------------------------------------------------------------------------
 * Using a session, and putting it back
 * ----------------------------------------------------------------------------------------------*/

export interface CourseUseInput {
  patientCourseId: string;
  appointmentId: string;
  /** The visit's date ("YYYY-MM-DD"). */
  usedOn: string;
  /** For the checks: the visit's patient, service and case. */
  patientId: string;
  serviceId: string;
  caseId: string | null;
}

const USE_REFUSED = "This visit cannot be used from the course: it has no session left, the course had expired on the visit's date or was cancelled, or the visit is already invoiced.";
/** After the course's expiry date: the one date rule for a use (the visit's date, not today – see the doc §9). */
export const COURSE_EXPIRED_ON_VISIT = "The course had expired on the visit's date.";

/**
 * Uses one session of a course for a visit (instead of invoicing it). Audited in the same batch. The visit must be
 * dated on or before the course's expiry – whenever the use is recorded: a visit on the last day can be used from the
 * course days later, also after the nightly sweep has marked the course expired.
 */
export async function recordCourseUse(ctx: RepoContext, tenantId: string, input: CourseUseInput, actor: PmsActor): Promise<CourseUse> {
  assertTenantId(tenantId);
  assertId(input.patientCourseId, "course id");
  assertId(input.appointmentId, "appointment id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.usedOn)) throw new RepoInputError("Course: usedOn: Enter the visit's date.");
  const course = await getPatientCourse(ctx, tenantId, input.patientCourseId);
  if (!course) throw new RepoInputError("That course does not exist in this clinic.");
  if (course.patientId !== input.patientId) throw new RepoInputError("That course belongs to another patient.");
  if (!course.serviceIds.includes(input.serviceId)) throw new RepoInputError("That course does not cover this kind of visit.");
  if (course.caseId !== null && course.caseId !== input.caseId) throw new RepoInputError("That course belongs to another case.");
  if (course.status === "cancelled") throw new RepoInputError("That course has been cancelled.");
  if (course.expiresOn !== null && input.usedOn > course.expiresOn) throw new RepoInputError(COURSE_EXPIRED_ON_VISIT);
  if (course.status === "used_up" || course.sessionsUsed >= course.sessionsTotal) throw new RepoInputError("That course has no session left.");
  const id = pmsId(P.courseUse, ctx);
  const at = nowIso(ctx);
  const t = tenantId;
  const c = course.id;
  // NULL (refused) unless the course is active or expired (not used up or cancelled), the visit is dated on or before
  // its expiry, it has a session left, and no invoice line holds the visit.
  const allowed = sql<string>`(select pc.id from pms_patient_courses pc where pc.tenant_id = ${t} and pc.id = ${c} and pc.status in ('active', 'expired') and (pc.expires_on is null or pc.expires_on >= ${input.usedOn}) and (select count(*) from pms_course_uses u where u.tenant_id = ${t} and u.patient_course_id = ${c} and u.reversed_at is null) < pc.sessions_total and not exists (select 1 from pms_invoice_lines l where l.tenant_id = ${t} and l.appointment_id = ${input.appointmentId} and l.billing_lock = 1))`;
  await billingBatch(
    ctx,
    [
      // Postgres: the visit's lock first (an invoice of the same visit waits, then sees this use – and vice versa).
      ...visitLockQueries(ctx, t, [input.appointmentId]),
      // Postgres: lock the course first (a second use of its last session waits, then sees this one).
      ctx.db.updateTable(COURSES).set({ updated_at: at }).where("tenant_id", "=", t).where("id", "=", c),
      ctx.db.insertInto(USES).values({ tenant_id: t, id, patient_course_id: allowed, appointment_id: input.appointmentId, used_on: input.usedOn, created_by: actor.userId, created_at: at, updated_at: at }),
      ctx.db
        .updateTable(COURSES)
        .set((eb) => ({ status: "used_up", rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", t)
        .where("id", "=", c)
        .where("status", "=", "active")
        .where(sql<boolean>`(select count(*) from pms_course_uses u where u.tenant_id = ${t} and u.patient_course_id = ${c} and u.reversed_at is null) >= sessions_total`),
      pmsAuditQuery(ctx, t, actor, { action: "pms.course.use", targetType: "pms_patient_course", targetId: c, detail: { useId: id, appointmentId: input.appointmentId } }),
    ],
    { notNull: USE_REFUSED, unique: "This visit is already used from a course.", foreignKey: "That course does not exist in this clinic." },
  );
  return { id, patientCourseId: c, appointmentId: input.appointmentId, usedOn: input.usedOn, reversedAt: null, createdAt: at };
}

/**
 * Puts a used visit back on its course (the visit can then be invoiced). False when there was nothing to reverse.
 * Also on a CANCELLED course (voided, credited in full, or cancelled): the session does not come back – the course
 * stays closed – but the visit is no longer "used from a course", so it can be invoiced on its own. That is how a
 * visit used before the course's sale was voided is billed (the use is never deleted, only marked reversed).
 */
export async function reverseCourseUse(ctx: RepoContext, tenantId: string, useId: string, actor: PmsActor): Promise<{ reversed: boolean; patientCourseId: string | null }> {
  assertTenantId(tenantId);
  assertId(useId, "use id");
  const use = await readOrEmpty(USES, undefined, () => ctx.db.selectFrom(USES).select(["id", "patient_course_id", "reversed_at"]).where("tenant_id", "=", tenantId).where("id", "=", useId).executeTakeFirst());
  if (!use) return { reversed: false, patientCourseId: null };
  if (use.reversed_at !== null) return { reversed: false, patientCourseId: use.patient_course_id };
  const course = await getPatientCourse(ctx, tenantId, use.patient_course_id);
  const at = nowIso(ctx);
  const t = tenantId;
  const mine = ctx.db.selectFrom(USES).select("id").where("tenant_id", "=", t).where("id", "=", useId).where("reversed_at", "=", at);
  const results = await billingBatch(ctx, [
    ctx.db.updateTable(USES).set({ reversed_at: at, reversed_by: actor.userId, updated_at: at }).where("tenant_id", "=", t).where("id", "=", useId).where("reversed_at", "is", null),
    ctx.db
      .updateTable(COURSES)
      .set((eb) => ({ status: "active", rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", t)
      .where("id", "=", use.patient_course_id)
      .where("status", "=", "used_up")
      .where(sql<boolean>`exists (select 1 from pms_course_uses where tenant_id = ${t} and id = ${useId} and reversed_at = ${at})`),
    billingAuditWhen(ctx, t, actor, { action: "pms.course.use_reverse", targetType: "pms_patient_course", targetId: use.patient_course_id, detail: { useId, courseCancelled: course?.status === "cancelled" } }, mine),
  ]);
  return { reversed: affected(results[0]) > 0, patientCourseId: use.patient_course_id };
}

/* ------------------------------------------------------------------------------------------------
 * Expiry (owners and administrators)
 * ----------------------------------------------------------------------------------------------*/

/** Moves (or removes, null) a course's expiry. Optimistic on `expectedRev`; audited with the old and new date. */
export async function setCourseExpiry(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, expiresOn: string | null, actor: PmsActor): Promise<CourseSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "course id");
  if (expiresOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new RepoInputError("Course: expiresOn: Enter a date.");
  const course = await getPatientCourse(ctx, tenantId, id);
  if (!course) return { ok: false, reason: "not_found" };
  if (course.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: course.rev };
  if (course.status === "cancelled") throw new RepoInputError("That course has been cancelled.");
  if (expiresOn !== null && expiresOn < course.soldOn) throw new RepoInputError("Course: expiresOn: The expiry cannot be before the sale.");
  const revive = course.status === "expired" && (expiresOn === null || expiresOn >= todayOf(ctx));
  // An expired course can be used up meanwhile (visits dated before its expiry still use it): revived, it is used up.
  const revivedAs = course.sessionsUsed >= course.sessionsTotal ? "used_up" : "active";
  const at = nowIso(ctx);
  const results = await billingBatch(ctx, [
    // An expired course (marked by the nightly sweep) whose expiry moves to today or later – or is removed – is active
    // again (used up when it has no session left).
    ctx.db
      .updateTable(COURSES)
      .set({ expires_on: expiresOn, status: revive ? revivedAs : course.status, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "<>", "cancelled"),
    billingAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.course.expiry", targetType: "pms_patient_course", targetId: id, detail: { from: course.expiresOn ?? "none", to: expiresOn ?? "none", ...(revive ? { reactivated: true } : {}) } },
      ctx.db.selectFrom(COURSES).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
    ),
  ]);
  if (affected(results[0]) === 0) {
    const now = await getPatientCourse(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1 };
}

/** Today on the repository clock (for callers working out "expired"). */
export function courseToday(ctx: RepoContext): string {
  return todayOf(ctx);
}
