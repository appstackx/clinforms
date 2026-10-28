/**
 * The diary's side of billing's visit source (src/server/pms/billing/visit-source.ts, wired at M5): the
 * appointments billing may charge, read from `pms_appointments` of ONE clinic.
 *
 * Chargeable = CHARGEABLE_STATUSES (contract §6, src/modules/pms/diary/rules.ts): completed ("attended"), and did
 * not attend / late cancellation ONLY when the diary flagged a fee (fee_due). "Arrived" and "in treatment" (stored
 * as arrived + treatment_started_at) are never listed – a visit is not billable until it is completed.
 * Billing leaves out what is already on an invoice (its own lock) and prices the rest.
 */
import "server-only";
import type { Selectable } from "kysely";
import { DIARY_TO_VISIT_STATUS, type BillableVisit } from "../../../modules/pms/billing/visits";
import { CHARGEABLE_STATUSES } from "../../../modules/pms/diary/rules";
import { formatLondonTime } from "../../../modules/pms/diary/time";
import { ukToday } from "../../../modules/pms/core/text";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { PmsAppointmentsTable } from "../../db/pms-schema/diary";
import { assertId, assertTenantId, type RepoContext } from "../../repos/context";
import { waiveAppointmentFee } from "../../repos/pms/diary/appointments";
import type { BillableVisitSource, ClinicVisitQuery, VisitQuery } from "../billing/visit-source";
import { pmsNow } from "../../../modules/pms/core/clock";

const COLUMNS = ["id", "patient_id", "case_id", "service_id", "practitioner_id", "site_id", "authorisation_id", "starts_at", "starts_on", "status", "fee_due", "fee_pence"] as const;
type Row = Pick<Selectable<PmsAppointmentsTable>, (typeof COLUMNS)[number]>;

function toVisit(r: Row): BillableVisit | null {
  const status = DIARY_TO_VISIT_STATUS[r.status];
  if (!status || !r.patient_id || !r.service_id) return null;
  return {
    appointmentId: r.id,
    patientId: r.patient_id,
    caseId: r.case_id,
    serviceId: r.service_id,
    practitionerId: r.practitioner_id,
    siteId: r.site_id,
    date: r.starts_on,
    startTime: formatLondonTime(r.starts_at),
    status,
    authorisationId: r.authorisation_id,
    feePence: r.fee_pence === null || r.fee_pence === undefined ? null : Number(r.fee_pence),
  };
}

function chargeable(ctx: RepoContext, tenantId: string) {
  return ctx.db
    .selectFrom("pms_appointments")
    .select(COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", "appointment")
    .where("status", "in", CHARGEABLE_STATUSES as unknown as string[])
    .where((eb) => eb.or([eb("status", "=", "attended"), eb("fee_due", "=", 1)]));
}

function today(ctx: RepoContext): string {
  return ukToday(ctx.now ? ctx.now() : pmsNow());
}

export const DIARY_VISIT_SOURCE: BillableVisitSource = {
  id: "diary",
  connected: true,
  async listChargeableVisits(ctx, tenantId, query: VisitQuery) {
    assertTenantId(tenantId);
    assertId(query.patientId, "patient id");
    const until = query.until ?? today(ctx);
    let q = chargeable(ctx, tenantId).where("patient_id", "=", query.patientId).where("starts_on", "<=", until);
    if (query.from) q = q.where("starts_on", ">=", query.from);
    if (query.caseId !== undefined) q = query.caseId === null ? q.where("case_id", "is", null) : q.where("case_id", "=", query.caseId);
    const rows = await q.orderBy("starts_at").orderBy("id").limit(200).execute();
    return rows.map(toVisit).filter((v): v is BillableVisit => v !== null);
  },
  async listClinicVisits(ctx, tenantId, query: ClinicVisitQuery) {
    assertTenantId(tenantId);
    let q = chargeable(ctx, tenantId).where("starts_on", ">=", query.from).where("starts_on", "<=", query.until);
    if (query.siteIds) {
      const ids = Array.from(query.siteIds).slice(0, 90);
      if (ids.length === 0) return [];
      q = q.where("site_id", "in", ids);
    }
    if (query.appointmentIds) {
      const ids = Array.from(new Set(query.appointmentIds)).slice(0, 90);
      if (ids.length === 0) return [];
      q = q.where("id", "in", ids);
    }
    const rows = await q
      .orderBy("starts_at")
      .orderBy("id")
      .limit(Math.min(500, Math.max(1, query.limit ?? 500)))
      .execute();
    return rows.map(toVisit).filter((v): v is BillableVisit => v !== null);
  },
  async waiveFee(ctx, tenantId, appointmentId, actor: PmsActor) {
    return waiveAppointmentFee(ctx, tenantId, appointmentId, actor);
  },
};
