/**
 * The patient list (records screens) and its CSV export. Rules: ./access.ts.
 *
 *   patients.view   – the list: search, filters (status, open case's practitioner and payer, no future
 *                     appointment, seen today), the next appointment and the open case of each row
 *   reports.export – the CSV export of the filtered list (owners and administrators); recorded in the clinic's audit
 *                     log (counts and filter names only)
 *
 * Nothing here is decrypted: names, dates of birth and phone numbers are the shared record's plain columns; a row
 * says only THAT the patient has a medical alert. The next appointment comes from the diary's merged repository
 * (nextAppointmentsFor), read only.
 *
 * Billing (M5): the "Balance" column (what the patient owes on their own issued invoices – billing.view only) and the
 *   "Owes money" filter. "Payer" is answered from the open case's payer type (shared record).
 * Site scope (K2-SITE-004): the list and its export show only patients visible at the member's sites (actor.siteIds,
 * src/server/pms/access.ts patientSiteFilter).
 */
import { formatUkDate, ukToday } from "../../../modules/pms/core/text";
import type { PatientStatus, PayerType } from "../../../modules/pms/core/types";
import { ageOn } from "../../../modules/pms/records/form-values";
import { PAYER_TYPE_LABELS } from "../../../modules/pms/records/copy";
import { MAX_EXPORT_ROWS, PATIENT_PAGE_SIZE, csvLine, type PatientListFilters } from "../../../modules/pms/records/patient-list";
import { listPractitioners, findPractitionerByUser } from "../../repos/pms/directory";
import { nextAppointmentsFor } from "../../repos/pms/diary/appointments";
import { listReferrers } from "../../repos/pms/referrers";
import { pmsAudit } from "../../repos/pms/context";
import { listPatientPage, openCasesFor } from "../../repos/pms/records/patient-list";
import { patientBalances } from "../../repos/pms/billing/invoices";
import { attempt, guard, ok, type RecordsActor, type Result } from "./access";

export interface PatientListRow {
  id: string;
  patientNumber: number;
  title: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  age: number | null;
  phoneMobile: string | null;
  email: string | null;
  status: PatientStatus;
  hasAlerts: boolean;
  next: { startsAt: string; startsOn: string; practitionerName: string | null } | null;
  openCase: { id: string; title: string; payerType: PayerType; payerName: string | null; practitionerName: string | null } | null;
  /** What the patient owes (billing.view only; null without it). */
  balancePence: number | null;
}

export interface PatientListView {
  rows: PatientListRow[];
  total: number;
  page: number;
  pageSize: number;
  today: string;
  /** Choices for the practitioner filter (active practitioners). */
  practitioners: { id: string; name: string }[];
  /** The member's own practitioner record ("My patients"), if they are one. */
  myPractitionerId: string | null;
}

function nowOf(actor: RecordsActor): Date {
  const ctx = actor.repo();
  return ctx.now ? ctx.now() : new Date();
}

async function rowsFor(actor: RecordsActor, filters: PatientListFilters, limit: number, offset: number) {
  const ctx = actor.repo();
  const now = nowOf(actor);
  const today = ukToday(now);
  const page = await listPatientPage(ctx, actor.tenantId, {
    q: filters.q,
    status: filters.status,
    practitionerId: filters.practitionerId,
    payer: filters.payer,
    noFutureAppointment: filters.noFuture,
    lastSeenOn: filters.seenToday ? today : null,
    owesMoney: filters.owesMoney && actor.can("billing.view"),
    now: now.toISOString(),
    sort: filters.sort,
    siteIds: actor.siteIds ?? null,
    limit,
    offset,
  });
  const ids = page.rows.map((p) => p.id);
  const [next, cases, practitioners, referrers, balances] = await Promise.all([
    nextAppointmentsFor(ctx, actor.tenantId, ids, now.toISOString()),
    openCasesFor(ctx, actor.tenantId, ids),
    listPractitioners(ctx, actor.tenantId, { includeInactive: true }),
    listReferrers(ctx, actor.tenantId, { includeInactive: true, limit: 500 }),
    actor.can("billing.view") ? patientBalances(ctx, actor.tenantId, ids) : Promise.resolve(null),
  ]);
  const pracName = new Map(practitioners.map((p) => [p.id, p.displayName]));
  const refName = new Map(referrers.map((r) => [r.id, r.name]));
  const rows: PatientListRow[] = page.rows.map((p) => {
    const n = next.get(p.id);
    const c = cases.get(p.id);
    return {
      id: p.id,
      patientNumber: p.patientNumber,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      preferredName: p.preferredName,
      dateOfBirth: p.dateOfBirth,
      age: ageOn(p.dateOfBirth, today),
      phoneMobile: p.phoneMobile,
      email: p.email,
      status: p.status,
      hasAlerts: p.hasAlerts,
      next: n ? { startsAt: n.startsAt, startsOn: n.startsOn, practitionerName: n.practitionerId ? (pracName.get(n.practitionerId) ?? null) : null } : null,
      openCase: c
        ? { id: c.id, title: c.title, payerType: c.payerType, payerName: c.payerReferrerId ? (refName.get(c.payerReferrerId) ?? null) : null, practitionerName: c.practitionerId ? (pracName.get(c.practitionerId) ?? null) : null }
        : null,
      balancePence: balances ? Math.max(0, balances.get(p.id) ?? 0) : null,
    };
  });
  return { rows, total: page.total, today, practitioners };
}

