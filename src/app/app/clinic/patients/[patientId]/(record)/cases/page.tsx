import Link from "next/link";
import { EmptyState, LinkButton, Pill, SectionHeader } from "@/components/pms/records/ui";
import { authorisationView } from "@/modules/pms/core/authorisations";
import { formatPence, formatUkDate, ukToday } from "@/modules/pms/core/text";
import { AUTHORISATION_STATE_LABELS, CASE_STATUS_LABELS, PAYER_TYPE_LABELS, authorisationRemaining, authorisationWarnings } from "@/modules/pms/records/copy";
import { requireClinicActor } from "@/server/pms/actor";
import { caseReferralsFor } from "@/server/pms/records/cases-service";
import { directoryOptions } from "@/server/pms/records/directory-options";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { listAuthorisations, listCasesForPatient } from "@/server/repos/pms/cases";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Cases" }, "patients.view");

/** A patient's cases (episodes of care): who pays, and the treatment authorisations with what is left. */
export default async function PatientCasesPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const [cases, auths, directory, referrals] = await Promise.all([
    listCasesForPatient(ctx, actor.tenantId, patient.id),
    listAuthorisations(ctx, actor.tenantId, { patientId: patient.id }),
    directoryOptions(actor),
    // Referral reason and case notes: only with "See referral reason and case notes" (reception too, by default).
    actor.can("patients.referral") ? caseReferralsFor(actor, patient.id) : Promise.resolve(null),
  ]);
  const referralOf = new Map(referrals && referrals.ok ? referrals.value.map((r) => [r.caseId, r]) : []);
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
            const referral = referralOf.get(c.id);
            return (
              <li key={c.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">
                      <Link href={patientPath(patient.id, `cases/${c.id}`)} className="rounded text-primary-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        {c.title}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-sm text-[#334155]">
                      {formatUkDate(c.openedOn)}
                      {c.closedOn ? ` – ${formatUkDate(c.closedOn)}` : " – now"}
                      {c.practitionerId && directory.names.practitioners[c.practitionerId] ? ` · ${directory.names.practitioners[c.practitionerId]}` : ""}
                      {c.siteId && directory.names.sites[c.siteId] ? ` · ${directory.names.sites[c.siteId]}` : ""}
                    </p>
                  </div>
                  <Pill tone={c.status === "open" ? "teal" : "neutral"}>{CASE_STATUS_LABELS[c.status]}</Pill>
                </div>
                <p className="mt-2 text-sm text-foreground">
                  <span className="font-medium">{PAYER_TYPE_LABELS[c.payerType]}</span>
                  {c.payerReferrerId && directory.names.referrers[c.payerReferrerId] ? `: ${directory.names.referrers[c.payerReferrerId]}` : ""}
                </p>
                {referral?.referralReason ? (
                  <div className="mt-2 text-sm" data-testid="case-referral-reason">
                    <span className="font-medium">Reason for referral: </span>
                    <span className="whitespace-pre-line text-[#334155]">{referral.referralReason}</span>
                  </div>
                ) : null}
                {referral?.notes ? (
                  <div className="mt-1 text-sm">
                    <span className="font-medium">Case notes: </span>
                    <span className="whitespace-pre-line text-[#334155]">{referral.notes}</span>
                  </div>
                ) : null}
                {caseAuths.length > 0 ? (
                  <ul className="mt-3 space-y-2" aria-label={`Authorisations for ${c.title}`}>
                    {caseAuths.map((a) => {
                      const view = authorisationView(a, today);
                      const warnings = authorisationWarnings(view);
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[#F8FAFC] px-3 py-2 text-sm">
                          <span className="font-mono text-xs text-foreground">{a.code}</span>
                          <Pill tone={view.state === "active" ? (warnings.length ? "amber" : "teal") : "neutral"}>{AUTHORISATION_STATE_LABELS[view.state]}</Pill>
                          <span className="text-foreground">{authorisationRemaining(view, a, formatPence).join(" · ")}</span>
                          {a.expiresOn ? <span className="text-muted-foreground">expires {formatUkDate(a.expiresOn)}</span> : null}
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
                  <p className="mt-2 text-sm text-muted-foreground">No authorisation recorded.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
