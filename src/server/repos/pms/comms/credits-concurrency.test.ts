/**
 * The text credit ledger under REAL concurrency (a pool of 4 connections to a real local Postgres –
 * CLINFORMS_TEST_PG_URL, db/testing/real-pg.ts; skipped otherwise). PGlite and node:sqlite are one connection each,
 * so there the "parallel" calls of the suite are serialised; here they really overlap: the balance UPDATE's
 * condition is re-checked on the latest row after a concurrent writer commits, and a second delivery of one
 * payment fails on the unique index (answered "duplicate"). Runs the whole repository suite, then a heavier
 * hammer. Fictional data only. Run by `npm run test:pms` / `test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../../db/testing/databases";
import { createRealPgDb, realPgTestUrl } from "../../../db/testing/real-pg";
import { adjustSmsCredits, creditSmsPack, getSmsCreditAccount, ledgerCheck, releaseSmsCredits, reserveSmsCredits } from "./credits";
import { defineCreditsRepoSuite } from "./testing/credits-suite";

const realUrl = realPgTestUrl();

if (realUrl) defineCreditsRepoSuite("real Postgres (pool of 4 connections)", async () => createRealPgDb(realUrl));

describe("text credits: hammer on real Postgres", { skip: realUrl ? false : "CLINFORMS_TEST_PG_URL not set" }, () => {
  let real: Awaited<ReturnType<typeof createRealPgDb>>;
  const T = "hammer-clinic";
  const SYS = { userId: null, sessionId: null };
  before(async () => {
    real = await createRealPgDb(realUrl as string);
  });
  after(async () => {
    await real?.close();
  });

  it("200 simultaneous reservations of 3 against 301 credits: exactly 100 succeed; releases and payments race safely", async () => {
    const ctx = { db: real.db, cipher: testCipher() };
    await adjustSmsCredits(ctx, T, { credits: 301, reason: "Hammer (fictional)" }, SYS);
    const tries = await Promise.all(Array.from({ length: 200 }, (_, i) => reserveSmsCredits(ctx, T, { credits: 3, messageId: `msg_h_${i}` }, SYS)));
    const won = tries.filter((t) => t.ok);
    assert.equal(won.length, 100);
    assert.equal((await getSmsCreditAccount(ctx, T)).balance, 1);
    // Every won reservation released three times at once: each returned exactly once.
    const releases = await Promise.all(
      won.flatMap((t) => (t.ok ? [1, 2, 3].map(() => releaseSmsCredits(ctx, T, { debitId: t.entryId, credits: 3, messageId: null, why: "failed" }, SYS)) : [])),
    );
    assert.equal(releases.filter((r) => r.ok).length, 100);
    // Ten deliveries of one payment at once: credited once.
    const pays = await Promise.all(Array.from({ length: 10 }, () => creditSmsPack(ctx, T, { kind: "purchase", pack: "sms_500", amountPence: 3000, paymentRef: "pi_test_hammer" }, SYS)));
    assert.equal(pays.filter((p) => p.ok).length, 1);
    const check = await ledgerCheck(ctx, T);
    assert.deepEqual([check.ok, check.balance], [true, 801], JSON.stringify(check));
  });
});
