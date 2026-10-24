/**
 * Where billing finds the appointments to invoice. The diary module owns appointments; billing reads them through
 * this interface so the two modules never import each other's tables.
 *
 * INTEGRATION (one line, by the orchestrator once the diary is merged): set CONFIGURED_SOURCE below to the diary's
 * adapter, e.g. `import { DIARY_VISIT_SOURCE } from "../diary/billing-visits";`. The adapter lists a patient's
 * appointments that can be charged (attended, did not attend, late cancellation) with their appointment type,
 * practitioner, site, case and date. Billing does the rest: it leaves out appointments already on an invoice (its
 * own lock), prices them from the case's price list and applies the clinic's charges for missed appointments.
 *
 * Until then the source is "not connected": the invoice form says so and treatments are added by hand (with
 * the same prices and VAT).
 */
import "server-only";
import type { BillableVisit } from "../../../modules/pms/billing/visits";
import type { RepoContext } from "../../repos/context";

export interface VisitQuery {
  patientId: string;
  /** Only this case's appointments (null = the patient's appointments with no case too). */
  caseId?: string | null;
  /** "YYYY-MM-DD", both included; default: the last 365 days to today. */
  from?: string;
  until?: string;
}

export interface BillableVisitSource {
  readonly id: string;
  /** False: nothing is listed and the screen explains why. */
  readonly connected: boolean;
  /** At most 200, oldest first, of THIS clinic only (the adapter scopes by tenant like any repository). */
  listChargeableVisits(ctx: RepoContext, tenantId: string, query: VisitQuery): Promise<BillableVisit[]>;
}

export const NOT_CONNECTED_SOURCE: BillableVisitSource = {
  id: "none",
  connected: false,
  listChargeableVisits: async () => [],
};

/** The diary's adapter once integrated (see the file comment). */
const CONFIGURED_SOURCE: BillableVisitSource | null = null;

let override: BillableVisitSource | null = null;

/** Tests (and the demo seed) may supply their own source. */
export function setBillableVisitSourceForTests(source: BillableVisitSource | null): void {
  override = source;
}

export function billableVisitSource(): BillableVisitSource {
  return override ?? CONFIGURED_SOURCE ?? NOT_CONNECTED_SOURCE;
}
