import type { Metadata } from "next";
import { BrandMark, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { activityLabel, describeActivityDetail } from "@/lib/activity-copy";
import { activityTime } from "@/server/admin/activity";
import { requirePlatformAdmin } from "@/server/admin/guards";
import { ACCESS_REQUESTS_SHOWN, listAccessRequestsForPlatform, listClinicsOverview, listPlatformActivity } from "@/server/admin/platform-console";
import { getDb } from "@/server/db";
import { SignOutForm } from "../session-forms";
import { setAccessRequestContactedAction } from "./actions";
import { CreateClinicForm } from "./forms";

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
  const [requests, clinics, activity] = await Promise.all([
    listAccessRequestsForPlatform({ db }),
    listClinicsOverview(db),
    listPlatformActivity({ db }, 20),
  ]);
  const open = requests.filter((r) => !r.contactedAt).length;

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
          <CreateClinicForm />
        </Panel>

        <Panel
          title={`Access requests (${open} not contacted)`}
          description={`From the “Request access” form on the website, newest first${requests.length >= ACCESS_REQUESTS_SHOWN ? ` – the latest ${ACCESS_REQUESTS_SHOWN} are shown` : ""}. The daily retention job deletes requests older than 24 months.`}
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
                      <td className={TD}>
                        {c.offboardedAt ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Closed {activityTime(c.offboardedAt)}</span>
                        ) : (
                          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
