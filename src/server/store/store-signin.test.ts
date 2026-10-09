/**
 * The whole chain behind a clinic's Studio storage, in process on SQLite: Better Auth sign-in (invite → account →
 * two-step) → the host's actor (buildAuthContext, as src/app/api/_medreport-tenant.ts wires it) → the /store/**
 * handlers → the encrypted repositories. Without two-step the store refuses; with it the member's clinic is the
 * one written, whatever the browser sends; another clinic's member sees nothing.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.MEDREPORT_AI_MODE = "demo";

import type { MedreportDeps } from "../../modules/medreport/api/deps";
import { handleStoreReportGet, handleStoreReportPut } from "../../modules/medreport/api/handlers/store-reports";
import { handleStoreSnapshot } from "../../modules/medreport/api/handlers/store-snapshot";
import { bindHandler, type MedreportHandler } from "../../modules/medreport/api/http";
import { StoreReportResponseSchema, StoreSnapshotResponseSchema, storeApiPaths } from "../../modules/medreport/api/store-contract";
import type { Report } from "../../modules/medreport/core/types";
import { HARROW_PIKE_FORM } from "../../modules/medreport/forms/samples/maps/harrow-pike";
import { completedSampleReport } from "../../../scripts/medreport/form-sample-answers";
import { createAuth, type Auth } from "../auth/create-auth";
import { buildAuthContext } from "../auth/medreport-actor";
import { createClinic } from "../auth/platform";
import { CookieJar } from "../auth/testing/cookie-jar";
import { parseOtpAuthUri, totp } from "../auth/testing/totp";
import { createSqliteTestDb, testCipher, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests } from "../email";
import { listAudit } from "../repos/audit";
import { createTenantStore } from "./tenant-store";

const ORIGIN = "http://localhost:3000";
const SECRET = "store-signin-secret-".padEnd(48, "s");
const PASSWORD = "correct horse battery staple";

describe("clinic storage behind a real sign-in (Better Auth on SQLite)", () => {
  let t: TestDb;
  let auth: Auth;
  let deps: MedreportDeps;

  async function call(handler: MedreportHandler, jar: CookieJar | null, path: string, init: RequestInit = {}, params: Record<string, string> = {}) {
    const headers = new Headers(init.headers);
    if (jar) headers.set("cookie", jar.header());
    if (init.method && init.method !== "GET") headers.set("origin", ORIGIN);
    return bindHandler(handler, () => deps)(new Request(`${ORIGIN}${path}`, { ...init, headers }), { params });
  }

  async function memberOf(slug: string, email: string, withTwoFactor: boolean): Promise<CookieJar> {
    const clinic = await createClinic(t.db, { name: `${slug} (fictional)`, slug, ownerEmail: email, appOrigin: ORIGIN, linkSecret: SECRET });
    const jar = new CookieJar();
    jar.absorb((await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Olivia Owner" }, returnHeaders: true })).headers);
    jar.absorb((await auth.api.acceptInvitation({ body: { invitationId: clinic.invitationId }, headers: jar.headers(), returnHeaders: true })).headers);
    jar.absorb((await auth.api.getSession({ headers: jar.headers(), query: { disableCookieCache: true }, returnHeaders: true })).headers);
    if (withTwoFactor) {
      const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers() });
      const otp = parseOtpAuthUri((enabled as { totpURI: string }).totpURI);
      jar.absorb((await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers(), returnHeaders: true })).headers);
    }
    return jar;
  }

  before(async () => {
    t = createSqliteTestDb();
    auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: { kind: "static", url: ORIGIN }, rateLimit: false });
    setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
    const cipher = testCipher();
    deps = {
      connectors: {} as MedreportDeps["connectors"],
      createConnectorContext: () => {
        throw new Error("not used");
      },
      authenticate: (req) => buildAuthContext(auth, t.db, req.headers),
      tenantStore: createTenantStore(() => ({ db: t.db, cipher })),
    };
  });
  after(async () => {
    setEmailProviderForTests(null);
    await t?.close();
  });

  it("signed out → 401; signed in without two-step → 403 TWO_FACTOR_REQUIRED; with it → the member's clinic", async () => {
    assert.equal((await call(handleStoreSnapshot, null, storeApiPaths.snapshot())).status, 401);
    const noFactor = await memberOf("lakeside-test", "owner@lakeside.example", false);
    const refused = await call(handleStoreSnapshot, noFactor, storeApiPaths.snapshot());
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, "TWO_FACTOR_REQUIRED");

    const owner = await memberOf("riverside-test", "owner@riverside.example", true);
    const snap = StoreSnapshotResponseSchema.parse(await (await call(handleStoreSnapshot, owner, storeApiPaths.snapshot())).json());
    assert.equal(snap.tenantId, "riverside-test");

    // The browser's copy says "demo": the store files it under the member's clinic.
    const report: Report = completedSampleReport("megan-hart", HARROW_PIKE_FORM, { id: "rpt_signed_in" });
    assert.equal(report.tenantId, "demo");
    const put = await call(handleStoreReportPut, owner, storeApiPaths.report(report.id), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report }),
    }, { id: report.id });
    assert.equal(put.status, 201, await put.clone().text());
    const stored = StoreReportResponseSchema.parse(await put.json());
    assert.equal(stored.report.tenantId, "riverside-test");

    const audit = await listAudit({ db: t.db }, "riverside-test");
    const row = audit.find((a) => a.action === "report.create");
    assert.ok(row?.userId && row.sessionId, "who and which session");

    // Another clinic's member (with two-step) does not see it.
    const other = await memberOf("hillside-test", "owner@hillside.example", true);
    assert.equal((await call(handleStoreReportGet, other, storeApiPaths.report(report.id), {}, { id: report.id })).status, 404);
    const otherSnap = StoreSnapshotResponseSchema.parse(await (await call(handleStoreSnapshot, other, storeApiPaths.snapshot())).json());
    assert.deepEqual([otherSnap.tenantId, otherSnap.reports.length], ["hillside-test", 0]);
  });
});
