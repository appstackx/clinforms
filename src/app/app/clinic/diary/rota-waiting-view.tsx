/**
 * The "Rota and waiting list" page body, shared by /diary/rotas (diary.manage: the rota editor and the waiting list)
 * and /diary/waiting-list (diary.view: the waiting list; the rota editor too for members with diary.manage).
 */
import { cookies } from "next/headers";
import { RotaWaiting } from "@/components/pms/diary/rota-waiting";
import { SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { ukToday } from "@/modules/pms/core/text";
import { isIsoDay } from "@/modules/pms/diary/time";
import type { ClinicActor } from "@/server/pms/actor";
import { currentPractitionerId } from "@/server/pms/actor";
import { diaryCallerOf, inScope } from "@/server/pms/diary/caller";
import { loadWaitingList } from "@/server/pms/diary/reads";
import { loadFreedSlot, loadRotaScreen } from "@/server/pms/diary/rota-screen";
import { listPractitioners, listRooms, listServices, listSites } from "@/server/repos/pms/directory";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function RotaWaitingView({ actor, searchParams, rota }: { actor: ClinicActor; searchParams: Record<string, string | string[] | undefined>; rota: boolean }) {
  const caller = await diaryCallerOf(actor);
  const ctx = actor.repo();
  const today = ukToday();
  const [allSites, practitioners, rooms, services, me] = await Promise.all([
    listSites(ctx, actor.tenantId),
    listPractitioners(ctx, actor.tenantId, { bookableOnly: true }),
    listRooms(ctx, actor.tenantId),
    listServices(ctx, actor.tenantId),
    currentPractitionerId(actor),
  ]);
  const sites = allSites.filter((s) => inScope(caller, s.id));
  const wanted = one(searchParams.site) || cookies().get(SITE_COOKIE)?.value || "";
  const site = sites.find((s) => s.id === wanted) ?? sites[0] ?? null;
  const from = isIsoDay(one(searchParams.from)) && one(searchParams.from) >= today ? one(searchParams.from) : today;
  const practitionerId = practitioners.find((p) => p.id === one(searchParams.practitioner))?.id ?? (me && practitioners.some((p) => p.id === me) ? me : null) ?? practitioners.find((p) => p.defaultSiteId === site?.id)?.id ?? practitioners[0]?.id ?? null;
  const [rotaData, waiting] = await Promise.all([
    rota ? loadRotaScreen(caller, practitionerId, today, from) : Promise.resolve(null),
    loadWaitingList(caller, { status: "open" }),
  ]);
  const rows = waiting.ok ? waiting.data.filter((r) => !site || r.siteId === null || r.siteId === site.id) : [];
  const freed = site ? await loadFreedSlot(caller, site.id, rows.map((r) => ({ id: r.id, practitionerId: r.practitionerId, serviceId: r.serviceId, preferredDays: r.preferredDays, preferredTime: r.preferredTime, earliestOn: r.earliestOn, latestOn: r.latestOn }))) : null;
  return (
    <RotaWaiting
      site={site ? { id: site.id, name: site.name } : null}
      sites={sites.map((s) => ({ id: s.id, name: s.name }))}
      rooms={rooms.filter((r) => inScope(caller, r.siteId)).map((r) => ({ id: r.id, name: r.name, siteId: r.siteId }))}
      practitioners={practitioners.map((p) => ({ id: p.id, name: p.displayName, registration: p.registrationNumber }))}
      services={services.map((s) => ({ id: s.id, name: s.name }))}
      rota={{
        show: rota && rotaData !== null && rotaData.ok,
        canEdit: actor.can("diary.manage"),
        practitionerId,
        from,
        days: rotaData && rotaData.ok ? rotaData.data.days : [],
        exceptions: rotaData && rotaData.ok ? rotaData.data.exceptions : [],
      }}
      waiting={{ canBook: actor.can("diary.book"), rows, freed }}
      today={today}
    />
  );
}
