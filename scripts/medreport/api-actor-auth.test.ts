/**
 * Wave 2 – the glue's REAL sign-in wiring (src/app/api/_medreport-glue.ts): Better Auth session cookie →
 * MedreportDeps.authenticate (read from the database, never the cookie cache) → the Report API's actor, on
 * the app's own getDb()/getAuth() (local SQLite file, CLINFORMS_DB set so the shared state is the database).
 *
 * invite → accept → (no two-step yet: 403) → two-step on → file import stamped with the clinic and its
 * profile → approval signed as the member (profile HCPC) with an audit row → sign-out: the cookie no longer
 * acts (401, never the demo). The public demo keeps working through the same glue without a cookie, and its
 * launch-link replay guard lands in launch_token_uses. Fictional data only.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-glue-auth-"));
const SECRET = "glue-auth-test-secret-".padEnd(48, "g");
const ORIGIN = "http://localhost:3000";
Object.assign(process.env, {
  CLINFORMS_DB: "sqlite",
  CLINFORMS_SQLITE_PATH: path.join(tmpDir, "app.db"),
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: ORIGIN,
  MEDREPORT_AI_MODE: "demo",
});
for (const k of ["MEDREPORT_LAUNCH_SECRET", "MEDREPORT_SIGNING_SECRET", "MEDREPORT_PARTNER_KEY", "TM3_SIM_TOKEN", "TM3_SIM_BASE_URL", "ANTHROPIC_API_KEY", "CLINFORMS_PUBLIC_DEMO", "VERCEL", "APP_ORIGIN"]) {
  delete process.env[k];
}

import { route } from "@/app/api/_medreport-glue";
import { CONTENT_TYPES, ProblemSchema, SignResponseSchema } from "@/modules/medreport/api/contract";
import { handleFileImportBundle } from "@/modules/medreport/api/handlers/file-import-bundle";
import { handleLaunch } from "@/modules/medreport/api/handlers/launch";
import { handleLaunchVerify } from "@/modules/medreport/api/handlers/launch-verify";
import { handleSign } from "@/modules/medreport/api/handlers/sign";
import { handleValidate } from "@/modules/medreport/api/handlers/validate";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { SAMPLE_IMPORT_FILES } from "@/modules/medreport/connectors/file-import/samples";
import { FORM_ATTESTATIONS } from "@/modules/medreport/core/forms";
import type { EpisodeBundle, Report } from "@/modules/medreport/core/types";
import { HARROW_PIKE_FORM } from "@/modules/medreport/forms/samples/maps/harrow-pike";
import { getAuth } from "@/server/auth/auth";
import { createClinic } from "@/server/auth/platform";
import { CookieJar } from "@/server/auth/testing/cookie-jar";
import { parseOtpAuthUri, totp } from "@/server/auth/testing/totp";
import { getDb } from "@/server/db";
import { setEmailProviderForTests } from "@/server/email";
import { listAudit } from "@/server/repos/audit";
import { upsertMemberProfile } from "@/server/repos/member-profile";
import { completedSampleReport } from "./form-sample-answers";
import { demoSessionToken } from "./test-actors";

const PASSWORD = "correct horse battery staple";
const TENANT = "glue-clinic";

const validate = route(handleValidate);
const fileImport = route(handleFileImportBundle);
const sign = route(handleSign);
const launch = route(handleLaunch);
const launchVerify = route(handleLaunchVerify);

let ownerJar: CookieJar;
let ownerId: string;
let organizationId: string;

function req(url: string, init: { body?: unknown; jar?: CookieJar; bearer?: string; headers?: Record<string, string> } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", CONTENT_TYPES.json);
  const cookie = init.jar?.header();
  if (cookie) headers.set("cookie", cookie);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  return new Request(`${ORIGIN}/api/reports/v1${url}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function codeOf(res: Response): Promise<string> {
  return ProblemSchema.parse(await res.json()).code;
}

/** The completed sample report as this clinic's own. */
function clinicReport(): Report {
  const form = withAttestedConfirmation({ ...HARROW_PIKE_FORM, tenantId: TENANT }, "Practice manager", "2026-10-01T09:00:00.000Z");
  const r = completedSampleReport("megan-hart", form, { id: "rpt_glue" });
  return { ...r, tenantId: TENANT, bundleSnapshot: { ...r.bundleSnapshot, tenantId: TENANT } };
}

before(async () => {
  setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
  const db = getDb();
  const auth = getAuth();
  const clinic = await createClinic(db, { name: "Glue Clinic (fictional)", slug: TENANT, ownerEmail: "owner@glue.example", appOrigin: ORIGIN, linkSecret: SECRET });
  organizationId = clinic.organizationId;
  ownerJar = new CookieJar();
  const signedUp = await auth.api.signUpEmail({ body: { email: "owner@glue.example", password: PASSWORD, name: "Gwen Owner (fictional)" }, returnHeaders: true });
  ownerJar.absorb(signedUp.headers);
  const accepted = await auth.api.acceptInvitation({ body: { invitationId: clinic.invitationId }, headers: ownerJar.headers(), returnHeaders: true });
  ownerJar.absorb(accepted.headers);
  const fresh = await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true }, returnHeaders: true });
  ownerJar.absorb(fresh.headers);
  ownerId = (fresh.response as { user: { id: string } }).user.id;
});

