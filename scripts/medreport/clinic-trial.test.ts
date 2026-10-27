/**
 * Trials and per-clinic drafting limits in the Report API (10/2026, auth/clinic-access.ts, ai/live-gate.ts):
 * once a clinic's trial has ended nothing new can be created – no new report or form map, no upload, no drafting,
 * no form reading, no notes reading, no launch link – while existing records stay readable and can still be changed;
 * a running (or waiting) trial changes nothing; the public demo is never affected. A clinic's own drafting limits
 * replace the defaults for that clinic only. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";
delete process.env.CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE;
delete process.env.CLINFORMS_TENANT_LIVE_CALLS_PER_DAY;

import type { ClinicProfile, MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleDrafts } from "../../src/modules/medreport/api/handlers/drafts";
import { handleFileImportBundle } from "../../src/modules/medreport/api/handlers/file-import-bundle";
import { handleFileImportConfirm } from "../../src/modules/medreport/api/handlers/file-import-confirm";
import { handleFileImportRead } from "../../src/modules/medreport/api/handlers/file-import-read";
import { handleFormsAnalyse } from "../../src/modules/medreport/api/handlers/forms-analyse";
import { handleLaunch } from "../../src/modules/medreport/api/handlers/launch";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import { storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { effectiveTenantLimits, takeLiveCallsFor } from "../../src/modules/medreport/ai/live-gate";
import type { Actor } from "../../src/modules/medreport/auth/actor";
import { assertClinicMayCreate } from "../../src/modules/medreport/auth/clinic-access";
import { resetMemoryLimits } from "../../src/modules/medreport/auth/shared-limits";
import { DEMO_TENANT_ID } from "../../src/modules/medreport/config.public";
import { BANNED_TERM_PATTERNS, WORDING } from "../../src/modules/medreport/core/wording";
import type { FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { completedSampleReport } from "./form-sample-answers";
import { asApproversReport, signingMember, storeClinicForm, withMapHash } from "./release-store-fixture";
import { ORIGIN, member, storeDeps, storeFetch } from "./store-harness";

const A = "clinic-a";

function profile(trial?: ClinicProfile["trial"], draftingLimits?: ClinicProfile["draftingLimits"]): ClinicProfile {
  return {
    tenantId: A,
    displayName: "Clinic A (fictional)",
    addressLines: [],
    retentionDays: 365,
    draftingEnabled: true,
    ...(trial ? { trial } : {}),
    ...(draftingLimits ? { draftingLimits } : {}),
    contactEmail: "support@clinic-test.example",
  };
}

function setup(initial: ClinicProfile | null) {
  let current = initial;
  const store = createMemoryTenantStore();
  void storeClinicForm(store, A, { ...HARROW_PIKE_RAW, tenantId: A }); // R2-SAF-2: the clinic holds the map its reports are started from
  const deps: MedreportDeps = {
    // bh2 fix round 1 (WC, R1T-WC-06): the owner who creates reports may approve them (a create names its approver).
    ...storeDeps(store, { a: signingMember(A, { role: "owner" }) }),
    clinicProfile: async (tenantId) => (tenantId === A ? current : null),
    verifyPartnerKey: async (key) => (key === "cfk_clinic-a_test" ? { id: "pk_1", tenantId: A } : null),
  };
  return {
    deps,
    store,
    setProfile: (p: ClinicProfile | null) => {
      current = p;
    },
    as: storeFetch(deps, { member: "a" }),
  };
}

function reportFor(id: string): Report {
  return withMapHash(asApproversReport({ ...completedSampleReport("megan-hart", { ...HARROW_PIKE_RAW, tenantId: A }, { id }), tenantId: A }, signingMember(A, { role: "owner" })), { ...HARROW_PIKE_RAW, tenantId: A });
}

function formFor(id: string): FormDefinition {
  return { ...HARROW_PIKE_RAW, id, tenantId: A, status: "proposed", confirmed: undefined };
}

const put = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** A Report API POST as the signed-in member of clinic A (same origin, JSON). */
async function call(deps: MedreportDeps, handler: MedreportHandler, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const req = new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "member=a", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
  return bindHandler(handler, () => deps)(req, { params: {} });
}

