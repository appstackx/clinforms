/**
 * Products and stock for the screens (PK05). Same rules as the other billing services (./access.ts): the permission
 * first, ids read back from the member's clinic and site scope, inputs validated, plain results.
 *
 *   Set-up → Products                            settings.setup; changes by the owner or an admin with every site
 *   Billing → Stock (on hand, moves per site)    billing.view; receive / adjust: billing.edit at a site in scope
 *   sell a product (patient record → Invoices)   billing.edit (the invoice's site is the stock it comes from)
 */
import "server-only";
import { ProductInputSchema, STOCK_MOVE_LABELS, StockChangeInputSchema, isLowStock, productSaleLine, type ProductVatCode, type ProductsScreen, type StockScreen } from "../../../modules/pms/billing/products";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { createDraftInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { createProduct, getProduct, listProducts, listStockMoves, recordStockChange, stockOnHand, updateProduct } from "../../repos/pms/billing/products";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { listSites } from "../../repos/pms/directory";
import type { SetupActor, SetupResult } from "../reporting/setup";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, type BillingActor, type Result } from "./access";
import { SETUP_FORBIDDEN, SETUP_NOT_FOUND, SETUP_WHOLE, invalidFields, plausibleId, setupAttempt, setupFail, setupOk } from "./healthcode-setup";

/* ------------------------------------------------------------------------------------------------
 * Set-up → Products
 * ----------------------------------------------------------------------------------------------*/

export async function productsScreenFor(actor: SetupActor): Promise<SetupResult<ProductsScreen>> {
  if (!actor.can("settings.setup")) return SETUP_FORBIDDEN;
  return setupAttempt("setup.products", async () => {
    const ctx = actor.repo();
    const [products, settings] = await Promise.all([listProducts(ctx, actor.tenantId, { includeArchived: true }), getBillingSettings(ctx, actor.tenantId)]);
    return setupOk({ products, vatRegistered: settings.vatRegistered, canEdit: actor.siteIds === null });
  });
}

export interface ProductFields {
  productId?: string | null;
  rev?: number;
  name?: string;
  sku?: string;
  price?: string;
  vatCode?: string;
  /** "" = no warning. */
  lowStockAt?: string;
  active?: boolean;
}

