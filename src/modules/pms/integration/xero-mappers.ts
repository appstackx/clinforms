/**
 * Xero sync (xe05): ClinDesk billing records → Xero Accounting API bodies. PURE (unit-tested in xero.test.ts): no
 * database, no network. Each mapper answers either the body to send or the reasons it cannot be sent yet (a missing
 * map = "blocked" until the clinic fixes it – never guessed).
 *
 * Money: ClinDesk keeps pence; Xero takes decimal pounds. Every line carries its stored VAT as TaxAmount, so Xero's
 * totals match ClinDesk's to the penny. Descriptions are the service name and date only – never a line's free text,
 * a diagnosis or a note.
 */
import { XERO_SINGLE_KEY, paymentMapKey, type XeroMapKind } from "./xero";

/** The clinic's maps: kind → local key → { value, label }. */
export type XeroMaps = Readonly<Partial<Record<XeroMapKind, Readonly<Record<string, { value: string; label: string | null }>>>>>;

export function mapValue(maps: XeroMaps, kind: XeroMapKind, key: string = XERO_SINGLE_KEY): string | null {
  return maps[kind]?.[key]?.value ?? null;
}

/** Pence → Xero's decimal amount (2 places, as a number). */
export function pounds(pence: number): number {
  if (!Number.isInteger(pence)) throw new Error("Amounts must be whole pence.");
  return Math.round(pence) / 100;
}

export interface XeroLineSource {
  id: string;
  kind: "service" | "item" | "excess" | "excess_deduction" | string;
  serviceId: string | null;
  /** The service's name (the line's description in Xero). */
  serviceName: string | null;
  serviceOn: string | null;
  visitStatus: string | null;
  quantity: number;
  unitPricePence: number;
  discountPence: number;
  vatCode: string;
  netPence: number;
  vatPence: number;
  totalPence: number;
}

export interface XeroInvoiceSource {
  id: string;
  number: string;
  issuedOn: string;
  dueOn: string | null;
  pricesIncludeVat: boolean;
  vatRegistered: boolean;
  siteId: string | null;
  /** Authorisation number if there is one, else the patient number ("P1234"). */
  reference: string;
  totalPence: number;
  lines: readonly XeroLineSource[];
}

export interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  DiscountAmount?: number;
  LineAmount: number;
  AccountCode: string;
  TaxType: string;
  TaxAmount: number;
  Tracking?: { TrackingCategoryID: string; TrackingOptionID: string; Name?: string; Option?: string }[];
}

export type MapResult<T> = { ok: true; body: T } | { ok: false; missing: string[] };

const LINE_LABELS: Record<string, string> = { item: "Item", excess: "Insurance excess", excess_deduction: "Excess deduction" };
const VISIT_LABELS: Record<string, string> = { did_not_attend: "Missed appointment", late_cancellation: "Late cancellation" };
/** Visit outcomes charged as a missed or late-cancelled appointment (the optional DNA / late account). */
export function isMissedVisit(visitStatus: string | null): boolean {
  return visitStatus === "did_not_attend" || visitStatus === "late_cancellation";
}

function ukDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** What a line says in Xero: the service (or line kind), the visit outcome and the date. Never the line's own text. */
export function lineDescription(line: Pick<XeroLineSource, "kind" | "serviceName" | "serviceOn" | "visitStatus">): string {
  const what = line.kind === "service" ? (line.serviceName ?? "Treatment") : (LINE_LABELS[line.kind] ?? "Item");
  const visit = line.visitStatus ? VISIT_LABELS[line.visitStatus] ?? null : null;
  const on = ukDate(line.serviceOn);
  return [what, visit ? `(${visit})` : null, on ? `– ${on}` : null].filter(Boolean).join(" ").slice(0, 4000);
}

