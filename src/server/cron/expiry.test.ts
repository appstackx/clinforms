/**
 * PK06: the nightly expiry sweep's cron step (./expiry.ts) logs counts only and never throws – a failing database
 * leaves the rest of the daily run (billing extras) going. The sweep itself: src/server/pms/billing/pk06-expiry.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGuardedSqliteDb } from "../repos/pms/testing/guarded-db";
import { expirySweepFromCron } from "./expiry";

describe("expiry sweep from the daily cron", () => {
  it("an empty database: nothing to sweep, counts logged", async () => {
    const g = createGuardedSqliteDb();
    const logs: [string, Record<string, unknown>][] = [];
    const r = await expirySweepFromCron({ db: g.db }, (e, d) => logs.push([e, d]));
    assert.deepEqual(r, { clinics: 0, courses: 0, giftCards: 0, giftCardPence: 0, errors: 0 });
    assert.deepEqual(logs, [["cron.expiry.done", { clinics: 0, courses: 0, giftCards: 0, giftCardPence: 0, errors: 0 }]]);
    await g.close();
  });

  it("a database error is logged by name only and does not throw", async () => {
    const logs: [string, Record<string, unknown>][] = [];
    const broken = {
      selectFrom() {
        throw new TypeError("connection refused to db.internal:5432 for tenant riverside");
      },
    };
    assert.equal(await expirySweepFromCron({ db: broken as never }, (e, d) => logs.push([e, d])), null);
    assert.deepEqual(logs, [["cron.expiry.failed", { error: "TypeError" }]]);
  });
});
