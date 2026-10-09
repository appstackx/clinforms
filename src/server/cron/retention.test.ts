import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createSqliteTestDb, testCipher } from "../db/testing/databases";
import { createAccessRequest } from "../repos/access-requests";
import { createReport } from "../repos/reports";
import { cronAuthorized, handleRetentionCron } from "./retention";

const SECRET = "cron-secret-".padEnd(40, "c");

describe("retention cron", () => {
  const t = createSqliteTestDb();
  after(() => t.close());
  const quiet = () => undefined;

  it("authorises only `Bearer <CRON_SECRET>`, and nothing at all without a (long enough) secret", () => {
    assert.equal(cronAuthorized(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(cronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
    assert.equal(cronAuthorized(SECRET, SECRET), false);
    assert.equal(cronAuthorized(null, SECRET), false);
    assert.equal(cronAuthorized("Bearer ", ""), false);
    assert.equal(cronAuthorized("Bearer short", "short"), false);
    assert.equal(cronAuthorized("Bearer undefined", undefined), false);
  });

  it("refuses (503) when CRON_SECRET is unset and (401) a wrong token – without touching the database", async () => {
    let touched = false;
    const ctx = () => {
      touched = true;
      return { db: t.db };
    };
    const req = (auth?: string) => new Request("http://localhost/api/cron/retention", { headers: auth ? { authorization: auth } : {} });
    assert.equal((await handleRetentionCron(req(`Bearer ${SECRET}`), { secret: undefined, ctx, log: quiet })).status, 503);
    assert.equal((await handleRetentionCron(req("Bearer nope"), { secret: SECRET, ctx, log: quiet })).status, 401);
    assert.equal((await handleRetentionCron(req(), { secret: SECRET, ctx, log: quiet })).status, 401);
    assert.equal(touched, false);
  });

  it("runs the retention pass and reports counts only", async () => {
    const old = new Date(Date.now() - 800 * 86_400_000);
    await createAccessRequest({ db: t.db, now: () => old }, { clinicName: "Old (fictional)", contactName: "A B", email: "a@old.example" });
    await createReport({ db: t.db, cipher: testCipher() }, "cron-clinic", {
      id: "expired",
      status: "approved",
      templateId: "solicitor",
      deleteAfter: new Date(Date.now() - 60_000).toISOString(),
      payload: { fictional: true },
    });
    const events: string[] = [];
    const res = await handleRetentionCron(new Request("http://localhost/api/cron/retention", { headers: { authorization: `Bearer ${SECRET}` } }), {
      secret: SECRET,
      ctx: () => ({ db: t.db }),
      log: (event, detail) => events.push(`${event} ${JSON.stringify(detail)}`),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; deleted: Record<string, number> };
    assert.equal(body.ok, true);
    assert.equal(body.deleted.reports, 1);
    assert.equal(body.deleted.accessRequests, 1);
    assert.ok(events.some((e) => e.startsWith("cron.retention.done")));
    assert.ok(!events.join("\n").includes("a@old.example"));
  });
});
