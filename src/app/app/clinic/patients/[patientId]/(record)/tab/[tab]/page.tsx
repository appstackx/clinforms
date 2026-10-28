import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/pms/records/ui";
import { StatusPill } from "@/components/pms/ui";
import { PMS_RECORD_TABS } from "@/modules/pms/record-tabs";
import { STAND_IN_COPY, STAND_IN_KEYS, standInPermission } from "@/modules/pms/records/record-tab-model";
import { requireClinicActor } from "@/server/pms/actor";
import { loadRecordHeader } from "@/server/pms/records/record-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Patient record", robots: { index: false, follow: false } };

/**
 * /patients/[id]/tab/<key> – the records module's stand-in for a record tab whose module has not registered its own
 * yet (src/modules/pms/records/record-tab-model.ts). Never a broken page:
 *
 *   appointments – the patient's appointments from the diary's merged read (loadPatientAppointments), read only;
 *                  TODO(diary): replaced by the diary's own tab (…/[patientId]/appointments, feat/cs-diary).
 *   invoices     – "Coming with billing"   (TODO(billing): …/[patientId]/invoices)
 *   messages     – "Coming with messages"  (TODO(comms):   …/[patientId]/messages)
 *   forms        – "Coming with the patient portal" (TODO(portal): …/[patientId]/forms)
 *
 * Once a module registers its tab, the record links to that tab and this page answers 404 for its key.
 */
export default async function StandInTab({ params }: { params: { patientId: string; tab: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  // Each stand-in has its slot's permission (diary.view, billing.view, messages.view, patients.view).
  const permission = STAND_IN_KEYS.includes(params.tab) ? standInPermission(params.tab) : null;
  if (!permission || !actor.can(permission)) notFound();
  const registered = { appointments: "diary", invoices: "billing", messages: "comms", forms: "portal" }[params.tab];
  if (PMS_RECORD_TABS.some((t) => t.module === registered && t.segment === params.tab)) notFound();
  const h = await loadRecordHeader(actor, params.patientId);

  if (params.tab !== "appointments") {
    const copy = STAND_IN_COPY[params.tab];
    return (
      <section aria-label={params.tab}>
        <ComingSoon title={copy.title}>{copy.body}</ComingSoon>
      </section>
    );
  }

  const rows = h.appointments ? [...h.appointments.upcoming.slice().reverse(), ...h.appointments.past] : [];
  return (
    <section aria-label="Appointments" className="overflow-hidden rounded-2xl border border-border bg-white">
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No appointments yet.</p>
      ) : (
        <>
          <div className="relative hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Appointments</caption>
              <thead>
                <tr className="bg-[#F8FAFC] text-left text-xs text-[#475569]">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Service</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Practitioner</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Site</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {r.dateLabel} {r.timeLabel.split("–")[0]}
                    </td>
                    <td className="px-4 py-2.5">{[r.serviceName, `${r.durationMinutes} min`].filter(Boolean).join(" ")}</td>
                    <td className="px-4 py-2.5">{r.practitionerName ?? "–"}</td>
                    <td className="px-4 py-2.5">{[r.siteName, r.roomName].filter(Boolean).join(" · ") || "–"}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill kind="appointment" status={r.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 p-4 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-border px-3.5 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong className="font-semibold tabular-nums">
                    {r.dateLabel} {r.timeLabel.split("–")[0]}
                  </strong>
                  <StatusPill kind="appointment" status={r.status} size="sm" />
                </div>
                <span className="text-[#334155]">{[r.serviceName, r.practitionerName, r.roomName].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
