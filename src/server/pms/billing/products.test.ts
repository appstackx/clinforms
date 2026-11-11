/**
 * Products and stock (PK05) on node:sqlite and PGlite: Set-up → Products (settings.setup, whole clinic), stock per site
 * (received, adjusted with a reason), selling on a patient's record (stock leaves on ISSUE, at the invoice's site),
 * crediting a line in full or voiding puts it back once, a partial credit does not; offboarding; the tenant-scope
 * guard. Fictional data only. Run by `npm run test:db` and `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { isLowStock } from "../../../modules/pms/billing/products";
import { testCipher } from "../../db/testing/databases";
import { runBatch } from "../../db/batch";
import { PRODUCT_CASCADE_DELETED_TABLES } from "../../db/pms-schema/billing";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { createCreditNote, voidInvoice } from "../../repos/pms/billing/credit-notes";
import { createDraftInvoice, getInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { stockOnHand } from "../../repos/pms/billing/products";
import { createSite } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import type { SetupActor } from "../reporting/setup";
import { countPmsRows, deletePmsQueries } from "../offboard";
import { testActor } from "./access";
import { productsScreenFor, recordStockChangeFor, saveProductFor, sellProductFor, stockScreenFor } from "./products";

const A = "riverside-stock";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };

describe("products (pure)", () => {
  it("low stock: at or below the level; no level, no warning", () => {
    assert.equal(isLowStock(3, 3), true);
    assert.equal(isLowStock(4, 3), false);
    assert.equal(isLowStock(0, null), false);
  });
});

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`products and stock on ${label}`, () => {
    let db: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" });
    const reception = () => testActor(ctx, A, "staff", { userId: "user_reception_01", name: "Jess Taylor (fictional)" });
    const siteStaff = () => testActor(ctx, A, "admin", { userId: "user_admin_02", name: "Sam Site (fictional)" }, { siteIds: [id.site2] });
    const setup = (a: ReturnType<typeof testActor>) => ({ ...a, organizationId: `org_${A}` }) as unknown as SetupActor;
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };
    const onHand = async (site = id.site) => (await stockOnHand(ctx, A, site)).get(id.tape) ?? 0;

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date("2026-11-10T10:00:00.000Z") };
      id.site = (await createSite(ctx, A, { name: "Harbour Road (fictional)" }, SEED)).id;
      id.site2 = (await createSite(ctx, A, { name: "Mill Lane (fictional)" }, SEED)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Owen", lastName: "Price", dateOfBirth: "1990-12-02" }, SEED)).id;
    });
    after(async () => {
      await db?.close();
    });

    it("Set-up → Products: settings.setup and every site; fields named; a SKU once per clinic", async () => {
      assert.equal((await saveProductFor(setup(reception()), { name: "x" })).ok, false);
      assert.equal((await saveProductFor(setup(siteStaff()), { name: "x", price: "1" })).ok, false, "a site-limited admin cannot");
      const bad = await saveProductFor(setup(owner()), { name: "", price: "abc", lowStockAt: "x" });
      assert.ok(!bad.ok && bad.fieldErrors && "name" in bad.fieldErrors && "pricePence" in bad.fieldErrors, JSON.stringify(bad));
      id.tape = ok(await saveProductFor(setup(owner()), { name: "Kinesiology tape (fictional)", sku: "TAPE-5CM", price: "8.50", lowStockAt: "3" })).id;
      const dup = await saveProductFor(setup(owner()), { name: "Other tape", sku: "TAPE-5CM", price: "1" });
      assert.ok(!dup.ok && /SKU/.test(dup.error), JSON.stringify(dup));
      const screen = ok(await productsScreenFor(setup(owner())));
      assert.deepEqual(
        screen.products.map((p) => [p.name, p.pricePence, p.vatCode, p.lowStockAt]),
        [["Kinesiology tape (fictional)", 850, "standard", 3]],
      );
    });

    it("stock: received and adjusted (a reason needed) per site; site scope kept", async () => {
      ok(await recordStockChangeFor(owner(), { productId: id.tape, siteId: id.site, kind: "received", quantity: 10 }));
      const noReason = await recordStockChangeFor(owner(), { productId: id.tape, siteId: id.site, kind: "adjusted", quantity: -2 });
      assert.ok(!noReason.ok && /why/.test(noReason.error));
      ok(await recordStockChangeFor(owner(), { productId: id.tape, siteId: id.site, kind: "adjusted", quantity: -2, reason: "Two rolls damaged" }));
      assert.equal(await onHand(), 8);
      assert.equal((await recordStockChangeFor(siteStaff(), { productId: id.tape, siteId: id.site, kind: "received", quantity: 1 })).ok, false, "not the member's site");
      const screen = ok(await stockScreenFor(owner(), id.site));
      assert.deepEqual(
        screen.rows.map((r) => [r.onHand, r.low, r.valuePence]),
        [[8, false, 6800]],
      );
      assert.deepEqual(
        screen.moves.map((m) => [m.label, m.quantity]),
        [
          ["Adjusted", -2],
          ["Received", 10],
        ],
      );
      assert.equal(ok(await stockScreenFor(siteStaff(), null)).siteId, id.site2, "a site-limited member sees their own site");
      const raw = await ctx.db.selectFrom("pms_stock_moves").select("reason_enc").where("tenant_id", "=", A).where("kind", "=", "adjusted").executeTakeFirstOrThrow();
      assert.ok(raw.reason_enc && !raw.reason_enc.includes("damaged"), "the reason is encrypted");
    });

    it("selling: stock leaves when the invoice is issued, at its site; a full credit puts it back once; a part credit does not", async () => {
      const draft = ok(await sellProductFor(owner(), id.patient, { productId: id.tape, quantity: 3, siteId: id.site }));
      assert.equal(await onHand(), 8, "a draft takes nothing");
      const inv = (await getInvoice(ctx, A, draft.invoiceId))!;
      assert.deepEqual([inv.lines[0].quantity, inv.totalPence, inv.siteId], [3, 2550, id.site]);
      assert.ok((await issueInvoice(ctx, A, inv.id, inv.rev, {}, SEED)).ok);
      assert.equal(await onHand(), 5);
      const sold = ok(await sellProductFor(owner(), id.patient, { productId: id.tape, quantity: 2, siteId: id.site, issue: true }));
      assert.ok(sold.issued);
      assert.equal(await onHand(), 3);
      assert.equal(ok(await stockScreenFor(owner(), id.site)).rows[0].low, true, "at the low-stock level");
      // A part credit leaves the stock as it is; the rest of the line credited puts all 3 back, once.
      const line = inv.lines[0];
      await createCreditNote(ctx, A, { invoiceId: inv.id, lines: [{ invoiceLineId: line.id, totalPence: 850 }], reason: "One roll faulty" }, SEED);
      assert.equal(await onHand(), 3);
      await createCreditNote(ctx, A, { invoiceId: inv.id, lines: [{ invoiceLineId: line.id, totalPence: 1700 }], reason: "Returned unopened" }, SEED);
      assert.equal(await onHand(), 6);
      // Voiding the other invoice puts its 2 back.
      await voidInvoice(ctx, A, sold.invoiceId, { reason: "Sold by mistake" }, SEED);
      assert.equal(await onHand(), 8);
      assert.equal(await onHand(id.site2), 0, "the other site untouched");
      const actions = (await listAudit(ctx, A, { limit: 200 })).map((e) => e.action);
      for (const a of ["pms.product.create", "pms.stock.receive", "pms.stock.adjust", "pms.stock.sell"]) assert.ok(actions.includes(a), a);
    });

    it("an invoice selling a product needs a site to be issued; selling needs one chosen when the clinic has several", async () => {
      const r = await sellProductFor(owner(), id.patient, { productId: id.tape, quantity: 1 });
      assert.ok(!r.ok && /site/.test(r.error));
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: id.patient, lines: [{ kind: "item", description: "Tape", unitPricePence: 850 }] }, SEED, { lineRefs: [{ lineIndex: 0, refType: "product", refId: id.tape }] });
      await assert.rejects(issueInvoice(ctx, A, invoice.id, invoice.rev, {}, SEED), /needs a site/);
      assert.equal((await getInvoice(ctx, A, invoice.id))?.status, "draft");
    });

    it("offboarding: products and their moves go with their parents – none is named, none is left", async () => {
      const before = await countPmsRows(db.db, A);
      for (const t of PRODUCT_CASCADE_DELETED_TABLES) assert.ok((before[t] ?? 0) > 0, `${t} has rows`);
      const queries = deletePmsQueries(db.db, A, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of PRODUCT_CASCADE_DELETED_TABLES) assert.ok(!named.some((s) => s.includes(`"${t}"`)), `${t} is not named`);
      await runBatch(db.db, queries);
      assert.deepEqual(await countPmsRows(db.db, A), {});
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(db.log.statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
