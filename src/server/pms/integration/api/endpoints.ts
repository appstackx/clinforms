/**
 * The public clinic API v1 endpoints (tracker xt03, docs/clinic-system/api.md). Each one is called by the HTTP layer
 * (./http.ts) after the key, the clinic's switch, the rate limits and the scope were checked; every read is scoped to
 * the key's clinic and its sites. Answers: {"data": …} (one record) or {"data": […], "nextCursor": "…" | null}.
 * A record of another clinic, of a site the key may not see, or that does not exist is answered 404 – the same.
 *
 * Booking (POST /appointments) uses the diary's OWN rules and functions, exactly as online booking does
 * (src/server/pms/diary/portal-adapter.ts): the time must be one of the diary's free slots (findFreeSlots – a rota
 * window marked for online booking, minus every appointment, blocked time and held slot of the practitioner and the
 * room, minus the patient's own appointments), then bookAppointment books it (its clash check and the database's
 * clash triggers decide again) with source "online"; the Idempotency-Key row and an audit row naming the key are
 * written in the SAME atomic batch as the appointment, so a retry can never book twice.
 */
import "server-only";
import { createHash } from "node:crypto";
import {
  API_LIMITS,
  AppointmentsQuerySchema,
  BookingBodySchema,
  InvoicesQuerySchema,
  PatientsQuerySchema,
  SlotsQuerySchema,
  canonicalBooking,
  decodeCursor,
  encodeCursor,
  issuesText,
  queryObject,
  validIdempotencyKey,
} from "../../../../modules/pms/integration/api";
import { PmsIdSchema } from "../../../../modules/pms/core/schemas";
import { daysBetween, londonRange, londonToUtc, parseHhmm } from "../../../../modules/pms/diary/time";
import { getPractitioner, getService, getSite, listPractitioners } from "../../../repos/pms/directory";
import { bookAppointment } from "../../../repos/pms/diary/appointments";
import { findFreeSlots } from "../../../repos/pms/diary/slots";
import { nowIso, pmsAuditQuery, pmsId } from "../../../repos/pms/context";
import { isUniqueViolation } from "../../../db";
import {
  apiPatientVisible,
  getApiAppointment,
  getApiInvoice,
  getApiPatient,
  listApiAppointments,
  listApiInvoices,
  listApiPatients,
  logApiPatientReads,
} from "../../../repos/pms/integration/api-reads";
import { syncDiaryMessages } from "../../diary/message-sync";
import { ApiError, type ApiEndpoint, type ApiReply, type ApiRequest } from "./http";

type IdParams = { id: string };

function parseQuery<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, url: URL): T {
  const r = schema.safeParse(queryObject(url.searchParams));
  if (!r.success) throw new ApiError("INVALID_REQUEST", `The request is not valid: ${issuesText(r.error.issues)}.`);
  return r.data;
}

function idOf(params: IdParams): string {
  const r = PmsIdSchema.safeParse(params?.id);
  if (!r.success) throw new ApiError("NOT_FOUND");
  return r.data;
}

function cursorOf(text: string | undefined): { s: string; i: string } | null {
  const c = decodeCursor(text);
  if (c === "invalid") throw new ApiError("INVALID_REQUEST", "The request is not valid: cursor: not a cursor from this API.");
  return c;
}

/** A site from the request must be one of the key's sites (a key for every site may name any). */
function checkSite(siteIds: ReadonlySet<string> | null, siteId: string | undefined): void {
  if (siteId && siteIds && !siteIds.has(siteId)) throw new ApiError("SITE_NOT_ALLOWED");
}

function page<T extends { id: string }>(rows: T[], limit: number, sortOf: (row: T) => string): { data: T[]; nextCursor: string | null } {
  const more = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, nextCursor: more && last ? encodeCursor({ s: sortOf(last), i: last.id }) : null };
}

/* ------------------------------------------------------------------------------------------------
 * Appointments
 * ----------------------------------------------------------------------------------------------*/

