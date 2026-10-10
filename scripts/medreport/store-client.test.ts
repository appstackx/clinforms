/**
 * The Studio's "server" store (ui/store/server-store.ts + server-api.ts) against the REAL store handlers on an
 * in-memory TenantStore (scripts/medreport/store-harness.ts): hydration, synchronous reads from the cache,
 * generateReport's parallel draft groups saving one report in order, coalescing, the 409 path between two tabs,
 * durable saves, server-normalised copies, chunked file upload / download, keepalive flush, sign-out; and the
 * public facade (ui/store.ts) in server mode never touching localStorage or IndexedDB.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import type { DraftsRequest, DraftsResponse, ValidateResponse } from "../../src/modules/medreport/api/contract";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { STORE_FILE_CHUNK_BYTES } from "../../src/modules/medreport/api/store-contract";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import type { FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { sha256Hex } from "../../src/modules/medreport/forms/file";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { generateReport } from "../../src/modules/medreport/ui/components/new/generate";
import { createServerApi } from "../../src/modules/medreport/ui/store/server-api";
import { createServerStore } from "../../src/modules/medreport/ui/store/server-store";
import { getDemoBundle } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";
import { member, storeDeps, storeFetch, type FetchLog } from "./store-harness";

const A = "clinic-a";

function backend() {
  const store = createMemoryTenantStore();
  const deps = storeDeps(store, { a: member(A), a2: member(A, { userId: "user-2", authSessionId: "sess-2" }) });
  return { store, deps };
}

function tab(deps: ReturnType<typeof backend>["deps"], who: string | null = "a") {
  const log: FetchLog[] = [];
  let notified = 0;
  const client = createServerStore({
    api: createServerApi(storeFetch(deps, { member: who, log })),
    browserEvents: false,
    notify: () => {
      notified += 1;
    },
    queue: { backoffMs: () => 1, maxAttempts: 2 },
  });
  return { client, log, notified: () => notified };
}

function report(id = "rpt_client", patientLabel = "Megan Hart"): Report {
  return { ...completedSampleReport("megan-hart", { ...HARROW_PIKE_RAW, tenantId: A }, { id }), tenantId: A, patientLabel };
}

function fakePdf(size: number): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.alloc(size, 0x61);
  Buffer.from("%PDF-1.4\n%").copy(bytes, 0);
  for (let i = 64; i < size; i += 64) bytes[i] = 0x0a;
  Buffer.from("\n%%EOF\n").copy(bytes, size - 7);
  return new Uint8Array(bytes);
}

test("hydration: the snapshot and every form map; reports on demand; reads stay synchronous", async () => {
  const { deps, store } = backend();
  const seed = tab(deps);
  const form = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: A }, "Practice manager", "2026-10-01T09:00:00.000Z");
  assert.equal(seed.client.saveForm(form), true);
  assert.equal(seed.client.saveReport(report()), true);
  assert.equal(await seed.client.flush(), true);

  const t = tab(deps);
  assert.deepEqual(t.client.listForms(), [], "nothing before hydration");
  await t.client.hydrate();
  assert.equal(t.client.isHydrated(), true);
  assert.equal(t.client.tenantId(), A);
  assert.deepEqual(t.client.listForms().map((f) => [f.id, f.status]), [[form.id, "confirmed"]]);
  assert.equal(t.client.listReports().length, 0, "reports load on demand");
  const one = await t.client.ensureReport("rpt_client");
  assert.equal(one?.patientLabel, "Megan Hart");
  assert.equal(t.client.getReport("rpt_client"), one);
  await t.client.loadAllReports();
  assert.equal(t.client.listReports().length, 1);
  assert.equal(await t.client.ensureReport("rpt_missing"), null);
  assert.equal(t.log.filter((l) => l.method === "GET" && l.path.includes("/store/reports/rpt_client")).length, 1, "no refetch while current");
  assert.ok(t.notified() > 0);
  assert.equal((await store.listReports(A)).length, 1);
});

test("generateReport with 3 parallel draft groups: every save reaches the server in order, coalesced, no clashes", async () => {
  const { deps, store } = backend();
  const t = tab(deps);
  await t.client.hydrate();
  const bundle = getDemoBundle("megan-hart");
  let minute = 0;
  const client = {
    async drafts(body: DraftsRequest): Promise<DraftsResponse> {
      await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 4)));
      return {
        sections: body.sectionKeys.map((key) => ({
          key,
          title: "",
          kind: "ai_narrative",
          status: "drafted",
          paragraphs: [{ id: `${key}-p1`, text: "As recorded on 18/03/2026.", sourceIds: ["N-001"], origin: "ai" }],
        })),
        gaps: [],
        flags: [],
        generation: { mode: "demo_recorded", sectionKeys: body.sectionKeys, at: "2026-10-06T09:00:00.000Z", promptVersion: "test" },
      };
    },
    async validate(): Promise<ValidateResponse> {
      return { flags: [], canSign: false, blocking: [] };
    },
  };
  let saves = 0;
  const result = await generateReport({
    client,
    data: { bundle, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }) },
    target: { kind: "form", form: { ...HARROW_PIKE_RAW, tenantId: A } },
    concurrency: 3,
    onReport: (r) => {
      saves += 1;
      assert.equal(t.client.saveReport(r), true);
    },
    now: () => new Date(Date.parse("2026-10-06T10:00:00.000Z") + ++minute * 60_000),
  });
  assert.equal(await t.client.flush(), true);
  const puts = t.log.filter((l) => l.method === "PUT");
  assert.ok(puts.every((p) => p.status === 200 || p.status === 201), "no 409 between the groups' saves");
  assert.ok(puts.length <= saves, "coalesced");
  // Revisions advance one by one: the first PUT creates, each next one names the previous revision.
  assert.deepEqual(
    puts.map((p) => p.ifMatch),
    puts.map((_, i) => (i === 0 ? null : `"${i}"`)),
  );
  const stored = await store.getReport(A, result.report.id);
  assert.equal(stored?.rev, puts.length);
  assert.deepEqual({ ...(stored?.payload as Report), tenantId: A }, { ...result.report, tenantId: A }, "the server holds the final report");
});

test("two tabs: a stale save gets 409, the stored copy is loaded into the cache and the durable save says false", async () => {
  const { deps } = backend();
  const one = tab(deps);
  const two = tab(deps, "a2");
  assert.equal(await (async () => {
    one.client.saveReport(report());
    return one.client.flush();
  })(), true);
  await two.client.hydrate();
  await two.client.ensureReport("rpt_client");
  await one.client.ensureReport("rpt_client");

  // Tab two edits and saves first.
  const theirs = { ...two.client.getReport("rpt_client")!, patientLabel: "Edited in tab two", updatedAt: "2026-10-09T10:00:00.000Z" };
  two.client.saveReport(theirs);
  assert.equal(await two.client.flush(), true);

  // Tab one still has rev 1.
  const before = one.notified();
  const mine = { ...one.client.getReport("rpt_client")!, patientLabel: "Edited in tab one", updatedAt: "2026-10-09T09:59:00.000Z" };
  one.client.saveReport(mine);
  assert.equal(await one.client.reportSettled("rpt_client"), false);
  assert.equal(one.client.getReport("rpt_client")?.patientLabel, "Edited in tab two", "the stored copy replaced the stale one");
  assert.ok(one.notified() > before);
  const state = one.client.syncState();
  assert.equal(state.failed, true);
  assert.match(state.error ?? "", /changed|saved/i);
  assert.ok(one.log.some((l) => l.method === "PUT" && l.status === 409));

  // Editing on top of the loaded copy saves normally.
  one.client.saveReport({ ...one.client.getReport("rpt_client")!, patientLabel: "Merged", updatedAt: "2026-10-09T10:01:00.000Z" });
  assert.equal(await one.client.reportSettled("rpt_client"), true);
  assert.deepEqual(one.client.syncState(), { pending: 0, failed: false });
});

test("durable saves; the server's normalised copy (unattested confirmation → proposed) replaces the cached one", async () => {
  const { deps, store } = backend();
  const t = tab(deps);
  await t.client.hydrate();
  const claimed: FormDefinition = { ...HARROW_PIKE_RAW, id: "frm_claimed", tenantId: "demo", status: "confirmed", confirmed: { by: "Someone", at: "2026-10-01T09:00:00.000Z" } };
  assert.equal(t.client.saveForm(claimed), true);
  assert.equal(await t.client.formSettled("frm_claimed"), true);
  const cached = t.client.getForm("frm_claimed");
  assert.equal(cached?.status, "proposed");
  assert.equal(cached?.tenantId, A);
  assert.equal((await store.getForm(A, "frm_claimed"))?.status, "proposed");

  // A refused record that was never stored is not shown as held (an imported case with a forged approval).
  const forged = { ...report("rpt_forged"), status: "signed" as const };
  t.client.saveReport(forged);
  assert.equal(await t.client.reportSettled("rpt_forged"), false);
  assert.equal(t.client.getReport("rpt_forged"), null);
});

test("deletes reach the server; another tab's snapshot drops them", async () => {
  const { deps, store } = backend();
  const t = tab(deps);
  t.client.saveReport(report("rpt_del"));
  await t.client.flush();
  const other = tab(deps);
  await other.client.loadAllReports();
  assert.equal(other.client.listReports().length, 1);
  t.client.deleteReport("rpt_del");
  assert.equal(t.client.getReport("rpt_del"), null, "gone from the cache at once");
  assert.equal(await t.client.flush(), true);
  assert.equal(await store.getReport(A, "rpt_del"), null);
  await other.client.hydrate({ force: true });
  assert.equal(other.client.listReports().length, 0);
});

test("a snapshot taken before this tab's newest save does not drop or roll back that record", async () => {
  const { deps } = backend();
  const served = storeFetch(deps, { member: "a" });
  let gate: Promise<void> | null = null;
  const racing: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/store/snapshot") && gate) {
      const res = await served(input, init); // the server's view NOW (before the save below)
      await gate;
      return res;
    }
    return served(input, init);
  };
  const client = createServerStore({ api: createServerApi(racing), browserEvents: false, notify: () => undefined });
  await client.hydrate();
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const refresh = client.hydrate({ force: true }); // e.g. the tab regained focus
  await new Promise((r) => setImmediate(r));
  client.saveReport(report("rpt_race"));
  assert.equal(await client.flush(), true);
  release();
  await refresh;
  assert.equal(client.getReport("rpt_race")?.id, "rpt_race", "kept: stored after the snapshot was taken");
  gate = null;
  await client.hydrate({ force: true });
  assert.equal(client.getReport("rpt_race")?.id, "rpt_race");
});

test("form files: chunked upload of a multi-chunk file; another tab downloads and verifies it", async () => {
  const { deps, store } = backend();
  const t = tab(deps);
  const bytes = fakePdf(STORE_FILE_CHUNK_BYTES * 2 + 10);
  const sha256 = sha256Hex(bytes);
  assert.equal(await t.client.saveFile({ sha256, fileName: "Insurer.pdf", mimeType: "application/pdf", bytes }), true);
  assert.deepEqual(
    t.log.map((l) => `${l.method} ${l.path.replace(sha256, "<sha>")}`),
    [
      "POST /api/reports/v1/store/files",
      "PUT /api/reports/v1/store/files/<sha>/chunks/0",
      "PUT /api/reports/v1/store/files/<sha>/chunks/1",
      "PUT /api/reports/v1/store/files/<sha>/chunks/2",
      "POST /api/reports/v1/store/files/<sha>/complete",
    ],
  );
  assert.equal((await store.getFileMeta(A, sha256))?.chunkCount, 3);
  // Uploading the same file again sends nothing but the check.
  assert.equal(await tab(deps).client.saveFile({ sha256, fileName: "Insurer.pdf", mimeType: "application/pdf", bytes }), true);

  const other = tab(deps);
  const got = await other.client.getFile(sha256);
  assert.deepEqual(got?.bytes, bytes);
  assert.equal(got?.fileName, "Insurer.pdf");
  assert.equal(got?.mimeType, "application/pdf");
  assert.equal(await other.client.getFile("0".repeat(64)), null);
});

test("page hide: flush sends what is waiting with keepalive; signed out: the change is kept and reported", async () => {
  const { deps, store } = backend();
  const log: FetchLog[] = [];
  const served = storeFetch(deps, { member: "a", log });
  let dropNext = true;
  const flaky: typeof fetch = (input, init) => {
    if (dropNext && init?.method === "PUT") {
      dropNext = false;
      return Promise.reject(new TypeError("Failed to fetch")); // the connection drops once
    }
    return served(input, init);
  };
  const client = createServerStore({ api: createServerApi(flaky), browserEvents: false, notify: () => undefined, queue: { backoffMs: () => 60_000 } });
  await client.hydrate();
  client.setReferrerLinks({ "harrow pike": HARROW_PIKE_RAW.id });
  await new Promise((r) => setImmediate(r));
  assert.equal(client.syncState().pending, 1, "waiting for the retry");
  assert.match(client.syncState().error ?? "", /connection/i);
  assert.equal(await client.flush({ keepalive: true }), true, "the page-hide flush does not wait for the back-off");
  const put = log.filter((l) => l.method === "PUT");
  assert.deepEqual(put.map((l) => [l.path, l.keepalive, l.status]), [["/api/reports/v1/store/settings", true, 200]]);
  assert.deepEqual((await store.getSettings(A))?.referrerLinks, { "harrow pike": HARROW_PIKE_RAW.id });

  const out = tab(deps, null);
  out.client.saveReport(report("rpt_out"));
  assert.equal(await out.client.reportSettled("rpt_out"), false);
  const state = out.client.syncState();
  assert.equal(state.pending, 1, "kept for when the member signs in again");
  assert.match(state.error ?? "", /sign in/i);
  assert.equal(out.client.getReport("rpt_out")?.id, "rpt_out");
});

test("ui/store.ts in server mode: same exports, no localStorage or IndexedDB, durable extras; browser mode untouched", async () => {
  const { deps, store } = backend();
  const touched: string[] = [];
  const trap = (name: string) => ({
    get() {
      touched.push(name);
      throw new Error(`${name} must not be used in server mode`);
    },
    configurable: true,
  });
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, window: g.window, BroadcastChannel: g.BroadcastChannel };
  g.fetch = storeFetch(deps, { member: "a" });
  g.BroadcastChannel = undefined; // Node's would keep the test process alive
  const fakeWindow: Record<string, unknown> = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
  Object.defineProperty(fakeWindow, "localStorage", trap("localStorage"));
  Object.defineProperty(fakeWindow, "indexedDB", trap("indexedDB"));
  g.window = fakeWindow;
  Object.defineProperty(globalThis, "localStorage", trap("localStorage"));
  Object.defineProperty(globalThis, "indexedDB", trap("indexedDB"));
  try {
    const s = await import("../../src/modules/medreport/ui/store");
    s.setStoreMode("server");
    assert.equal(s.getStoreMode(), "server");
    await s.ensureSampleForms();
    assert.deepEqual(s.listForms(), [], "no fictional samples are added to a clinic");
    assert.equal(await s.saveReportDurable(report("rpt_facade")), true);
    assert.equal((await store.getReport(A, "rpt_facade"))?.rev, 1);
    const form = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: A }, "Practice manager", "2026-10-01T09:00:00.000Z");
    assert.equal(await s.saveFormDurable(form), true);
    assert.equal(s.getForm(form.id)?.status, "confirmed");
    const bytes = fakePdf(9000);
    assert.equal(await s.saveFormFile({ sha256: sha256Hex(bytes), fileName: "f.pdf", mimeType: "application/pdf", bytes }), true);
    assert.equal(s.saveReferrerLinks({ "harrow pike": form.id }), true);
    assert.deepEqual(s.getStoredReferrerLinks(), { "harrow pike": form.id });
    assert.equal(await s.flushStore(), true);
    assert.deepEqual(s.getStoreSyncState(), { pending: 0, failed: false });
    assert.equal(s.exportCase("rpt_facade") instanceof Blob, true);
    s.deleteReport("rpt_facade");
    assert.equal(await s.flushStore(), true);
    assert.equal(await store.getReport(A, "rpt_facade"), null);
    s.resetDemo(); // never deletes the clinic's records
    assert.ok(await store.getForm(A, form.id));
    assert.deepEqual(touched, [], "server mode never touched localStorage or IndexedDB");

    s.setStoreMode("browser");
    assert.equal(s.getStoredReferrerLinks(), null);
    assert.equal(s.saveReferrerLinks({}), false);
    assert.deepEqual(s.getStoreSyncState(), { pending: 0, failed: false });
    assert.equal(await s.flushStore(), true);
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).indexedDB;
    Object.assign(g, { fetch: saved.fetch, window: saved.window, BroadcastChannel: saved.BroadcastChannel });
    if (saved.window === undefined) delete g.window;
  }
});

/* ---------------------------------------------------------------------------------------------------------------
 * Fix wave 2 (security review): the in-memory store belongs to one clinic and member.
 * -------------------------------------------------------------------------------------------------------------*/

