import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { ClosureAddForm, RemoveButton, SiteForm } from "@/components/pms/reporting/setup-sites";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { SETUP_COPY } from "@/modules/pms/reporting/copy";
import { weeklyOpenMinutes } from "@/modules/pms/reporting/metrics";
import { addDays } from "@/modules/pms/reporting/periods";
import { sitesInScope } from "@/modules/pms/reporting/staff";
import { requireClinicActor } from "@/server/pms/actor";
import { siteScopeOf } from "@/server/pms/reporting/scope";
import { listRooms, listSites } from "@/server/repos/pms/directory";
import { listClosures, listOpeningHours } from "@/server/repos/pms/reporting/opening-hours";
import { addClosureAction, createSiteAction, removeClosureAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sites and rooms" };

export default async function SitesSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.manage" });
  const ctx = actor.repo();
  const scope = await siteScopeOf(actor);
  const today = ukToday();
  const [allSites, rooms, hours, closures] = await Promise.all([
    listSites(ctx, actor.tenantId, { includeInactive: true }),
    listRooms(ctx, actor.tenantId, { includeInactive: false }),
    listOpeningHours(ctx, actor.tenantId),
    listClosures(ctx, actor.tenantId, { from: today, to: addDays(today, 400) }),
  ]);
  const sites = sitesInScope(scope, allSites);
  const everySite = closures.filter((c) => c.siteId === null);
  return (
    <>
      <PageHeader title="Sites and rooms" description="Each site's rooms and opening hours set the time available for appointments and the utilisation figures." />
      <Panel title={`Sites (${sites.length})`}>
        {sites.length === 0 ? (
          <p className="text-sm text-slate-600">No sites yet. Add the first one below.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sites.map((s) => {
              const week = weeklyOpenMinutes(hours, s.id);
              const days = week.slice(1).filter((m) => m > 0).length;
              const roomCount = rooms.filter((r) => r.siteId === s.id).length;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {s.name}
                      {s.code ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{s.code}</span> : null}
                      {!s.active ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Closed</span> : null}
                    </p>
                    <p className="text-xs text-slate-600">
                      {roomCount} {roomCount === 1 ? "room" : "rooms"} · {days ? `open ${days} ${days === 1 ? "day" : "days"} a week` : "no opening hours set"}
                      {s.postcode ? ` · ${s.postcode}` : ""}
                    </p>
                  </div>
                  <Link href={`${SETUP_PATH}/sites/${s.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                    Open<span className="sr-only"> {s.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {scope.all ? (
        <Panel title="Add a site" className="mt-6">
          <SiteForm action={createSiteAction} submitLabel="Add site" />
        </Panel>
      ) : (
        <div className="mt-6">
          <Notice>{SETUP_COPY.unscopedOnly}</Notice>
        </div>
      )}
      <Panel title="Closures of every site" description="Bank holidays and other days when every site is closed. A site's own closures are on its page." className="mt-6">
        {everySite.length === 0 ? (
          <p className="text-sm text-slate-600">None coming up.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {everySite.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-slate-900">
                  {formatUkDate(c.startsOn)}
                  {c.endsOn !== c.startsOn ? ` – ${formatUkDate(c.endsOn)}` : ""}
                  {c.reason ? <span className="text-slate-600"> · {c.reason}</span> : null}
                </span>
                {scope.all ? <RemoveButton action={removeClosureAction} hidden={{ closureId: c.id }} label="Remove" confirmText="Remove this closure?" /> : null}
              </li>
            ))}
          </ul>
        )}
        {scope.all ? <ClosureAddForm action={addClosureAction} fixedSiteId={null} /> : null}
      </Panel>
    </>
  );
}
