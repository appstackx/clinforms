import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/account/shell";
import { ClosureAddForm, OpeningHoursForm, RemoveButton, RoomAddForm, RoomEditForm, SiteForm } from "@/components/pms/reporting/setup-sites";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { addDays } from "@/modules/pms/reporting/periods";
import { requireClinicActor } from "@/server/pms/actor";
import { mayManageSite, siteScopeOf } from "@/server/pms/reporting/scope";
import { getSite, listRooms } from "@/server/repos/pms/directory";
import { listClosures, listOpeningHours } from "@/server/repos/pms/reporting/opening-hours";
import { addClosureAction, createRoomAction, removeClosureAction, setOpeningHoursAction, updateRoomAction, updateSiteAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Site" };

export default async function SiteSetupPage({ params }: { params: { siteId: string } }) {
  const actor = await requireClinicActor({ permission: "settings.manage" });
  const ctx = actor.repo();
  const [site, scope] = await Promise.all([getSite(ctx, actor.tenantId, params.siteId), siteScopeOf(actor)]);
  if (!site || !mayManageSite(scope, site.id)) notFound();
  const today = ukToday();
  const [rooms, hours, closures] = await Promise.all([
    listRooms(ctx, actor.tenantId, { siteId: site.id, includeInactive: true }),
    listOpeningHours(ctx, actor.tenantId, { siteIds: [site.id] }),
    listClosures(ctx, actor.tenantId, { from: today, to: addDays(today, 400), siteIds: [site.id] }),
  ]);
  const own = closures.filter((c) => c.siteId === site.id);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`${SETUP_PATH}/sites`} className="font-medium text-teal-700 underline-offset-4 hover:underline">
          ← Sites and rooms
        </Link>
      </p>
      <PageHeader title={site.name} description="The site's details, rooms, weekly opening hours and closures." />
      <Panel title="Details">
        <SiteForm
          action={updateSiteAction}
          submitLabel="Save site"
          values={{
            id: site.id,
            name: site.name,
            code: site.code ?? "",
            address: (site.address ?? []).join("\n"),
            postcode: site.postcode ?? "",
            phone: site.phone ?? "",
            email: site.email ?? "",
            sortOrder: site.sortOrder,
            active: site.active,
          }}
        />
      </Panel>
      <Panel title={`Rooms (${rooms.length})`} className="mt-6">
        {rooms.length === 0 ? <p className="mb-4 text-sm text-slate-600">No rooms yet. A site without rooms counts as one room in the utilisation figures.</p> : null}
        <ul className="mb-4 space-y-2">
          {rooms.map((r) => (
            <li key={r.id}>
              <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-slate-900">
                  {r.name}
                  {!r.active ? <span className="ml-2 text-xs font-normal text-slate-600">(not in use)</span> : null}
                </summary>
                <div className="mt-3">
                  <RoomEditForm action={updateRoomAction} room={{ id: r.id, name: r.name, sortOrder: r.sortOrder, active: r.active }} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <RoomAddForm action={createRoomAction} siteId={site.id} />
      </Panel>
      <Panel title="Opening hours" className="mt-6">
        <OpeningHoursForm action={setOpeningHoursAction} siteId={site.id} sessions={hours.map((h) => ({ weekday: h.weekday, opensAt: h.opensAt, closesAt: h.closesAt }))} />
      </Panel>
      <Panel title="Closures" description="Days this site is closed (training, refurbishment). Closures of every site are listed on the sites page and apply here too." className="mt-6">
        {own.length === 0 ? (
          <p className="mb-4 text-sm text-slate-600">None coming up.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {own.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-slate-900">
                  {formatUkDate(c.startsOn)}
                  {c.endsOn !== c.startsOn ? ` – ${formatUkDate(c.endsOn)}` : ""}
                  {c.reason ? <span className="text-slate-600"> · {c.reason}</span> : null}
                </span>
                <RemoveButton action={removeClosureAction} hidden={{ closureId: c.id }} label="Remove" confirmText="Remove this closure?" />
              </li>
            ))}
          </ul>
        )}
        <ClosureAddForm action={addClosureAction} fixedSiteId={site.id} />
      </Panel>
    </>
  );
}
