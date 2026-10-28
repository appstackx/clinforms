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
  takePaymentFor,
  voidInvoiceFor,
  waiveFeeFor,
  type InvoiceVisitsResult,
  type RemittanceResult,
  type TakePaymentResult,
} from "@/server/pms/billing/writes";

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
  const actor = await clinicActionActor({ permission: "billing.pay" });
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

export async function invoiceVisitsAction(appointmentIds: string[], issue: boolean): Promise<BillingActionResult<{ result: InvoiceVisitsResult }>> {
  const actor = await clinicActionActor({ permission: "billing.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await invoiceVisitsFor(actor, { appointmentIds: Array.isArray(appointmentIds) ? appointmentIds.map(String) : [], issue: Boolean(issue) });
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
  const actor = await clinicActionActor({ permission: "billing.pay" });
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