function poundsToPence(value: unknown): number {
  const v = String(value ?? "")
    .trim()
    .replace(/^£/, "")
    .replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [pounds, pence = ""] = v.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

export async function saveProductFor(actor: SetupActor, f: ProductFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return SETUP_FORBIDDEN;
  if (actor.siteIds !== null) return SETUP_WHOLE;
  const input = {
    name: typeof f.name === "string" ? f.name : "",
    sku: typeof f.sku === "string" ? f.sku : null,
    pricePence: poundsToPence(f.price),
    vatCode: (f.vatCode === "exempt" || f.vatCode === "reduced" || f.vatCode === "zero" ? f.vatCode : "standard") as ProductVatCode,
    lowStockAt: f.lowStockAt === undefined || f.lowStockAt === null || String(f.lowStockAt).trim() === "" ? null : /^\s*\d+\s*$/.test(String(f.lowStockAt ?? "")) ? Number(String(f.lowStockAt).trim()) : Number.NaN,
    active: f.active !== false,
  };
  const parsed = ProductInputSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);
  return setupAttempt("setup.product_save", async () => {
    const ctx = actor.repo();
    if (f.productId) {
      if (!plausibleId(f.productId)) return SETUP_NOT_FOUND;
      const current = await getProduct(ctx, actor.tenantId, f.productId);
      if (!current) return SETUP_NOT_FOUND;
      const r = await updateProduct(ctx, actor.tenantId, current.id, typeof f.rev === "number" ? f.rev : current.rev, input, actor.actor);
      if (!r.ok) return r.reason === "conflict" ? setupFail("Someone else changed this product in the meantime. Reload the page and try again.") : SETUP_NOT_FOUND;
      return setupOk({ id: current.id });
    }
    return setupOk({ id: (await createProduct(ctx, actor.tenantId, input, actor.actor)).id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Billing → Stock
 * ----------------------------------------------------------------------------------------------*/

export async function stockScreenFor(actor: BillingActor, siteId: string | null): Promise<Result<StockScreen>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.stock", async (): Promise<Result<StockScreen>> => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const scope = actor.siteIds ?? null;
    const sites = (await listSites(ctx, t)).filter((s) => scope === null || scope.has(s.id)).map((s) => ({ id: s.id, name: s.name }));
    const site = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;
    if (!site) return ok({ sites, siteId: null, rows: [], moves: [], canChange: false });
    const [products, onHand, moves] = await Promise.all([listProducts(ctx, t, { includeArchived: true }), stockOnHand(ctx, t, site.id), listStockMoves(ctx, t, site.id, { limit: 50 })]);
    const names = new Map(products.map((p) => [p.id, p.name]));
    const rows = products
      .filter((p) => p.active || (onHand.get(p.id) ?? 0) !== 0)
      .map((p) => {
        const n = onHand.get(p.id) ?? 0;
        return { productId: p.id, name: p.name, sku: p.sku, active: p.active, onHand: n, low: isLowStock(n, p.lowStockAt), pricePence: p.pricePence, valuePence: Math.max(0, n) * p.pricePence };
      });
    return ok({
      sites,
      siteId: site.id,
      rows,
      moves: moves.map((m) => ({ ...m, productName: names.get(m.productId) ?? "Product", label: STOCK_MOVE_LABELS[m.kind] })),
      canChange: actor.can("billing.edit"),
    });
  });
}

export async function recordStockChangeFor(actor: BillingActor, f: { productId: string; siteId: string; kind: "received" | "adjusted"; quantity: number; reason?: string | null }): Promise<Result<{ id: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  const parsed = StockChangeInputSchema.safeParse({ ...f, reason: typeof f.reason === "string" && f.reason.trim() ? f.reason.trim() : null });
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the stock change.");
  return attempt("billing.stock_change", async () => {
    const scope = actor.siteIds ?? null;
    const site = (await listSites(actor.repo(), actor.tenantId)).find((s) => s.id === parsed.data.siteId);
    if (!site || (scope !== null && !scope.has(site.id))) return fail("invalid", "Choose one of your sites.");
    const product = await getProduct(actor.repo(), actor.tenantId, parsed.data.productId);
    if (!product) return fail("not_found", "That product no longer exists in this clinic.");
    const m = await recordStockChange(actor.repo(), actor.tenantId, parsed.data, actor.actor);
    return ok({ id: m.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Selling a product to a patient
 * ----------------------------------------------------------------------------------------------*/

export async function productsForSaleFor(actor: BillingActor): Promise<Result<{ id: string; name: string; pricePence: number }[]>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt("billing.products_for_sale", async () => ok((await listProducts(actor.repo(), actor.tenantId)).map((p) => ({ id: p.id, name: p.name, pricePence: p.pricePence }))));
}

export async function sellProductFor(actor: BillingActor, patientId: string, f: { productId: string; quantity: number; siteId?: string | null; issue?: boolean }): Promise<Result<{ invoiceId: string; number: string | null; issued: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  return attempt("billing.sell_product", async (): Promise<Result<{ invoiceId: string; number: string | null; issued: boolean }>> => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    if (!isPlausibleRecordId(f.productId)) return fail("invalid", "Choose the product.");
    const product = await getProduct(ctx, t, f.productId);
    if (!product || !product.active) return fail("invalid", "That product is not on sale. Choose another.");
    const quantity = Math.floor(Number(f.quantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) return fail("invalid", "Sell 1 to 99 at a time.");
    const scope = actor.siteIds ?? null;
    let siteId: string | null = f.siteId && isPlausibleRecordId(f.siteId) ? f.siteId : null;
    if (siteId === null && scope !== null && scope.size === 1) siteId = Array.from(scope)[0];
    if (siteId === null) {
      const sites = await listSites(ctx, t);
      if (sites.length === 1 && scope === null) siteId = sites[0].id;
    }
    if (siteId === null) return fail("invalid", "Choose the site the product is sold from (its stock goes down there).");
    if (scope !== null && !scope.has(siteId)) return fail("invalid", "Choose one of your sites.");
    const { invoice } = await createDraftInvoice(ctx, t, { patientId: patient.id, siteId, billTo: "patient", lines: [productSaleLine(product, quantity)] }, actor.actor, {
      lineRefs: [{ lineIndex: 0, refType: "product", refId: product.id }],
    });
    if (!f.issue) return ok({ invoiceId: invoice.id, number: null, issued: false });
    const r = await issueInvoice(ctx, t, invoice.id, invoice.rev, {}, actor.actor);
    if (!r.ok) return fail("invalid", "The invoice could not be issued. It is kept as a draft: issue it from the invoice page.");
    return ok({ invoiceId: invoice.id, number: r.invoice.number, issued: true });
  });
}
