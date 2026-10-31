import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, Notice, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { STATE_LABELS, pounds, ukDate } from "@/lib/billing/plans";
import { listBillingForPlatform } from "@/server/admin/billing";
import { requirePlatformAdmin } from "@/server/admin/guards";
import { listClinicsOverview } from "@/server/admin/platform-console";
import { holdOf } from "@/server/billing/access";
import { choiceOf } from "@/server/billing/views";
import { choiceLabel } from "@/lib/billing/plans";
import { getDb } from "@/server/db";
import { SignOutForm } from "../../session-forms";
import { OverrideForm, ResyncForm } from "./forms";

/**
 * /app/platform/billing – ClinForms staff only (everyone else gets the ordinary 404). Every open clinic's
 * subscription: plan, state, next payment, grace / read-only, practitioners against the band, test or live, and the
 * manual override (platform overrides win – src/server/admin/billing.ts). "Re-read" applies the payment service's
 * current copy, as a webhook event would.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscriptions – Platform" };

const TH = "px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-sm text-slate-800";

export default async function PlatformBillingPage() {
  const admin = await requirePlatformAdmin();
  const db = getDb();
  const clinics = (await listClinicsOverview(db)).filter((c) => !c.offboardedAt).map((c) => ({ tenantId: c.tenantId, name: c.name }));
  const list = await listBillingForPlatform(db, clinics);
  const now = new Date();
  const subscribed = list.rows.filter((r) => r.subscription);
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark compact />
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <Link href="/app/platform" className="truncate text-sm font-medium text-slate-800 underline-offset-4 hover:underline">
              Platform
            </Link>
            <span className="text-slate-300" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">Subscriptions</span>
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">ClinForms staff</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-slate-600 md:inline">{admin.email}</span>
            <SignOutForm>
              <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Signing out…">
                Sign out
              </SubmitButton>
            </SignOutForm>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[100rem] px-4 py-8">
        <PageHeader
          title="Subscriptions"
          description="Each clinic's plan at the payment account (ClinDesk band and Reports add-on, or ClinForms on its own). A clinic you manage by hand (override) keeps the packages you set; its subscription is only recorded. Prices ex VAT."
        />
        {!list.available ? (
          <div className="mb-6">
            <Notice tone="warning">The subscription tables are not on this database yet (migration 0009).</Notice>
          </div>
        ) : null}
        <Panel title={`Clinics with a subscription (${subscribed.length} of ${list.rows.length})`}>
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[1000px]" data-testid="platform-subscriptions">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Clinic</th>
                  <th className={TH}>Plan</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Next payment / ends</th>
                  <th className={TH}>Practitioners</th>
                  <th className={TH}>Mode</th>
                  <th className={TH}>Override</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => {
                  const s = r.subscription;
                  const choice = choiceOf(s);
                  const held = holdOf(s, now).held;
                  return (
                    <tr key={r.tenantId} className="border-b border-slate-100 last:border-0" data-tenant={r.tenantId}>
                      <td className={TD}>
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-slate-500">{r.tenantId}</span>
                      </td>
                      <td className={TD}>
                        {choice ? choiceLabel(choice) : "–"}
                        {s?.amountPence !== null && s?.amountPence !== undefined ? <span className="block text-xs text-slate-500">{`${pounds(s.amountPence)} ${s.interval === "year" ? "a year" : "a month"}`}</span> : null}
                      </td>
                      <td className={TD}>
                        {s ? STATE_LABELS[s.state] : "No plan"}
                        {s?.state === "past_due" ? <span className="block text-xs text-amber-800">{held ? "READ-ONLY" : `grace until ${ukDate(s.graceUntil)}`}</span> : null}
                        {s ? <span className="block text-xs text-slate-500">{s.status}</span> : null}
                      </td>
                      <td className={TD}>{s ? (s.cancelAtPeriodEnd ? `ends ${ukDate(s.currentPeriodEnd)}` : ukDate(s.currentPeriodEnd) || "–") : "–"}</td>
                      <td className={TD}>
                        {r.practitioners}
                        {s?.practitionersMax ? ` of ${s.practitionersMax}` : ""}
                        {s?.practitionersMax && r.practitioners > s.practitionersMax ? <span className="block text-xs text-amber-800">over the band</span> : null}
                      </td>
                      <td className={TD}>{s ? s.mode : "–"}</td>
                      <td className={TD}>{s ? (s.override ? `ON${s.overrideNote ? ` – ${s.overrideNote}` : ""}` : "off") : "–"}</td>
                      <td className={TD}>
                        {s ? (
                          <div className="flex flex-col gap-2">
                            <ResyncForm tenantId={r.tenantId} />
                            <OverrideForm tenantId={r.tenantId} on={s.override} />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    </>
  );
}
