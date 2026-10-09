/**
 * Wave 2 – actor, tenancy and hardening on every Report API endpoint (auth/actor.ts, api/http.ts,
 * ai/live-gate.ts, auth/shared-limits.ts, the glue's database-backed capabilities).
 *
 * Per endpoint: unauthenticated 401, another clinic 403 TENANT_MISMATCH, role rules, the public demo still
 * working without sign-in, the signer derived from the sign-in (never the body), form-map attestations and
 * approval receipts refused across clinics, CSRF / content type, audit rows (ids only), and the shared
 * limits holding across two in-process "instances" that share one database (separate connections).
 *
 * Signed-in members are stubbed here (MedreportDeps.authenticate reads an x-test-member header); the real
 * Better Auth wiring of the glue is tested in api-actor-auth.test.ts. Fictional data only.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Demo AI mode with the public demo constants; the database and env are per test file (own process).
process.env.MEDREPORT_AI_MODE = "demo";
for (const k of [
  "MEDREPORT_LAUNCH_SECRET",
  "MEDREPORT_SIGNING_SECRET",
  "MEDREPORT_PARTNER_KEY",
  "TM3_SIM_TOKEN",
  "TM3_SIM_BASE_URL",
  "ANTHROPIC_API_KEY",
  "MEDREPORT_LIVE_PASSCODE",
  "CLINFORMS_PUBLIC_DEMO",
  "CLINFORMS_DB",
  "BETTER_AUTH_URL",
  "VERCEL",
  "PORT",
]) {
  delete process.env[k];
}
process.env.APP_ORIGIN = "https://clinforms.test";

import { Kysely } from "kysely";
import { dbAudit, dbPartnerKeys, dbSharedState, getMedreportDeps } from "@/app/api/_medreport-glue";
import { CONTENT_TYPES, ConnectorsResponseSchema, HealthResponseSchema, ProblemSchema, SignResponseSchema } from "@/modules/medreport/api/contract";
import type { AuthContext, MedreportDeps } from "@/modules/medreport/api/deps";
import { handleAiPayloadPreview } from "@/modules/medreport/api/handlers/ai-payload-preview";
import { handleBundle } from "@/modules/medreport/api/handlers/bundle";
import { handleConnectorsList } from "@/modules/medreport/api/handlers/connectors-list";
import { handleDocuments } from "@/modules/medreport/api/handlers/documents";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { handleFileImportBundle } from "@/modules/medreport/api/handlers/file-import-bundle";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";
import { handleFormsConfirm } from "@/modules/medreport/api/handlers/forms-confirm";
import { handleFormsFillPreview } from "@/modules/medreport/api/handlers/forms-fill-preview";
import { handleFormSamples } from "@/modules/medreport/api/handlers/forms-samples";
import { handleHealth } from "@/modules/medreport/api/handlers/health";
import { handleLaunch } from "@/modules/medreport/api/handlers/launch";
import { handleLaunchVerify } from "@/modules/medreport/api/handlers/launch-verify";
import { handlePatients } from "@/modules/medreport/api/handlers/patients";
import { handleRender } from "@/modules/medreport/api/handlers/render";
import { handleSign } from "@/modules/medreport/api/handlers/sign";
import { handleTemplatesValidate } from "@/modules/medreport/api/handlers/templates-validate";
import { handleTemplatesList } from "@/modules/medreport/api/handlers/templates-list";
import { handleValidate } from "@/modules/medreport/api/handlers/validate";
import { HttpError, bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { chooseAiModeForActor, takeLiveCallsFor } from "@/modules/medreport/ai/live-gate";
import type { Actor } from "@/modules/medreport/auth/actor";
import { formMapSha256, withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { createLaunchToken } from "@/modules/medreport/auth/launch-token";
import { checkLivePasscodeShared } from "@/modules/medreport/auth/passcode";
import { verifyReceipt, verifyReceiptMac } from "@/modules/medreport/auth/sign-receipt";
import { resetMemoryLimits } from "@/modules/medreport/auth/shared-limits";
import { createConnectorRegistry } from "@/modules/medreport/connectors/registry";
import { createFileImportConnector } from "@/modules/medreport/connectors/file-import/connector";
import { createTm3SimConnector } from "@/modules/medreport/connectors/tm3-sim/connector";
import type { ClinicSystemConnector } from "@/modules/medreport/connectors/types";
import { SAMPLE_IMPORT_FILES } from "@/modules/medreport/connectors/file-import/samples";
import { DEMO_CLINIC } from "@/modules/medreport/config.public";
import { bundleClinic } from "@/modules/medreport/core/clinic";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { FORM_ATTESTATIONS, formTemplateId, resolveRegistrationValue } from "@/modules/medreport/core/forms";
import type { EpisodeBundle, FormDefinition, Report, SignReceipt } from "@/modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "@/modules/medreport/forms/samples/maps/harrow-pike";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { loadClinicProfile } from "@/server/auth/medreport-actor";
import { NodeSqliteDialect, openSqliteDatabase } from "@/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "@/server/db/migrations";
import type { Database } from "@/server/db/schema";
import { listAudit } from "@/server/repos/audit";
import { upsertClinicProfile } from "@/server/repos/clinic-profile";
import { createPartnerKey, revokePartnerKey } from "@/server/repos/partner-keys";
import { getDemoBundle } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";
import { demoBearer, demoSessionToken } from "./test-actors";

/* ------------------------------------------------------------------------------------------------
 * Fixtures: two clinics, their members, one database shared by two "instances"
 * ----------------------------------------------------------------------------------------------*/

const A = "clinic-a";
const B = "clinic-b";
const C = "clinic-c"; // no clinic profile

