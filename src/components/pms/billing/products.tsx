"use client";
/**
 * Products and stock (PK05): Set-up → Products (name, SKU, price, VAT, low-stock level, on sale or not), Billing →
 * Stock (per site: on hand, value, low-stock flag, receive stock, adjust with a reason, the latest moves) and the
 * patient's Invoices tab (Sell a product). The server checks every action again.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordStockChangeAction, sellProductAction } from "@/app/app/clinic/billing/actions";
import { saveProductAction } from "@/app/app/clinic/setup/actions";
import type { Product, ProductsScreen, StockScreen } from "@/modules/pms/billing/products";
import { formatPence } from "@/modules/pms/core/text";
import { cn } from "@/lib/utils";
import { FormField, PmsButton, PmsNotice, SelectInput, Switch, TextInput, useToast } from "@/components/pms/ui";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";
import { SetupCard, SetupError, SetupFormBar, SetupGrid, SetupHeader, SetupPage, setupFocus, useSetupForm } from "@/components/pms/reporting/setup-kit";
import { BILLING_PATH, date, focusRing, money } from "./format";

const BASE = "/app/clinic/setup";
const VAT_LABELS: Record<string, string> = { standard: "Standard rate", reduced: "Reduced rate", zero: "Zero rate", exempt: "Exempt" };

/* ------------------------------------------------------------------------------------------------
 * Set-up → Products
 * ----------------------------------------------------------------------------------------------*/

