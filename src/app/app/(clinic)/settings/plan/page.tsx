import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { COMPANY } from "@/lib/site";
import { PLAN_COPY, SETUP_FEE_LABELS, formatPence, formatPenceExact, ofAllowanceText, reportsText, ukDateLabel } from "@/lib/packages";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { clinicPlanUsage, type ClinicPlanUsageManagerView } from "@/server/usage/view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan & usage" };

const UK_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });
const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 text-sm text-slate-800";

/**
 * Settings → Plan & usage (25/10/2026). Owners and administrators: the clinic's package, this month's reports against
 * the allowance, extra reports, the last 6 months, the trial and the drafting settings. Clinicians and staff: only
 * "This month: X of N reports". No tokens or costs, ever (ClinForms staff see those on the platform usage page).
 */
export default async function PlanUsagePage() {
  const { membership } = await requireAppContext();
  const view = await clinicPlanUsage(getDb(), { tenantId: membership.tenantId, role: membership.role });
  if (view.kind === "member") {
    return (
      <>
        <PageHeader title="Plan & usage" description={`Reports your clinic has used in ${view.periodLabel}.`} />
        <Panel>
          <p className="text-lg font-semibold text-slate-900" data-usage-short>
            {PLAN_COPY.shortLine(view.counted, view.included)}
          </p>
          <p className="mt-2 text-sm text-slate-600">{PLAN_COPY.rule}</p>
          <p className="mt-2 text-sm text-slate-600">{PLAN_COPY.managersOnly}</p>
        </Panel>
      </>
    );
  }
  return <ManagerView view={view} />;
}

function UsageBar({ counted, included }: { counted: number; included: number }) {
  const share = included > 0 ? Math.min(1, counted / included) : counted > 0 ? 1 : 0;
  const over = counted > included;
  return (
    <div
      role="progressbar"
      aria-label="Reports this month"
      aria-valuemin={0}
      aria-valuemax={included}
      aria-valuenow={Math.min(counted, included)}
      aria-valuetext={`${ofAllowanceText(counted, included)}${over ? `, ${counted - included} over the allowance` : ""}`}
      className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-teal-600"}`} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

function trialLine(trial: NonNullable<ClinicPlanUsageManagerView["trial"]>): string {
  const a = trial.access;
  if (a.state === "trial" && a.pending) return `Trial of ${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"}, starting when an owner first signs in.`;
  if (a.state === "trial") {
    const from = trial.startsAt ? `${UK_DATE.format(new Date(trial.startsAt))} – ` : "";
    return `Trial ${from}${trial.endsAt ? UK_DATE.format(new Date(trial.endsAt)) : ""} (${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"} left).`;
  }
  if (a.state === "trial_ended") return `Trial ended ${UK_DATE.format(new Date(a.endedAt))}.`;
  return "";
}

function ManagerView({ view }: { view: ClinicPlanUsageManagerView }) {
  const pkg = view.package;
  const m = view.thisMonth;
  const trialText = view.trial ? trialLine(view.trial) : "";
  const isTrial = pkg?.id === "trial" || Boolean(trialText && view.trial?.access.state !== "full");
  const name = pkg ? pkg.label : isTrial ? "Trial" : "No package yet";
  return (
    <>
      <PageHeader title="Plan & usage" description="Your clinic's package and the reports it has used. All sites and staff are included." />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Your package">
          <p className="text-lg font-semibold text-slate-900" data-package-name>
            {name}
            {pkg && pkg.id !== "trial" ? (
              <>
                {" "}
                <span className="ml-1 text-base font-normal text-slate-700">{formatPence(pkg.monthlyPricePence)} a month</span>
              </>
            ) : null}
          </p>
          {trialText ? <p className="mt-1 text-sm text-slate-700">{trialText}</p> : null}
          {pkg ? (
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              <li>Up to {reportsText(pkg.reportsIncluded)} a month</li>
              {pkg.id !== "trial" ? <li>Extra reports {formatPence(pkg.extraReportPence)} each</li> : null}
              {pkg.foundingPricePence !== null && pkg.foundingUntil ? (
                <li>
                  Founding price {formatPence(pkg.foundingPricePence)} a month, fixed until {ukDateLabel(pkg.foundingUntil)}
                  {pkg.foundingPricePence !== pkg.listPricePence ? ` (then ${formatPence(pkg.listPricePence)})` : ""}
                </li>
              ) : null}
              {pkg.setupFeePence !== null && pkg.setupFeeStatus ? (
                <li>
                  Set-up fee {formatPence(pkg.setupFeePence)} – {SETUP_FEE_LABELS[pkg.setupFeeStatus]}
                </li>
              ) : null}
              <li>Started {ukDateLabel(pkg.startsOn)}</li>
              <li>All your sites and staff included</li>
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-600">{PLAN_COPY.noPackage}</p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            {PLAN_COPY.exVat} Questions about your package: {COMPANY.contactEmail}.
          </p>
        </Panel>

        <Panel title={`This month (${view.periodLabel})`}>
          <p className="text-lg font-semibold text-slate-900" data-usage-month>
            {m.included === null ? reportsText(m.counted) : ofAllowanceText(m.counted, m.included)}
          </p>
          {m.included !== null ? <UsageBar counted={m.counted} included={m.included} /> : null}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-slate-500">Approved</dt>
              <dd className="font-medium text-slate-900">{m.approved}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{PLAN_COPY.inProgress}</dt>
              <dd className="font-medium text-slate-900">{m.inProgress}</dd>
            </div>
          </dl>
          {m.extra > 0 && m.extraReportPence !== null ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-usage-extra>
              <p className="font-medium">{PLAN_COPY.wouldBeCharged(m.extra, formatPence(m.extraReportPence), formatPenceExact(m.extraChargePence))}</p>
              <p className="mt-1">{PLAN_COPY.chargingLater}</p>
            </div>
          ) : null}
          <p className="mt-3 text-sm text-slate-600">{PLAN_COPY.rule}</p>
          <p className="mt-1 text-xs text-slate-500">{PLAN_COPY.again}</p>
        </Panel>
      </div>

      <Panel title="Last 6 months" className="mt-6">
        <div className="-mx-3 overflow-x-auto">
          <table className="min-w-full">
            <caption className="sr-only">Reports counted, approved and extra reports for each of the last 6 months</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className={TH}>
                  Month
                </th>
                <th scope="col" className={TH}>
                  Reports counted
                </th>
                <th scope="col" className={TH}>
                  Approved
                </th>
                <th scope="col" className={TH}>
                  Extra
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.history.map((h) => (
                <tr key={h.period}>
                  <th scope="row" className={`${TD} whitespace-nowrap text-left font-medium`}>
                    {h.label}
                  </th>
                  <td className={TD}>{h.included === null ? h.counted : `${h.counted} of ${h.included}`}</td>
                  <td className={TD}>{h.approved}</td>
                  <td className={TD}>{h.included === null ? "–" : h.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Drafting from the notes" className="mt-6">
        <p className="text-sm text-slate-700">
          {view.drafting.enabled ? "On for your clinic." : "Off for your clinic – answers from the notes are left for your clinicians to write."} You can change
          this in Clinic details.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Limits{view.drafting.ownLimits ? " agreed for your clinic" : ""}: up to {view.drafting.perMinute.toLocaleString("en-GB")} drafting requests a minute
          and {view.drafting.perDay.toLocaleString("en-GB")} a day. They keep drafting fair for everyone; they do not change what counts as a report.
        </p>
      </Panel>
    </>
  );
}
