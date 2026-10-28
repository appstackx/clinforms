"use server";
/**
 * Actions behind a "manage this booking" link (shown once after booking; only its hash is stored). The link gives
 * access to that one booking and its forms – nothing else of the patient's record. Forms completed here are
 * "unverified" (whoever holds the link): consent waits for a member of staff.
 */
import { redirect } from "next/navigation";
import type { BookResultView, SlotsAnswer } from "@/modules/pms/portal/flow-types";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import { cancelByPatient, moveByPatient, patientActor } from "@/server/pms/portal/booking";
import { slotsForWeek } from "@/server/pms/portal/booking-view";
import { directoryView } from "@/server/pms/portal/directory-view";
import { answersFromForm, submitForm } from "@/server/pms/portal/intake-service";
import { manageContext, patientForm } from "@/server/pms/portal/portal-views";
import { flowDeps, publicClinicFor } from "@/server/pms/portal/public-page";

const GONE = "This link has expired or the booking has changed. Please contact the clinic.";

async function contextFor(clinicId: string, token: string) {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic) return null;
  const deps = flowDeps();
  const m = await manageContext(deps.ctx, clinic, token, deps.now);
  return m ? { clinic, m, deps } : null;
}

export async function manageCancelAction(clinicId: string, token: string, rev: number): Promise<{ ok: false; error: string }> {
  const c = await contextFor(clinicId, token);
  if (!c) return { ok: false, error: GONE };
  const r = await cancelByPatient(c.clinic, c.m.booking.patientId, c.m.booking.appointmentId, rev, c.deps);
  if (!r.ok) return r;
  redirect(`${clinicPublicPaths(c.clinic.tenantId).manage(token)}?done=${r.late ? "late" : "cancelled"}`);
}

export async function manageSlotsAction(token: string, clinicId: string, input: { siteId: string; serviceId: string; practitionerId: string; fromDate: string }): Promise<SlotsAnswer> {
  const c = await contextFor(clinicId, token);
  if (!c) return { ok: false, error: GONE };
  return slotsForWeek(c.clinic, input, c.deps);
}

export async function manageMoveAction(token: string, rev: number, clinicId: string, input: Record<string, unknown>): Promise<BookResultView | { ok: false; error: string; slotGone?: boolean }> {
  const c = await contextFor(clinicId, token);
  if (!c) return { ok: false, error: GONE };
  const r = await moveByPatient(c.clinic, c.m.booking.patientId, c.m.booking.appointmentId, rev, { practitionerId: input.practitionerId, startsAt: input.startsAt }, c.deps);
  if (!r.ok) return r;
  const dir = await directoryView(c.deps.ctx, c.clinic.tenantId);
  const a = r.appointment;
  return { ok: true, reference: c.m.booking.reference, when: formatWhen(a.startsAt), startsAt: a.startsAt, endsAt: a.endsAt, practitioner: a.practitionerId ? dir.practitionerName(a.practitionerId) : "", site: dir.siteName(a.siteId), service: a.serviceId ? dir.serviceName(a.serviceId) : "", managePath: clinicPublicPaths(c.clinic.tenantId).manage(token), formPath: null, forms: 0 };
}

export async function manageSubmitFormAction(clinicId: string, token: string, responseId: string, rev: number, form: FormData): Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const c = await contextFor(clinicId, token);
  if (!c) return { ok: false, error: GONE };
  const r = await patientForm(c.deps.ctx, c.clinic, { patientId: c.m.booking.patientId, appointmentId: c.m.booking.appointmentId }, responseId);
  if (!r) return { ok: false, error: "This form is no longer available." };
  const result = await submitForm(c.deps.ctx, c.clinic.tenantId, r.id, rev, { answers: answersFromForm(form, r.form), signatureName: String(form.get("signature") ?? ""), trust: "unverified" }, patientActor());
  if (result.ok) return { ok: true };
  if (result.reason === "invalid") return { ok: false, error: "Please check the answers marked below.", fieldErrors: result.errors };
  return { ok: false, error: result.reason === "closed" ? "This form has already been sent." : "This form changed in the meantime. Please reload the page." };
}
