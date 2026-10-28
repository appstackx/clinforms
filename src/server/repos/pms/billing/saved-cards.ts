/**
 * A patient's saved card (`pms_saved_cards`, migration 0136) – TEST MODE ONLY. The row keeps the payment provider's
 * references (customer and payment method) and what a receipt prints (brand, last four digits, expiry); never a
 * card number. A card is removed by status, never deleted. Saving and charging go through the provider
 * (src/server/pms/billing/payments), which refuses live keys.
 */
import type { Selectable } from "kysely";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import type { SavedCard } from "../../../../modules/pms/billing/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { PmsSavedCardsTable } from "../../../db/pms-schema/billing";
import { RepoInputError, assertId, assertTenantId, nowIso, num, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";
import { billingAuditWhen } from "./shared";

const T = "pms_saved_cards";

export interface SaveCardInput {
  patientId: string;
  provider: string;
  customerRef: string;
  methodRef: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

function toCard(r: Selectable<PmsSavedCardsTable>): SavedCard {
  return {
    id: r.id,
    patientId: r.patient_id,
    provider: r.provider,
    brand: r.brand,
    last4: r.last4,
    expMonth: num(r.exp_month),
    expYear: num(r.exp_year),
    status: r.status as SavedCard["status"],
    createdAt: r.created_at,
  };
}

export async function saveCard(ctx: RepoContext, tenantId: string, input: SaveCardInput, actor: PmsActor): Promise<SavedCard> {
  assertTenantId(tenantId);
  assertId(input.patientId, "patient id");
  assertId(input.customerRef, "customer reference");
  assertId(input.methodRef, "payment method reference");
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(input.provider)) throw new RepoInputError("Unknown payment provider.");
  if (!/^\d{4}$/.test(input.last4)) throw new RepoInputError("A card's last four digits are four digits.");
  if (!/^[A-Za-z ]{1,20}$/.test(input.brand)) throw new RepoInputError("Unknown card brand.");
  if (!Number.isInteger(input.expMonth) || input.expMonth < 1 || input.expMonth > 12 || !Number.isInteger(input.expYear) || input.expYear < 2000 || input.expYear > 2100) {
    throw new RepoInputError("The card's expiry is not a date.");
  }
  const id = pmsId(P.savedCard, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        patient_id: input.patientId,
        provider: input.provider,
        mode: "test",
        customer_ref: input.customerRef,
        method_ref: input.methodRef,
        brand: input.brand,
        last4: input.last4,
        exp_month: input.expMonth,
        exp_year: input.expYear,
        status: "active",
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.saved_card.add", targetType: "pms_patient", targetId: input.patientId, detail: { cardId: id, provider: input.provider } }),
    ],
    { unique: "That card is already saved.", foreignKey: "That patient does not exist in this clinic." },
  );
  return (await getSavedCard(ctx, tenantId, id)) as SavedCard;
}

/** One card with the provider's references (for charging it). */
export async function getSavedCard(ctx: RepoContext, tenantId: string, id: string): Promise<(SavedCard & { customerRef: string; methodRef: string }) | null> {
  assertTenantId(tenantId);
  assertId(id, "card id");
  const r = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? { ...toCard(r), customerRef: r.customer_ref, methodRef: r.method_ref } : null;
}

/** A patient's active cards, newest first. */
export async function listSavedCards(ctx: RepoContext, tenantId: string, patientId: string): Promise<SavedCard[]> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const rows = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).where("status", "=", "active").orderBy("created_at", "desc").limit(10).execute();
  return rows.map(toCard);
}

/** Removes a card (kept, marked removed). False when it was not an active card of this clinic. */
export async function removeSavedCard(ctx: RepoContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "card id");
  const row = await ctx.db.selectFrom(T).select(["patient_id", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row || row.status !== "active") return false;
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ctx.db.updateTable(T).set({ status: "removed", removed_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "active"),
    billingAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.saved_card.remove", targetType: "pms_patient", targetId: row.patient_id, detail: { cardId: id } },
      ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("removed_at", "=", at),
    ),
  ]);
  return true;
}
