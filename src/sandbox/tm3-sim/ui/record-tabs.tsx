"use client";

/**
 * Patient record tabs of the simulated clinic system: Registration, Appointments and Clinical notes.
 *
 * Owner: sandbox agent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, CalendarX2, ChevronDown, FileText, NotebookPen } from "lucide-react";
import type { SimAppointment, SimEpisode, SimNote, SimPatient } from "../wire-types";
import {
  formatDate,
  formatDateTime,
  formatDateWithDay,
  formatGbp,
  INCIDENT_LABELS,
  NOTE_TYPE_LABELS,
  REFERRAL_LABELS,
  SEX_LABELS,
} from "./format";
import { EmptyState, Field, Panel, Pill, StatusChip } from "./ui-bits";

/* ------------------------------------------------------------------------------------------------
 * Registration
 * ----------------------------------------------------------------------------------------------*/

export function RegistrationTab({ patient, episode }: { patient: SimPatient; episode: SimEpisode | null }) {
  const a = patient.address;
  return (
    <div className="space-y-4">
      <Panel title="Registration details" headingLevel={3}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title">{patient.title}</Field>
          <Field label="First name">{patient.first_name}</Field>
          <Field label="Last name">{patient.last_name}</Field>
          <Field label="Date of birth">{formatDate(patient.date_of_birth)}</Field>
          <Field label="Sex">{SEX_LABELS[patient.sex]}</Field>
          <Field label="Patient ID">
            <span className="font-mono">{patient.id}</span>
          </Field>
          <Field label="Address">
            {[a.line1, a.line2, a.town, a.postcode].filter(Boolean).join(", ")}
          </Field>
          <Field label="Phone">{patient.phone}</Field>
          <Field label="Email">{patient.email}</Field>
          <Field label="Occupation">{patient.occupation}</Field>
          <Field label="Employer">{patient.employer_name}</Field>
          <Field label="Registered">{formatDateTime(patient.registered_at)}</Field>
        </dl>
      </Panel>

      {episode ? (
        <Panel
          title="Episode of care"
          description={episode.title}
          headingLevel={3}
          actions={<Pill tone={episode.status === "open" ? "blue" : "slate"}>{episode.status === "open" ? "Open" : "Discharged"}</Pill>}
        >
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Episode ID">
              <span className="font-mono">{episode.id}</span>
            </Field>
            <Field label="Dates">
              {formatDate(episode.start_date)} – {episode.end_date ? formatDate(episode.end_date) : "ongoing"}
            </Field>
            <Field label="Primary clinician">
              {episode.primary_clinician.name}
              <span className="block text-xs text-slate-500">
                {episode.primary_clinician.role ? `${episode.primary_clinician.role} · ` : ""}
                {episode.primary_clinician.hcpc}
              </span>
            </Field>
            <Field label="Referral source">
              {REFERRAL_LABELS[episode.referral.source_type]} – {episode.referral.organisation_name}
            </Field>
            <Field label="Reference">{episode.referral.reference}</Field>
            {episode.referral.insurer_name || episode.referral.membership_number || episode.referral.authorisation_number ? (
              <>
                <Field label="Insurer">{episode.referral.insurer_name}</Field>
                <Field label="Membership number">
                  {episode.referral.membership_number ? <span className="font-mono">{episode.referral.membership_number}</span> : null}
                </Field>
                <Field label="Authorisation number">
                  {episode.referral.authorisation_number ? <span className="font-mono">{episode.referral.authorisation_number}</span> : null}
                </Field>
              </>
            ) : null}
            <Field label="Referral contact">{episode.referral.contact_name}</Field>
            <Field label="Referral date">{episode.referral.referral_date ? formatDate(episode.referral.referral_date) : null}</Field>
            <Field label="Referrer address">{episode.referral.address}</Field>
            <Field label="Disclosure consent">
              {episode.consent.disclosure_consent_recorded
                ? `Recorded${episode.consent.recorded_on ? ` on ${formatDate(episode.consent.recorded_on)}` : ""}`
                : "Not recorded"}
            </Field>
          </dl>
          {episode.referral.reason && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reason for referral</p>
              <p className="mt-1 text-sm text-slate-800">{episode.referral.reason}</p>
            </div>
          )}
          {episode.incident && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Incident · {INCIDENT_LABELS[episode.incident.incident_type]}
                {episode.incident.date ? ` · ${formatDate(episode.incident.date)}` : ""}
              </p>
              <p className="mt-1 text-sm text-slate-800">{episode.incident.mechanism}</p>
            </div>
          )}
        </Panel>
      ) : (
        <Panel headingLevel={3}>
          <EmptyState icon={FileText} title="No episode of care recorded">
            This patient is registered only. Clinical notes, appointments and outcome measures appear once an episode
            of care is opened.
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Appointments
 * ----------------------------------------------------------------------------------------------*/

export function AppointmentsTab({
  appointments,
  onOpenNote,
}: {
  appointments: SimAppointment[];
  onOpenNote: (noteId: string) => void;
}) {
  const sorted = useMemo(
    () => appointments.slice().sort((x, y) => `${x.date} ${x.start_time}`.localeCompare(`${y.date} ${y.start_time}`)),
    [appointments],
  );
  if (sorted.length === 0) {
    return (
      <Panel headingLevel={3}>
        <EmptyState icon={CalendarX2} title="No appointments">
          Appointments booked for this episode of care will be listed here.
        </EmptyState>
      </Panel>
    );
  }
  const count = (s: string) => sorted.filter((a) => a.status === s).length;
  // Charges are shown only for episodes that record them (e.g. private medical insurance).
  const showCharges = sorted.some((a) => a.charge);
  const summary = [
    `${sorted.length} appointments`,
    `${count("ATT")} attended`,
    count("DNA") ? `${count("DNA")} did not attend` : null,
    count("LCN") ? `${count("LCN")} late cancellation${count("LCN") > 1 ? "s" : ""}` : null,
    count("CNC") ? `${count("CNC")} cancelled` : null,
    count("BOOKED") ? `${count("BOOKED")} booked` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel title="Appointments" description={summary} headingLevel={3}>
      <div className="-mx-4 overflow-x-auto sm:-mx-5">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Appointments, oldest first</caption>
          <thead className="border-y border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2.5 sm:px-5">Date</th>
              <th scope="col" className="px-3 py-2.5">Time</th>
              <th scope="col" className="px-3 py-2.5">Clinician</th>
              <th scope="col" className="px-3 py-2.5">Status</th>
              {showCharges && <th scope="col" className="px-3 py-2.5">Charge</th>}
              <th scope="col" className="px-3 py-2.5">Reason / note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((a) => (
              <tr key={a.id} className={a.status === "DNA" ? "bg-rose-50/40" : undefined}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-900 sm:px-5">{formatDateWithDay(a.date)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                  {a.start_time} <span className="text-slate-500">({a.duration_minutes} min)</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{a.clinician.name}</td>
                <td className="px-3 py-2.5">
                  <StatusChip status={a.status} />
                </td>
                {showCharges && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                    {a.charge ? (
                      <>
                        {formatGbp(a.charge.amount)}{" "}
                        <span className={a.charge.paid ? "text-slate-500" : "font-medium text-rose-700"}>
                          · {a.charge.paid ? "paid" : "unpaid"}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5 text-slate-700">
                  {a.note_id ? (
                    <button
                      type="button"
                      onClick={() => onOpenNote(a.note_id as string)}
                      className="inline-flex items-center gap-1 rounded text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <NotebookPen className="h-3.5 w-3.5" aria-hidden />
                      View note
                    </button>
                  ) : a.status_reason ? (
                    <span>{a.status_reason}</span>
                  ) : a.status === "DNA" || a.status === "LCN" || a.status === "CNC" ? (
                    <span className="italic text-slate-500">No reason recorded</span>
                  ) : (
                    <span className="text-slate-400">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Clinical notes
 * ----------------------------------------------------------------------------------------------*/

const SOAP: Array<{ key: "subjective" | "objective" | "assessment" | "plan"; label: string }> = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
];

function NoteCard({ note, open, onToggle }: { note: SimNote; open: boolean; onToggle: () => void }) {
  const bodyId = `note-body-${note.id}`;
  return (
    <li id={`note-${note.id}`} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white shadow-sm">
      <h4>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          data-note-toggle={note.id}
          className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:px-5"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{formatDateWithDay(note.note_date)}</span>
              {note.note_time && <span className="text-sm text-slate-500">{note.note_time}</span>}
              <Pill tone={note.note_type === "initial_assessment" || note.note_type === "discharge" ? "blue" : "slate"}>
                {NOTE_TYPE_LABELS[note.note_type]}
              </Pill>
            </span>
            <span className="mt-0.5 block text-xs text-slate-600">
              {note.author.name}
              {note.author.role ? ` · ${note.author.role}` : ""} · {note.author.hcpc}
            </span>
            {!open && <span className="mt-1 line-clamp-1 block text-sm text-slate-600">{note.subjective}</span>}
          </span>
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </h4>
      {open && (
        <div id={bodyId} className="border-t border-slate-100 px-4 py-4 sm:px-5">
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {SOAP.map((s) => (
              <div key={s.key}>
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-50 font-mono text-[11px] text-blue-800">
                    {s.label.charAt(0)}
                  </span>
                  {s.label}
                </dt>
                <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{note[s.key]}</dd>
              </div>
            ))}
            {note.free_text && (
              <div className="md:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Additional notes</dt>
                <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{note.free_text}</dd>
              </div>
            )}
            {note.past_medical_history && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Past medical history</dt>
                <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{note.past_medical_history}</dd>
              </div>
            )}
            {note.social_history && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Social history</dt>
                <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{note.social_history}</dd>
              </div>
            )}
          </dl>
          <p className="mt-4 font-mono text-[11px] text-slate-400">{note.id}</p>
        </div>
      )}
    </li>
  );
}

export function NotesTab({ notes, focus }: { notes: SimNote[]; focus: { id: string; seq: number } | null }) {
  const [newestFirst, setNewestFirst] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement>(null);

  const sorted = useMemo(() => {
    const s = notes
      .slice()
      .sort((x, y) => `${x.note_date} ${x.note_time ?? ""}`.localeCompare(`${y.note_date} ${y.note_time ?? ""}`));
    return newestFirst ? s.reverse() : s;
  }, [notes, newestFirst]);

  const focusNoteId = focus?.id ?? null;
  const focusSeq = focus?.seq ?? 0;
  useEffect(() => {
    if (!focusNoteId) return;
    setExpanded((prev) => ({ ...prev, [focusNoteId]: true }));
    const t = window.setTimeout(() => {
      const el = document.getElementById(`note-${focusNoteId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      const btn = listRef.current?.querySelector<HTMLButtonElement>(`[data-note-toggle="${CSS.escape(focusNoteId)}"]`);
      btn?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusNoteId, focusSeq]);

  if (sorted.length === 0) {
    return (
      <Panel headingLevel={3}>
        <EmptyState icon={NotebookPen} title="No clinical notes">
          SOAP notes written for this episode of care will be listed here.
        </EmptyState>
      </Panel>
    );
  }

  const allOpen = sorted.every((n) => expanded[n.id]);
  const authors = Array.from(new Set(sorted.map((n) => n.author.name)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{sorted.length} SOAP notes</span> · {authors.join(" and ")}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNewestFirst((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
            {newestFirst ? "Newest first" : "Oldest first"}
          </button>
          <button
            type="button"
            onClick={() =>
              setExpanded(allOpen ? {} : Object.fromEntries(sorted.map((n) => [n.id, true] as [string, boolean])))
            }
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>
      <ul ref={listRef} className="space-y-2">
        {sorted.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            open={!!expanded[n.id]}
            onToggle={() => setExpanded((prev) => ({ ...prev, [n.id]: !prev[n.id] }))}
          />
        ))}
      </ul>
    </div>
  );
}
