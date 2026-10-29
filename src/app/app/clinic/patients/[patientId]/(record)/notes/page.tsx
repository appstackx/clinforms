import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { NewNoteButton } from "@/components/pms/records/new-note-button";
import { NoteRow } from "@/components/pms/records/note-row";
import { Card } from "@/components/pms/records/ui";
import { pmsButtonVariants } from "@/components/pms/ui";
import { requireClinicActor } from "@/server/pms/actor";
import { listNotesFor } from "@/server/pms/records/notes-service";
import { loadRecordHeader } from "@/server/pms/records/record-header";
import { patientPath } from "@/server/pms/records/record";
import { newNote } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinical notes", robots: { index: false, follow: false } };

/**
 * The record's Clinical notes tab (design round 2): every note, newest consultation first, with its state
 * (Unsigned / Signed / Amended), and "New note". clinical.view – reception gets the 404 page (and has no such tab).
 */
export default async function PatientNotesPage({ params, searchParams }: { params: { patientId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const h = await loadRecordHeader(actor, params.patientId);
  const p = h.patient;
  const showDiscarded = searchParams.discarded === "1";
  const notes = showDiscarded ? await listNotesFor(actor, p.id, { includeDiscarded: true }) : null;
  const list = notes && notes.ok ? notes.value : (h.notes ?? []);
  const openCase = h.cases.find((c) => c.status === "open") ?? null;
  const today = h.next && h.next.startsOn === h.today ? h.next : null;
  const canWrite = actor.can("clinical.write") && !h.anonymised && p.status === "active";
  return (
    <Card
      title="Clinical notes"
      action={
        canWrite ? (
          <NewNoteButton action={newNote} patientId={p.id} caseId={openCase?.id ?? null} appointmentId={today?.id ?? null} className={pmsButtonVariants({ variant: "secondary" })}>
            <Pencil aria-hidden />
            New note
          </NewNoteButton>
        ) : null
      }
    >
      {list.length ? (
        <div className="flex flex-col gap-2">
          {list.map((n) => (
            <NoteRow key={n.id} note={n} href={patientPath(p.id, `notes/${n.id}`)} today={h.today} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No clinical notes yet.{canWrite ? " Start the first one with New note." : ""}</p>
      )}
      <p className="text-[13px]">
        <Link href={patientPath(p.id, showDiscarded ? "notes" : "notes?discarded=1")} className="font-medium text-primary-strong underline underline-offset-2">
          {showDiscarded ? "Hide discarded drafts" : "Show discarded drafts"}
        </Link>
      </p>
    </Card>
  );
}
