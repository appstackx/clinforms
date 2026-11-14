"use server";
/**
 * The billing screens' server actions. Each one: the member, the clinic's package and the permission first
 * (contract §6), then src/server/pms/billing/{views,writes}.ts, which check the permission and the member's sites
 * again, validate the input and write the change with its audit row. Answers: { ok: true, … } or
 * { ok: false, error } in plain words – never an internal error.
 */
import { revalidatePath } from "next/cache";
import type { RemittanceInput, TakePaymentInput } from "@/modules/pms/billing/schemas";
import type { RemittanceInvoiceView, TakePaymentView } from "@/modules/pms/billing/view";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { setBillStatusFor, setInvoiceDiagnosisFor } from "@/server/pms/billing/healthcode";
import { remittanceInvoicesFor, takePaymentViewFor } from "@/server/pms/billing/views";
import {
  cancelDraftFor,
  checkPaymentLinksFor,
  creditNoteFor,
  invoiceVisitsFor,
  issueInvoiceFor,
  paymentLinkFor,
  refundFor,
  remittanceFor,
  removeAllocationFor,
  saveTestCardFor,
  setPayerContributionModeFor,
  takePaymentFor,
  voidInvoiceFor,
  waiveFeeFor,
  type InvoiceVisitsResult,
  type RemittanceResult,
  type TakePaymentResult,
} from "@/server/pms/billing/writes";
import { giftCardsFor, sellGiftCardFor } from "@/server/pms/billing/gift-cards";
import { recordStockChangeFor, sellProductFor } from "@/server/pms/billing/products";
import { cancelCourseFor, reverseCourseUseFor, sellCourseFor, setCourseExpiryFor } from "@/server/pms/billing/courses";

export type BillingActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };

const BILLING = `${CLINIC_BASE_PATH}/billing`;

function refresh(paths: string[] = []) {
  revalidatePath(BILLING);
  for (const p of paths) revalidatePath(p);
}

function invoicePath(id: string) {
  return `${BILLING}/invoices/${id}`;
}

/** The take-payment dialog's data for a patient (billing.pay). */
export async function loadTakePaymentAction(patientId: string, context: string | null = null): Promise<BillingActionResult<{ view: TakePaymentView }>> {
  const actor = await clinicActionActor({ permission: "billing.pay", readOnly: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await takePaymentViewFor(actor, String(patientId), typeof context === "string" ? context.slice(0, 120) : null);
  return r.ok ? { ok: true, view: r.value } : { ok: false, error: r.error };
}

export async function takePaymentAction(input: TakePaymentInput): Promise<BillingActionResult<{ result: TakePaymentResult }>> {
  const actor = await clinicActionActor({ permission: "billing.pay" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await takePaymentFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  refresh([`${CLINIC_BASE_PATH}/patients/${input.patientId}`]);
  return { ok: true, result: r.value };
}

export async function invoiceVisitsAction(appointmentIds: string[], issue: boolean, useCourse: string[] = []): Promise<BillingActionResult<{ result: InvoiceVisitsResult }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await invoiceVisitsFor(actor, {
    appointmentIds: Array.isArray(appointmentIds) ? appointmentIds.map(String) : [],
    issue: Boolean(issue),
    useCourse: Array.isArray(useCourse) ? useCourse.map(String).slice(0, 200) : [],
  });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([`${BILLING}/visits`]);
  return { ok: true, result: r.value };
}

export async function waiveFeeAction(appointmentId: string): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await waiveFeeFor(actor, String(appointmentId));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([`${BILLING}/visits`]);
  return { ok: true };
}

export async function issueInvoiceAction(invoiceId: string, rev: number): Promise<BillingActionResult<{ number: string | null }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await issueInvoiceFor(actor, String(invoiceId), Number(rev));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true, number: r.value.number };
}

export async function cancelDraftAction(invoiceId: string, rev: number): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await cancelDraftFor(actor, String(invoiceId), Number(rev));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true };
}

export async function creditNoteAction(invoiceId: string, amountPence: number | null, reason: string): Promise<BillingActionResult<{ number: string }>> {
  const actor = await clinicActionActor({ permission: "billing.refund" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await creditNoteFor(actor, String(invoiceId), { amountPence: amountPence === null ? undefined : Number(amountPence), reason: String(reason ?? "") });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true, number: r.value.number };
}

export async function voidInvoiceAction(invoiceId: string, reason: string): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.void" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await voidInvoiceFor(actor, String(invoiceId), String(reason ?? ""));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true };
}

