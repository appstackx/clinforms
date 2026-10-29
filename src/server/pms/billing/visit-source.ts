/**
 * Where billing finds the appointments to invoice. The diary module owns appointments; billing reads them through
 * this interface so the two modules never import each other's tables.
 *
 * CONNECTED (M5): CONFIGURED_SOURCE is the diary's adapter (src/server/pms/diary/billing-visits.ts). It lists the
 * appointments that can be charged – CHARGEABLE_STATUSES only (contract §6): completed ("attended"), and did not
 * attend / late cancellation when the diary flagged a fee; "arrived" and "in treatment" are NOT chargeable – with
 * their appointment type, practitioner, site, case, authorisation and date. Billing does the rest: it leaves out
 * appointments already on an invoice (its own lock), prices them from the case's price list and applies the
 * clinic's charges for missed appointments.
 */
import "server-only";
import type { Expression, SqlBool } from "kysely";
import type { BillableVisit } from "../../../modules/pms/billing/visits";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { RepoContext } from "../../repos/context";
import { DIARY_VISIT_SOURCE } from "../diary/billing-visits";

export interface VisitQuery {
  patientId: string;
  /** Only this case's appointments (null = the patient's appointments with no case too). */
  caseId?: string | null;
  /** "YYYY-MM-DD", both included; default: the last 365 days to today. */
  from?: string;
  until?: string;
}

export interface ClinicVisitQuery {
  /** "YYYY-MM-DD", both included. */
  from: string;
  until: string;
  /** The member's site scope (null = every site). */
  siteIds: ReadonlySet<string> | null;
  /** Only these appointments (invoicing a chosen set). */
  appointmentIds?: readonly string[];
  /** At most 500. */
  limit?: number;
}

export interface UninvoicedVisitQuery {
  /** "YYYY-MM-DD", both included. */
  from: string;
  until: string;
  /** The member's site scope (null = every site). */
  siteIds: ReadonlySet<string> | null;
  /**
   * Billing's own test "this appointment is not on an invoice", given the appointment's tenant and id columns
   * (a NOT EXISTS over billing's invoice lines): the adapter puts it in its query as it is, so the diary never
   * names billing's tables and the list is filtered in the database, not after a capped read.
   */
  notBilled: (appointment: { tenantId: Expression<string>; id: Expression<string> }) => Expression<SqlBool>;
  /** At most 500 (default 500). */
  limit?: number;
  /** Keyset: only visits older than this one (the last of the previous page). */
  before?: { startsAt: string; id: string } | null;
}

export interface BillableVisitSource {
  readonly id: string;
  /** False: nothing is listed and the screen explains why. */
  readonly connected: boolean;
  /** At most 200, oldest first, of THIS clinic only (the adapter scopes by tenant like any repository). */
  listChargeableVisits(ctx: RepoContext, tenantId: string, query: VisitQuery): Promise<BillableVisit[]>;
  /** Every patient's chargeable visits in a period (the "Attended, not invoiced" list), oldest first. */
  listClinicVisits(ctx: RepoContext, tenantId: string, query: ClinicVisitQuery): Promise<BillableVisit[]>;
  /**
   * The chargeable visits in a period that billing has not invoiced (notBilled), NEWEST first, a page at a time
   * by keyset, and how many there are in all (the "and N more" of the list, the figure on Billing and Today).
   */
  listUninvoicedVisits(ctx: RepoContext, tenantId: string, query: UninvoicedVisitQuery): Promise<{ visits: BillableVisit[]; total: number; next: { startsAt: string; id: string } | null }>;
  /** Waives the fee of a did-not-attend or late-cancelled visit (it leaves the list). False when there was none. */
  waiveFee(ctx: RepoContext, tenantId: string, appointmentId: string, actor: PmsActor): Promise<boolean>;
}

export const NOT_CONNECTED_SOURCE: BillableVisitSource = {
  id: "none",
  connected: false,
  listChargeableVisits: async () => [],
  listClinicVisits: async () => [],
  listUninvoicedVisits: async () => ({ visits: [], total: 0, next: null }),
  waiveFee: async () => false,
};

/** The diary's adapter (src/server/pms/diary/billing-visits.ts), wired at M5. */
const CONFIGURED_SOURCE: BillableVisitSource | null = DIARY_VISIT_SOURCE;

let override: BillableVisitSource | null = null;

/** Tests (and the demo seed) may supply their own source. */
export function setBillableVisitSourceForTests(source: BillableVisitSource | null): void {
  override = source;
}

export function billableVisitSource(): BillableVisitSource {
  return override ?? CONFIGURED_SOURCE ?? NOT_CONNECTED_SOURCE;
}
