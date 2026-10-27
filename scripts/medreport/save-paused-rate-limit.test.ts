/**
 * bh2 fix round 1, R1T-WF-L1 (R1-BC-X1): when the clinic's records answer a save with their write limit (429
 * RATE_LIMITED – store_write_limited, with Retry-After), the Studio said "Could not save – check your connection". The
 * write queue gave up after its attempts (500 ms … 4 s back-off, ~7.5 s in all) although the server's window is a
 * minute and the server's own message says "The Studio will try again in N s".
 *
 * Now a rate-limited save is PAUSED: the queue waits for the server's Retry-After and tries again by itself, a
 * rate-limited attempt never counts towards the queue's attempts, the store's sync state says `paused`, and the review
 * header says "Saving paused for a moment – it will try again automatically". A save that really failed (no
 * connection) still stops after its attempts and still says "check your connection".
 *
 * The Studio's own server store (ui/store) against the REAL store handlers on an in-memory TenantStore
 * (store-harness.ts); the shared rate-limit counters are a test double the test can fill and empty. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import type { MedreportDeps, SharedStateStore } from "../../src/modules/medreport/api/deps";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { STORE_WRITES_PER_MEMBER_PER_MINUTE } from "../../src/modules/medreport/api/store-contract";
import type { Report } from "../../src/modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { saveStatus } from "../../src/modules/medreport/ui/components/review/review-header";
import { MAX_RETRY_AFTER_MS, createServerApi, rateLimitRetryAfterMs } from "../../src/modules/medreport/ui/store/server-api";
import { createServerStore } from "../../src/modules/medreport/ui/store/server-store";
import { TENANT_COPY } from "../../src/modules/medreport/ui/studio-copy";
import { WriteQueue, type SendOutcome } from "../../src/modules/medreport/ui/store/write-queue";
import { completedSampleReport } from "./form-sample-answers";
import { member, storeDeps, storeFetch, type FetchLog } from "./store-harness";

const CLINIC = "clinic-rate-limit";

/** Shared counters (SharedStateStore) whose member write windows the test can report as used up. */
function counters() {
  const windows = new Map<string, number>();
  const state = { full: false, resetInMs: 42_000 };
  const read = (key: string, amount: number) => {
    const count = (windows.get(key) ?? 0) + amount;
    windows.set(key, count);
    const used = state.full && key.startsWith("store:writes:member:") ? STORE_WRITES_PER_MEMBER_PER_MINUTE + 1 : count;
    return { count: used, resetAt: new Date(Date.now() + state.resetInMs).toISOString() };
  };
  const store: SharedStateStore = {
    hit: async (key, _windowMs, amount = 1) => read(key, amount),
    peek: async (key) => read(key, 0),
    reset: async (key) => void windows.delete(key),
    claimOnce: async () => true,
  };
  return { store, state };
}

function backend() {
  const tenantStore = createMemoryTenantStore();
  const limits = counters();
  const deps: MedreportDeps = { ...storeDeps(tenantStore, { sarah: member(CLINIC) }), sharedState: limits.store };
  return { tenantStore, deps, limits };
}

/** A Studio tab with a manual timer (the queue's back-off and pauses wait until the test runs them). */
function tab(deps: MedreportDeps, opts: { fetch?: typeof fetch } = {}) {
  const log: FetchLog[] = [];
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const client = createServerStore({
    api: createServerApi(opts.fetch ?? storeFetch(deps, { member: "sarah", log })),
    browserEvents: false,
    notify: () => undefined,
    queue: {
      maxAttempts: 3,
      backoffMs: () => 1,
      schedule: (run, ms) => {
        const t = { run, ms, cancelled: false };
        timers.push(t);
        return () => {
          t.cancelled = true;
        };
      },
    },
  });
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  };
  /** Run the next scheduled retry (the queue's timer) and let it settle. */
  const runNext = async (): Promise<number | null> => {
    const t = timers.find((x) => !x.cancelled);
    if (!t) return null;
    timers.splice(timers.indexOf(t), 1);
    t.run();
    await settle();
    return t.ms;
  };
  return { client, log, timers, settle, runNext };
}

