"use server";
/**
 * Card payments on the billing screens (the clinic's own payment account – docs/clinic-system/card-payments.md): the
 * invoice's reader / saved-card payments and refunds, a patient's saved cards and memberships. Each action: the
 * member and the clinic's package first, then src/server/pms/billing/connect/service.ts, which checks the switch,
 * the permission (billing.pay / billing.refund) and the member's sites again. Plain answers only.
 */
import { revalidatePath } from "next/cache";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import {
  cancelMembershipFor,
  cancelReaderPaymentFor,
  chargeSavedCardFor,
  checkCardPaymentFor,
  refundCardPaymentFor,
  removeSavedCardFor,
  simulateReaderTapFor,
  startMembershipFor,
  startReaderPaymentFor,
  startSaveCardFor,
} from "@/server/pms/billing/connect/service";
import { trustedOrigin } from "@/server/pms/billing/connect/screen";

type Answer<T> = { ok: true; value: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function member() {
  const actor = await clinicActionActor({ permission: "billing.view" });
  if ("error" in actor) return { error: actorErrorMessage(actor.error) } as const;
  return { actor } as const;
}

function answer<T>(r: { ok: true; value: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }, paths: string[]): Answer<T> {
  if (r.ok) for (const p of paths) revalidatePath(p);
  return r.ok ? r : { ok: false, error: r.error, fieldErrors: r.fieldErrors };
}

const inv = (id: string) => `${CLINIC_BASE_PATH}/billing/invoices/${encodeURIComponent(id)}`;
const s = (v: unknown) => String(v ?? "").slice(0, 100);

export async function startReaderPaymentAction(invoiceId: string, readerId: string, amountPence?: number): Promise<Answer<{ intentId: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await startReaderPaymentFor(m.actor, { invoiceId: s(invoiceId), readerId: s(readerId), amountPence: amountPence === undefined ? undefined : Number(amountPence) }), [inv(s(invoiceId))]);
}

export async function checkCardPaymentAction(invoiceId: string, intentId: string): Promise<Answer<{ status: string; message: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await checkCardPaymentFor(m.actor, s(intentId)), [inv(s(invoiceId))]);
}

export async function cancelReaderPaymentAction(invoiceId: string, intentId: string): Promise<Answer<{ status: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await cancelReaderPaymentFor(m.actor, s(intentId)), [inv(s(invoiceId))]);
}

export async function simulateReaderTapAction(invoiceId: string, intentId: string, decline: boolean): Promise<Answer<{ status: string; message: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await simulateReaderTapFor(m.actor, s(intentId), decline === true ? "4000000000009995" : undefined), [inv(s(invoiceId))]);
}

export async function chargeSavedCardAction(invoiceId: string, mandateId: string, amountPence?: number): Promise<Answer<{ status: string; message: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await chargeSavedCardFor(m.actor, { invoiceId: s(invoiceId), mandateId: s(mandateId), amountPence: amountPence === undefined ? undefined : Number(amountPence) }), [inv(s(invoiceId))]);
}

export async function refundCardPaymentAction(invoiceId: string, input: { paymentId: string; amountPence: number; reason: string }): Promise<Answer<{ refundedPence: number }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await refundCardPaymentFor(m.actor, { invoiceId: s(invoiceId), paymentId: s(input?.paymentId), amountPence: Number(input?.amountPence), reason: String(input?.reason ?? "").slice(0, 500) }), [inv(s(invoiceId))]);
}

/** Opens the payment provider's card form for the patient (consent recorded first). Answers the form's address. */
export async function startSaveCardAction(patientId: string, input: { allowsNoShow: boolean; consentConfirmed: boolean }): Promise<Answer<{ url: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  const back = `${trustedOrigin()}${CLINIC_BASE_PATH}/patients/${encodeURIComponent(s(patientId))}/invoices`;
  return answer(await startSaveCardFor(m.actor, { patientId: s(patientId), allowsNoShow: input?.allowsNoShow === true, consentConfirmed: input?.consentConfirmed === true, successUrl: back, cancelUrl: `${back}?card=cancelled` }), []);
}

export async function removeSavedCardAction(patientId: string, mandateId: string): Promise<Answer<{ removed: boolean; membershipsCancelled: number }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await removeSavedCardFor(m.actor, s(mandateId)), [`${CLINIC_BASE_PATH}/patients/${encodeURIComponent(s(patientId))}/invoices`]);
}

export async function startMembershipAction(patientId: string, input: { planId: string; mandateId: string; chargeDay: number; consentConfirmed: boolean }): Promise<Answer<{ id: string }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(
    await startMembershipFor(m.actor, { patientId: s(patientId), planId: s(input?.planId), mandateId: s(input?.mandateId), chargeDay: Number(input?.chargeDay), consentConfirmed: input?.consentConfirmed === true }),
    [`${CLINIC_BASE_PATH}/patients/${encodeURIComponent(s(patientId))}/invoices`],
  );
}

export async function cancelMembershipAction(patientId: string, membershipId: string): Promise<Answer<{ cancelled: boolean }>> {
  const m = await member();
  if ("error" in m) return { ok: false, error: m.error as string };
  return answer(await cancelMembershipFor(m.actor, s(membershipId)), [`${CLINIC_BASE_PATH}/patients/${encodeURIComponent(s(patientId))}/invoices`]);
}
