import { test } from "node:test";
import assert from "node:assert/strict";

/** A minimal in-memory Web Storage (the demo's localStorage / sessionStorage). */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  keys() {
    return Array.from(this.map.keys()).sort();
  }
}

// The public demo (browser mode, the default): exactly the pre-wave-2 storage – same keys, same results – and the
// wave-2 extras resolve to what the synchronous calls return. No request is ever made for storage.
test("browser mode (default) keeps the demo's storage and keys; the durable extras mirror the sync calls", async () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const events: string[] = [];
  const g = globalThis as Record<string, unknown>;
  g.window = {
    localStorage: local,
    sessionStorage: session,
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const realFetch = g.fetch;
  g.fetch = () => {
    throw new Error("browser mode makes no storage requests");
  };
  try {
    const s = await import("./store");
    assert.equal(s.getStoreMode(), "browser");
    const report = { id: "rpt_demo", updatedAt: "2026-10-09T10:00:00.000Z" } as unknown as Parameters<typeof s.saveReport>[0];
    assert.equal(s.saveReport(report), true);
    assert.deepEqual(local.keys(), ["medreport.report.rpt_demo"]);
    assert.deepEqual(events, ["medreport:store"]);
    assert.equal(await s.saveReportDurable({ ...report, id: "rpt_two" }), true);
    assert.deepEqual(local.keys(), ["medreport.report.rpt_demo", "medreport.report.rpt_two"]);
    assert.equal(await s.flushStore({ keepalive: true }), true);
    assert.deepEqual(s.getStoreSyncState(), { pending: 0, failed: false });
    assert.equal(s.getStoredReferrerLinks(), null);
    assert.equal(s.saveReferrerLinks({ a: "frm_a" }), false);
    s.deleteReport("rpt_two");
    assert.deepEqual(local.keys(), ["medreport.report.rpt_demo"]);

    s.setPasscode("passcode-123");
    assert.equal(session.getItem("medreport.passcode"), "passcode-123");
    s.resetDemo();
    assert.deepEqual(local.keys(), []);
    assert.deepEqual(session.keys(), []);

    // Browser storage holds only the demo's records: a clinic's record is refused.
    const clinic = { ...report, id: "rpt_clinic", tenantId: "riverside" } as typeof report;
    assert.equal(s.saveReport(clinic), false);
    assert.equal(await s.saveReportDurable(clinic), false);
    assert.equal(s.saveForm({ id: "frm_clinic", tenantId: "riverside" } as never), false);
    assert.equal(s.saveReport({ ...report, id: "rpt_demo2", tenantId: "demo" } as typeof report), true);
    s.deleteReport("rpt_demo2");
    assert.deepEqual(local.keys(), []);

    // Storage blocked: the durable save reports the same failure as saveReport.
    g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
    assert.equal(s.saveReport(report), false);
    assert.equal(await s.saveReportDurable(report), false);
    assert.equal(await s.saveFormDurable({} as never), false);
  } finally {
    delete g.window;
    g.fetch = realFetch;
  }
});
