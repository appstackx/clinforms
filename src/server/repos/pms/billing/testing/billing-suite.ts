/**
 * TESTS ONLY: the billing repository suite, run unchanged on node:sqlite and PGlite (../billing-repos.test.ts) and on
 * D1 through the gateway (workers/data-gateway/test/pms-billing-stack.test.ts). Two clinics; every write audited;
 * nothing of clinic B readable or changeable from A; encrypted free text; the database's own refusals (over-credit,
 * over-allocation, double billing of an appointment) leave nothing half-written; ends with the tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import { agedDebt } from "../../../../../modules/pms/billing/aging";
import { claimsCsv } from "../../../../../modules/pms/billing/ebilling";
import { buildStatement } from "../../../../../modules/pms/billing/statements";
import { invoiceState } from "../../../../../modules/pms/billing/status";
import { visitLine } from "../../../../../modules/pms/billing/visits";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createAuthorisation, createCase, getAuthorisation } from "../../cases";
import { createPractitioner, createService, createSite } from "../../directory";
import { createPatient } from "../../patients";
import { createPriceList, setPriceListItem } from "../../price-lists";
import { createReferrer } from "../../referrers";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";
import {
  accountCredit,
  allocatePayment,
  billedAppointmentIds,
  billingFigures,
  cancelDraftInvoice,
  claimLines,
  createCreditNote,
  createDraftInvoice,
  debtInvoices,
  caseContributionOverrides,
  contributionModeForCase,
  excessBilledForCase,
  getBillingSettings,
  getCreditNote,
  getInvoice,
  getPayment,
  issueInvoice,
  listAllocationsForInvoice,
  listCreditNotesForInvoice,
  listExportsForInvoice,
  listInvoices,
  listPaymentLinks,
  listPayments,
  markPaymentLink,
  openInvoicesFor,
  payerContributionModes,
  recordInvoiceExports,
  recordPayment,
  removeAllocation,
  reversePayment,
  savePaymentLink,
  setCaseContributionMode,
  setPayerContributionMode,
  setServiceVat,
  statementEntries,
  updateBillingSettings,
  updateDraftInvoice,
} from "..";

export interface BillingSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_reception_01", sessionId: "sess_01" };
const ACTOR_B = { userId: "user_other_clinic", sessionId: "sess_b" };

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

export function defineBillingRepoSuite(label: string, factory: () => Promise<BillingSuiteDb>): void {
  describe(`billing repositories on ${label}`, () => {
    let suite: BillingSuiteDb;
    let ctx: RepoContext;
    const clock = Date.parse("2026-10-24T09:00:00.000Z");
    const id: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      // The clinic directory and two patients (foundation repositories).
      const site = await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE" }, ACTOR);
      id.prac = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: site.id }, ACTOR)).id;
      id.ia = (await createService(ctx, A, { name: "Initial assessment", code: "IA", category: "initial", durationMinutes: 45, defaultPricePence: 7000 }, ACTOR)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up", code: "FU", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, ACTOR)).id;
      id.sm = (await createService(ctx, A, { name: "Sports massage", code: "SM", category: "treatment", durationMinutes: 45, defaultPricePence: 6000 }, ACTOR)).id;
      id.svcB = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30 }, ACTOR_B)).id;
      id.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health Insurance (fictional)", contactName: "Claims team", address: ["1 Claims Way (fictional)"], postcode: "MK9 9ZZ" }, ACTOR)).id;
      id.mlc = (await createReferrer(ctx, A, { kind: "mlc", name: "Meridian Medical Reporting (fictional)" }, ACTOR)).id;
      const list = await createPriceList(ctx, A, { name: "Northwell 2026", payerType: "insurer", referrerId: id.insurer }, ACTOR);
      await setPriceListItem(ctx, A, { priceListId: list.id, serviceId: id.fu, pricePence: 4800, billingCode: "NW-PHY-FU" }, ACTOR);
      await setPriceListItem(ctx, A, { priceListId: list.id, serviceId: id.ia, pricePence: 6500, billingCode: "NW-PHY-IA" }, ACTOR);
      id.list = list.id;
      id.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", address: ["14 Willow Bank (fictional)"], postcode: "MK3 9ZZ" }, ACTOR)).id;
      id.daniel = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19" }, ACTOR)).id;
      id.patientB = (await createPatient(ctx, B, { firstName: "Other", lastName: "Clinic" }, ACTOR_B)).id;
      id.selfCase = (await createCase(ctx, A, { patientId: id.megan, title: "Right knee", openedOn: "2026-10-01" }, ACTOR)).id;
      id.insCase = (
        await createCase(ctx, A, { patientId: id.daniel, title: "Lower back", openedOn: "2026-09-01", payerType: "insurer", payerReferrerId: id.insurer, membershipNumber: "NW-000123", excessPence: 5000, priceListId: list.id }, ACTOR)
      ).id;
      id.mlcCase = (await createCase(ctx, A, { patientId: id.megan, title: "Neck (road traffic accident)", openedOn: "2026-03-18", payerType: "mlc", payerReferrerId: id.mlc, claimReference: "MMR/2291" }, ACTOR)).id;
      id.auth = (await createAuthorisation(ctx, A, { caseId: id.insCase, referrerId: id.insurer, code: "NW-AUTH-0001", sessionsAuthorised: 4, valueAuthorisedPence: 30000 }, ACTOR)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("settings: defaults, a revisioned update, VAT number required, per-service VAT, clinic B unaffected", async () => {
      const s0 = await getBillingSettings(ctx, A);
      assert.deepEqual([s0.rev, s0.invoicePrefix, s0.creditNotePrefix, s0.vatRegistered, s0.accountTermsDays, s0.dnaChargePercent], [0, "INV", "CN", false, 30, 100]);
      const r1 = await updateBillingSettings(ctx, A, 0, { invoicePrefix: "riv", creditNotePrefix: "rcn", firstInvoiceNumber: 1000, accountTermsDays: 28, lateCancelChargePercent: 50 }, ACTOR);
      assert.deepEqual(r1.ok && r1.rev, 1);
      assert.deepEqual(await updateBillingSettings(ctx, A, 0, { invoicePrefix: "XX" }, ACTOR), { ok: false, reason: "conflict", currentRev: 1 });
      await rejects(updateBillingSettings(ctx, A, 1, { vatRegistered: true }, ACTOR), /VAT number/);
      await rejects(updateBillingSettings(ctx, A, 1, { creditNotePrefix: "RIV" }, ACTOR), /different prefix/);
      const s1 = await getBillingSettings(ctx, A);
      assert.deepEqual([s1.invoicePrefix, s1.creditNotePrefix, s1.firstInvoiceNumber, s1.accountTermsDays], ["RIV", "RCN", 1000, 28]);
      assert.equal((await getBillingSettings(ctx, B)).invoicePrefix, "INV", "another clinic keeps its own");
      await setServiceVat(ctx, A, id.sm, "standard", ACTOR);
      assert.equal((await getBillingSettings(ctx, A)).serviceVat[id.sm], "standard");
      await rejects(setServiceVat(ctx, B, id.sm, "standard", ACTOR_B), /does not exist/);
    });

    it("a self-pay draft from appointments: prices, the DNA charge, encrypted descriptions, lists never decrypt", async () => {
      const rules = { dnaChargePercent: 100, lateCancelChargePercent: 50 };
      const pricing = { listPricePence: 5500, billingCode: null, serviceName: "Follow-up", vatCode: "exempt" as const };
      const visit = { patientId: id.megan, caseId: id.selfCase, serviceId: id.fu, practitionerId: id.prac, siteId: null, startTime: "09:00" };
      const lines = [
        visitLine({ ...visit, appointmentId: "appt_01JABCDEF0000000000000001", date: "2026-10-14", status: "attended" }, pricing, rules),
        visitLine({ ...visit, appointmentId: "appt_01JABCDEF0000000000000002", date: "2026-10-21", status: "late_cancellation" }, pricing, rules),
      ].filter((l) => l !== null);
      const { invoice, excessInvoice } = await createDraftInvoice(ctx, A, { patientId: id.megan, caseId: id.selfCase, lines, notes: "Knee rehabilitation block" }, ACTOR);
      id.selfInv = invoice.id;
      assert.equal(excessInvoice, null);
      assert.equal(invoice.status, "draft");
      assert.equal(invoice.number, null, "a draft has no number");
      assert.deepEqual([invoice.billTo, invoice.payerType, invoice.payerReferrerId], ["patient", "self_pay", null]);
      assert.deepEqual(invoice.lines.map((l) => [l.description, l.unitPricePence, l.vatCode, l.totalPence]), [
        ["Follow-up", 5500, "none", 5500],
        ["Late cancellation – Follow-up", 2750, "none", 2750],
      ]);
      assert.deepEqual([invoice.totalPence, invoice.vatPence, invoice.firstServiceOn, invoice.lastServiceOn], [8250, 0, "2026-10-14", "2026-10-21"]);
      assert.equal(invoice.notes, "Knee rehabilitation block");
      const raw = await ctx.db.selectFrom("pms_invoice_lines").select(["description_enc"]).where("tenant_id", "=", A).where("invoice_id", "=", invoice.id).execute();
      assert.ok(raw.every((r) => r.description_enc?.startsWith("v1.") && !r.description_enc.includes("Follow")), "descriptions encrypted at rest");
      const rawInv = await ctx.db.selectFrom("pms_invoices").select("notes_enc").where("tenant_id", "=", A).where("id", "=", invoice.id).executeTakeFirstOrThrow();
      assert.ok(!String(rawInv.notes_enc).includes("Knee"));
      assert.equal(await getInvoice(ctx, B, invoice.id), null, "another clinic cannot read it");
      assert.deepEqual((await listInvoices(ctx, A, { state: "draft" })).map((i) => i.id), [invoice.id]);
      assert.equal((await listInvoices(ctx, B)).length, 0);
      await rejects(createDraftInvoice(ctx, A, { patientId: id.patientB, lines: [{ kind: "item", description: "x", unitPricePence: 1 }] }, ACTOR), /patient does not exist/);
      await rejects(createDraftInvoice(ctx, B, { patientId: id.patientB, lines: [{ serviceId: id.fu, serviceOn: "2026-10-01", unitPricePence: 1 }] }, ACTOR_B), /appointment type does not exist/);
      await rejects(createDraftInvoice(ctx, A, { patientId: id.megan, caseId: id.insCase, lines }, ACTOR), /not one of this patient's cases/);
      await rejects(createDraftInvoice(ctx, A, { patientId: id.megan, caseId: id.selfCase, billTo: "payer", lines: [{ kind: "item", description: "x", unitPricePence: 1 }] }, ACTOR), /no payer account/);
    });

    it("an appointment is billed once: a second draft is refused until the first is cancelled", async () => {
      const line = { serviceId: id.fu, appointmentId: "appt_01JABCDEF0000000000000001", serviceOn: "2026-10-14", unitPricePence: 5500 };
      await rejects(createDraftInvoice(ctx, A, { patientId: id.megan, lines: [line] }, ACTOR), /already on another invoice/);
      assert.deepEqual(Array.from(await billedAppointmentIds(ctx, A, ["appt_01JABCDEF0000000000000001", "appt_unbilled"])), ["appt_01JABCDEF0000000000000001"]);
      assert.equal((await billedAppointmentIds(ctx, B, ["appt_01JABCDEF0000000000000001"])).size, 0, "locks are per clinic");
      // A raw second line for the same appointment hits the database's own unique index.
      const other = await createDraftInvoice(ctx, A, { patientId: id.megan, lines: [{ kind: "item", description: "Exercise band", unitPricePence: 800 }] }, ACTOR);
      await assert.rejects(
        ctx.db
          .insertInto("pms_invoice_lines")
          .values({ tenant_id: A, id: "invl_raw", invoice_id: other.invoice.id, line_no: 2, kind: "service", service_id: id.fu, appointment_id: "appt_01JABCDEF0000000000000001", quantity: 1, unit_price_pence: 1, vat_code: "none", vat_rate_bp: 0, net_pence: 1, vat_pence: 0, total_pence: 1, created_at: "x", updated_at: "x" })
          .execute(),
      );
      assert.deepEqual(await cancelDraftInvoice(ctx, A, other.invoice.id, 2, ACTOR), { ok: false, reason: "conflict", currentRev: 1 });
      assert.deepEqual(await cancelDraftInvoice(ctx, A, other.invoice.id, 1, ACTOR), { ok: true, rev: 2 });
      assert.equal((await getInvoice(ctx, A, other.invoice.id))?.status, "cancelled", "kept, not deleted");
      assert.deepEqual(await cancelDraftInvoice(ctx, B, other.invoice.id, 2, ACTOR_B), { ok: false, reason: "not_found" });
    });

    it("editing a draft: revision-checked, lines replaced, a stale edit changes nothing", async () => {
      const inv = (await getInvoice(ctx, A, id.selfInv))!;
      const r = await updateDraftInvoice(ctx, A, inv.id, inv.rev, { lines: [...inv.lines.map((l) => ({ ...l, kind: l.kind, description: l.description })), { kind: "item", description: "Exercise band", unitPricePence: 800, quantity: 2 }] }, ACTOR);
      assert.deepEqual(r, { ok: true, rev: 2 });
      const edited = (await getInvoice(ctx, A, inv.id))!;
      assert.equal(edited.lines.length, 3);
      assert.equal(edited.totalPence, 8250 + 1600);
      assert.deepEqual(await updateDraftInvoice(ctx, A, inv.id, 1, { notes: "stale" }, ACTOR), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await updateDraftInvoice(ctx, A, inv.id, 1, { lines: [{ kind: "item", description: "Stale", unitPricePence: 1 }] }, ACTOR), { ok: false, reason: "conflict", currentRev: 2 });
      assert.equal((await getInvoice(ctx, A, inv.id))!.lines.length, 3, "the stale edit replaced no lines");
      assert.deepEqual(await updateDraftInvoice(ctx, B, inv.id, 2, { notes: "x" }, ACTOR_B), { ok: false, reason: "not_found" });
      assert.equal((await billedAppointmentIds(ctx, A, ["appt_01JABCDEF0000000000000002"])).size, 1, "the edited draft still holds its appointments");
    });

    it("issuing: the clinic's next number (from its first number), due date, frozen bill-to, never twice", async () => {
      await rejects(issueInvoice(ctx, A, id.selfInv, 2, { issuedOn: "2026-10-25" }, ACTOR), /future/);
      const r = await issueInvoice(ctx, A, id.selfInv, 2, {}, ACTOR);
      assert.ok(r.ok, JSON.stringify(r));
      const inv = r.ok ? r.invoice : null;
      assert.deepEqual([inv?.status, inv?.number, inv?.numberSeq, inv?.issuedOn, inv?.dueOn], ["issued", "RIV01000", 1000, "2026-10-24", "2026-10-24"]);
      assert.equal(inv?.billToSnapshot?.name, "Megan Hart");
      assert.deepEqual(inv?.billToSnapshot?.address, ["14 Willow Bank (fictional)"]);
      const raw = await ctx.db.selectFrom("pms_invoices").select("bill_to_enc").where("tenant_id", "=", A).where("id", "=", id.selfInv).executeTakeFirstOrThrow();
      assert.ok(!String(raw.bill_to_enc).includes("Megan"), "the bill-to snapshot is encrypted");
      assert.deepEqual(await issueInvoice(ctx, A, id.selfInv, 3, {}, ACTOR), { ok: false, reason: "not_draft" });
      await rejects(updateDraftInvoice(ctx, A, id.selfInv, 3, { notes: "x" }, ACTOR).then((x) => (x.ok ? x : Promise.reject(new RepoInputError(x.reason)))), /not_draft/);
      // More invoices issued at once get consecutive numbers.
      const drafts = await Promise.all(
        [1, 2, 3].map((n) => createDraftInvoice(ctx, A, { patientId: id.megan, lines: [{ kind: "item", description: `Item ${n}`, unitPricePence: 100 * n }] }, ACTOR)),
      );
      const issued = await Promise.all(drafts.map((d) => issueInvoice(ctx, A, d.invoice.id, 1, {}, ACTOR)));
      assert.deepEqual(issued.map((x) => (x.ok ? x.invoice.numberSeq : 0)).sort(), [1001, 1002, 1003]);
      id.small = drafts[0].invoice.id;
      const bDraft = await createDraftInvoice(ctx, B, { patientId: id.patientB, lines: [{ kind: "item", description: "B item", unitPricePence: 100 }] }, ACTOR_B);
      const bIssued = await issueInvoice(ctx, B, bDraft.invoice.id, 1, {}, ACTOR_B);
      assert.equal(bIssued.ok && bIssued.invoice.number, "INV00001", "each clinic numbers from its own start");
      assert.equal(await getInvoice(ctx, A, bDraft.invoice.id), null);
    });

    it("an insurer invoice: payer prices and codes, the excess split to the patient, the authorisation used and limited", async () => {
      const lines = [
        { serviceId: id.ia, practitionerId: id.prac, serviceOn: "2026-09-02", unitPricePence: 6500, appointmentId: "appt_01JABCDEF0000000000000010" },
        { serviceId: id.fu, practitionerId: id.prac, serviceOn: "2026-09-09", unitPricePence: 4800, appointmentId: "appt_01JABCDEF0000000000000011" },
      ];
      const { invoice, excessInvoice } = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: id.insCase, billTo: "payer", authorisationId: id.auth, diagnosisCode: "M54.5", lines }, ACTOR, { applyExcess: true });
      id.insInv = invoice.id;
      assert.ok(excessInvoice);
      id.excessInv = excessInvoice!.id;
      assert.deepEqual([invoice.billTo, invoice.payerType, invoice.payerReferrerId, invoice.relatedInvoiceId], ["payer", "insurer", id.insurer, excessInvoice!.id]);
      assert.deepEqual(invoice.lines.map((l) => [l.kind, l.billingCode, l.totalPence]), [
        ["service", "NW-PHY-IA", 6500],
        ["service", "NW-PHY-FU", 4800],
        ["excess_deduction", null, -5000],
      ]);
      assert.equal(invoice.totalPence, 6300, "the insurer pays the treatment less the excess");
      assert.equal(invoice.perVisitContributionPence, null, "excess per case (the default)");
      assert.deepEqual([excessInvoice!.billTo, excessInvoice!.totalPence, excessInvoice!.relatedInvoiceId, excessInvoice!.lines[0].kind], ["patient", 5000, invoice.id, "excess"]);
      assert.equal(await excessBilledForCase(ctx, A, id.insCase), 5000);
      // A second insurer invoice on the case: the excess is used up, nothing more goes to the patient.
      const second = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: id.insCase, billTo: "payer", authorisationId: id.auth, lines: [{ serviceId: id.fu, serviceOn: "2026-09-16", unitPricePence: 4800 }] }, ACTOR, { applyExcess: true });
      assert.equal(second.excessInvoice, null);
      id.insInv2 = second.invoice.id;
      const issued = await issueInvoice(ctx, A, invoice.id, 1, { issuedOn: "2026-09-10" }, ACTOR);
      assert.ok(issued.ok);
      assert.equal(issued.ok && issued.invoice.dueOn, "2026-10-08", "28 days for accounts");
      assert.deepEqual(issued.ok && issued.invoice.billToSnapshot?.references.map((r) => r.label), ["Patient", "Date of birth", "Membership number", "Authorisation code"]);
      assert.equal(issued.ok && issued.invoice.billToSnapshot?.name, "Northwell Health Insurance (fictional)");
      const auth = await getAuthorisation(ctx, A, id.auth);
      // Both lines bill DIARY visits: their sessions were counted by the diary when completed (not here – no
      // double count, M5 review). Billing counts the value.
      assert.deepEqual([auth?.sessionsUsed, auth?.valueUsedPence], [0, 6300]);
      // Over the value limit (30000): a big line is refused at issue, and the draft stays a draft.
      const big = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: id.insCase, billTo: "payer", authorisationId: id.auth, lines: [{ kind: "item", description: "Report", unitPricePence: 40000 }] }, ACTOR);
      const refused = await issueInvoice(ctx, A, big.invoice.id, 1, {}, ACTOR);
      assert.equal(refused.ok, false);
      assert.equal(!refused.ok && refused.reason, "authorisation");
      assert.equal((await getInvoice(ctx, A, big.invoice.id))?.status, "draft");
      assert.deepEqual([(await getAuthorisation(ctx, A, id.auth))?.valueUsedPence], [6300], "nothing used by the refused issue");
      await cancelDraftInvoice(ctx, A, big.invoice.id, 1, ACTOR);
      const ex = await issueInvoice(ctx, A, id.excessInv, (await getInvoice(ctx, A, id.excessInv))!.rev, {}, ACTOR);
      assert.ok(ex.ok);
      assert.equal(ex.ok && ex.invoice.billToSnapshot?.name, "Daniel Brooks");
    });

    it("VAT-registered: a standard-rated line inside a VAT-inclusive price, exempt treatment beside it", async () => {
      const s = await getBillingSettings(ctx, A);
      assert.ok((await updateBillingSettings(ctx, A, s.rev, { vatRegistered: true, vatNumber: "GB 000 0000 00" }, ACTOR)).ok);
      const { invoice } = await createDraftInvoice(
        ctx,
        A,
        { patientId: id.megan, lines: [{ serviceId: id.sm, serviceOn: "2026-10-20", unitPricePence: 6000 }, { serviceId: id.fu, serviceOn: "2026-10-20", unitPricePence: 5500 }] },
        ACTOR,
      );
      assert.deepEqual(invoice.lines.map((l) => [l.vatCode, l.vatRateBp, l.netPence, l.vatPence, l.totalPence]), [
        ["standard", 2000, 5000, 1000, 6000],
        ["exempt", 0, 5500, 0, 5500],
      ]);
      assert.deepEqual([invoice.netPence, invoice.vatPence, invoice.totalPence], [10500, 1000, 11500]);
      const r = await issueInvoice(ctx, A, invoice.id, 1, {}, ACTOR);
      assert.ok(r.ok);
      id.vatInv = invoice.id;
      // Splitting an excess over a VAT-able line is refused (bill it by hand).
      const vatCase = await createCase(ctx, A, { patientId: id.megan, title: "Shoulder", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.insurer, excessPence: 5000 }, ACTOR);
      await rejects(
        createDraftInvoice(ctx, A, { patientId: id.megan, caseId: vatCase.id, billTo: "payer", lines: [{ serviceId: id.sm, serviceOn: "2026-10-02", unitPricePence: 6000 }] }, ACTOR, { applyExcess: true }),
        /VAT-free/,
      );
      assert.ok((await updateBillingSettings(ctx, A, s.rev + 1, { vatRegistered: false }, ACTOR)).ok);
    });

    it("credit notes: numbered, VAT reversed in proportion, never more than charged, appointments released when fully credited", async () => {
      const inv = (await getInvoice(ctx, A, id.vatInv))!;
      const sm = inv.lines[0];
      const cn = await createCreditNote(ctx, A, { invoiceId: inv.id, lines: [{ invoiceLineId: sm.id, totalPence: 3000 }], reason: "Goodwill: shortened session" }, ACTOR);
      assert.deepEqual([cn.number, cn.netPence, cn.vatPence, cn.totalPence], ["RCN00001", 2500, 500, 3000]);
      assert.equal(cn.reason, "Goodwill: shortened session");
      const raw = await ctx.db.selectFrom("pms_credit_notes").select("reason_enc").where("tenant_id", "=", A).where("id", "=", cn.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.reason_enc).includes("Goodwill"));
      const cn2 = await createCreditNote(ctx, A, { invoiceId: inv.id, lines: [{ invoiceLineId: sm.id, totalPence: 3000 }], reason: "Rest of the session" }, ACTOR);
      assert.deepEqual([cn2.number, cn2.vatPence], ["RCN00002", 500], "the second credit takes exactly the VAT that is left");
      await rejects(createCreditNote(ctx, A, { invoiceId: inv.id, lines: [{ invoiceLineId: sm.id, totalPence: 1 }], reason: "Too much" }, ACTOR), /only 0 pence left/);
      await rejects(createCreditNote(ctx, B, { invoiceId: inv.id, lines: [{ invoiceLineId: sm.id, totalPence: 1 }], reason: "Other clinic" }, ACTOR_B), /does not exist/);
      assert.equal((await getCreditNote(ctx, B, cn.id)), null);
      assert.equal((await listCreditNotesForInvoice(ctx, A, inv.id)).length, 2);
      assert.equal((await getInvoice(ctx, A, inv.id))?.creditedPence, 6000);
      // The database itself refuses a line credited beyond its total (a raw write, outside the repository).
      await assert.rejects(ctx.db.updateTable("pms_invoice_lines").set({ credited_pence: 6001 }).where("tenant_id", "=", A).where("id", "=", sm.id).execute());

      // Fully crediting the insurer invoice gives its sessions and value back and frees its appointments.
      const ins = (await getInvoice(ctx, A, id.insInv))!;
      await rejects(createCreditNote(ctx, A, { invoiceId: ins.id, lines: [{ invoiceLineId: ins.lines[2].id, totalPence: 1 }], reason: "Deduction" }, ACTOR), /excess deduction is not credited/);
      const full = await createCreditNote(ctx, A, { invoiceId: ins.id, lines: [{ invoiceLineId: ins.lines[0].id, totalPence: 6300 }], reason: "Billed to the wrong insurer" }, ACTOR);
      assert.equal(full.totalPence, 6300);
      const after = (await getInvoice(ctx, A, ins.id))!;
      assert.equal(invoiceState(after, "2026-10-24"), "credited");
      assert.equal((await billedAppointmentIds(ctx, A, ["appt_01JABCDEF0000000000000010", "appt_01JABCDEF0000000000000011"])).size, 0, "both appointments can be billed again");
      const auth = await getAuthorisation(ctx, A, id.auth);
      assert.deepEqual([auth?.sessionsUsed, auth?.valueUsedPence], [0, 0]);
      assert.deepEqual([after.authSessions, after.authValuePence], [0, 0]);
      await rejects(createCreditNote(ctx, A, { invoiceId: id.insInv2, lines: [{ invoiceLineId: "invl_x", totalPence: 1 }], reason: "Draft" }, ACTOR), /Only an issued invoice/);
    });

    it("the patient's part: excess per case or contribution per visit (per payer account, case override); never a £0 payer invoice", async () => {
      const kestrel = await createReferrer(ctx, A, { kind: "insurer", name: "Kestrel Healthcare (fictional)" }, ACTOR);
      const referrerB = await createReferrer(ctx, B, { kind: "insurer", name: "Other insurer (fictional)" }, ACTOR_B);
      assert.equal((await contributionModeForCase(ctx, A, id.insCase, id.insurer)).mode, "per_case", "no row: the default");
      await setPayerContributionMode(ctx, A, kestrel.id, "per_visit", ACTOR);
      await rejects(setPayerContributionMode(ctx, A, referrerB.id, "per_visit", ACTOR), /does not exist/);
      assert.deepEqual(Array.from((await payerContributionModes(ctx, A)).entries()), [[kestrel.id, "per_visit"]]);
      assert.equal((await payerContributionModes(ctx, B)).size, 0, "clinic B sees none of A's");
      const caseOn = async (title: string, excessPence: number) =>
        (await createCase(ctx, A, { patientId: id.daniel, title, openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: kestrel.id, membershipNumber: "KE-1", excessPence }, ACTOR)).id;
      const fu = (on: string, appt: string) => ({ serviceId: id.fu, practitionerId: id.prac, serviceOn: on, unitPricePence: 4800, appointmentId: appt });

      // 1. Contribution per visit (from the account): £20 off every visit, never used up.
      const k1 = await caseOn("Left shoulder", 2000);
      assert.deepEqual(await contributionModeForCase(ctx, A, k1, kestrel.id), { mode: "per_visit", source: "payer", payerMode: "per_visit" });
      const one = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: k1, billTo: "payer", lines: [fu("2026-10-02", "appt_01JABCDEF0000000000000020"), fu("2026-10-09", "appt_01JABCDEF0000000000000021")] }, ACTOR, { applyExcess: true });
      assert.deepEqual(one.invoice.lines.map((l) => [l.kind, l.totalPence]), [["service", 4800], ["service", 4800], ["excess_deduction", -4000]]);
      assert.equal(one.invoice.lines[2].description, "Less: patient contributions billed to the patient");
      assert.deepEqual([one.invoice.billTo, one.invoice.totalPence, one.invoice.perVisitContributionPence], ["payer", 5600, 2000]);
      assert.deepEqual(one.excessInvoice!.lines.map((l) => [l.kind, l.totalPence, l.serviceOn, l.appointmentId]), [["excess", 2000, "2026-10-02", null], ["excess", 2000, "2026-10-09", null]]);
      assert.match(one.excessInvoice!.lines[0].description ?? "", /^Patient contribution – /);
      assert.deepEqual([one.excessInvoice!.totalPence, one.excessInvoice!.perVisitContributionPence, one.excessInvoice!.relatedInvoiceId], [4000, 2000, one.invoice.id]);
      assert.equal(await excessBilledForCase(ctx, A, k1), 0, "contributions never use up an excess");
      const again = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: k1, billTo: "payer", lines: [fu("2026-10-16", "appt_01JABCDEF0000000000000022")] }, ACTOR, { applyExcess: true });
      assert.deepEqual([again.invoice.totalPence, again.excessInvoice?.totalPence], [2800, 2000], "the next visit pays its £20 too");

      // 2. The contribution covers the whole visit: the visit is billed to the patient only – no £0 insurer invoice,
      //    nothing taken off the case's authorisation.
      const k2 = await caseOn("Right wrist", 5000);
      const auth2 = await createAuthorisation(ctx, A, { caseId: k2, referrerId: kestrel.id, code: "KE-AUTH-2", sessionsAuthorised: 6, valueAuthorisedPence: 30000 }, ACTOR);
      const whole = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: k2, billTo: "payer", authorisationId: auth2.id, lines: [fu("2026-10-03", "appt_01JABCDEF0000000000000023")] }, ACTOR, { applyExcess: true });
      assert.equal(whole.excessInvoice, null);
      assert.deepEqual([whole.invoice.billTo, whole.invoice.payerType, whole.invoice.totalPence, whole.invoice.authorisationId, whole.invoice.relatedInvoiceId], ["patient", "self_pay", 4800, null, null]);
      assert.deepEqual(whole.invoice.lines.map((l) => [l.kind, l.totalPence, l.appointmentId, l.visitStatus]), [["excess", 4800, "appt_01JABCDEF0000000000000023", null]]);
      assert.match(whole.invoice.lines[0].description ?? "", /patient contribution covers the visit$/);
      assert.deepEqual((await listInvoices(ctx, A, { caseId: k2 })).map((i) => i.billTo), ["patient"], "no payer invoice at all");
      assert.ok((await billedAppointmentIds(ctx, A, ["appt_01JABCDEF0000000000000023"])).has("appt_01JABCDEF0000000000000023"), "the visit is billed (once)");
      const wholeIssued = await issueInvoice(ctx, A, whole.invoice.id, whole.invoice.rev, {}, ACTOR);
      assert.ok(wholeIssued.ok);
      assert.deepEqual([(await getAuthorisation(ctx, A, auth2.id))?.valueUsedPence], [0], "nothing claimed against the authorisation");

      // 3. A case override (excess per case on a per-visit account): the first visit covered in full goes to the
      //    patient, the next one is split; the excess is then used up.
      const k3 = await caseOn("Hip", 6000);
      await setCaseContributionMode(ctx, A, k3, "per_case", ACTOR);
      assert.deepEqual(await contributionModeForCase(ctx, A, k3, kestrel.id), { mode: "per_case", source: "case", payerMode: "per_visit" });
      const mixed = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: k3, billTo: "payer", lines: [fu("2026-10-09", "appt_01JABCDEF0000000000000025"), fu("2026-10-02", "appt_01JABCDEF0000000000000024")] }, ACTOR, { applyExcess: true });
      assert.deepEqual(mixed.invoice.lines.map((l) => [l.kind, l.totalPence, l.appointmentId]), [["service", 4800, "appt_01JABCDEF0000000000000025"], ["excess_deduction", -1200, null]]);
      assert.deepEqual([mixed.invoice.totalPence, mixed.invoice.perVisitContributionPence], [3600, null]);
      assert.deepEqual(mixed.excessInvoice!.lines.map((l) => [l.kind, l.totalPence, l.appointmentId]), [["excess", 4800, "appt_01JABCDEF0000000000000024"], ["excess", 1200, null]]);
      assert.match(mixed.excessInvoice!.lines[0].description ?? "", /covered by the insurance excess$/);
      assert.equal(await excessBilledForCase(ctx, A, k3), 6000);
      // Back to "as the payer account".
      await setCaseContributionMode(ctx, A, k3, null, ACTOR);
      assert.equal((await contributionModeForCase(ctx, A, k3, kestrel.id)).source, "payer");
      assert.equal((await caseContributionOverrides(ctx, A, [k3])).size, 0);
      await rejects(setCaseContributionMode(ctx, B, k3, "per_visit", ACTOR_B), /does not exist/);

      // 4. Excess per case covering every visit: no £0 insurer invoice either.
      const n1 = (await createCase(ctx, A, { patientId: id.daniel, title: "Knee", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.insurer, excessPence: 25000 }, ACTOR)).id;
      const allExcess = await createDraftInvoice(ctx, A, { patientId: id.daniel, caseId: n1, billTo: "payer", lines: [fu("2026-10-04", "appt_01JABCDEF0000000000000026")] }, ACTOR, { applyExcess: true });
      assert.deepEqual([allExcess.invoice.billTo, allExcess.invoice.totalPence, allExcess.excessInvoice], ["patient", 4800, null]);
      assert.equal(await excessBilledForCase(ctx, A, n1), 4800, "the excess used so far");
      for (const inv of [one.invoice, one.excessInvoice!, again.invoice, again.excessInvoice!, mixed.invoice, mixed.excessInvoice!, allExcess.invoice]) await cancelDraftInvoice(ctx, A, inv.id, (await getInvoice(ctx, A, inv.id))!.rev, ACTOR).catch(() => undefined);
    });

    it("payments: allocated to the patient's invoices, never over-allocated, atomic refusals, reversal", async () => {
      const inv = (await getInvoice(ctx, A, id.selfInv))!;
      const pay = await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-10-24", method: "card", amountPence: 5000, reference: "Terminal 0042", allocations: [{ invoiceId: inv.id, amountPence: 5000 }] }, ACTOR);
      assert.deepEqual([pay.allocatedPence, pay.allocations.length], [5000, 1]);
      let now = (await getInvoice(ctx, A, inv.id))!;
      assert.deepEqual([now.paidPence, now.balancePence, invoiceState(now, "2026-10-24")], [5000, 4850, "part_paid"]);
      // Over the balance: refused by the database, and the whole payment is not recorded.
      const before = (await listPayments(ctx, A, { limit: 500 })).length;
      await rejects(recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-10-24", method: "cash", amountPence: 9000, allocations: [{ invoiceId: inv.id, amountPence: 9000 }] }, ACTOR), /more than the invoice still owes/);
      // To someone else's invoice (the insurer's): refused, nothing written.
      await rejects(recordPayment(ctx, A, { payerKind: "patient", patientId: id.daniel, receivedOn: "2026-10-24", method: "cash", amountPence: 100, allocations: [{ invoiceId: inv.id, amountPence: 100 }] }, ACTOR), /addressed to someone else/);
      // From another clinic: refused.
      await rejects(recordPayment(ctx, B, { payerKind: "patient", patientId: id.patientB, receivedOn: "2026-10-24", method: "cash", amountPence: 100, allocations: [{ invoiceId: inv.id, amountPence: 100 }] }, ACTOR_B), /addressed to someone else/);
      await rejects(recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-10-30", method: "cash", amountPence: 100 }, ACTOR), /future/);
      assert.equal((await listPayments(ctx, A, { limit: 500 })).length, before, "refused payments left no row");
      // The rest later, on account first, then allocated.
      const cash = await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-10-24", method: "cash", amountPence: 6000, notes: "Paid at the Bletchley desk" }, ACTOR);
      assert.equal(cash.notes, "Paid at the Bletchley desk");
      assert.equal(await accountCredit(ctx, A, { payerKind: "patient", patientId: id.megan }), 6000);
      await allocatePayment(ctx, A, cash.id, [{ invoiceId: inv.id, amountPence: 4850 }], ACTOR);
      await rejects(allocatePayment(ctx, A, cash.id, [{ invoiceId: inv.id, amountPence: 1 }], ACTOR), /already allocated|more than/);
      await rejects(allocatePayment(ctx, A, cash.id, [{ invoiceId: id.small, amountPence: 2000 }], ACTOR), /more than/);
      now = (await getInvoice(ctx, A, inv.id))!;
      assert.equal(invoiceState(now, "2026-10-24"), "paid");
      assert.equal(await accountCredit(ctx, A, { payerKind: "patient", patientId: id.megan }), 1150);
      assert.deepEqual((await listAllocationsForInvoice(ctx, A, inv.id)).map((a) => [a.method, a.amountPence]), [["card", 5000], ["cash", 4850]]);
      // Remove one allocation, then reverse the card payment: the invoice owes again.
      const alloc = (await getPayment(ctx, A, cash.id))!.allocations[0];
      assert.equal(await removeAllocation(ctx, A, alloc.id, ACTOR), true);
      assert.equal(await removeAllocation(ctx, A, alloc.id, ACTOR), false, "only once");
      assert.equal((await getInvoice(ctx, A, inv.id))?.paidPence, 5000);
      assert.equal(await reversePayment(ctx, A, pay.id, { reason: "Card payment declined later" }, ACTOR), true);
      assert.equal(await reversePayment(ctx, A, pay.id, { reason: "Again" }, ACTOR), false);
      assert.equal(await reversePayment(ctx, B, cash.id, { reason: "Other clinic" }, ACTOR_B), false);
      const rev = (await getPayment(ctx, A, pay.id))!;
      assert.deepEqual([rev.status, rev.allocatedPence, rev.reverseReason], ["reversed", 0, "Card payment declined later"]);
      assert.equal((await getInvoice(ctx, A, inv.id))?.paidPence, 0);
      await rejects(allocatePayment(ctx, A, pay.id, [{ invoiceId: inv.id, amountPence: 10 }], ACTOR), /reversed/);
      await allocatePayment(ctx, A, cash.id, [{ invoiceId: inv.id, amountPence: 6000 }], ACTOR);
      assert.equal((await getInvoice(ctx, A, inv.id))?.paidPence, 6000);
    });

    it("an insurer's remittance over several invoices; the rest stays on account; refunds after a credit", async () => {
      // Two issued insurer invoices on the MLC case.
      const mk = async (date: string, appt: string) => {
        const d = await createDraftInvoice(ctx, A, { patientId: id.megan, caseId: id.mlcCase, billTo: "payer", lines: [{ serviceId: id.fu, serviceOn: date, unitPricePence: 6500, appointmentId: appt }] }, ACTOR);
        const r = await issueInvoice(ctx, A, d.invoice.id, 1, { issuedOn: date }, ACTOR);
        assert.ok(r.ok);
        return d.invoice.id;
      };
      id.mlc1 = await mk("2026-06-01", "appt_01JABCDEF0000000000000020");
      id.mlc2 = await mk("2026-08-01", "appt_01JABCDEF0000000000000021");
      const open = await openInvoicesFor(ctx, A, { payerKind: "account", payerReferrerId: id.mlc });
      assert.deepEqual(open.map((i) => i.id), [id.mlc1, id.mlc2], "oldest first");
      const remit = await recordPayment(
        ctx,
        A,
        { payerKind: "account", payerReferrerId: id.mlc, receivedOn: "2026-10-20", method: "bank_transfer", amountPence: 10000, reference: "MMR remittance 77", allocations: [{ invoiceId: id.mlc1, amountPence: 6500 }, { invoiceId: id.mlc2, amountPence: 3000 }] },
        ACTOR,
      );
      assert.equal(remit.allocatedPence, 9500);
      assert.equal(await accountCredit(ctx, A, { payerKind: "account", payerReferrerId: id.mlc }), 500);
      await rejects(recordPayment(ctx, A, { payerKind: "account", payerReferrerId: id.mlc, receivedOn: "2026-10-20", method: "bank_transfer", amountPence: 100, allocations: [{ invoiceId: id.selfInv, amountPence: 100 }] }, ACTOR), /addressed to someone else/);
      // Refund: the first MLC invoice is credited after it was paid → refund due → refunded.
      const inv1 = (await getInvoice(ctx, A, id.mlc1))!;
      await createCreditNote(ctx, A, { invoiceId: inv1.id, lines: [{ invoiceLineId: inv1.lines[0].id, totalPence: 1500 }], reason: "Agreed reduction" }, ACTOR);
      const credited = (await getInvoice(ctx, A, id.mlc1))!;
      assert.deepEqual([credited.balancePence, invoiceState(credited, "2026-10-24")], [-1500, "refund_due"]);
      assert.deepEqual((await openInvoicesFor(ctx, A, { payerKind: "account", payerReferrerId: id.mlc }, "refund")).map((i) => i.id), [id.mlc1]);
      await rejects(recordPayment(ctx, A, { kind: "refund", payerKind: "account", payerReferrerId: id.mlc, receivedOn: "2026-10-24", method: "bank_transfer", amountPence: 2000, allocations: [{ invoiceId: id.mlc1, amountPence: 2000 }] }, ACTOR), /more than/);
      const refund = await recordPayment(ctx, A, { kind: "refund", payerKind: "account", payerReferrerId: id.mlc, receivedOn: "2026-10-24", method: "bank_transfer", amountPence: 1500, allocations: [{ invoiceId: id.mlc1, amountPence: 1500 }] }, ACTOR);
      assert.equal(refund.kind, "refund");
      const settled = (await getInvoice(ctx, A, id.mlc1))!;
      assert.deepEqual([settled.paidPence, settled.balancePence], [5000, 0]);
    });

    it("card payment links (test mode): saved per invoice, a provider payment recorded once", async () => {
      const inv = (await getInvoice(ctx, A, id.mlc2))!;
      await assert.rejects(savePaymentLink(ctx, A, { invoiceId: inv.id, provider: "stripe", providerLinkId: "plink_test_1", url: "http://insecure.example.com/x", amountPence: 3500 }, ACTOR), /https/);
      const link = await savePaymentLink(ctx, A, { invoiceId: inv.id, provider: "stripe", providerLinkId: "plink_test_1", url: "https://buy.stripe.com/test_abc", amountPence: 3500 }, ACTOR);
      assert.deepEqual([link.status, link.mode], ["active", "test"]);
      assert.equal((await listPaymentLinks(ctx, A, inv.id)).length, 1);
      assert.equal((await listPaymentLinks(ctx, B, inv.id)).length, 0);
      await recordPayment(ctx, A, { payerKind: "account", payerReferrerId: id.mlc, receivedOn: "2026-10-24", method: "online", amountPence: 3500, allocations: [{ invoiceId: inv.id, amountPence: 3500 }] }, ACTOR, { provider: "stripe", providerRef: "cs_test_1" });
      await rejects(recordPayment(ctx, A, { payerKind: "account", payerReferrerId: id.mlc, receivedOn: "2026-10-24", method: "online", amountPence: 3500 }, ACTOR, { provider: "stripe", providerRef: "cs_test_1" }), /already recorded/);
      await markPaymentLink(ctx, A, link.id, "paid", ACTOR);
      assert.equal((await listPaymentLinks(ctx, A, inv.id))[0].status, "paid");
      await rejects(markPaymentLink(ctx, B, link.id, "paid", ACTOR_B), /does not exist/);
    });

    it("e-billing: claim lines for insurer invoices, the CSV, the export log; Healthcode refused (not connected)", async () => {
      const { lines, skipped } = await claimLines(ctx, A, [id.mlc2, id.selfInv]);
      assert.deepEqual(skipped, [id.selfInv], "a patient's invoice is not a claim");
      assert.equal(lines.length, 1);
      assert.deepEqual([lines[0].payerName, lines[0].patientLastName, lines[0].claimReference, lines[0].practitionerRegistration, lines[0].totalPence], ["Meridian Medical Reporting (fictional)", "Hart", "MMR/2291", null, 6500]);
      assert.match(claimsCsv(lines), /Meridian Medical Reporting \(fictional\)/);
      await rejects(recordInvoiceExports(ctx, A, [id.mlc2], "healthcode", ACTOR), /not connected yet/);
      const { batchRef, count } = await recordInvoiceExports(ctx, A, [id.mlc2], "csv", ACTOR);
      assert.equal(count, 1);
      assert.deepEqual((await listExportsForInvoice(ctx, A, id.mlc2)).map((e) => [e.channel, e.batchRef]), [["csv", batchRef]]);
      assert.ok((await getInvoice(ctx, A, id.mlc2))?.exportedAt);
      await rejects(recordInvoiceExports(ctx, B, [id.mlc2], "csv", ACTOR_B), /does not exist/);
      assert.equal((await claimLines(ctx, B, [id.mlc2])).lines.length, 0, "another clinic gets nothing");
    });

    it("reports: aged debt by debtor, an account statement with a running balance, the billing figures", async () => {
      const { rows } = await debtInvoices(ctx, A);
      const aged = agedDebt(rows, "2026-10-24");
      assert.ok(aged.totals.totalPence > 0);
      assert.ok(aged.rows.every((r) => r.debtorKey.startsWith("account:") || r.debtorKey.startsWith("patient:")));
      assert.equal((await debtInvoices(ctx, B)).rows.length, 1, "clinic B: only its own invoice");
      const { entries } = await statementEntries(ctx, A, { payerKind: "account", payerReferrerId: id.mlc }, "2026-10-24");
      const st = buildStatement(entries, "2026-07-01", "2026-10-24");
      assert.equal(st.openingPence, 6500, "the June invoice is brought forward");
      // Invoices 6500 + 6500, credit 1500, payments 10000 + 3500, refund 1500 → owed −500 (on account).
      assert.equal(st.closingPence, 6500 + 6500 - 1500 - 10000 - 3500 + 1500);
      const f = await billingFigures(ctx, A);
      assert.ok(f.drafts >= 1 && f.outstandingCount >= 1, JSON.stringify(f));
    });

    it("every write was audited under its own clinic, with ids and amounts only", async () => {
      const a = await listAudit(ctx, A, { limit: 500 });
      const codes = new Set(a.map((e) => e.action));
      for (const code of [
        "pms.billing_settings.update",
        "pms.service_vat.set",
        "pms.invoice.create",
        "pms.invoice.excess_split",
        "pms.invoice.update",
        "pms.invoice.cancel",
        "pms.invoice.issue",
        "pms.credit_note.create",
        "pms.payment.record",
        "pms.refund.record",
        "pms.payment.allocate",
        "pms.payment.unallocate",
        "pms.payment.reverse",
        "pms.payment_link.create",
        "pms.payment_link.status",
        "pms.invoice.export",
        "pms.payer_terms.set",
        "pms.case_terms.set",
      ]) {
        assert.ok(codes.has(code), code);
      }
      const text = JSON.stringify(a);
      for (const secret of ["Megan", "Hart", "Brooks", "Knee", "Goodwill", "Bletchley desk", "M54.5", "Follow-up", "declined"]) assert.ok(!text.includes(secret), secret);
      assert.ok((await listAudit(ctx, B, { limit: 500 })).every((e) => e.userId === ACTOR_B.userId));
    });

    it("tenant-scope guard: every billing statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 100, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
