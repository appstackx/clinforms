/**
 * The public clinic API's reads (tracker xt03): appointments, patients and invoices of ONE clinic, in an API key's
 * site scope, with keyset (cursor) paging. Nothing is decrypted – no _enc column is selected – and no clinical note,
 * booking note, invoice description, diagnosis or bill-to text leaves through here.
 *
 * Site scope (null = every site), as for staff (src/server/pms/access.ts, src/server/pms/billing/access.ts):
 *   appointments – their site is in scope;
 *   patients     – patientSiteFilter (a case or appointment at a site in scope, or neither anywhere yet);
 *   invoices     – their site is in scope (an invoice without a site needs every site) AND the patient is visible.
 *
 * Patient reads are written to the patient's history (audit rows with the patient as target, like a staff read of
 * a clinical note – src/server/repos/pms/records/notes.ts recordNoteView), one row per patient returned.
 */
import type { ExpressionBuilder } from "kysely";
import { formatDocumentNumber } from "../../../../modules/pms/billing/numbers";
import { searchKey } from "../../../../modules/pms/core/text";
import type { Database } from "../../../db/schema";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { patientSiteFilter } from "../access";
import { assertTenantId, num, pmsAuditQuery, type DbContext, type PmsActor } from "../context";
import { patientReadsQuery } from "./api-keys";

export interface KeysetAfter {
  /** Sort value of the last row ("" when the list is ordered by id only). */
  s: string;
  i: string;
}

const scopeList = (siteIds: ReadonlySet<string> | null): string[] | null => (siteIds ? Array.from(siteIds).slice(0, 90) : null);

/* ------------------------------------------------------------------------------------------------
 * Appointments
 * ----------------------------------------------------------------------------------------------*/

