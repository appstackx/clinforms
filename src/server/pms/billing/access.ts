/**
 * The billing module's server layer (./views.ts, ./writes.ts) – what the billing screens' pages, server actions and
 * routes call. Same rules as the records services (src/server/pms/records/access.ts, reused here):
 *
 *   1. the member's permission is checked FIRST (billing.view / edit / pay / refund / void, reports.export);
 *   2. every id from the request is read back from the member's OWN clinic and site scope (`actor.siteIds`): an
 *      invoice of a site they cannot see, or of a patient they cannot see, is answered exactly like "no such
 *      invoice";
 *   3. inputs are validated with the module's zod schemas (the repositories validate again);
 *   4. a Result with a plain message – never a database message or patient data.
 */
import "server-only";
import type { Invoice } from "../../../modules/pms/billing/types";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { getInvoice } from "../../repos/pms/billing/invoices";
import { patientVisibleInScope } from "../access";
import { type RecordsActor } from "../records/access";

export { attempt, fail, forbidden, guard, notFound, ok, patientInClinic, testActor, type Failure, type Result } from "../records/access";

/** The member as the billing services need them (any ClinicActor; tests build one with testActor). */
export type BillingActor = RecordsActor;

export const BILLING_NOT_FOUND = "This invoice no longer exists in this clinic.";

/** Whether an invoice's site is in the member's scope (null scope = every site; an invoice with no site needs every site). */
export function invoiceSiteVisible(actor: BillingActor, siteId: string | null): boolean {
  const scope = actor.siteIds ?? null;
  if (scope === null) return true;
  return siteId !== null && scope.has(siteId);
}

/** An invoice of the request, read from the member's clinic, in their site scope and of a patient they can see. */
export async function invoiceInScope(actor: BillingActor, invoiceId: unknown): Promise<Invoice | null> {
  if (!isPlausibleRecordId(invoiceId)) return null;
  const inv = await getInvoice(actor.repo(), actor.tenantId, invoiceId);
  if (!inv || !invoiceSiteVisible(actor, inv.siteId)) return null;
  const scope = actor.siteIds ?? null;
  if (scope !== null && !(await patientVisibleInScope(actor.repo(), actor.tenantId, inv.patientId, scope))) return null;
  return inv;
}

/** A site id from the request, kept only when it is in the member's scope (else null). */
export function siteInScope(actor: BillingActor, siteId: unknown): string | null {
  if (!isPlausibleRecordId(siteId)) return null;
  return invoiceSiteVisible(actor, siteId) ? siteId : null;
}
