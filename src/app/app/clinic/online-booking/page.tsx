import { OnlineBookingSetup } from "@/components/pms/portal/online-booking-setup";
import { formatWhen } from "@/modules/pms/portal/time";
import { requireClinicActor } from "@/server/pms/actor";
import { directoryView } from "@/server/pms/portal/directory-view";
import { onlineBookingSetupFor, recentOnlineBookingsFor } from "@/server/pms/portal/staff";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Online booking" }, "settings.setup");

/**
 * /app/clinic/online-booking – Set-up → Online booking (settings.setup): the booking page and patient portal on or off,
 * the booking rules (notice, how far ahead, slot step, free changes until …), which sites, types and practitioners are
 * offered, each site's map position, the public links, and the latest online bookings to check.
 */
export default async function OnlineBookingPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const [setup, recent] = await Promise.all([onlineBookingSetupFor(actor), recentOnlineBookingsFor(actor)]);
  if (!setup.ok) return null;
  const dir = await directoryView(actor.repo(), actor.tenantId);
  const rows = recent.ok
    ? recent.value.map((r) => ({
        appointmentId: r.booking.appointmentId,
        patientId: r.patientId,
        patientName: r.patientName,
        reference: r.booking.reference,
        when: formatWhen(r.startsAt),
        madeAt: formatWhen(r.booking.createdAt),
        where: dir.siteName(r.siteId),
        withWhom: r.practitionerId ? dir.practitionerName(r.practitionerId) : "",
        what: r.serviceId ? dir.serviceName(r.serviceId) : "",
        status: r.status,
        newPatient: r.booking.patientMatch === "new",
        channel: r.booking.channel,
        reviewed: Boolean(r.booking.reviewedAt),
      }))
    : [];
  return <OnlineBookingSetup setup={setup.value} recent={rows} canReview={actor.can("diary.book")} />;
}