export interface ApiAppointment {
  id: string;
  /** booked | arrived | in_treatment | attended | dna | late_cancelled | cancelled */
  status: string;
  date: string;
  startsAt: string;
  endsAt: string;
  siteId: string;
  practitionerId: string | null;
  roomId: string | null;
  patientId: string | null;
  caseId: string | null;
  serviceId: string | null;
  /** staff | online | import */
  source: string;
  feeDue: boolean;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const APPT_COLUMNS = [
  "id",
  "status",
  "treatment_started_at",
  "starts_on",
  "starts_at",
  "ends_at",
  "site_id",
  "practitioner_id",
  "room_id",
  "patient_id",
  "case_id",
  "service_id",
  "source",
  "fee_due",
  "cancelled_at",
  "created_at",
  "updated_at",
] as const;

type ApptRow = {
  id: string;
  status: string;
  treatment_started_at: string | null;
  starts_on: string;
  starts_at: string;
  ends_at: string;
  site_id: string;
  practitioner_id: string | null;
  room_id: string | null;
  patient_id: string | null;
  case_id: string | null;
  service_id: string | null;
  source: string;
  fee_due: number;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

function toAppointment(r: ApptRow): ApiAppointment {
  return {
    id: r.id,
    status: r.status === "arrived" && r.treatment_started_at ? "in_treatment" : r.status,
    date: r.starts_on,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    siteId: r.site_id,
    practitionerId: r.practitioner_id,
    roomId: r.room_id,
    patientId: r.patient_id,
    caseId: r.case_id,
    serviceId: r.service_id,
    source: r.source,
    feeDue: num(r.fee_due) === 1,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ApiAppointmentsQuery {
  /** [from, to) instants (ISO UTC). */
  from: string;
  to: string;
  siteId?: string;
  practitionerId?: string;
  status?: string;
  siteIds: ReadonlySet<string> | null;
  limit: number;
  after?: KeysetAfter | null;
}

/** Up to limit + 1 appointments (the extra one says "there is a next page"), by start then id. */
export async function listApiAppointments(ctx: DbContext, tenantId: string, q: ApiAppointmentsQuery): Promise<ApiAppointment[]> {
  assertTenantId(tenantId);
  let query = ctx.db
    .selectFrom("pms_appointments")
    .select(APPT_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", "appointment")
    .where("starts_at", ">=", q.from)
    .where("starts_at", "<", q.to);
  const scope = scopeList(q.siteIds);
  if (scope) {
    if (scope.length === 0) return [];
    query = query.where("site_id", "in", scope);
  }
  if (q.siteId) query = query.where("site_id", "=", q.siteId);
  if (q.practitionerId) query = query.where("practitioner_id", "=", q.practitionerId);
  if (q.status === "in_treatment") query = query.where("status", "=", "arrived").where("treatment_started_at", "is not", null);
  else if (q.status === "arrived") query = query.where("status", "=", "arrived").where("treatment_started_at", "is", null);
  else if (q.status) query = query.where("status", "=", q.status);
  const after = q.after;
  if (after) query = query.where((eb) => eb.or([eb("starts_at", ">", after.s), eb.and([eb("starts_at", "=", after.s), eb("id", ">", after.i)])]));
  const rows = await query.orderBy("starts_at").orderBy("id").limit(q.limit + 1).execute();
  return rows.map((r) => toAppointment(r as ApptRow));
}

export async function getApiAppointment(ctx: DbContext, tenantId: string, id: string, siteIds: ReadonlySet<string> | null): Promise<ApiAppointment | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_appointments").select(APPT_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).where("kind", "=", "appointment").executeTakeFirst();
  if (!row || (siteIds && !siteIds.has(row.site_id))) return null;
  return toAppointment(row as ApptRow);
}

/* ------------------------------------------------------------------------------------------------
 * Patients (minimal fields)
 * ----------------------------------------------------------------------------------------------*/

export interface ApiPatientSummary {
  id: string;
  patientNumber: number;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  status: string;
}

export interface ApiPatient extends ApiPatientSummary {
  title: string | null;
  email: string | null;
  phoneMobile: string | null;
  postcode: string | null;
  reminderSms: boolean;
  reminderEmail: boolean;
  createdAt: string;
  updatedAt: string;
}

const PATIENT_SUMMARY = ["id", "patient_number", "first_name", "last_name", "preferred_name", "date_of_birth", "status"] as const;

type PatientRow = { id: string; patient_number: number; first_name: string; last_name: string; preferred_name: string | null; date_of_birth: string | null; status: string };

function toSummary(r: PatientRow): ApiPatientSummary {
  return { id: r.id, patientNumber: num(r.patient_number), firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name, dateOfBirth: r.date_of_birth, status: r.status };
}

export interface ApiPatientsQuery {
  name?: string;
  dateOfBirth?: string;
  email?: string;
  /** "any" = every status. */
  status: string;
  siteIds: ReadonlySet<string> | null;
  limit: number;
  afterId?: string | null;
}

export async function listApiPatients(ctx: DbContext, tenantId: string, q: ApiPatientsQuery): Promise<ApiPatientSummary[]> {
  assertTenantId(tenantId);
  let query = ctx.db.selectFrom("pms_patients").select(PATIENT_SUMMARY).where("tenant_id", "=", tenantId).where("merged_into_id", "is", null);
  if (q.siteIds) query = query.where(patientSiteFilter(tenantId, q.siteIds));
  if (q.status !== "any") query = query.where("status", "=", q.status);
  if (q.dateOfBirth) query = query.where("date_of_birth", "=", q.dateOfBirth);
  if (q.email) query = query.where("email", "=", q.email.toLowerCase());
  if (q.name) for (const word of searchKey(q.name).split(" ").filter(Boolean).slice(0, 5)) query = query.where("search_name", "like", `%${word}%`);
  if (q.afterId) query = query.where("id", ">", q.afterId);
  const rows = await query.orderBy("id").limit(q.limit + 1).execute();
  return rows.map((r) => toSummary(r as PatientRow));
}

export async function getApiPatient(ctx: DbContext, tenantId: string, id: string, siteIds: ReadonlySet<string> | null): Promise<ApiPatient | null> {
  assertTenantId(tenantId);
  let query = ctx.db
    .selectFrom("pms_patients")
    .select([...PATIENT_SUMMARY, "title", "email", "phone_mobile", "postcode", "reminder_sms", "reminder_email", "created_at", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("merged_into_id", "is", null);
  if (siteIds) query = query.where(patientSiteFilter(tenantId, siteIds));
  const r = await query.executeTakeFirst();
  if (!r) return null;
  return {
    ...toSummary(r as PatientRow),
    title: r.title,
    email: r.email,
    phoneMobile: r.phone_mobile,
    postcode: r.postcode,
    reminderSms: num(r.reminder_sms) === 1,
    reminderEmail: num(r.reminder_email) === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Writes the reads to each patient's history: one audit row per patient ("pms.api.patient_read", the key in the
 * detail – shown as "API key “…”" in the history), plus the key's patient-read counter, in one batch (≤ 51
 * statements: the gateway takes 100).
 */
export async function logApiPatientReads(ctx: DbContext, tenantId: string, keyId: string, patientIds: readonly string[], kind: "list" | "record", actor: PmsActor = { userId: null, sessionId: null }): Promise<void> {
  assertTenantId(tenantId);
  const ids = Array.from(new Set(patientIds)).slice(0, 90);
  if (ids.length === 0) return;
  const queries: BatchQuery[] = ids.map((id) =>
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.api.patient_read", targetType: "pms_patient", targetId: id, detail: { apiKeyId: keyId, via: "api", kind } }),
  );
  queries.push(patientReadsQuery(ctx, tenantId, keyId, ids.length));
  await runBatch(ctx.db, queries);
}

/** Whether a patient of the clinic exists, is not merged away and is in the site scope (booking). */
export async function apiPatientVisible(ctx: DbContext, tenantId: string, id: string, siteIds: ReadonlySet<string> | null): Promise<{ status: string } | null> {
  assertTenantId(tenantId);
  let query = ctx.db.selectFrom("pms_patients").select(["status"]).where("tenant_id", "=", tenantId).where("id", "=", id).where("merged_into_id", "is", null);
  if (siteIds) query = query.where(patientSiteFilter(tenantId, siteIds));
  return (await query.executeTakeFirst()) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Invoices
 * ----------------------------------------------------------------------------------------------*/

export interface ApiInvoiceSummary {
  id: string;
  /** The clinic's invoice number once issued (as on the invoice), null for a draft. */
  number: string | null;
  status: string;
  patientId: string;
  caseId: string | null;
  siteId: string | null;
  billTo: string;
  payerType: string;
  payerReferrerId: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  firstServiceOn: string | null;
  lastServiceOn: string | null;
  netPence: number;
  vatPence: number;
  totalPence: number;
  paidPence: number;
  creditedPence: number;
  balancePence: number;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiInvoiceLine {
  lineNo: number;
  kind: string;
  serviceId: string | null;
  appointmentId: string | null;
  practitionerId: string | null;
  serviceOn: string | null;
  billingCode: string | null;
  quantity: number;
  unitPricePence: number;
  discountPence: number;
  vatRateBasisPoints: number;
  netPence: number;
  vatPence: number;
  totalPence: number;
  creditedPence: number;
}

export interface ApiInvoice extends ApiInvoiceSummary {
  lines: ApiInvoiceLine[];
}

const INVOICE_COLUMNS = [
  "id",
  "number_prefix",
  "number_seq",
  "status",
  "patient_id",
  "case_id",
  "site_id",
  "bill_to",
  "payer_type",
  "payer_referrer_id",
  "issued_on",
  "due_on",
  "first_service_on",
  "last_service_on",
  "net_pence",
  "vat_pence",
  "total_pence",
  "paid_pence",
  "credited_pence",
  "voided_at",
  "created_at",
  "updated_at",
] as const;

type InvoiceRow = {
  id: string;
  number_prefix: string | null;
  number_seq: number | null;
  status: string;
  patient_id: string;
  case_id: string | null;
  site_id: string | null;
  bill_to: string;
  payer_type: string;
  payer_referrer_id: string | null;
  issued_on: string | null;
  due_on: string | null;
  first_service_on: string | null;
  last_service_on: string | null;
  net_pence: number;
  vat_pence: number;
  total_pence: number;
  paid_pence: number;
  credited_pence: number;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

function invoiceNumber(prefix: string | null, seq: number | null): string | null {
  return seq === null || seq === undefined ? null : formatDocumentNumber(prefix, num(seq));
}

function toInvoice(r: InvoiceRow): ApiInvoiceSummary {
  const total = num(r.total_pence);
  const paid = num(r.paid_pence);
  const credited = num(r.credited_pence);
  return {
    id: r.id,
    number: invoiceNumber(r.number_prefix, r.number_seq),
    status: r.status,
    patientId: r.patient_id,
    caseId: r.case_id,
    siteId: r.site_id,
    billTo: r.bill_to,
    payerType: r.payer_type,
    payerReferrerId: r.payer_referrer_id,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    firstServiceOn: r.first_service_on,
    lastServiceOn: r.last_service_on,
    netPence: num(r.net_pence),
    vatPence: num(r.vat_pence),
    totalPence: total,
    paidPence: paid,
    creditedPence: credited,
    balancePence: r.status === "issued" ? total - paid - credited : 0,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The invoice's site and patient in the scope (null scope = everything). */
function invoiceScope(tenantId: string, siteIds: ReadonlySet<string> | null) {
  return (eb: ExpressionBuilder<Database, "pms_invoices">) => {
    const ids = scopeList(siteIds) ?? [];
    const patients = eb.selectFrom("pms_patients").select("pms_patients.id").where("pms_patients.tenant_id", "=", tenantId).where(patientSiteFilter(tenantId, siteIds));
    return eb.and([ids.length > 0 ? eb("pms_invoices.site_id", "in", ids) : eb.val(false), eb("pms_invoices.patient_id", "in", patients)]);
  };
}

export interface ApiInvoicesQuery {
  /** Issued between these UK dates (inclusive). */
  from?: string;
  to?: string;
  status?: string;
  patientId?: string;
  siteIds: ReadonlySet<string> | null;
  limit: number;
  afterId?: string | null;
}

export async function listApiInvoices(ctx: DbContext, tenantId: string, q: ApiInvoicesQuery): Promise<ApiInvoiceSummary[]> {
  assertTenantId(tenantId);
  let query = ctx.db.selectFrom("pms_invoices").select(INVOICE_COLUMNS).where("pms_invoices.tenant_id", "=", tenantId);
  if (q.siteIds) query = query.where(invoiceScope(tenantId, q.siteIds));
  if (q.from && q.to) query = query.where("issued_on", ">=", q.from).where("issued_on", "<=", q.to);
  if (q.status) query = query.where("status", "=", q.status);
  if (q.patientId) query = query.where("patient_id", "=", q.patientId);
  if (q.afterId) query = query.where("pms_invoices.id", ">", q.afterId);
  const rows = await query.orderBy("pms_invoices.id").limit(q.limit + 1).execute();
  return rows.map((r) => toInvoice(r as InvoiceRow));
}

export async function getApiInvoice(ctx: DbContext, tenantId: string, id: string, siteIds: ReadonlySet<string> | null): Promise<ApiInvoice | null> {
  assertTenantId(tenantId);
  let query = ctx.db.selectFrom("pms_invoices").select(INVOICE_COLUMNS).where("pms_invoices.tenant_id", "=", tenantId).where("pms_invoices.id", "=", id);
  if (siteIds) query = query.where(invoiceScope(tenantId, siteIds));
  const row = await query.executeTakeFirst();
  if (!row) return null;
  const lines = await ctx.db
    .selectFrom("pms_invoice_lines")
    .select(["line_no", "kind", "service_id", "appointment_id", "practitioner_id", "service_on", "billing_code", "quantity", "unit_price_pence", "discount_pence", "vat_rate_bp", "net_pence", "vat_pence", "total_pence", "credited_pence"])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", id)
    .orderBy("line_no")
    .limit(500)
    .execute();
  return {
    ...toInvoice(row as InvoiceRow),
    lines: lines.map((l) => ({
      lineNo: num(l.line_no),
      kind: l.kind,
      serviceId: l.service_id,
      appointmentId: l.appointment_id,
      practitionerId: l.practitioner_id,
      serviceOn: l.service_on,
      billingCode: l.billing_code,
      quantity: num(l.quantity),
      unitPricePence: num(l.unit_price_pence),
      discountPence: num(l.discount_pence),
      vatRateBasisPoints: num(l.vat_rate_bp),
      netPence: num(l.net_pence),
      vatPence: num(l.vat_pence),
      totalPence: num(l.total_pence),
      creditedPence: num(l.credited_pence),
    })),
  };
}
