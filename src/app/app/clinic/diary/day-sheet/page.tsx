import type { Metadata } from "next";
import Link from "next/link";
import { DaySheetControls } from "@/components/pms/diary/day-sheet-controls";
import { longDate } from "@/components/pms/diary/grid-model";
import { PATIENT_PLACEHOLDER } from "@/components/pms/diary/day-sheet-copy";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { ukToday } from "@/modules/pms/core/text";
import { isIsoDay } from "@/modules/pms/diary/time";
import type { DaySheetGroup } from "@/modules/pms/diary/view";
import { requireClinicActor } from "@/server/pms/actor";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadDaySheet } from "@/server/pms/diary/reads";
import { listSites } from "@/server/repos/pms/directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Day sheet" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * /app/clinic/diary/day-sheet?site=…&date=…[&practitioner=…][&cancelled=1] – the printable day list (K2-DIARY-017,
 * design round 2 "Print day sheet – A4"): one A4 portrait page per practitioner – times, patients, appointment types,
 * payers, rooms, boxes to tick for arrived / DNA; blocked time and cancellations under the table. Never clinical
 * notes or contact details; dates of birth only when the clinic switched the diary setting on (default off).
 */
export default async function DaySheetPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "diary.view" });
  const caller = await diaryCallerOf(actor);
  const date = isIsoDay(one(searchParams.date)) ? one(searchParams.date) : ukToday();
  const sites = await listSites(actor.repo(), actor.tenantId);
  const siteId = one(searchParams.site) || sites[0]?.id || "";
  const sheet = await loadDaySheet(caller, { siteId, date, practitionerId: one(searchParams.practitioner) || null, includeCancelled: true });
  const back = `${CLINIC_BASE_PATH}/diary?date=${date}&site=${siteId}`;
  if (!sheet.ok) {
    return (
      <p role="alert" className="text-destructive-strong">
        {sheet.error} <Link href={back}>Back to the diary</Link>
      </p>
    );
  }
  const s = sheet.data;
  const groups = s.groups.filter((g) => g.practitionerId !== null || g.rows.length > 0);
  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body * { visibility: hidden; }
          #day-sheet, #day-sheet * { visibility: visible; }
          #day-sheet { position: absolute; left: 0; top: 0; width: 100%; }
          .ds-page { break-after: page; page-break-after: always; box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; }
          .ds-page:last-child { break-after: auto; page-break-after: auto; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href={back} className="text-primary-strong underline">
              Diary
            </Link>{" "}
            / Day sheet
          </p>
          <h1 className="text-xl font-semibold">Day sheet – {longDate(date)}</h1>
          <p className="text-sm text-[#475569]">One page per practitioner. Print it as a paper fallback; it goes out of date as soon as the diary changes.</p>
        </div>
        <DaySheetControls showDob={s.showsDateOfBirth} canSet={actor.can("settings.setup")} />
      </div>
      <div id="day-sheet" className="flex flex-col gap-6">
        {groups.length === 0 ? <p className="ds-page">Nothing is booked at {s.site.name} on {longDate(date)}.</p> : null}
        {groups.map((g, i) => (
          <SheetPage key={g.practitionerId ?? "rooms"} group={g} index={i} total={groups.length} clinic={actor.clinicName} site={s.site.name} date={date} printedAt={s.printedAt} printedBy={actor.name} showDob={s.showsDateOfBirth} />
        ))}
      </div>
    </>
  );
}

