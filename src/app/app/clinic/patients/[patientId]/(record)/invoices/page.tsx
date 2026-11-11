import type { Metadata } from "next";
import { PatientInvoices } from "@/components/pms/billing/patient-billing";
import { PatientCourses } from "@/components/pms/billing/patient-courses";
import { requireClinicActor } from "@/server/pms/actor";
import { patientCoursesFor } from "@/server/pms/billing/courses";
import { patientInvoicesFor } from "@/server/pms/billing/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoices" };

/**
 * A patient's record → Invoices (billing's tab): their invoices (to them and to their insurers), what they owe,
 * Take payment (billing.pay; ?pay=1 opens it – the record's "Take payment" button), and their courses (PK02: sell,
 * sessions used, cancel). billing.view.
 */
export default async function PatientInvoicesPage({ params, searchParams }: { params: { patientId: string }; searchParams: { pay?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const [r, courses] = await Promise.all([patientInvoicesFor(actor, params.patientId), patientCoursesFor(actor, params.patientId)]);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return (
    <div className="flex flex-col gap-8">
      <PatientInvoices patientId={params.patientId} rows={r.value.rows} balancePence={r.value.balancePence} canPay={actor.can("billing.pay")} openPay={searchParams.pay === "1"} />
      {courses.ok ? <PatientCourses patientId={params.patientId} view={courses.value} /> : null}
    </div>
  );
}