async function expectTrialEnded(res: Response, what: string): Promise<void> {
  assert.equal(res.status, 403, `${what}: ${await res.clone().text()}`);
  const problem = (await res.json()) as { code: string; title: string; detail: string };
  assert.equal(problem.code, "TRIAL_ENDED", what);
  assert.equal(problem.title, "Your trial has ended");
  assert.match(problem.detail, /Existing reports and forms can still be opened and downloaded/);
  assert.match(problem.detail, /contact us at support@clinic-test\.example/);
}

test("trial ended: every endpoint that creates something answers 403 TRIAL_ENDED; existing records stay readable and editable", async () => {
  const t = setup(profile({ state: "running", endsAt: "2026-10-27T09:00:00.000Z", daysLeft: 3 }));
  // During the trial: a report and a form map are created as usual.
  const created = await t.as(storeApiPaths.report("rpt_trial_1"), put({ report: reportFor("rpt_trial_1") }));
  assert.equal(created.status, 201, await created.clone().text());
  const form = await t.as(storeApiPaths.form("frm_trial_1"), put({ form: formFor("frm_trial_1") }));
  assert.equal(form.status, 201, await form.clone().text());

  t.setProfile(profile({ state: "ended", endsAt: "2026-10-27T09:00:00.000Z" }));
  await expectTrialEnded(await t.as(storeApiPaths.report("rpt_trial_2"), put({ report: reportFor("rpt_trial_2") })), "new report");
  await expectTrialEnded(await t.as(storeApiPaths.form("frm_trial_2"), put({ form: formFor("frm_trial_2") })), "new form map");
  await expectTrialEnded(
    await t.as(storeApiPaths.files(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: "b".repeat(64), size: 10, name: "form.pdf", mime: "application/pdf" }) }),
    "upload start",
  );
  await expectTrialEnded(
    await t.as(storeApiPaths.fileChunk("b".repeat(64), 0, 10), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(10) }),
    "upload chunk",
  );
  await expectTrialEnded(await call(t.deps, handleDrafts, "/api/reports/v1/drafts", {}), "drafting");
  await expectTrialEnded(await call(t.deps, handleFormsAnalyse, "/api/reports/v1/forms/analyse", {}), "form reading");
  await expectTrialEnded(await call(t.deps, handleFileImportRead, "/api/reports/v1/connectors/file-import/read", {}), "notes reading");
  await expectTrialEnded(await call(t.deps, handleFileImportBundle, "/api/reports/v1/connectors/file-import/bundle", {}), "notes bundle");
  await expectTrialEnded(await call(t.deps, handleFileImportConfirm, "/api/reports/v1/connectors/file-import/confirm", {}), "notes confirm");
  await expectTrialEnded(
    await bindHandler(handleLaunch, () => t.deps)(
      new Request(`${ORIGIN}/api/reports/v1/launch`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-partner-key": "cfk_clinic-a_test" },
        body: JSON.stringify({ connectorId: "file-import", patientId: "sim-pat-001", episodeId: "ep-1", clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } }),
      }),
      { params: {} },
    ),
    "launch link",
  );

  // Existing records: read, and still changed (an existing draft can be finished and approved).
  const read = await t.as(storeApiPaths.report("rpt_trial_1"));
  assert.equal(read.status, 200);
  const etag = read.headers.get("etag") ?? "";
  const stored = ((await read.json()) as { report: Report }).report;
  const updated = await t.as(storeApiPaths.report("rpt_trial_1"), put({ report: { ...stored, updatedAt: new Date().toISOString() } }, { "if-match": etag }));
  assert.equal(updated.status, 200, await updated.clone().text());
  assert.equal((await t.as(storeApiPaths.snapshot())).status, 200);
  assert.equal((await t.as(storeApiPaths.form("frm_trial_1"))).status, 200);

  // Extended again (or converted): creating works again.
  t.setProfile(profile({ state: "running", endsAt: "2026-10-30T09:00:00.000Z", daysLeft: 2 }));
  assert.equal((await t.as(storeApiPaths.report("rpt_trial_3"), put({ report: reportFor("rpt_trial_3") }))).status, 201);
  t.setProfile(profile(undefined));
  assert.equal((await t.as(storeApiPaths.report("rpt_trial_4"), put({ report: reportFor("rpt_trial_4") }))).status, 201);
});