export async function refundAction(invoiceId: string, amountPence: number, method: "card" | "cash" | "bank_transfer", reason: string): Promise<BillingActionResult<{ toCard: boolean }>> {
  const actor = await clinicActionActor({ permission: "billing.refund" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!["card", "cash", "bank_transfer"].includes(method)) return { ok: false, error: "Choose how the money goes back." };
  const r = await refundFor(actor, String(invoiceId), { amountPence: Number(amountPence), method, reason: String(reason ?? "") });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true, toCard: r.value.toCard };
}

export async function removeAllocationAction(invoiceId: string, allocationId: string): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.refund" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await removeAllocationFor(actor, String(invoiceId), String(allocationId));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true };
}

export async function paymentLinkAction(invoiceId: string): Promise<BillingActionResult<{ url: string }>> {
  const actor = await clinicActionActor({ permission: "billing.pay" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await paymentLinkFor(actor, String(invoiceId));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true, url: r.value.url };
}

export async function checkPaymentLinksAction(invoiceId: string): Promise<BillingActionResult<{ recorded: number; amountPence: number }>> {
  const actor = await clinicActionActor({ permission: "billing.pay" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await checkPaymentLinksFor(actor, String(invoiceId));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId)]);
  return { ok: true, ...r.value };
}

export async function saveTestCardAction(patientId: string): Promise<BillingActionResult<{ label: string }>> {
  const actor = await clinicActionActor({ permission: "billing.pay" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveTestCardFor(actor, String(patientId));
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`${CLINIC_BASE_PATH}/patients/${patientId}`);
  return { ok: true, label: r.value.label };
}

export async function remittanceInvoicesAction(payerReferrerId: string): Promise<BillingActionResult<{ invoices: RemittanceInvoiceView[] }>> {
  const actor = await clinicActionActor({ permission: "billing.pay", readOnly: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await remittanceInvoicesFor(actor, String(payerReferrerId));
  return r.ok ? { ok: true, invoices: r.value } : { ok: false, error: r.error };
}

export async function remittanceAction(input: RemittanceInput): Promise<BillingActionResult<{ result: RemittanceResult }>> {
  const actor = await clinicActionActor({ permission: "billing.pay" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await remittanceFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error };
  refresh([`${BILLING}/remittances/new`]);
  return { ok: true, result: r.value };
}

/** A payer account's excess / contribution mode (the clinic's set-up: settings.setup). */
export async function setPayerContributionModeAction(referrerId: string, mode: string): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setPayerContributionModeFor(actor, String(referrerId), String(mode));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([`${BILLING}/payers`, `${BILLING}/visits`]);
  return { ok: true };
}

/** An insurer invoice's own ICD-10 diagnosis code (HC10): billing.edit + clinical.view, checked again in the service. */
export async function setInvoiceDiagnosisAction(invoiceId: string, code: string): Promise<BillingActionResult<{ code: string | null }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setInvoiceDiagnosisFor(actor, String(invoiceId), typeof code === "string" ? code.slice(0, 20) : "");
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId), `${BILLING}/claims`]);
  return { ok: true, code: r.value.code };
}

/** An insurer invoice's Healthcode bill status, set by hand (HC13): billing.edit, checked again in the service. */
export async function setBillStatusAction(invoiceId: string, status: string): Promise<BillingActionResult<{ status: string | null }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setBillStatusFor(actor, String(invoiceId), typeof status === "string" ? status.slice(0, 20) : "");
  if (!r.ok) return { ok: false, error: r.error };
  refresh([invoicePath(invoiceId), `${BILLING}/claims`]);
  return { ok: true, status: r.value.status };
}

/* Courses (PK02, src/server/pms/billing/courses.ts): each checks the permission and the member's sites again. */

function patientPath(id: string) {
  return `${CLINIC_BASE_PATH}/patients/${id}`;
}

