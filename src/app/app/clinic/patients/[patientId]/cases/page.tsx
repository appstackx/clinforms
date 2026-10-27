import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LinkButton, Pill, SectionHeader } from "@/components/pms/records/ui";
import { authorisationView } from "@/modules/pms/core/authorisations";
import { formatPence, formatUkDate, ukToday } from "@/modules/pms/core/text";
import { AUTHORISATION_STATE_LABELS, CASE_STATUS_LABELS, PAYER_TYPE_LABELS, authorisationRemaining, authorisationWarnings } from "@/modules/pms/records/copy";
import { requireClinicActor } from "@/server/pms/actor";
import { directoryOptions } from "@/server/pms/records/directory-options";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { listAuthorisations, listCasesForPatient } from "@/server/repos/pms/cases";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cases" };

/** A patient's cases (episodes of care): who pays, and the treatment authorisations with what is left. */
export default async function PatientCasesPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const [cases, auths, directory] = await Promise.all([listCasesForPatient(ctx, actor.tenantId, patient.id), listAuthorisations(ctx, actor.tenantId, { patientId: patient.id }), directoryOptions(actor)]);
  const today = ukToday();
  const newCase = actor.can("patients.edit") ? <LinkButton href={patientPath(patient.id, "cases/new")}>Open a case</LinkButton> : null;
  return (
    <>
      <SectionHeader title="Cases" description="Each case is one episode of care with its own payer, referral and authorisations." actions={newCase} />
      {cases.length === 0 ? (
        <EmptyState title="No cases yet" action={newCase}>
          Open a case when the patient starts a course of treatment.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {cases.map((c) => {
            const caseAuths = auths.filter((a) => a.caseId === c.id);
            return (
              <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">
                      <Link href={patientPath(patient.id, `cases/${c.id}`)} className="rounded text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                        {c.title}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-700">
                      {formatUkDate(c.openedOn)}
                      {c.closedOn ? ` – ${formatUkDate(c.closedOn)}` : " – now"}
                      {c.practitionerId && directory.names.practitioners[c.practitionerId] ? ` · ${directory.names.practitioners[c.practitionerId]}` : ""}
                      {c.siteId && directory.names.sites[c.siteId] ? ` · ${directory.names.sites[c.siteId]}` : ""}
                    </p>
                  </div>
                  <Pill tone={c.status === "open" ? "teal" : "neutral"}>{CASE_STATUS_LABELS[c.status]}</Pill>
                </div>
                <p className="mt-2 text-sm text-slate-900">
                  <span className="font-medium">{PAYER_TYPE_LABELS[c.payerType]}</span>
                  {c.payerReferrerId && directory.names.referrers[c.payerReferrerId] ? `: ${directory.names.referrers[c.payerReferrerId]}` : ""}
                </p>
                {caseAuths.length > 0 ? (
                  <ul className="mt-3 space-y-2" aria-label={`Authorisations for ${c.title}`}>
                    {caseAuths.map((a) => {
                      const view = authorisationView(a, today);
                      const warnings = authorisationWarnings(view);
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="font-mono text-xs text-slate-800">{a.code}</span>
                          <Pill tone={view.state === "active" ? (warnings.length ? "amber" : "teal") : "neutral"}>{AUTHORISATION_STATE_LABELS[view.state]}</Pill>
                          <span className="text-slate-800">{authorisationRemaining(view, a, formatPence).join(" · ")}</span>
                          {a.expiresOn ? <span className="text-slate-600">expires {formatUkDate(a.expiresOn)}</span> : null}
                          {warnings.map((w) => (
                            <Pill key={w} tone="amber">
                              {w}
                            </Pill>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                ) : c.payerType !== "self_pay" ? (
                  <p className="mt-2 text-sm text-slate-600">No authorisation recorded.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
