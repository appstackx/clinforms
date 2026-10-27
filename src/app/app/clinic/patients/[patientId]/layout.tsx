import { RecordTabs, type RecordTabLink } from "@/components/pms/records/record-tabs";
import { Pill, TextLinkTo } from "@/components/pms/records/ui";
import { visibleRecordTabs } from "@/modules/pms/core/record-tabs";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { ageOn, displayName } from "@/modules/pms/records/form-values";
import { PMS_RECORD_TABS } from "@/modules/pms/record-tabs";
import { requireClinicActor } from "@/server/pms/actor";
import { PATIENTS_PATH, patientOr404, patientPath } from "@/server/pms/records/record";
import { getAnonymisation } from "@/server/repos/pms/records/anonymise";

export const dynamic = "force-dynamic";

const SEX_LABELS: Record<string, string> = { female: "Female", male: "Male", other: "Other", unknown: "Sex not known" };

/**
 * A patient's record: the header every tab shares (name, number, date of birth, alerts, hold) and the tabs every
 * module declares (src/modules/pms/record-tabs), shown by the member's role. Each tab's page checks for itself.
 */
export default async function PatientRecordLayout({ children, params }: { children: React.ReactNode; params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const anonymised = (await getAnonymisation(actor.repo(), actor.tenantId, patient.id))?.status === "done";
  const today = ukToday();
  const age = ageOn(patient.dateOfBirth, today);
  const tabs: RecordTabLink[] = visibleRecordTabs(PMS_RECORD_TABS, actor.can).map((t) => ({ href: patientPath(patient.id, t.segment), label: t.label, exact: t.segment === "" }));
  const facts = [
    `No. ${patient.patientNumber}`,
    patient.dateOfBirth ? `Born ${formatUkDate(patient.dateOfBirth)}${age !== null ? ` (${age})` : ""}` : null,
    patient.sex ? SEX_LABELS[patient.sex] : null,
    patient.phoneMobile,
  ].filter(Boolean);
  return (
    <>
      <p className="mb-2 text-sm">
        <TextLinkTo href={PATIENTS_PATH}>← Patients</TextLinkTo>
      </p>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{displayName(patient)}</h1>
          {patient.status === "archived" ? <Pill>Archived</Pill> : null}
          {patient.status === "deceased" ? <Pill>Deceased</Pill> : null}
          {patient.legalHold ? <Pill tone="amber">On hold – keep as it is</Pill> : null}
          {anonymised ? <Pill tone="blue">Anonymised</Pill> : null}
        </div>
        <p className="mt-1 text-sm text-slate-700">{facts.join(" · ")}</p>
        {patient.alerts ? (
          <div className="mt-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900" role="note" aria-label="Medical alerts">
            <span className="font-semibold">Medical alerts: </span>
            <span className="whitespace-pre-line">{patient.alerts}</span>
          </div>
        ) : null}
      </header>
      <RecordTabs tabs={tabs} />
      <div className="pt-6">{children}</div>
    </>
  );
}
