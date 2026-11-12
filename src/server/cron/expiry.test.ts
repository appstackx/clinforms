/**
 * PK06: the nightly expiry sweep's cron step (./expiry.ts) logs counts only and never throws – a failing database
 * leaves the rest of the daily run (billing extras) going. The sweep itself: src/server/pms/billing/pk06-expiry.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGuardedSqliteDb } from "../repos/pms/testing/guarded-db";
import { afterRetentionCron, expirySweepFromCron } from "./expiry";

describe("expiry sweep from the daily cron", () => {
  it("an empty database: nothing to sweep, counts logged", async () => {
    const g = createGuardedSqliteDb();
    const logs: [string, Record<string, unknown>][] = [];
    const r = await expirySweepFromCron({ db: g.db }, (e, d) => logs.push([e, d]));
    assert.deepEqual(r, { clinics: 0, courses: 0, giftCards: 0, giftCardPence: 0, errors: 0, stoppedEarly: false });
    assert.deepEqual(logs, [["cron.expiry.done", { clinics: 0, courses: 0, giftCards: 0, giftCardPence: 0, errors: 0, stoppedEarly: false }]]);
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

  it("a database that cannot even be opened (the factory throws, as on the route's 500 path) is logged, not thrown", async () => {
    const logs: [string, Record<string, unknown>][] = [];
    const r = await expirySweepFromCron(
      () => {
        throw new RangeError("DATABASE_URL is not set");
      },
      (e, d) => logs.push([e, d]),
    );
    assert.equal(r, null);
    assert.deepEqual(logs, [["cron.expiry.failed", { error: "RangeError" }]]);
  });

  it("after the retention pass: billing extras first, then the sweep; on a 500 only the sweep; 401/503 neither; a throwing step never escapes", async () => {
    const order: string[] = [];
    const warns: string[] = [];
    const steps = {
      billingExtras: async () => {
        order.push("billing");
      },
      expirySweep: async () => {
        order.push("sweep");
      },
    };
    await afterRetentionCron(200, steps);
    assert.deepEqual(order, ["billing", "sweep"]);
    order.length = 0;
    await afterRetentionCron(500, steps);
    assert.deepEqual(order, ["sweep"]);
    order.length = 0;
    await afterRetentionCron(401, steps);
    await afterRetentionCron(503, steps);
    assert.deepEqual(order, []);
    await afterRetentionCron(
      200,
      {
        billingExtras: async () => {
          throw new TypeError("no db");
        },
        expirySweep: async () => {
          throw new TypeError("no db");
        },
      },
      (e) => warns.push(e),
    );
    assert.deepEqual(warns, ["cron.billing_extras.failed", "cron.expiry.failed"]);
  });
});
