import Link from "next/link";
import { Card as Panel } from "@/components/pms/records/ui";
import { AttachmentUpload } from "@/components/pms/records/attachment-upload";
import { ActionForm, Submit, TextField } from "@/components/pms/records/form";
import { EmptyState, Pill, SectionHeader } from "@/components/pms/records/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_PATIENT, formatBytes } from "@/modules/pms/records/attachments";
import { NOTE_TYPE_LABELS } from "@/modules/pms/records/templates";
import { formatUkDateTime } from "@/modules/pms/core/access";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { getPatientAttachments } from "@/server/repos/pms/records/attachments";
import { listNotesForPatient } from "@/server/repos/pms/records/notes";
import { withdrawFile } from "./actions";
import { ImagePreview } from "@/components/pms/records/image-preview";
import { ShareWithPatient } from "@/components/pms/portal/share-with-patient";
import { attachmentSharesFor } from "@/server/pms/portal/staff-shares";
import { shareAttachmentAction, withdrawShareAction } from "../forms/share-actions";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Attachments" }, "clinical.view");

/** Files attached to the patient's record (referral letters, reports, images) – encrypted, never deleted. */
export default async function AttachmentsPage({ params, searchParams }: { params: { patientId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const showWithdrawn = searchParams.withdrawn === "1";
  const [files, notes, sharing] = await Promise.all([getPatientAttachments(ctx, actor.tenantId, patient.id, { includeWithdrawn: true }), listNotesForPatient(ctx, actor.tenantId, patient.id), attachmentSharesFor(actor, patient.id)]);
  // "Share with the patient" (portal module, PORTAL-004): why it cannot be done now, if so.
  const shareBlocked = !sharing ? null : !sharing.portal.enabled ? "The patient portal is switched off (Set-up → Online booking)." : sharing.portal.access === "disabled" ? "The patient's portal access is switched off (Forms tab)." : null;
  const shown = files.filter((f) => showWithdrawn || f.status === "active");
  const noteLabel = Object.fromEntries(notes.map((n) => [n.id, `${formatUkDate(n.seenOn)} – ${NOTE_TYPE_LABELS[n.noteType]}`]));
  const canWrite = actor.can("clinical.write") && files.length < MAX_ATTACHMENTS_PER_PATIENT;
  const withdrawnCount = files.length - files.filter((f) => f.status === "active").length;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div>
        <SectionHeader title="Attachments" description="Referral letters, scan reports and images on the patient's record. Downloads are recorded in the history." />
        {shown.length === 0 ? (
          <EmptyState title="No files attached">{canWrite ? "Attach a referral letter, a report or an image." : null}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {shown.map((f) => (
              <li key={f.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {f.status === "active" ? (
                      <a href={patientPath(patient.id, `attachments/${f.id}`)} className="break-all rounded font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        {f.fileName}
                        <span className="sr-only"> (download)</span>
                      </a>
                    ) : (
                      <span className="break-all font-medium text-[#334155] line-through">{f.fileName}</span>
                    )}
                    <p className="text-sm text-[#334155]">{f.description ?? ""}</p>
                    <p className="text-xs text-muted-foreground">
                      {ATTACHMENT_TYPES[f.type].label} · {formatBytes(f.sizeBytes)} · added {formatUkDateTime(f.createdAt)}
                      {f.noteId && noteLabel[f.noteId] ? (
                        <>
                          {" · note "}
                          <Link className="rounded text-primary-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={patientPath(patient.id, `notes/${f.noteId}`)}>
                            {noteLabel[f.noteId]}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {f.status === "withdrawn" ? <p className="mt-1 text-xs text-[#334155]">Withdrawn{f.withdrawnAt ? ` ${formatUkDateTime(f.withdrawnAt)}` : ""}: {f.withdrawnReason ?? ""}</p> : null}
                  </div>
                  {f.status === "withdrawn" ? <Pill>Withdrawn</Pill> : f.type === "jpeg" || f.type === "png" ? <ImagePreview href={patientPath(patient.id, `attachments/${f.id}`)} name={f.fileName} /> : null}
                </div>
                {sharing && (f.status === "active" || (sharing.byAttachment[f.id]?.length ?? 0) > 0) ? (
                  <ShareWithPatient
                    fileLabel={f.fileName}
                    shares={sharing.byAttachment[f.id] ?? []}
                    canShare={sharing.canShare && f.status === "active"}
                    blocked={shareBlocked}
                    canEmail={sharing.portal.hasEmail}
                    share={shareAttachmentAction.bind(null, patient.id, f.id)}
                    withdraw={withdrawShareAction.bind(null, patient.id)}
                  />
                ) : null}
                {f.status === "active" && actor.can("clinical.write") ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer rounded text-xs font-medium text-[#334155] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Withdraw this file</summary>
                    <div className="mt-2 max-w-sm">
                      <ActionForm action={withdrawFile} className="space-y-2">
                        <input type="hidden" name="patientId" value={patient.id} />
                        <input type="hidden" name="attachmentId" value={f.id} />
                        <TextField label="Reason" name="reason" required maxLength={500} hint="It is hidden from the record but kept." />
                        <Submit variant="danger" pendingText="Withdrawing…">
                          Withdraw file
                        </Submit>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {withdrawnCount > 0 ? (
          <p className="mt-3 text-sm">
            <Link href={showWithdrawn ? patientPath(patient.id, "attachments") : `${patientPath(patient.id, "attachments")}?withdrawn=1`} className="rounded text-primary-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {showWithdrawn ? "Hide withdrawn files" : `Show withdrawn files (${withdrawnCount})`}
            </Link>
          </p>
        ) : null}
      </div>
      {canWrite ? (
        <aside>
          <Panel title="Attach a file">
            <AttachmentUpload uploadUrl={patientPath(patient.id, "attachments/upload")} notes={notes.filter((n) => n.status !== "discarded").map((n) => ({ value: n.id, label: `${formatUkDate(n.seenOn)} – ${n.templateName}` }))} />
          </Panel>
        </aside>
      ) : null}
    </div>
  );
}
