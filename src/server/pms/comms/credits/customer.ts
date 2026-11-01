/**
 * The clinic's ONE customer at the card payment service (31/10/2026): text credit packs, the saved card for automatic
 * top-up and the ClinDesk / ClinForms subscription all use it (one customer per clinic, kept on
 * pms_sms_credit_accounts.customer_ref with its mode). A customer made in the other mode (test while live payments
 * are on) is never reused: a new one is made and replaces it (repos setCreditCustomer – the test card is cleared).
 * Server only. The customer holds the clinic's id and name only – nothing clinical.
 */
import "server-only";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { DbContext } from "../../../repos/pms/context";
import { getSmsCreditAccount, setCreditCustomer } from "../../../repos/pms/comms/credits";
import type { CardPayments } from "./card-payments";

export async function clinicCustomerRef(ctx: DbContext, input: { tenantId: string; clinicName: string }, payments: Pick<CardPayments, "createCustomer" | "mode">, actor: PmsActor): Promise<string> {
  const acct = await getSmsCreditAccount(ctx, input.tenantId);
  if (acct.customerRef && (acct.customerMode ?? "test") === payments.mode) return acct.customerRef;
  const created = await payments.createCustomer({ tenantId: input.tenantId, clinicName: input.clinicName });
  await setCreditCustomer(ctx, input.tenantId, created, actor, payments.mode);
  // Two tabs at once: the first customer saved wins (set once per mode), and both checkouts use it.
  const after = await getSmsCreditAccount(ctx, input.tenantId);
  return after.customerRef && (after.customerMode ?? "test") === payments.mode ? after.customerRef : created;
}