/** The revenue account of a line: service override → DNA/late account → item account → the default. */
export function lineAccount(maps: XeroMaps, line: Pick<XeroLineSource, "kind" | "serviceId" | "visitStatus">): string | null {
  if (isMissedVisit(line.visitStatus) && mapValue(maps, "visit_account")) return mapValue(maps, "visit_account");
  if (line.kind === "service" && line.serviceId && mapValue(maps, "service_account", line.serviceId)) return mapValue(maps, "service_account", line.serviceId);
  if (line.kind === "item" && mapValue(maps, "item_account")) return mapValue(maps, "item_account");
  return mapValue(maps, "default_account");
}

/** The Xero tax type of a line: NONE for a no-VAT line or invoice, else the clinic's map for its VAT code. */
export function lineTaxType(maps: XeroMaps, vatCode: string, vatRegistered: boolean): string | null {
  if (!vatRegistered || vatCode === "none") return "NONE";
  return mapValue(maps, "tax_type", vatCode);
}

/**
 * Whether an invoice was issued as VAT-registered – from ITS OWN lines (frozen when issued), never from today's
 * setting: a clinic that registers for VAT later must not change how its earlier invoices are sent.
 */
export function invoiceUsesVat(lines: readonly Pick<XeroLineSource, "vatCode">[]): boolean {
  return lines.some((l) => l.vatCode !== "none");
}

export function lineAmountTypes(vatRegistered: boolean, pricesIncludeVat: boolean): "Inclusive" | "Exclusive" | "NoTax" {
  if (!vatRegistered) return "NoTax";
  return pricesIncludeVat ? "Inclusive" : "Exclusive";
}

function tracking(maps: XeroMaps, siteId: string | null): XeroLineItem["Tracking"] {
  if (!siteId) return undefined;
  const m = maps.tracking?.[siteId];
  if (!m) return undefined;
  const [cat, opt] = m.value.split("|");
  if (!cat || !opt) return undefined;
  const [name, option] = (m.label ?? "").split(": ");
  return [{ TrackingCategoryID: cat, TrackingOptionID: opt, ...(name && option ? { Name: name, Option: option } : {}) }];
}

/**
 * One line's amounts. Inclusive prices: LineAmount = the line's total; exclusive (and no tax): its net. Quantity ×
 * unit − discount is used when it gives exactly that amount (it does for every line ClinDesk prices itself);
 * otherwise the line goes as quantity 1 at its amount, so the total never drifts.
 */
export function lineAmounts(line: Pick<XeroLineSource, "quantity" | "unitPricePence" | "discountPence" | "netPence" | "vatPence" | "totalPence">, inclusive: boolean, vatRegistered: boolean) {
  const amountPence = vatRegistered && inclusive ? line.totalPence : line.netPence;
  const exact = Number.isInteger(line.quantity) && line.quantity > 0 && line.unitPricePence * line.quantity - (line.discountPence ?? 0) === amountPence;
  return {
    Quantity: exact ? line.quantity : 1,
    UnitAmount: pounds(exact ? line.unitPricePence : amountPence),
    ...(exact && line.discountPence ? { DiscountAmount: pounds(line.discountPence) } : {}),
    LineAmount: pounds(amountPence),
    TaxAmount: vatRegistered ? pounds(line.vatPence) : 0,
  };
}

export interface XeroInvoiceBody {
  Type: "ACCREC";
  Status: "AUTHORISED";
  Contact: { ContactID: string };
  InvoiceNumber: string;
  Reference: string;
  Date: string;
  DueDate: string;
  LineAmountTypes: "Inclusive" | "Exclusive" | "NoTax";
  LineItems: XeroLineItem[];
}