test("a waiting trial, no plan, no profile host and the public demo are never refused", async () => {
  const owner = { tenantId: A, sid: "s", via: "user", role: "owner", userId: "u" } as Actor;
  const demo = { tenantId: DEMO_TENANT_ID, sid: "d", via: "demo", role: "clinician" } as Actor;
  const ended = setup(profile({ state: "ended", endsAt: "2026-10-27T09:00:00.000Z" }));
  await assert.doesNotReject(assertClinicMayCreate(demo, ended.deps, "draft"), "the demo is never a clinic's trial");
  await assert.rejects(assertClinicMayCreate(owner, ended.deps, "draft"), (err: Error & { status?: number }) => err.status === 403);
  await assert.doesNotReject(assertClinicMayCreate(owner, setup(profile({ state: "pending", daysLeft: 3 })).deps, "report"));
  await assert.doesNotReject(assertClinicMayCreate(owner, setup(profile()).deps, "report"));
  await assert.doesNotReject(assertClinicMayCreate(owner, { ...setup(null).deps, clinicProfile: undefined }, "report"));
  // The wording is neutral and says what still works.
  const text = WORDING.server.access.trialEnded("starting a new report", "support@clinic-test.example");
  for (const re of BANNED_TERM_PATTERNS) assert.doesNotMatch(text, re);
});

test("per-clinic drafting limits: the clinic's own limits replace the defaults; other clinics keep the defaults", async () => {
  assert.deepEqual(effectiveTenantLimits(undefined), { perMinute: 10, perDay: 400 });
  assert.deepEqual(effectiveTenantLimits({ perMinute: 30, perDay: 1500 }), { perMinute: 30, perDay: 1500 });
  assert.deepEqual(effectiveTenantLimits({ perDay: 1500 }), { perMinute: 10, perDay: 1500 });
  assert.deepEqual(effectiveTenantLimits({ perMinute: 0, perDay: 2.5 }), { perMinute: 10, perDay: 400 }, "nonsense is ignored");
  assert.deepEqual(effectiveTenantLimits({ perMinute: 601, perDay: 2_000_000 }), { perMinute: 10, perDay: 400 });

  resetMemoryLimits();
  const actor = { tenantId: A, sid: "s", via: "user", role: "owner", userId: "u" } as Actor;
  // Blue Heart-style: 30 a minute. 12 calls at once pass (the default would stop at 10).
  const big = setup(profile(undefined, { perMinute: 30, perDay: 1500 }));
  const results = [];
  for (let i = 0; i < 12; i++) results.push((await takeLiveCallsFor(actor, big.deps, 1)).ok);
  assert.deepEqual(results, Array(12).fill(true));
  // A small clinic on the defaults: the 11th call in the minute is refused.
  resetMemoryLimits();
  const small = setup(profile());
  const smallResults = [];
  for (let i = 0; i < 11; i++) smallResults.push((await takeLiveCallsFor({ ...actor, tenantId: A }, small.deps, 1)).ok);
  assert.deepEqual(smallResults, [...Array(10).fill(true), false]);
  // A day limit of 3: the 4th call that day is refused as the daily limit.
  resetMemoryLimits();
  const daily = setup(profile(undefined, { perMinute: 30, perDay: 3 }));
  for (let i = 0; i < 3; i++) assert.equal((await takeLiveCallsFor(actor, daily.deps, 1)).ok, true);
  const fourth = await takeLiveCallsFor(actor, daily.deps, 1);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.ok === false && fourth.daily, true);
  // A profile that cannot be read: the defaults (never more).
  resetMemoryLimits();
  const broken = { ...setup(null).deps, clinicProfile: async () => Promise.reject(new Error("db down")) };
  const brokenResults = [];
  for (let i = 0; i < 11; i++) brokenResults.push((await takeLiveCallsFor(actor, broken, 1)).ok);
  assert.deepEqual(brokenResults, [...Array(10).fill(true), false]);
  resetMemoryLimits();
});