function report(id = "rpt_rate_limit"): Report {
  return { ...completedSampleReport("megan-hart", { ...HARROW_PIKE_RAW, tenantId: CLINIC }, { id }), tenantId: CLINIC, patientLabel: "Megan Hart" };
}

function edited(r: Report, n: number): Report {
  return { ...r, patientLabel: `Megan Hart (edit ${n})`, updatedAt: new Date(Date.parse(r.updatedAt) + n * 60_000).toISOString() };
}

const header = (state: "saving" | "saved" | "failed", paused: boolean) => saveStatus(state, { tenant: true, paused });

test("the member's write limit (429 + Retry-After): the save is paused at the server's pace, never given up, and the header says so – then it is saved", async () => {
  const { deps, limits } = backend();
  const t = tab(deps);
  const first = report();
  t.client.saveReport(first);
  assert.equal(await t.client.flush(), true, "stored before the limit is reached");

  limits.state.full = true;
  const change = edited(first, 1);
  t.client.saveReport(change);
  let settled: boolean | null = null;
  void t.client.reportSettled(change.id).then((ok) => (settled = ok));
  await t.settle();
  assert.equal(t.log.at(-1)?.status, 429, "the real store handler refuses the write (store_write_limited)");

  // More attempts than the queue's maxAttempts (3): each waits for the server's Retry-After, none stops the save.
  for (let i = 0; i < 6; i++) {
    const sync = t.client.syncState();
    assert.equal(sync.paused, true, `attempt ${i + 1}: the store says the save is paused`);
    assert.equal(settled, null, `attempt ${i + 1}: the save is still on its way (not given up)`);
    assert.deepEqual(header("saving", sync.paused === true), { tone: "paused", text: TENANT_COPY.review.savePaused });
    const waited = await t.runNext();
    assert.ok(waited !== null && waited >= 42_000 && waited <= 44_000, `retry ${i + 1} waited ${waited} ms – the server's Retry-After (42 s), not the 1 ms back-off`);
    assert.equal(t.log.at(-1)?.status, 429);
  }
  assert.doesNotMatch(TENANT_COPY.review.savePaused, /connection|could not/i);

  limits.state.full = false;
  await t.runNext();
  assert.equal(settled, true, "saved once the server allows it again");
  assert.equal(t.log.at(-1)?.status, 200);
  assert.equal(t.client.syncState().paused, undefined, "no longer paused");
  assert.deepEqual(header("saved", false).text, TENANT_COPY.review.saved);
  const stored = await createServerApi(storeFetch(deps, { member: "sarah" })).getReport(change.id);
  assert.equal(stored?.report.patientLabel, "Megan Hart (edit 1)", "the clinic holds the change made during the pause");
});

test("edits made during the pause wait for it (one request, the latest copy) – and page hide (flush) still sends at once", async () => {
  const { deps, limits } = backend();
  const t = tab(deps);
  const first = report("rpt_rate_limit_2");
  t.client.saveReport(first);
  assert.equal(await t.client.flush(), true);

  limits.state.full = true;
  t.client.saveReport(edited(first, 1));
  await t.settle();
  const before = t.log.length;
  t.client.saveReport(edited(first, 2));
  t.client.saveReport(edited(first, 3));
  await t.settle();
  assert.equal(t.log.length, before, "no request while paused: the server said when to try again");
  assert.equal(t.client.syncState().paused, true);

  limits.state.full = false;
  const flushed = await t.client.flush({ keepalive: true });
  assert.equal(flushed, true, "page hide sends what waits at once");
  assert.equal(t.log.length, before + 1, "one request: the latest copy");
  assert.equal(t.log.at(-1)?.keepalive, true);
  assert.equal(t.client.getReport(first.id)?.patientLabel, "Megan Hart (edit 3)");
});

test("control: a save that really fails (no connection) still stops after its attempts and says 'check your connection'", async () => {
  const { deps } = backend();
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const t = tab(deps, { fetch: offline });
  t.client.saveReport(report("rpt_offline"));
  let settled: boolean | null = null;
  void t.client.reportSettled("rpt_offline").then((ok) => (settled = ok));
  await t.settle();
  while ((await t.runNext()) !== null);
  assert.equal(settled, false, "given up after maxAttempts (the queue keeps it for retryFailed on focus / back online)");
  assert.equal(t.client.syncState().paused, undefined, "not a pause");
  assert.equal(t.client.syncState().failed, true);
  assert.deepEqual(header("failed", false), { tone: "failed", text: TENANT_COPY.review.saveFailed });
  assert.match(TENANT_COPY.review.saveFailed, /check your connection/);
});

