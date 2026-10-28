"use server";
/**
 * Server actions of the patient portal. Next.js refuses cross-site server-action posts (Origin check); the portal
 * cookie is httpOnly, SameSite=Lax and limited to the clinic's path. Every write is the signed-in patient's own
 * (ids from the page are checked against the session's patient), rate-limited, and goes through the diary / comms.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import { bookFromPortal, cancelByPatient, moveByPatient } from "@/server/pms/portal/booking";
import { slotsForWeek, type SlotsAnswer } from "@/server/pms/portal/booking-view";
import { directoryView } from "@/server/pms/portal/directory-view";
import { answersFromForm, submitForm } from "@/server/pms/portal/intake-service";
import { SIGN_IN_SENT, completeSignIn, requestSignInLink, signOutPortal, PORTAL_COOKIE } from "@/server/pms/portal/portal-auth";
import { patientForm } from "@/server/pms/portal/portal-views";
import { clearPortalCookie, evenTiming, flowDeps, portalViewer, publicClinicFor, safePortalNext, setPortalCookie } from "@/server/pms/portal/public-page";
import { cookies } from "next/headers";
import type { BookResultView } from "@/modules/pms/portal/flow-types";
import { formatScore } from "@/modules/pms/records/outcomes";
import { getOutcome } from "@/server/repos/pms/records/outcomes";

const SIGNED_OUT = "Your session has ended. Please sign in again.";

export type SimpleAnswer = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** "Email me a sign-in link": the same answer, after about the same time, whoever asks. */
export async function requestLinkAction(clinicId: string, input: { email: string; website?: string }): Promise<SimpleAnswer> {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic || !clinic.settings.portal) return { ok: false, error: "The patient portal is not open at the moment. Please contact the clinic." };
  const r = await evenTiming(700, () => requestSignInLink(clinic, input, flowDeps()));
  return r.ok ? { ok: true, message: SIGN_IN_SENT } : r;
}

/** The button on the sign-in link's page: uses the link once and opens a session. */
export async function signInWithLinkAction(clinicId: string, token: string, next: string | null): Promise<SimpleAnswer> {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic || !clinic.settings.portal) return { ok: false, error: "The patient portal is not open at the moment." };
  const r = await completeSignIn(clinic, token, flowDeps());
  if (!r.ok) return r;
  setPortalCookie(clinic, r.cookieValue, r.expiresAt);
  redirect(safePortalNext(clinic, next));
}

export async function signOutAction(clinicId: string): Promise<void> {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic) return;
  await signOutPortal(flowDeps().ctx, clinic.tenantId, cookies().get(PORTAL_COOKIE)?.value);
  clearPortalCookie(clinic);
  redirect(clinicPublicPaths(clinic.tenantId).portal);
}

async function viewerFor(clinicId: string) {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic) return null;
  const viewer = await portalViewer(clinic);
  return viewer ? { clinic, viewer } : null;
}

export async function portalSlotsAction(clinicId: string, input: { siteId: string; serviceId: string; practitionerId: string; fromDate: string }): Promise<SlotsAnswer> {
  const v = await viewerFor(clinicId);
  if (!v || !v.clinic.settings.onlineBooking) return { ok: false, error: SIGNED_OUT };
  return slotsForWeek(v.clinic, { ...input, patientId: v.viewer.patientId }, flowDeps());
}

export async function portalBookAction(clinicId: string, input: Record<string, unknown>): Promise<BookResultView | { ok: false; error: string; slotGone?: boolean }> {
  const v = await viewerFor(clinicId);
  if (!v) return { ok: false, error: SIGNED_OUT };
  const deps = flowDeps();
  const r = await bookFromPortal(v.clinic, v.viewer.patientId, v.viewer.sessionId, input, deps);
  if (!r.ok) return r;
  const dir = await directoryView(deps.ctx, v.clinic.tenantId);
  revalidatePath(clinicPublicPaths(v.clinic.tenantId).portal);
  return {
    ok: true,
    reference: r.visit.reference,
    when: formatWhen(r.visit.startsAt),
    startsAt: r.visit.startsAt,
    endsAt: r.visit.endsAt,
    practitioner: dir.practitionerName(r.visit.practitionerId),
    site: dir.siteName(r.visit.siteId),
    service: dir.serviceName(r.visit.serviceId),
    managePath: null,
    formPath: r.visit.formIds[0] ? clinicPublicPaths(v.clinic.tenantId).portalForm(r.visit.formIds[0]) : null,
    forms: r.visit.formIds.length,
  };
}