export const listAppointments: ApiEndpoint<Record<string, string>> = {
  scope: "appointments:read",
  async handle({ caller, url }): Promise<ApiReply> {
    const q = parseQuery(AppointmentsQuerySchema, url);
    checkSite(caller.siteIds, q.siteId);
    const after = cursorOf(q.cursor);
    if (after && !after.s) throw new ApiError("INVALID_REQUEST", "The request is not valid: cursor: not a cursor from this API.");
    const range = londonRange(q.from, daysBetween(q.from, q.to) + 1);
    const limit = q.limit ?? API_LIMITS.pageDefault;
    const rows = await listApiAppointments(caller.ctx, caller.tenantId, {
      from: range.from,
      to: range.to,
      siteId: q.siteId,
      practitionerId: q.practitionerId,
      status: q.status,
      siteIds: caller.siteIds,
      limit,
      after,
    });
    return { body: page(rows, limit, (r) => r.startsAt) };
  },
};

export const getAppointmentById: ApiEndpoint<IdParams> = {
  scope: "appointments:read",
  async handle({ caller, params }) {
    const a = await getApiAppointment(caller.ctx, caller.tenantId, idOf(params), caller.siteIds);
    if (!a) throw new ApiError("NOT_FOUND");
    return { body: { data: a } };
  },
};

/** GET /slots – the diary's free online-bookable times (what POST /appointments accepts). */
export const listSlots: ApiEndpoint<Record<string, string>> = {
  scope: "appointments:write",
  async handle({ caller, url }) {
    const q = parseQuery(SlotsQuerySchema, url);
    checkSite(caller.siteIds, q.siteId);
    const { ctx, tenantId } = caller;
    const [site, service] = await Promise.all([getSite(ctx, tenantId, q.siteId), getService(ctx, tenantId, q.serviceId)]);
    if (!site || !site.active || !service || !service.active || !service.onlineBookable) throw new ApiError("NOT_FOUND");
    const practitioners = (await listPractitioners(ctx, tenantId, { bookableOnly: true })).filter((p) => p.active && p.bookable && p.onlineBookable && (!q.practitionerId || p.id === q.practitionerId));
    if (q.practitionerId && practitioners.length === 0) throw new ApiError("NOT_FOUND");
    const limit = q.limit ?? API_LIMITS.pageDefault;
    const slots =
      practitioners.length === 0
        ? []
        : await findFreeSlots(ctx, tenantId, {
            fromDate: q.from,
            days: q.days ?? 7,
            siteId: q.siteId,
            practitionerIds: practitioners.slice(0, 80).map((p) => p.id),
            serviceId: q.serviceId,
            onlineOnly: true,
            notBefore: nowIso(ctx),
            limit,
          });
    return {
      body: {
        data: slots.map((s) => ({ date: s.date, startTime: `${String(Math.floor(s.startMinute / 60)).padStart(2, "0")}:${String(s.startMinute % 60).padStart(2, "0")}`, startsAt: s.startsAt, endsAt: s.endsAt, siteId: s.siteId, practitionerId: s.practitionerId, serviceId: q.serviceId })),
      },
    };
  },
};

/** One answer whether the case does not exist, is another clinic's or patient's, is closed or at another site. */
const CASE_NOT_USABLE = "The request is not valid: caseId: not an open case of this patient that this key can use.";

/**
 * A case the booking may name: this clinic's, this patient's, open, and – for a key limited to some sites – at one
 * of its sites (a case without a site is allowed, as for the patient's own visibility).
 */
async function usableCase(caller: ApiRequest<Record<string, string>>["caller"], caseId: string, patientId: string): Promise<boolean> {
  const row = await caller.ctx.db
    .selectFrom("pms_cases")
    .select(["patient_id", "status", "site_id"])
    .where("tenant_id", "=", caller.tenantId)
    .where("id", "=", caseId)
    .executeTakeFirst();
  if (!row || row.patient_id !== patientId || row.status !== "open") return false;
  return !caller.siteIds || row.site_id === null || caller.siteIds.has(row.site_id);
}

function requestHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function replay(req: ApiRequest<Record<string, string>>, idemKey: string, hash: string): Promise<ApiReply | null> {
  const { caller } = req;
  const row = await caller.ctx.db
    .selectFrom("pms_api_idempotency")
    .select(["request_sha256", "appointment_id"])
    .where("tenant_id", "=", caller.tenantId)
    // Per key FAMILY (a key and its replacements): a retry after a rotation still finds the original booking.
    .where("family_id", "=", caller.key.familyId)
    .where("idem_key", "=", idemKey)
    .executeTakeFirst();
  if (!row) return null;
  if (row.request_sha256 !== hash) throw new ApiError("IDEMPOTENCY_MISMATCH");
  const a = await getApiAppointment(caller.ctx, caller.tenantId, row.appointment_id, null);
  if (!a) throw new ApiError("NOT_FOUND");
  return { status: 200, body: { data: a }, headers: { "idempotent-replayed": "true" } };
}

/** POST /appointments – books one appointment into a free slot. Idempotency-Key required. */
export const bookAppointmentEndpoint: ApiEndpoint<Record<string, string>> = {
  scope: "appointments:write",
  async handle(req) {
    const { caller, headers } = req;
    const header = headers.get("idempotency-key");
    if (!validIdempotencyKey(header)) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED");
    const idemKey: string = header;
    const parsed = BookingBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError("INVALID_REQUEST", `The request is not valid: ${issuesText(parsed.error.issues)}.`);
    const b = parsed.data;
    const hash = requestHash(canonicalBooking(b));
    const earlier = await replay(req, idemKey, hash);
    if (earlier) return earlier;
    // Not free – unless the same request (same key, Idempotency-Key and body) booked it a moment ago: a replay.
    const notFree = async (): Promise<ApiReply> => {
      const again = await replay(req, idemKey, hash);
      if (again) return again;
      throw new ApiError("SLOT_NOT_FREE");
    };

    checkSite(caller.siteIds, b.siteId);
    const { ctx, tenantId } = caller;
    const [patient, site, service, practitioner] = await Promise.all([
      apiPatientVisible(ctx, tenantId, b.patientId, caller.siteIds),
      getSite(ctx, tenantId, b.siteId),
      getService(ctx, tenantId, b.serviceId),
      getPractitioner(ctx, tenantId, b.practitionerId),
    ]);
    if (!patient || !site || !service || !practitioner) throw new ApiError("NOT_FOUND");
    if (patient.status !== "active") throw new ApiError("INVALID_REQUEST", "The request is not valid: patientId: the patient's record is not active.");
    if (b.caseId && !(await usableCase(caller, b.caseId, b.patientId))) throw new ApiError("INVALID_REQUEST", CASE_NOT_USABLE);
    // The same rules as online booking: active and marked for online booking (src/server/pms/portal/availability.ts).
    if (!site.active || !service.active || !service.onlineBookable || !practitioner.active || !practitioner.bookable || !practitioner.onlineBookable) throw new ApiError("SLOT_NOT_FREE");
    const startMinute = parseHhmm(b.startTime);
    const start = startMinute === null ? null : londonToUtc(b.date, startMinute);
    if (!start || !start.ok) throw new ApiError("SLOT_NOT_FREE");
    const now = nowIso(ctx);
    if (Date.parse(start.iso) <= Date.parse(now)) throw new ApiError("SLOT_NOT_FREE");

    // The time must be one of the diary's free slots (a rota window marked for online booking, everything taken
    // removed, the patient's own appointments too) – the function the diary and online booking use.
    const slots = await findFreeSlots(ctx, tenantId, {
      fromDate: b.date,
      days: 1,
      siteId: b.siteId,
      practitionerIds: [b.practitionerId],
      serviceId: b.serviceId,
      onlineOnly: true,
      stepMinutes: 5,
      notBefore: start.iso,
      limit: 20,
      patientId: b.patientId,
    });
    const slot = slots.find((s) => Date.parse(s.startsAt) === Date.parse(start.iso) && s.practitionerId === b.practitionerId && s.siteId === b.siteId);
    if (!slot) return notFree();

    const idemId = pmsId("apii", ctx);
    let result;
    try {
      result = await bookAppointment(
        ctx,
        tenantId,
        {
          patientId: b.patientId,
          serviceId: b.serviceId,
          practitionerId: b.practitionerId,
          siteId: b.siteId,
          roomId: slot.roomId,
          caseId: b.caseId,
          date: b.date,
          startTime: b.startTime,
          notes: b.note ?? null,
          source: "online",
          sendConfirmation: b.sendConfirmation ?? false,
        },
        caller.actor,
        {
          alsoWrite: (appointmentId) => [
            ctx.db.insertInto("pms_api_idempotency").values({ tenant_id: tenantId, id: idemId, key_id: caller.key.id, family_id: caller.key.familyId, idem_key: idemKey, request_sha256: hash, appointment_id: appointmentId, created_at: now }),
            pmsAuditQuery(ctx, tenantId, caller.actor, { action: "pms.api.appointment_book", targetType: "pms_appointment", targetId: appointmentId, detail: { apiKeyId: caller.key.id, via: "api" } }),
          ],
        },
      );
    } catch (err) {
      // The same Idempotency-Key sent twice at once: the second batch fails on the unique index – answer as a replay.
      if (isUniqueViolation(err) || (err instanceof Error && /already exists/i.test(err.message))) {
        const again = await replay(req, idemKey, hash);
        if (again) return again;
      }
      throw err;
    }
    if (!result.ok) return notFree();
    const id = result.items[0].id;
    await syncDiaryMessages(ctx, tenantId, [id], caller.actor, "booked");
    const a = await getApiAppointment(ctx, tenantId, id, null);
    return { status: 201, body: { data: a }, headers: { location: `/api/clinic/v1/appointments/${encodeURIComponent(id)}` } };
  },
};

