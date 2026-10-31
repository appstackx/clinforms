/**
 * Price lists (self-pay, or one payer's own list) and their prices per service. A price list item is the one
 * directory row the app may delete (a price removed from a list); everything else is switched inactive.
 */
import type { Selectable } from "kysely";
import { FOUNDATION_ID_PREFIXES as P } from "../../../modules/pms/core/ids";
import {
  PriceListInputSchema,
  PriceListItemInputSchema,
  PriceListPatchSchema,
  type PriceListInput,
  type PriceListItemInput,
  type PriceListPatch,
} from "../../../modules/pms/core/schemas";
import type { PayerType, PmsActor, PriceList, PriceListItem } from "../../../modules/pms/core/types";
import type { PmsPriceListItemsTable, PmsPriceListsTable } from "../../db/pms-schema/foundation";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  guarded,
  isOn,
  nowIso,
  num,
  parseInput,
  patchColumns,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type DbContext,
} from "./context";

function toPriceList(r: Selectable<PmsPriceListsTable>): PriceList {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    name: r.name,
    payerType: (r.payer_type as PayerType | null) ?? null,
    referrerId: r.referrer_id,
    isDefault: isOn(r.is_default),
    validFrom: r.valid_from,
    validTo: r.valid_to,
    active: isOn(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toItem(r: Selectable<PmsPriceListItemsTable>): PriceListItem {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    priceListId: r.price_list_id,
    serviceId: r.service_id,
    pricePence: num(r.price_pence),
    billingCode: r.billing_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const LIST_MESSAGES = { unique: "A price list with this name already exists.", foreignKey: "That payer does not exist in this clinic." };

export async function createPriceList(ctx: DbContext, tenantId: string, input: PriceListInput, actor: PmsActor): Promise<PriceList> {
  assertTenantId(tenantId);
  const d = parseInput(PriceListInputSchema, input, "Price list");
  const id = pmsId(P.priceList, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_price_lists").values({
        tenant_id: tenantId,
        id,
        name: d.name,
        payer_type: d.payerType ?? null,
        referrer_id: d.referrerId ?? null,
        is_default: b01(d.isDefault ?? false),
        valid_from: d.validFrom ?? null,
        valid_to: d.validTo ?? null,
        active: b01(d.active ?? true),
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.price_list.create", targetType: "pms_price_list", targetId: id }),
    ],
    LIST_MESSAGES,
  );
  return (await getPriceList(ctx, tenantId, id)) as PriceList;
}

export async function updatePriceList(ctx: DbContext, tenantId: string, id: string, patch: PriceListPatch, actor: PmsActor): Promise<PriceList | null> {
  assertTenantId(tenantId);
  assertId(id, "price list id");
  const d = parseInput(PriceListPatchSchema, patch, "Price list");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      name: "name",
      payerType: "payer_type",
      referrerId: "referrer_id",
      isDefault: ["is_default", (v: boolean) => b01(v)],
      validFrom: "valid_from",
      validTo: "valid_to",
      active: ["active", (v: boolean) => b01(v)],
    },
    set,
  );
  if (fields.length === 0) return getPriceList(ctx, tenantId, id);
  const result = await guarded(
    () => ctx.db.updateTable("pms_price_lists").set({ ...set, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst(),
    LIST_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) return null;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.price_list.update", targetType: "pms_price_list", targetId: id, detail: { fields } });
  return getPriceList(ctx, tenantId, id);
}

export async function getPriceList(ctx: DbContext, tenantId: string, id: string): Promise<PriceList | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_price_lists").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toPriceList(row) : null;
}

export async function listPriceLists(ctx: DbContext, tenantId: string, options: { includeInactive?: boolean } = {}): Promise<PriceList[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("pms_price_lists").selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  const rows = await q.orderBy("is_default", "desc").orderBy("name").limit(500).execute();
  return rows.map(toPriceList);
}

/** Sets the price of a service on a list (creates or replaces the item). */
export async function setPriceListItem(ctx: DbContext, tenantId: string, input: PriceListItemInput, actor: PmsActor): Promise<PriceListItem> {
  assertTenantId(tenantId);
  const d = parseInput(PriceListItemInputSchema, input, "Price");
  const at = nowIso(ctx);
  const id = pmsId(P.priceListItem, ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db
        .insertInto("pms_price_list_items")
        .values({
          tenant_id: tenantId,
          id,
          price_list_id: d.priceListId,
          service_id: d.serviceId,
          price_pence: d.pricePence,
          billing_code: d.billingCode ?? null,
          created_at: at,
          updated_at: at,
        })
        .onConflict((oc) =>
          oc.columns(["tenant_id", "price_list_id", "service_id"]).doUpdateSet({ price_pence: d.pricePence, billing_code: d.billingCode ?? null, updated_at: at }),
        ),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.price_list_item.set",
        targetType: "pms_price_list",
        targetId: d.priceListId,
        detail: { serviceId: d.serviceId, pricePence: d.pricePence },
      }),
    ],
    { foreignKey: "That price list or appointment type does not exist in this clinic." },
  );
  const row = await ctx.db
    .selectFrom("pms_price_list_items")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("price_list_id", "=", d.priceListId)
    .where("service_id", "=", d.serviceId)
    .executeTakeFirstOrThrow();
  return toItem(row);
}