function scopedTab(jar: { who: string | null }, deps: ReturnType<typeof storeDeps>) {
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => storeFetch(deps, { member: jar.who })(input, init)) as typeof fetch;
  return createServerStore({ fetch: fetchFn, browserEvents: false, notify: () => {}, queue: { backoffMs: () => 1, maxAttempts: 2 } });
}

function twoClinics() {
  const store = createMemoryTenantStore();
  const deps = storeDeps(store, {
    alice: member("clinic-x", { userId: "user-alice", authSessionId: "sess-alice" }),
    bob: member("clinic-y", { userId: "user-bob", authSessionId: "sess-bob" }),
    carol: member("clinic-x", { userId: "user-carol", authSessionId: "sess-carol" }),
  });
  return { store, deps };
}

function xReport(id: string, patientLabel: string): Report {
  return { ...report(id, patientLabel), tenantId: "clinic-x", bundleSnapshot: { ...report(id, patientLabel).bundleSnapshot, tenantId: "clinic-x" } };
}

test("fix wave 2: a new sign-in in the same tab never sees the previous clinic's records", async () => {
  const { deps } = twoClinics();
  const jar = { who: "alice" as string | null };
  const client = scopedTab(jar, deps);
  client.setScope({ tenantId: "clinic-x", userId: "user-alice" });
  await client.hydrate();
  assert.equal(client.saveReport(xReport("rpt_x1", "Megan Hart")), true);
  assert.equal(await client.flush(), true);
  await client.loadAllReports();
  assert.equal(client.listReports().length, 1);

  // Alice signs out; Bob (clinic Y) signs in on the same tab without a full page load: the Studio's host gives
  // the new scope, and the cache is emptied before anything is shown.
  jar.who = "bob";
  assert.equal(client.setScope({ tenantId: "clinic-y", userId: "user-bob" }), true);
  assert.deepEqual(client.listReports(), []);
  await client.hydrate();
  await client.loadAllReports();
  assert.deepEqual(client.listReports(), [], "clinic X's report is not listed for Bob");
  assert.equal(await client.ensureReport("rpt_x1"), null, "nor can Bob open it");
  assert.equal(client.tenantId(), "clinic-y");
});

