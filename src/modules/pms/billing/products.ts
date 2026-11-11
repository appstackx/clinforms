/**
 * Products and stock (PK05, docs/clinic-system/courses-giftcards-products.md). Pure, browser-safe: types, inputs,
 * labels and the screens' types.
 *
 * - A product (Set-up → Products): name, optional SKU, price in pence, VAT code, a low-stock threshold, on sale or not.
 * - Stock is kept per site as append-only moves: +received, −sold, +returned, ±adjusted (with a reason). On hand = the
 *   sum of the moves – no counter to drift.
 * - Selling: an ordinary `item` line (quantity 1–99) referenced to the product; the −sold move is written when the
 *   invoice is ISSUED, at the invoice's site; crediting that line in full writes it back (+returned).
 */
import { z } from "zod";
import { PmsIdSchema } from "../core/schemas";
import type { VatCode } from "./vat";

export const STOCK_MOVE_KINDS = ["received", "sold", "returned", "adjusted"] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

export const PRODUCT_VAT_CODES = ["exempt", "standard", "reduced", "zero"] as const;
export type ProductVatCode = (typeof PRODUCT_VAT_CODES)[number];

export interface Product {
  id: string;
  rev: number;
  name: string;
  sku: string | null;
  pricePence: number;
  vatCode: ProductVatCode;
  /** Warn when on hand at a site is at or below this (null = no warning). */
  lowStockAt: number | null;
  active: boolean;
  updatedAt: string;
}

export interface StockMove {
  id: string;
  productId: string;
  siteId: string;
  kind: StockMoveKind;
  quantity: number;
  invoiceLineId: string | null;
  createdAt: string;
}

export const ProductInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "At most 120 characters"),
  sku: z
    .union([z.string().trim().max(40, "At most 40 characters").regex(/^[A-Za-z0-9._-]*$/, "Letters, digits, '.', '-' and '_'"), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" && v === "" ? null : v)),
  pricePence: z.number({ error: "Enter the price" }).int("Whole pence only").min(0, "A price cannot be negative").max(100_000_000),
  vatCode: z.enum(PRODUCT_VAT_CODES).optional(),
  lowStockAt: z.union([z.number().int("Whole numbers only").min(0).max(100_000), z.null()]).optional(),
  active: z.boolean().optional(),
});
export type ProductInput = z.input<typeof ProductInputSchema>;

export const StockChangeInputSchema = z
  .object({
    productId: PmsIdSchema,
    siteId: PmsIdSchema,
    kind: z.enum(["received", "adjusted"]),
    quantity: z.number({ error: "Enter how many" }).int("Whole numbers only").min(-100_000).max(100_000),
    /** Why (adjustments: count, breakage, out of date…). Encrypted. */
    reason: z.union([z.string().trim().max(200, "At most 200 characters"), z.null()]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.quantity === 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter how many" });
    if (v.kind === "received" && v.quantity < 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Stock received is a positive number" });
    if (v.kind === "adjusted" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Say why the stock is adjusted" });
  });
export type StockChangeInput = z.input<typeof StockChangeInputSchema>;

export const STOCK_MOVE_LABELS: Readonly<Record<StockMoveKind, string>> = {
  received: "Received",
  sold: "Sold",
  returned: "Returned (credited)",
  adjusted: "Adjusted",
};

/** The invoice line that sells a product (an ordinary item line). */
export function productSaleLine(p: Pick<Product, "name" | "pricePence" | "vatCode" | "sku">, quantity: number): { kind: "item"; description: string; quantity: number; unitPricePence: number; vatCode: VatCode; billingCode: string | null } {
  return { kind: "item", description: p.name.slice(0, 200), quantity, unitPricePence: p.pricePence, vatCode: p.vatCode, billingCode: null };
}

/** Whether on hand is at or below the product's low-stock level. */
export function isLowStock(onHand: number, lowStockAt: number | null): boolean {
  return lowStockAt !== null && onHand <= lowStockAt;
}

/* ------------------------------------------------------------------------------------------------
 * What the screens receive
 * ----------------------------------------------------------------------------------------------*/

export interface ProductsScreen {
  products: Product[];
  vatRegistered: boolean;
  canEdit: boolean;
}

export interface StockRowView {
  productId: string;
  name: string;
  sku: string | null;
  active: boolean;
  onHand: number;
  low: boolean;
  pricePence: number;
  /** On hand × price (pence). */
  valuePence: number;
}

export interface StockScreen {
  sites: { id: string; name: string }[];
  siteId: string | null;
  rows: StockRowView[];
  /** The site's latest moves, newest first. */
  moves: (StockMove & { productName: string; label: string })[];
  canChange: boolean;
}
