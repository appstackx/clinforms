import type { Metadata } from "next";
import { PatientList } from "@/components/pms/records/patient-list";
import { filtersFromParams } from "@/modules/pms/records/patient-list";
import { ukToday } from "@/modules/pms/core/text";
import { requireClinicActor } from "@/server/pms/actor";
import { patientListFor } from "@/server/pms/records/patient-list-service";
import { registerPatient } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Patients" };

/**
 * /app/clinic/patients – the patient list (design round 2, docs/clinic-system/design/round2/patients/). Search and
 * filters are in the URL (?q, status, practitioner, payer, site, nofuture, seen, sort, page); the shell's "/" search lands
 * here with ?q=. patients.view; New patient needs patients.edit, Export CSV reports.export.
 */
export default async function PatientsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const filters = filtersFromParams(searchParams);
  const result = await patientListFor(actor, filters);
  const view = result.ok ? result.value : null;
  return (
    <PatientList
      rows={(view?.rows ?? []).map((r) => ({
        id: r.id,
        patientNumber: r.patientNumber,
        firstName: r.firstName,
        lastName: r.lastName,
        preferredName: r.preferredName,
        dateOfBirth: r.dateOfBirth,
        age: r.age,
        phoneMobile: r.phoneMobile,
        status: r.status,
        hasAlerts: r.hasAlerts,
        next: r.next ? { startsAt: r.next.startsAt, practitionerName: r.next.practitionerName } : null,
        openCase: r.openCase ? { title: r.openCase.title, payerName: r.openCase.payerName } : null,
        balancePence: r.balancePence,
      }))}
      total={view?.total ?? 0}
      page={view?.page ?? filters.page}
      pageSize={view?.pageSize ?? 25}
      today={view?.today ?? ukToday()}
      filters={filters}
      practitioners={view?.practitioners ?? []}
      myPractitionerId={view?.myPractitionerId ?? null}
      sites={view?.sites ?? []}
      canCreate={actor.can("patients.edit")}
      canExport={actor.can("reports.export")}
      canSeeUnsigned={actor.can("clinical.view")}
      canSeeBalance={actor.can("billing.view")}
      failed={!result.ok}
      registerAction={registerPatient}
    />
  );
}