export async function removePriceListItem(ctx: DbContext, tenantId: string, priceListId: string, serviceId: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(priceListId, "price list id");
  assertId(serviceId, "service id");
  const result = await ctx.db
    .deleteFrom("pms_price_list_items")
    .where("tenant_id", "=", tenantId)
    .where("price_list_id", "=", priceListId)
    .where("service_id", "=", serviceId)
    .executeTakeFirst();
  const removed = Number(result.numDeletedRows) > 0;
  if (removed) await pmsAudit(ctx, tenantId, actor, { action: "pms.price_list_item.remove", targetType: "pms_price_list", targetId: priceListId, detail: { serviceId } });
  return removed;
}

export async function listPriceListItems(ctx: DbContext, tenantId: string, priceListId: string): Promise<PriceListItem[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("pms_price_list_items")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("price_list_id", "=", priceListId)
    .orderBy("service_id")
    .limit(1000)
    .execute();
  return rows.map(toItem);
}

/**
 * The price of a service: on the given list (or the clinic's default list), else the service's own default price,
 * else null (to be entered by hand).
 */
export async function priceFor(ctx: DbContext, tenantId: string, serviceId: string, priceListId?: string | null): Promise<{ pricePence: number; source: "list" | "default_list" | "service" } | null> {
  assertTenantId(tenantId);
  assertId(serviceId, "service id");
  if (priceListId) {
    const item = await ctx.db
      .selectFrom("pms_price_list_items")
      .select("price_pence")
      .where("tenant_id", "=", tenantId)
      .where("price_list_id", "=", priceListId)
      .where("service_id", "=", serviceId)
      .executeTakeFirst();
    if (item) return { pricePence: num(item.price_pence), source: "list" };
  }
  const fromDefault = await ctx.db
    .selectFrom("pms_price_list_items")
    .innerJoin("pms_price_lists", (j) => j.onRef("pms_price_lists.tenant_id", "=", "pms_price_list_items.tenant_id").onRef("pms_price_lists.id", "=", "pms_price_list_items.price_list_id"))
    .select("pms_price_list_items.price_pence")
    .where("pms_price_list_items.tenant_id", "=", tenantId)
    .where("pms_price_list_items.service_id", "=", serviceId)
    .where("pms_price_lists.is_default", "=", 1)
    .where("pms_price_lists.active", "=", 1)
    .executeTakeFirst();
  if (fromDefault) return { pricePence: num(fromDefault.price_pence), source: "default_list" };
  const service = await ctx.db.selectFrom("pms_services").select("default_price_pence").where("tenant_id", "=", tenantId).where("id", "=", serviceId).executeTakeFirst();
  if (!service) throw new RepoInputError("That appointment type does not exist in this clinic.");
  return service.default_price_pence === null ? null : { pricePence: num(service.default_price_pence), source: "service" };
}