/** Moving one of the patient's appointments (the booking flow in move mode). */
export async function portalMoveAction(appointmentId: string, rev: number, clinicId: string, input: Record<string, unknown>): Promise<BookResultView | { ok: false; error: string; slotGone?: boolean }> {
  const v = await viewerFor(clinicId);
  if (!v) return { ok: false, error: SIGNED_OUT };
  const deps = flowDeps();
  const r = await moveByPatient(v.clinic, v.viewer.patientId, appointmentId, rev, { practitionerId: input.practitionerId, startsAt: input.startsAt }, { ...deps, sessionId: v.viewer.sessionId });
  if (!r.ok) return r;
  const dir = await directoryView(deps.ctx, v.clinic.tenantId);
  revalidatePath(clinicPublicPaths(v.clinic.tenantId).portal);
  const a = r.appointment;
  return { ok: true, reference: "", when: formatWhen(a.startsAt), startsAt: a.startsAt, endsAt: a.endsAt, practitioner: a.practitionerId ? dir.practitionerName(a.practitionerId) : "", site: dir.siteName(a.siteId), service: a.serviceId ? dir.serviceName(a.serviceId) : "", managePath: null, formPath: null, forms: 0 };
}

export async function portalCancelAction(clinicId: string, appointmentId: string, rev: number): Promise<SimpleAnswer> {
  const v = await viewerFor(clinicId);
  if (!v) return { ok: false, error: SIGNED_OUT };
  const r = await cancelByPatient(v.clinic, v.viewer.patientId, appointmentId, rev, { ...flowDeps(), sessionId: v.viewer.sessionId });
  if (!r.ok) return r;
  const paths = clinicPublicPaths(v.clinic.tenantId);
  revalidatePath(paths.portal);
  redirect(`${paths.portal}?done=${r.late ? "late" : "cancelled"}`);
}

/** Completing a form or questionnaire in the portal ("verified": the link went to the address on the record). */
export async function portalSubmitFormAction(clinicId: string, responseId: string, rev: number, form: FormData): Promise<SimpleAnswer & { score?: string | null }> {
  const v = await viewerFor(clinicId);
  if (!v) return { ok: false, error: SIGNED_OUT };
  const deps = flowDeps();
  const r = await patientForm(deps.ctx, v.clinic, { patientId: v.viewer.patientId }, responseId);
  if (!r) return { ok: false, error: "This form is no longer available." };
  const result = await submitForm(deps.ctx, v.clinic.tenantId, r.id, rev, { answers: answersFromForm(form, r.form), signatureName: String(form.get("signature") ?? ""), trust: "verified" }, v.viewer.actor);
  if (!result.ok) {
    if (result.reason === "invalid") return { ok: false, error: "Please check the answers marked below.", fieldErrors: result.errors };
    return { ok: false, error: result.reason === "closed" ? "This form has already been sent." : "This form changed in the meantime. Please reload the page." };
  }
  // No revalidatePath here: it would re-render this page as the sealed copy before the patient sees "Signed and
  // sent". The portal's pages are dynamic; the "done" link reloads the home page in full.
  let score: string | null = null;
  if (result.outcomeId) {
    const o = await getOutcome(deps.ctx, v.clinic.tenantId, result.outcomeId);
    if (o) score = formatScore(o.measure, o.scoreTenths);
  }
  return { ok: true, message: "Thanks – your answers have been sent to the clinic.", score };
}
