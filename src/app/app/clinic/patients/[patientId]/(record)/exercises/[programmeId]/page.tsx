import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ProgrammeEditor } from "@/components/pms/records/exercise-programme-editor";
import { ActionForm, CheckboxField, Submit } from "@/components/pms/records/form";
import { Card, EmptyState, Pill, SectionHeader, TableBox, TD, TH } from "@/components/pms/records/ui";
import { pmsButtonVariants } from "@/components/pms/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { PROGRAMME_STATUS_LABELS, adherenceLine, doseLine } from "@/modules/pms/records/exercises";
import { requireClinicActor } from "@/server/pms/actor";
import { programmeFor } from "@/server/pms/records/exercises-service";
import { patientPath } from "@/server/pms/records/record";
import { endProgramme, newVersion, saveProgramme, shareProgramme } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exercise programme" };

/**
 * Record → Exercises → one programme (ex03–ex05). A draft: the builder, then "Share with the patient". Shared or
 * ended: the exercises as given (locked), the patient's check-ins, the PDF and "Make a new version". Opening it is
 * recorded in the patient's history.
 */
export default async function ProgrammePage({ params }: { params: { patientId: string; programmeId: string } }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const r = await programmeFor(actor, params.patientId, params.programmeId, { recordView: true });
  if (!r.ok) {
    if (r.code === "not_found" || r.code === "forbidden") notFound();
    return <p role="alert">{r.error}</p>;
  }
  const { programme: p, checkins, adherence, cases, library, canWrite } = r.value;
  const hidden = (
    <>
      <input type="hidden" name="patientId" value={params.patientId} />
      <input type="hidden" name="programmeId" value={p.id} />
      <input type="hidden" name="rev" value={p.rev} />
    </>
  );
  const caseTitle = p.caseId ? cases.find((c) => c.id === p.caseId)?.title : null;
  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href={patientPath(params.patientId, "exercises")} className="text-primary-strong underline underline-offset-2">
          ← All exercise programmes
        </Link>
      </p>
      <SectionHeader
        title={p.title ?? "(anonymised)"}
        description={[PROGRAMME_STATUS_LABELS[p.status], p.sharedAt ? `shared ${formatUkDate(p.sharedAt.slice(0, 10))}${p.sharedByName ? ` by ${p.sharedByName}` : ""}` : null, p.endedAt ? `ended ${formatUkDate(p.endedAt.slice(0, 10))}` : null, caseTitle ? `case: ${caseTitle}` : null]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <a href={patientPath(params.patientId, `exercises/${p.id}/pdf`)} className={pmsButtonVariants({ variant: "secondary" })}>
            <Download aria-hidden />
            Print (PDF)
          </a>
        }
      />
      {p.replacesId ? <p className="text-sm text-[#475569]">A new version of an earlier programme{p.status === "draft" ? " – sharing it ends the earlier one." : "."}</p> : null}

      {p.status === "draft" && canWrite ? (
        <>
          <Card title="Build the programme">
            <ProgrammeEditor
              action={saveProgramme}
              patientId={params.patientId}
              programmeId={p.id}
              rev={p.rev}
              title={p.title ?? ""}
              notes={p.notes}
              caseId={p.caseId}
              cases={cases.filter((c) => c.status === "open" || c.id === p.caseId).map((c) => ({ value: c.id, label: c.title }))}
              initialItems={p.items}
              library={library}
            />
          </Card>
          <Card title="Share with the patient" description="Save the draft first. Once shared, the programme is locked: to change it, make a new version.">
            <ActionForm action={shareProgramme}>
              {hidden}
              <CheckboxField label="Email the patient a link to their portal" name="notify" hint="The email does not name the programme." />
              <Submit pendingText="Sharing…" confirmText="Share this programme with the patient? It is locked once shared.">
                Share with the patient
              </Submit>
            </ActionForm>
            <div className="mt-4 border-t border-border pt-4">
              <ActionForm action={endProgramme}>
                {hidden}
                <Submit variant="secondary" pendingText="Saving…" confirmText="Discard this draft? It is kept on the record as ended.">
                  Discard draft
                </Submit>
              </ActionForm>
            </div>
          </Card>
        </>
      ) : (
        <Card title={`Exercises (${p.items.length})`}>
          {p.notes ? <p className="mb-3 whitespace-pre-wrap rounded-xl bg-[#F8FAFC] p-3 text-sm">{p.notes}</p> : null}
          {p.items.length === 0 ? <EmptyState title="No exercises" /> : null}
          <ol className="space-y-3">
            {p.items.map((it, i) => (
              <li key={i} className="rounded-xl border border-border p-3">
                <strong className="text-[15px]">
                  {i + 1}. {it.name}
                </strong>
                {doseLine(it) ? <p className="text-sm font-medium text-[#0F766E]">{doseLine(it)}</p> : null}
                {it.instructions ? <p className="mt-1 whitespace-pre-wrap text-sm">{it.instructions}</p> : null}
                {it.cautions ? <p className="mt-1 text-sm"><span className="font-semibold">Take care: </span>{it.cautions}</p> : null}
                {it.notes ? <p className="mt-1 text-sm"><span className="font-semibold">Note: </span>{it.notes}</p> : null}
                {it.videoUrl || it.imageUrl ? (
                  <p className="mt-1 break-all text-xs text-[#475569]">{[it.videoUrl ? `Video: ${it.videoUrl}` : null, it.imageUrl ? `Picture: ${it.imageUrl}` : null].filter(Boolean).join(" · ")}</p>
                ) : null}
              </li>
            ))}
          </ol>
          {canWrite && p.status !== "draft" && p.title !== null ? (
            <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
              <ActionForm action={newVersion} showSuccess={false}>
                {hidden}
                <Submit pendingText="Copying…">Make a new version</Submit>
              </ActionForm>
              {p.status === "shared" ? (
                <ActionForm action={endProgramme}>
                  {hidden}
                  <Submit variant="secondary" pendingText="Saving…" confirmText="End this programme? The patient no longer sees it in the portal.">
                    End programme
                  </Submit>
                </ActionForm>
              ) : null}
            </div>
          ) : null}
        </Card>
      )}

      {p.status !== "draft" ? (
        <Card title="Patient check-ins" description={adherenceLine(adherence) ?? "The patient has not checked in yet. They do it in their portal."}>
          {adherence.averagePain !== null ? <p className="mb-2 text-sm">Average pain over the last {adherence.days} days: <strong>{adherence.averagePain}/10</strong></p> : null}
          {checkins.length > 0 ? (
            <TableBox caption="Check-ins">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Date</th>
                  <th scope="col" className={TH}>Did the exercises</th>
                  <th scope="col" className={TH}>Pain (0–10)</th>
                  <th scope="col" className={TH}>Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {checkins.map((c) => (
                  <tr key={c.id}>
                    <td className={`${TD} whitespace-nowrap`}>{formatUkDate(c.doneOn)}</td>
                    <td className={TD}>{c.completed ? <Pill tone="teal">Yes</Pill> : <Pill tone="amber">No</Pill>}</td>
                    <td className={`${TD} tabular-nums`}>{c.painScore ?? "–"}</td>
                    <td className={`${TD} whitespace-pre-wrap`}>{c.comment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </TableBox>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
