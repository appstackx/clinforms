/**
 * Xero sync (xe06) – the pure rules and the mappers: the switch, back-off, Idempotency-Key, message redaction, and
 * ClinDesk invoice / credit note / payment / contact → Xero bodies (VAT inclusive, exclusive and none, discounts,
 * excess deductions, every credit-note kind, missing maps, penny totals). Run by `npm run test:pms` and `test:db`.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  XERO_BACKOFF_SECONDS,
  XERO_MAX_ATTEMPTS,
  XERO_SCOPES,
  idempotencyKeyFor,
  nextAttemptDelaySeconds,
  paymentMapKey,
  redactXeroMessage,
  syncItemId,
  syncOrder,
  validXeroValue,
  xeroSwitchOn,
} from "./xero";
import {
  allocationToXero,
  contactNumberFor,
  contactToXero,
  creditNoteToXero,
  invoiceToXero,
  lineAccount,
  lineDescription,
  pounds,
  type XeroInvoiceSource,
  type XeroLineSource,
  type XeroMaps,
} from "./xero-mappers";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const MAPS: XeroMaps = {
  default_account: { "*": { value: "200", label: "200 – Sales" } },
  item_account: { "*": { value: "260", label: "260 – Other Revenue" } },
  visit_account: { "*": { value: "261", label: "261 – Missed" } },
  write_off_account: { "*": { value: "684", label: "684 – Bad debts" } },
  service_account: { svc_massage: { value: "205", label: "205 – Massage" } },
  tax_type: { standard: { value: "OUTPUT2", label: "20%" }, exempt: { value: "EXEMPTOUTPUT", label: "Exempt" } },
  payment_account: { card: { value: "610", label: "Card clearing" }, [paymentMapKey("card", "site_tow")]: { value: "611", label: "Towcester card" } },
  tracking: { site_ble: { value: "11111111-1111-1111-1111-111111111111|22222222-2222-2222-2222-222222222222", label: "Clinic site: Bletchley" } },
};

function line(over: Partial<XeroLineSource> = {}): XeroLineSource {
  return {
    id: "line_1",
    kind: "service",
    serviceId: "svc_ia",
    serviceName: "Initial assessment",
    serviceOn: "2026-11-10",
    visitStatus: "attended",
    quantity: 1,
    unitPricePence: 7000,
    discountPence: 0,
    vatCode: "exempt",
    netPence: 7000,
    vatPence: 0,
    totalPence: 7000,
    ...over,
  };
}

function invoice(over: Partial<XeroInvoiceSource> = {}): XeroInvoiceSource {
  return { id: "inv_1", number: "INV01000", issuedOn: "2026-11-12", dueOn: "2026-12-10", pricesIncludeVat: true, vatRegistered: true, siteId: "site_ble", reference: "P12", totalPence: 7000, lines: [line()], ...over };
}

describe("Xero rules", () => {
  it("is off unless CLINFORMS_XERO=on", () => {
    assert.equal(xeroSwitchOn({}), false);
    assert.equal(xeroSwitchOn({ CLINFORMS_XERO: "1" }), false);
    assert.equal(xeroSwitchOn({ CLINFORMS_XERO: "true" }), false);
    assert.equal(xeroSwitchOn({ CLINFORMS_XERO: " ON " }), true);
  });

  it("asks only the granular scopes it needs (no accounting.transactions)", () => {
    assert.ok(XERO_SCOPES.includes("offline_access"));
    assert.ok(!(XERO_SCOPES as readonly string[]).includes("accounting.transactions"));
  });

  it("backs off 1 min, 5 min, 30 min, 2 h, 12 h, then gives up; Retry-After wins when longer", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((n) => nextAttemptDelaySeconds(n)), [...XERO_BACKOFF_SECONDS]);
    assert.equal(nextAttemptDelaySeconds(XERO_MAX_ATTEMPTS), null);
    assert.equal(nextAttemptDelaySeconds(1, 900), 900);
    assert.equal(nextAttemptDelaySeconds(3, 10), 1800);
    assert.equal(nextAttemptDelaySeconds(1, 10 ** 9), 86_400, "capped at a day");
  });

  it("Idempotency-Key: stable per item and version, ≤ 128 characters, no clinic or record id in clear", () => {
    const a = idempotencyKeyFor("riverside-a", syncItemId("invoice", "create", "inv_01JXYZ"), 1, sha);
    assert.equal(a, idempotencyKeyFor("riverside-a", "invoice:create:inv_01JXYZ", 1, sha));
    assert.notEqual(a, idempotencyKeyFor("riverside-a", "invoice:create:inv_01JXYZ", 2, sha));
    assert.notEqual(a, idempotencyKeyFor("harbour-b", "invoice:create:inv_01JXYZ", 1, sha));
    assert.ok(a.length <= 128 && !a.includes("riverside") && !a.includes("inv_"));
  });

  it("send order: invoices, credit notes, payments, then payment removals", () => {
    assert.deepEqual(["allocation:delete", "allocation:create", "credit_note:create", "invoice:create"].map((s) => s.split(":")).sort((x, y) => syncOrder(x[0], x[1]) - syncOrder(y[0], y[1])).map((x) => x[0] + ":" + x[1]), [
      "invoice:create",
      "credit_note:create",
      "allocation:create",
      "allocation:delete",
    ]);
  });

  it("redacts Xero's messages: quoted values, emails and long numbers never stored", () => {
    const m = redactXeroMessage('The contact name "Megan Hart (P12)" is already assigned; email megan.hart@example.com, ref 1234567890\nline two');
    assert.ok(!m.includes("Megan") && !m.includes("example.com") && !m.includes("1234567890") && !m.includes("\n"), m);
    assert.equal(redactXeroMessage(undefined), "Xero did not say why.");
    assert.ok(redactXeroMessage("x".repeat(1000)).length <= 300);
  });

  it("checks the shape of map values", () => {
    assert.ok(validXeroValue("default_account", "200"));
    assert.ok(!validXeroValue("default_account", "200; drop"));
    assert.ok(validXeroValue("tax_type", "OUTPUT2"));
    assert.ok(!validXeroValue("tax_type", "output2"));
    assert.ok(validXeroValue("tracking", "11111111-1111-1111-1111-111111111111|22222222-2222-2222-2222-222222222222"));
    assert.ok(!validXeroValue("tracking", "abc|def"));
  });
});

describe("Xero mappers", () => {
  it("pence → pounds, whole pence only", () => {
    assert.equal(pounds(7001), 70.01);
    assert.equal(pounds(-500), -5);
    assert.throws(() => pounds(1.5));
  });

  it("an issued invoice → AUTHORISED ACCREC with ClinDesk's number, inclusive VAT, tracking and no free text", () => {
    const r = invoiceToXero(invoice(), "contact-guid", MAPS);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.body.Type, "ACCREC");
    assert.equal(r.body.Status, "AUTHORISED");
    assert.equal(r.body.InvoiceNumber, "INV01000");
    assert.equal(r.body.LineAmountTypes, "Inclusive");
    assert.equal(r.body.DueDate, "2026-12-10");
    const l = r.body.LineItems[0];
    assert.deepEqual([l.AccountCode, l.TaxType, l.LineAmount, l.TaxAmount, l.Quantity, l.UnitAmount], ["200", "EXEMPTOUTPUT", 70, 0, 1, 70]);
    assert.equal(l.Description, "Initial assessment – 10/11/2026");
    assert.equal(l.Tracking?.[0].Option, "Bletchley");
  });

  it("standard-rated, exclusive prices with a discount: amounts to the penny", () => {
    const l = line({ serviceId: "svc_massage", serviceName: "Sports massage", vatCode: "standard", quantity: 3, unitPricePence: 3333, discountPence: 99, netPence: 9900, vatPence: 1980, totalPence: 11880 });
    const r = invoiceToXero(invoice({ pricesIncludeVat: false, lines: [l] }), "c", MAPS);
    assert.ok(r.ok);
    if (!r.ok) return;
    const x = r.body.LineItems[0];
    assert.equal(r.body.LineAmountTypes, "Exclusive");
    assert.deepEqual([x.Quantity, x.UnitAmount, x.DiscountAmount, x.LineAmount, x.TaxAmount, x.AccountCode], [3, 33.33, 0.99, 99, 19.8, "205"], "service override account");
  });

  it("an amount that quantity × unit − discount does not give goes as quantity 1 (totals never drift)", () => {
    const l = line({ quantity: 2, unitPricePence: 3333, discountPence: 0, netPence: 6667, totalPence: 6667 });
    const r = invoiceToXero(invoice({ lines: [l] }), "c", MAPS);
    assert.ok(r.ok && r.body.LineItems[0].Quantity === 1 && r.body.LineItems[0].LineAmount === 66.67);
  });

  it("not VAT-registered: NoTax and NONE whatever the maps say", () => {
    const r = invoiceToXero(invoice({ vatRegistered: false, lines: [line({ vatCode: "none" })] }), "c", {});
    assert.equal(r.ok, false, "still needs a sales account");
    const r2 = invoiceToXero(invoice({ vatRegistered: false, lines: [line({ vatCode: "none" })] }), "c", { default_account: MAPS.default_account });
    assert.ok(r2.ok && r2.body.LineAmountTypes === "NoTax" && r2.body.LineItems[0].TaxType === "NONE" && r2.body.LineItems[0].TaxAmount === 0);
  });

  it("an excess deduction is a negative line on the same account; items and missed visits use their accounts", () => {
    const lines = [line(), line({ id: "l2", kind: "excess_deduction", serviceId: null, serviceName: null, unitPricePence: -2500, netPence: -2500, totalPence: -2500 }), line({ id: "l3", kind: "item", serviceId: null, serviceName: null })];
    const r = invoiceToXero(invoice({ lines }), "c", MAPS);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(
      r.body.LineItems.map((l) => [l.AccountCode, l.LineAmount]),
      [
        ["200", 70],
        ["200", -25],
        ["260", 70],
      ],
    );
    assert.equal(lineAccount(MAPS, { kind: "service", serviceId: "svc_ia", visitStatus: "did_not_attend" }), "261");
    assert.equal(lineAccount(MAPS, { kind: "service", serviceId: "svc_ia", visitStatus: "attended" }), "200");
    assert.equal(lineDescription({ kind: "service", serviceName: "Follow-up", serviceOn: "2026-11-03", visitStatus: "late_cancellation" }), "Follow-up (Late cancellation) – 03/11/2026");
  });

  it("missing maps block the send with plain reasons – nothing is guessed", () => {
    const r = invoiceToXero(invoice({ lines: [line({ vatCode: "reduced" })] }), "c", { default_account: MAPS.default_account });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(r.missing, ["a Xero tax rate for VAT code reduced"]);
  });

  it("credit notes: lines on the credited lines' accounts; write-offs on the write-off account (which is required)", () => {
    const inv = invoice();
    const src = { id: "cn_1", number: "CN0001", kind: "credit", issuedOn: "2026-11-13", totalPence: 3000, invoice: inv, lines: [{ netPence: 3000, vatPence: 0, totalPence: 3000, invoiceLine: line() }] };
    for (const kind of ["credit", "void", "transfer"]) {
      const r = creditNoteToXero({ ...src, kind }, "c", MAPS);
      assert.ok(r.ok && r.body.Type === "ACCRECCREDIT" && r.body.LineItems[0].AccountCode === "200" && r.body.LineItems[0].LineAmount === 30, kind);
    }
    const w = creditNoteToXero({ ...src, kind: "write_off" }, "c", MAPS);
    assert.ok(w.ok && w.body.LineItems[0].AccountCode === "684" && w.body.CreditNoteNumber === "CN0001");
    const noW = creditNoteToXero({ ...src, kind: "write_off" }, "c", { ...MAPS, write_off_account: undefined });
    assert.ok(!noW.ok && noW.missing.includes("the write-off account"));
  });

  it("payments: the site's own account first, then the method's; refunds are not sent", () => {
    const base = { id: "alc_1", amountPence: 5000, receivedOn: "2026-11-12", method: "card", siteId: null, reference: "Terminal 0042" };
    const r = allocationToXero(base, "inv-guid", MAPS, "Card");
    assert.ok(r.ok && r.body.Account.Code === "610" && r.body.Amount === 50 && r.body.Invoice.InvoiceID === "inv-guid");
    const t = allocationToXero({ ...base, siteId: "site_tow" }, "inv-guid", MAPS, "Card");
    assert.ok(t.ok && t.body.Account.Code === "611");
    assert.equal(allocationToXero({ ...base, method: "cash" }, "x", MAPS, "Cash").ok, false);
    assert.equal(allocationToXero({ ...base, amountPence: -100 }, "x", MAPS, "Card").ok, false);
  });

  it("contacts: patients 'First Last (P1234)' + CD-P1234; details only when ticked", () => {
    const p = { kind: "patient" as const, key: "1234", name: "Megan  Hart", email: "megan.hart@example.com", address: { lines: ["14 Willow Bank (fictional)", "Bletchley", "Milton Keynes"], postcode: "MK3 9ZZ" } };
    assert.deepEqual(contactToXero(p, false), { Name: "Megan Hart (P1234)", ContactNumber: "CD-P1234" });
    const withDetails = contactToXero(p, true);
    assert.equal(withDetails.EmailAddress, "megan.hart@example.com");
    assert.equal(withDetails.Addresses?.[0].PostalCode, "MK3 9ZZ");
    assert.equal(contactNumberFor("referrer", "ref_01JABCDEF0123456789"), "CD-REF0123456789");
    assert.ok(/^CD-R[A-Z0-9]{1,12}$/.test(contactNumberFor("referrer", "ref_01jabcdef0123456789")));
  });
});
