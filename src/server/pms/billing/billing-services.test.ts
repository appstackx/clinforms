/**
 * Billing services: the payment provider choice (test mode only, live keys refused), the test-mode Stripe client
 * against a stubbed API (never the network), payment links end to end on SQLite, invoicing from a visit source,
 * the e-billing channels and the PDFs. Run by `npm run test:db` / `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSqliteTestDb, testCipher, type TestDb } from "../../db/testing/databases";
import { RepoInputError, type RepoContext } from "../../repos/context";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { listPaymentLinks } from "../../repos/pms/billing/payment-links";
import { listPayments } from "../../repos/pms/billing/payments";
import { updateBillingSettings } from "../../repos/pms/billing/settings";
import { createCase } from "../../repos/pms/cases";
import { createPractitioner, createService } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createPriceList, setPriceListItem } from "../../repos/pms/price-lists";
import { createReferrer } from "../../repos/pms/referrers";
import { creditNoteDocument, invoiceDocument, statementDocument } from "./documents";
import { INSURER_BILLING_CHANNELS } from "./ebilling-channels";
import { checkInvoicePaymentLinks, createInvoicePaymentLink } from "./payment-links";
import { paymentLinkProvider } from "./payments";
import { MANUAL_PROVIDER } from "./payments/provider";
import { createStripeTestProvider } from "./payments/stripe-test";
import { renderDocumentPdf } from "./pdf";
import { setBillableVisitSourceForTests } from "./visit-source";
import { suggestVisitLines } from "./visits";
import { createCreditNote } from "../../repos/pms/billing/credit-notes";

const TEST_KEY = `sk_test_${"x".repeat(24)}`;

describe("payment provider choice (test mode only)", () => {
  it("manual by default; stripe_test only with a test key; live keys refused", () => {
    assert.equal(paymentLinkProvider({}).id, "manual");
    assert.equal(paymentLinkProvider({ CLINIC_PAYMENTS_PROVIDER: "manual" }).configured, false);
    assert.match(paymentLinkProvider({ CLINIC_PAYMENTS_PROVIDER: "stripe_test" }).unavailableReason ?? "", /test key is not set/);
    const live = paymentLinkProvider({ CLINIC_PAYMENTS_PROVIDER: "stripe_test", CLINIC_STRIPE_TEST_SECRET_KEY: `sk_live_${"x".repeat(24)}` });
    assert.equal(live.configured, false);
    assert.match(live.unavailableReason ?? "", /not a test key/);
    assert.equal(paymentLinkProvider({ CLINIC_PAYMENTS_PROVIDER: "paypal" }).configured, false);
    const ok = paymentLinkProvider({ CLINIC_PAYMENTS_PROVIDER: "stripe_test", CLINIC_STRIPE_TEST_SECRET_KEY: TEST_KEY }, async () => new Response("{}"));
    assert.deepEqual([ok.id, ok.mode, ok.configured], ["stripe", "test", true]);
    assert.throws(() => createStripeTestProvider(`rk_live_${"x".repeat(24)}`));
  });
});

/** A stand-in for Stripe's API: prices, payment links, checkout sessions – no network. */
function fakeStripe() {
  const calls: { method: string; url: string; body: string; idem: string | null; auth: string | null }[] = [];
  let paid: { id: string; amount_total: number }[] = [];
  let livemode = false;
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ method: String(init.method), url, body: String(init.body ?? ""), idem: headers["idempotency-key"] ?? null, auth: headers.authorization ?? null });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/prices")) return json({ id: "price_test_1", livemode });
    if (url.endsWith("/payment_links")) return json({ id: "plink_test_1", url: "https://buy.stripe.com/test_00001", livemode });
    if (url.includes("/checkout/sessions")) return json({ data: paid.map((p) => ({ ...p, payment_status: "paid", created: Date.parse("2026-10-24T10:00:00Z") / 1000 })), livemode });
    if (url.includes("/payment_links/")) return json({ id: "plink_test_1", active: false, livemode });
    return new Response("{}", { status: 404 });
  };
  return {
    calls,
    fetchImpl,
    pay: (id: string, amount: number) => {
      paid = [...paid, { id, amount_total: amount }];
    },
    goLive: () => {
      livemode = true;
    },
  };
}

