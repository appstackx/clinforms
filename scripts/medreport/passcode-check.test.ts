/**
 * POST /api/reports/v1/passcode/check (api/handlers/passcode-check.ts): the public demo's passcode is checked by
 * the server before the Studio stores it – with the SAME check and wrong-guess counters as live calls
 * (ai/live-gate.ts checkDemoPasscode → auth/passcode.ts), no live slot taken, no drafting service called, and the
 * passcode never logged. Run with a test-only passcode and a dummy key; every outbound fetch is refused.
 * Fictional data only.
 */
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A live-capable public demo: auto mode, a dummy key that is never used, a test-only passcode and test secrets.
const PASSCODE = "test-only-passcode-0123456789";
const BASE_ENV: Record<string, string> = {
  MEDREPORT_AI_MODE: "auto",
  ANTHROPIC_API_KEY: "test-key-never-called",
  MEDREPORT_LIVE_PASSCODE: PASSCODE,
  MEDREPORT_LAUNCH_SECRET: "test-launch-secret-".padEnd(40, "l"),
  MEDREPORT_SIGNING_SECRET: "test-signing-secret-".padEnd(40, "s"),
  MEDREPORT_PARTNER_KEY: "test-partner-key-".padEnd(32, "p"),
  TM3_SIM_TOKEN: "test-tm3-sim-token-".padEnd(32, "t"),
  APP_ORIGIN: "https://clinforms.test",
};
for (const k of ["CLINFORMS_PUBLIC_DEMO", "CLINFORMS_DB", "BETTER_AUTH_URL", "VERCEL", "PORT", "TM3_SIM_BASE_URL"]) delete process.env[k];
Object.assign(process.env, BASE_ENV);

import { Kysely } from "kysely";
import { dbSharedState, getMedreportDeps } from "@/app/api/_medreport-glue";
import { CONTENT_TYPES, ProblemSchema, REPORT_API_ENDPOINTS, reportApiPaths } from "@/modules/medreport/api/contract";
import type { AuthContext, MedreportDeps } from "@/modules/medreport/api/deps";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { handlePasscodeCheck } from "@/modules/medreport/api/handlers/passcode-check";
import { bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { takeLiveCallsFor } from "@/modules/medreport/ai/live-gate";
import type { Actor } from "@/modules/medreport/auth/actor";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import {
  LIVE_CALLS_PER_MINUTE,
  PASSCODE_FAILURES_PER_CLIENT,
  PASSCODE_FAILURES_PER_INSTANCE,
  resetLiveCallLimiter,
  resetPasscodeFailures,
  resetSharedDemoCounters,
} from "@/modules/medreport/auth/passcode";
import { resetMemoryLimits } from "@/modules/medreport/auth/shared-limits";
import { formTemplateId } from "@/modules/medreport/core/forms";
import { HARROW_PIKE_FORM } from "@/modules/medreport/forms/samples/maps/harrow-pike";
import { NodeSqliteDialect, openSqliteDatabase } from "@/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "@/server/db/migrations";
import type { Database } from "@/server/db/schema";
import { getDemoBundle } from "./dev-bundles";
import { demoSessionToken } from "./test-actors";

/* ------------------------------------------------------------------------------------------------
 * Fixtures
 * ----------------------------------------------------------------------------------------------*/

/** Every outbound request is refused and recorded: the check must never reach the drafting service. */
const outbound: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(String(input instanceof Request ? input.url : input));
  throw new Error("no outbound requests in this test");
}) as typeof fetch;

