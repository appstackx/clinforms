import { mayAmendNote } from "@/modules/pms/core/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { NoteScreen, type AmendmentView } from "@/components/pms/records/note-screen";
import { UnsignedAside } from "@/components/pms/records/unsigned-aside";
import { DischargeLetterButton } from "@/components/pms/comms/letter-discharge";
import { personName } from "@/components/pms/records/format";
import { FlagPill } from "@/components/pms/ui";
import { setAppointmentStatusAction } from "@/app/app/clinic/diary/actions";
import { formatUkDate } from "@/modules/pms/core/text";
import { ageOn, isPlausibleRecordId } from "@/modules/pms/records/form-values";
import { formatScore, MEASURES } from "@/modules/pms/records/outcomes";
import { NOTE_TYPE_LABELS } from "@/modules/pms/records/templates";
import { requireClinicActor } from "@/server/pms/actor";
import { getNoteFor, templatesForNewNote, unsignedNotesFor } from "@/server/pms/records/notes-service";
import { outcomesFor } from "@/server/pms/records/outcomes-service";
import { loadRecordHeader } from "@/server/pms/records/record-header";
import { noteAuthorOf } from "@/server/pms/records/access";
import { patientPath } from "@/server/pms/records/record";
import { amendNoteAction, changeNoteTemplateAction, copyLastNoteAction, discardNoteAction, saveNoteDraftAction } from "../actions";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Clinical note", robots: { index: false, follow: false } }, "clinical.view");

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const dateOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

/**
 * /patients/[id]/notes/[noteId] – one clinical note (design round 2, "Clinical notes – editor, sign, amend,
 * unsigned"): its own screen, outside the record's header and tabs, with "My unsigned notes" beside it.
 * clinical.view (reception gets the 404 page – the service refuses them too, before reading); opening the note is
 * recorded in the patient's history. The editor is the author's own draft; anyone else sees it read-only.
 */
