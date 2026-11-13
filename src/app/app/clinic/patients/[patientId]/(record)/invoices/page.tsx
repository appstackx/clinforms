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
import { PatientCards } from "@/components/pms/billing/patient-cards";
import { checkSavedCardFor, patientCardsFor } from "@/server/pms/billing/connect/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoices" };

/**
 * A patient's record → Invoices (billing's tab): their invoices (to them and to their insurers), what they owe,
 * Take payment (billing.pay; ?pay=1 opens it – the record's "Take payment" button), and their courses (PK02: sell,
 * sessions used, cancel) gift cards (PK04) and Sell a
 * product (PK05), saved cards and memberships (card payments – only when switched on). billing.view.
 */
export default async function PatientInvoicesPage({ params, searchParams }: { params: { patientId: string }; searchParams: { pay?: string; card?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  // Back from the payment provider's card form (?card=<saved card id>): confirm it with the provider first.
  let cardNotice: string | null = null;
  if (searchParams.card === "cancelled") cardNotice = "The card form was closed – no card was saved.";
  else if (searchParams.card) {
    const c = await checkSavedCardFor(actor, searchParams.card);
    cardNotice = c.ok ? (c.value.status === "active" ? "Card saved." : c.value.status === "pending" ? "The card is still being confirmed by the payment provider – refresh in a moment." : "The card could not be saved.") : null;
  }
  const [r, courses, cards, products, savedCards] = await Promise.all([
    patientInvoicesFor(actor, params.patientId),
    patientCoursesFor(actor, params.patientId),
    patientGiftCardsFor(actor, params.patientId),
    productsForSaleFor(actor),
    patientCardsFor(actor, params.patientId),
  ]);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return (
    <div className="flex flex-col gap-8">
      <PatientInvoices patientId={params.patientId} rows={r.value.rows} balancePence={r.value.balancePence} canPay={actor.can("billing.pay")} openPay={searchParams.pay === "1"} />
      {courses.ok ? <PatientCourses patientId={params.patientId} view={courses.value} /> : null}
      {products.ok && courses.ok && actor.can("billing.edit") && courses.value.sites.length > 0 ? <SellProduct patientId={params.patientId} products={products.value} sites={courses.value.sites} siteRequired={courses.value.siteRequired} /> : null}
      {savedCards.ok && savedCards.value ? <PatientCards patientId={params.patientId} view={savedCards.value} clinicName={actor.clinicName} notice={cardNotice} /> : null}
      {cards.ok && courses.ok ? <PatientGiftCards patientId={params.patientId} rows={cards.value.rows} canSell={cards.value.canSell} sites={courses.value.sites} siteRequired={courses.value.siteRequired} /> : null}
    </div>
  );
}
