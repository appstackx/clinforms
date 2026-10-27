import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/account/shell";
import { ActionForm, SelectField, Submit, TextField } from "@/components/pms/records/form";
import { EmptyState, Pill, SectionHeader, TableBox, TD, TH } from "@/components/pms/records/ui";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { noteStatusLabel } from "@/modules/pms/records/notes";
import { NOTE_TYPE_LABELS } from "@/modules/pms/records/templates";
import type { NoteSummary } from "@/modules/pms/records/types";
import { requireClinicActor } from "@/server/pms/actor";
import { PATIENTS_PATH, patientOr404, patientPath } from "@/server/pms/records/record";
import { listCasesForPatient } from "@/server/repos/pms/cases";
import { listNotesForPatient } from "@/server/repos/pms/records/notes";
import { listNoteTemplates } from "@/server/repos/pms/records/templates";
import { startNote } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinical notes" };

function tone(n: NoteSummary) {
  if (n.status === "draft") return "amber" as const;
  if (n.enteredInError || n.status === "discarded") return "neutral" as const;
  return "teal" as const;
}

/** A patient's clinical notes, newest consultation first, and starting a new note from a template. */
export default async function PatientNotesPage({ params, searchParams }: { params: { patientId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const showDiscarded = searchParams.discarded === "1";
  const [notes, cases, templates] = await Promise.all([
    listNotesForPatient(ctx, actor.tenantId, patient.id, { includeDiscarded: showDiscarded }),
    listCasesForPatient(ctx, actor.tenantId, patient.id),
    actor.can("clinical.edit") ? listNoteTemplates(ctx, actor.tenantId) : Promise.resolve([]),
  ]);
  const caseTitle = Object.fromEntries(cases.map((c) => [c.id, c.title]));
  const openCase = cases.find((c) => c.status === "open");
  const hasNotes = notes.some((n) => n.status !== "discarded");
  const suggested = templates.find((t) => t.noteType === (hasNotes ? "follow_up" : "initial")) ?? templates[0];
  const canWrite = actor.can("clinical.edit");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div>
        <SectionHeader title="Clinical notes" description="Signed notes are locked; changes after signing are amendments, shown with the note." />
        {notes.length === 0 ? (
          <EmptyState title="No clinical notes yet">{canWrite ? "Start the first note from a template." : "Notes written by the clinicians appear here."}</EmptyState>
        ) : (
          <TableBox caption="Clinical notes">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={TH}>
                  Seen on
                </th>
                <th scope="col" className={TH}>
                  Note
                </th>
                <th scope="col" className={TH}>
                  Case
                </th>
                <th scope="col" className={TH}>
                  By
                </th>
                <th scope="col" className={TH}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {notes.map((n) => (
                <tr key={n.id} className={n.enteredInError || n.status === "discarded" ? "text-slate-600" : undefined}>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatUkDate(n.seenOn)}</td>
                  <td className={TD}>
                    <Link href={patientPath(patient.id, `notes/${n.id}`)} className={`rounded font-medium text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${n.enteredInError ? "line-through" : ""}`}>
                      {n.templateName}
                    </Link>
                    <span className="block text-xs text-slate-600">{NOTE_TYPE_LABELS[n.noteType]}</span>
                  </td>
                  <td className={TD}>{n.caseId ? (caseTitle[n.caseId] ?? "") : ""}</td>
                  <td className={TD}>{n.signedByName ?? n.authorName ?? ""}</td>
                  <td className={TD}>
                    <Pill tone={tone(n)}>{noteStatusLabel(n)}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        )}
        <p className="mt-3 text-sm">
          <Link href={showDiscarded ? patientPath(patient.id, "notes") : `${patientPath(patient.id, "notes")}?discarded=1`} className="rounded text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
            {showDiscarded ? "Hide discarded drafts" : "Show discarded drafts"}
          </Link>
        </p>
      </div>
      {canWrite ? (
        <aside>
          <Panel title="Start a note">
            {templates.length === 0 ? (
              <p className="text-sm text-slate-600">No note template is in use.</p>
            ) : (
              <ActionForm action={startNote} showSuccess={false}>
                <input type="hidden" name="patientId" value={patient.id} />
                <SelectField label="Template" name="templateId" options={templates.map((t) => ({ value: t.id, label: t.name }))} defaultValue={suggested?.id} required />
                <SelectField label="Case" name="caseId" options={cases.map((c) => ({ value: c.id, label: `${c.title}${c.status === "open" ? "" : " (closed)"}` }))} defaultValue={openCase?.id} emptyLabel="Not linked to a case" />
                <TextField label="Consultation date" name="seenOn" type="date" defaultValue={ukToday()} required />
                <Submit pendingText="Starting…">Start note</Submit>
              </ActionForm>
            )}
            {actor.can("settings.manage") ? (
              <p className="mt-3 text-xs text-slate-600">
                Templates are set up under <Link className="rounded text-teal-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" href={`${PATIENTS_PATH}/note-templates`}>Note templates</Link>.
              </p>
            ) : null}
          </Panel>
        </aside>
      ) : null}
    </div>
  );
}
