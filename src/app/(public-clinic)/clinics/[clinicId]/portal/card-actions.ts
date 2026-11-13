"use server";
/**
 * The patient portal's card payments (l04 + cp04, the clinic's own payment account): "Pay now" for one of the
 * signed-in patient's own invoices, and "Save a card" with the patient's consent recorded first. Both answer the
 * payment provider's hosted page – the card is typed there, never here. The invoice and the patient come from the
 * portal session (ids from the page are checked against it). Off unless the clinic takes card payments now.
 */
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { patientActor } from "@/server/pms/portal/booking";
import { flowDeps, portalViewer, publicClinicFor } from "@/server/pms/portal/public-page";
import { cardDeps, startPortalPayment, startSaveCard } from "@/server/pms/billing/connect/service";

type Answer = { ok: true; url: string } | { ok: false; error: string };
const SIGNED_OUT = "Your session has ended. Please sign in again.";

async function viewerFor(clinicId: string) {
  const clinic = await publicClinicFor(clinicId);
  if (!clinic) return null;
  const viewer = await portalViewer(clinic);
  return viewer ? { clinic, viewer } : null;
}

export async function portalPayInvoiceAction(clinicId: string, invoiceId: string): Promise<Answer> {
  const v = await viewerFor(String(clinicId ?? ""));
  if (!v) return { ok: false, error: SIGNED_OUT };
  const deps = flowDeps();
  const home = `${deps.origin}${clinicPublicPaths(v.clinic.tenantId).portal}`;
  const r = await startPortalPayment(deps.ctx, v.clinic.tenantId, { patientId: v.viewer.patientId, invoiceId: String(invoiceId ?? "").slice(0, 60), successUrl: home, cancelUrl: home }, patientActor(v.viewer.sessionId));
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}

export async function portalSaveCardAction(clinicId: string, input: { agreed: boolean; allowsNoShow: boolean }): Promise<Answer> {
  const v = await viewerFor(String(clinicId ?? ""));
  if (!v) return { ok: false, error: SIGNED_OUT };
  if (input?.agreed !== true) return { ok: false, error: "Tick the box to agree before saving a card." };
  const deps = flowDeps();
  const home = `${deps.origin}${clinicPublicPaths(v.clinic.tenantId).portal}`;
  const r = await startSaveCard(deps.ctx, v.clinic.tenantId, { patientId: v.viewer.patientId, clinicName: v.clinic.name, channel: "portal", allowsNoShow: input?.allowsNoShow === true, successUrl: home, cancelUrl: home }, patientActor(v.viewer.sessionId), cardDeps());
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}
