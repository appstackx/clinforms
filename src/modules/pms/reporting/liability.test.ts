/**
 * PK06 figures (pure): course and gift-card liability, product sales and stock (./liability.ts) and the fact checks
 * that guard them (./fact-checks.ts). Fictional figures only. Run by `npm run test:pms` and `npm run test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCourseFacts, checkGiftCardFacts, checkProductSaleFacts, checkStockFacts } from "./fact-checks";
import type { GiftCardFact } from "./facts";
import { courseLiability, giftCardLiability, lowStock, productSales, stockRows, unusedCourseValue, validOn } from "./liability";
import { REPORTS, REPORT_IDS, reportAccess, reportsFor } from "./catalogue";

const known = { siteIds: ["s1", "s2"], roomIds: [], practitionerIds: [] };

describe("PK06 liability figures (pure)", () => {
  it("valid on a day: the expiry day itself still counts; no expiry is always valid", () => {
    assert.equal(validOn("2026-11-06", "2026-11-06"), true);
    assert.equal(validOn("2026-11-06", "2026-11-07"), false);
    assert.equal(validOn(null, "2099-01-01"), true);
  });

  it("unused course value = net × unused ÷ total, halves away from zero, never below 0", () => {
    assert.equal(unusedCourseValue(24000, 6, 2), 16000);
    assert.equal(unusedCourseValue(10000, 3, 1), 6667, "6666.67 → 6667");
    assert.equal(unusedCourseValue(100, 8, 3), 63, "62.5 → 63");
    assert.equal(unusedCourseValue(30000, 6, 6), 0, "used up");
    assert.equal(unusedCourseValue(-500, 6, 0), 0, "credited beyond the line");
  });

  it("course liability by site: open courses, sessions, value, expiring in 30 days and sold in the period", () => {
    const r = courseLiability(
      [
        { siteId: "s1", expiresOn: "2026-12-01", sessionsTotal: 6, sessionsUsed: 2, netPence: 24000, courses: 1 },
        { siteId: "s2", expiresOn: null, sessionsTotal: 10, sessionsUsed: 0, netPence: 50000, courses: 2 },
        { siteId: "s2", expiresOn: "2026-12-11", sessionsTotal: 4, sessionsUsed: 4, netPence: 20000, courses: 1 },
      ],
      [{ date: "2026-11-02", siteId: "s1", courses: 2, amountPence: 60000 }],
      "2026-11-10",
    );
    assert.equal(r.expiringBy, "2026-12-10");
    const s1 = r.rows.find((x) => x.key === "s1");
    const s2 = r.rows.find((x) => x.key === "s2");
    assert.deepEqual([s1?.courses, s1?.sessionsLeft, s1?.unusedPence, s1?.expiringCourses, s1?.expiringPence, s1?.soldCourses, s1?.soldPence], [1, 4, 16000, 1, 16000, 2, 60000]);
    assert.deepEqual([s2?.courses, s2?.sessionsTotal, s2?.sessionsLeft, s2?.unusedPence, s2?.expiringCourses], [2, 20, 20, 100000, 0], "a used-up course holds nothing");
    assert.deepEqual([r.total.courses, r.total.unusedPence, r.total.sessionsUsed], [3, 116000, 2]);
  });

  it("gift-card movement reconciles: opening + sold − spent − credited − expired = closing (before and after the sweep)", () => {
    const f = (siteId: string, expiresOn: string | null, kind: GiftCardFact["kind"], when: GiftCardFact["when"], amountPence: number): GiftCardFact => ({ siteId, expiresOn, kind, when, moves: 1, amountPence });
    const before = [
      f("s1", "2028-01-01", "sale", "before", 5000),
      f("s1", "2028-01-01", "redeem", "in", -2000),
      f("s1", "2028-01-01", "sale", "in", 3000),
      f("s1", "2028-01-01", "adjust", "in", -1000),
      f("s2", "2026-11-11", "sale", "before", 4000),
      f("s2", "2026-11-11", "redeem", "in", -1000),
      f("s2", "2026-10-01", "sale", "before", 9000), // expired before the period: plays no part
      f("s2", "2026-10-01", "refund", "in", 500),
    ];
    const after = [...before, f("s2", "2026-11-11", "expire", "in", -3000), f("s2", "2026-10-01", "expire", "in", -9500)];
    for (const facts of [before, after]) {
      const r = giftCardLiability(facts, "2026-11-01", "2026-11-12");
      const s1 = r.rows.find((x) => x.key === "s1");
      const s2 = r.rows.find((x) => x.key === "s2");
      assert.deepEqual([s1?.openingPence, s1?.soldPence, s1?.spentPence, s1?.creditedPence, s1?.expiredPence, s1?.closingPence, s1?.cardsSold], [5000, 3000, 2000, 1000, 0, 5000, 1]);
      assert.deepEqual([s2?.openingPence, s2?.spentPence, s2?.expiredPence, s2?.closingPence], [4000, 1000, 3000, 0]);
      const t = r.total;
      assert.equal(t.openingPence + t.soldPence - t.spentPence - t.creditedPence - t.expiredPence, t.closingPence);
    }
    // As at its expiry day the card still counts.
    assert.equal(giftCardLiability(before, "2026-11-01", "2026-11-11").rows.find((x) => x.key === "s2")?.closingPence, 3000);
  });

  it("product sales: sold less credited; units given back; stock value at sale price, low-stock flags", () => {
    const s = productSales([
      { date: "2026-11-10", siteId: "s1", productId: "p1", kind: "sold", lines: 2, quantity: 5, netPence: 3542, vatPence: 708 },
      { date: "2026-11-11", siteId: "s1", productId: "p1", kind: "credited", lines: 1, quantity: 1, netPence: 708, vatPence: 142 },
    ]);
    assert.deepEqual(s.rows.map((r) => [r.quantitySold, r.quantityReturned, r.netPence, r.vatPence]), [[5, 1, 2834, 566]]);
    const products = [
      { id: "p1", name: "Tape", sku: null, pricePence: 850, lowStockAt: 3, active: true },
      { id: "p2", name: "Band", sku: null, pricePence: 1200, lowStockAt: null, active: true },
    ];
    const st = stockRows(
      [
        { siteId: "s1", productId: "p1", onHand: 3 },
        { siteId: "s2", productId: "p2", onHand: -1 },
      ],
      products,
    );
    assert.deepEqual(st.rows.map((r) => [r.onHand, r.valuePence, r.low]), [
      [3, 2550, true],
      [-1, 0, false],
    ]);
    assert.equal(st.valuePence, 2550);
    assert.equal(lowStock(4, 3), false);
  });

  it("fact checks drop another site's rows, unknown products, expired courses and bad numbers", () => {
    const f = { siteIds: ["s1"], known };
    assert.equal(checkCourseFacts([{ siteId: "s2", expiresOn: null, sessionsTotal: 6, sessionsUsed: 0, netPence: 1, courses: 1 }], { ...f, asAt: "2026-11-10" }).dropped, 1);
    assert.equal(checkCourseFacts([{ siteId: "s1", expiresOn: "2026-11-09", sessionsTotal: 6, sessionsUsed: 0, netPence: 1, courses: 1 }], { ...f, asAt: "2026-11-10" }).dropped, 1);
    assert.equal(checkCourseFacts([{ siteId: "s1", expiresOn: "2026-11-10", sessionsTotal: 6, sessionsUsed: 7, netPence: 1, courses: 1 }], { ...f, asAt: "2026-11-10" }).dropped, 1);
    assert.equal(checkCourseFacts([{ siteId: "s1", expiresOn: "2026-11-10", sessionsTotal: 6, sessionsUsed: 1, netPence: 1, courses: 1 }], { ...f, asAt: "2026-11-10" }).facts.length, 1);
    assert.equal(checkGiftCardFacts([{ siteId: null, expiresOn: null, kind: "sale", when: "in", moves: 1, amountPence: 100 }], f).dropped, 1, "no site only when the whole clinic is asked for");
    assert.equal(checkGiftCardFacts([{ siteId: null, expiresOn: null, kind: "sale", when: "in", moves: 1, amountPence: 100 }], { siteIds: null, known }).facts.length, 1);
    assert.equal(checkProductSaleFacts([{ date: "2026-11-10", siteId: "s1", productId: "p9", kind: "sold", lines: 1, quantity: 1, netPence: 1, vatPence: 0 }], { ...f, from: "2026-11-01", to: "2026-11-30", productIds: ["p1"] }).dropped, 1);
    assert.equal(checkStockFacts([{ siteId: "s1", productId: "p1", onHand: 1.5 }], { ...f, productIds: ["p1"] }).dropped, 1);
  });

  it("catalogue: the three reports are Finance reports for reports.all only, with a period", () => {
    for (const id of ["course-liability", "gift-card-liability", "products"] as const) {
      assert.ok(REPORT_IDS.includes(id));
      assert.equal(REPORTS[id].group, "Finance");
      assert.equal(REPORTS[id].filters.period, true);
      assert.equal(reportAccess(id, (p) => p === "reports.own"), null);
      assert.equal(reportAccess(id, (p) => p === "reports.all"), "all");
    }
    assert.deepEqual(reportsFor((p) => p === "reports.all").find((g) => g.group === "Finance")?.reports.map((r) => r.id), ["revenue", "debtors", "authorisations", "course-liability", "gift-card-liability", "products"]);
  });
});