export function ProductsSetup({ screen, productId }: { screen: ProductsScreen; productId: string | null }) {
  const router = useRouter();
  const chosen = productId === "new" ? null : (screen.products.find((p) => p.id === productId) ?? null);
  const showForm = screen.canEdit && (productId === "new" || chosen !== null);
  return (
    <SetupPage>
      <SetupHeader
        title="Products"
        description="What the clinic sells over the counter – supports, tape, exercise bands. Stock is kept per site under Billing → Stock."
        action={
          screen.canEdit ? (
            <Link href={`${BASE}/products?product=new`} scroll={false} data-testid="add-product" className={`inline-flex h-9 items-center rounded-[8px] bg-primary-strong px-3.5 text-sm font-medium text-white hover:bg-[#095E57] ${setupFocus}`}>
              Add product
            </Link>
          ) : null
        }
      />
      {!screen.canEdit ? <p className="text-sm text-[#475569]">Only an owner, or an administrator who works at every site, can change these.</p> : null}
      {showForm ? <ProductForm key={chosen?.id ?? "new"} product={chosen} vatRegistered={screen.vatRegistered} onDone={() => router.push(`${BASE}/products`)} /> : null}
      {screen.products.length === 0 ? (
        <PmsNotice tone="info" title="No products yet">
          Add a product with its price; then receive its stock at each site under Billing → Stock.
        </PmsNotice>
      ) : (
        <ScrollRegion label="Products" className="relative overflow-x-auto rounded-2xl border border-border bg-white">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">Products</caption>
            <thead>
              <tr className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#475569]">
                <th scope="col" className="px-4 py-2.5">Product</th>
                <th scope="col" className="px-4 py-2.5">SKU</th>
                <th scope="col" className="px-4 py-2.5 text-right">Price</th>
                <th scope="col" className="px-4 py-2.5 text-right">Low stock at</th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {screen.products.map((p) => (
                <tr key={p.id} className="border-t border-[#F1F5F9]" data-testid="product-row">
                  <td className="px-4 py-2.5 font-medium">{p.active ? p.name : `${p.name} (switched off)`}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{p.sku ?? "–"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPence(p.pricePence)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{p.lowStockAt ?? "–"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {screen.canEdit ? (
                      <Link href={`${BASE}/products?product=${p.id}`} scroll={false} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                        Change<span className="sr-only"> {p.name}</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </SetupPage>
  );
}

function ProductForm({ product, vatRegistered, onDone }: { product: Product | null; vatRegistered: boolean; onDone: () => void }) {
  const f = useSetupForm({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    price: product ? (product.pricePence / 100).toFixed(2) : "",
    vatCode: product?.vatCode ?? "standard",
    lowStockAt: product?.lowStockAt === null || product?.lowStockAt === undefined ? "" : String(product.lowStockAt),
    active: product?.active ?? true,
  });
  const e = f.fieldErrors;
  return (
    <SetupCard title={product ? product.name : "New product"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void f.submit(() => saveProductAction({ productId: product?.id ?? null, rev: product?.rev, ...f.values }), product ? "Product saved." : `${f.values.name} added.`, onDone);
        }}
        data-testid="product-form"
      >
        <SetupGrid>
          <FormField id="product-name" label="Name" required error={e.name}>
            <TextInput value={f.values.name} onChange={(ev) => f.set("name", ev.target.value)} maxLength={120} data-testid="product-name" />
          </FormField>
          <FormField id="product-sku" label="SKU (optional)" error={e.sku}>
            <TextInput value={f.values.sku} onChange={(ev) => f.set("sku", ev.target.value)} maxLength={40} autoComplete="off" />
          </FormField>
          <FormField id="product-price" label="Price (£)" required error={e.pricePence}>
            <TextInput inputMode="decimal" value={f.values.price} onChange={(ev) => f.set("price", ev.target.value)} data-testid="product-price" />
          </FormField>
          <FormField id="product-low" label="Warn when stock is at or below" hint="Leave empty for no warning." error={e.lowStockAt}>
            <TextInput inputMode="numeric" value={f.values.lowStockAt} onChange={(ev) => f.set("lowStockAt", ev.target.value)} />
          </FormField>
          {vatRegistered ? (
            <FormField id="product-vat" label="VAT" error={e.vatCode}>
              <SelectInput value={f.values.vatCode} onChange={(ev) => f.set("vatCode", ev.target.value as typeof f.values.vatCode)}>
                {Object.entries(VAT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          ) : null}
        </SetupGrid>
        {product ? <Switch id="product-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "On sale" : "Switched off (not on sale)"} /> : null}
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !product} saving={f.saving} onDiscard={product ? f.discard : onDone} discardable saveLabel={product ? "Save" : "Add product"} testId="product-save" />
      </form>
    </SetupCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Billing → Stock
 * ----------------------------------------------------------------------------------------------*/

export function StockView({ screen }: { screen: StockScreen }) {
  const router = useRouter();
  const toast = useToast();
  const [productId, setProductId] = React.useState(screen.rows[0]?.productId ?? "");
  const [kind, setKind] = React.useState<"received" | "adjusted">("received");
  const [quantity, setQuantity] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const totalValue = screen.rows.reduce((a, r) => a + r.valuePence, 0);
  const site = screen.sites.find((s) => s.id === screen.siteId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!screen.siteId) return;
    const n = /^\s*-?\d+\s*$/.test(quantity) ? Number(quantity.trim()) : Number.NaN;
    if (!Number.isFinite(n) || n === 0) return setError("Enter how many (an adjustment can be negative, e.g. -2).");
    setBusy(true);
    setError(null);
    const r = await recordStockChangeAction({ productId, siteId: screen.siteId, kind, quantity: n, reason: reason.trim() || null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(kind === "received" ? `${n} received` : `Stock adjusted by ${n}`);
    setQuantity("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Billing
        </Link>
        <span aria-hidden> / </span>
        <span>Stock</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Stock</h1>
          <p className="text-sm text-[#475569]">
            Products on hand at {site?.name ?? "this site"} – worth <strong className="text-foreground">{money(totalValue)}</strong> at their prices. Selling a product on an issued invoice takes it off; crediting the line in full puts it back.
          </p>
        </div>
        {screen.sites.length > 1 ? (
          <FormField id="stock-site" label="Site">
            <SelectInput value={screen.siteId ?? ""} onChange={(e) => router.push(`${BILLING_PATH}/stock?site=${e.target.value}`)} data-testid="stock-site">
              {screen.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
        ) : null}
      </div>
      {!screen.siteId ? <p className="text-sm text-[#475569]">Add a site under Set-up → Sites and hours first.</p> : null}
      {screen.rows.length === 0 && screen.siteId ? (
        <PmsNotice tone="info" title="No products yet">
          Add products under Set-up → Products, then receive their stock here.
        </PmsNotice>
      ) : null}
      {screen.rows.length > 0 ? (
        <ScrollRegion label="Stock on hand" className="relative overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[560px] text-sm" data-testid="stock-table">
            <caption className="sr-only">Stock on hand</caption>
            <thead className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
              <tr>
                <th scope="col" className="px-4 py-2">Product</th>
                <th scope="col" className="px-3 py-2 text-right">On hand</th>
                <th scope="col" className="px-3 py-2 text-right">Price</th>
                <th scope="col" className="px-4 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {screen.rows.map((r) => (
                <tr key={r.productId} className="border-t border-border" data-testid="stock-row">
                  <td className="px-4 py-2.5 font-medium">
                    {r.active ? r.name : `${r.name} (switched off)`}
                    {r.sku ? <span className="ml-2 font-mono text-xs text-[#475569]">{r.sku}</span> : null}
                  </td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", r.low && "font-semibold text-destructive-strong")}>
                    {r.onHand}
                    {r.low ? <span className="ml-1 text-xs">(low)</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.pricePence)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(r.valuePence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : null}
      {screen.canChange && screen.rows.length > 0 && screen.siteId ? (
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="stock-change-form">
          <h2 className="text-base font-semibold">Receive or adjust stock</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <FormField id="stock-product" label="Product">
              <SelectInput value={productId} onChange={(e) => setProductId(e.target.value)}>
                {screen.rows.map((r) => (
                  <option key={r.productId} value={r.productId}>
                    {r.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="stock-kind" label="What happened">
              <SelectInput value={kind} onChange={(e) => setKind(e.target.value as "received" | "adjusted")}>
                <option value="received">Stock received</option>
                <option value="adjusted">Adjust (count, damaged, out of date)</option>
              </SelectInput>
            </FormField>
            <FormField id="stock-qty" label="How many" hint={kind === "adjusted" ? "Negative to take off, e.g. -2." : undefined}>
              <TextInput inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="stock-qty" />
            </FormField>
            <FormField id="stock-reason" label={kind === "adjusted" ? "Reason" : "Note (optional)"} required={kind === "adjusted"}>
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            </FormField>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive-strong">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <PmsButton type="submit" loading={busy} data-testid="stock-save">
              Save
            </PmsButton>
          </div>
        </form>
      ) : null}
      {screen.moves.length > 0 ? (
        <section aria-labelledby="moves-heading" className="flex flex-col gap-2">
          <h2 id="moves-heading" className="text-base font-semibold">
            Latest changes
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-white text-sm">
            {screen.moves.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="tabular-nums">{date(m.createdAt.slice(0, 10))}</span>
                <span className="font-medium">{m.productName}</span>
                <span className="text-[#475569]">{m.label}</span>
                <span className="ml-auto tabular-nums">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The patient's Invoices tab: Sell a product
 * ----------------------------------------------------------------------------------------------*/

export function SellProduct({ patientId, products, sites, siteRequired }: { patientId: string; products: { id: string; name: string; pricePence: number }[]; sites: { id: string; name: string }[]; siteRequired: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [productId, setProductId] = React.useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = React.useState("1");
  const [siteId, setSiteId] = React.useState(sites.length === 1 ? sites[0].id : "");
  const [busy, setBusy] = React.useState<"draft" | "issue" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (products.length === 0) return null;

  async function sell(issue: boolean) {
    const n = /^\s*\d+\s*$/.test(quantity) ? Number(quantity) : Number.NaN;
    if (!Number.isFinite(n) || n < 1 || n > 99) return setError("Sell 1 to 99 at a time.");
    setBusy(issue ? "issue" : "draft");
    setError(null);
    const r = await sellProductAction(patientId, { productId, quantity: n, siteId: siteId || null, issue });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    toast.success(r.issued ? `Invoice ${r.number ?? ""} issued – stock taken off`.replace("  ", " ") : "Draft invoice made – stock is taken off when it is issued");
    setOpen(false);
    if (!r.issued) router.push(`${BILLING_PATH}/invoices/${r.invoiceId}`);
    else router.refresh();
  }

  return (
    <section aria-labelledby="products-heading" className="flex flex-col gap-3" data-testid="sell-product-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="products-heading" className="text-lg font-semibold text-foreground">
          Products
        </h2>
        {!open ? (
          <PmsButton variant="secondary" onClick={() => setOpen(true)} data-testid="sell-product">
            Sell a product
          </PmsButton>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="sell-product-form">
          <div className="grid gap-3 md:grid-cols-3">
            <FormField id="sell-product-id" label="Product">
              <SelectInput value={productId} onChange={(e) => setProductId(e.target.value)} data-testid="sell-product-id">
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} – {money(p.pricePence)}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="sell-product-qty" label="Quantity">
              <TextInput inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </FormField>
            <FormField id="sell-product-site" label="Sold from (site)" required hint={siteRequired ? undefined : "Its stock goes down there."}>
              <SelectInput value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {sites.length > 1 ? <option value="">Choose a site</option> : null}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive-strong">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <PmsButton variant="secondary" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </PmsButton>
            <PmsButton variant="secondary" loading={busy === "draft"} onClick={() => void sell(false)}>
              Create draft invoice
            </PmsButton>
            <PmsButton loading={busy === "issue"} onClick={() => void sell(true)} data-testid="sell-product-issue">
              Sell and issue invoice
            </PmsButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
