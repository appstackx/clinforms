/**
 * TESTS ONLY: the text credit ledger's repository suite – run unchanged on node:sqlite and PGlite
 * (../credits-repos.test.ts) and on D1 through the gateway (workers/data-gateway/test/pms-sms-credits-stack.test.ts).
 * Proves: the balance and the ledger always agree, debits never overspend under parallel sends, a payment is
 * credited once, a debit returned once, a replayed webhook event changes nothing, the ledger is append-only, the
 * warnings are claimed once per crossing, one automatic top-up at a time, and clinic B's credits are never A's.
 * Ends with the tenant-scope guard when the factory gives a query log.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";
import {
  adjustSmsCredits,
  claimCreditWarning,
  claimTopUp,
  creditSmsPack,
  finishTopUp,
  getSmsCreditAccount,
  getSmsCreditAccounts,
  ledgerCheck,
  listSmsCreditEntries,
  releaseSmsCredits,
  removeCreditCard,
  reserveSmsCredits,
  saveAutoTopup,
  saveCreditCard,
  setCreditCustomer,
  webhookEventApplied,
} from "../credits";

export interface CreditsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_a", sessionId: "sess_a" };
const OWNER_B = { userId: "user_owner_b", sessionId: "sess_b" };
const SYSTEM = { userId: null, sessionId: null };

export function defineCreditsRepoSuite(label: string, factory: () => Promise<CreditsSuiteDb>): void {
  describe(`text credit ledger on ${label}`, () => {
    let suite: CreditsSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-31T09:00:00.000Z");
    const tick = () => {
      clock += 1;
      return new Date(clock);
    };

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: tick };
    });
    after(async () => {
      await suite?.close();
    });

    it("a clinic without an account reads as 0 credits with the defaults; nothing is written by reading", async () => {
      const acct = await getSmsCreditAccount(ctx, A);
      assert.equal(acct.balance, 0);
      assert.equal(acct.lowThreshold, 100);
      assert.equal(acct.autoTopup, false);
      assert.equal(acct.card, null);
      assert.equal((await getSmsCreditAccounts(ctx, [A, B])).size, 0);
      assert.deepEqual(await ledgerCheck(ctx, A), { ok: true, balance: 0, ledgerSum: 0, entries: 0 });
    });

    it("a reservation larger than the balance is refused and writes nothing (never negative)", async () => {
      const r = await reserveSmsCredits(ctx, A, { credits: 1, messageId: "msg_none" }, OWNER);
      assert.deepEqual(r, { ok: false, reason: "insufficient" });
      assert.equal((await listSmsCreditEntries(ctx, A)).length, 0);
      const neg = await adjustSmsCredits(ctx, A, { credits: -5, reason: "Too much" }, OWNER);
      assert.deepEqual(neg, { ok: false, reason: "insufficient" });
    });

    it("purchase: credited once per payment reference, with the pack's 20 % line; ledger = balance", async () => {
      const r = await creditSmsPack(ctx, A, { kind: "purchase", mode: "test", pack: "sms_1000", amountPence: 7500, paymentRef: "pi_test_A1", eventRef: "cs_test_A1" }, SYSTEM);
      assert.equal(r.ok, true);
      assert.equal(r.ok && r.balance, 1000);
      const again = await creditSmsPack(ctx, A, { kind: "purchase", mode: "test", pack: "sms_1000", amountPence: 7500, paymentRef: "pi_test_A1" }, SYSTEM);
      assert.deepEqual(again, { ok: false, reason: "duplicate" });
      // Five deliveries of another payment at once: exactly one credit.
      const five = await Promise.all(Array.from({ length: 5 }, () => creditSmsPack(ctx, A, { kind: "auto_topup", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_A2" }, SYSTEM)));
      assert.equal(five.filter((x) => x.ok).length, 1, JSON.stringify(five));
      const acct = await getSmsCreditAccount(ctx, A);
      assert.equal(acct.balance, 1500);
      assert.equal(acct.lastPackCredits, 500);
      assert.equal(acct.lowThreshold, 100);
      const check = await ledgerCheck(ctx, A);
      assert.deepEqual(check, { ok: true, balance: 1500, ledgerSum: 1500, entries: 2 });
      const entries = await listSmsCreditEntries(ctx, A);
      assert.deepEqual(
        entries.map((e) => [e.kind, e.credits, e.balanceAfter, e.pack]),
        [
          ["auto_topup", 500, 1500, "sms_500"],
          ["purchase", 1000, 1000, "sms_1000"],
        ],
      );
    });

    it("the same payment can never be credited to another clinic", async () => {
      const r = await creditSmsPack(ctx, B, { kind: "purchase", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_A1" }, SYSTEM);
      assert.equal(r.ok, false);
      assert.equal((await getSmsCreditAccount(ctx, B)).balance, 0);
    });

    it("parallel sends never spend the same credit twice", async () => {
      await adjustSmsCredits(ctx, B, { credits: 30, reason: "Test credits (fictional)" }, OWNER_B);
      const tries = await Promise.all(Array.from({ length: 25 }, (_, i) => reserveSmsCredits(ctx, B, { credits: 2, messageId: `msg_par_${i}` }, SYSTEM)));
      assert.equal(tries.filter((t) => t.ok).length, 15);
      assert.equal(tries.filter((t) => !t.ok && t.reason === "insufficient").length, 10);
      const acct = await getSmsCreditAccount(ctx, B);
      assert.equal(acct.balance, 0);
      const check = await ledgerCheck(ctx, B);
      assert.equal(check.ok, true, JSON.stringify(check));
      assert.equal(check.entries, 16);
      const balances = (await listSmsCreditEntries(ctx, B, { limit: 100 })).map((e) => e.balanceAfter);
      assert.ok(balances.every((b) => b >= 0));
      // Clinic A was not touched.
      assert.equal((await getSmsCreditAccount(ctx, A)).balance, 1500);
    });

    it("release: a reservation is returned once; another clinic cannot return it", async () => {
      const r = await reserveSmsCredits(ctx, A, { credits: 3, messageId: "msg_rel_1" }, SYSTEM);
      assert.ok(r.ok);
      if (!r.ok) return;
      assert.equal(r.balance, 1497);
      await assert.rejects(releaseSmsCredits(ctx, B, { debitId: r.entryId, credits: 3, messageId: "msg_rel_1", why: "failed" }, SYSTEM), RepoInputError);
      await assert.rejects(releaseSmsCredits(ctx, A, { debitId: r.entryId, credits: 4, messageId: "msg_rel_1", why: "failed" }, SYSTEM), RepoInputError, "the wrong size");
      const back = await releaseSmsCredits(ctx, A, { debitId: r.entryId, credits: 3, messageId: "msg_rel_1", why: "failed" }, SYSTEM);
      assert.equal(back.ok && back.balance, 1500);
      const twice = await Promise.all([1, 2, 3].map(() => releaseSmsCredits(ctx, A, { debitId: r.entryId, credits: 3, messageId: "msg_rel_1", why: "failed" }, SYSTEM)));
      assert.ok(twice.every((t) => !t.ok && t.reason === "duplicate"), JSON.stringify(twice));
      assert.equal((await getSmsCreditAccount(ctx, A)).balance, 1500);
      assert.equal((await ledgerCheck(ctx, A)).ok, true);
    });

    it("the ledger is append-only (the database refuses a change)", async () => {
      const [e] = await listSmsCreditEntries(ctx, A, { limit: 1 });
      await assert.rejects(ctx.db.updateTable("pms_sms_credit_entries").set({ credits: 99999 }).where("tenant_id", "=", A).where("id", "=", e.id).execute());
      await assert.rejects(ctx.db.updateTable("pms_sms_credit_accounts").set({ balance: -1 }).where("tenant_id", "=", A).execute(), "balance is never negative (CHECK)");
      assert.equal((await ledgerCheck(ctx, A)).ok, true);
    });

    it("webhook events: an event's credit carries its id – applied once everywhere; a replay changes nothing", async () => {
      const r = await creditSmsPack(ctx, A, { kind: "purchase", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_A3", eventRef: "evt_test_1" }, SYSTEM);
      assert.equal(r.ok, true);
      assert.equal(await webhookEventApplied(ctx, A, "evt_test_1"), true);
      assert.equal(await webhookEventApplied(ctx, B, "evt_test_1"), false);
      // The same event again (even naming another payment): nothing credited.
      const replay = await creditSmsPack(ctx, A, { kind: "purchase", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_A4", eventRef: "evt_test_1" }, SYSTEM);
      assert.deepEqual(replay, { ok: false, reason: "duplicate" });
      const elsewhere = await creditSmsPack(ctx, B, { kind: "purchase", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_B9", eventRef: "evt_test_1" }, SYSTEM);
      assert.deepEqual(elsewhere, { ok: false, reason: "duplicate" }, "an event id is unique everywhere");
      assert.equal((await getSmsCreditAccount(ctx, A)).balance, 2000);
      assert.equal((await getSmsCreditAccount(ctx, B)).balance, 0);
    });

    it("warnings: low at 20 % of the last pack and zero, each claimed once per crossing; credit re-arms them", async () => {
      await adjustSmsCredits(ctx, B, { credits: 120, reason: "Refill (fictional)" }, OWNER_B);
      assert.equal(await claimCreditWarning(ctx, B, "low", SYSTEM), false, "120 is above the 100 line");
      assert.ok((await reserveSmsCredits(ctx, B, { credits: 20, messageId: "msg_w1" }, SYSTEM)).ok);
      assert.equal(await claimCreditWarning(ctx, B, "low", SYSTEM), true);
      assert.equal(await claimCreditWarning(ctx, B, "low", SYSTEM), false, "once");
      assert.equal(await claimCreditWarning(ctx, B, "zero", SYSTEM), false, "not at zero yet");
      assert.ok((await reserveSmsCredits(ctx, B, { credits: 100, messageId: "msg_w2" }, SYSTEM)).ok);
      const both = await Promise.all([claimCreditWarning(ctx, B, "zero", SYSTEM), claimCreditWarning(ctx, B, "zero", SYSTEM)]);
      assert.equal(both.filter(Boolean).length, 1, "two senders, one email");
      let acct = await getSmsCreditAccount(ctx, B);
      assert.deepEqual([acct.balance, acct.lowWarned, acct.zeroWarned], [0, true, true]);
      // Credit above the line arms both again; credit under it arms only "zero".
      await adjustSmsCredits(ctx, B, { credits: 50, reason: "Small refill" }, OWNER_B);
      acct = await getSmsCreditAccount(ctx, B);
      assert.deepEqual([acct.lowWarned, acct.zeroWarned], [true, false]);
      await creditSmsPack(ctx, B, { kind: "purchase", mode: "test", pack: "sms_500", amountPence: 4000, paymentRef: "pi_test_B1" }, SYSTEM);
      acct = await getSmsCreditAccount(ctx, B);
      assert.deepEqual([acct.balance, acct.lowWarned, acct.zeroWarned], [550, false, false]);
    });

    it("card and automatic top-up: card only on the clinic's own customer; one top-up claim at a time; a failure pauses", async () => {
      await assert.rejects(saveAutoTopup(ctx, A, { enabled: true, threshold: 100, pack: "sms_500" }, OWNER), /Save a card first/);
      assert.equal(await setCreditCustomer(ctx, A, "cus_test_A", OWNER), true);
      assert.equal(await setCreditCustomer(ctx, A, "cus_test_other", OWNER), false, "set once");
      assert.equal((await getSmsCreditAccount(ctx, A)).customerRef, "cus_test_A");
      await assert.rejects(setCreditCustomer(ctx, B, "cus_test_A", OWNER_B), RepoInputError, "a customer belongs to one clinic");
      assert.equal(await saveCreditCard(ctx, A, { customerRef: "cus_test_B", methodRef: "pm_test_x", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }, OWNER), false, "another customer's card");
      assert.equal(await saveCreditCard(ctx, A, { customerRef: "cus_test_A", methodRef: "pm_test_A", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 }, OWNER), true);
      const saved = await saveAutoTopup(ctx, A, { enabled: true, threshold: 300, pack: "sms_1000" }, OWNER);
      assert.deepEqual([saved.autoTopup, saved.autoTopupThreshold, saved.autoTopupPack, saved.card?.last4], [true, 300, "sms_1000", "4242"]);
      const claims = await Promise.all([claimTopUp(ctx, A, "topup_one", SYSTEM), claimTopUp(ctx, A, "topup_two", SYSTEM)]);
      assert.equal(claims.filter(Boolean).length, 1);
      const won = claims[0] ? "topup_one" : "topup_two";
      await finishTopUp(ctx, A, won, { ok: false, code: "card_declined" }, SYSTEM);
      let acct = await getSmsCreditAccount(ctx, A);
      assert.ok(acct.autoTopupPausedAt);
      assert.equal(acct.autoTopupFailure, "card_declined");
      assert.equal(await claimTopUp(ctx, A, "topup_three", SYSTEM), false, "paused");
      await saveAutoTopup(ctx, A, { enabled: true, threshold: 300, pack: "sms_1000" }, OWNER);
      acct = await getSmsCreditAccount(ctx, A);
      assert.equal(acct.autoTopupPausedAt, null, "switching it on again clears the pause");
      assert.equal(await claimTopUp(ctx, A, "topup_four", SYSTEM), true);
      await finishTopUp(ctx, A, "topup_four", { ok: true }, SYSTEM);
      assert.equal(await removeCreditCard(ctx, A, OWNER), true);
      acct = await getSmsCreditAccount(ctx, A);
      assert.deepEqual([acct.card, acct.autoTopup], [null, false]);
    });

    it("every change is audited under its own clinic, with ids and counts only", async () => {
      const a = await listAudit(ctx, A, { limit: 200 });
      const actions = new Set(a.map((e) => e.action));
      for (const code of ["pms.sms_credit.purchase", "pms.sms_credit.auto_topup", "pms.sms_credit.debit", "pms.sms_credit.reversal", "pms.sms_credit.settings", "pms.sms_credit.card_save", "pms.sms_credit.card_remove", "pms.sms_credit.topup_failed", "pms.sms_credit.customer"]) {
        assert.ok(actions.has(code), `missing ${code}`);
      }
      const b = await listAudit(ctx, B, { limit: 200 });
      assert.ok(b.some((e) => e.action === "pms.sms_credit.adjust"));
      assert.ok(b.some((e) => e.action === "pms.sms_credit.warning"));
      assert.ok(!a.some((e) => e.action === "pms.sms_credit.adjust"), "B's adjustments are not in A's trail");
      // One debit audit row per entry; nothing personal in any detail.
      const entriesB = await listSmsCreditEntries(ctx, B, { limit: 500 });
      assert.equal(b.filter((e) => e.action === "pms.sms_credit.debit").length, entriesB.filter((e) => e.kind === "debit").length);
      for (const e of [...a, ...b]) assert.doesNotMatch(JSON.stringify(e.detail ?? {}), /@|07700|Megan|Hart/);
    });

    it("tenant scope: every statement names the clinic", () => {
      if (suite.log) assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