const MEMBERS: Record<string, AuthContext> = {
  "owner-a": { userId: "u_owner_a", authSessionId: "s_owner_a", tenantId: A, role: "owner", name: "Olivia Owner (fictional)", twoFactorVerified: true },
  "clin-a": {
    userId: "u_clin_a",
    authSessionId: "s_clin_a",
    tenantId: A,
    role: "clinician",
    name: "Sam Ward (fictional)",
    clinician: { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05", jobTitle: "Physiotherapist", canSign: true },
    twoFactorVerified: true,
  },
  "nosign-a": {
    userId: "u_nosign_a",
    authSessionId: "s_nosign_a",
    tenantId: A,
    role: "clinician",
    name: "Nia Lane (fictional)",
    clinician: { name: "Nia Lane (fictional)", hcpc: "PH-DEMO-06", canSign: false },
    twoFactorVerified: true,
  },
  "staff-a": { userId: "u_staff_a", authSessionId: "s_staff_a", tenantId: A, role: "staff", name: "Pat Desk (fictional)", twoFactorVerified: true },
  "no2fa-a": { userId: "u_no2fa_a", authSessionId: "s_no2fa_a", tenantId: A, role: "clinician", name: "New Starter (fictional)", twoFactorVerified: false },
  "clin-b": {
    userId: "u_clin_b",
    authSessionId: "s_clin_b",
    tenantId: B,
    role: "clinician",
    name: "Bea Long (fictional)",
    clinician: { name: "Bea Long (fictional)", hcpc: "PH-DEMO-07", canSign: true },
    twoFactorVerified: true,
  },
  "clin-c": {
    userId: "u_clin_c",
    authSessionId: "s_clin_c",
    tenantId: C,
    role: "clinician",
    name: "Cal Moss (fictional)",
    clinician: { name: "Cal Moss (fictional)", hcpc: "PH-DEMO-08", canSign: true },
    twoFactorVerified: true,
  },
};

/** Stub sign-in: the x-test-member header names a member; "noclinic" is signed in without a clinic. */
async function stubAuthenticate(req: Request): Promise<AuthContext | null> {
  const id = req.headers.get("x-test-member");
  if (!id) return null;
  if (id === "noclinic") throw new HttpError(403, "Choose a clinic", { code: "NO_CLINIC" });
  return MEMBERS[id] ?? null;
}

const attached: { tenantId: string; patientId: string; sha256: string }[] = [];

/** A connected clinic system for clinics (the real TM3 connector is not configured yet). */
function clinicPms(): ClinicSystemConnector {
  return {
    id: "tm3",
    label: "Clinic system (test)",
    simulated: false,
    status: "connected",
    capabilities: { patients: true, clinicalNotes: true, appointments: true, outcomeMeasures: true, writeBackDocuments: true },
    note: "test connector",
    async searchPatients() {
      return ["pms-p1", "pms-p2"].map((id) => ({
        connectorId: "tm3" as const,
        id,
        displayName: `Patient ${id} (fictional)`,
        simulated: false,
        registrationOnly: false,
        episodes: [{ id: `${id}-e1`, title: "Neck pain", status: "discharged" as const }],
      }));
    },
    async getEpisodeBundle(ctx, ref) {
      if ("upload" in ref) throw new Error("not an upload connector");
      const demo = getDemoBundle("megan-hart");
      return {
        ...demo,
        tenantId: ctx.tenantId,
        source: { ...demo.source, connectorId: "tm3", simulated: false, externalPatientId: ref.patientId, externalEpisodeId: ref.episodeId },
      };
    },
    async attachDocument(ctx, input) {
      attached.push({ tenantId: ctx.tenantId, patientId: input.patientId, sha256: input.sha256 });
      return { externalDocumentId: `doc-${attached.length}`, receivedAt: new Date().toISOString(), sha256: input.sha256 };
    },
  };
}

let tmpDir: string;
let db1: Kysely<Database>;
let db2: Kysely<Database>;
let one: MedreportDeps;
let two: MedreportDeps;

function instance(db: Kysely<Database>): MedreportDeps {
  return {
    connectors: createConnectorRegistry([createTm3SimConnector(), createFileImportConnector(), clinicPms()]),
    createConnectorContext: getMedreportDeps().createConnectorContext,
    authenticate: stubAuthenticate,
    clinicProfile: (tenantId) => loadClinicProfile(db, tenantId),
    sharedState: dbSharedState(() => db),
    audit: dbAudit(() => db),
    verifyPartnerKey: dbPartnerKeys(() => db),
  };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-actor-"));
  const file = path.join(tmpDir, "shared.db");
  const first = openSqliteDatabase(file);
  applySqliteMigrations(first);
  db1 = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: first }) });
  db2 = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: openSqliteDatabase(file) }) });
  one = instance(db1);
  two = instance(db2);
  await upsertClinicProfile({ db: db1 }, A, {
    organizationId: "org_a",
    displayName: "Abbey Physio (fictional)",
    address: ["1 Abbey Row (fictional)", "Testtown"],
    postcode: "ZZ1 1ZZ",
    phone: "01000 000001",
    email: "reports@abbey.example",
    draftingEnabled: true,
  });
  await upsertClinicProfile({ db: db1 }, B, { organizationId: "org_b", displayName: "Brook Clinic (fictional)", draftingEnabled: false });
});

