"use server";
/**
 * Server actions of the public booking page (no sign-in). Next.js checks every server action's Origin against the
 * host (cross-site posts are refused); the flows rate-limit per client, email and clinic, never say whether a patient
 * exists, and book through the diary (src/server/pms/portal/booking.ts).
 */
import type { BookResultView } from "@/modules/pms/portal/flow-types";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import { bookFromPublicPage } from "@/server/pms/portal/booking";
import { slotsForWeek, type SlotsAnswer } from "@/server/pms/portal/booking-view";
import { directoryView } from "@/server/pms/portal/directory-view";
import { flowDeps, publicClinicFor } from "@/server/pms/portal/public-page";

const CLOSED = "Online booking is closed at the moment. Please contact the clinic.";

export async function loadSlotsAction(clinicId: string, input: { siteId: string; serviceId: string; practitionerId: string; fromDate: string }): Promise<SlotsAnswer> {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic || !clinic.settings.onlineBooking) return { ok: false, error: CLOSED };
  return slotsForWeek(clinic, input, flowDeps());
}

export type BookAnswer = BookResultView | { ok: false; error: string; fieldErrors?: Record<string, string>; slotGone?: boolean };

export async function bookAction(clinicId: string, input: Record<string, unknown>): Promise<BookAnswer> {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic || !clinic.settings.onlineBooking) return { ok: false, error: CLOSED };
  const deps = flowDeps();
  const r = await bookFromPublicPage(clinic, input, deps);
  if (!r.ok) return r;
  const dir = await directoryView(deps.ctx, clinic.tenantId);
  const token = decodeURIComponent(r.managePath.split("/").pop() ?? "");
  const paths = clinicPublicPaths(clinic.tenantId);
  return {
    ok: true,
    reference: r.visit.reference,
    when: formatWhen(r.visit.startsAt),
    startsAt: r.visit.startsAt,
    endsAt: r.visit.endsAt,
    practitioner: dir.practitionerName(r.visit.practitionerId),
    site: dir.siteName(r.visit.siteId),
    service: dir.serviceName(r.visit.serviceId),
    managePath: r.managePath,
    formPath: r.visit.formIds[0] ? paths.manageForm(token, r.visit.formIds[0]) : null,
    forms: r.visit.formIds.length,
  };
}
