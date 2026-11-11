import type { Metadata } from "next";
import { PatientInvoices } from "@/components/pms/billing/patient-billing";
import { PatientCourses } from "@/components/pms/billing/patient-courses";
import { PatientGiftCards } from "@/components/pms/billing/gift-cards";
import { patientGiftCardsFor } from "@/server/pms/billing/gift-cards";
import { SellProduct } from "@/components/pms/billing/products";
import { productsForSaleFor } from "@/server/pms/billing/products";
import { requireClinicActor } from "@/server/pms/actor";
import { patientCoursesFor } from "@/server/pms/billing/courses";
import { patientInvoicesFor } from "@/server/pms/billing/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoices" };

/**
 * A patient's record → Invoices (billing's tab): their invoices (to them and to their insurers), what they owe,
 * Take payment (billing.pay; ?pay=1 opens it – the record's "Take payment" button), and their courses (PK02: sell,
 * sessions used, cancel) gift cards (PK04) and Sell a
 * product (PK05). billing.view.
 */
export default async function PatientInvoicesPage({ params, searchParams }: { params: { patientId: string }; searchParams: { pay?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const [r, courses, cards, products] = await Promise.all([
    patientInvoicesFor(actor, params.patientId),
    patientCoursesFor(actor, params.patientId),
    patientGiftCardsFor(actor, params.patientId),
    productsForSaleFor(actor),
  ]);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return (
    <div className="flex flex-col gap-8">
      <PatientInvoices patientId={params.patientId} rows={r.value.rows} balancePence={r.value.balancePence} canPay={actor.can("billing.pay")} openPay={searchParams.pay === "1"} />
      {courses.ok ? <PatientCourses patientId={params.patientId} view={courses.value} /> : null}
      {products.ok && courses.ok && actor.can("billing.edit") && courses.value.sites.length > 0 ? <SellProduct patientId={params.patientId} products={products.value} sites={courses.value.sites} siteRequired={courses.value.siteRequired} /> : null}
      {cards.ok && courses.ok ? <PatientGiftCards patientId={params.patientId} rows={cards.value.rows} canSell={cards.value.canSell} sites={courses.value.sites} siteRequired={courses.value.siteRequired} /> : null}
    </div>
  );
}
