"use client";

/**
 * Step 2 of "Complete a form": what was imported from the clinic system – patient and referral,
 * counts, figures calculated by code, data checks and the integration log of the real calls made.
 *
 * Owner: studio-a agent.
 */
import { AlertOctagon, AlertTriangle, Calculator, CheckCircle2, Info, Network } from "lucide-react";
import type { BundleResponse } from "../../../api/contract";
import { NOTICES } from "../../../config.public";
import { ageOn, formatUkDate, todayIso } from "../../../core/dates";
import { DATA_CHECK_LABELS, INCIDENT_TYPE_LABELS, INSTRUCTING_PARTY_LABELS } from "../../../core/labels";
import type { DataCheck, EpisodeBundle } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { cn } from "../../primitives";
import { WORDING } from "../../wording";
import { formatMs, plural } from "../shared/format";
import { AiPayloadPanel } from "./ai-payload-panel";

export function bundleCounts(bundle: EpisodeBundle): { notes: number; appointments: number; scores: number } {
  return {
    notes: bundle.notes.length,
    appointments: bundle.appointments.length,
    scores: bundle.outcomeMeasures.reduce((n, s) => n + s.points.length, 0),
  };
}

export function importedSummary(bundle: EpisodeBundle): string {
  const c = bundleCounts(bundle);
  return `${plural(c.notes, "note")} · ${plural(c.appointments, "appointment")} · ${plural(c.scores, "score")}`;
}

export function DataStep({ data }: { data: BundleResponse }) {
  const { bundle, computedFacts, dataChecks, trace } = data;
  // A clinic's Studio shows no integration log (fix wave 3: technical detail a clinic does not need).
  const tenant = useStudioMode() === "tenant";
  const reg = bundle.registration;
  const c = bundleCounts(bundle);
  const age = ageOn(reg.dob, todayIso());
  const notes = [...bundle.notes].sort((a, b) => (a.date + (a.time ?? "") < b.date + (b.time ?? "") ? -1 : 1));
  const first = notes[0]?.date;
  const last = notes[notes.length - 1]?.date;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2" aria-labelledby="patient-heading">
          <h3 id="patient-heading" className="text-sm font-semibold text-slate-900">
            Patient and referral
          </h3>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Item label="Patient">{reg.fullName}</Item>
            <Item label="Date of birth">
              {formatUkDate(reg.dob)} ({age} years)
            </Item>
            {reg.occupation ? <Item label="Occupation">{reg.occupation}</Item> : null}
            {reg.employer ? <Item label="Employer">{reg.employer}</Item> : null}
            <Item label="Referred by">
              {bundle.referral.name}
              <span className="text-slate-500"> · {INSTRUCTING_PARTY_LABELS[bundle.referral.type]}</span>
            </Item>
            <Item label="Referrer reference">{bundle.referral.reference || "–"}</Item>
            {bundle.incident ? (
              <Item label="Incident">
                {INCIDENT_TYPE_LABELS[bundle.incident.type]}
                {bundle.incident.date ? ` on ${formatUkDate(bundle.incident.date)}` : " (date not recorded)"}
              </Item>
            ) : null}
            <Item label="Episode">
              {first ? `${formatUkDate(first)} – ${last ? formatUkDate(last) : ""}` : "–"} ·{" "}
              {bundle.episodeStatus === "discharged" ? "Discharged" : "Open"}
            </Item>
            <Item label="Clinicians">
              {bundle.clinicians.map((cl) => (cl.hcpc && cl.hcpc !== "Not recorded" ? `${cl.name} (${cl.hcpc})` : `${cl.name} (HCPC number not recorded)`)).join(", ") || "–"}
            </Item>
            <Item label="Disclosure consent">
              {bundle.consent.disclosureConsentRecorded
                ? `Recorded${bundle.consent.date ? ` ${formatUkDate(bundle.consent.date)}` : ""}`
                : "Not recorded"}
            </Item>
          </dl>
        </section>
        <section className="grid grid-cols-3 gap-2 lg:grid-cols-1" aria-label="Record counts">
          <Count label="Clinical notes" value={c.notes} />
          <Count label="Appointments" value={c.appointments} />
          <Count label="Outcome scores" value={c.scores} />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="facts-heading">
          <h3 id="facts-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Calculator className="h-4 w-4 text-indigo-600" aria-hidden />
            {WORDING.byCode.calculatedHeading}
          </h3>
          {computedFacts.length ? (
            <ul className="mt-3 space-y-2">
              {computedFacts.map((f) => (
                <li key={f.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{f.label}</p>
                    <span className="font-mono text-[11px] text-slate-500">{f.id}</span>
                  </div>
                  <p className="text-sm text-slate-700">{f.value}</p>
                  {f.detail && f.detail !== f.value ? <p className="text-xs text-slate-500">{f.detail}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No figures could be calculated from this record.</p>
          )}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="checks-heading">
          <h3 id="checks-heading" className="text-sm font-semibold text-slate-900">
            Data checks
          </h3>
          {dataChecks.length ? (
            <ul className="mt-3 space-y-2">
              {dataChecks.map((d, i) => (
                <CheckRow key={`${d.code}-${i}`} check={d} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> No problems found in the record.
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Checks become flags on the form. Gaps are left blank for the clinician – never guessed.
          </p>
        </section>
      </div>

      {tenant ? null : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="trace-heading">
        <h3 id="trace-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Network className="h-4 w-4 text-slate-500" aria-hidden />
          Integration log
          <span className="font-normal text-slate-500">– the authenticated calls made to fetch this record (no note text logged)</span>
        </h3>
        {trace.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Method</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Request</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Time</th>
                  <th scope="col" className="py-1.5 font-medium">Transport</th>
                </tr>
              </thead>
              <tbody className="font-mono text-slate-700">
                {trace.map((t, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-3">{t.method}</td>
                    <td className="max-w-[420px] truncate py-1.5 pr-3" title={t.note ? `${t.url} – ${t.note}` : t.url}>
                      {t.url}
                    </td>
                    <td className={cn("py-1.5 pr-3", t.status >= 200 && t.status < 300 ? "text-emerald-700" : "text-red-700")}>{t.status || "–"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMs(t.ms)}</td>
                    <td className="py-1.5 font-sans text-slate-500">{t.transport === "http" ? "HTTP" : "In-process"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No calls recorded.</p>
        )}
        </section>
      )}

      <AiPayloadPanel data={data} />

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {NOTICES.dataMinimisation} {WORDING.byCode.identifiersOnForm}
      </p>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center lg:flex lg:items-center lg:justify-between lg:text-left">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function CheckRow({ check }: { check: DataCheck }) {
  const Icon = check.severity === "blocking" ? AlertOctagon : check.severity === "warning" ? AlertTriangle : Info;
  const tone =
    check.severity === "blocking"
      ? "border-red-200 bg-red-50 text-red-900"
      : check.severity === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <li className={cn("flex gap-2 rounded-lg border px-3 py-2 text-sm", tone)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{DATA_CHECK_LABELS[check.code]}</p>
        <p className="text-xs opacity-90">{check.message}</p>
        {check.relatedIds.length ? <p className="mt-0.5 font-mono text-[11px] opacity-75">{check.relatedIds.join(" · ")}</p> : null}
      </div>
    </li>
  );
}
