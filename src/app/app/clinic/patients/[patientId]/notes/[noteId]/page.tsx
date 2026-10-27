import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Panel } from "@/components/account/shell";
import { AmendmentForm } from "@/components/pms/records/amendment-form";
import { BodyChartView } from "@/components/pms/records/body-chart-view";
import { ActionForm, Submit } from "@/components/pms/records/form";
import { NoteEditor } from "@/components/pms/records/note-editor";
import { Pill, SectionHeader, TextLinkTo } from "@/components/pms/records/ui";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { isPlausibleRecordId } from "@/modules/pms/records/form-values";
import { AMENDMENT_KIND_LABELS, noteStatusLabel, shortFingerprint } from "@/modules/pms/records/notes";
import { NOTE_TYPE_LABELS } from "@/modules/pms/records/templates";
import { activityTime } from "@/server/admin/activity";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { listCasesForPatient } from "@/server/repos/pms/cases";
import { getNote, recordNoteView } from "@/server/repos/pms/records/notes";
import { amendNote, discardNote, saveNote } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinical note" };

/**
 * One clinical note: the editor while it is its author's draft; afterwards the signed note (locked), its body chart,
 * the signature and fingerprint, and every amendment in order. Opening a note is recorded in the patient's history.
 */
export default async function NotePage({ params }: { params: { patientId: string; noteId: string } }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const patient = await patientOr404(actor, params.patientId);
  if (!isPlausibleRecordId(params.noteId)) notFound();
  const ctx = actor.repo();
  const note = await getNote(ctx, actor.tenantId, params.noteId);
  if (!note || note.patientId !== patient.id) notFound();
  await recordNoteView(ctx, actor.tenantId, note.id, actor.actor);
  const cases = await listCasesForPatient(ctx, actor.tenantId, patient.id);
  const caseTitle = note.caseId ? cases.find((c) => c.id === note.caseId)?.title : null;
  const mine = note.authorUserId === actor.userId;
  const editable = note.status === "draft" && mine && actor.can("clinical.edit");
  const sectionLabel = Object.fromEntries(note.template.sections.map((s) => [s.key, s.label]));
  const header = (
    <>
      <p className="mb-2 text-sm">
        <TextLinkTo href={patientPath(patient.id, "notes")}>← Clinical notes</TextLinkTo>
      </p>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`text-lg font-semibold text-slate-900 ${note.enteredInError ? "line-through" : ""}`}>{note.templateName}</h2>
          <p className="text-sm text-slate-700">
            {NOTE_TYPE_LABELS[note.noteType]} · seen on {formatUkDate(note.seenOn)}
            {caseTitle ? ` · ${caseTitle}` : ""}
          </p>
          <p className="text-xs text-slate-600">
            Written by {note.authorName ?? "a former member"}, started {activityTime(note.createdAt)}
          </p>
        </div>
        <Pill tone={note.status === "draft" ? "amber" : note.enteredInError ? "neutral" : "teal"}>{noteStatusLabel(note)}</Pill>
      </div>
    </>
  );

  if (editable) {
    return (
      <div className="max-w-3xl">
        {header}
        <NoteEditor
          action={saveNote}
          patientId={patient.id}
          noteId={note.id}
          rev={note.rev}
          template={note.template}
          sections={note.sections}
          bodyChart={note.bodyChart}
          seenOn={note.seenOn}
          caseId={note.caseId}
          cases={cases.map((c) => ({ value: c.id, label: `${c.title}${c.status === "open" ? "" : " (closed)"}` }))}
          canSign={actor.can("clinical.sign")}
          today={ukToday()}
        />
        <details className="mt-6 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer rounded text-sm font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Discard this draft</summary>
          <div className="mt-3">
            <p className="mb-3 text-sm text-slate-700">A discarded draft is hidden from the notes list but kept. Signed notes cannot be discarded.</p>
            <ActionForm action={discardNote} showSuccess={false}>
              <input type="hidden" name="patientId" value={patient.id} />
              <input type="hidden" name="noteId" value={note.id} />
              <input type="hidden" name="expectedRev" value={note.rev} />
              <Submit variant="danger" pendingText="Discarding…" confirmText="Discard this draft? Unsaved changes are lost.">
                Discard draft
              </Submit>
            </ActionForm>
          </div>
        </details>
      </div>
    );
  }

  const filled = note.template.sections.filter((s) => note.sections[s.key]);
  return (
    <div className="max-w-3xl space-y-6">
      <div>{header}</div>
      {note.status === "draft" ? (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Draft by {note.authorName ?? "another member"}: only its author can change or sign it.
        </div>
      ) : null}
      {note.status === "discarded" ? (
        <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          This draft was discarded by its author. It is kept for the record.
        </div>
      ) : null}
      {note.enteredInError ? (
        <div role="status" className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900">
          This note was marked as entered in error. It stays readable for the record – see the amendments below.
        </div>
      ) : null}
      {note.anonymisedAt ? (
        <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          The text of this note was removed when the record was anonymised.
        </div>
      ) : null}
      <Panel>
        {filled.length === 0 && !note.bodyChart ? <p className="text-sm text-slate-600">Nothing written.</p> : null}
        <div className={`space-y-4 ${note.enteredInError ? "opacity-80" : ""}`}>
          {filled.map((s) => (
            <section key={s.key} aria-labelledby={`sec-${s.key}`}>
              <h3 id={`sec-${s.key}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {s.label}
              </h3>
              <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-slate-900">{note.sections[s.key]}</p>
            </section>
          ))}
          {note.bodyChart && note.bodyChart.markers.length > 0 ? <BodyChartView chart={note.bodyChart} /> : null}
        </div>
        {note.status === "signed" ? (
          <div className="mt-6 border-t border-slate-200 pt-3 text-sm text-slate-800">
            <p>
              <span className="font-semibold">Signed by {note.signedByName}</span>
              {note.signedRegistration ? ` (${note.signedRegistration})` : ""} on {note.signedAt ? activityTime(note.signedAt) : ""}.
            </p>
            {note.contentHash ? <p className="text-xs text-slate-600">Content fingerprint {shortFingerprint(note.contentHash)} – locked since signing.</p> : null}
          </div>
        ) : null}
      </Panel>

      {note.status === "signed" ? (
        <section aria-label="Amendments">
          <SectionHeader title="Amendments" description={note.amendments.length ? "In the order they were added. Each one is locked." : "None. Anything added after signing appears here."} />
          {note.amendments.length > 0 ? (
            <ol className="space-y-3">
              {note.amendments.map((a, i) => (
                <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    {i + 1}. {AMENDMENT_KIND_LABELS[a.kind]}
                    {a.sectionKey ? ` – ${sectionLabel[a.sectionKey] ?? a.sectionKey}` : ""}
                  </p>
                  <p className="text-xs text-slate-600">
                    {a.authorName ?? "A former member"}
                    {a.authorRegistration ? ` (${a.authorRegistration})` : ""}, {activityTime(a.createdAt)}
                  </p>
                  {a.kind === "correction" && a.sectionKey && note.sections[a.sectionKey] ? (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-medium">Was: </span>
                      <span className="whitespace-pre-line line-through decoration-slate-500">{note.sections[a.sectionKey]}</span>
                    </p>
                  ) : null}
                  {a.text ? (
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-900">
                      {a.kind === "correction" ? <span className="font-medium">Now: </span> : null}
                      {a.text}
                    </p>
                  ) : null}
                  {a.reason ? <p className="mt-1 text-sm text-slate-700">Reason: {a.reason}</p> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {actor.can("clinical.sign") && !note.anonymisedAt ? (
            <Panel title="Add an amendment" className="mt-4">
              <AmendmentForm
                key={note.amendmentCount}
                action={amendNote}
                patientId={patient.id}
                noteId={note.id}
                sections={note.template.sections.map((s) => ({ value: s.key, label: s.label }))}
                enteredInError={note.enteredInError}
              />
            </Panel>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
