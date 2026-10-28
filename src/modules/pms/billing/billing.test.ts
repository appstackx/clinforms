/** Pure billing rules: VAT, numbers, states, aged debt, statements, allocation, visits, excess, CSV, schemas. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGE_BUCKETS, ageBucket, agedDebt } from "./aging";
import { autoAllocate, unallocated } from "./allocation";
import { csvCell, penceDecimal, toCsv } from "./csv";
import { CLAIM_CSV_HEADER, EXPORT_CHANNEL_INFO, claimProblems, claimsCsv } from "./ebilling";
import { splitExcess } from "./excess";
import { formatDocumentNumber, nextDocumentSeq, parseDocumentNumber } from "./numbers";
import { BillingSettingsInputSchema, CreditNoteInputSchema, InvoiceDraftInputSchema, InvoiceLineInputSchema, PaymentInputSchema } from "./schemas";
import { buildStatement } from "./statements";
import { addDaysIso, balanceOf, daysBetweenIso, dueDate, invoiceState } from "./status";
import { creditShare, lineAmounts, normaliseVatNumber, roundHalfAway, sumTotals, vatLabel, vatSummary } from "./vat";
import { visitCharge, visitLine } from "./visits";

describe("VAT and line amounts", () => {
  it("exempt and not-registered lines carry no VAT", () => {
    assert.deepEqual(lineAmounts({ unitPricePence: 5500, quantity: 1, vatRateBp: 0, pricesIncludeVat: true }), { chargedPence: 5500, netPence: 5500, vatPence: 0, totalPence: 5500 });
    assert.deepEqual(lineAmounts({ unitPricePence: 1500, quantity: 4, discountPence: 1000, vatRateBp: 0, pricesIncludeVat: false }), { chargedPence: 5000, netPence: 5000, vatPence: 0, totalPence: 5000 });
  });
  it("standard rate, prices including VAT: VAT is 1/6 of the price, rounded per line", () => {
    assert.deepEqual(lineAmounts({ unitPricePence: 6000, quantity: 1, vatRateBp: 2000, pricesIncludeVat: true }), { chargedPence: 6000, netPence: 5000, vatPence: 1000, totalPence: 6000 });
    // 5500 × 2000 / 12000 = 916.67 → 917
    assert.deepEqual(lineAmounts({ unitPricePence: 5500, quantity: 1, vatRateBp: 2000, pricesIncludeVat: true }), { chargedPence: 5500, netPence: 4583, vatPence: 917, totalPence: 5500 });
  });
  it("standard rate, prices excluding VAT: VAT added on top", () => {
    assert.deepEqual(lineAmounts({ unitPricePence: 5500, quantity: 2, vatRateBp: 2000, pricesIncludeVat: false }), { chargedPence: 11000, netPence: 11000, vatPence: 2200, totalPence: 13200 });
    // 1 × 333 × 5% = 16.65 → 17
    assert.equal(lineAmounts({ unitPricePence: 333, quantity: 1, vatRateBp: 500, pricesIncludeVat: false }).vatPence, 17);
  });
  it("rounding is half away from zero, also for the (negative) excess deduction", () => {
    assert.equal(roundHalfAway(2.5), 3);
    assert.equal(roundHalfAway(-2.5), -3);
    assert.equal(roundHalfAway(2.4999), 2);
    assert.deepEqual(lineAmounts({ unitPricePence: -10000, quantity: 1, vatRateBp: 0, pricesIncludeVat: true }).totalPence, -10000);
  });
  it("refuses fractions and impossible rates", () => {
    assert.throws(() => lineAmounts({ unitPricePence: 10.5, quantity: 1, vatRateBp: 0, pricesIncludeVat: true }));
    assert.throws(() => lineAmounts({ unitPricePence: 100, quantity: 0, vatRateBp: 0, pricesIncludeVat: true }));
    assert.throws(() => lineAmounts({ unitPricePence: 100, quantity: 1, vatRateBp: 20000, pricesIncludeVat: true }));
  });
  it("totals, VAT summary per rate, credit shares", () => {
    const a = { netPence: 5000, vatPence: 1000, totalPence: 6000, vatCode: "standard" as const, vatRateBp: 2000 };
    const b = { netPence: 5500, vatPence: 0, totalPence: 5500, vatCode: "exempt" as const, vatRateBp: 0 };
    assert.deepEqual(sumTotals([a, b, a]), { netPence: 15500, vatPence: 2000, totalPence: 17500 });
    assert.deepEqual(vatSummary([a, b, a]), [
      { vatCode: "standard", vatRateBp: 2000, netPence: 10000, vatPence: 2000 },
      { vatCode: "exempt", vatRateBp: 0, netPence: 5500, vatPence: 0 },
    ]);
    assert.deepEqual(creditShare(a, 6000), { netPence: 5000, vatPence: 1000, totalPence: 6000 });
    assert.deepEqual(creditShare(a, 3000), { netPence: 2500, vatPence: 500, totalPence: 3000 });
    assert.deepEqual(creditShare(b, 100), { netPence: 100, vatPence: 0, totalPence: 100 });
    assert.throws(() => creditShare(a, 6001));
    assert.throws(() => creditShare(a, 0));
  });
  it("labels and VAT numbers", () => {
    assert.equal(vatLabel("standard", 2000), "20%");
    assert.equal(vatLabel("reduced", 500), "5%");
    assert.equal(vatLabel("exempt", 0), "Exempt");
    assert.equal(normaliseVatNumber("gb 123 4567 89"), "GB123456789");
    assert.equal(normaliseVatNumber("GB12345"), null);
    assert.equal(normaliseVatNumber("FR12345678901"), null);
  });
});

describe("document numbers", () => {
  it("prefix + at least five digits, at most 10 characters; parsed back for search", () => {
    assert.equal(formatDocumentNumber("RIV", 42), "RIV00042");
    assert.equal(formatDocumentNumber("BHCX", 999999), "BHCX999999");
    assert.equal(formatDocumentNumber("BHCX", 999999)?.length, 10);
    assert.equal(formatDocumentNumber("RIV", null), null);
    assert.deepEqual(parseDocumentNumber("riv00042"), { prefix: "RIV", seq: 42 });
    assert.deepEqual(parseDocumentNumber(" RIV-42 "), { prefix: "RIV", seq: 42 });
    assert.deepEqual(parseDocumentNumber("42"), { prefix: null, seq: 42 });
    assert.equal(parseDocumentNumber("Megan"), null);
    assert.equal(parseDocumentNumber("0"), null);
  });
  it("the next number never goes backwards and honours the clinic's first number", () => {
    assert.equal(nextDocumentSeq(null, 1), 1);
    assert.equal(nextDocumentSeq(41, 1), 42);
    assert.equal(nextDocumentSeq(null, 10450), 10450);
    assert.equal(nextDocumentSeq(10460, 10450), 10461);
  });
});

describe("invoice state and dates", () => {
  const base = { status: "issued" as const, totalPence: 10000, paidPence: 0, creditedPence: 0, dueOn: "2026-10-30" };
  it("states follow the amounts", () => {
    assert.equal(invoiceState({ ...base, status: "draft" }, "2026-10-24"), "draft");
    assert.equal(invoiceState({ ...base, status: "cancelled" }, "2026-10-24"), "cancelled");
    assert.equal(invoiceState(base, "2026-10-24"), "unpaid");
    assert.equal(invoiceState(base, "2026-10-31"), "overdue");
    assert.equal(invoiceState({ ...base, paidPence: 4000 }, "2026-10-24"), "part_paid");
    assert.equal(invoiceState({ ...base, paidPence: 10000 }, "2026-12-24"), "paid");
    assert.equal(invoiceState({ ...base, creditedPence: 10000 }, "2026-10-24"), "credited");
    assert.equal(invoiceState({ ...base, paidPence: 10000, creditedPence: 2000 }, "2026-10-24"), "refund_due");
    assert.equal(balanceOf({ totalPence: 10000, paidPence: 2500, creditedPence: 500 }), 7000);
    assert.equal(invoiceState({ ...base, totalPence: 0 }, "2026-10-24"), "paid", "a zero invoice is settled, not credited");
  });
  it("due dates from the terms; day arithmetic across months and the clock change", () => {
    assert.equal(dueDate("2026-10-24", "patient", { selfPayTermsDays: 0, accountTermsDays: 30 }), "2026-10-24");
    assert.equal(dueDate("2026-10-24", "payer", { selfPayTermsDays: 0, accountTermsDays: 30 }), "2026-11-23");
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(daysBetweenIso("2026-10-24", "2026-10-26"), 2, "over the October clock change");
    assert.equal(daysBetweenIso("2026-03-28", "2026-03-30"), 2, "over the March clock change");
  });
});

describe("aged debt", () => {
  it("buckets by days past the due date", () => {
    assert.equal(ageBucket("2026-10-30", "2026-10-01", "2026-10-24"), "current");
    assert.equal(ageBucket("2026-10-24", "2026-10-01", "2026-10-24"), "current", "due today is not overdue");
    assert.equal(ageBucket("2026-10-23", "2026-10-01", "2026-10-24"), "d1_30");
    assert.equal(ageBucket("2026-09-23", "2026-09-01", "2026-10-24"), "d31_60");
    assert.equal(ageBucket("2026-08-01", "2026-07-01", "2026-10-24"), "d61_90");
    assert.equal(ageBucket(null, "2026-06-01", "2026-10-24"), "d90_plus", "no due date: from the invoice date");
  });
  it("groups by debtor, keeps refunds due apart, totals add up", () => {
    const r = agedDebt(
      [
        { id: "a", debtorKey: "account:nw", issuedOn: "2026-06-01", dueOn: "2026-07-01", balancePence: 4800 },
        { id: "b", debtorKey: "account:nw", issuedOn: "2026-10-20", dueOn: "2026-11-19", balancePence: 6500 },
        { id: "c", debtorKey: "patient:p1", issuedOn: "2026-10-01", dueOn: "2026-10-01", balancePence: 5500 },
        { id: "d", debtorKey: "patient:p2", issuedOn: "2026-10-01", dueOn: "2026-10-01", balancePence: -2000 },
        { id: "e", debtorKey: "patient:p3", issuedOn: "2026-10-01", dueOn: "2026-10-01", balancePence: 0 },
      ],
      "2026-10-24",
    );
    assert.deepEqual(r.rows.map((x) => x.debtorKey), ["account:nw", "patient:p1"]);
    assert.deepEqual(r.rows[0].buckets, { current: 6500, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 4800 });
    assert.equal(r.rows[0].oldestIssuedOn, "2026-06-01");
    assert.equal(r.totals.totalPence, 4800 + 6500 + 5500);
    assert.equal(AGE_BUCKETS.reduce((a, b) => a + r.totals[b], 0), r.totals.totalPence);
    assert.deepEqual(r.refundsDue, [{ debtorKey: "patient:p2", invoiceId: "d", amountPence: 2000 }]);
  });
});

describe("statements", () => {
  it("brought forward, running balance, period totals", () => {
    const s = buildStatement(
      [
        { kind: "invoice", id: "i1", on: "2026-08-10", reference: "RIV00001", description: "Invoice", amountPence: 10000 },
        { kind: "payment", id: "p1", on: "2026-09-02", reference: "BACS 1", description: "Payment", amountPence: 6000 },
        { kind: "invoice", id: "i2", on: "2026-09-15", reference: "RIV00007", description: "Invoice", amountPence: 4800 },
        { kind: "credit_note", id: "c1", on: "2026-09-20", reference: "CN00001", description: "Credit", amountPence: 800 },
        { kind: "refund", id: "r1", on: "2026-09-25", reference: "Refund", description: "Refund", amountPence: 500 },
        { kind: "invoice", id: "i3", on: "2026-11-01", reference: "RIV00020", description: "Later", amountPence: 999 },
      ],
      "2026-09-01",
      "2026-09-30",
    );
    assert.equal(s.openingPence, 10000);
    assert.deepEqual(s.rows.map((r) => r.balancePence), [4000, 8800, 8000, 8500]);
    assert.equal(s.closingPence, 8500);
    assert.deepEqual(s.totals, { debitPence: 5300, creditPence: 6800 });
    assert.equal(s.rows.length, 4, "outside the period: left out");
  });
});

describe("allocation", () => {
  it("oldest first, never more than a balance, the rest on account", () => {
    const open = [
      { id: "b", issuedOn: "2026-09-10", numberSeq: 12, balancePence: 4800 },
      { id: "a", issuedOn: "2026-09-01", numberSeq: 9, balancePence: 6500 },
      { id: "z", issuedOn: "2026-08-01", numberSeq: 2, balancePence: 0 },
    ];
    assert.deepEqual(autoAllocate(10000, open), [
      { invoiceId: "a", amountPence: 6500 },
      { invoiceId: "b", amountPence: 3500 },
    ]);
    assert.deepEqual(autoAllocate(20000, open), [
      { invoiceId: "a", amountPence: 6500 },
      { invoiceId: "b", amountPence: 4800 },
    ]);
    assert.deepEqual(autoAllocate(0, open), []);
    assert.equal(unallocated(20000, [{ amountPence: 6500 }, { amountPence: 4800 }]), 8700);
  });
});

describe("visits and the excess", () => {
  const pricing = { listPricePence: 5500, billingCode: "NW-PHY-FU", serviceName: "Follow-up", vatCode: "exempt" as const };
  const visit = { appointmentId: "appt_01", patientId: "pat_1", caseId: "case_1", serviceId: "svc_fu", practitionerId: "prac_1", siteId: null, date: "2026-10-20", startTime: "09:30", status: "attended" as const };
  it("attended → full price; DNA and late cancellation at the clinic's percentage; 0 % → no line", () => {
    const rules = { dnaChargePercent: 100, lateCancelChargePercent: 50 };
    assert.equal(visitCharge("attended", 5500, rules), 5500);
    assert.equal(visitCharge("did_not_attend", 5500, rules), 5500);
    assert.equal(visitCharge("late_cancellation", 5500, rules), 2750);
    assert.equal(visitCharge("late_cancellation", 5500, { ...rules, lateCancelChargePercent: 0 }), null);
    const line = visitLine({ ...visit, status: "late_cancellation" }, pricing, rules);
    assert.equal(line?.description, "Late cancellation – Follow-up");
    assert.equal(line?.unitPricePence, 2750);
    assert.equal(line?.appointmentId, "appt_01");
    assert.equal(visitLine({ ...visit, status: "did_not_attend" }, pricing, { ...rules, dnaChargePercent: 0 }), null);
    assert.ok(InvoiceLineInputSchema.safeParse(visitLine(visit, pricing, rules)).success, "a visit line is a valid line");
  });
  it("the excess goes to the patient first, never more than the invoice, then runs out", () => {
    assert.deepEqual(splitExcess({ payerTotalPence: 30000, excessPence: 10000, excessAlreadyBilledPence: 0 }), { patientPence: 10000, payerPence: 20000, remainingAfterPence: 0 });
    assert.deepEqual(splitExcess({ payerTotalPence: 6500, excessPence: 10000, excessAlreadyBilledPence: 0 }), { patientPence: 6500, payerPence: 0, remainingAfterPence: 3500 });
    assert.deepEqual(splitExcess({ payerTotalPence: 4800, excessPence: 10000, excessAlreadyBilledPence: 6500 }), { patientPence: 3500, payerPence: 1300, remainingAfterPence: 0 });
    assert.deepEqual(splitExcess({ payerTotalPence: 4800, excessPence: 10000, excessAlreadyBilledPence: 10000 }), { patientPence: 0, payerPence: 4800, remainingAfterPence: 0 });
    assert.deepEqual(splitExcess({ payerTotalPence: 4800, excessPence: null, excessAlreadyBilledPence: 0 }), { patientPence: 0, payerPence: 4800, remainingAfterPence: 0 });
  });
});

describe("CSV and e-billing", () => {
  it("quotes, CRLF, and blocks formula injection in text cells (numbers stay numbers)", () => {
    assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
    assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
    assert.equal(csvCell("+44 7700 900123"), "'+44 7700 900123");
    assert.equal(csvCell("@sum"), "'@sum");
    assert.equal(csvCell(-12.5), "-12.5");
    assert.equal(csvCell(null), "");
    assert.equal(toCsv(["a", "b"], [[1, "x"]]), "a,b\r\n1,x\r\n");
    assert.equal(penceDecimal(1250), 12.5);
    assert.equal(penceDecimal(-1), -0.01);
  });
  it("Healthcode is listed but not connected; the claims file is", () => {
    assert.equal(EXPORT_CHANNEL_INFO.healthcode.connected, false);
    assert.match(EXPORT_CHANNEL_INFO.healthcode.description, /Not connected yet/);
    assert.equal(EXPORT_CHANNEL_INFO.csv.connected, true);
  });
  it("one claims row per line with the insurer's fields; problems flagged before export", () => {
    const csv = claimsCsv([
      {
        invoiceNumber: "RIV00042",
        invoiceDate: "2026-10-20",
        dueDate: "2026-11-19",
        payerName: "Northwell Health Insurance (fictional)",
        patientLastName: "Brooks",
        patientFirstName: "Daniel",
        patientDateOfBirth: "1980-01-19",
        patientNumber: 2,
        membershipNumber: "NW-000123",
        authorisationCode: "NW-AUTH-0001",
        claimReference: null,
        serviceDate: "2026-10-20",
        billingCode: "NW-PHY-FU",
        description: "Follow-up",
        practitionerName: "Tom Ellis",
        practitionerRegistration: "PH-DEMO-02",
        quantity: 1,
        netPence: 4800,
        vatPence: 0,
        totalPence: 4800,
        diagnosisCode: null,
      },
    ]);
    const [header, row] = csv.trim().split("\r\n");
    assert.equal(header.split(",").length, CLAIM_CSV_HEADER.length);
    assert.match(row, /^RIV00042,2026-10-20,2026-11-19,Northwell Health Insurance \(fictional\),Brooks,Daniel,1980-01-19,2,NW-000123,NW-AUTH-0001,,2026-10-20,NW-PHY-FU,Follow-up,Tom Ellis,PH-DEMO-02,1,48,0,48,$/);
    assert.deepEqual(claimProblems({ number: "RIV00042", membershipNumber: "NW-1", authorisationCode: "A", lines: [{ kind: "service", billingCode: "X" }] }), []);
    assert.deepEqual(claimProblems({ number: null, membershipNumber: null, authorisationCode: null, lines: [{ kind: "service", billingCode: null }] }).length, 4);
  });
});

describe("input schemas", () => {
  it("settings: prefixes of capital letters, distinct; VAT number normalised", () => {
    const ok = BillingSettingsInputSchema.safeParse({ invoicePrefix: "riv", creditNotePrefix: "rcn", vatNumber: "gb 123456789" });
    assert.ok(ok.success);
    assert.equal(ok.success && ok.data.invoicePrefix, "RIV");
    assert.equal(ok.success && ok.data.vatNumber, "GB123456789");
    assert.equal(BillingSettingsInputSchema.safeParse({ invoicePrefix: "RIVER" }).success, false, "at most 4");
    assert.equal(BillingSettingsInputSchema.safeParse({ invoicePrefix: "R1" }).success, false, "letters only");
    assert.equal(BillingSettingsInputSchema.safeParse({ invoicePrefix: "RIV", creditNotePrefix: "RIV" }).success, false);
    assert.equal(BillingSettingsInputSchema.safeParse({ vatNumber: "123" }).success, false);
  });
  it("lines: service lines need a type and date; only the excess deduction is negative; no VAT on an excess", () => {
    assert.equal(InvoiceLineInputSchema.safeParse({ unitPricePence: 100 }).success, false, "service without type");
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "item", unitPricePence: -100 }).success, false);
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "excess_deduction", unitPricePence: -100 }).success, true);
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "excess_deduction", unitPricePence: 100 }).success, false);
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "excess", unitPricePence: 100, vatCode: "standard" }).success, false);
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "item", unitPricePence: 100, discountPence: 200 }).success, false);
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "item", unitPricePence: 100, appointmentId: "appt_1" }).success, false);
    assert.equal(InvoiceLineInputSchema.safeParse({ kind: "service", serviceId: "svc_1", serviceOn: "2026-10-24", unitPricePence: 5.5 }).success, false);
  });
  it("drafts: a payer invoice needs its case; an appointment only once", () => {
    const line = { kind: "service" as const, serviceId: "svc_1", serviceOn: "2026-10-24", unitPricePence: 5500, appointmentId: "appt_1" };
    assert.equal(InvoiceDraftInputSchema.safeParse({ patientId: "pat_1", billTo: "payer", lines: [line] }).success, false);
    assert.equal(InvoiceDraftInputSchema.safeParse({ patientId: "pat_1", lines: [line, line] }).success, false);
    assert.equal(InvoiceDraftInputSchema.safeParse({ patientId: "pat_1", lines: [] }).success, false);
    assert.equal(InvoiceDraftInputSchema.safeParse({ patientId: "pat_1", caseId: "case_1", billTo: "payer", lines: [line] }).success, true);
  });
  it("credit notes need a reason and distinct lines; payments name their payer and never over-allocate", () => {
    assert.equal(CreditNoteInputSchema.safeParse({ invoiceId: "inv_1", lines: [{ invoiceLineId: "l1", totalPence: 100 }], reason: "" }).success, false);
    assert.equal(CreditNoteInputSchema.safeParse({ invoiceId: "inv_1", lines: [{ invoiceLineId: "l1", totalPence: 100 }, { invoiceLineId: "l1", totalPence: 1 }], reason: "Duplicate" }).success, false);
    const pay = { payerKind: "patient" as const, patientId: "pat_1", receivedOn: "2026-10-24", method: "card" as const, amountPence: 5500 };
    assert.equal(PaymentInputSchema.safeParse(pay).success, true);
    assert.equal(PaymentInputSchema.safeParse({ ...pay, patientId: null }).success, false);
    assert.equal(PaymentInputSchema.safeParse({ ...pay, allocations: [{ invoiceId: "inv_1", amountPence: 6000 }] }).success, false);
    assert.equal(PaymentInputSchema.safeParse({ ...pay, payerKind: "account", payerReferrerId: null }).success, false);
    assert.equal(PaymentInputSchema.safeParse({ ...pay, amountPence: 0 }).success, false);
  });
});

describe("M5: excess per visit, void state", () => {
  it("the excess not billed yet is taken from the first visits in order", async () => {
    const { excessPerVisit } = await import("./visits");
    const m = excessPerVisit(
      [
        { key: "a", totalPence: 7500 },
        { key: "b", totalPence: 7500 },
        { key: "c", totalPence: 7500 },
      ],
      10000,
    );
    assert.deepEqual([m.get("a"), m.get("b"), m.get("c")], [7500, 2500, 0]);
    assert.deepEqual(Array.from(excessPerVisit([{ key: "a", totalPence: 5000 }], 0).values()), [0]);
  });
  it("a voided invoice reads Void; unpaid issued reads Issued; part paid reads Part-paid", async () => {
    const { invoiceState, INVOICE_STATE_LABELS } = await import("./status");
    const base = { status: "issued" as const, totalPence: 5500, paidPence: 0, creditedPence: 0, dueOn: "2026-11-30" };
    assert.equal(INVOICE_STATE_LABELS[invoiceState(base, "2026-10-28")], "Issued");
    assert.equal(INVOICE_STATE_LABELS[invoiceState({ ...base, paidPence: 1000 }, "2026-10-28")], "Part-paid");
    assert.equal(invoiceState({ ...base, creditedPence: 5500, voidedAt: "2026-10-28T10:00:00.000Z" }, "2026-10-28"), "void");
  });
});
