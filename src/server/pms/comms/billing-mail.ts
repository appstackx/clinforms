/**
 * Billing's messages through comms (M6 – billing switched these off until Messages existed): an invoice, a
 * statement or a receipt by email, a payment link by text or email. Billing's own reads build the document
 * (src/server/pms/billing/views.ts – permission, clinic and site scope checked there); comms writes the message
 * (./writes.ts sendBillingMessageFor – billing.view + messages.send, payment links billing.pay), outbox / test only.
 *
 * Nothing is attached: the email carries the document as plain lines (number, dates, items, totals, how to pay)
 * and says the clinic can send a printed copy. A PDF attachment needs a live email provider (K2-COMMS-005).
 */
import "server-only";
import { formatPence, formatUkDate } from "../../../modules/pms/core/text";
import { getPayment } from "../../repos/pms/billing/payments";
import { paymentLinkFor } from "../billing/writes";
import { printInvoiceFor, statementFor, type StatementFor } from "../billing/views";
import { fail, ok, type Result } from "../records/access";
import type { DispatchDeps } from "./dispatch";
import type { CommsActor } from "./views";
import { sendBillingMessageFor, type SentAnswer } from "./writes";

/** "Email" on an invoice: to the patient (their invoice) or the payer's email (an insurer's or solicitor's invoice). */
export async function emailInvoiceFor(actor: CommsActor, invoiceId: string, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  const r = await printInvoiceFor(actor, invoiceId);
  if (!r.ok) return r;
  const inv = r.value.invoice;
  if (!inv.number || inv.status !== "issued") return fail("invalid", "Issue the invoice before emailing it.");
  let toAddress: string | null = null;
  if (inv.billTo !== "patient") {
    const payer = inv.payer ? await actor.repo().db.selectFrom("pms_referrers").select("email").where("tenant_id", "=", actor.tenantId).where("id", "=", inv.payer.id).executeTakeFirst() : null;
    toAddress = payer?.email ?? null;
    if (!toAddress) return fail("invalid", `There is no email address for ${inv.billToName}. Add one to their details, or print the invoice.`);
  }
  const lines = [
    `Invoice ${inv.number}${inv.issuedOn ? ` – issued ${formatUkDate(inv.issuedOn)}` : ""}`,
    `To: ${inv.billToName}`,
    `Patient: ${inv.patient.name}`,
    ...inv.billToReferences.map((x) => `${x.label}: ${x.value}`),
    "",
    ...inv.lines.map((l) => `${l.serviceOn ? `${formatUkDate(l.serviceOn)}  ` : ""}${l.description}  ${formatPence(l.totalPence)}`),
    "",
    `Total: ${formatPence(inv.totalPence)}`,
    `Paid: ${formatPence(inv.paidPence + inv.creditedPence)}`,
    `To pay: ${formatPence(inv.balancePence)}`,
    ...(r.value.howToPay.length ? ["", ...r.value.howToPay] : []),
  ];
  return sendBillingMessageFor(
    actor,
    {
      kind: "invoice",
      channel: "email",
      patientId: inv.patient.id,
      toAddress,
      documentId: inv.id,
      number: inv.number,
      amountPence: inv.totalPence,
      balancePence: inv.balancePence,
      dueOn: inv.dueOn,
      link: inv.paymentLinks.find((l) => l.status === "open")?.url ?? null,
      documentLines: lines,
    },
    deps,
  );
}

/** "Email statement": a patient's or a payer's statement for a period. */
export async function emailStatementFor(actor: CommsActor, who: StatementFor, from: string, until: string, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  const r = await statementFor(actor, who, from, until);
  if (!r.ok) return r;
  const s = r.value.statement;
  let toAddress: string | null = null;
  if ("payerReferrerId" in who) {
    const payer = await actor.repo().db.selectFrom("pms_referrers").select("email").where("tenant_id", "=", actor.tenantId).where("id", "=", who.payerReferrerId).executeTakeFirst();
    toAddress = payer?.email ?? null;
    if (!toAddress) return fail("invalid", `There is no email address for ${s.account.name}. Add one to their details, or print the statement.`);
  }
  const lines = [
    `${s.title}: ${formatUkDate(s.from)} to ${formatUkDate(s.until)}`,
    `Account: ${s.account.name}${s.account.reference ? ` (${s.account.reference})` : ""}`,
    `Brought forward: ${formatPence(s.openingPence)}`,
    ...s.rows.map((row) => `${formatUkDate(row.on)}  ${row.details}  ${row.chargePence !== null ? formatPence(row.chargePence) : `paid ${formatPence(row.paymentPence ?? 0)}`}`),
    `Amount to pay: ${formatPence(s.closingPence)}`,
    ...(s.howToPay.length ? ["", ...s.howToPay] : []),
  ];
  return sendBillingMessageFor(
    actor,
    {
      kind: "statement",
      channel: "email",
      patientId: "patientId" in who ? who.patientId : null,
      toAddress,
      documentId: "patientId" in who ? who.patientId : who.payerReferrerId,
      number: null,
      amountPence: s.closingPence,
      balancePence: s.closingPence,
      dueOn: null,
      link: null,
      documentLines: lines,
    },
    deps,
  );
}

/** "Email receipt" after Take payment: the payment, to the patient's email. */
export async function emailReceiptFor(actor: CommsActor, paymentId: string, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  if (!actor.can("billing.view")) return fail("forbidden", "You do not have permission to do that.");
  const p = await getPayment(actor.repo(), actor.tenantId, paymentId);
  if (!p || !p.patientId) return fail("not_found", "This payment no longer exists in this clinic.");
  const lines = [`Receipt for your payment of ${formatPence(p.amountPence)} on ${formatUkDate(p.receivedOn)}`, `Paid by: ${p.method.replace(/_/g, " ")}`, ...(p.reference ? [`Reference: ${p.reference}`] : [])];
  return sendBillingMessageFor(
    actor,
    { kind: "receipt", channel: "email", patientId: p.patientId, toAddress: null, documentId: p.id, number: null, amountPence: p.amountPence, balancePence: null, dueOn: null, link: null, documentLines: lines },
    deps,
  );
}

/** "Text payment link" / "Email payment link" on a patient invoice: a TEST payment link (billing) sent through comms. */
export async function sendPaymentLinkFor(actor: CommsActor, invoiceId: string, channel: "sms" | "email", deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  const inv = await printInvoiceFor(actor, invoiceId);
  if (!inv.ok) return inv;
  if (inv.value.invoice.billTo !== "patient") return fail("invalid", "Payment links are for the patient's own invoices.");
  const link = await paymentLinkFor(actor, invoiceId);
  if (!link.ok) return link;
  return sendBillingMessageFor(
    actor,
    {
      kind: "payment_link",
      channel,
      patientId: inv.value.invoice.patient.id,
      toAddress: null,
      documentId: invoiceId,
      number: inv.value.invoice.number,
      amountPence: link.value.amountPence,
      balancePence: link.value.amountPence,
      dueOn: inv.value.invoice.dueOn,
      link: link.value.url,
      documentLines: [],
    },
    deps,
  );
}

export { ok };
