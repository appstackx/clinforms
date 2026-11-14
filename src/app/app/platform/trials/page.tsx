import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { CLINIC_SYSTEM_NAME, CLINFORMS_NAME } from "@/lib/brand";
import { TRIAL_LIMITS, trialDays, trialReports, trialTexts } from "@/lib/trial";
import { selfSignupBrands } from "@/lib/self-signup";
import { requirePlatformAdmin } from "@/server/admin/guards";
import { getDb } from "@/server/db";
import { listTrialsForPlatform, type PlatformTrialRow } from "@/server/trial/platform";
import { SignOutForm } from "../../session-forms";

/**
 * /app/platform/trials – ClinForms staff only (as /app/platform: everyone else gets the ordinary 404). Every self-serve
 * free trial (self sign-up, docs/clinic-system/trial.md): start, days left, free reports and texts used, the abuse
 * brake's decision, the sample clinic, the emails sent, converted or not. Read only.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Free trials – Platform" };

const TH = "px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-sm text-slate-800";
const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (iso: string | null) => (iso ? UK.format(new Date(iso)) : "–");

const STATE_LABEL: Record<PlatformTrialRow["state"], string> = {
  waiting: "Waiting for the first sign-in",
  running: "Running",
  ended: "Ended – not converted (read-only, data kept)",
  converted: "Converted – paid",
};
const REPEAT_LABEL = { email: "same owner address as an earlier trial", network: "busy network (30 days)", domain: "busy email domain (30 days)" } as const;
const EMAIL_LABEL = { welcome: "welcome", tips: "tips", four_days: "4 days left", last_day: "last day", ended: "ended", paid: "paid" } as const;

export default async function PlatformTrialsPage() {
  const admin = await requirePlatformAdmin();
  const rows = await listTrialsForPlatform(getDb());
  const on = Array.from(selfSignupBrands()).map((b) => (b === "clinic" ? CLINIC_SYSTEM_NAME : CLINFORMS_NAME));
  const counts = { running: rows.filter((r) => r.state === "running" || r.state === "waiting").length, converted: rows.filter((r) => r.state === "converted").length, ended: rows.filter((r) => r.state === "ended").length };
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
            <span className="truncate text-sm font-medium text-slate-800">Free trials</span>
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
          title="Free trials"
          description={`Clinics that signed themselves up. Self sign-up is ${on.length ? `ON for ${on.join(" and ")}` : "OFF"}. Each trial: ${trialDays()} days from the owner's first sign-in, ${trialReports()} free reports, ${trialTexts()} free texts (${CLINIC_SYSTEM_NAME} only); a repeat trial (same owner address, more than ${TRIAL_LIMITS.perNetwork30Days} from one network or ${TRIAL_LIMITS.perDomain30Days} from one email domain in 30 days) gets no free reports or texts. Nothing is deleted when a trial ends.`}
        />
        <p className="mb-4 text-sm text-slate-700" data-testid="trial-counts">
          {rows.length} trials · {counts.running} running · {counts.converted} converted · {counts.ended} ended without a plan
        </p>
        <Panel title={`Trial clinics (${rows.length})`}>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-600">No self-serve trials yet.</p>
          ) : (
            <div className="-mx-3 overflow-x-auto">
              <table className="w-full min-w-[960px]" data-testid="platform-trials">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className={TH}>Clinic</th>
                    <th scope="col" className={TH}>Trial</th>
                    <th scope="col" className={TH}>Started</th>
                    <th scope="col" className={TH}>Ends / days left</th>
                    <th scope="col" className={`${TH} text-right`}>Reports used</th>
                    <th scope="col" className={`${TH} text-right`}>Texts used</th>
                    <th scope="col" className={TH}>Converted</th>
                    <th scope="col" className={TH}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.trial.tenantId} className="border-b border-slate-100 last:border-0" data-testid="platform-trial-row">
                      <td className={TD}>
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-slate-500">
                          {r.trial.tenantId} · {r.trial.brand === "clinic" ? CLINIC_SYSTEM_NAME : CLINFORMS_NAME} · signed up {day(r.trial.createdAt)}
                          {r.closed ? " · closed" : ""}
                        </span>
                      </td>
                      <td className={TD}>{STATE_LABEL[r.state]}</td>
                      <td className={TD}>{day(r.startedAt)}</td>
                      <td className={TD}>
                        {day(r.endsAt)}
                        {r.daysLeft !== null ? <span className="block text-xs text-slate-500">{r.daysLeft} {r.daysLeft === 1 ? "day" : "days"} left</span> : null}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {r.reportsUsed} of {r.reportsIncluded}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {r.textsUsed} of {r.trial.textsGranted} free
                      </td>
                      <td className={TD}>{r.state === "converted" ? `Yes${r.trial.convertedAt ? ` – ${day(r.trial.convertedAt)}` : ""}` : "No"}</td>
                      <td className={`${TD} text-xs text-slate-600`}>
                        {r.trial.repeatReason ? <span className="block font-medium text-amber-800">No free allowance: {REPEAT_LABEL[r.trial.repeatReason]}</span> : null}
                        <span className="block">Sample clinic: {r.trial.sampleState === "ready" ? r.trial.sampleTenantId : r.trial.sampleState === "declined" ? "declined" : r.trial.sampleState === "creating" ? "being set up" : "–"}</span>
                        <span className="block">Emails: {r.emails.length ? r.emails.map((e) => `${EMAIL_LABEL[e.kind]} (${e.status})`).join(", ") : "–"}</span>
                        {r.trial.tipsOffAt ? <span className="block">Tips stopped by the owner</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}
