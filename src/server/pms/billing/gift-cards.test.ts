/**
 * Gift cards (PK04) on node:sqlite and PGlite: the code format (pure); selling on a patient's record (the code shown
 * once, stored only hashed); spendable once its invoice is issued; Take payment → Gift card takes the amount off the
 * balance in the payment's batch, never more than is left; reversing the payment puts it back; a cancelled draft or a
 * credited, unspent sale cancels the card; offboarding; the tenant-scope guard. Fictional data only.
 * Run by `npm run test:db` and `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { formatGiftCardCode, giftCardExpiry, normaliseGiftCardCode } from "../../../modules/pms/billing/gift-cards";
import { testCipher } from "../../db/testing/databases";
import { runBatch } from "../../db/batch";
import { GIFT_CARD_CASCADE_DELETED_TABLES } from "../../db/pms-schema/billing";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { createCreditNote } from "../../repos/pms/billing/credit-notes";
import { cancelDraftInvoice, createDraftInvoice, getInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { findGiftCardByCode, getGiftCard, giftCardCodeHash, listGiftCardMoves } from "../../repos/pms/billing/gift-cards";
import { getPayment, reversePayment } from "../../repos/pms/billing/payments";
import { createService } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { countPmsRows, deletePmsQueries } from "../offboard";
import { testActor } from "./access";
import { giftCardsFor, patientGiftCardsFor, sellGiftCardFor } from "./gift-cards";
import { takePaymentFor } from "./writes";

const A = "riverside-gift";
const B = "harbour-gift";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };

describe("gift card codes (pure)", () => {
  it("12 characters without look-alikes, typed any way; expiry 24 months less a day", () => {
    const code = formatGiftCardCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(!/[01ILOS58B]/.test(code));
    assert.equal(normaliseGiftCardCode(code.toLowerCase().replace(/-/g, " ")), code);
    assert.equal(normaliseGiftCardCode("ABCD-EFGH-IJK1"), null, "I and 1 are never in a code");
    assert.equal(normaliseGiftCardCode("short"), null);
    assert.equal(giftCardExpiry("2026-11-02"), "2028-11-01");
    assert.equal(giftCardExpiry("2026-01-31", 1), "2026-02-27");
  });
});

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`gift cards on ${label}`, () => {
    let db: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" });
    const clinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_01", name: "Priya Shah (fictional)" });
    const ownerB = () => testActor(ctx, B, "owner", { userId: "user_owner_b", name: "Other Owner (fictional)" });
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };
    const pay = (code: string, amountPence: number, invoiceId: string) => takePaymentFor(owner(), { patientId: id.patient, method: "gift_card", amountPence, giftCardCode: code, allocations: [{ invoiceId, amountPence }] });

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date("2026-11-10T10:00:00.000Z") };
      id.fu = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1990-04-02" }, SEED)).id;
      id.patientB = (await createPatient(ctx, B, { firstName: "Other", lastName: "Clinic" }, SEED)).id;
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: id.patient, lines: [{ kind: "service", serviceId: id.fu, serviceOn: "2026-11-09", unitPricePence: 5500 }] }, SEED);
      assert.ok((await issueInvoice(ctx, A, invoice.id, invoice.rev, {}, SEED)).ok);
      id.treatment = invoice.id;
    });
    after(async () => {
      await db?.close();
    });

    it("selling: billing.edit; the code once, stored hashed; a draft card cannot be spent; a cancelled draft cancels it", async () => {
      assert.equal((await sellGiftCardFor(clinician(), id.patient, { amountPence: 5000 })).ok, false);
      assert.equal((await sellGiftCardFor(owner(), id.patient, { amountPence: 50 })).ok, false, "at least £1");
      const draft = ok(await sellGiftCardFor(owner(), id.patient, { amountPence: 2500, recipientName: "Tom Ellis" }));
      assert.equal(draft.issued, false);
      const card = await getGiftCard(ctx, A, draft.giftCardId);
      assert.deepEqual([card?.status, card?.balancePence, card?.codeLast4, card?.recipientName], ["pending", 0, draft.code.slice(-4), "Tom Ellis"]);
      const raw = await ctx.db.selectFrom("pms_gift_cards").selectAll().where("tenant_id", "=", A).where("id", "=", draft.giftCardId).executeTakeFirstOrThrow();
      assert.equal(raw.code_sha256, giftCardCodeHash(A, draft.code));
      assert.ok(!JSON.stringify(raw).includes(draft.code), "the code itself is stored nowhere");
      const r = await pay(draft.code, 1000, id.treatment);
      assert.ok(!r.ok && /not been issued/.test(r.error));
      const inv = (await getInvoice(ctx, A, draft.invoiceId))!;
      assert.equal(inv.lines[0].vatCode, "none", "no VAT at sale");
      assert.ok((await cancelDraftInvoice(ctx, A, inv.id, inv.rev, SEED)).ok);
      assert.equal((await getGiftCard(ctx, A, draft.giftCardId))?.status, "cancelled");
    });

    it("spending: the amount comes off the balance, never more than is left; reversing puts it back", async () => {
      const sold = ok(await sellGiftCardFor(owner(), id.patient, { amountPence: 5000, issue: true }));
      assert.ok(sold.issued && sold.expiresOn === "2028-11-09");
      id.code = sold.code;
      id.card = sold.giftCardId;
      assert.equal((await getGiftCard(ctx, A, id.card))?.balancePence, 5000);
      const taken = ok(await pay(sold.code.toLowerCase(), 2000, id.treatment));
      const payment = await getPayment(ctx, A, taken.paymentId as string);
      assert.equal(payment?.method, "other");
      assert.match(String(payment?.reference), /^Gift card •••• •••• /);
      assert.equal((await getGiftCard(ctx, A, id.card))?.balancePence, 3000);
      const over = await pay(sold.code, 3500, id.treatment);
      assert.ok(!over.ok && /Only £30\.00/.test(over.error));
      assert.equal((await pay("CDEF-GHJK-MNPQ", 100, id.treatment)).ok, false, "unknown code");
      assert.equal(await findGiftCardByCode(ctx, B, sold.code), null, "another clinic never finds it");
      assert.ok(await reversePayment(ctx, A, taken.paymentId as string, { reason: "Wrong card" }, SEED));
      assert.equal((await getGiftCard(ctx, A, id.card))?.balancePence, 5000);
      const moves = await listGiftCardMoves(ctx, A, id.card);
      assert.deepEqual(
        moves.map((m) => [m.kind, m.amountPence, m.balanceAfter]),
        [
          ["sale", 5000, 5000],
          ["redeem", -2000, 3000],
          ["refund", 2000, 5000],
        ],
      );
      // Spend it all: the card is used up.
      ok(await pay(sold.code, 3500, id.treatment));
      const screen = ok(await giftCardsFor(owner(), { code: sold.code }));
      assert.equal(screen.card?.balance, "£15.00 of £50.00 left · expires 09/11/2028");
      assert.equal(screen.outstandingPence, 1500);
      assert.equal(ok(await giftCardsFor(ownerB(), { code: sold.code })).card, null);
      assert.equal(ok(await patientGiftCardsFor(owner(), id.patient)).rows.length, 2);
      const actions = (await listAudit(ctx, A, { limit: 200 })).map((e) => e.action);
      for (const a of ["pms.gift_card.sell", "pms.gift_card.start", "pms.gift_card.redeem", "pms.gift_card.refund"]) assert.ok(actions.includes(a), a);
      assert.ok(!JSON.stringify(await listAudit(ctx, A, { limit: 200 })).includes(sold.code), "never the code in the audit trail");
    });

    it("crediting a sale: a spent card cannot be; an unspent one is cancelled with it", async () => {
      const card = (await getGiftCard(ctx, A, id.card))!;
      const inv = (await getInvoice(ctx, A, card.saleInvoiceId as string))!;
      await assert.rejects(createCreditNote(ctx, A, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, totalPence: 5000 }], reason: "Refund" }, SEED), /spent from/);
      const fresh = ok(await sellGiftCardFor(owner(), id.patient, { amountPence: 3000, issue: true }));
      const inv2 = (await getInvoice(ctx, A, fresh.invoiceId))!;
      await assert.rejects(createCreditNote(ctx, A, { invoiceId: inv2.id, lines: [{ invoiceLineId: inv2.lines[0].id, totalPence: 1000 }], reason: "Part" }, SEED), /in full/);
      await createCreditNote(ctx, A, { invoiceId: inv2.id, lines: [{ invoiceLineId: inv2.lines[0].id, totalPence: 3000 }], reason: "Changed their mind" }, SEED);
      const c = await getGiftCard(ctx, A, fresh.giftCardId);
      assert.deepEqual([c?.status, c?.balancePence], ["cancelled", 0]);
      const r = await pay(fresh.code, 100, id.treatment);
      assert.ok(!r.ok && /cancelled/.test(r.error));
    });

    it("offboarding: cards and their moves go with their parents – none is named, none is left", async () => {
      const before = await countPmsRows(db.db, A);
      for (const t of GIFT_CARD_CASCADE_DELETED_TABLES) assert.ok((before[t] ?? 0) > 0, `${t} has rows`);
      const queries = deletePmsQueries(db.db, A, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of GIFT_CARD_CASCADE_DELETED_TABLES) assert.ok(!named.some((s) => s.includes(`"${t}"`)), `${t} is not named`);
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