/** An issued invoice → Xero invoice (AUTHORISED, ClinDesk's number). */
export function invoiceToXero(inv: XeroInvoiceSource, contactId: string, maps: XeroMaps): MapResult<XeroInvoiceBody> {
  const missing = new Set<string>();
  if (inv.lines.length === 0) missing.add("an invoice with at least one line");
  const items: XeroLineItem[] = inv.lines.map((l) => {
    const account = lineAccount(maps, l);
    const tax = lineTaxType(maps, l.vatCode, inv.vatRegistered);
    if (!account) missing.add("the default sales account");
    if (!tax) missing.add(`a Xero tax rate for VAT code ${l.vatCode}`);
    const t = tracking(maps, inv.siteId);
    return { Description: lineDescription(l), ...lineAmounts(l, inv.pricesIncludeVat, inv.vatRegistered), AccountCode: account ?? "", TaxType: tax ?? "", ...(t ? { Tracking: t } : {}) };
  });
  if (missing.size) return { ok: false, missing: Array.from(missing) };
  return {
    ok: true,
    body: {
      Type: "ACCREC",
      Status: "AUTHORISED",
      Contact: { ContactID: contactId },
      InvoiceNumber: inv.number,
      Reference: inv.reference.slice(0, 255),
      Date: inv.issuedOn,
      DueDate: inv.dueOn ?? inv.issuedOn,
      LineAmountTypes: lineAmountTypes(inv.vatRegistered, inv.pricesIncludeVat),
      LineItems: items,
    },
  };
}

export interface XeroCreditNoteSource {
  id: string;
  number: string;
  kind: "credit" | "write_off" | "void" | "transfer" | string;
  issuedOn: string;
  totalPence: number;
  invoice: Pick<XeroInvoiceSource, "number" | "pricesIncludeVat" | "vatRegistered" | "siteId">;
  /** The credited lines, each with the invoice line it credits. */
  lines: readonly { netPence: number; vatPence: number; totalPence: number; invoiceLine: XeroLineSource }[];
}

export interface XeroCreditNoteBody {
  Type: "ACCRECCREDIT";
  Status: "AUTHORISED";
  Contact: { ContactID: string };
  CreditNoteNumber: string;
  Reference: string;
  Date: string;
  LineAmountTypes: "Inclusive" | "Exclusive" | "NoTax";
  LineItems: XeroLineItem[];
}

const CREDIT_WORDS: Record<string, string> = { credit: "Credit", write_off: "Written off", void: "Invoice voided", transfer: "Moved to another payer" };

/** A credit note → Xero credit note. Write-offs go to the write-off account; the rest to the credited lines' accounts. */
export function creditNoteToXero(cn: XeroCreditNoteSource, contactId: string, maps: XeroMaps): MapResult<XeroCreditNoteBody> {
  const missing = new Set<string>();
  const writeOff = cn.kind === "write_off" ? mapValue(maps, "write_off_account") : null;
  if (cn.kind === "write_off" && !writeOff) missing.add("the write-off account");
  if (cn.lines.length === 0) missing.add("a credit note with at least one line");
  const inclusive = cn.invoice.pricesIncludeVat;
  const vat = cn.invoice.vatRegistered;
  const items: XeroLineItem[] = cn.lines.map((l) => {
    const account = writeOff ?? lineAccount(maps, l.invoiceLine);
    const tax = lineTaxType(maps, l.invoiceLine.vatCode, vat);
    if (!account) missing.add("the default sales account");
    if (!tax) missing.add(`a Xero tax rate for VAT code ${l.invoiceLine.vatCode}`);
    const amount = vat && inclusive ? l.totalPence : l.netPence;
    const t = tracking(maps, cn.invoice.siteId);
    return {
      Description: `${CREDIT_WORDS[cn.kind] ?? "Credit"}: ${lineDescription(l.invoiceLine)}`.slice(0, 4000),
      Quantity: 1,
      UnitAmount: pounds(amount),
      LineAmount: pounds(amount),
      AccountCode: account ?? "",
      TaxType: tax ?? "",
      TaxAmount: vat ? pounds(l.vatPence) : 0,
      ...(t ? { Tracking: t } : {}),
    };
  });
  if (missing.size) return { ok: false, missing: Array.from(missing) };
  return {
    ok: true,
    body: {
      Type: "ACCRECCREDIT",
      Status: "AUTHORISED",
      Contact: { ContactID: contactId },
      CreditNoteNumber: cn.number,
      Reference: `Credit for ${cn.invoice.number}`.slice(0, 255),
      Date: cn.issuedOn,
      LineAmountTypes: lineAmountTypes(vat, inclusive),
      LineItems: items,
    },
  };
}

