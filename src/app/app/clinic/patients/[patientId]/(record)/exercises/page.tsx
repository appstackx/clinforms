import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SelectField, Submit, TextField } from "@/components/pms/records/form";
import { Card, EmptyState, Pill, SectionHeader, TableBox, TD, TH } from "@/components/pms/records/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { PROGRAMME_STATUS_LABELS, adherenceLine } from "@/modules/pms/records/exercises";
import { requireClinicActor } from "@/server/pms/actor";
import { programmesFor } from "@/server/pms/records/exercises-service";
import { patientPath } from "@/server/pms/records/record";
import { startProgramme } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exercise programmes" };

const TONE = { draft: "amber", shared: "teal", ended: "neutral" } as const;

/** Record → Exercises (ex03–ex05): the patient's home exercise programmes, their check-ins, and starting a new one. */
export default async function ExercisesPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const r = await programmesFor(actor, params.patientId);
  if (!r.ok) {
    if (r.code === "not_found" || r.code === "forbidden") notFound();
    return <p role="alert">{r.error}</p>;
  }
  const { programmes, cases, canWrite } = r.value;
  const openCases = cases.filter((c) => c.status === "open");
  return (
    <div className="space-y-6">
      <SectionHeader title="Exercise programmes" description="Built from the clinic's own exercise library. Shared programmes show in the patient's portal, where they check in with how it went." />
      {programmes.length === 0 ? <EmptyState title="No exercise programmes yet">{canWrite ? "Start the first one below." : null}</EmptyState> : null}
      {programmes.length > 0 ? (
        <TableBox caption="Exercise programmes">
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Programme
              </th>
              <th scope="col" className={TH}>
                Status
              </th>
              <th scope="col" className={TH}>
                Exercises
              </th>
              <th scope="col" className={TH}>
                Shared
              </th>
              <th scope="col" className={TH}>
                Check-ins
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {programmes.map((p) => (
              <tr key={p.id}>
                <td className={TD}>
                  <Link href={patientPath(params.patientId, `exercises/${p.id}`)} className="font-medium text-primary-strong underline underline-offset-2">
                    {p.title ?? "(anonymised)"}
                  </Link>
                </td>
                <td className={TD}>
                  <Pill tone={TONE[p.status]}>{PROGRAMME_STATUS_LABELS[p.status]}</Pill>
                </td>
                <td className={`${TD} tabular-nums`}>{p.itemCount}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  {p.sharedAt ? formatUkDate(p.sharedAt.slice(0, 10)) : "–"}
                  {p.sharedAt ? <span className="block text-xs text-[#475569]">{p.patientViewedAt ? "Opened by the patient" : "Not opened yet"}</span> : null}
                </td>
                <td className={`${TD} text-sm`}>
                  {adherenceLine(p.adherence) ?? "None yet"}
                  {p.adherence.latestPain !== null ? <span className="block text-xs text-[#475569]">Latest pain {p.adherence.latestPain}/10</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      ) : null}
      {canWrite ? (
        <Card title="Start a programme" description="You add the exercises on the next page. Nothing reaches the patient until you share it.">
          <ActionForm action={startProgramme} showSuccess={false}>
            <input type="hidden" name="patientId" value={params.patientId} />
            <TextField label="Title" name="title" required maxLength={120} placeholder="For example: Knee – weeks 1 to 2" hint="The patient sees this title." />
            {openCases.length > 0 ? <SelectField label="Case (optional)" name="caseId" options={openCases.map((c) => ({ value: c.id, label: c.title }))} defaultValue={openCases.length === 1 ? openCases[0].id : ""} emptyLabel="No case" /> : null}
            <Submit pendingText="Starting…">Start the programme</Submit>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