after(async () => {
  setEmailProviderForTests(null);
  await getDb().destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("no sign-in cookie and no session → 401", async () => {
  const res = await validate(req("/validate", { body: { report: clinicReport() } }), { params: {} });
  assert.equal(res.status, 401);
  assert.equal(await codeOf(res), "UNAUTHORIZED");
});

test("a member who has not set up two-step verification → 403 TWO_FACTOR_REQUIRED (not the demo, even with a demo session)", async () => {
  const res = await validate(req("/validate", { jar: ownerJar, bearer: demoSessionToken(), body: { report: clinicReport() } }), { params: {} });
  assert.equal(res.status, 403);
  assert.equal(await codeOf(res), "TWO_FACTOR_REQUIRED");
});

test("with two-step on: file import is the clinic's, approval is signed as the member, audited; sign-out ends it", async () => {
  const auth = getAuth();
  const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: ownerJar.headers() });
  const otp = parseOtpAuthUri((enabled as { totpURI: string }).totpURI);
  const verified = await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: ownerJar.headers(), returnHeaders: true });
  ownerJar.absorb(verified.headers);

  const imported = await fileImport(req("/connectors/file-import/bundle", { jar: ownerJar, body: { format: "json", content: SAMPLE_IMPORT_FILES.json.content } }), {
    params: {},
  });
  assert.equal(imported.status, 200, await imported.clone().text());
  const { bundle } = (await imported.json()) as { bundle: EpisodeBundle };
  assert.equal(bundle.tenantId, TENANT);
  assert.equal(bundle.clinic?.name, "Glue Clinic (fictional)");

  const report = clinicReport();
  const form = withAttestedConfirmation({ ...HARROW_PIKE_FORM, tenantId: TENANT }, "Practice manager", "2026-10-01T09:00:00.000Z");
  const body = { report, signer: { name: "Gwen Owner (fictional)", hcpc: "PH-DEMO-09" }, typedSignature: "Gwen Owner (fictional)", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form };
  // No HCPC / "may sign" on the member profile yet.
  const refused = await sign(req("/sign", { jar: ownerJar, body }), { params: {} });
  assert.equal(refused.status, 403);
  assert.equal(await codeOf(refused), "SIGNER_NOT_ALLOWED");
  await upsertMemberProfile({ db: getDb() }, organizationId, ownerId, { jobTitle: "Clinical Lead", hcpcNumber: "PH-DEMO-09", canSign: true });
  const ok = await sign(req("/sign", { jar: ownerJar, body }), { params: {} });
  assert.equal(ok.status, 200, await ok.clone().text());
  const { receipt } = SignResponseSchema.parse(await ok.json());
  assert.deepEqual(receipt.signer, { name: "Gwen Owner (fictional)", hcpc: "PH-DEMO-09", role: "Clinical Lead" });
  assert.equal(receipt.approvedVia?.kind, "user");
  assert.equal(receipt.approvedVia?.userId, ownerId);
  const rows = await listAudit({ db: getDb() }, TENANT);
  const row = rows.find((r) => r.action === "report.sign");
  assert.ok(row, "audit row in the clinic's trail");
  assert.equal(row.userId, ownerId);

  // Sign out: the same cookie no longer acts for the clinic, and never as the demo.
  await auth.api.signOut({ headers: ownerJar.headers() });
  const after = await validate(req("/validate", { jar: ownerJar, body: { report } }), { params: {} });
  assert.equal(after.status, 401);
});

test("the public demo works through the same glue without a cookie; its launch replay guard is in the database", async () => {
  const demo = completedSampleReport("megan-hart", withAttestedConfirmation(HARROW_PIKE_FORM, "Practice manager", "2026-10-01T09:00:00.000Z"));
  const res = await validate(req("/validate", { bearer: demoSessionToken(), body: { report: demo } }), { params: {} });
  // The form map is required for a form report: 422 – the point is that the caller was accepted (not 401/403).
  assert.equal(res.status, 422);
  const issued = await launch(
    req("/launch", {
      headers: { "x-partner-key": "demo-only-partner-key-v1" },
      body: { connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
    }),
    { params: {} },
  );
  assert.equal(issued.status, 201, await issued.clone().text());
  const lt = new URL(((await issued.json()) as { launchUrl: string }).launchUrl).searchParams.get("lt") ?? "";
  assert.equal((await launchVerify(req("/launch/verify", { body: { token: lt } }), { params: {} })).status, 200);
  assert.equal((await launchVerify(req("/launch/verify", { body: { token: lt } }), { params: {} })).status, 401);
  const claims = await getDb().selectFrom("launch_token_uses").select("jti").execute();
  assert.equal(claims.length, 1);
  assert.match(claims[0].jti, /^launch:/);
});