test("fix wave 2: a change queued under one sign-in is never stored under the next one", async () => {
  const { store, deps } = twoClinics();
  const jar = { who: "alice" as string | null };
  const client = scopedTab(jar, deps);
  client.setScope({ tenantId: "clinic-x", userId: "user-alice" });
  await client.hydrate();

  // Alice's session ends while she saves: kept, waiting for sign-in.
  jar.who = null;
  assert.equal(client.saveReport(xReport("rpt_x2", "Daniel Brooks")), true);
  assert.equal(await client.flush(), false);

  // Bob (clinic Y) signs in on the same tab; the page (still Alice's) retries on focus: refused by the server
  // (the request names clinic X and Alice), never re-filed under clinic Y.
  jar.who = "bob";
  client.retryFailed();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await store.getReport("clinic-y", "rpt_x2"), null);
  assert.equal((await store.listReports("clinic-y")).length, 0);
  // The page's next load sees the sign-in changed: it forgets the records and the waiting changes.
  await client.hydrate({ force: true });
  assert.deepEqual(client.listReports(), []);
  assert.equal(client.syncState().pending, 0);
  assert.match(client.syncState().error ?? "", /Reload the page/);

  // Same clinic, another member (Carol): Alice's waiting change is not replayed as Carol's either.
  const tab2 = scopedTab(jar, deps);
  tab2.setScope({ tenantId: "clinic-x", userId: "user-alice" });
  jar.who = "alice";
  await tab2.hydrate();
  jar.who = null;
  tab2.saveReport(xReport("rpt_x3", "Priya Nair"));
  assert.equal(await tab2.flush(), false);
  jar.who = "carol";
  tab2.retryFailed();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await store.getReport("clinic-x", "rpt_x3"), null);
  assert.equal(store.auditLog.some((e) => e.userId === "user-carol"), false);
});

test("fix wave 2: the Studio's host scope reaches the server store through ui/store.ts (setStoreScope)", async () => {
  const mode = await import("../../src/modules/medreport/ui/store/mode");
  mode.setStoreScope({ tenantId: "clinic-x", userId: "user-alice" });
  assert.deepEqual(mode.getStoreScope(), { tenantId: "clinic-x", userId: "user-alice" });
  let calls = 0;
  const off = mode.onStoreScopeChange(() => {
    calls += 1;
  });
  mode.setStoreScope({ tenantId: "clinic-x", userId: "user-alice" });
  assert.equal(calls, 0, "same scope: nothing happens");
  mode.setStoreScope({ tenantId: "clinic-x", userId: "user-carol" });
  assert.equal(calls, 1);
  off();
  mode.setStoreScope(null);
});
