import Link from "next/link";
import { Activity, ChevronRight, ClipboardList, FileText } from "lucide-react";
import { SignInForm } from "@/components/pms/portal/sign-in-form";
import { PortalSignOut } from "@/components/pms/portal/portal-sign-out";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { portalHome } from "@/server/pms/portal/portal-views";
import { humanCheckSiteKey } from "@/server/pms/portal/human-check";
import { portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { portalProgrammesFor } from "@/server/pms/records/exercises-service";
import { formatUkDate } from "@/modules/pms/core/text";
import { requestLinkAction, signOutAction } from "./actions";
import { portalPayInvoiceAction, portalSaveCardAction } from "./card-actions";
import { PortalCards } from "@/components/pms/portal/portal-cards";
import { portalCardsFor } from "@/server/pms/billing/connect/portal";

export const dynamic = "force-dynamic";

const DONE: Record<string, string> = {
  cancelled: "Appointment cancelled. A confirmation is on its way.",
  late: "Appointment cancelled. The clinic will contact you about the late cancellation fee.",
  form: "Thanks – your form has been sent to the clinic.",
};

/** /clinics/<id>/portal: sign in by email link, then the patient's appointments, forms and documents (design 2g). */
export default async function PortalPage({ params, searchParams }: { params: { clinicId: string }; searchParams: { done?: string; paid?: string; card?: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  const viewer = await portalViewer(clinic);
  const paths = clinicPublicPaths(clinic.tenantId);
  if (!viewer) {
    const phone = clinic.settings.contactPhone;
    return (
      <main className="px-4 pb-16 pt-6">
        <SignInForm clinicId={clinic.tenantId} action={requestLinkAction} humanCheckSiteKey={humanCheckSiteKey()} contactLine={phone ? `Can't get into your email? Call the clinic on ${phone}.` : "Can't get into your email? Call the clinic."} />
      </main>
    );
  }
  // Card payments (the clinic's own payment account): nothing shows unless the clinic takes card payments now.
  const [home, exercises, cards] = await Promise.all([
    portalHome(publicCtx(), clinic, viewer.patientId),
    portalProgrammesFor(publicCtx(), clinic, viewer.patientId),
    portalCardsFor(publicCtx(), clinic, viewer.patientId, { paid: searchParams.paid ?? null, card: searchParams.card ?? null }),
  ]);
  const toast = cards.toast ?? (searchParams.done ? DONE[searchParams.done] : null);
  return (
    <>
      <div className="flex items-center justify-end border-b border-border bg-white px-4 py-1.5">
        <PortalSignOut clinicId={clinic.tenantId} action={signOutAction} />
      </div>
      <main className="space-y-6 px-4 pb-16 pt-5">
        <h1 className="text-[24px] font-bold text-foreground">Hello, {viewer.firstName}</h1>
        {toast ? (
          <div role="status" className="rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-[14px] text-[#166534]">
            {toast}
          </div>
        ) : null}
        {home.formsToDo.length > 0 ? (
          <section aria-labelledby="pt-forms">
            <h2 id="pt-forms" className="sr-only">
              Forms to complete
            </h2>
            <ul className="space-y-2">
              {home.formsToDo.map((f) => (
                <li key={f.id}>
                  <Link href={f.href} className="flex items-center gap-3 rounded-[12px] border border-[#FBD38D] bg-[#FFFBEB] p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    <ClipboardList className="h-[22px] w-[22px] shrink-0 text-[#864E0E]" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[15px] text-foreground">{f.kind === "outcome" ? "Questionnaire to complete" : "Form to complete"}</strong>
                      <span className="block text-[13px] text-[#334155]">
                        {f.name}
                        {f.before ? ` – before ${f.before}` : ""}
                      </span>
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] text-[#475569]" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {cards.view ? (
          <PortalCards clinicId={clinic.tenantId} {...cards.view} pay={portalPayInvoiceAction} save={portalSaveCardAction} />
        ) : null}
        <section aria-labelledby="pt-up">
          <div className="flex items-center justify-between">
            <h2 id="pt-up" className="text-[17px] font-semibold text-foreground">
              Upcoming
            </h2>
            {clinic.settings.onlineBooking ? (
              <Link href={paths.portalBook} className="-mr-2 inline-flex min-h-11 items-center rounded-[8px] px-2 text-[14px] font-medium text-primary-strong underline underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                Book an appointment
              </Link>
            ) : null}
          </div>
          {home.upcoming.length === 0 ? <p className="mt-2 text-[14px] text-[#334155]">No upcoming appointments.</p> : null}
          <ul className="mt-2 space-y-2">
            {home.upcoming.map((a) => (
              <li key={a.id}>
                <Link href={paths.portalAppointment(a.id)} className="flex items-center gap-3 rounded-[12px] border border-border bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-[8px] bg-[#F1F5F9] py-1.5">
                    <span className="text-[12px] text-[#334155]">{a.dow}</span>
                    <strong className="text-[18px] text-foreground">{a.day}</strong>
                  </span>
                  <span className="min-w-0">
                    <strong className={`block text-[15px] text-foreground ${a.status === "booked" ? "" : "line-through"}`}>
                      {a.time} · {a.service}
                    </strong>
                    <span className="block text-[13px] text-[#334155]">
                      {a.practitioner ? `with ${a.practitioner}` : ""} · {a.site}
                    </span>
                    <span className={`block text-[13px] font-medium ${a.status === "booked" ? "text-[#166534]" : "text-[#9A3412]"}`}>{a.statusWords}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        {exercises.length > 0 ? (
          <section aria-labelledby="pt-ex">
            <h2 id="pt-ex" className="text-[17px] font-semibold text-foreground">
              Your exercises
            </h2>
            <ul className="mt-2 divide-y divide-border rounded-[12px] border border-border bg-white">
              {exercises.map((x) => (
                <li key={x.id}>
                  <Link href={`${paths.portal}/exercises/${encodeURIComponent(x.id)}`} className="flex items-center gap-3 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <Activity className="h-5 w-5 shrink-0 text-[#0F766E]" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-foreground">{x.title}</span>
                      <span className="block text-[13px] text-[#334155]">
                        {x.itemCount} {x.itemCount === 1 ? "exercise" : "exercises"}
                        {x.sharedAt ? ` · given ${formatUkDate(x.sharedAt.slice(0, 10))}` : ""} · {x.checkedInToday ? "checked in today" : "check in today"}
                      </span>
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] text-[#475569]" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-labelledby="pt-docs">
          <h2 id="pt-docs" className="text-[17px] font-semibold text-foreground">
            Shared with you
          </h2>
          {home.documents.length === 0 ? <p className="mt-2 text-[14px] text-[#334155]">Nothing yet.</p> : null}
          <ul className="mt-2 divide-y divide-border rounded-[12px] border border-border bg-white">
            {home.documents.map((d) => (
              <li key={d.id}>
                <Link href={d.href} className="flex items-center gap-3 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <FileText className="h-5 w-5 shrink-0 text-[#BA1C1C]" aria-hidden="true" />
                  <span>
                    <span className="block text-[15px] text-foreground">{d.title}</span>
                    <span className="block text-[13px] text-[#334155]">{d.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
