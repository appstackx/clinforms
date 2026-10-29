import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill } from "@/components/pms/ui/status-pill";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { formatPence } from "@/modules/pms/core/text";
import { STATUS_LABELS } from "@/modules/pms/diary/copy";
import { APPOINTMENT_STATUSES } from "@/modules/pms/diary/rules";
import type { PatientAppointmentRow } from "@/modules/pms/diary/view";
import { requireClinicActor } from "@/server/pms/actor";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadPatientAppointments } from "@/server/pms/diary/reads";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Appointments" };

/**
 * A patient's record → Appointments (the diary's tab): upcoming soonest first, then past ones newest first, with
 * status, practitioner, site and room; each opens in the diary. Counts per status. diary.view (and patients.view
 * for the record itself – the record's layout checks it).
 */
export default async function PatientAppointmentsPage({ params, searchParams }: { params: { patientId: string }; searchParams: { before?: string } }) {
  const actor = await requireClinicActor({ permission: "diary.view" });
  const result = await loadPatientAppointments(await diaryCallerOf(actor), params.patientId, { before: typeof searchParams.before === "string" ? searchParams.before : undefined, pageSize: 50 });
  if (!result.ok) return <p role="alert">{result.error}</p>;
  const v = result.data;
  const counts = APPOINTMENT_STATUSES.filter((s) => v.counts[s] > 0).map((s) => `${v.counts[s]} ${STATUS_LABELS[s].toLowerCase()}`);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Appointments</h2>
          <p className="text-sm text-[#475569]">{counts.length ? counts.join(" · ") : "No appointments yet."}</p>
        </div>
        {actor.can("diary.book") ? (
          <Link href={`${CLINIC_BASE_PATH}/diary`} className="inline-flex h-9 items-center rounded-[8px] bg-primary-strong px-3.5 text-sm font-medium text-white hover:bg-[#095E57] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Book in the diary
          </Link>
        ) : null}
      </div>
      <Table caption="Upcoming appointments" rows={v.upcoming} empty="Nothing booked." />
      <Table caption="Past appointments" rows={v.past} empty="No past appointments." />
      {v.nextBefore ? (
        <Link className="text-sm text-primary-strong underline" href={`?before=${encodeURIComponent(v.nextBefore)}`}>
          Older appointments
        </Link>
      ) : null}
    </div>
  );
}

function Table({ caption, rows, empty }: { caption: string; rows: PatientAppointmentRow[]; empty: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-foreground">{caption}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[#475569]">{empty}</p>
      ) : (
        <ScrollRegion label="Appointments" className="relative overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-[#F8FAFC] text-left text-xs text-[#475569]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 font-medium">Time</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">With</th>
                <th scope="col" className="px-3 py-2 font-medium">Where</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link className="font-medium text-primary-strong underline-offset-2 hover:underline" href={`${CLINIC_BASE_PATH}/diary?date=${r.startsOn}&site=${r.siteId}&focus=${r.id}`}>
                      {r.dateLabel}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.timeLabel}</td>
                  <td className="px-3 py-2">{r.serviceName ?? "–"}</td>
                  <td className="px-3 py-2">{r.practitionerName ?? "–"}</td>
                  <td className="px-3 py-2">{[r.siteName, r.roomName].filter(Boolean).join(" · ")}</td>
                  <td className="px-3 py-2">
                    <StatusPill kind="appointment" status={r.status} size="sm" />
                    {r.cancelReasonLabel ? <span className="ml-2 text-xs text-[#475569]">{r.cancelReasonLabel}</span> : null}
                    {r.feeDue && r.feePence !== null ? <span className="ml-2 text-xs text-[#9A3412]">fee {formatPence(r.feePence)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </section>
  );
}