/* ------------------------------------------------------------------------------------------------
 * Patients
 * ----------------------------------------------------------------------------------------------*/

export const listPatients: ApiEndpoint<Record<string, string>> = {
  scope: "patients:read",
  async handle({ caller, url }) {
    const q = parseQuery(PatientsQuerySchema, url);
    const after = cursorOf(q.cursor);
    const limit = q.limit ?? API_LIMITS.patientPageMax;
    const rows = await listApiPatients(caller.ctx, caller.tenantId, {
      name: q.name,
      dateOfBirth: q.dateOfBirth,
      email: q.email,
      status: q.status ?? "active",
      siteIds: caller.siteIds,
      limit,
      afterId: after?.i ?? null,
    });
    const result = page(rows, limit, () => "");
    await logApiPatientReads(caller.ctx, caller.tenantId, caller.key.id, result.data.map((p) => p.id), "list", caller.actor);
    return { body: result };
  },
};

export const getPatientById: ApiEndpoint<IdParams> = {
  scope: "patients:read",
  async handle({ caller, params }) {
    const p = await getApiPatient(caller.ctx, caller.tenantId, idOf(params), caller.siteIds);
    if (!p) throw new ApiError("NOT_FOUND");
    await logApiPatientReads(caller.ctx, caller.tenantId, caller.key.id, [p.id], "record", caller.actor);
    return { body: { data: p } };
  },
};

/* ------------------------------------------------------------------------------------------------
 * Invoices
 * ----------------------------------------------------------------------------------------------*/

export const listInvoices: ApiEndpoint<Record<string, string>> = {
  scope: "invoices:read",
  async handle({ caller, url }) {
    const q = parseQuery(InvoicesQuerySchema, url);
    const after = cursorOf(q.cursor);
    const limit = q.limit ?? API_LIMITS.pageDefault;
    const rows = await listApiInvoices(caller.ctx, caller.tenantId, { from: q.from, to: q.to, status: q.status, patientId: q.patientId, siteIds: caller.siteIds, limit, afterId: after?.i ?? null });
    return { body: page(rows, limit, () => "") };
  },
};

export const getInvoiceById: ApiEndpoint<IdParams> = {
  scope: "invoices:read",
  async handle({ caller, params }) {
    const inv = await getApiInvoice(caller.ctx, caller.tenantId, idOf(params), caller.siteIds);
    if (!inv) throw new ApiError("NOT_FOUND");
    return { body: { data: inv } };
  },
};
