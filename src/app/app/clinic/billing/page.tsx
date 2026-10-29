import { BillingList, type BillingTab } from "@/components/pms/billing/billing-list";
import { INVOICE_LIST_STATES, type InvoiceListState } from "@/server/repos/pms/billing/invoices";
import { requireClinicActor } from "@/server/pms/actor";
import { agedDebtFor, billingHomeFor, payerAccountsFor, recentRemittancesFor, statementAccountsFor, uninvoicedVisitsFor } from "@/server/pms/billing/views";
import { pmsNow } from "../../../../modules/pms/core/clock";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Billing" }, "billing.view");

const TABS: readonly BillingTab[] = ["invoices", "visits", "aged", "remittances", "statements"];

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * /app/clinic/billing (design round 2c): totals, then the tab in the URL (?tab=invoices|visits|aged|remittances|
 * statements) with the invoice list's ?state, ?q and ?page. billing.view; the "Attended, not invoiced" tab and the
 * header button need billing.edit, remittances billing.pay, the CSV reports.export.
 */
export default async function BillingPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const tabParam = one(searchParams.tab) as BillingTab;
  const tab: BillingTab = TABS.includes(tabParam) && (tabParam !== "visits" || actor.can("billing.edit")) ? tabParam : "invoices";
  const stateParam = one(searchParams.state) as InvoiceListState;
  const state: InvoiceListState = (INVOICE_LIST_STATES as readonly string[]).includes(stateParam) ? stateParam : "all";
  const q = one(searchParams.q).slice(0, 80);
  const page = Math.max(1, Math.min(1000, Number(one(searchParams.page)) || 1));
  const home = await billingHomeFor(actor, { state, q, page });
  const [visits, aged, remittances, accounts] = await Promise.all([
    tab === "visits" ? uninvoicedVisitsFor(actor) : null,
    tab === "aged" ? agedDebtFor(actor) : null,
    tab === "remittances" ? recentRemittancesFor(actor) : null,
    tab === "statements" ? statementAccountsFor(actor) : null,
  ]);
  void payerAccountsFor;
  const failed = !home.ok ? home.error : visits && !visits.ok ? visits.error : aged && !aged.ok ? aged.error : remittances && !remittances.ok ? remittances.error : accounts && !accounts.ok ? accounts.error : null;
  const h = home.ok ? home.value : null;
  return (
    <BillingList
      tab={tab}
      figures={
        h?.figures ?? { outstandingPence: 0, outstandingCount: 0, outstandingPatientsPence: 0, outstandingAccountsPence: 0, overduePence: 0, overdueCount: 0, takenTodayPence: 0, takenTodayByMethod: [], drafts: 0, uninvoicedVisits: 0 }
      }
      rows={h?.rows ?? []}
      total={h?.total ?? 0}
      page={h?.page ?? page}
      pageSize={h?.pageSize ?? 25}
      state={state}
      q={q}
      visits={visits && visits.ok ? visits.value.visits : null}
      aged={aged && aged.ok ? aged.value : null}
      remittances={remittances && remittances.ok ? remittances.value : null}
      statementAccounts={accounts && accounts.ok ? accounts.value : null}
      today={h?.today ?? pmsNow().toISOString().slice(0, 10)}
      can={{ edit: actor.can("billing.edit"), pay: actor.can("billing.pay"), export: actor.can("reports.export") }}
      failed={failed}
    />
  );
}
