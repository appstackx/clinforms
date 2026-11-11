/**
 * Products and stock (PK05, migrations 0236–0237): `pms_products` and the append-only `pms_stock_moves` per site.
 * Rules: src/modules/pms/billing/products.ts.
 *
 * - Products hang off the clinic's pms_billing_settings row (written in the same batch) so offboarding deletes them
 *   with it; moves go with their product, site and invoice line. Products are switched off, never deleted.
 * - On hand = SUM(quantity) per product and site.
 * - The ISSUE batch writes a −sold move per product line at the invoice's site; its site_id is read in the statement
 *   (NULL, the whole issue refused, unless this issue applied). A line credited in full (credit, void) writes it back
 *   (+returned) in the credit note's batch – once per line (unique index).
 *
 * Before the migrations every read answers "no products" (readOrEmpty) and no stock statement is added to an
 * invoice's batches unless it has product lines.
 */
import { sql } from "kysely";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import { ProductInputSchema, StockChangeInputSchema, type Product, type ProductInput, type ProductVatCode, type StockChangeInput, type StockMove, type StockMoveKind } from "../../../../modules/pms/billing/products";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { RepoInputError, assertId, assertTenantId, encryptField, nowIso, num, numOrNull, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";
import { invoiceLineRefs } from "./courses";
import { readOrEmpty } from "./healthcode";
import { ensureSettingsQuery } from "./settings";
import { affected, billingAuditWhen, billingBatch, chunks } from "./shared";

export const PRODUCTS = "pms_products";
export const STOCK = "pms_stock_moves";

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function toProduct(r: { id: string; rev: unknown; name: string; sku: string | null; price_pence: unknown; vat_code: string; low_stock_at: unknown; active: unknown; updated_at: unknown }): Product {
  return {
    id: r.id,
    rev: num(r.rev),
    name: r.name,
    sku: r.sku,
    pricePence: num(r.price_pence),
    vatCode: r.vat_code as ProductVatCode,
    lowStockAt: numOrNull(r.low_stock_at),
    active: num(r.active) === 1,
    updatedAt: iso(r.updated_at),
  };
}

export async function listProducts(ctx: RepoContext, tenantId: string, options: { includeArchived?: boolean } = {}): Promise<Product[]> {
  assertTenantId(tenantId);
  return readOrEmpty(PRODUCTS, [] as Product[], async () => {
    let q = ctx.db.selectFrom(PRODUCTS).selectAll().where("tenant_id", "=", tenantId);
    if (!options.includeArchived) q = q.where("active", "=", 1);
    return (await q.orderBy("name").orderBy("id").limit(500).execute()).map(toProduct);
  });
}

export async function getProduct(ctx: RepoContext, tenantId: string, id: string): Promise<Product | null> {
  assertTenantId(tenantId);
  return readOrEmpty(PRODUCTS, null as Product | null, async () => {
    const r = await ctx.db.selectFrom(PRODUCTS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return r ? toProduct(r) : null;
  });
}

const PRODUCT_MESSAGES = { unique: "Another product already has that SKU." };

export async function createProduct(ctx: RepoContext, tenantId: string, input: ProductInput, actor: PmsActor): Promise<Product> {
  assertTenantId(tenantId);
  const d = parseInput(ProductInputSchema, input, "Product");
  const id = pmsId(P.product, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ensureSettingsQuery(ctx, tenantId, at),
      ctx.db.insertInto(PRODUCTS).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        name: d.name,
        sku: d.sku ?? null,
        price_pence: d.pricePence,
        vat_code: d.vatCode ?? "standard",
        low_stock_at: d.lowStockAt ?? null,
        active: d.active === false ? 0 : 1,
        updated_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.product.create", targetType: "pms_product", targetId: id, detail: { pricePence: d.pricePence } }),
    ],
    PRODUCT_MESSAGES,
  );
  return (await getProduct(ctx, tenantId, id)) as Product;
}

export type ProductSaveResult = { ok: true; rev: number } | { ok: false; reason: "conflict"; currentRev: number } | { ok: false; reason: "not_found" };

export async function updateProduct(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, input: ProductInput, actor: PmsActor): Promise<ProductSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "product id");
  const d = parseInput(ProductInputSchema, input, "Product");
  const current = await getProduct(ctx, tenantId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const at = nowIso(ctx);
  const results = await billingBatch(
    ctx,
    [
      ctx.db
        .updateTable(PRODUCTS)
        .set({
          name: d.name,
          sku: d.sku === undefined ? current.sku : d.sku,
          price_pence: d.pricePence,
          vat_code: d.vatCode ?? current.vatCode,
          low_stock_at: d.lowStockAt === undefined ? current.lowStockAt : d.lowStockAt,
          active: d.active === undefined ? (current.active ? 1 : 0) : d.active ? 1 : 0,
          rev: expectedRev + 1,
          updated_by: actor.userId,
          updated_at: at,
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev),
      billingAuditWhen(
        ctx,
        tenantId,
        actor,
        { action: "pms.product.update", targetType: "pms_product", targetId: id, detail: { rev: expectedRev + 1, pricePence: d.pricePence } },
        ctx.db.selectFrom(PRODUCTS).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
      ),
    ],
    PRODUCT_MESSAGES,
  );
  if (affected(results[0]) === 0) {
    const now = await getProduct(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1 };
}

/* ------------------------------------------------------------------------------------------------
 * Stock
 * ----------------------------------------------------------------------------------------------*/

/** On hand per product at a site (products without moves are left out). */
export async function stockOnHand(ctx: RepoContext, tenantId: string, siteId: string): Promise<Map<string, number>> {
  assertTenantId(tenantId);
  return readOrEmpty(STOCK, new Map<string, number>(), async () => {
    const rows = await ctx.db
      .selectFrom(STOCK)
      .select((eb) => ["product_id", eb.fn.sum<number>("quantity").as("n")])
      .where("tenant_id", "=", tenantId)
      .where("site_id", "=", siteId)
      .groupBy("product_id")
      .execute();
    return new Map(rows.map((r) => [r.product_id, num(r.n)]));
  });
}

export async function listStockMoves(ctx: RepoContext, tenantId: string, siteId: string, options: { limit?: number } = {}): Promise<StockMove[]> {
  assertTenantId(tenantId);
  return readOrEmpty(STOCK, [] as StockMove[], async () => {
    const rows = await ctx.db
      .selectFrom(STOCK)
      .select(["id", "product_id", "site_id", "kind", "quantity", "invoice_line_id", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("site_id", "=", siteId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.min(200, Math.max(1, options.limit ?? 50)))
      .execute();
    return rows.map((r) => ({ id: r.id, productId: r.product_id, siteId: r.site_id, kind: r.kind as StockMoveKind, quantity: num(r.quantity), invoiceLineId: r.invoice_line_id, createdAt: iso(r.created_at) }));
  });
}

/** Stock received, or an adjustment (with its reason, encrypted). Audited in the same batch. */
export async function recordStockChange(ctx: RepoContext, tenantId: string, input: StockChangeInput, actor: PmsActor): Promise<StockMove> {
  assertTenantId(tenantId);
  const d = parseInput(StockChangeInputSchema, input, "Stock");
  const product = await getProduct(ctx, tenantId, d.productId);
  if (!product) throw new RepoInputError("That product does not exist in this clinic.");
  const id = pmsId(P.stockMove, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(STOCK).values({
        tenant_id: tenantId,
        id,
        product_id: product.id,
        site_id: d.siteId,
        kind: d.kind,
        quantity: d.quantity,
        invoice_line_id: null,
        reason_enc: encryptField(ctx, tenantId, STOCK, "reason_enc", id, d.reason ?? null),
        created_by: actor.userId,
        created_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: d.kind === "received" ? "pms.stock.receive" : "pms.stock.adjust", targetType: "pms_product", targetId: product.id, detail: { siteId: d.siteId, quantity: d.quantity } }),
    ],
    { foreignKey: "That product or site does not exist in this clinic." },
  );
  return { id, productId: product.id, siteId: d.siteId, kind: d.kind, quantity: d.quantity, invoiceLineId: null, createdAt: at };
}

/** The invoice's product lines: [line, product id] (none when nothing sells a product or the tables do not exist). */
async function productLines(ctx: RepoContext, tenantId: string, invoiceId: string) {
  return (await invoiceLineRefs(ctx, tenantId, invoiceId)).filter((r) => r.refType === "product");
}

/**
 * For the ISSUE batch: a −sold move per product line, at the invoice's site – read in the statement, so NULL (the
 * whole issue refused) unless this very issue applied. Refused at once when the invoice has no site.
 */
export async function stockSaleQueries(ctx: RepoContext, tenantId: string, inv: { id: string; siteId: string | null; lines: { id: string; quantity: number }[] }, token: string, actor: PmsActor, at: string): Promise<BatchQuery[]> {
  const refs = await productLines(ctx, tenantId, inv.id);
  if (refs.length === 0) return [];
  if (!inv.siteId) throw new RepoInputError("This invoice sells a product, so it needs a site (the stock it comes from).");
  const queries: BatchQuery[] = [];
  for (const r of refs) {
    const line = inv.lines.find((l) => l.id === r.invoiceLineId);
    if (!line) continue;
    const id = pmsId(P.stockMove, ctx);
    queries.push(
      ctx.db.insertInto(STOCK).values({
        tenant_id: tenantId,
        id,
        product_id: r.refId,
        site_id: sql<string>`(select site_id from pms_invoices where tenant_id = ${tenantId} and id = ${inv.id} and edit_token = ${token} and status = 'issued')`,
        kind: "sold",
        quantity: -line.quantity,
        invoice_line_id: line.id,
        reason_enc: null,
        created_by: actor.userId,
        created_at: at,
      }),
    );
  }
  queries.push(pmsAuditQuery(ctx, tenantId, actor, { action: "pms.stock.sell", targetType: "pms_invoice", targetId: inv.id, detail: { lines: refs.length } }));
  return queries;
}

/**
 * For a credit note that releases lines (credit, void): a product line that ends up credited in full puts its stock
 * back (+returned, once per line), at the site it was sold from. [] when no credited line sold a product.
 */
export async function stockReturnQueries(ctx: RepoContext, tenantId: string, lineIds: string[], actor: PmsActor, at: string): Promise<BatchQuery[]> {
  const sold = await readOrEmpty(STOCK, [] as { id: string; product_id: string; site_id: string; quantity: unknown; invoice_line_id: string | null }[], async () => {
    const out: { id: string; product_id: string; site_id: string; quantity: unknown; invoice_line_id: string | null }[] = [];
    for (const group of chunks(lineIds)) {
      if (group.length === 0) continue;
      out.push(...(await ctx.db.selectFrom(STOCK).select(["id", "product_id", "site_id", "quantity", "invoice_line_id"]).where("tenant_id", "=", tenantId).where("kind", "=", "sold").where("invoice_line_id", "in", group).execute()));
    }
    return out;
  });
  return sold.map((m) =>
    ctx.db
      .insertInto(STOCK)
      .columns(["tenant_id", "id", "product_id", "site_id", "kind", "quantity", "invoice_line_id", "reason_enc", "created_by", "created_at"])
      .expression(
        ctx.db
          .selectFrom("pms_invoice_lines as l")
          .select((eb) => [
            eb.val(tenantId).as("tenant_id"),
            eb.val(pmsId(P.stockMove, ctx)).as("id"),
            eb.val(m.product_id).as("product_id"),
            eb.val(m.site_id).as("site_id"),
            eb.val("returned").as("kind"),
            "l.quantity as quantity",
            "l.id as invoice_line_id",
            sql<string | null>`null`.as("reason_enc"),
            eb.val(actor.userId).as("created_by"),
            eb.val(at).as("created_at"),
          ])
          .where("l.tenant_id", "=", tenantId)
          .where("l.id", "=", m.invoice_line_id as string)
          .where(sql<boolean>`l.credited_pence >= l.total_pence`)
          .where(sql<boolean>`not exists (select 1 from pms_stock_moves r where r.tenant_id = ${tenantId} and r.invoice_line_id = ${m.invoice_line_id} and r.kind = 'returned')`),
      ),
  );
}