describe("billing services on SQLite", () => {
  let t: TestDb;
  let ctx: RepoContext;
  const T = "riverside-svc";
  const ACTOR = { userId: "user_owner_01", sessionId: "sess_01" };
  const id: Record<string, string> = {};

  before(async () => {
    t = createSqliteTestDb();
    ctx = { db: t.db, cipher: testCipher(), now: () => new Date("2026-10-24T09:00:00.000Z") };
    id.prac = (await createPractitioner(ctx, T, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02" }, ACTOR)).id;
    id.fu = (await createService(ctx, T, { name: "Follow-up", durationMinutes: 30, defaultPricePence: 5500 }, ACTOR)).id;
    id.ins = (await createReferrer(ctx, T, { kind: "insurer", name: "Albion Medical Cover (fictional)" }, ACTOR)).id;
    const list = await createPriceList(ctx, T, { name: "Albion 2026", payerType: "insurer", referrerId: id.ins }, ACTOR);
    await setPriceListItem(ctx, T, { priceListId: list.id, serviceId: id.fu, pricePence: 5000, billingCode: "AL-02" }, ACTOR);
    id.list = list.id;
    id.pat = (await createPatient(ctx, T, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19", address: ["27 Carrick Road (fictional)"], postcode: "MK12 9ZZ" }, ACTOR)).id;
    id.case = (await createCase(ctx, T, { patientId: id.pat, title: "Lower back", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.ins, membershipNumber: "AL-123456", priceListId: list.id }, ACTOR)).id;
    await updateBillingSettings(ctx, T, 0, { invoicePrefix: "RIV", paymentInstructions: "Bank transfer to Riverside Physiotherapy (fictional) – demonstration only." }, ACTOR);
    const d = await createDraftInvoice(ctx, T, { patientId: id.pat, lines: [{ serviceId: id.fu, practitionerId: id.prac, serviceOn: "2026-10-20", unitPricePence: 5500 }] }, ACTOR);
    const r = await issueInvoice(ctx, T, d.invoice.id, 1, {}, ACTOR);
    assert.ok(r.ok);
    id.inv = d.invoice.id;
  });
  after(async () => {
    setBillableVisitSourceForTests(null);
    await t?.close();
  });

  it("payment links: off until switched on and configured; a test link; a paid session recorded once", async () => {
    await assert.rejects(createInvoicePaymentLink(ctx, T, "Riverside (fictional)", id.inv, ACTOR, MANUAL_PROVIDER), /not set up/);
    const stripe = fakeStripe();
    const provider = createStripeTestProvider(TEST_KEY, stripe.fetchImpl);
    await assert.rejects(createInvoicePaymentLink(ctx, T, "Riverside (fictional)", id.inv, ACTOR, provider), /switched off/);
    await updateBillingSettings(ctx, T, 1, { paymentLinksEnabled: true }, ACTOR);
    const link = await createInvoicePaymentLink(ctx, T, "Riverside (fictional)", id.inv, ACTOR, provider);
    assert.deepEqual([link.url, link.amountPence, link.mode], ["https://buy.stripe.com/test_00001", 5500, "test"]);
    assert.ok(stripe.calls.every((c) => c.auth === `Bearer ${TEST_KEY}` && c.url.startsWith("https://api.stripe.com/v1/")));
    assert.match(stripe.calls[0].body, /currency=gbp&unit_amount=5500&product_data%5Bname%5D=Invoice%20RIV00001/);
    assert.ok(!stripe.calls.some((c) => /Brooks|Follow-up/.test(decodeURIComponent(c.body))), "nothing about the patient or treatment goes to the provider");
    assert.ok(stripe.calls.every((c) => c.method === "GET" || c.idem), "creates are idempotent");
    const again = await createInvoicePaymentLink(ctx, T, "Riverside (fictional)", id.inv, ACTOR, provider);
    assert.equal(again.id, link.id, "the same active link is reused");
    assert.deepEqual(await checkInvoicePaymentLinks(ctx, T, id.inv, ACTOR, provider), { recorded: 0, amountPence: 0, paidLinks: 0 });
    stripe.pay("cs_test_paid_1", 5500);
    assert.deepEqual(await checkInvoicePaymentLinks(ctx, T, id.inv, ACTOR, provider), { recorded: 1, amountPence: 5500, paidLinks: 1 });
    const inv = await getInvoice(ctx, T, id.inv);
    assert.equal(inv?.balancePence, 0);
    const pays = await listPayments(ctx, T);
    assert.deepEqual(pays.map((p) => [p.method, p.provider, p.providerRef]), [["online", "stripe", "cs_test_paid_1"]]);
    assert.equal((await listPaymentLinks(ctx, T, id.inv))[0].status, "paid");
    assert.deepEqual(await checkInvoicePaymentLinks(ctx, T, id.inv, ACTOR, provider), { recorded: 0, amountPence: 0, paidLinks: 0 }, "a paid link is not checked again");
    stripe.goLive();
    await assert.rejects(provider.listPaidSessions("plink_test_1"), /live mode/);
  });

  it("invoicing from a visit source: prices from the case's list, billed appointments left out, missed-appointment charges", async () => {
    // The diary is connected (M5): this patient has no chargeable appointments in the diary yet.
    assert.deepEqual(await suggestVisitLines(ctx, T, { patientId: id.pat, caseId: id.case }, id.list), { connected: true, lines: [] });
    setBillableVisitSourceForTests({
      id: "test",
      connected: true,
      listChargeableVisits: async () => [
        { appointmentId: "appt_01JTEST0000000000000000001", patientId: id.pat, caseId: id.case, serviceId: id.fu, practitionerId: id.prac, siteId: null, date: "2026-10-01", startTime: "09:00", status: "attended" },
        { appointmentId: "appt_01JTEST0000000000000000002", patientId: id.pat, caseId: id.case, serviceId: id.fu, practitionerId: id.prac, siteId: null, date: "2026-10-08", startTime: "09:00", status: "did_not_attend" },
        { appointmentId: "appt_01JTEST0000000000000000003", patientId: "pat_someone_else", caseId: null, serviceId: id.fu, practitionerId: null, siteId: null, date: "2026-10-08", startTime: "10:00", status: "attended" },
      ],
      listClinicVisits: async () => [],
      listUninvoicedVisits: async () => ({ visits: [], total: 0, next: null }),
      waiveFee: async () => false,
    });
    const first = await suggestVisitLines(ctx, T, { patientId: id.pat, caseId: id.case }, id.list);
    assert.equal(first.connected, true);
    assert.deepEqual(first.lines.map((l) => [l.visit.appointmentId.slice(-1), l.line?.unitPricePence, l.line?.billingCode, l.priceSource]), [
      ["1", 5000, "AL-02", "list"],
      ["2", 5000, "AL-02", "list"],
    ]);
    const lines = first.lines.map((l) => l.line).filter((l) => l !== null);
    await createDraftInvoice(ctx, T, { patientId: id.pat, caseId: id.case, billTo: "payer", lines }, ACTOR);
    assert.equal((await suggestVisitLines(ctx, T, { patientId: id.pat, caseId: id.case }, id.list)).lines.length, 0, "now billed");
  });

  it("e-billing channels: the claims file; Healthcode not connected and nothing sent", async () => {
    const draft = (await t.db.selectFrom("pms_invoices").select(["id", "rev"]).where("tenant_id", "=", T).where("bill_to", "=", "payer").executeTakeFirstOrThrow()) as { id: string; rev: number };
    const r = await issueInvoice(ctx, T, draft.id, Number(draft.rev), {}, ACTOR);
    assert.ok(r.ok);
    id.insInv = draft.id;
    await assert.rejects(INSURER_BILLING_CHANNELS.healthcode.submit(ctx, T, [draft.id], ACTOR), /not connected yet/);
    assert.equal(INSURER_BILLING_CHANNELS.healthcode.info.connected, false);
    const file = await INSURER_BILLING_CHANNELS.csv.submit(ctx, T, [draft.id, id.inv], ACTOR);
    assert.deepEqual([file.invoices, file.skipped], [1, [id.inv]]);
    assert.match(file.body, /^Invoice number,/);
    assert.match(file.body, /AL-123456/);
    assert.match(file.name, /^claims-ebx-[0-9a-z]+\.csv$/);
    await assert.rejects(INSURER_BILLING_CHANNELS.csv.submit(ctx, T, [id.inv], ACTOR), RepoInputError);
  });

  it("PDFs: invoice, credit note and statement render (A4, demo notice off for a normal clinic)", async () => {
    const doc = await invoiceDocument(ctx, T, "Riverside (fictional)", id.insInv);
    assert.ok(doc);
    assert.equal(doc!.model.title, "Invoice");
    assert.deepEqual(doc!.model.to.references.map((r) => r.label), ["Patient", "Date of birth", "Membership number"]);
    assert.ok(doc!.model.rows[0].cells.join(" ").includes("Tom Ellis"));
    const bytes = await renderDocumentPdf(doc!.model);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
    assert.ok(bytes.length > 1500);
    const inv = (await getInvoice(ctx, T, id.insInv))!;
    const cn = await createCreditNote(ctx, T, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[1].id, totalPence: inv.lines[1].totalPence }], reason: "Did-not-attend fee waived" }, ACTOR);
    const cdoc = await creditNoteDocument(ctx, T, "Riverside (fictional)", cn.id);
    assert.equal(cdoc?.model.title, "Credit note");
    assert.ok(cdoc?.model.notes.join(" ").includes("waived"));
    assert.equal(Buffer.from((await renderDocumentPdf(cdoc!.model)).slice(0, 5)).toString(), "%PDF-");
    const sdoc = await statementDocument(ctx, T, "Riverside (fictional)", { payerKind: "account", payerReferrerId: id.ins }, "2026-10-01", "2026-10-31");
    assert.ok(sdoc);
    assert.equal(sdoc!.model.rows.length, 3, "brought forward, the invoice, the credit note");
    assert.equal(Buffer.from((await renderDocumentPdf(sdoc!.model)).slice(0, 5)).toString(), "%PDF-");
    assert.equal(await invoiceDocument(ctx, "another-clinic", "x", id.insInv), null, "another clinic gets nothing");
  });
});