after(async () => {
  await db1?.destroy();
  await db2?.destroy();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------------------------------
 * Request helpers
 * ----------------------------------------------------------------------------------------------*/

interface CallInit {
  method?: string;
  body?: unknown;
  /** x-test-member (a signed-in clinic member). */
  member?: string;
  /** Bearer session token. */
  bearer?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  deps?: MedreportDeps;
}

async function call(handler: MedreportHandler, url: string, init: CallInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined && !headers["content-type"]) headers["content-type"] = CONTENT_TYPES.json;
  if (init.member) headers["x-test-member"] = init.member;
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  const req = new Request(`http://localhost/api/reports/v1${url}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const deps = init.deps ?? one;
  return bindHandler(handler, () => deps)(req, { params: init.params ?? {} });
}

async function problemOf(res: Response) {
  return ProblemSchema.parse(await res.json());
}

async function expectProblem(res: Response, status: number, code: string, label = ""): Promise<void> {
  const text = await res.clone().text();
  assert.equal(res.status, status, `${label} ${text}`);
  assert.equal((await problemOf(res)).code, code, label);
}

const attest = (f: FormDefinition) => withAttestedConfirmation(f, "Practice manager", "2026-10-01T09:00:00.000Z");
const DEMO_FORM = attest(HARROW_PIKE_RAW);
const formOf = (tenantId: string) => attest({ ...HARROW_PIKE_RAW, tenantId });

/** The completed sample report, as clinic `tenantId`'s own (bundle and report relabelled). */
function reportOf(tenantId: string, opts: { connectorId?: "tm3" | "tm3-sim"; patientId?: string; episodeId?: string } = {}): Report {
  const r = completedSampleReport("megan-hart", DEMO_FORM, { id: `rpt_${tenantId}` });
  const episodeRef = {
    connectorId: opts.connectorId ?? r.episodeRef.connectorId,
    patientId: opts.patientId ?? r.episodeRef.patientId,
    episodeId: opts.episodeId ?? r.episodeRef.episodeId,
  };
  return { ...r, tenantId, episodeRef, bundleSnapshot: { ...r.bundleSnapshot, tenantId } };
}

const bundleOf = (tenantId: string): EpisodeBundle => ({ ...getDemoBundle("megan-hart"), tenantId });

const signBody = (report: Report, form: FormDefinition, signer = { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05" }, typed = signer.name) => ({
  report,
  signer,
  typedSignature: typed,
  statementAccepted: true,
  attestations: [...FORM_ATTESTATIONS],
  form,
});

async function harrowFileBase64(): Promise<string> {
  return Buffer.from(await getSampleForm("harrow-pike-treating-physio")!.loadFile()).toString("base64");
}

/* ------------------------------------------------------------------------------------------------
 * 1. No caller → 401 on every endpoint that touches patient data or drafting
 * ----------------------------------------------------------------------------------------------*/

describe("unauthenticated callers", () => {
  test("every protected endpoint answers 401 without a sign-in or a session", async () => {
    const report = reportOf("demo");
    const cases: [string, MedreportHandler, string, CallInit][] = [
      ["patients", handlePatients, "/connectors/tm3-sim/patients", { params: { id: "tm3-sim" } }],
      ["bundle", handleBundle, "/connectors/tm3-sim/patients/sim-pat-001/episodes/sim-ep-1001/bundle", { params: { id: "tm3-sim", pid: "sim-pat-001", eid: "sim-ep-1001" } }],
      ["file-import", handleFileImportBundle, "/connectors/file-import/bundle", { body: { format: "text", content: "x" } }],
      ["drafts", handleDrafts, "/drafts", { body: {} }],
      ["analyse", handleFormsAnalyse, "/forms/analyse", { body: {} }],
      ["confirm", handleFormsConfirm, "/forms/confirm", { body: {} }],
      ["validate", handleValidate, "/validate", { body: { report } }],
      ["sign", handleSign, "/sign", { body: {} }],
      ["render", handleRender, "/render?format=pdf", { body: { report } }],
      ["documents", handleDocuments, "/connectors/tm3-sim/documents", { body: {}, params: { id: "tm3-sim" } }],
      ["fill-preview", handleFormsFillPreview, "/forms/fill-preview", { body: {} }],
      ["payload-preview", handleAiPayloadPreview, "/ai/payload-preview", { body: {} }],
      ["templates/validate", handleTemplatesValidate, "/templates/validate", { body: { fileName: "t.docx", docxBase64: "UEs=" } }],
    ];
    for (const [label, handler, url, init] of cases) {
      const res = await call(handler, url, init);
      await expectProblem(res, 401, "UNAUTHORIZED", label);
      assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/, label);
    }
  });

  test("a forged or expired session is 401 TOKEN_INVALID / TOKEN_EXPIRED", async () => {
    await expectProblem(await call(handleValidate, "/validate", { body: {}, bearer: "v1.e30.AAAA" }), 401, "TOKEN_INVALID");
    const { createSessionToken } = await import("@/modules/medreport/auth/session-token");
    const old = createSessionToken({ tenantId: "demo", kind: "demo" }, { now: new Date(Date.now() - 2 * 3600_000) }).token;
    await expectProblem(await call(handleValidate, "/validate", { body: {}, bearer: old }), 401, "TOKEN_EXPIRED");
  });

  test("a clinic's launch session alone (no sign-in) is 401; a clinic launch token cannot be redeemed without its member", async () => {
    const { createSessionToken } = await import("@/modules/medreport/auth/session-token");
    const clinicSession = createSessionToken({ tenantId: A, kind: "launch", connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1" }).token;
    await expectProblem(await call(handleValidate, "/validate", { body: { report: reportOf(A) }, bearer: clinicSession }), 401, "UNAUTHORIZED");
    const lt = createLaunchToken({ tenantId: A, connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1", clinician: { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05" } });
    await expectProblem(await call(handleLaunchVerify, "/launch/verify", { body: { token: lt.token } }), 401, "UNAUTHORIZED");
  });

  test("public endpoints stay public; health reveals no internals to an anonymous caller", async () => {
    assert.equal((await call(handleConnectorsList, "/connectors")).status, 200);
    assert.equal((await call(handleTemplatesList, "/templates")).status, 200);
    assert.equal((await call(handleFormSamples, "/forms/samples")).status, 200);
    const anon = HealthResponseSchema.parse(await (await call(handleHealth, "/health")).json());
    assert.equal(anon.model, "drafting-service");
    assert.equal(anon.promptVersion, "");
    const demo = HealthResponseSchema.parse(await (await call(handleHealth, "/health", { bearer: demoSessionToken() })).json());
    assert.equal(demo.model, "drafting-service");
    assert.match(demo.promptVersion, /forms-/);
    const connectors = ConnectorsResponseSchema.parse(await (await call(handleConnectorsList, "/connectors")).json());
    assert.ok(connectors.connectors.some((c) => c.id === "tm3-sim"));
  });

  test("signed in without two-step verification → 403 TWO_FACTOR_REQUIRED; without a clinic → 403 NO_CLINIC (never the demo)", async () => {
    await expectProblem(await call(handleValidate, "/validate", { body: { report: reportOf(A) }, member: "no2fa-a" }), 403, "TWO_FACTOR_REQUIRED");
    await expectProblem(await call(handleValidate, "/validate", { body: { report: reportOf("demo") }, member: "noclinic", bearer: demoSessionToken() }), 403, "NO_CLINIC");
  });
});

/* ------------------------------------------------------------------------------------------------
 * 2. The public demo keeps working without a sign-in
 * ----------------------------------------------------------------------------------------------*/

describe("public demo", () => {
  test("a demo session reads the simulated TM3, uploads notes, drafts, validates, signs and renders – tenant demo, DEMO_CLINIC", async () => {
    const token = demoSessionToken();
    const patients = await call(handlePatients, "/connectors/tm3-sim/patients", { bearer: token, params: { id: "tm3-sim" } });
    assert.equal(patients.status, 200);
    const upload = await call(handleFileImportBundle, "/connectors/file-import/bundle", { bearer: token, body: { format: "json", content: SAMPLE_IMPORT_FILES.json.content } });
    assert.equal(upload.status, 200, await upload.clone().text());
    const { bundle } = (await upload.json()) as { bundle: EpisodeBundle };
    assert.equal(bundle.tenantId, "demo");
    assert.equal(bundle.clinic, undefined, "demo bundles are unchanged");
    assert.equal(bundleClinic(bundle)?.name, DEMO_CLINIC.name);

    const report = reportOf("demo");
    assert.equal((await call(handleValidate, "/validate", { bearer: token, body: { report, form: DEMO_FORM } })).status, 200);
    const signed = await call(handleSign, "/sign", { bearer: token, body: signBody(report, DEMO_FORM, { name: "Sarah Reid", hcpc: "PH-DEMO-01" }) });
    assert.equal(signed.status, 200, await signed.clone().text());
    const { receipt } = SignResponseSchema.parse(await signed.json());
    assert.equal(receipt.signer.name, "Sarah Reid", "the demo signs as the body's fictional clinician");
    assert.equal(receipt.approvedVia?.kind, "demo");
    const final = await call(handleRender, "/render?format=original", {
      bearer: token,
      body: { report: { ...report, status: "signed", receipt }, receipt, form: DEMO_FORM, fileBase64: await harrowFileBase64(), requireFinal: true },
    });
    assert.equal(final.status, 200, await final.clone().text());
    assert.equal(final.headers.get("x-medreport-render"), "final");
    assert.deepEqual(await listAudit({ db: db1 }, "demo"), [], "the public demo writes no audit rows");
  });

  test("the demo partner key launches for tenant demo at the configured origin (never the request's Host); replay refused", async () => {
    const res = await call(handleLaunch, "/launch", {
      headers: { "x-partner-key": "demo-only-partner-key-v1", host: "evil.example", "x-forwarded-host": "evil.example" },
      body: { connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
    });
    assert.equal(res.status, 201, await res.clone().text());
    const { launchUrl } = (await res.json()) as { launchUrl: string };
    assert.ok(launchUrl.startsWith("https://clinforms.test/reports/new?lt="), launchUrl);
    const lt = new URL(launchUrl).searchParams.get("lt") ?? "";
    const verified = await call(handleLaunchVerify, "/launch/verify", { body: { token: lt } });
    assert.equal(verified.status, 200);
    // The same link redeemed on the OTHER instance (same database): refused.
    await expectProblem(await call(handleLaunchVerify, "/launch/verify", { body: { token: lt }, deps: two }), 401, "TOKEN_INVALID");
  });

  test("CLINFORMS_PUBLIC_DEMO=0 switches the demo sessions and the demo partner key off", async () => {
    process.env.CLINFORMS_PUBLIC_DEMO = "0";
    try {
      await expectProblem(await call(handleValidate, "/validate", { body: { report: reportOf("demo") }, bearer: demoSessionToken() }), 403, "DEMO_DISABLED");
      const res = await call(handleLaunch, "/launch", {
        headers: { "x-partner-key": "demo-only-partner-key-v1" },
        body: { connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
      });
      await expectProblem(res, 401, "PARTNER_KEY_INVALID");
    } finally {
      delete process.env.CLINFORMS_PUBLIC_DEMO;
    }
  });

  test("a signed-in member's request is never the demo – except from the public demo's own pages", async () => {
    const demoReport = reportOf("demo");
    // From the clinic's Studio: the member acts for their clinic, so the demo report is another clinic's.
    await expectProblem(
      await call(handleValidate, "/validate", { member: "clin-a", bearer: demoSessionToken(), headers: { referer: "http://localhost/app/reports/x" }, body: { report: demoReport, form: DEMO_FORM } }),
      403,
      "TENANT_MISMATCH",
    );
    // From /reports (the public demo) with a demo session: the demo, whatever the browser's sign-in.
    const fromDemo = await call(handleValidate, "/validate", {
      member: "clin-a",
      bearer: demoSessionToken(),
      headers: { referer: "http://localhost/reports/new" },
      body: { report: demoReport, form: DEMO_FORM },
    });
    assert.equal(fromDemo.status, 200, await fromDemo.clone().text());
    // A Referer from another site does not count.
    await expectProblem(
      await call(handleValidate, "/validate", { member: "clin-a", bearer: demoSessionToken(), headers: { referer: "https://evil.example/reports/new" }, body: { report: demoReport, form: DEMO_FORM } }),
      403,
      "TENANT_MISMATCH",
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * 3. Clinics: tenant checks, connectors, clinic profile
 * ----------------------------------------------------------------------------------------------*/

describe("clinic members – tenancy", () => {
  test("another clinic's report, bundle or form → 403 TENANT_MISMATCH on every endpoint", async () => {
    const reportB = reportOf(B);
    const formB = formOf(B);
    const fileBase64 = await harrowFileBase64();
    const cases: [string, MedreportHandler, string, unknown][] = [
      ["validate", handleValidate, "/validate", { report: reportB, form: formB }],
      ["sign", handleSign, "/sign", signBody(reportB, formB)],
      ["render", handleRender, "/render?format=original", { report: reportB, form: formB, fileBase64 }],
      ["fill-preview", handleFormsFillPreview, "/forms/fill-preview", { report: reportB, form: formB, fileBase64, mode: "draft" }],
      ["payload-preview", handleAiPayloadPreview, "/ai/payload-preview", { templateId: formTemplateId(formB.id), bundle: bundleOf(B), instructingParty: bundleOf(B).referral, form: formB }],
      ["drafts", handleDrafts, "/drafts", { templateId: formTemplateId(formB.id), bundle: bundleOf(B), instructingParty: bundleOf(B).referral, sectionKeys: ["F-07"], form: formB, prefer: "demo" }],
      ["confirm", handleFormsConfirm, "/forms/confirm", { form: formB, confirmedBy: "Someone" }],
    ];
    for (const [label, handler, url, body] of cases) {
      await expectProblem(await call(handler, url, { member: "clin-a", body }), 403, "TENANT_MISMATCH", label);
    }
    // The demo's data is another clinic's too.
    await expectProblem(await call(handleValidate, "/validate", { member: "clin-a", body: { report: reportOf("demo"), form: DEMO_FORM } }), 403, "TENANT_MISMATCH");
  });

  test("a form map attested for clinic B is refused to clinic A, and relabelling it breaks its attestation", async () => {
    const reportA = reportOf(A);
    const formB = formOf(B);
    // B's map with A's report: refused as another clinic's form.
    await expectProblem(await call(handleSign, "/sign", { member: "clin-a", body: signBody(reportA, formB) }), 403, "TENANT_MISMATCH");
    // B's map relabelled as A's: the attestation MAC covers the tenant → not confirmed.
    const relabelled = { ...formB, tenantId: A };
    assert.equal(formMapSha256(relabelled), formMapSha256(formB), "same fields: only the tenant differs");
    await expectProblem(await call(handleSign, "/sign", { member: "clin-a", body: signBody(reportA, relabelled) }), 409, "FORM_NOT_CONFIRMED");
    await expectProblem(
      await call(handleDrafts, "/drafts", {
        member: "clin-a",
        body: { templateId: formTemplateId(relabelled.id), bundle: bundleOf(A), instructingParty: bundleOf(A).referral, sectionKeys: ["F-07"], form: relabelled, prefer: "demo" },
      }),
      409,
      "FORM_NOT_CONFIRMED",
    );
  });

  test("an approval receipt issued to clinic B never makes a FINAL copy or a file-back for clinic A", async () => {
    const formB = formOf(B);
    const reportB = reportOf(B, { connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1" });
    const signedB = await call(handleSign, "/sign", { member: "clin-b", body: signBody(reportB, formB, { name: "Bea Long (fictional)", hcpc: "PH-DEMO-07" }) });
    assert.equal(signedB.status, 200, await signedB.clone().text());
    const { receipt } = SignResponseSchema.parse(await signedB.json());
    assert.equal(receipt.tenantId, B);
    // Module level: the receipt verifies for B only.
    assert.equal((await verifyReceipt(receipt, { ...reportB, status: "signed", receipt }, { tenantId: B })).ok, true);
    assert.deepEqual(await verifyReceipt(receipt, { ...reportB, status: "signed", receipt }, { tenantId: A }), { ok: false, reason: "TENANT_MISMATCH" });
    assert.equal(verifyReceiptMac(receipt, { tenantId: B }), true);
    assert.equal(verifyReceiptMac(receipt, { tenantId: A }), false);
    // Relabelled as A's report and receipt: the MAC no longer verifies.
    const forged: SignReceipt = { ...receipt, tenantId: A };
    const reportA = reportOf(A, { connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1" });
    const formA = formOf(A);
    await expectProblem(
      await call(handleRender, "/render?format=original", { member: "clin-a", body: { report: reportA, receipt: forged, form: formA, fileBase64: await harrowFileBase64(), requireFinal: true } }),
      409,
      "RECEIPT_INVALID",
    );
    // B's receipt as it is, with A's report: another clinic's approval.
    await expectProblem(
      await call(handleRender, "/render?format=original", { member: "clin-a", body: { report: reportA, receipt, form: formA, fileBase64: await harrowFileBase64(), requireFinal: true } }),
      403,
      "TENANT_MISMATCH",
    );
    // File-back by A with B's receipt.
    const bytes = Buffer.from("%PDF-1.4 test");
    const { createHash } = await import("node:crypto");
    await expectProblem(
      await call(handleDocuments, "/connectors/tm3/documents", {
        member: "clin-a",
        params: { id: "tm3" },
        body: {
          patientId: "pms-p1",
          episodeId: "pms-p1-e1",
          title: "Report",
          fileName: "report.pdf",
          mimeType: CONTENT_TYPES.pdf,
          contentBase64: bytes.toString("base64"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          signReceipt: receipt,
          fileToken: "x".repeat(43),
        },
      }),
      422,
      "RECEIPT_INVALID",
    );
  });

  test("the simulated TM3 sandbox is the demo's only: a clinic gets 403 CONNECTOR_NOT_AVAILABLE", async () => {
    await expectProblem(await call(handlePatients, "/connectors/tm3-sim/patients", { member: "clin-a", params: { id: "tm3-sim" } }), 403, "CONNECTOR_NOT_AVAILABLE");
    await expectProblem(
      await call(handleBundle, "/x", { member: "clin-a", params: { id: "tm3-sim", pid: "sim-pat-001", eid: "sim-ep-1001" } }),
      403,
      "CONNECTOR_NOT_AVAILABLE",
    );
  });

  test("file import: the bundle is the member's clinic's and names the clinic from its profile (never the demo clinic)", async () => {
    const res = await call(handleFileImportBundle, "/connectors/file-import/bundle", { member: "staff-a", body: { format: "json", content: SAMPLE_IMPORT_FILES.json.content } });
    assert.equal(res.status, 200, await res.clone().text());
    const { bundle } = (await res.json()) as { bundle: EpisodeBundle };
    assert.equal(bundle.tenantId, A);
    assert.deepEqual(bundle.clinic, {
      name: "Abbey Physio (fictional)",
      addressLines: ["1 Abbey Row (fictional)", "Testtown", "ZZ1 1ZZ"],
      phone: "01000 000001",
      email: "reports@abbey.example",
    });
    const ctx = { bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle), reportDate: "2026-10-09T10:00:00.000Z" };
    assert.equal(resolveRegistrationValue("clinic.name", ctx as never)?.text, "Abbey Physio (fictional)");
    assert.equal(resolveRegistrationValue("clinic.address", ctx as never)?.text, "1 Abbey Row (fictional), Testtown, ZZ1 1ZZ");
    // A clinic without a profile: no clinic named at all – never the fictional demo clinic.
    const noProfile = await call(handleFileImportBundle, "/connectors/file-import/bundle", { member: "clin-c", body: { format: "json", content: SAMPLE_IMPORT_FILES.json.content } });
    const plain = ((await noProfile.json()) as { bundle: EpisodeBundle }).bundle;
    assert.equal(plain.tenantId, C);
    assert.equal(bundleClinic(plain), null);
    const plainCtx = { bundle: plain, instructingParty: plain.referral, computedFacts: computeFacts(plain), reportDate: "2026-10-09T10:00:00.000Z" };
    assert.equal(resolveRegistrationValue("clinic.name", plainCtx as never), null);
  });

  test("form analysis stamps the member's clinic on the proposed map", async () => {
    const fileBase64 = await harrowFileBase64();
    const res = await call(handleFormsAnalyse, "/forms/analyse", { member: "staff-a", body: { fileBase64, fileName: "harrow.docx", prefer: "demo" } });
    assert.equal(res.status, 200, await res.clone().text());
    const { form } = (await res.json()) as { form: FormDefinition };
    assert.equal(form.tenantId, A);
    const demo = await call(handleFormsAnalyse, "/forms/analyse", { bearer: demoSessionToken(), body: { fileBase64, fileName: "harrow.docx", prefer: "demo" } });
    assert.equal(((await demo.json()) as { form: FormDefinition }).form.tenantId, "demo");
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4. Roles and the signer
 * ----------------------------------------------------------------------------------------------*/

describe("clinic members – roles and approval", () => {
  test("confirming a form map: owner / admin / clinician; staff → 403 ROLE_NOT_ALLOWED; the member's own name is recorded", async () => {
    const proposed: FormDefinition = { ...HARROW_PIKE_RAW, tenantId: A, status: "proposed", confirmed: undefined };
    await expectProblem(await call(handleFormsConfirm, "/forms/confirm", { member: "staff-a", body: { form: proposed, confirmedBy: "Pat Desk" } }), 403, "ROLE_NOT_ALLOWED");
    const res = await call(handleFormsConfirm, "/forms/confirm", { member: "owner-a", body: { form: proposed, confirmedBy: "Somebody Else" } });
    assert.equal(res.status, 200, await res.clone().text());
    const { form } = (await res.json()) as { form: FormDefinition };
    assert.equal(form.confirmed?.by, "Olivia Owner (fictional)", "the sign-in, not the body, says who confirmed");
    const rows = await listAudit({ db: db1 }, A);
    const row = rows.find((r) => r.action === "form.confirm" && r.targetId === form.id);
    assert.ok(row, "audit row written");
    assert.equal(row.userId, "u_owner_a");
    assert.equal(row.sessionId, "s_owner_a");
  });

  test("staff prepare drafts but never approve; a clinician without 'may sign' cannot approve", async () => {
    const report = reportOf(A);
    const form = formOf(A);
    const draft = await call(handleDrafts, "/drafts", {
      member: "staff-a",
      body: { templateId: formTemplateId(form.id), bundle: bundleOf(A), instructingParty: bundleOf(A).referral, sectionKeys: ["F-07"], form, prefer: "demo" },
    });
    // Staff may draft (here the fictional record has prepared demo answers; no role refusal).
    assert.equal(draft.status, 200, await draft.clone().text());
    await expectProblem(await call(handleSign, "/sign", { member: "staff-a", body: signBody(report, form, { name: "Pat Desk (fictional)", hcpc: "X" }) }), 403, "SIGNER_NOT_ALLOWED");
    await expectProblem(await call(handleSign, "/sign", { member: "nosign-a", body: signBody(report, form, { name: "Nia Lane (fictional)", hcpc: "PH-DEMO-06" }) }), 403, "SIGNER_NOT_ALLOWED");
    await expectProblem(await call(handleSign, "/sign", { member: "owner-a", body: signBody(report, form, { name: "Olivia Owner (fictional)", hcpc: "X" }) }), 403, "SIGNER_NOT_ALLOWED");
  });

  test("the signer is the signed-in clinician (name, HCPC, job title from the member profile), never the body", async () => {
    const report = reportOf(A);
    const form = formOf(A);
    // Another clinician's HCPC in the body: approve as yourself.
    await expectProblem(
      await call(handleSign, "/sign", { member: "clin-a", body: signBody(report, form, { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, "Sarah Reid") }),
      403,
      "SIGNER_MISMATCH",
    );
    // The typed signature must be the member's own name.
    const wrongName = await call(handleSign, "/sign", { member: "clin-a", body: signBody(report, form, { name: "Sam W", hcpc: "PH-DEMO-05" }, "Sam W") });
    await expectProblem(wrongName, 422, "VALIDATION_FAILED");
    // Same HCPC, any name in the body: the receipt names the member.
    const res = await call(handleSign, "/sign", { member: "clin-a", body: signBody(report, form, { name: "S. Ward", hcpc: "ph-demo-05" }, "Sam Ward (fictional)") });
    assert.equal(res.status, 200, await res.clone().text());
    const { receipt } = SignResponseSchema.parse(await res.json());
    assert.deepEqual(receipt.signer, { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05", role: "Physiotherapist" });
    assert.deepEqual(receipt.approvedVia, { kind: "user", sid: "s_clin_a", userId: "u_clin_a" });
    assert.equal(receipt.tenantId, A);
    const row = (await listAudit({ db: db1 }, A)).find((r) => r.action === "report.sign" && r.targetId === report.id);
    assert.ok(row);
    assert.equal(row.detail?.receiptMac, receipt.mac.slice(0, 12));
    const detail = JSON.stringify(row.detail);
    for (const pii of ["Megan", "Hart", "Sam Ward"]) assert.ok(!detail.includes(pii), `no names in the audit row (${pii})`);

    // The FINAL copy for the clinic, with its audit row.
    const final = await call(handleRender, "/render?format=original", {
      member: "staff-a",
      body: { report: { ...report, status: "signed", receipt }, receipt, form, fileBase64: await harrowFileBase64(), requireFinal: true },
    });
    assert.equal(final.status, 200, await final.clone().text());
    assert.equal(final.headers.get("x-medreport-render"), "final");
    assert.ok((await listAudit({ db: db1 }, A)).some((r) => r.action === "report.render_final" && r.targetId === report.id));
  });

  test("launch from the clinic's own system: clinic partner key → the clinic's Studio; only its member redeems it; scope and launch clinician enforced", async () => {
    const key = await createPartnerKey({ db: db1 }, A, { name: "Clinic system", createdBy: "u_owner_a" });
    const launch = await call(handleLaunch, "/launch", {
      headers: { "x-partner-key": key.key },
      body: { connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1", clinician: { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05" } },
    });
    assert.equal(launch.status, 201, await launch.clone().text());
    const { launchUrl } = (await launch.json()) as { launchUrl: string };
    assert.ok(launchUrl.startsWith("https://clinforms.test/app/studio/new?lt="), launchUrl);
    const lt = new URL(launchUrl).searchParams.get("lt") ?? "";
    // Not on the simulated sandbox.
    await expectProblem(
      await call(handleLaunch, "/launch", {
        headers: { "x-partner-key": key.key },
        body: { connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05" } },
      }),
      403,
      "CONNECTOR_NOT_AVAILABLE",
    );
    // Another clinic's member cannot redeem it (and it is not used up by trying).
    await expectProblem(await call(handleLaunchVerify, "/launch/verify", { member: "clin-b", body: { token: lt } }), 403, "TENANT_MISMATCH");
    const verified = await call(handleLaunchVerify, "/launch/verify", { member: "clin-a", body: { token: lt }, deps: two });
    assert.equal(verified.status, 200, await verified.clone().text());
    const session = ((await verified.json()) as { session: { token: string } }).session.token;
    await expectProblem(await call(handleLaunchVerify, "/launch/verify", { member: "clin-a", body: { token: lt } }), 401, "TOKEN_INVALID");

    // user+launch: narrowed to the launched episode.
    const own = await call(handleBundle, "/x", { member: "clin-a", bearer: session, params: { id: "tm3", pid: "pms-p1", eid: "pms-p1-e1" } });
    assert.equal(own.status, 200, await own.clone().text());
    assert.equal(((await own.json()) as { bundle: EpisodeBundle }).bundle.tenantId, A);
    await expectProblem(await call(handleBundle, "/x", { member: "clin-a", bearer: session, params: { id: "tm3", pid: "pms-p2", eid: "pms-p2-e1" } }), 403, "SESSION_MISMATCH");
    const list = await call(handlePatients, "/x", { member: "clin-a", bearer: session, params: { id: "tm3" } });
    assert.deepEqual(((await list.json()) as { patients: { id: string }[] }).patients.map((p) => p.id), ["pms-p1"]);
    // Without the launch session the member sees the clinic's whole list.
    const all = await call(handlePatients, "/x", { member: "clin-a", params: { id: "tm3" } });
    assert.equal(((await all.json()) as { patients: unknown[] }).patients.length, 2);

    // Approval through the launch: approvedVia records both sessions; the launch named this clinician.
    const report = reportOf(A, { connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1" });
    const form = formOf(A);
    const signed = await call(handleSign, "/sign", { member: "clin-a", bearer: session, body: signBody(report, form) });
    assert.equal(signed.status, 200, await signed.clone().text());
    const { receipt } = SignResponseSchema.parse(await signed.json());
    assert.equal(receipt.approvedVia?.kind, "user");
    assert.ok(receipt.approvedVia?.launchSid);
    // Another patient's report through this launch: refused.
    const other = reportOf(A, { connectorId: "tm3", patientId: "pms-p2", episodeId: "pms-p2-e1" });
    await expectProblem(await call(handleSign, "/sign", { member: "clin-a", bearer: session, body: signBody(other, form) }), 403, "SESSION_MISMATCH");

    // File-back of the FINAL copy to the clinic's system, audited.
    const final = await call(handleRender, "/render?format=original", {
      member: "clin-a",
      bearer: session,
      body: { report: { ...report, status: "signed", receipt }, receipt, form, fileBase64: await harrowFileBase64(), requireFinal: true },
    });
    assert.equal(final.status, 200, await final.clone().text());
    const bytes = Buffer.from(await final.arrayBuffer());
    const { createHash } = await import("node:crypto");
    const filed = await call(handleDocuments, "/x", {
      member: "clin-a",
      bearer: session,
      params: { id: "tm3" },
      body: {
        patientId: "pms-p1",
        episodeId: "pms-p1-e1",
        title: "Completed form",
        fileName: "form.docx",
        mimeType: CONTENT_TYPES.docx,
        contentBase64: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        signReceipt: receipt,
        fileToken: final.headers.get("x-medreport-file-token"),
      },
    });
    assert.equal(filed.status, 201, await filed.clone().text());
    assert.equal(attached.at(-1)?.tenantId, A);
    const actions = (await listAudit({ db: db2 }, A)).map((r) => r.action);
    for (const a of ["launch.issue", "report.sign", "report.render_final", "report.file_back"]) assert.ok(actions.includes(a), a);

    // A revoked key no longer launches.
    await revokePartnerKey({ db: db1 }, A, key.id);
    await expectProblem(
      await call(handleLaunch, "/launch", {
        headers: { "x-partner-key": key.key },
        body: { connectorId: "tm3", patientId: "pms-p1", episodeId: "pms-p1-e1", clinician: { name: "Sam Ward (fictional)", hcpc: "PH-DEMO-05" } },
      }),
      401,
      "PARTNER_KEY_INVALID",
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * 5. Request hardening: CSRF and content type
 * ----------------------------------------------------------------------------------------------*/

describe("request hardening", () => {
  test("a state-changing request from another site is refused (403 ORIGIN_NOT_ALLOWED); same-origin and server-to-server pass", async () => {
    const body = { report: reportOf("demo"), form: DEMO_FORM };
    await expectProblem(
      await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { origin: "https://evil.example" } }),
      403,
      "ORIGIN_NOT_ALLOWED",
    );
    await expectProblem(
      await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { "sec-fetch-site": "cross-site" } }),
      403,
      "ORIGIN_NOT_ALLOWED",
    );
    await expectProblem(await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { origin: "null" } }), 403, "ORIGIN_NOT_ALLOWED");
    assert.equal((await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { origin: "http://localhost" } })).status, 200);
    assert.equal((await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { origin: "https://clinforms.test" } })).status, 200, "APP_ORIGIN");
    assert.equal((await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { "sec-fetch-site": "same-origin" } })).status, 200);
    assert.equal((await call(handleValidate, "/validate", { bearer: demoSessionToken(), body })).status, 200, "no Origin: server-to-server");
    // GETs are not state-changing.
    assert.equal((await call(handleConnectorsList, "/connectors", { headers: { origin: "https://evil.example" } })).status, 200);
  });

  test("a JSON body must be sent as JSON (415 UNSUPPORTED_MEDIA_TYPE otherwise)", async () => {
    const body = { report: reportOf("demo"), form: DEMO_FORM };
    await expectProblem(
      await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { "content-type": "text/plain" } }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    await expectProblem(
      await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { "content-type": "application/x-www-form-urlencoded" } }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    assert.equal((await call(handleValidate, "/validate", { bearer: demoSessionToken(), body, headers: { "content-type": "application/json; charset=utf-8" } })).status, 200);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 6. Drafting gate and shared limits (two instances, one database)
 * ----------------------------------------------------------------------------------------------*/

describe("drafting gate and shared limits", () => {
  const actorA: Actor = { tenantId: A, userId: "u_clin_a", sid: "s_clin_a", via: "user", role: "clinician" };
  const actorB: Actor = { tenantId: B, userId: "u_clin_b", sid: "s_clin_b", via: "user", role: "clinician" };
  const demoActor: Actor = { tenantId: "demo", sid: "ses_demo", via: "demo", role: "clinician" };
  const wording = { action: "draft live", alternative: "use the demo answers", rateTitle: "Too many live drafts" };
  const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/reports/v1/drafts", { method: "POST", headers });

  /** Live-capable deployment for clinics (an API key, no passcode – no call is made in these tests). */
  function withLiveDeployment<T>(fn: () => Promise<T>, env: Record<string, string> = {}): Promise<T> {
    const saved: Record<string, string | undefined> = {};
    const set = { MEDREPORT_AI_MODE: "auto", ANTHROPIC_API_KEY: "test-key-never-called", ...env };
    for (const [k, v] of Object.entries(set)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    return fn().finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
  }

  test("a clinic drafts live without a passcode; drafting switched off → demo for 'auto', 403 DRAFTING_DISABLED for 'live'", async () => {
    await withLiveDeployment(async () => {
      const a = await chooseAiModeForActor(req(), actorA, one, "auto", wording);
      assert.deepEqual(a, { ok: true, mode: "live" });
      const bAuto = await chooseAiModeForActor(req(), actorB, one, "auto", wording);
      assert.deepEqual(bAuto, { ok: true, mode: "demo" });
      const bLive = await chooseAiModeForActor(req(), actorB, one, "live", wording);
      assert.equal(bLive.ok, false);
      if (!bLive.ok) await expectProblem(bLive.response, 403, "DRAFTING_DISABLED");
      // The public demo still needs its passcode (none configured → demo for "auto").
      assert.deepEqual(await chooseAiModeForActor(req(), demoActor, one, "auto", wording), { ok: true, mode: "demo" });
    }, { CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE: "100", CLINFORMS_TENANT_LIVE_CALLS_PER_DAY: "1000" });
    // Through the endpoint: drafting off for clinic B → 403 even in a live-capable deployment.
    await withLiveDeployment(async () => {
      const res = await call(handleDrafts, "/drafts", {
        member: "clin-b",
        body: { templateId: formTemplateId(formOf(B).id), bundle: bundleOf(B), instructingParty: bundleOf(B).referral, sectionKeys: ["F-07"], form: formOf(B), prefer: "live" },
      });
      await expectProblem(res, 403, "DRAFTING_DISABLED");
    });
  });

  test("a clinic's per-minute limit is shared by every instance (429 + Retry-After), and other clinics are not affected", async () => {
    resetMemoryLimits();
    await withLiveDeployment(
      async () => {
        assert.equal((await takeLiveCallsFor({ ...actorA, tenantId: "clinic-limit" }, one, 2)).ok, true);
        assert.equal((await takeLiveCallsFor({ ...actorA, tenantId: "clinic-limit" }, two, 1)).ok, true);
        const refused = await chooseAiModeForActor(req(), { ...actorA, tenantId: "clinic-limit" }, one, "live", wording);
        assert.equal(refused.ok, false);
        if (!refused.ok) {
          assert.equal(refused.response.status, 429);
          assert.ok(Number(refused.response.headers.get("retry-after")) >= 1);
          const p = await problemOf(refused.response);
          assert.equal(p.code, "RATE_LIMITED");
          assert.equal(p.retryable, true);
        }
        // The second instance sees the same count.
        assert.equal((await takeLiveCallsFor({ ...actorA, tenantId: "clinic-limit" }, two, 1)).ok, false);
        // Another clinic has its own allowance.
        assert.equal((await takeLiveCallsFor({ ...actorA, tenantId: "clinic-other" }, two, 3)).ok, true);
      },
      { CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE: "3", CLINFORMS_TENANT_LIVE_CALLS_PER_DAY: "1000" },
    );
  });

  test("a clinic's daily cap is shared too (429, not retryable this minute)", async () => {
    await withLiveDeployment(
      async () => {
        const t = { ...actorA, tenantId: "clinic-daily" };
        assert.equal((await takeLiveCallsFor(t, one, 2)).ok, true);
        const refused = await chooseAiModeForActor(req(), t, two, "live", wording);
        assert.equal(refused.ok, false);
        if (!refused.ok) {
          const p = await problemOf(refused.response);
          assert.equal(p.code, "RATE_LIMITED");
          assert.equal(p.retryable, false);
          assert.match(p.detail ?? "", /today/);
        }
      },
      { CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE: "50", CLINFORMS_TENANT_LIVE_CALLS_PER_DAY: "2" },
    );
  });

  test("the public demo's live cap and passcode guesses are shared by every instance", async () => {
    await withLiveDeployment(
      async () => {
        // Six live calls a minute for the whole deployment, whichever instance takes them.
        for (let i = 0; i < 6; i++) assert.equal((await takeLiveCallsFor(demoActor, i % 2 ? one : two, 1)).ok, true, `call ${i + 1}`);
        assert.equal((await takeLiveCallsFor(demoActor, one, 1)).ok, false);
        assert.equal((await takeLiveCallsFor(demoActor, two, 1)).ok, false);
        // Wrong passcodes: 5 per client across instances, then locked on both.
        const guess = (deps: MedreportDeps, code: string) => checkLivePasscodeShared(req({ "x-medreport-passcode": code, "x-forwarded-for": "203.0.113.9" }), deps);
        for (let i = 0; i < 5; i++) assert.equal((await guess(i % 2 ? one : two, "wrong-passcode")).ok, false);
        const locked1 = await guess(one, "the-right-demo-passcode");
        const locked2 = await guess(two, "the-right-demo-passcode");
        assert.equal(locked1.ok === false && locked1.reason, "locked");
        assert.equal(locked2.ok === false && locked2.reason, "locked");
        // Another client is not locked out by them.
        const other = await checkLivePasscodeShared(req({ "x-medreport-passcode": "the-right-demo-passcode", "x-forwarded-for": "198.51.100.4" }), two);
        assert.deepEqual(other, { ok: true });
        // Counter keys never hold the IP address itself.
        const keys = (await db1.selectFrom("rate_limits").select("key").execute()).map((r) => r.key).join(" ");
        assert.ok(!keys.includes("203.0.113.9"));
      },
      {
        MEDREPORT_LIVE_PASSCODE: "the-right-demo-passcode",
        // A live deployment configures every secret (no public demo constants in live mode).
        MEDREPORT_LAUNCH_SECRET: "test-launch-secret-".padEnd(40, "l"),
        MEDREPORT_SIGNING_SECRET: "test-signing-secret-".padEnd(40, "s"),
      },
    );
  });
});
