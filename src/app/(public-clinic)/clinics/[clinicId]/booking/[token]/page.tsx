import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { AppointmentPanel } from "@/components/pms/portal/appointment-panel";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { panelData } from "@/server/pms/portal/appointment-panel-data";
import { manageContext } from "@/server/pms/portal/portal-views";
import { publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { manageCancelAction } from "./actions";

export const dynamic = "force-dynamic";

const DONE: Record<string, string> = {
  cancelled: "Appointment cancelled. A confirmation is on its way.",
  late: "Appointment cancelled. The clinic will contact you about the late cancellation fee.",
};

/** /clinics/<id>/booking/<secret>: "Your booking" (design 2g step "manage") – change time, cancel, forms. */
export default async function ManageBookingPage({ params, searchParams }: { params: { clinicId: string; token: string }; searchParams: { done?: string } }) {
  const clinic = await publicClinicOr404(params.clinicId);
  const m = await manageContext(publicCtx(), clinic, params.token);
  if (!m) notFound();
  const paths = clinicPublicPaths(clinic.tenantId);
  const data = panelData(clinic, m.appointment);
  const toast = searchParams.done ? DONE[searchParams.done] : null;
  return (
    <main className="space-y-5 px-4 pb-16 pt-5">
      <p className="text-[13px] font-medium uppercase tracking-wide text-[#475569]">Your booking</p>
      {toast ? (
        <div role="status" className="rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-[14px] text-[#166534]">
          {toast}
        </div>
      ) : null}
      <AppointmentPanel data={data} moveHref={clinic.settings.onlineBooking ? `${paths.manage(m.token)}/move` : null} cancel={manageCancelAction.bind(null, clinic.tenantId, m.token, m.appointment.rev)} />
      {m.forms.length > 0 ? (
        <section aria-labelledby="mg-forms" className="space-y-2">
          <h2 id="mg-forms" className="text-[17px] font-semibold text-foreground">
            Before your visit
          </h2>
          <ul className="space-y-2">
            {m.forms.map((f) => (
              <li key={f.id}>
                <Link href={f.href} className="flex items-center gap-3 rounded-[12px] border border-border bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <ClipboardList className="h-5 w-5 shrink-0 text-[#864E0E]" aria-hidden="true" />
                  <span className="flex-1 text-[15px] text-foreground">{f.name}</span>
                  <span className={`text-[13px] font-medium ${f.status === "submitted" ? "text-[#166534]" : "text-[#864E0E]"}`}>{f.status === "submitted" ? "Sent" : "To do"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {clinic.settings.portal ? (
        <p className="text-[14px] text-[#334155]">
          See all your appointments in the{" "}
          <Link href={paths.portal} className="font-medium text-primary-strong underline underline-offset-[3px]">
            patient portal
          </Link>
          .
        </p>
      ) : null}
    </main>
  );
}