export default async function NotePage({ params }: { params: { patientId: string; noteId: string } }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  if (!isPlausibleRecordId(params.noteId)) notFound();
  const h = await loadRecordHeader(actor, params.patientId);
  const p = h.patient;
  const result = await getNoteFor(actor, p.id, params.noteId);
  if (!result.ok) notFound();
  const { note, editable, signable, amendable } = result.value;
  const [templates, unsigned, outcomes, me] = await Promise.all([
    editable ? templatesForNewNote(actor) : Promise.resolve(null),
    unsignedNotesFor(actor),
    outcomesFor(actor, p.id),
    noteAuthorOf(actor),
  ]);
  const name = personName(p);
  const age = ageOn(p.dateOfBirth, h.today);
  const caseTitle = note.caseId ? h.cases.find((c) => c.id === note.caseId)?.title : null;
  const appt = note.appointmentId && h.appointments ? [...h.appointments.upcoming, ...h.appointments.past].find((r) => r.id === note.appointmentId) : null;
  const meta = [
    appt ? `${appt.dateLabel} ${appt.timeLabel.split("–")[0]}` : `${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${note.seenOn}T12:00:00Z`))} ${formatUkDate(note.seenOn)}`,
    appt?.serviceName ?? NOTE_TYPE_LABELS[note.noteType],
    appt?.roomName ?? null,
    caseTitle ? `Case: ${lowerFirst(caseTitle)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = Object.fromEntries(note.template.sections.map((s) => [s.key, s.label]));
  const amendments: AmendmentView[] = note.amendments.map((a) => ({
    id: a.id,
    kind: a.kind,
    sectionLabel: a.sectionKey ? (label[a.sectionKey] ?? a.sectionKey) : null,
    text: a.text,
    reason: a.reason,
    author: a.authorRegistration ? `${a.authorName ?? "A former member"} (${a.authorRegistration})` : (a.authorName ?? "A former member"),
    at: `${dateOf(a.createdAt)} ${timeOf(a.createdAt)}`,
  }));
  const signer = note.signedByName ? `${note.signedByName}${note.signedRegistration ? ` (${note.signedRegistration})` : ""}` : null;
  const outcomesToday =
    outcomes.ok
      ? outcomes.value.scores.filter((o) => o.takenOn === note.seenOn && o.status === "recorded").map((o) => ({ label: MEASURES[o.measure].short, value: formatScore(o.measure, o.scoreTenths).replace(/\/(10|100)$/, "") }))
      : [];
  const unsignedView = unsigned.ok ? unsigned.value : null;
  const flags = h.flags ?? [];
  const alerts = (p.alerts ?? "").split(/\n|;/).map((s) => s.trim()).filter(Boolean).slice(0, 6);

  return (
    <div className="mx-auto grid w-full max-w-[1320px] gap-6 lg:grid-cols-[236px_minmax(0,1fr)]">
      {unsignedView ? (
        <UnsignedAside
          className="hidden lg:flex"
          items={unsignedView.notes.map((n) => ({ id: n.id, href: patientPath(n.patientId, `notes/${n.id}`), patientName: n.patient ? personName(n.patient) : "Patient", seenOn: n.seenOn, templateName: n.templateName, overdue: n.overdue }))}
          days={unsignedView.days}
          currentId={note.id}
          today={h.today}
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-[#475569]">
          <Link href={patientPath(p.id)} className="text-primary-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {name}
          </Link>
          <span aria-hidden>/</span>
          <Link href={patientPath(p.id, "notes")} className="text-primary-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Clinical notes
          </Link>
          {unsignedView ? (
            <Link href="/app/clinic/patients/unsigned-notes" className="ml-auto text-[13px] font-medium text-primary-strong underline underline-offset-2 lg:hidden">
              My unsigned notes ({unsignedView.notes.length})
            </Link>
          ) : null}
        </nav>
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Alerts">
          {alerts.map((a) => (
            <li key={`a-${a}`}>
              <FlagPill variant="alert" icon={<AlertTriangle />}>
                {a}
              </FlagPill>
            </li>
          ))}
          {flags.map((f) => (
            <li key={f.id}>
              <FlagPill variant="alert" icon={<AlertTriangle />}>
                {f.text}
              </FlagPill>
            </li>
          ))}
          <li className="text-sm text-[#334155]">
            {name}
            {p.dateOfBirth ? ` · DOB ${formatUkDate(p.dateOfBirth)}${age !== null ? ` (${age})` : ""}` : ""}
          </li>
        </ul>
        {note.noteType === "discharge" && note.status === "signed" && !note.enteredInError && actor.can("messages.letters") ? <DischargeLetterButton patientId={p.id} noteId={note.id} /> : null}
        <NoteScreen
          key={`${note.id}-${note.rev}-${note.status}-${note.amendmentCount}`}
          patientId={p.id}
          noteId={note.id}
          rev={note.rev}
          status={note.status}
          enteredInError={note.enteredInError}
          title={`${note.templateName}${caseTitle ? ` – ${lowerFirst(caseTitle)}` : ""}`}
          meta={meta}
          templateId={note.templateId}
          templates={templates && templates.ok ? templates.value.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name })) : [{ id: note.templateId, name: note.templateName }]}
          sections={note.template.sections}
          values={note.sections}
          bodyChartEnabled={note.template.bodyChart}
          bodyChart={note.bodyChart}
          updatedAt={note.updatedAt}
          editable={editable}
          signable={signable}
          amendable={amendable}
          draftOf={note.status === "draft" && !result.value.mine ? (note.authorName ?? "another member") : null}
          signedLine={note.signedAt && signer ? `Signed by ${signer} on ${dateOf(note.signedAt)} at ${timeOf(note.signedAt)}.` : null}
          signerLabel={me.registration ? `${me.name} (${me.registration})` : me.name}
          registrationMissing={me.registration?.trim() ? null : { href: actor.can("settings.members") ? `/app/clinic/access/${encodeURIComponent(actor.userId)}` : null }}
          amendments={amendments}
          outcomesToday={outcomesToday}
          outcomesHref={patientPath(p.id, "outcomes")}
          appointment={appt ? { id: appt.id, rev: appt.rev, canComplete: actor.can("diary.book") && appt.nextStatuses.includes("attended") } : null}
          backHref={patientPath(p.id, "notes")}
          actions={{
            save: saveNoteDraftAction,
            changeTemplate: changeNoteTemplateAction,
            copyLast: copyLastNoteAction,
            discard: discardNoteAction,
            amend: amendNoteAction,
            // The diary's merged server action (src/app/app/clinic/diary/actions.ts): marks the appointment attended.
            completeAppointment: setAppointmentStatusAction,
          }}
        />
      </div>
    </div>
  );
}
