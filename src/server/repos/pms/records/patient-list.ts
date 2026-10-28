/**
 * The patient list (records screens): one page of the clinic's patients with the list's filters and the total, and
 * the open case of each patient on the page. Read-only; plain indexed columns only – nothing is decrypted.
 *
 * Filters that need other tables use sub-queries that name tenant_id: an open case's lead practitioner or payer type
 * (pms_cases, shared record) and "no future appointment" (pms_appointments, the diary's table – read only). The
 * search words follow the shared record's quick search (src/server/repos/pms/patients.ts searchPatients).
 */
import { phoneDigits, searchKey } from "../../../../modules/pms/core/text";
import type { PatientStatus, PatientSummary, PayerType } from "../../../../modules/pms/core/types";
import { getPatientSummaries } from "../patients";
import { assertTenantId, num, type RepoContext } from "../context";

export interface PatientPageQuery {
  q?: string;
  status?: PatientStatus | "any";
  practitionerId?: string | null;
  payer?: PayerType | null;
  /** No booked or arrived appointment starting at or after `now`. */
  noFutureAppointment?: boolean;
  /** Only patients last seen on this date (YYYY-MM-DD). */
  lastSeenOn?: string | null;
  /** ISO time "now" for the future-appointment filter. */
  now: string;
  sort?: "asc" | "desc";
  /** Default 25, at most 500. */
  limit?: number;
  offset?: number;
}

export interface OpenCaseSummary {
  id: string;
  patientId: string;
  title: string;
  openedOn: string;
  practitionerId: string | null;
  payerType: PayerType;
  payerReferrerId: string | null;
}

const base = (ctx: RepoContext, tenantId: string) => ctx.db.selectFrom("pms_patients").where("pms_patients.tenant_id", "=", tenantId);
type PatientQuery = ReturnType<typeof base>;

function filtered(ctx: RepoContext, tenantId: string, q: PatientPageQuery): PatientQuery {
  let query = base(ctx, tenantId);
  const status = q.status ?? "active";
  if (status !== "any") query = query.where("pms_patients.status", "=", status);
  const text = (q.q ?? "").trim().slice(0, 120);
  if (text) {
    const ukDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    const digits = phoneDigits(text);
    if (ukDate || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const iso = ukDate ? `${ukDate[3]}-${ukDate[2].padStart(2, "0")}-${ukDate[1].padStart(2, "0")}` : text;
      query = query.where("pms_patients.date_of_birth", "=", iso);
    } else if (/^[0-9 +()-]+$/.test(text) && digits.length > 0) {
      const n = Number(digits);
      if (digits.length < 6) query = query.where("pms_patients.patient_number", "=", n);
      else if (digits.length <= 7) query = query.where((eb) => eb.or([eb("pms_patients.patient_number", "=", n), eb("pms_patients.search_phone", "like", `%${digits}%`)]));
      else query = query.where("pms_patients.search_phone", "like", `%${digits}%`);
    } else if (text.includes("@")) {
      query = query.where("pms_patients.email", "=", text.toLowerCase());
    } else {
      for (const word of searchKey(text).split(" ").filter(Boolean).slice(0, 5)) query = query.where("pms_patients.search_name", "like", `%${word}%`);
    }
  }
  if (q.practitionerId || q.payer) {
    query = query.where("pms_patients.id", "in", (eb) => {
      let sub = eb.selectFrom("pms_cases").select("pms_cases.patient_id").where("pms_cases.tenant_id", "=", tenantId).where("pms_cases.status", "=", "open");
      if (q.practitionerId) sub = sub.where("pms_cases.practitioner_id", "=", q.practitionerId);
      if (q.payer) sub = sub.where("pms_cases.payer_type", "=", q.payer);
      return sub;
    });
  }
  if (q.noFutureAppointment) {
    query = query.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("pms_appointments")
            .select("pms_appointments.id")
            .where("pms_appointments.tenant_id", "=", tenantId)
            .whereRef("pms_appointments.patient_id", "=", "pms_patients.id")
            .where("pms_appointments.starts_at", ">=", q.now)
            .where("pms_appointments.status", "in", ["booked", "arrived"]),
        ),
      ),
    );
  }
  if (q.lastSeenOn) query = query.where("pms_patients.last_seen_on", "=", q.lastSeenOn);
  return query;
}

/** One page of patients (summaries, in name order) and how many match in all. */
export async function listPatientPage(ctx: RepoContext, tenantId: string, q: PatientPageQuery): Promise<{ rows: PatientSummary[]; total: number }> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? 25)), 500);
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const dir = q.sort === "desc" ? "desc" : "asc";
  const [countRow, idRows] = await Promise.all([
    filtered(ctx, tenantId, q)
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirst(),
    filtered(ctx, tenantId, q)
      .select("pms_patients.id as id")
      .orderBy("pms_patients.last_name", dir)
      .orderBy("pms_patients.first_name", dir)
      .orderBy("pms_patients.patient_number", dir)
      .limit(limit)
      .offset(offset)
      .execute(),
  ]);
  const ids = idRows.map((r) => r.id);
  const summaries = await getPatientSummaries(ctx, tenantId, ids);
  return { rows: ids.map((id) => summaries.get(id)).filter((p): p is PatientSummary => Boolean(p)), total: num(countRow?.n ?? 0) };
}

/** Each patient's most recently opened open case (plain columns only – no referral reason). */
export async function openCasesFor(ctx: RepoContext, tenantId: string, patientIds: readonly string[]): Promise<Map<string, OpenCaseSummary>> {
  assertTenantId(tenantId);
  const out = new Map<string, OpenCaseSummary>();
  const unique = Array.from(new Set(patientIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_cases")
      .select(["id", "patient_id", "title", "opened_on", "practitioner_id", "payer_type", "payer_referrer_id"])
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "in", unique.slice(i, i + 90))
      .where("status", "=", "open")
      .orderBy("opened_on", "desc")
      .orderBy("id", "desc")
      .limit(500)
      .execute();
    for (const r of rows) {
      if (out.has(r.patient_id)) continue;
      out.set(r.patient_id, { id: r.id, patientId: r.patient_id, title: r.title, openedOn: r.opened_on, practitionerId: r.practitioner_id, payerType: r.payer_type as PayerType, payerReferrerId: r.payer_referrer_id });
    }
  }
  return out;
}
