import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { visibleNav } from "@/modules/pms/core/nav";
import { ukToday } from "@/modules/pms/core/text";
import { PMS_NAV } from "@/modules/pms/nav";
import { requireClinicActor } from "@/server/pms/actor";
import { countCases, listExpiringAuthorisations } from "@/server/repos/pms/cases";
import { listPractitioners, listServices, listSites } from "@/server/repos/pms/directory";
import { countPatients } from "@/server/repos/pms/patients";
import { getPmsSettings } from "@/server/repos/pms/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The clinic system's start page: what the clinic holds today and where to go next. */
export default async function ClinicOverviewPage() {
  const actor = await requireClinicActor();
  const ctx = actor.repo();
  const today = ukToday();
  const [settings, patients, openCases, sites, practitioners, services, expiring] = await Promise.all([
    getPmsSettings(ctx, actor.tenantId),
    actor.can("patients.view") ? countPatients(ctx, actor.tenantId) : Promise.resolve(null),
    actor.can("patients.view") ? countCases(ctx, actor.tenantId, "open") : Promise.resolve(null),
    listSites(ctx, actor.tenantId),
    listPractitioners(ctx, actor.tenantId, { bookableOnly: true }),
    listServices(ctx, actor.tenantId),
    actor.can("patients.view") ? listExpiringAuthorisations(ctx, actor.tenantId, { from: today, until: addDays(today, 14), limit: 500 }) : Promise.resolve([]),
  ]);
  const areas = visibleNav(PMS_NAV, actor.can).filter((e) => e.module !== "foundation");
  const tiles: Array<{ label: string; value: number | null; hint: string }> = [
    { label: "Patients", value: patients, hint: "Active records" },
    { label: "Open cases", value: openCases, hint: "Episodes of care in progress" },
    { label: "Sites", value: sites.length, hint: "Clinic locations" },
    { label: "Practitioners", value: practitioners.length, hint: "Shown in the diary" },
    { label: "Appointment types", value: services.length, hint: "With their length and price" },
    { label: "Authorisations ending soon", value: actor.can("patients.view") ? expiring.length : null, hint: "Within 14 days" },
  ];
  return (
    <>
      <PageHeader title={CLINIC_SYSTEM_NAME} description={`${actor.clinicName}: patients, cases and the clinic's sites, practitioners and appointment types.`} />
      {settings.isDemo ? (
        <div className="mb-6">
          <Notice tone="warning">Demonstration clinic – every patient, practitioner and organisation here is fictional.</Notice>
        </div>
      ) : null}
      <section aria-labelledby="clinic-figures">
        <h2 id="clinic-figures" className="sr-only">
          The clinic in figures
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {tiles
            .filter((t) => t.value !== null)
            .map((t) => (
              <li key={t.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{t.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{t.value?.toLocaleString("en-GB")}</p>
                <p className="mt-0.5 text-xs text-slate-600">{t.hint}</p>
              </li>
            ))}
        </ul>
      </section>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Panel title="Sites" description={sites.length ? undefined : "No sites yet."}>
          {sites.length ? (
            <ul className="divide-y divide-slate-100">
              {sites.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="font-medium text-slate-900">
                    {s.name}
                    {s.code ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{s.code}</span> : null}
                  </span>
                  <span className="text-slate-600">{[s.postcode, s.phone].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
        <Panel title="Practitioners" description={practitioners.length ? undefined : "No practitioners yet."}>
          {practitioners.length ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {practitioners.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300" style={p.colour ? { backgroundColor: p.colour } : undefined} aria-hidden />
                  <span className="text-slate-900">{p.displayName}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>
      {areas.length > 0 ? (
        <Panel title="Go to" className="mt-6">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {areas.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className="block rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:border-teal-300 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