export interface XeroAllocationSource {
  id: string;
  /** Unique marker put in the payment's Reference, so a payment whose answer was lost is found on the invoice. */
  marker: string;
  amountPence: number;
  receivedOn: string;
  method: string;
  siteId: string | null;
  reference: string | null;
}

export interface XeroPaymentBody {
  Invoice: { InvoiceID: string };
  Account: { Code: string };
  Date: string;
  Amount: number;
  Reference: string;
}

/** "CD-A" + the last 10 characters of the allocation id (random part of its ULID): unique on one invoice. */
export function paymentMarker(allocationId: string): string {
  return `CD-A${allocationId.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase()}`;
}

/** The account a payment method is paid into: the site's own map first, then the method's. */
export function paymentAccount(maps: XeroMaps, method: string, siteId: string | null): string | null {
  return (siteId ? mapValue(maps, "payment_account", paymentMapKey(method, siteId)) : null) ?? mapValue(maps, "payment_account", method);
}

/** One positive allocation of a payment to an invoice → one Xero payment against that invoice. */
export function allocationToXero(a: XeroAllocationSource, xeroInvoiceId: string, maps: XeroMaps, methodLabel: string): MapResult<XeroPaymentBody> {
  if (a.amountPence <= 0) return { ok: false, missing: ["a payment (refunds are not sent to Xero yet)"] };
  const code = paymentAccount(maps, a.method, a.siteId);
  if (!code) return { ok: false, missing: [`the account ${methodLabel} payments are paid into`] };
  return {
    ok: true,
    body: {
      Invoice: { InvoiceID: xeroInvoiceId },
      Account: { Code: code },
      Date: a.receivedOn,
      Amount: pounds(a.amountPence),
      Reference: [a.reference ? a.reference.replace(/[\r\n]+/g, " ").slice(0, 200) : null, a.marker].filter(Boolean).join(" "),
    },
  };
}

export interface XeroContactSource {
  kind: "patient" | "referrer";
  /** patient number (patients) or the referrer's id (payers). */
  key: string;
  name: string;
  email: string | null;
  address: { lines: string[]; postcode: string | null } | null;
}

export interface XeroContactBody {
  Name: string;
  ContactNumber: string;
  EmailAddress?: string;
  Addresses?: { AddressType: "POBOX"; AddressLine1?: string; AddressLine2?: string; City?: string; PostalCode?: string }[];
}

/** "CD-P1234" for patient 1234; "CD-R<last 12 of the id>" for a payer account. */
export function contactNumberFor(kind: "patient" | "referrer", key: string): string {
  if (kind === "patient") return `CD-P${key}`;
  return `CD-R${key.replace(/[^A-Za-z0-9]/g, "").slice(-12).toUpperCase()}`;
}

/** A contact. Patients are named "First Last (P1234)" (unique in Xero); details only when the clinic ticked them. */
export function contactToXero(c: XeroContactSource, withDetails: boolean): XeroContactBody {
  const name = (c.kind === "patient" ? `${c.name} (P${c.key})` : c.name).replace(/\s+/g, " ").trim().slice(0, 255);
  const body: XeroContactBody = { Name: name, ContactNumber: contactNumberFor(c.kind, c.key) };
  if (withDetails && c.email) body.EmailAddress = c.email.slice(0, 255);
  if (withDetails && c.address) {
    body.Addresses = [
      {
        AddressType: "POBOX",
        ...(c.address.lines[0] ? { AddressLine1: c.address.lines[0].slice(0, 500) } : {}),
        ...(c.address.lines[1] ? { AddressLine2: c.address.lines[1].slice(0, 500) } : {}),
        ...(c.address.lines.length > 2 ? { City: c.address.lines[c.address.lines.length - 1].slice(0, 255) } : {}),
        ...(c.address.postcode ? { PostalCode: c.address.postcode.slice(0, 50) } : {}),
      },
    ];
  }
  return body;
}