function SheetPage({ group, index, total, clinic, site, date, printedAt, printedBy, showDob }: { group: DaySheetGroup; index: number; total: number; clinic: string; site: string; date: string; printedAt: string; printedBy: string; showDob: boolean }) {
  const appts = group.rows.filter((r) => r.kind === "appointment" && r.status !== "cancelled" && r.status !== "late_cancelled");
  const blocked = group.rows.filter((r) => r.kind === "block" && r.status !== "cancelled");
  const cancelled = group.rows.filter((r) => r.kind === "appointment" && (r.status === "cancelled" || r.status === "late_cancelled"));
  const rooms = Array.from(new Set(appts.map((r) => r.roomName).filter(Boolean)));
  return (
    // 375 px (M10 finding 21): narrower padding, the header stacks and long words wrap, so the sheet never scrolls
    // sideways on a phone; from 640 px (and on paper) it is the design's A4 page.
    <section className="ds-page mx-auto flex min-h-[1000px] w-full min-w-0 max-w-[760px] flex-col break-words rounded-xl border border-border bg-white p-4 text-[#0F172A] shadow-sm sm:p-10" aria-label={`Day sheet, ${group.practitionerName}`}>
      <header className="flex flex-col items-start justify-between gap-2 border-b-2 border-[#0F172A] pb-4 sm:flex-row sm:gap-6">
        <div>
          <p className="text-xs text-[#334155]">
            {clinic} · {site}
          </p>
          <h2 className="text-xl font-bold sm:text-2xl">Day sheet – {longDate(date)}</h2>
          <p className="font-semibold">{[group.practitionerName, rooms.join(", ") || null, group.hours].filter(Boolean).join(" · ")}</p>
        </div>
        <p className="text-xs text-[#334155] sm:text-right">
          {appts.length} {appts.length === 1 ? "appointment" : "appointments"} · {blocked.length} blocked
          <br />
          Printed {printedAt}
          <br />
          by {printedBy}
        </p>
      </header>
      <table className="mt-4 w-full table-fixed border-collapse text-xs sm:table-auto sm:text-sm">
        <caption className="sr-only">Appointments of {group.practitionerName}</caption>
        <thead>
          <tr className="border-b border-[#0F172A] text-left text-xs">
            <th scope="col" className="w-12 py-2 pr-1 font-semibold sm:w-16">Time</th>
            <th scope="col" className="py-2 font-semibold">Patient</th>
            <th scope="col" className="py-2 font-semibold">Service</th>
            <th scope="col" className="py-2 font-semibold">Payer</th>
            <th scope="col" className="w-[68px] py-2 font-semibold sm:w-24">Arrived</th>
          </tr>
        </thead>
        <tbody>
          {appts.map((r) => (
            <tr key={r.id} className="border-b border-[#CBD5E1] align-top">
              <td className="py-2.5 font-bold tabular-nums">{r.startTime}</td>
              <td className="py-2.5 pr-1">
                <div className="font-semibold">{r.patientName ?? PATIENT_PLACEHOLDER}</div>
                <div className="text-xs text-[#334155]">
                  {[r.patientNumber !== null ? `No. ${r.patientNumber}` : null, showDob && r.dateOfBirth ? `DOB ${r.dateOfBirth}` : null, r.roomName].filter(Boolean).join(" · ")}
                </div>
                {r.hasAlerts ? (
                  <div className="mt-1 text-xs font-semibold">
                    <span className="mr-1 rounded border border-[#0F172A] px-1">ALERT</span>see the record
                  </div>
                ) : null}
              </td>
              <td className="py-2.5 pr-1">
                {r.serviceName ?? "–"}
                <div className="text-xs text-[#334155]">
                  {r.startTime}–{r.endTime}
                </div>
              </td>
              <td className="py-2.5 pr-1">{r.payerLabel ?? "–"}</td>
              <td className="py-2.5 text-xs">
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="inline-block h-4 w-4 border border-[#0F172A]" /> <span className="sr-only">Arrived:</span>
                  <span aria-hidden className="ml-1 inline-block h-3 w-3 border border-[#0F172A]" /> DNA
                </span>
                {r.status !== "booked" ? <div className="mt-1">{r.statusLabel}</div> : null}
              </td>
            </tr>
          ))}
          {appts.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-4 text-[#334155]">
                No appointments.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {blocked.length > 0 ? (
          <span>
            <strong>Blocked:</strong> {blocked.map((b) => `${b.startTime}–${b.endTime} ${b.title || b.blockLabel || ""}`.trim()).join("; ")}
          </span>
        ) : null}
        {cancelled.length > 0 ? (
          <span>
            <strong>Cancelled:</strong> {cancelled.map((c) => `${c.startTime} ${c.patientName ?? PATIENT_PLACEHOLDER} (${c.status === "late_cancelled" ? "late cancellation" : "cancelled"})`).join("; ")}
          </span>
        ) : null}
      </p>
      <footer className="mt-auto flex justify-between border-t border-[#94A3B8] pt-3 text-xs text-[#334155]">
        <span>Confidential – contains personal data. Shred after use. No clinical notes are printed on this sheet.</span>
        <span>
          Page {index + 1} of {total}
        </span>
      </footer>
    </section>
  );
}