/** Every log line, to prove the passcode never reaches the logs. */
const logLines: string[] = [];
const realConsole = { info: console.info, log: console.log, warn: console.warn, error: console.error };
for (const level of ["info", "log", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
}

const MEMBER: AuthContext = { userId: "u_clin_a", authSessionId: "s_clin_a", tenantId: "clinic-a", role: "clinician", name: "Sam Ward (fictional)", twoFactorVerified: true };

let tmpDir: string;
let db1: Kysely<Database>;
let db2: Kysely<Database>;
/** Two "instances" sharing one database (the shared rate_limits store, as on Vercel). */
let one: MedreportDeps;
let two: MedreportDeps;
/** A single local process: no shared store, the in-memory counters (next dev, demo:red). */
let local: MedreportDeps;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-passcode-"));
  const file = path.join(tmpDir, "shared.db");
  const first = openSqliteDatabase(file);
  applySqliteMigrations(first);
  db1 = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: first }) });
  db2 = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: openSqliteDatabase(file) }) });
  const base = getMedreportDeps();
  const stubAuth = async (req: Request) => (req.headers.get("x-test-member") === "clin-a" ? MEMBER : null);
  local = { ...base, sharedState: undefined, authenticate: stubAuth };
  one = { ...base, sharedState: dbSharedState(() => db1), authenticate: stubAuth };
  two = { ...base, sharedState: dbSharedState(() => db2), authenticate: stubAuth };
});

after(async () => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  await db1?.destroy();
  await db2?.destroy();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  Object.assign(process.env, BASE_ENV);
  delete process.env.CLINFORMS_PUBLIC_DEMO;
  resetPasscodeFailures();
  resetMemoryLimits();
  resetLiveCallLimiter();
});

afterEach(() => {
  assert.deepEqual(outbound, [], "no outbound request (the drafting service is never called)");
});

let ipCounter = 0;
/** A fresh client address per test, so the per-client wrong-guess counters never leak between tests. */
const freshIp = () => `203.0.113.${(ipCounter += 1)}`;

interface CallInit {
  passcode?: string | null;
  ip?: string;
  bearer?: string | null;
  member?: string;
  headers?: Record<string, string>;
  deps?: MedreportDeps;
}

function checkRequest(init: CallInit = {}): Request {
  const headers: Record<string, string> = { "content-type": CONTENT_TYPES.json, "x-forwarded-for": init.ip ?? "198.51.100.200", ...init.headers };
  const bearer = init.bearer === undefined ? demoSessionToken() : init.bearer;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (init.passcode !== null && init.passcode !== undefined) headers["x-medreport-passcode"] = init.passcode;
  if (init.member) headers["x-test-member"] = init.member;
  return new Request(`http://localhost${reportApiPaths.passcodeCheck()}`, { method: "POST", headers, body: "{}" });
}

function run(handler: MedreportHandler, req: Request, deps: MedreportDeps): Promise<Response> {
  return bindHandler(handler, () => deps)(req, { params: {} });
}

const check = (init: CallInit = {}) => run(handlePasscodeCheck, checkRequest(init), init.deps ?? local);

async function expectProblem(res: Response, status: number, code: string, label = ""): Promise<void> {
  const text = await res.clone().text();
  assert.equal(res.status, status, `${label} ${text}`);
  assert.equal(ProblemSchema.parse(await res.json()).code, code, label);
}

/** POST /drafts asking for live drafting in the demo (a confirmed sample form; the gate decides before any drafting). */
function liveDraft(passcode: string, ip: string, deps: MedreportDeps): Promise<Response> {
  const form = withAttestedConfirmation(HARROW_PIKE_FORM, "Practice manager", "2026-10-01T09:00:00.000Z");
  const bundle = getDemoBundle("megan-hart");
  const req = new Request("http://localhost/api/reports/v1/drafts", {
    method: "POST",
    headers: { "content-type": CONTENT_TYPES.json, authorization: `Bearer ${demoSessionToken()}`, "x-medreport-passcode": passcode, "x-forwarded-for": ip },
    body: JSON.stringify({ templateId: formTemplateId(form.id), bundle, instructingParty: bundle.referral, sectionKeys: ["F-07"], form, prefer: "live" }),
  });
  return run(handleDrafts, req, deps);
}

const demoActor: Actor = { tenantId: "demo", sid: "ses_demo", via: "demo", role: "clinician" };

/* ------------------------------------------------------------------------------------------------
 * The endpoint
 * ----------------------------------------------------------------------------------------------*/

