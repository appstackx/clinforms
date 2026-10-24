/**
 * Card payment links (`pms_payment_links`): a hosted card payment page for one invoice, made by the payment
 * provider in TEST MODE only (src/server/pms/billing/payments/*). The row keeps the provider's link id and URL; the
 * payment itself is recorded as a normal payment (provider "stripe", its checkout reference) when staff check the
 * link – never twice (unique reference).
 */
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import type { PaymentLink, PaymentLinkStatus } from "../../../../modules/pms/billing/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { Selectable } from "kysely";
import type { PmsPaymentLinksTable } from "../../../db/pms-schema/billing";
import { RepoInputError, assertId, assertTenantId, nowIso, num, pmsAudit, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";

const T = "pms_payment_links";

function toLink(r: Selectable<PmsPaymentLinksTable>): PaymentLink {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    provider: r.provider,
    mode: "test",
    url: r.url,
    amountPence: num(r.amount_pence),
    status: r.status as PaymentLinkStatus,
    lastCheckedAt: r.last_checked_at,
    createdAt: r.created_at,
  };
}

export interface SavePaymentLinkInput {
  invoiceId: string;
  provider: string;
  providerLinkId: string;
  url: string;
  amountPence: number;
}

export async function savePaymentLink(ctx: RepoContext, tenantId: string, input: SavePaymentLinkInput, actor: PmsActor): Promise<PaymentLink> {
  assertTenantId(tenantId);
  assertId(input.invoiceId, "invoice id");
  assertId(input.providerLinkId, "payment link id");
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(input.provider)) throw new RepoInputError("Unknown payment provider.");
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new RepoInputError("The payment link is not a web address.");
  }
  if (url.protocol !== "https:" || input.url.length > 500) throw new RepoInputError("The payment link must be a secure (https) address.");
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new RepoInputError("A payment link needs an amount.");
  const id = pmsId(P.paymentLink, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        invoice_id: input.invoiceId,
        provider: input.provider,
        mode: "test",
        provider_link_id: input.providerLinkId,
        url: url.toString(),
        amount_pence: input.amountPence,
        status: "active",
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.payment_link.create", targetType: "pms_invoice", targetId: input.invoiceId, detail: { linkId: id, amountPence: input.amountPence } }),
    ],
    { unique: "That payment link is already recorded.", foreignKey: "That invoice does not exist in this clinic." },
  );
  return (await getPaymentLink(ctx, tenantId, id)) as PaymentLink;
}

export async function getPaymentLink(ctx: RepoContext, tenantId: string, id: string): Promise<(PaymentLink & { providerLinkId: string }) | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? { ...toLink(r), providerLinkId: r.provider_link_id } : null;
}

/** An invoice's links, newest first. */
export async function listPaymentLinks(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<(PaymentLink & { providerLinkId: string })[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("invoice_id", "=", invoiceId).orderBy("created_at", "desc").limit(50).execute();
  return rows.map((r) => ({ ...toLink(r), providerLinkId: r.provider_link_id }));
}

/** Records that a link was checked, and its new status if it changed (paid / deactivated). */
export async function markPaymentLink(ctx: RepoContext, tenantId: string, id: string, status: PaymentLinkStatus, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(id, "payment link id");
  const at = nowIso(ctx);
  const before = await ctx.db.selectFrom(T).select(["status", "invoice_id"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!before) throw new RepoInputError("That payment link does not exist in this clinic.");
  await ctx.db.updateTable(T).set({ status, last_checked_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).execute();
  if (before.status !== status) {
    await pmsAudit(ctx, tenantId, actor, { action: "pms.payment_link.status", targetType: "pms_invoice", targetId: before.invoice_id, detail: { linkId: id, from: before.status, to: status } });
  }
}
