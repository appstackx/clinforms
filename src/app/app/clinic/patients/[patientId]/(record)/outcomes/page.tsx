import Link from "next/link";
import { Card as Panel } from "@/components/pms/records/ui";
import { ActionForm, Submit, TextField } from "@/components/pms/records/form";
import { OutcomeChart } from "@/components/pms/records/outcome-chart";
import { OutcomeForm } from "@/components/pms/records/outcome-form";
import { EmptyState, Pill, SectionHeader, TableBox, TD, TH } from "@/components/pms/records/ui";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { MEASURES, OUTCOME_MEASURES, formatScore, outcomeChange } from "@/modules/pms/records/outcomes";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404 } from "@/server/pms/records/record";
import { listCasesForPatient } from "@/server/repos/pms/cases";
import { listOutcomesForPatient } from "@/server/repos/pms/records/outcomes";
import { markMeasureInError, recordMeasure } from "./actions";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Outcome measures" }, "clinical.view");

/** Outcome measures over time (NDI, ODI, NPRS, PSFS, QuickDASH): a chart and table per measure, and recording a new one. */
export default async function OutcomesPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const [outcomes, cases] = await Promise.all([listOutcomesForPatient(ctx, actor.tenantId, patient.id, { includeErrors: true }), listCasesForPatient(ctx, actor.tenantId, patient.id)]);
  const recorded = outcomes.filter((o) => o.status === "recorded");
  const measures = OUTCOME_MEASURES.filter((m) => outcomes.some((o) => o.measure === m));
  const canWrite = actor.can("clinical.write");
  const openCase = cases.find((c) => c.status === "open");
  return (
    <div className="space-y-6">
      <SectionHeader title="Outcome measures" description="Scores are worked out from the patient's answers. A wrong entry is marked as an error – never deleted." />
      {canWrite ? (
        <p className="text-sm">
          <Link href={`/app/clinic/patients/${patient.id}/forms#pf-outcome`} className="font-medium text-primary-strong underline underline-offset-2">
            Send a questionnaire to the patient&apos;s portal
          </Link>{" "}
          <span className="text-[#475569]">– they answer on their phone and the score appears here.</span>
        </p>
      ) : null}
      {measures.length === 0 ? <EmptyState title="No outcome measures yet">{canWrite ? "Record the first one below." : null}</EmptyState> : null}
      {measures.map((m) => {
        const def = MEASURES[m];
        const rows = outcomes.filter((o) => o.measure === m);
        const good = recorded.filter((o) => o.measure === m);
        const first = good[0];
        const last = good[good.length - 1];
        const change = first && last && good.length > 1 ? outcomeChange(m, first.scoreTenths, last.scoreTenths) : null;
        return (
          <Panel key={m} title={`${def.short} – ${def.name}`} description={def.higherIsBetter ? "Higher is better." : "Lower is better."}>
            {good.length > 0 ? <OutcomeChart measure={m} points={good.map((o) => ({ takenOn: o.takenOn, scoreTenths: o.scoreTenths }))} /> : null}
            {change ? (
              <p className="mt-2 text-sm text-foreground">
                Since {formatUkDate(first.takenOn)}:{" "}
                <span className="font-semibold">
                  {change.direction === "same" ? "no change" : `${change.direction === "better" ? "better" : "worse"} by ${formatScore(m, Math.abs(change.deltaTenths)).replace(/\/(10|100)$/, "")}`}
                </span>
                {def.unit === "percent" ? " (percentage points)" : " (points)"}.
              </p>
            ) : null}
            <div className="mt-4">
              <TableBox caption={`${def.short} scores`}>
                <thead className="bg-[#F8FAFC]">
                  <tr>
                    <th scope="col" className={TH}>
                      Date
                    </th>
                    <th scope="col" className={TH}>
                      Score
                    </th>
                    <th scope="col" className={TH}>
                      Band
                    </th>
                    <th scope="col" className={TH}>
                      Answered
                    </th>
                    {canWrite ? (
                      <th scope="col" className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((o) => (
                    <tr key={o.id} className={o.status === "entered_in_error" ? "text-muted-foreground" : undefined}>
                      <td className={`${TD} whitespace-nowrap`}>{formatUkDate(o.takenOn)}</td>
                      <td className={`${TD} whitespace-nowrap font-semibold tabular-nums ${o.status === "entered_in_error" ? "line-through" : ""}`}>{formatScore(m, o.scoreTenths)}</td>
                      <td className={TD}>{o.status === "entered_in_error" ? <Pill>Entered in error</Pill> : (o.band ?? "")}</td>
                      <td className={`${TD} tabular-nums`}>
                        {o.answered}/{def.items.length}
                        {o.recordedBy === null && !o.id.startsWith("imp") ? <span className="ml-2 text-xs text-[#475569]">from the patient&apos;s portal</span> : null}
                      </td>
                      {canWrite ? (
                        <td className={TD}>
                          {o.status === "recorded" ? (
                            <details>
                              <summary className="cursor-pointer whitespace-nowrap rounded text-xs font-medium text-primary-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Mark as error</summary>
                              <div className="mt-2 w-64">
                                <ActionForm action={markMeasureInError} className="space-y-2">
                                  <input type="hidden" name="patientId" value={patient.id} />
                                  <input type="hidden" name="outcomeId" value={o.id} />
                                  <TextField label="Reason" name="reason" required maxLength={500} />
                                  <Submit variant="danger" pendingText="Saving…">
                                    Mark as entered in error
                                  </Submit>
                                </ActionForm>
                              </div>
                            </details>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </TableBox>
            </div>
          </Panel>
        );
      })}
      {canWrite ? (
        <Panel title="Record a measure">
          <OutcomeForm
            key={outcomes.length}
            action={recordMeasure}
            patientId={patient.id}
            cases={cases.map((c) => ({ value: c.id, label: `${c.title}${c.status === "open" ? "" : " (closed)"}` }))}
            defaultCaseId={openCase?.id}
            today={ukToday()}
          />
        </Panel>
      ) : null}
    </div>
  );
}
