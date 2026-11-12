/**
 * TESTS ONLY (run by ../pk06-reports.test.ts on node:sqlite and PGlite and by workers/data-gateway/test/pk06-stack.test.ts on D1).
 * PK06 reports on node:sqlite and PGlite with billing's real reporting source and the tenant-scope guard: Course
 * liability, Gift card liability, Products and stock – hand-worked figures over two sites, "as at" a date (the expiry
 * day itself still counts), the same figures before and after the expiry sweep, permissions (reports.all; CSV with
 * reports.export, formula cells defused, audited), a site-limited member sees only their site, another clinic's
 * rows never show. Fictional clinics, patients and products only. Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { courseSaleLine } from "../../../../modules/pms/billing/courses";
import { testCipher } from "../../../db/testing/databases";
import { listAudit } from "../../../repos/audit";
import type { RepoContext } from "../../../repos/context";
import { cancelPatientCourse } from "../../../repos/pms/billing/course-cancel";
import { createCourseType, getCourseType, listPatientCourses, recordCourseUse } from "../../../repos/pms/billing/courses";
import { createCreditNote, voidInvoice } from "../../../repos/pms/billing/credit-notes";
import { sweepExpiredForTenant } from "../../../repos/pms/billing/expiry";
import { createDraftInvoice, issueInvoice } from "../../../repos/pms/billing/invoices";
import { createProduct, recordStockChange } from "../../../repos/pms/billing/products";
import { updateBillingSettings } from "../../../repos/pms/billing/settings";
import { createService, createSite } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { unscopedStatements, type QueryLog } from "../../../repos/pms/testing/guarded-db";
import { testActor } from "../../records/access";
import { reportCsvFor, reportPageFor, type ReportView } from "../../reporting/service";
import { sellGiftCardFor } from "../gift-cards";
import { takePaymentFor } from "../writes";

export interface Pk06SuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-pk06";
const B = "harbour-pk06";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
const appt = (n: number) => `appt_01JPK06REPORT0000000000${String(n).padStart(2, "0")}`;

function stat(view: ReportView, id: string): string {
  const s = view.stats.find((x) => x.id === id);
  assert.ok(s, `stat ${id}`);
  return s.value;
}
function rows(view: ReportView, table: string): string[][] {
  const t = view.tables.find((x) => x.id === table);
  assert.ok(t, `table ${table}`);
  return t.rows.map((r) => r.cells);
}

export function definePk06ReportsSuite(label: string, factory: () => Promise<Pk06SuiteDb>): void {
  describe(`PK06 reports on ${label}`, () => {
    let db: Pk06SuiteDb;
    let ctx: RepoContext;
    let clock = "2026-11-10T10:00:00.000Z";
    const id: Record<string, string> = {};
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" });
    const adminS1 = () => testActor(ctx, A, "admin", { userId: "user_admin_01", name: "Sam Admin (fictional)" }, { siteIds: [id.s1] });
    const clinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_01", name: "Priya Shah (fictional)" });
    const reception = () => testActor(ctx, A, "staff", { userId: "user_recep_01", name: "Jess Taylor (fictional)" });
    const ownerB = () => testActor(ctx, B, "owner", { userId: "user_owner_b", name: "Other Owner (fictional)" });
    const period = (from: string, to: string) => ({ period: "custom", from, to, site: "all" });
    const page = async (actor: ReturnType<typeof owner>, report: Parameters<typeof reportPageFor>[1], q: Record<string, string>) => {
      const r = await reportPageFor(actor, report, q, { now: new Date(clock) });
      if (!r.ok) assert.fail(`${report}: ${r.error}`);
      return r.value.view;
    };
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };

    async function sellCourse(tenant: string, patient: string, typeId: string, siteId: string, issuedOn: string) {
      const type = (await getCourseType(ctx, tenant, typeId))!;
      const { invoice } = await createDraftInvoice(ctx, tenant, { patientId: patient, siteId, lines: [courseSaleLine(type)] }, SEED, { lineRefs: [{ lineIndex: 0, refType: "course", refId: type.id }] });
      const issued = await issueInvoice(ctx, tenant, invoice.id, invoice.rev, { issuedOn }, SEED);
      assert.ok(issued.ok);
      const course = (await listPatientCourses(ctx, tenant, [patient])).find((c) => c.saleInvoiceId === invoice.id)!;
      return { invoice: issued.invoice, course };
    }
    async function owing(patient: string, siteId: string, pence: number) {
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: patient, siteId, lines: [{ kind: "item", description: "Exercise class (fictional)", unitPricePence: pence }] }, SEED);
      const r = await issueInvoice(ctx, A, invoice.id, invoice.rev, {}, SEED);
      assert.ok(r.ok);
      return invoice.id;
    }

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date(clock) };
      await updateBillingSettings(ctx, A, 0, { vatRegistered: true, vatNumber: "GB123456789" }, SEED);
      id.s1 = (await createSite(ctx, A, { name: "Harbour Road (fictional)" }, SEED)).id;
      id.s2 = (await createSite(ctx, A, { name: "Mill Lane (fictional)" }, SEED)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Owen", lastName: "Price", dateOfBirth: "1990-12-02" }, SEED)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      // Courses: 6 follow-ups £300 valid 30 days; 10 sessions £500 no expiry; a 2-session taster £100 valid 5 days.
      id.six = (await createCourseType(ctx, A, { name: "6 follow-ups", serviceIds: [id.fu], sessions: 6, pricePence: 30000, validDays: 30 }, SEED)).id;
      id.ten = (await createCourseType(ctx, A, { name: "10 sessions", serviceIds: [id.fu], sessions: 10, pricePence: 50000 }, SEED)).id;
      id.taster = (await createCourseType(ctx, A, { name: "Taster", serviceIds: [id.fu], sessions: 2, pricePence: 10000, validDays: 5 }, SEED)).id;
      const c1 = await sellCourse(A, id.patient, id.six, id.s1, "2026-11-02"); // expires 01/12/2026
      for (const [n, d] of [
        [1, "2026-11-03"],
        [2, "2026-11-05"],
      ] as const)
        await recordCourseUse(ctx, A, { patientCourseId: c1.course.id, appointmentId: appt(n), usedOn: d, patientId: id.patient, serviceId: id.fu, caseId: null }, SEED);
      // A £60 discount credited on 10/11 (net 240 → 4 of 6 unused = £160).
      await createCreditNote(ctx, A, { invoiceId: c1.invoice.id, lines: [{ invoiceLineId: c1.invoice.lines[0].id, totalPence: 6000 }], reason: "Discount agreed" }, SEED);
      await sellCourse(A, id.patient, id.ten, id.s2, "2026-11-02");
      const c3 = await sellCourse(A, id.patient, id.six, id.s1, "2026-11-03");
      await cancelPatientCourse(ctx, A, c3.course.id, { reason: "Moved away" }, SEED);
      const taster = await sellCourse(A, id.patient, id.taster, id.s2, "2026-11-02"); // expires 06/11/2026
      assert.equal(taster.course.expiresOn, "2026-11-06");

      // Another clinic with a course that must never show.
      id.patientB = (await createPatient(ctx, B, { firstName: "Ada", lastName: "Stone", dateOfBirth: "1985-03-04" }, SEED)).id;
      const fuB = (await createService(ctx, B, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5000 }, SEED)).id;
      const typeB = (await createCourseType(ctx, B, { name: "B course", serviceIds: [fuB], sessions: 4, pricePence: 99900 }, SEED)).id;
      await sellCourse(B, id.patientB, typeB, (await createSite(ctx, B, { name: "Other site (fictional)" }, SEED)).id, "2026-11-02");

      // Products: tape £8.50 (warn at 3) at site 1, a band whose name starts like a formula at site 2 (warn at 2).
      id.tape = (await createProduct(ctx, A, { name: "Kinesiology tape (fictional)", sku: "TAPE-5CM", pricePence: 850, lowStockAt: 3 }, SEED)).id;
      id.band = (await createProduct(ctx, A, { name: "=HYPERLINK(band) (fictional)", pricePence: 1200, lowStockAt: 2 }, SEED)).id;
      await recordStockChange(ctx, A, { productId: id.tape, siteId: id.s1, kind: "received", quantity: 10 }, SEED);
      await recordStockChange(ctx, A, { productId: id.band, siteId: id.s2, kind: "received", quantity: 2 }, SEED);
      const sell = async (productId: string, siteId: string, quantity: number, unitPricePence: number) => {
        const { invoice } = await createDraftInvoice(ctx, A, { patientId: id.patient, siteId, lines: [{ kind: "item", description: "Product", quantity, unitPricePence, vatCode: "standard" }] }, SEED, { lineRefs: [{ lineIndex: 0, refType: "product", refId: productId }] });
        const r = await issueInvoice(ctx, A, invoice.id, invoice.rev, {}, SEED);
        assert.ok(r.ok);
        return r.invoice;
      };
      const tapeInv = await sell(id.tape, id.s1, 3, 850);
      id.tapeNet = String(tapeInv.lines[0].netPence);
      id.tapeVat = String(tapeInv.lines[0].vatPence);
      const bandInv = await sell(id.band, id.s2, 1, 1200);
      await createCreditNote(ctx, A, { invoiceId: bandInv.id, lines: [{ invoiceLineId: bandInv.lines[0].id, totalPence: bandInv.lines[0].totalPence }], reason: "Returned unopened" }, SEED);

      // Gift cards (sold today, 10/11): £50 at site 1 (£20 spent), £40 at site 2 that expires on 11/11/2026.
      const g1 = ok(await sellGiftCardFor(owner(), id.patient, { amountPence: 5000, siteId: id.s1, issue: true }));
      const g2 = ok(await sellGiftCardFor(owner(), id.patient, { amountPence: 4000, siteId: id.s2, issue: true }));
      id.g2 = g2.giftCardId;
      id.g2code = g2.code;
      // TEST ONLY: a short validity so the expiry falls inside the test's days (cards are sold for 24 months).
      await db.db.updateTable("pms_gift_cards").set({ expires_on: "2026-11-11" }).where("tenant_id", "=", A).where("id", "=", g2.giftCardId).execute();
      const inv20 = await owing(id.patient, id.s1, 2000);
      ok(await takePaymentFor(owner(), { patientId: id.patient, method: "gift_card", amountPence: 2000, giftCardCode: g1.code, allocations: [{ invoiceId: inv20, amountPence: 2000 }] }));
    });
    after(async () => {
      await db?.close();
    });

    it("course liability as at 10/11/2026: unused value net of credits, cancelled and expired courses out, sold in the period", async () => {
      const v = await page(owner(), "course-liability", period("2026-11-01", "2026-11-10"));
      assert.equal(stat(v, "unused-value"), "£660.00", "£160 (4 of 6, net £240) + £500 (10 of 10)");
      assert.equal(stat(v, "open-courses"), "2");
      assert.equal(stat(v, "expiring"), "£160.00");
      assert.match(v.stats[0].sub, /As at 10\/11\/2026 · 14 sessions left/);
      assert.deepEqual(rows(v, "sites"), [
        ["Harbour Road (fictional)", "2", "£600.00", "1", "6", "2", "4", "£160.00", "£160.00"],
        ["Mill Lane (fictional)", "2", "£600.00", "1", "10", "0", "10", "£500.00", "£0.00"],
      ]);
    });

    it("course liability as at 06/11/2026: the taster counts on its expiry day; the later credit and cancellation are not yet there", async () => {
      const v = await page(owner(), "course-liability", period("2026-11-01", "2026-11-06"));
      assert.deepEqual(
        rows(v, "sites").map((r) => [r[0], r[3], r[7]]),
        [
          ["Harbour Road (fictional)", "2", "£500.00"], // 4 of 6 × £300 = £200, + the cancelled course's £300 (cancelled on 10/11)
          ["Mill Lane (fictional)", "2", "£600.00"], // £500 + the taster £100
        ],
      );
      const nextDay = await page(owner(), "course-liability", period("2026-11-01", "2026-11-07"));
      assert.equal(rows(nextDay, "sites")[1][7], "£500.00", "the day after its expiry the taster holds nothing");
    });

    it("gift card liability: sold, spent and still to be spent; expired on the day after its expiry – the same before and after the sweep", async () => {
      const v = await page(owner(), "gift-card-liability", period("2026-11-01", "2026-11-10"));
      assert.equal(stat(v, "outstanding"), "£70.00");
      assert.equal(stat(v, "sold"), "£90.00");
      assert.equal(stat(v, "spent"), "£20.00");
      assert.deepEqual(rows(v, "sites"), [
        ["Harbour Road (fictional)", "£0.00", "£50.00", "£20.00", "£0.00", "£0.00", "£30.00"],
        ["Mill Lane (fictional)", "£0.00", "£40.00", "£0.00", "£0.00", "£0.00", "£40.00"],
        ["Total", "£0.00", "£90.00", "£20.00", "£0.00", "£0.00", "£70.00"],
      ]);
      // 11/11: the expiry day itself – £10 can still be spent.
      clock = "2026-11-11T16:00:00.000Z";
      const inv10 = await owing(id.patient, id.s2, 1000);
      ok(await takePaymentFor(owner(), { patientId: id.patient, method: "gift_card", amountPence: 1000, giftCardCode: id.g2code, allocations: [{ invoiceId: inv10, amountPence: 1000 }] }));
      // 12/11: expired – no spend, even before the sweep.
      clock = "2026-11-12T09:00:00.000Z";
      const inv5 = await owing(id.patient, id.s2, 500);
      const refused = await takePaymentFor(owner(), { patientId: id.patient, method: "gift_card", amountPence: 500, giftCardCode: id.g2code, allocations: [{ invoiceId: inv5, amountPence: 500 }] });
      assert.ok(!refused.ok && /expired/.test(refused.error));
      const q = period("2026-11-01", "2026-11-12");
      const beforeSweep = await page(owner(), "gift-card-liability", q);
      assert.deepEqual(rows(beforeSweep, "sites")[1], ["Mill Lane (fictional)", "£0.00", "£40.00", "£10.00", "£0.00", "£30.00", "£0.00"]);
      assert.equal(stat(beforeSweep, "outstanding"), "£30.00");
      const swept = await sweepExpiredForTenant(ctx, A);
      assert.deepEqual([swept.giftCards, swept.giftCardPence], [1, 3000]);
      const afterSweep = await page(owner(), "gift-card-liability", q);
      assert.deepEqual(afterSweep.tables, beforeSweep.tables, "the sweep changes no figure");
      assert.deepEqual(afterSweep.stats, beforeSweep.stats);
      // As at 11/11 the card still held £30.
      assert.equal(stat(await page(owner(), "gift-card-liability", period("2026-11-01", "2026-11-11")), "outstanding"), "£60.00");
      clock = "2026-11-10T10:00:00.000Z";
    });

    it("products and stock: sold less credited by product and site, VAT, stock value at sale price, low-stock flags", async () => {
      const v = await page(owner(), "products", period("2026-11-01", "2026-11-30"));
      const net = Number(id.tapeNet);
      const vat = Number(id.tapeVat);
      assert.ok(vat > 0, "a VAT-registered clinic charges VAT on the tape");
      const gbp = (p: number) => `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      assert.deepEqual(rows(v, "sales"), [
        ["=HYPERLINK(band) (fictional)", "Mill Lane (fictional)", "1", "1", "£0.00", "£0.00", "£0.00"],
        ["Kinesiology tape (fictional)", "Harbour Road (fictional)", "3", "0", gbp(net), gbp(vat), gbp(net + vat)],
      ]);
      assert.deepEqual(rows(v, "stock"), [
        ["=HYPERLINK(band) (fictional)", "Mill Lane (fictional)", "2", "£24.00", "Low"],
        ["Kinesiology tape (fictional)", "Harbour Road (fictional)", "7", "£59.50", ""],
      ]);
      assert.equal(stat(v, "stock-value"), "£83.50");
      assert.equal(stat(v, "low-stock"), "1");
      assert.equal(stat(v, "net-sales"), gbp(net));
    });

    it("permissions: reports.all only (clinicians and reception get nothing); CSV needs Export data, is audited, formula cells defused", async () => {
      for (const actor of [clinician(), reception()]) {
        for (const report of ["course-liability", "gift-card-liability", "products"] as const) {
          const r = await reportPageFor(actor, report, {}, { now: new Date(clock) });
          assert.ok(!r.ok && r.code === "forbidden", `${actor.role} ${report}`);
        }
      }
      const noExport = testActor(ctx, A, "admin", { userId: "user_admin_02", name: "No Export (fictional)" }, { exceptions: { "reports.export": false } });
      assert.equal((await reportCsvFor(noExport, "products", {}, { now: new Date(clock) })).ok, false);
      const csv = ok(await reportCsvFor(owner(), "products", period("2026-11-01", "2026-11-30"), { now: new Date(clock) }));
      assert.ok(csv.csv.includes("'=HYPERLINK(band) (fictional)"), "a name starting with = is written as text");
      assert.ok(!/(^|,)=HYPERLINK/m.test(csv.csv));
      assert.match(csv.fileName, /^products-riverside-pk06-2026-11-01-to-2026-11-30\.csv$/);
      const courses = ok(await reportCsvFor(owner(), "course-liability", period("2026-11-01", "2026-11-10"), { now: new Date(clock) }));
      assert.match(courses.csv, /\r\ntotal,All,2026-11-10,4,1200,2,16,2,14,660,1,4,160\r\n$/);
      const actions = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.action === "pms.report.export").map((e) => e.targetId);
      assert.ok(actions.includes("products") && actions.includes("course-liability"));
    });

    it("site scope: a member limited to Harbour Road sees only it; another clinic's courses never show", async () => {
      const v = await page(adminS1(), "course-liability", period("2026-11-01", "2026-11-10"));
      assert.deepEqual(
        rows(v, "sites").map((r) => r[0]),
        ["Harbour Road (fictional)"],
      );
      assert.equal(stat(v, "unused-value"), "£160.00");
      const p = await page(adminS1(), "products", period("2026-11-01", "2026-11-30"));
      assert.deepEqual(
        rows(p, "stock").map((r) => r[1]),
        ["Harbour Road (fictional)"],
      );
      const g = await page(adminS1(), "gift-card-liability", period("2026-11-01", "2026-11-10"));
      assert.equal(stat(g, "outstanding"), "£30.00");
      const b = await page(ownerB(), "course-liability", period("2026-11-01", "2026-11-10"));
      assert.equal(stat(b, "unused-value"), "£999.00", "clinic B sees its own course only");
    });

    it("course liability: a course whose sale invoice was voided is not 'sold in the period' (as Revenue and Products)", async () => {
      clock = "2026-11-20T10:00:00.000Z";
      const q = period("2026-11-15", "2026-11-20");
      const before = rows(await page(owner(), "course-liability", q), "sites").find((r) => r[0] === "Mill Lane (fictional)")!;
      const sold = await sellCourse(A, id.patient, id.taster, id.s2, "2026-11-20");
      const withSale = rows(await page(owner(), "course-liability", q), "sites").find((r) => r[0] === "Mill Lane (fictional)")!;
      assert.deepEqual([withSale[1], withSale[2]], [String(Number(before[1]) + 1), "£100.00"]);
      await voidInvoice(ctx, A, sold.invoice.id, { reason: "Sold by mistake (fictional)" }, SEED);
      const v = await page(owner(), "course-liability", q);
      const after = rows(v, "sites").find((r) => r[0] === "Mill Lane (fictional)")!;
      assert.deepEqual([after[1], after[2]], [before[1], before[2]], "the voided sale is left out");
      assert.match(v.footnote ?? "", /a voided sale invoice is left out \(as in Revenue and Products\)/);
      clock = "2026-11-10T10:00:00.000Z";
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      if (db.log) assert.deepEqual(unscopedStatements(db.log.statements), []);
    });
  });
}
