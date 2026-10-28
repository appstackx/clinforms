import type { Metadata } from "next";
import { Card as Panel } from "@/components/pms/records/ui";
import { ActionForm, Submit } from "@/components/pms/records/form";
import { DetailList, LinkButton, Pill, TextLinkTo } from "@/components/pms/records/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { retentionReviewFrom } from "@/modules/pms/core/retention";
import { activityTime } from "@/server/admin/activity";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { listCasesForPatient } from "@/server/repos/pms/cases";
import { getAnonymisation, patientLastTreatment } from "@/server/repos/pms/records/anonymise";
import { getPmsSettings } from "@/server/repos/pms/settings";
import { addClinicalFlag, changeLegalHold, changePatientStatus, endClinicalFlag } from "../../actions";
import { ClinicalFlagsEditor } from "@/components/pms/records/clinical-flags-editor";
import { clinicalFlagsFor, patientExtrasFor } from "@/server/pms/records/flags-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Patient details", robots: { index: false, follow: false } };

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const SOURCE: Record<string, string> = { verbal: "verbally", written: "in writing", online: "online", import: "in the earlier system" };

function lines(address: string[] | null, postcode: string | null): React.ReactNode {
  const all = [...(address ?? []), postcode].filter(Boolean);
  return all.length ? <span className="whitespace-pre-line">{all.join("\n")}</span> : null;
}