describe("POST /passcode/check", () => {
  test("is in the contract: POST, a demo caller, handler passcode-check.ts", () => {
    const ep = REPORT_API_ENDPOINTS.find((e) => e.name === "passcodeCheck");
    assert.ok(ep);
    assert.equal(ep.method, "POST");
    assert.equal(ep.path, "/api/reports/v1/passcode/check");
    assert.equal(ep.handler, "passcode-check.ts");
    assert.equal(reportApiPaths.passcodeCheck(), "/api/reports/v1/passcode/check");
  });

  for (const [label, deps] of [
    ["one local process", () => local],
    ["shared store", () => one],
  ] as const) {
    test(`${label}: right passcode → 204 (no body, no-store); wrong → 401 PASSCODE_INVALID; none → 401 PASSCODE_REQUIRED`, async () => {
      const ip = freshIp();
      const ok = await check({ passcode: PASSCODE, ip, deps: deps() });
      assert.equal(ok.status, 204, await ok.clone().text());
      assert.equal(await ok.text(), "");
      assert.equal(ok.headers.get("cache-control"), "no-store");
      // Surrounding spaces are ignored, as on live calls.
      assert.equal((await check({ passcode: `  ${PASSCODE} `, ip, deps: deps() })).status, 204);
      await expectProblem(await check({ passcode: "wrong-guess-1", ip, deps: deps() }), 401, "PASSCODE_INVALID");
      await expectProblem(await check({ passcode: null, ip, deps: deps() }), 401, "PASSCODE_REQUIRED");
      await expectProblem(await check({ passcode: "   ", ip, deps: deps() }), 401, "PASSCODE_REQUIRED");
    });

    test(`${label}: locked out after ${PASSCODE_FAILURES_PER_CLIENT} wrong guesses – 429 with Retry-After, even for the right passcode`, async () => {
      const ip = freshIp();
      for (let i = 0; i < PASSCODE_FAILURES_PER_CLIENT; i++) await expectProblem(await check({ passcode: `wrong-${i}`, ip, deps: deps() }), 401, "PASSCODE_INVALID", `guess ${i + 1}`);
      const locked = await check({ passcode: PASSCODE, ip, deps: deps() });
      await expectProblem(locked.clone(), 429, "RATE_LIMITED");
      const retryAfter = Number(locked.headers.get("retry-after"));
      assert.ok(retryAfter >= 1 && retryAfter <= 600, `retry-after ${retryAfter}`);
      assert.equal(ProblemSchema.parse(await locked.json()).retryable, true);
      // Another client is not locked out by them.
      assert.equal((await check({ passcode: PASSCODE, ip: freshIp(), deps: deps() })).status, 204);
    });
  }

  test("no live drafting on this deployment → 503 LIVE_AI_UNAVAILABLE (demo mode, no key, or no passcode configured)", async () => {
    for (const [k, v] of [
      ["MEDREPORT_AI_MODE", "demo"],
      ["ANTHROPIC_API_KEY", ""],
      ["MEDREPORT_LIVE_PASSCODE", ""],
    ] as const) {
      process.env[k] = v;
      await expectProblem(await check({ passcode: PASSCODE, ip: freshIp() }), 503, "LIVE_AI_UNAVAILABLE", k);
      process.env[k] = BASE_ENV[k];
    }
  });

  test("the public demo only: a clinic's member → 403; no session → 401; public demo off → 404; cross-site → 403", async () => {
    await expectProblem(await check({ passcode: PASSCODE, member: "clin-a", bearer: null }), 403, "FORBIDDEN", "member");
    await expectProblem(
      await check({ passcode: PASSCODE, member: "clin-a", headers: { referer: "http://localhost/app/studio/new" } }),
      403,
      "FORBIDDEN",
      "member with a demo session, from the clinic's Studio",
    );
    // From the public demo's own pages a demo session is the demo, whatever the browser's sign-in (auth/actor.ts).
    assert.equal((await check({ passcode: PASSCODE, member: "clin-a", ip: freshIp(), headers: { referer: "http://localhost/reports/new" } })).status, 204);
    await expectProblem(await check({ passcode: PASSCODE, bearer: null }), 401, "UNAUTHORIZED", "no session");
    await expectProblem(await check({ passcode: PASSCODE, bearer: "v1.e30.AAAA" }), 401, "TOKEN_INVALID", "forged session");
    process.env.CLINFORMS_PUBLIC_DEMO = "0";
    await expectProblem(await check({ passcode: PASSCODE }), 404, "NOT_FOUND", "public demo off");
    await expectProblem(await check({ passcode: PASSCODE, member: "clin-a", bearer: null }), 404, "NOT_FOUND", "public demo off, member");
    delete process.env.CLINFORMS_PUBLIC_DEMO;
    await expectProblem(await check({ passcode: PASSCODE, headers: { origin: "https://evil.example" } }), 403, "ORIGIN_NOT_ALLOWED", "cross-site");
    assert.equal((await check({ passcode: PASSCODE, ip: freshIp(), headers: { origin: "http://localhost" } })).status, 204, "same origin");
  });

  test("takes no live-call slot: after many checks every live slot of the minute is still free", async () => {
    for (const deps of [local, one]) {
      for (let i = 0; i < LIVE_CALLS_PER_MINUTE * 3; i++) assert.equal((await check({ passcode: PASSCODE, ip: freshIp(), deps })).status, 204);
      const slots = await takeLiveCallsFor(demoActor, deps, LIVE_CALLS_PER_MINUTE);
      assert.equal(slots.ok, true, "all slots free");
      resetLiveCallLimiter();
      resetMemoryLimits();
    }
  });

  test("the passcode – right or wrong – never reaches the logs; the outcome does", async () => {
    logLines.length = 0;
    const ip = freshIp();
    await check({ passcode: PASSCODE, ip });
    await check({ passcode: "a-wrong-guess-to-log", ip });
    await check({ passcode: "another-wrong-guess", ip, headers: { origin: "https://evil.example" } });
    await check({ passcode: PASSCODE, member: "clin-a", bearer: null });
    const all = logLines.join("\n");
    assert.ok(!all.includes(PASSCODE), "right passcode not logged");
    assert.ok(!all.includes("a-wrong-guess-to-log") && !all.includes("another-wrong-guess"), "wrong guesses not logged");
    const events = logLines.map((l) => JSON.parse(l) as { event?: string; result?: string }).filter((l) => l.event === "passcode_check");
    assert.deepEqual(
      events.map((e) => e.result),
      ["ok", "invalid", "not_demo"],
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * Guesses sent at the same time (shared store)
 * ----------------------------------------------------------------------------------------------*/

describe("concurrent guesses on the shared store", () => {
  beforeEach(async () => {
    await resetSharedDemoCounters(one);
  });

  const statuses = async (responses: Promise<Response>[]) => (await Promise.all(responses)).map((r) => r.status);
  const tally = (list: number[]) => list.reduce<Record<number, number>>((t, s) => ({ ...t, [s]: (t[s] ?? 0) + 1 }), {});

  test(`50 wrong checks at once from one client: at most ${PASSCODE_FAILURES_PER_CLIENT} are compared (401), the rest are refused (429)`, async () => {
    const ip = freshIp();
    const got = tally(await statuses(Array.from({ length: 50 }, (_, i) => check({ passcode: `burst-guess-${i}`, ip, deps: i % 2 ? one : two }))));
    assert.ok((got[401] ?? 0) <= PASSCODE_FAILURES_PER_CLIENT, JSON.stringify(got));
    assert.equal((got[401] ?? 0) + (got[429] ?? 0), 50, JSON.stringify(got));
    // Locked for the right passcode too – the burst gained nothing.
    await expectProblem(await check({ passcode: PASSCODE, ip, deps: one }), 429, "RATE_LIMITED", "right passcode after the burst");
  });

  test("a burst of wrong live calls (POST /drafts) is bounded the same way", async () => {
    const ip = freshIp();
    const got = tally(await statuses(Array.from({ length: 20 }, (_, i) => liveDraft(`burst-draft-${i}`, ip, i % 2 ? one : two))));
    assert.ok((got[401] ?? 0) <= PASSCODE_FAILURES_PER_CLIENT, JSON.stringify(got));
    assert.equal((got[401] ?? 0) + (got[429] ?? 0), 20, JSON.stringify(got));
  });

  test(`wrong checks at once from many clients: at most ${PASSCODE_FAILURES_PER_INSTANCE} answered 401 for the deployment; the right passcode still passes`, async () => {
    const got = tally(await statuses(Array.from({ length: PASSCODE_FAILURES_PER_INSTANCE + 15 }, (_, i) => check({ passcode: `wide-guess-${i}`, ip: freshIp(), deps: i % 2 ? one : two }))));
    assert.ok((got[401] ?? 0) <= PASSCODE_FAILURES_PER_INSTANCE, JSON.stringify(got));
    assert.equal((got[401] ?? 0) + (got[429] ?? 0), PASSCODE_FAILURES_PER_INSTANCE + 15, JSON.stringify(got));
    await expectProblem(await check({ passcode: "one-more-wrong-guess", ip: freshIp(), deps: one }), 429, "RATE_LIMITED", "deployment cap");
    // Other clients' guesses never lock out a presenter holding the right passcode (fix wave 2).
    assert.equal((await check({ passcode: PASSCODE, ip: freshIp(), deps: two })).status, 204);
  });

  test("a presenter's own requests never add up: the right passcode clears the client's count, and calls at once all pass", async () => {
    const ip = freshIp();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < PASSCODE_FAILURES_PER_CLIENT - 1; i++) await expectProblem(await check({ passcode: `typo-${round}-${i}`, ip, deps: one }), 401, "PASSCODE_INVALID", `round ${round} typo ${i + 1}`);
      assert.equal((await check({ passcode: PASSCODE, ip, deps: two })).status, 204, `round ${round}: right passcode`);
    }
    // The Studio's busiest moment: a check and three drafting groups at once, many times over.
    for (let round = 0; round < 4; round++) {
      assert.deepEqual(await statuses(Array.from({ length: 4 }, (_, i) => check({ passcode: PASSCODE, ip, deps: i % 2 ? one : two }))), [204, 204, 204, 204]);
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * The check and live calls count wrong guesses together
 * ----------------------------------------------------------------------------------------------*/

describe("check + live calls share the wrong-guess counter", () => {
  test("one local process: wrong guesses on POST /drafts and POST /passcode/check add up", async () => {
    const ip = freshIp();
    await expectProblem(await liveDraft("wrong-on-drafts-1", ip, local), 401, "PASSCODE_INVALID", "drafts 1");
    await expectProblem(await liveDraft("wrong-on-drafts-2", ip, local), 401, "PASSCODE_INVALID", "drafts 2");
    await expectProblem(await check({ passcode: "wrong-on-check-1", ip }), 401, "PASSCODE_INVALID", "check 1");
    await expectProblem(await check({ passcode: "wrong-on-check-2", ip }), 401, "PASSCODE_INVALID", "check 2");
    await expectProblem(await liveDraft("wrong-on-drafts-3", ip, local), 401, "PASSCODE_INVALID", "drafts 3");
    // Five wrong in all: locked on both, even with the right passcode.
    await expectProblem(await check({ passcode: PASSCODE, ip }), 429, "RATE_LIMITED", "check locked");
    await expectProblem(await liveDraft(PASSCODE, ip, local), 429, "RATE_LIMITED", "drafts locked");
  });

  test("shared store, two instances: three wrong checks on one and two wrong live calls on the other lock both endpoints everywhere", async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) await expectProblem(await check({ passcode: `wrong-check-${i}`, ip, deps: one }), 401, "PASSCODE_INVALID", `check ${i + 1}`);
    for (let i = 0; i < 2; i++) await expectProblem(await liveDraft(`wrong-draft-${i}`, ip, two), 401, "PASSCODE_INVALID", `drafts ${i + 1}`);
    for (const deps of [one, two]) {
      await expectProblem(await check({ passcode: PASSCODE, ip, deps }), 429, "RATE_LIMITED", "check locked");
      await expectProblem(await liveDraft(PASSCODE, ip, deps), 429, "RATE_LIMITED", "drafts locked");
    }
    // The counters are the live gate's own keys in rate_limits (never the address itself).
    const keys = (await db1.selectFrom("rate_limits").select("key").execute()).map((r) => r.key);
    assert.ok(keys.some((k) => k.startsWith("demo:passcode-fail:client:")), keys.join(" "));
    assert.ok(keys.includes("demo:passcode-fail:all"));
    assert.ok(!keys.join(" ").includes(ip));
  });
});
