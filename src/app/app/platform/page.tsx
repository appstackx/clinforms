import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { activityLabel, describeActivityDetail } from "@/lib/activity-copy";
import { activityTime } from "@/server/admin/activity";
import { requirePlatformAdmin } from "@/server/admin/guards";
import { CLINIC_SYSTEM_NAME, PACKAGE_LABELS } from "@/lib/brand";
import { accessRequestSource } from "@/server/site/demo-request";
import {
  ACCESS_REQUESTS_SHOWN,
  listAccessRequestsForPlatform,
  listClinicPackages,
  listClinicsOverview,
  listPlatformActivity,
  reportsSwitchOffNeedsTypedId,
} from "@/server/admin/platform-console";
import { TRIAL_COPY } from "@/lib/account-copy";
import { getDb } from "@/server/db";
import { emailProviderName } from "@/server/email";
import { baseUrlSetting, brandOrigin } from "@/server/auth/config";
import { SignOutForm } from "../session-forms";
import { setAccessRequestContactedAction, setClinicPackageAction } from "./actions";
import { CreateClinicForm, DemoClinicForm, OwnerResetForm, PackageForm, TrialForms } from "./forms";
import type { ClinicOverview } from "@/server/admin/platform-console";
import { formatPence, packageLabel, reportsText } from "@/lib/packages";
import { readClinicPackages, type ClinicPackage } from "@/server/repos/clinic-package";
import { ukDateOf } from "@/server/repos/usage-period";

const UK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The clinic's trial in a few words (10/2026). */
function trialText(c: ClinicOverview): string {
  const a = c.access;
  if (a.state === "trial") return a.pending ? `${a.daysLeft}-day trial, starts at the owner's first sign-in` : `Trial, ${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"} left (ends ${UK_DAY.format(new Date(a.endsAt ?? ""))})`;
  if (a.state === "trial_ended") return `Trial ended ${UK_DAY.format(new Date(a.endedAt))}`;
  return a.plan === "paid" ? "Full account (trial converted)" : "–";
}

/** The clinic's package in a few words (25/10/2026). */
function packageText(p: ClinicPackage | undefined): string {
  if (!p) return "–";
  return `${packageLabel(p.package)} · ${formatPence(p.monthlyPricePence)} · ${reportsText(p.reportsIncluded)} · extra ${p.extraReportPence === null ? "not set" : formatPence(p.extraReportPence)}${
    p.foundingPricePence !== null ? ` · founding ${formatPence(p.foundingPricePence)} to ${p.foundingUntil}` : ""
  }`;
}

function limitsText(c: ClinicOverview): string {
  const m = c.plan?.livePerMinute;
  const d = c.plan?.livePerDay;
  if (!m && !d) return "Default";
  return `${m ? `${m}/min` : "default/min"} · ${d ? `${d.toLocaleString("en-GB")}/day` : "default/day"}`;
}

