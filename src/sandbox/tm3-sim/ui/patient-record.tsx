"use client";

/**
 * Simulated clinic patient record: header, tabs (Registration, Appointments, Clinical notes, Outcome
 * measures, Documents) and the "Connected apps" card that launches ClinForms.
 * The selected tab is mirrored in the URL hash (#appointments, #notes, …) so it survives a reload.
 *
 * Owner: sandbox agent.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronLeft } from "lucide-react";
import type { SimAppointment, SimClinician, SimEpisode, SimNote, SimOutcomeMeasure, SimPatient } from "../wire-types";
import { ConnectedAppsCard, type LaunchReportFn } from "./connected-apps-card";
import { DocumentsTab, useFiledDocuments } from "./documents-tab";
import { ageOn, formatDate, fullName, initials, REFERRAL_LABELS, SEX_LABELS } from "./format";
import { OutcomesTab } from "./outcomes-tab";
import { AppointmentsTab, NotesTab, RegistrationTab } from "./record-tabs";
import { Pill } from "./ui-bits";

export interface EpisodeRecord {
  episode: SimEpisode;
  notes: SimNote[];
  appointments: SimAppointment[];
  outcomeMeasures: SimOutcomeMeasure[];
}

const TABS = ["registration", "appointments", "notes", "outcomes", "documents"] as const;
type TabKey = (typeof TABS)[number];
const isTab = (v: string): v is TabKey => (TABS as readonly string[]).includes(v);

function TabTrigger({ value, label, count }: { value: TabKey; label: string; count?: number | null }) {
  return (
    <Tabs.Trigger
      value={value}
      className="group relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800"
    >
      {label}
      {typeof count === "number" && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 group-data-[state=active]:bg-blue-50 group-data-[state=active]:text-blue-800">
          {count}
        </span>
      )}
    </Tabs.Trigger>
  );
}

export function PatientRecord({
  appName,
  patient,
  episodes,
  clinicians,
  launch,
}: {
  /** Display name of the connected report app (the product), passed in by the page. */
  appName: string;
  patient: SimPatient;
  episodes: EpisodeRecord[];
  clinicians: SimClinician[];
  launch: LaunchReportFn;
}) {
  const [tab, setTab] = useState<TabKey>("registration");
  const [episodeId, setEpisodeId] = useState<string | null>(episodes[episodes.length - 1]?.episode.id ?? null);
  const [noteFocus, setNoteFocus] = useState<{ id: string; seq: number } | null>(null);
  const docs = useFiledDocuments(patient.id);

  const current = episodes.find((e) => e.episode.id === episodeId) ?? null;
  const episode = current?.episode ?? null;

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (isTab(h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const changeTab = useCallback((value: string) => {
    if (!isTab(value)) return;
    setTab(value);
    try {
      window.history.replaceState(null, "", value === "registration" ? window.location.pathname : `#${value}`);
    } catch {
      // ignore
    }
  }, []);

  const openNote = useCallback(
    (noteId: string) => {
      changeTab("notes");
      setNoteFocus((prev) => ({ id: noteId, seq: (prev?.seq ?? 0) + 1 }));
    },
    [changeTab],
  );

  const age = ageOn(patient.date_of_birth);

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb">
        <Link
          href="/pms-sandbox"
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          All patients
        </Link>
      </nav>

      <header className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-800 text-lg font-semibold text-white"
          aria-hidden
        >
          {initials(patient)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {patient.title ? <span className="font-normal text-slate-500">{patient.title} </span> : null}
            {fullName(patient)}
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            <span>
              DOB <span className="font-medium text-slate-800">{formatDate(patient.date_of_birth)}</span>
              {age !== null && ` (${age})`}
            </span>
            <span>{SEX_LABELS[patient.sex]}</span>
            <span>
              ID <span className="font-mono text-slate-800">{patient.id}</span>
            </span>
            {patient.occupation && <span>{patient.occupation}</span>}
          </p>
        </div>
        {episode && (
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <Pill tone="blue">{REFERRAL_LABELS[episode.referral.source_type]} referral</Pill>
            <Pill>{episode.status === "open" ? "Episode open" : `Discharged ${formatDate(episode.end_date)}`}</Pill>
          </div>
        )}
      </header>

      {episodes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="episode-select" className="text-sm font-medium text-slate-700">
            Episode of care
          </label>
          <select
            id="episode-select"
            value={episodeId ?? ""}
            onChange={(e) => setEpisodeId(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          >
            {episodes.map((e) => (
              <option key={e.episode.id} value={e.episode.id}>
                {formatDate(e.episode.start_date)} – {e.episode.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 min-w-0 lg:order-1">
          <Tabs.Root value={tab} onValueChange={changeTab}>
            <Tabs.List
              aria-label="Patient record"
              className="-mx-4 flex overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0"
            >
              <TabTrigger value="registration" label="Registration" />
              <TabTrigger value="appointments" label="Appointments" count={current ? current.appointments.length : null} />
              <TabTrigger value="notes" label="Clinical notes" count={current ? current.notes.length : null} />
              <TabTrigger value="outcomes" label="Outcome measures" count={current ? current.outcomeMeasures.length : null} />
              <TabTrigger value="documents" label="Documents" count={docs ? docs.length : null} />
            </Tabs.List>
            <div className="pt-4">
              <Tabs.Content value="registration" className="focus-visible:outline-none">
                <RegistrationTab patient={patient} episode={episode} />
              </Tabs.Content>
              <Tabs.Content value="appointments" className="focus-visible:outline-none">
                <AppointmentsTab appointments={current?.appointments ?? []} onOpenNote={openNote} />
              </Tabs.Content>
              <Tabs.Content value="notes" className="focus-visible:outline-none">
                <NotesTab notes={current?.notes ?? []} focus={noteFocus} />
              </Tabs.Content>
              <Tabs.Content value="outcomes" className="focus-visible:outline-none">
                <OutcomesTab measures={current?.outcomeMeasures ?? []} />
              </Tabs.Content>
              <Tabs.Content value="documents" className="focus-visible:outline-none">
                <DocumentsTab docs={docs} appName={appName} />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>

        <aside className="order-1 space-y-4 lg:order-2" aria-label="Apps and episode summary">
          <ConnectedAppsCard
            key={episode?.id ?? "none"}
            appName={appName}
            patientId={patient.id}
            episode={episode}
            clinicians={clinicians}
            launch={launch}
          />
          {episode && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-5" aria-labelledby="episode-summary-title">
              <h2 id="episode-summary-title" className="text-sm font-semibold text-slate-900">
                Episode summary
              </h2>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Referrer</dt>
                  <dd className="text-right text-slate-800">{episode.referral.organisation_name}</dd>
                </div>
                {episode.referral.reference && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="font-mono text-slate-800">{episode.referral.reference}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Dates</dt>
                  <dd className="text-right text-slate-800">
                    {formatDate(episode.start_date)} – {episode.end_date ? formatDate(episode.end_date) : "ongoing"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Clinician</dt>
                  <dd className="text-right text-slate-800">{episode.primary_clinician.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Record</dt>
                  <dd className="text-right text-slate-800">
                    {current?.notes.length ?? 0} notes · {current?.appointments.length ?? 0} appointments
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
