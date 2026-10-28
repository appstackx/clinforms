/**
 * Turning a patient's chargeable appointments into suggested invoice lines: the visit source (./visit-source.ts)
 * lists them, billing leaves out those already on an invoice, prices each from the case's price list (payer list →
 * default list → the appointment type's price) and applies the clinic's charges for missed appointments and the
 * appointment type's VAT code.
 */
import "server-only";
import { visitLine, type BillableVisit } from "../../../modules/pms/billing/visits";
import type { InvoiceLineInput } from "../../../modules/pms/billing/schemas";
import type { RepoContext } from "../../repos/context";
import { billedAppointmentIds } from "../../repos/pms/billing/invoices";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { priceFor } from "../../repos/pms/price-lists";
import { billableVisitSource, type VisitQuery } from "./visit-source";

export interface SuggestedVisitLine {
  visit: BillableVisit;
  /** null when the clinic does not charge for it (0 %) or the appointment type has no price. */
  line: InvoiceLineInput | null;
  priceSource: "list" | "default_list" | "service" | null;
}

export interface VisitSuggestions {
  connected: boolean;
  lines: SuggestedVisitLine[];
}

export async function suggestVisitLines(ctx: RepoContext, tenantId: string, query: VisitQuery, priceListId: string | null): Promise<VisitSuggestions> {
  const source = billableVisitSource();
  if (!source.connected) return { connected: false, lines: [] };
  const visits = (await source.listChargeableVisits(ctx, tenantId, query)).filter((v) => v.patientId === query.patientId).slice(0, 200);
  const billed = await billedAppointmentIds(
    ctx,
    tenantId,
    visits.map((v) => v.appointmentId),
  );
  const settings = await getBillingSettings(ctx, tenantId);
  const names = new Map<string, string>();
  const codes = new Map<string, string | null>();
  const serviceIds = Array.from(new Set(visits.map((v) => v.serviceId)));
  if (serviceIds.length) {
    const rows = await ctx.db.selectFrom("pms_services").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "in", serviceIds.slice(0, 90)).execute();
    for (const r of rows) names.set(r.id, r.name);
    if (priceListId) {
      const items = await ctx.db
        .selectFrom("pms_price_list_items")
        .select(["service_id", "billing_code"])
        .where("tenant_id", "=", tenantId)
        .where("price_list_id", "=", priceListId)
        .where("service_id", "in", serviceIds.slice(0, 90))
        .execute();
      for (const i of items) codes.set(i.service_id, i.billing_code);
    }
  }
  const lines: SuggestedVisitLine[] = [];
  for (const visit of visits) {
    if (billed.has(visit.appointmentId) || !names.has(visit.serviceId)) continue;
    const price = await priceFor(ctx, tenantId, visit.serviceId, priceListId);
    if (!price) {
      lines.push({ visit, line: null, priceSource: null });
      continue;
    }
    const line = visitLine(
      visit,
      { listPricePence: price.pricePence, billingCode: codes.get(visit.serviceId) ?? null, serviceName: names.get(visit.serviceId) as string, vatCode: settings.vatRegistered ? (settings.serviceVat[visit.serviceId] ?? "exempt") : "none" },
      settings,
    );
    lines.push({ visit, line, priceSource: price.source });
  }
  return { connected: true, lines };
}