/**
 * /app/platform – ClinForms staff only (emails in CLINFORMS_PLATFORM_ADMINS, signed in with two-step verification;
 * checked on the server). Everyone else gets the ordinary 404 page.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Platform" };

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-sm";

export default async function PlatformPage() {
  const admin = await requirePlatformAdmin();
  const db = getDb();
  const [requests, clinics, activity, packages] = await Promise.all([
    listAccessRequestsForPlatform({ db }),
    listClinicsOverview(db),
    listPlatformActivity({ db }, 20),
    readClinicPackages({ db }),
  ]);
  const packageOf = new Map(packages.map((p) => [p.tenantId, p] as const));
  const open = requests.filter((r) => !r.contactedAt).length;
  const live = clinics.filter((c) => !c.offboardedAt);
  const entitlements = await listClinicPackages(db, live.map((c) => c.tenantId));
  const openClinics = clinics.filter((c) => !c.offboardedAt).map((c) => ({ tenantId: c.tenantId, name: c.name }));
  const demoClinics = clinics.filter((c) => !c.offboardedAt && c.plan?.demoClinic === true).map((c) => ({ tenantId: c.tenantId, name: c.name }));
  const emailOn = emailProviderName() !== "none";

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark compact />
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">Platform</span>
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

      <main className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader
          title="Platform administration"
          description="Clinic accounts and access requests. Only ClinForms staff named in the platform settings can open this page, and every change here is recorded."
        />

        <Panel title="Create a clinic" description="Creates the clinic account and an invitation for its owner. Do this once the data processing agreement is signed." className="mb-6">
          <CreateClinicForm emailOn={emailOn} clinicBrandHost={servesClinicBrandHost()} />
        </Panel>

        <Panel title="Trials and drafting limits" description={TRIAL_COPY.platformDescription} className="mb-6">
          <TrialForms clinics={openClinics} />
        </Panel>

        <Panel
          title="Packages"
          description="A clinic's package: price, reports included a month and the price of each extra report (all ex VAT). The clinic sees it on its Plan & usage page. A report counts when its answers are first drafted, or when it is approved if nothing needed drafting. Every change is recorded here and in the clinic's own activity."
          className="mb-6"
        >
          <PackageForm clinics={openClinics} today={ukDateOf(new Date())} />
          <p className="mt-4 text-sm">
            <Link href="/app/platform/usage" className="font-medium text-teal-700 underline-offset-4 hover:underline">
              Usage across clinics
            </Link>{" "}
            <span className="text-slate-600">– reports, drafting calls, tokens, estimated drafting cost and margin per month.</span>
          </p>
        </Panel>

        <Panel
          title="Demo clinics"
          description="A demo clinic holds made-up data only and otherwise works like a customer's clinic. Its pages show “Demo clinic – made-up data only”, every preview, document and copied answer carries a demonstration notice, and its members may approve with made-up PH-DEMO numbers (a real clinic refuses them). Only ClinForms staff can switch this, here or with npm run admin:set-demo-clinic. Every change is recorded."
          className="mb-6"
        >
          <DemoClinicForm clinics={openClinics} demoClinics={demoClinics} />
        </Panel>

        <Panel
          title="Owner password reset"
          description="For a clinic owner who cannot reset their password by email and has no other owner or administrator to create a link for them. The link is not emailed: it is shown here once, for you to pass on after confirming who you are speaking to. It is recorded here and in the clinic's own activity. For a lost authenticator app as well, use the two-step reset script (docs/auth.md)."
          className="mb-6"
        >
          <OwnerResetForm clinics={openClinics} />
        </Panel>

        <Panel
          title={`Access requests (${open} not contacted)`}
          description={`From the “Request access” form on the website and ${CLINIC_SYSTEM_NAME}’s “Book a demo” form (labelled ${CLINIC_SYSTEM_NAME} demo), newest first${requests.length >= ACCESS_REQUESTS_SHOWN ? ` – the latest ${ACCESS_REQUESTS_SHOWN} are shown` : ""}. The daily retention job deletes requests older than 24 months.`}
          className="mb-6"
        >
          {requests.length === 0 ? (
            <p className="text-sm text-slate-600">No requests yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${r.contactedAt ? "opacity-70" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {accessRequestSource(r.message) === "clindesk" ? (
                        <span className="mr-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
                          {CLINIC_SYSTEM_NAME} demo
                        </span>
                      ) : null}
                      {r.clinicName} <span className="font-normal text-slate-600">· {r.contactName}</span>
                    </p>
                    <p className="mt-0.5 break-words text-sm text-slate-600">
                      <a href={`mailto:${r.email}`} className="text-teal-700 underline-offset-4 hover:underline">
                        {r.email}
                      </a>
                      {r.phone ? ` · ${r.phone}` : ""} · received {activityTime(r.createdAt)}
                    </p>
                    {r.message ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Message</summary>
                        <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{r.message}</p>
                      </details>
                    ) : null}
                  </div>
                  <form action={setAccessRequestContactedAction} className="flex shrink-0 items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    {r.contactedAt ? (
                      <>
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">Contacted {activityTime(r.contactedAt)}</span>
                        <input type="hidden" name="contacted" value="0" />
                        <SubmitButton variant="secondary" className="h-8 px-2.5 text-xs" pendingText="Saving…">
                          Undo
                        </SubmitButton>
                      </>
                    ) : (
                      <>
                        <input type="hidden" name="contacted" value="1" />
                        <SubmitButton variant="secondary" className="h-8 px-2.5 text-xs" pendingText="Saving…">
                          Mark as contacted
                        </SubmitButton>
                      </>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Clinics (${clinics.length})`} description="Every clinic account, including closed ones (their id is kept so it is never reused). Times are UK time." className="mb-6">
          {clinics.length === 0 ? (
            <p className="text-sm text-slate-600">No clinics yet.</p>
          ) : (
            <div className="-mx-3 overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>Clinic id</th>
                    <th className={TH}>Name</th>
                    <th className={TH}>Created</th>
                    <th className={TH}>Members</th>
                    <th className={TH}>Open invitations</th>
                    <th className={TH}>Last activity</th>
                    <th className={TH}>Trial</th>
                    <th className={TH}>Package</th>
                    <th className={TH}>Drafting limits</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clinics.map((c) => (
                    <tr key={c.organizationId}>
                      <td className={`${TD} font-mono text-xs`}>{c.tenantId}</td>
                      <td className={TD}>{c.name}</td>
                      <td className={`${TD} whitespace-nowrap text-slate-600`}>{activityTime(c.createdAt)}</td>
                      <td className={TD}>
                        {c.members}
                        {c.members > 0 && c.owners === 0 ? <span className="ml-1 text-xs text-amber-800">(no owner)</span> : null}
                      </td>
                      <td className={TD}>{c.pendingInvitations}</td>
                      <td className={`${TD} whitespace-nowrap text-slate-600`}>{c.lastActivityAt ? activityTime(c.lastActivityAt) : "–"}</td>
                      <td className={`${TD} text-slate-700`}>{trialText(c)}</td>
                      <td className={`${TD} text-slate-700`}>{packageText(packageOf.get(c.tenantId))}</td>
                      <td className={`${TD} whitespace-nowrap text-slate-700`}>{limitsText(c)}</td>
                      <td className={TD}>
                        {c.offboardedAt ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Closed {activityTime(c.offboardedAt)}</span>
                        ) : (
                          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">Active</span>
                        )}
                        {!c.offboardedAt && c.plan?.demoClinic ? (
                          <span className="ml-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" data-demo-clinic-status={c.tenantId}>
                            Demo clinic
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Packages switched on"
          description={`What each open clinic can use. ${PACKAGE_LABELS.reports} is on for every clinic unless switched off here; ${PACKAGE_LABELS.clinic} is off until switched on. Switching off hides and blocks that part – nothing is deleted. Switching ${PACKAGE_LABELS.reports} off stops the clinic's Studio and Report API, so it needs the clinic id typed first.`}
          className="mb-6"
        >
          {live.length === 0 ? (
            <p className="text-sm text-slate-600">No open clinics.</p>
          ) : (
            <div className="-mx-3 overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>Clinic id</th>
                    <th className={TH}>Name</th>
                    <th className={TH}>{PACKAGE_LABELS.reports}</th>
                    <th className={TH}>{PACKAGE_LABELS.clinic}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {live.map((c) => {
                    const p = entitlements.get(c.tenantId);
                    return (
                      <tr key={c.organizationId}>
                        <td className={`${TD} font-mono text-xs`}>{c.tenantId}</td>
                        <td className={TD}>{c.name}</td>
                        {(["reports", "clinic"] as const).map((pkg) => {
                          const on = p ? p[pkg] : pkg === "reports";
                          // Reports off stops a live clinic's Studio and Report API: the clinic id must be typed.
                          const typeId = reportsSwitchOffNeedsTypedId({ package: pkg, on: !on });
                          return (
                            <td key={pkg} className={TD}>
                              <form action={setClinicPackageAction} className="flex flex-wrap items-center gap-2">
                                <input type="hidden" name="tenantId" value={c.tenantId} />
                                <input type="hidden" name="package" value={pkg} />
                                <input type="hidden" name="on" value={on ? "0" : "1"} />
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-700"}`}>{on ? "On" : "Off"}</span>
                                {typeId ? (
                                  <label className="flex items-center gap-1 text-xs text-slate-600">
                                    <span className="sr-only">
                                      Type the clinic id {c.tenantId} to switch {PACKAGE_LABELS[pkg]} off for {c.name}
                                    </span>
                                    <input
                                      name="confirmTenantId"
                                      required
                                      autoComplete="off"
                                      spellCheck={false}
                                      placeholder="Clinic id"
                                      {...(/^[a-z0-9-]+$/.test(c.tenantId) ? { pattern: c.tenantId } : {})}
                                      title={`Type ${c.tenantId} to confirm`}
                                      className="h-8 w-36 rounded-md border border-slate-300 px-2 font-mono text-xs"
                                    />
                                  </label>
                                ) : null}
                                <SubmitButton
                                  variant="secondary"
                                  className="h-8 px-2.5 text-xs"
                                  pendingText="Saving…"
                                  confirmText={on ? `Switch ${PACKAGE_LABELS[pkg]} off for ${c.name}? Its screens are hidden and blocked; nothing is deleted.` : undefined}
                                >
                                  {on ? "Switch off" : "Switch on"}
                                  <span className="sr-only">
                                    {" "}
                                    {PACKAGE_LABELS[pkg]} for {c.name}
                                  </span>
                                </SubmitButton>
                              </form>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent platform actions" description="The latest 20 changes made on this page.">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((e) => (
                <li key={e.id} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr] sm:gap-4">
                  <time dateTime={e.at} className="text-xs text-slate-500 sm:text-sm">
                    {activityTime(e.at)}
                  </time>
                  <p className="min-w-0 break-words text-sm text-slate-700">
                    {activityLabel(e.action)}
                    {describeActivityDetail(e.action, e.detail) ? ` · ${describeActivityDetail(e.action, e.detail)}` : ""}
                    {e.userId === admin.userId ? " · by you" : " · by another administrator"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </main>
    </>
  );
}

/** Whether this deployment signs people in on the clinic brand's own host (CLINFORMS_AUTH_ORIGINS – docs/auth.md). */
function servesClinicBrandHost(): boolean {
  try {
    const setting = baseUrlSetting();
    return brandOrigin(setting, "clinic") !== brandOrigin(setting, "clinforms");
  } catch {
    return false;
  }
}