test("the header's save status: paused only for a clinic's save that is waiting; the browser demo keeps its own words", () => {
  assert.deepEqual(saveStatus("saving", { tenant: true, paused: true }), { tone: "paused", text: TENANT_COPY.review.savePaused });
  assert.deepEqual(saveStatus("saving", { tenant: true, paused: false }), { tone: "saving", text: "Saving…" });
  assert.deepEqual(saveStatus("saved", { tenant: true, paused: true }), { tone: "saved", text: TENANT_COPY.review.saved }, "another record's pause does not unsay this one's Saved");
  assert.deepEqual(saveStatus("failed", { tenant: true, paused: true }), { tone: "failed", text: TENANT_COPY.review.saveFailed });
  assert.deepEqual(saveStatus("saving", { tenant: false, paused: true }), { tone: "saving", text: "Saving…" }, "browser storage has no server limit");
  assert.equal(saveStatus("failed", { tenant: false, paused: false }).text, "Could not save in this browser (storage full or blocked)");
  assert.equal(saveStatus("saved", { tenant: false, paused: false }).text, "Saved in this browser");
});

test("Retry-After is read from a 429 only (seconds or a date), at least 1 s and at most 15 minutes", () => {
  const now = Date.parse("2026-10-27T10:00:00.000Z");
  assert.equal(rateLimitRetryAfterMs(429, "42", now), 42_000);
  assert.equal(rateLimitRetryAfterMs(429, " 7 ", now), 7_000);
  assert.equal(rateLimitRetryAfterMs(429, "0", now), 1_000);
  assert.equal(rateLimitRetryAfterMs(429, "Tue, 27 Oct 2026 10:00:30 GMT", now), 30_000);
  assert.equal(rateLimitRetryAfterMs(429, "86400", now), MAX_RETRY_AFTER_MS, "a daily allowance is tried again every 15 minutes");
  assert.equal(rateLimitRetryAfterMs(429, null, now), 60_000, "no header: the server's windows are a minute");
  assert.equal(rateLimitRetryAfterMs(429, "soon", now), 60_000);
  assert.equal(rateLimitRetryAfterMs(503, "42", now), null, "only a rate limit pauses");
  assert.equal(rateLimitRetryAfterMs(500, null, now), null);
});

test("the write queue: a rate-limited outcome pauses without counting the attempt; other retries keep their back-off and stop", async () => {
  const outcomes: SendOutcome[] = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  let sends = 0;
  const queue = new WriteQueue<number>({
    maxAttempts: 2,
    backoffMs: () => 5,
    schedule: (run, ms) => (timers.push({ run, ms }), () => undefined),
    send: async () => {
      sends += 1;
      return outcomes.shift() ?? { kind: "ok" };
    },
  });
  const tick = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  for (let i = 0; i < 4; i++) outcomes.push({ kind: "retry", message: "Too many changes at once.", retryAfterMs: 30_000 });
  queue.enqueue("report:1", 1);
  let settled: boolean | null = null;
  void queue.settled("report:1").then((ok) => (settled = ok));
  await tick();
  for (let i = 0; i < 4; i++) {
    assert.equal(queue.state().paused, true);
    const t = timers.shift();
    assert.equal(t?.ms, 30_000);
    t!.run();
    await tick();
  }
  assert.equal(settled, true, "four rate-limited attempts (maxAttempts 2), then saved");
  assert.equal(sends, 5);
  assert.equal(queue.state().paused, undefined);

  outcomes.push({ kind: "retry", message: "The server could not save the change just now." }, { kind: "retry", message: "The server could not save the change just now." });
  queue.enqueue("report:1", 2);
  let second: boolean | null = null;
  void queue.settled("report:1").then((ok) => (second = ok));
  await tick();
  assert.equal(queue.state().paused, undefined, "a 5xx is not a pause");
  const backoff = timers.shift();
  assert.equal(backoff?.ms, 5, "its own back-off");
  backoff!.run();
  await tick();
  assert.equal(second, false, "stopped after maxAttempts, as before");
});