export async function sellCourseAction(patientId: string, input: { courseTypeId: string; caseId?: string | null; siteId?: string | null; issue?: boolean }): Promise<BillingActionResult<{ invoiceId: string; number: string | null; issued: boolean }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await sellCourseFor(actor, String(patientId), {
    courseTypeId: String(input?.courseTypeId ?? ""),
    caseId: input?.caseId ? String(input.caseId) : null,
    siteId: input?.siteId ? String(input.siteId) : null,
    issue: Boolean(input?.issue),
  });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([patientPath(patientId)]);
  return { ok: true, ...r.value };
}

export async function reverseCourseUseAction(patientId: string, courseId: string, useId: string): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await reverseCourseUseFor(actor, String(courseId), String(useId));
  if (!r.ok) return { ok: false, error: r.error };
  refresh([patientPath(patientId), `${BILLING}/visits`]);
  return { ok: true };
}

export async function cancelCourseAction(patientId: string, courseId: string, creditPence: number | null, reason: string): Promise<BillingActionResult<{ creditNumber: string | null; creditPence: number }>> {
  const actor = await clinicActionActor({ permission: "billing.refund" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await cancelCourseFor(actor, String(courseId), { creditPence: creditPence === null ? undefined : Number(creditPence), reason: String(reason ?? "") });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([patientPath(patientId)]);
  return { ok: true, ...r.value };
}

export async function setCourseExpiryAction(patientId: string, courseId: string, rev: number, expiresOn: string | null): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setCourseExpiryFor(actor, String(courseId), Number(rev), typeof expiresOn === "string" ? expiresOn.slice(0, 10) : null);
  if (!r.ok) return { ok: false, error: r.error };
  refresh([patientPath(patientId)]);
  return { ok: true };
}

/* Gift cards (PK04, src/server/pms/billing/gift-cards.ts). The code comes back once, here. */
export async function sellGiftCardAction(patientId: string, input: { amountPence: number; recipientName?: string | null; siteId?: string | null; issue?: boolean }): Promise<BillingActionResult<{ code: string; invoiceId: string; number: string | null; issued: boolean; expiresOn: string | null; issueProblem: string | null }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await sellGiftCardFor(actor, String(patientId), {
    amountPence: Number(input?.amountPence),
    recipientName: typeof input?.recipientName === "string" ? input.recipientName.slice(0, 80) : null,
    siteId: input?.siteId ? String(input.siteId) : null,
    issue: Boolean(input?.issue),
  });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([patientPath(patientId), `${BILLING}/gift-cards`]);
  return { ok: true, code: r.value.code, invoiceId: r.value.invoiceId, number: r.value.number, issued: r.value.issued, expiresOn: r.value.expiresOn, issueProblem: r.value.issueProblem };
}

/** Looks a gift card up by its code (billing.view): the card's id, so the page opens it without the code in the URL. */
export async function lookUpGiftCardAction(code: string): Promise<BillingActionResult<{ cardId: string }>> {
  const actor = await clinicActionActor({ permission: "billing.view", readOnly: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await giftCardsFor(actor, { code: typeof code === "string" ? code.slice(0, 40) : "" });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.value.card) return { ok: false, error: r.value.lookupError ?? "No gift card has that code in this clinic." };
  return { ok: true, cardId: r.value.card.id };
}

/* Products and stock (PK05, src/server/pms/billing/products.ts). */
export async function sellProductAction(patientId: string, input: { productId: string; quantity: number; siteId?: string | null; issue?: boolean }): Promise<BillingActionResult<{ invoiceId: string; number: string | null; issued: boolean }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await sellProductFor(actor, String(patientId), { productId: String(input?.productId ?? ""), quantity: Number(input?.quantity), siteId: input?.siteId ? String(input.siteId) : null, issue: Boolean(input?.issue) });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([patientPath(patientId), `${BILLING}/stock`]);
  return { ok: true, ...r.value };
}

export async function recordStockChangeAction(input: { productId: string; siteId: string; kind: "received" | "adjusted"; quantity: number; reason?: string | null }): Promise<BillingActionResult> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const kind = input?.kind === "adjusted" ? "adjusted" : "received";
  const r = await recordStockChangeFor(actor, { productId: String(input?.productId ?? ""), siteId: String(input?.siteId ?? ""), kind, quantity: Number(input?.quantity), reason: typeof input?.reason === "string" ? input.reason.slice(0, 200) : null });
  if (!r.ok) return { ok: false, error: r.error };
  refresh([`${BILLING}/stock`]);
  return { ok: true };
}