/** One page of the patient list. */
export async function patientListFor(actor: RecordsActor, filters: PatientListFilters): Promise<Result<PatientListView>> {
  const denied = guard(actor, "patients.view");
  if (denied) return denied;
  return attempt("patient_list", async () => {
    const page = Math.max(1, filters.page);
    const { rows, total, today, practitioners } = await rowsFor(actor, filters, PATIENT_PAGE_SIZE, (page - 1) * PATIENT_PAGE_SIZE);
    const me = await findPractitionerByUser(actor.repo(), actor.tenantId, actor.userId);
    return ok({
      rows,
      total,
      page,
      pageSize: PATIENT_PAGE_SIZE,
      today,
      practitioners: practitioners.filter((p) => p.active).map((p) => ({ id: p.id, name: p.displayName })),
      myPractitionerId: me?.id ?? null,
    });
  });
}

export const PATIENT_CSV_HEADER = ["Patient number", "Title", "First name", "Last name", "Preferred name", "Date of birth", "Mobile", "Email", "Status", "Next appointment", "Open case", "Payer"] as const;

/** The filtered list as CSV (at most MAX_EXPORT_ROWS rows), audited. */
export async function patientCsvFor(actor: RecordsActor, filters: PatientListFilters): Promise<Result<{ csv: string; count: number; truncated: boolean }>> {
  const denied = guard(actor, "reports.export");
  if (denied) return denied;
  return attempt("patient_csv", async () => {
    const lines = [csvLine(PATIENT_CSV_HEADER)];
    let count = 0;
    let total = 0;
    for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += 500) {
      const page = await rowsFor(actor, { ...filters, page: 1 }, Math.min(500, MAX_EXPORT_ROWS - offset), offset);
      total = page.total;
      for (const r of page.rows) {
        lines.push(
          csvLine([
            r.patientNumber,
            r.title,
            r.firstName,
            r.lastName,
            r.preferredName,
            r.dateOfBirth ? formatUkDate(r.dateOfBirth) : "",
            r.phoneMobile,
            r.email,
            r.status,
            r.next ? `${formatUkDate(r.next.startsOn)} ${new Date(r.next.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}` : "",
            r.openCase?.title ?? "",
            r.openCase ? (r.openCase.payerName ?? PAYER_TYPE_LABELS[r.openCase.payerType]) : "",
          ]),
        );
      }
      count += page.rows.length;
      if (page.rows.length < 500) break;
    }
    const used = Object.entries({ q: Boolean(filters.q), status: filters.status !== "active", practitioner: Boolean(filters.practitionerId), payer: Boolean(filters.payer), noFuture: filters.noFuture, seenToday: filters.seenToday, owesMoney: filters.owesMoney })
      .filter(([, on]) => on)
      .map(([k]) => k);
    await pmsAudit(actor.repo(), actor.tenantId, actor.actor, { action: "pms.patients.export", targetType: "pms_patient_list", targetId: "patients", detail: { count, filters: used } });
    return ok({ csv: `${lines.join("\r\n")}\r\n`, count, truncated: total > count });
  });
}