/** /patients/[id]/details – who the patient is, how to reach them, their GP, consents – and managing the record (archive, hold, subject-access copy, anonymise). Reached from the record header's "More actions" menu. */
export default async function PatientDetailsPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const [cases, settings, anonymisation, lastTreatment, flags, extras] = await Promise.all([
    listCasesForPatient(ctx, actor.tenantId, patient.id),
    getPmsSettings(ctx, actor.tenantId),
    getAnonymisation(ctx, actor.tenantId, patient.id),
    patientLastTreatment(ctx, actor.tenantId, patient.id, patient.lastSeenOn),
    actor.can("clinical.view") ? clinicalFlagsFor(actor, patient.id) : Promise.resolve(null),
    patientExtrasFor(actor, patient.id),
  ]);
  const anonymised = anonymisation?.status === "done";
  const retention = retentionReviewFrom(
    { dateOfBirth: patient.dateOfBirth, lastTreatmentOn: lastTreatment, legalHold: patient.legalHold },
    { adultYears: settings.retentionAdultYears, childUntilAge: settings.retentionChildUntilAge },
  );
  const openCases = cases.filter((c) => c.status === "open");
  const canEdit = actor.can("patients.edit") && !anonymised;
  const canManage = actor.can("settings.manage");
  const marketing = [patient.marketingEmail ? "email" : null, patient.marketingSms ? "text" : null].filter(Boolean).join(" and ");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        {anonymised ? (
          <div role="status" className="rounded-lg border border-[#C7D4F5] bg-[#EFF4FF] px-3.5 py-2.5 text-sm text-foreground">
            This record was anonymised on {activityTime(anonymisation?.doneAt ?? "")}. The dates and scores stay for the clinic&apos;s figures; who the patient was and what was written are gone.
          </div>
        ) : null}
        {flags && flags.ok ? (
          <Panel title="Clinical flags" id="clinical-flags">
            <ClinicalFlagsEditor
              patientId={patient.id}
              flags={flags.value.map((f) => ({ id: f.id, rev: f.rev, text: f.text ?? "", since: formatUkDate(f.createdAt.slice(0, 10)) }))}
              canEdit={actor.can("clinical.edit") && !anonymised}
              addAction={addClinicalFlag}
              endAction={endClinicalFlag}
            />
          </Panel>
        ) : null}
        <Panel title="Contact details">
          <DetailList
            items={[
              { label: "Pronouns", value: extras.ok ? extras.value.pronouns : null },
              { label: "Mobile", value: patient.phoneMobile },
              { label: "Home phone", value: patient.phoneHome },
              { label: "Work phone", value: patient.phoneWork },
              { label: "Email", value: patient.email },
              { label: "Address", value: lines(patient.address, patient.postcode) },
              { label: "Occupation", value: patient.occupation },
              { label: "Employer", value: patient.employer },
            ]}
          />
        </Panel>
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Emergency contact">
            <DetailList
              className="sm:grid-cols-1"
              items={[
                { label: "Name", value: patient.emergencyName },
                { label: "Phone", value: patient.emergencyPhone },
                { label: "Relationship", value: patient.emergencyRelationship },
              ]}
            />
          </Panel>
          <Panel title="GP">
            <DetailList
              className="sm:grid-cols-1"
              items={[
                { label: "GP", value: patient.gpName },
                { label: "Surgery", value: patient.gpPractice },
                { label: "Phone", value: patient.gpPhone },
                { label: "Address", value: lines(patient.gpAddress, patient.gpPostcode) },
              ]}
            />
          </Panel>
        </div>
        <Panel title="Consent and contact preferences">
          <DetailList
            items={[
              { label: "Assessment and treatment", value: patient.consentTreatment ? `Consent recorded ${patient.consentTreatmentAt ? activityTime(patient.consentTreatmentAt) : ""}` : "Not recorded yet" },
              { label: "May write to the GP", value: yesNo(patient.consentShareGp) },
              { label: "Appointment reminders", value: [patient.reminderSms ? "Text" : null, patient.reminderEmail ? "Email" : null].filter(Boolean).join(" and ") || "None" },
              { label: "Marketing", value: marketing ? `By ${marketing}, agreed ${SOURCE[patient.marketingConsentSource ?? ""] ?? ""}${patient.marketingConsentAt ? ` on ${activityTime(patient.marketingConsentAt)}` : ""}` : "Not agreed" },
            ]}
          />
        </Panel>
        {patient.notes ? (
          <Panel title="Administrative notes">
            <p className="whitespace-pre-line text-sm text-foreground">{patient.notes}</p>
          </Panel>
        ) : null}
      </div>

      <aside className="space-y-6" aria-label="Managing this record">
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href={patientPath(patient.id, "edit")}>Edit details</LinkButton>
          </div>
        ) : null}
        <Panel title="Cases">
          <p className="text-sm text-[#334155]">
            {openCases.length === 0 ? "No open case." : `${openCases.length} open case${openCases.length === 1 ? "" : "s"}`}
            {cases.length > openCases.length ? `, ${cases.length - openCases.length} closed` : ""}.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {openCases.slice(0, 3).map((c) => (
              <li key={c.id}>
                <TextLinkTo href={patientPath(patient.id, `cases/${c.id}`)}>{c.title}</TextLinkTo>
                <span className="text-muted-foreground"> · since {formatUkDate(c.openedOn)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <TextLinkTo href={patientPath(patient.id, "cases")}>All cases and authorisations</TextLinkTo>
          </p>
        </Panel>
        <Panel title="Record-keeping">
          <p className="text-sm text-[#334155]">
            {patient.legalHold
              ? "On hold: kept as it is whatever the record-keeping rules say."
              : retention.kind === "review_from"
                ? `Kept at least until ${formatUkDate(retention.date)} (${retention.rule === "child" ? "rules for children" : retention.rule === "deceased" ? "after death" : `${settings.retentionAdultYears} years after the last treatment`}).`
                : "No review date yet: the rules need a date of birth and a treatment date. Nothing is ever deleted automatically."}
          </p>
          {lastTreatment ? <p className="mt-1 text-xs text-muted-foreground">Last treatment on record: {formatUkDate(lastTreatment)}.</p> : null}
          <div className="mt-4 space-y-3">
            {canEdit ? (
              <ActionForm action={changePatientStatus} className="space-y-2">
                <input type="hidden" name="patientId" value={patient.id} />
                {patient.status === "active" ? (
                  <div className="flex flex-wrap gap-2">
                    <Submit variant="secondary" name="status" value="archived" pendingText="Archiving…" confirmText="Archive this record? It is kept and can be restored.">
                      Archive record
                    </Submit>
                    <Submit variant="secondary" name="status" value="deceased" pendingText="Saving…" confirmText="Record that this patient has died?">
                      Record death
                    </Submit>
                  </div>
                ) : (
                  <Submit variant="secondary" name="status" value="active" pendingText="Restoring…">
                    Make active again
                  </Submit>
                )}
              </ActionForm>
            ) : null}
            {canManage ? (
              <ActionForm action={changeLegalHold}>
                <input type="hidden" name="patientId" value={patient.id} />
                <input type="hidden" name="hold" value={patient.legalHold ? "off" : "on"} />
                <Submit variant="secondary" pendingText="Saving…" confirmText={patient.legalHold ? "Take the hold off this record?" : "Put this record on hold (for a complaint, claim or investigation)?"}>
                  {patient.legalHold ? "Take hold off" : "Put on hold"}
                </Submit>
              </ActionForm>
            ) : null}
          </div>
        </Panel>
        {actor.can("patients.export") || canManage ? (
          <Panel title="Data rights">
            {actor.can("patients.export") ? (
              <>
                <p className="text-sm text-[#334155]">A copy of everything held about the patient, for a subject access request.</p>
                <ul className="mt-2 space-y-1 text-sm">
                  <li>
                    <a href={patientPath(patient.id, "export?format=pdf")} className="rounded font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      Download a copy (PDF)
                    </a>
                  </li>
                  <li>
                    <a href={patientPath(patient.id, "export?format=json")} className="rounded font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      Download the data (JSON)
                    </a>
                  </li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Each download is recorded in the patient&apos;s history.</p>
              </>
            ) : null}
            {canManage && !anonymised ? (
              <p className="mt-3 text-sm">
                <TextLinkTo href={patientPath(patient.id, "anonymise")}>Anonymise this record…</TextLinkTo>
              </p>
            ) : null}
            {anonymised ? <Pill tone="blue" className="mt-3">Anonymised</Pill> : null}
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}
