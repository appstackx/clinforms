/**
 * Integration slice tests: computed facts and data checks on the two demo cases, and the Report API
 * integration endpoints end to end through the app glue (route() + connector registry) with the
 * simulated TM3 API served in-process. Run with `npm run test:medreport`.
 *
 * Owner: integration agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Demo mode: fixed demo secrets, no live AI. Set before any handler reads config (read at call time).
process.env.MEDREPORT_AI_MODE = "demo";
for (const k of ["MEDREPORT_LAUNCH_SECRET", "MEDREPORT_SIGNING_SECRET", "MEDREPORT_PARTNER_KEY", "TM3_SIM_TOKEN", "TM3_SIM_BASE_URL"]) {
  delete process.env[k];
}

import { getDemoBundle } from "./dev-bundles";
import { route } from "@/app/api/_medreport-glue";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { runDataChecks } from "@/modules/medreport/core/validation/data-checks";
import { createReport } from "@/modules/medreport/core/report-factory";
import { createFileToken } from "@/modules/medreport/auth/attestations";
import { createReceipt } from "@/modules/medreport/auth/sign-receipt";
import { SOLICITOR_RTA_TEMPLATE } from "@/modules/medreport/templates/registry";
import { SAMPLE_IMPORT_FILES } from "@/modules/medreport/connectors/file-import/samples";
import { handleLaunch } from "@/modules/medreport/api/handlers/launch";
import { handleLaunchVerify } from "@/modules/medreport/api/handlers/launch-verify";
import { handleSessionsDemo } from "@/modules/medreport/api/handlers/sessions-demo";
import { handleConnectorsList } from "@/modules/medreport/api/handlers/connectors-list";
import { handlePatients } from "@/modules/medreport/api/handlers/patients";
import { handleBundle } from "@/modules/medreport/api/handlers/bundle";
import { handleFileImportBundle } from "@/modules/medreport/api/handlers/file-import-bundle";
import { handleDocuments } from "@/modules/medreport/api/handlers/documents";
import {
  BundleResponseSchema,
  ConnectorsResponseSchema,
  DemoSessionResponseSchema,
  DocumentsResponseSchema,
  LaunchResponseSchema,
  LaunchVerifyResponseSchema,
  PatientsResponseSchema,
  ProblemSchema,
} from "@/modules/medreport/api/contract";

const ORIGIN = "http://127.0.0.1:9"; // closed port: HTTP to the simulated API fails, the glue falls back in-process
const PARTNER_KEY = "demo-only-partner-key-v1";

const launch = route(handleLaunch);
const launchVerify = route(handleLaunchVerify);
const sessionsDemo = route(handleSessionsDemo);
const connectorsList = route(handleConnectorsList);
const patients = route(handlePatients);
const bundleRoute = route(handleBundle);
const fileImport = route(handleFileImportBundle);
const documents = route(handleDocuments);

function req(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function problemOf(res: Response) {
  assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
  return ProblemSchema.parse(await res.json());
}

async function launchSessionFor(patientId: string, episodeId: string): Promise<string> {
  const l = await launch(
    req("/api/reports/v1/launch", {
      body: { connectorId: "tm3-sim", patientId, episodeId, clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
      headers: { "x-partner-key": PARTNER_KEY },
    }),
    { params: {} },
  );
  assert.equal(l.status, 201);
  const { launchUrl } = LaunchResponseSchema.parse(await l.json());
  const lt = new URL(launchUrl).searchParams.get("lt") ?? "";
  const v = await launchVerify(req("/api/reports/v1/launch/verify", { body: { token: lt } }), { params: {} });
  assert.equal(v.status, 200);
  return LaunchVerifyResponseSchema.parse(await v.json()).session.token;
}

async function demoSession(connectorId?: string): Promise<string> {
  const res = await sessionsDemo(
    req("/api/reports/v1/sessions/demo", { body: { purpose: "picker", ...(connectorId ? { connectorId } : {}) } }),
    { params: {} },
  );
  assert.equal(res.status, 201);
  return DemoSessionResponseSchema.parse(await res.json()).session.token;
}

/* ------------------------------------------------------------------------------------------------
 * Computed facts and data checks on the demo cases
 * ----------------------------------------------------------------------------------------------*/

test("case A (Megan Hart): facts", () => {
  const facts = computeFacts(getDemoBundle("megan-hart"), { asOf: "2026-10-06" });
  const byId = new Map(facts.map((f) => [f.id, f]));
  assert.deepEqual(facts.map((f) => f.id), ["FACT-attendance", "FACT-age", "FACT-episode", "FACT-outcomes-NDI", "FACT-outcomes-NPRS"]);
  assert.equal(byId.get("FACT-attendance")?.value, "10 of 11 appointments attended (1 DNA)");
  assert.match(byId.get("FACT-attendance")?.detail ?? "", /15\/04\/2026 \(A-005, no reason recorded\)/);
  assert.equal(byId.get("FACT-age")?.value, "34 years");
  assert.doesNotMatch(byId.get("FACT-age")?.detail ?? "", /22\/11\/1991|1991/, "the date of birth never appears in a fact");
  assert.equal(byId.get("FACT-episode")?.value, "18/03/2026 to 07/07/2026 (discharged)");
  assert.match(byId.get("FACT-episode")?.detail ?? "", /Discharge note: 07\/07\/2026 \(N-010\)/);
  assert.match(byId.get("FACT-episode")?.detail ?? "", /10 clinical notes by 2 clinicians/);
  assert.equal(byId.get("FACT-outcomes-NDI")?.value, "NDI 42% → 24% → 12% (lower is better)");
  assert.match(byId.get("FACT-outcomes-NDI")?.detail ?? "", /18\/03\/2026: 42% \(N-001\); 06\/05\/2026: 24% \(N-006\); 07\/07\/2026: 12% \(N-010\)/);
  assert.match(byId.get("FACT-outcomes-NDI")?.detail ?? "", /30 points lower .* an improvement/);
  assert.equal(byId.get("FACT-outcomes-NPRS")?.value, "NPRS 7/10 → 4/10 → 2/10 (lower is better)");
  // No name, address or contact details in any fact (facts go to the AI).
  const text = JSON.stringify(facts);
  for (const pii of ["Megan", "Hart", "Willow Bank", "07700", "example.com"]) assert.ok(!text.includes(pii), pii);
});

test("case A (Megan Hart): data checks raise DNA-without-reason and no-pre-incident-history", () => {
  const checks = runDataChecks(getDemoBundle("megan-hart"));
  const codes = checks.map((c) => c.code);
  assert.deepEqual(codes, ["NO_PRE_INCIDENT_HISTORY", "DNA_WITHOUT_REASON", "MULTIPLE_CLINICIANS"]);
  const dna = checks.find((c) => c.code === "DNA_WITHOUT_REASON");
  assert.equal(dna?.severity, "warning");
  assert.deepEqual(dna?.relatedIds, ["A-005"]);
  assert.match(dna?.message ?? "", /15\/04\/2026/);
  assert.equal(checks.find((c) => c.code === "NO_PRE_INCIDENT_HISTORY")?.severity, "warning");
  assert.equal(checks.find((c) => c.code === "MULTIPLE_CLINICIANS")?.severity, "info");
});

test("case B (Daniel Brooks): facts and data checks", () => {
  const bundle = getDemoBundle("daniel-brooks");
  const facts = computeFacts(bundle, { asOf: "2026-10-06" });
  const byId = new Map(facts.map((f) => [f.id, f]));
  assert.equal(byId.get("FACT-attendance")?.value, "6 of 7 appointments attended (1 late cancellation)");
  assert.match(byId.get("FACT-attendance")?.detail ?? "", /23\/06\/2026 \(A-003, reason recorded/);
  assert.equal(byId.get("FACT-age")?.value, "46 years");
  assert.equal(byId.get("FACT-outcomes-ODI")?.value, "ODI 48% → 30% → 18% (lower is better)");
  assert.equal(byId.get("FACT-episode")?.value, "09/06/2026 to 22/09/2026 (discharged)");
  // History recorded (structured PMH), LCN has a reason, consent recorded, discharged with a note.
  assert.deepEqual(runDataChecks(bundle).map((c) => c.code), ["MULTIPLE_CLINICIANS"]);
});

test("case C (Rebecca Lane, private medical insurance): facts and data checks", () => {
  const bundle = getDemoBundle("rebecca-lane");
  const facts = computeFacts(bundle, { asOf: "2026-10-06" });
  const byId = new Map(facts.map((f) => [f.id, f]));
  assert.deepEqual(facts.map((f) => f.id), [
    "FACT-attendance",
    "FACT-age",
    "FACT-episode",
    "FACT-outcomes-NPRS",
    "FACT-outcomes-QuickDASH",
    "FACT-outcomes-PSFS",
  ]);
  // CNC and BOOKED are reported separately, not counted as missed.
  assert.equal(byId.get("FACT-attendance")?.value, "5 of 5 appointments attended");
  assert.match(byId.get("FACT-attendance")?.detail ?? "", /Cancelled with notice \(CNC, not counted above\): 1 – 22\/09\/2026 \(A-004\)/);
  assert.match(byId.get("FACT-attendance")?.detail ?? "", /Booked for a future date \(not counted above\): 1\./);
  assert.match(byId.get("FACT-attendance")?.detail ?? "", /First attended appointment 01\/09\/2026; last attended appointment 01\/10\/2026/);
  assert.equal(byId.get("FACT-age")?.value, "45 years");
  assert.match(byId.get("FACT-age")?.detail ?? "", /Age at the incident on 22\/08\/2026: 45 years/);
  assert.equal(byId.get("FACT-episode")?.value, "01/09/2026 to date (episode open; last contact 01/10/2026)");
  assert.match(byId.get("FACT-episode")?.detail ?? "", /5 clinical notes by 1 clinician: Sarah Reid \(PH-DEMO-01\) 5 notes/);
  assert.equal(byId.get("FACT-outcomes-NPRS")?.value, "NPRS 7/10 → 5/10 → 4/10 (lower is better)");
  assert.equal(byId.get("FACT-outcomes-QuickDASH")?.value, "QuickDASH 52.3/100 → 38.6/100 → 29.5/100 (lower is better)");
  assert.match(byId.get("FACT-outcomes-QuickDASH")?.detail ?? "", /22\.8 points lower .* an improvement/);
  assert.equal(byId.get("FACT-outcomes-PSFS")?.value, "PSFS 2.7/10 → 4.3/10 → 5.3/10 (higher is better)");
  assert.match(byId.get("FACT-outcomes-PSFS")?.detail ?? "", /01\/09\/2026: 2\.7\/10 \(N-001\); 15\/09\/2026: 4\.3\/10 \(N-003\); 01\/10\/2026: 5\.3\/10 \(N-005\)/);
  assert.match(byId.get("FACT-outcomes-PSFS")?.detail ?? "", /2\.6 points higher .* an improvement/);
  // No name, address, contact details or insurer identifiers in any fact (facts go to the AI).
  const text = JSON.stringify(facts);
  for (const pii of ["Rebecca", "Lane", "Larkspur", "07700", "example.com", "DEMO-POL", "DEMO-AUTH"]) assert.ok(!text.includes(pii), pii);
  // History recorded (structured PMH), one clinician, consent recorded: only the open episode is reported.
  assert.deepEqual(runDataChecks(bundle).map((c) => [c.code, c.severity]), [["EPISODE_STILL_OPEN", "info"]]);
});

test("data checks: open episode, missing discharge note, consent, single time point, incident date, DNA explained later", () => {
  const base = getDemoBundle("megan-hart");
  const open = { ...base, episodeStatus: "open" as const };
  assert.ok(runDataChecks(open).some((c) => c.code === "EPISODE_STILL_OPEN" && c.severity === "info"));
  const noDischarge = { ...base, notes: base.notes.map((n) => ({ ...n, type: n.type === "discharge" ? ("follow_up" as const) : n.type })) };
  assert.ok(runDataChecks(noDischarge).some((c) => c.code === "NO_DISCHARGE_NOTE"));
  const noConsent = { ...base, consent: { disclosureConsentRecorded: false } };
  assert.equal(runDataChecks(noConsent)[0].code, "CONSENT_NOT_RECORDED");
  assert.equal(runDataChecks(noConsent)[0].severity, "blocking");
  const single = { ...base, outcomeMeasures: base.outcomeMeasures.map((m) => ({ ...m, points: m.points.slice(0, 1) })) };
  const sc = runDataChecks(single).find((c) => c.code === "SINGLE_TIMEPOINT_OUTCOME");
  assert.deepEqual(sc?.relatedIds, ["OM-NDI", "OM-NPRS"]);
  const noIncidentDate = { ...base, incident: { mechanism: "Rear-end collision", type: "road_traffic_accident" as const } };
  assert.ok(runDataChecks(noIncidentDate).some((c) => c.code === "INCIDENT_DATE_MISSING"));
  const explained = {
    ...base,
    notes: base.notes.map((n) => (n.id === "N-005" ? { ...n, subjective: `Missed last session: car broke down. ${n.subjective}` } : n)),
  };
  assert.ok(!runDataChecks(explained).some((c) => c.code === "DNA_WITHOUT_REASON"));
});

/* ------------------------------------------------------------------------------------------------
 * Endpoints through the glue
 * ----------------------------------------------------------------------------------------------*/

test("GET /connectors lists the three tiles", async () => {
  const res = await connectorsList(req("/api/reports/v1/connectors"), { params: {} });
  const { connectors } = ConnectorsResponseSchema.parse(await res.json());
  assert.deepEqual(
    connectors.map((c) => [c.id, c.status, c.simulated, c.note]),
    [
      ["tm3-sim", "connected", true, "Simulated TM3 sandbox – demo data, not affiliated with TM3"],
      ["file-import", "available", false, "Notes export upload – available now"],
      ["tm3", "not_configured", false, "Not configured – needs TM3 partner access & confirmed notes access"],
    ],
  );
});

test("POST /launch requires the partner key", async () => {
  const body = { connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } };
  const none = await launch(req("/api/reports/v1/launch", { body }), { params: {} });
  assert.equal(none.status, 401);
  assert.equal((await problemOf(none)).code, "PARTNER_KEY_INVALID");
  const wrong = await launch(req("/api/reports/v1/launch", { body, headers: { "x-partner-key": "nope" } }), { params: {} });
  assert.equal(wrong.status, 401);
  const ok = await launch(req("/api/reports/v1/launch", { body, headers: { "x-partner-key": PARTNER_KEY } }), { params: {} });
  assert.equal(ok.status, 201);
  const { launchUrl, expiresAt } = LaunchResponseSchema.parse(await ok.json());
  assert.match(launchUrl, /^http:\/\/127\.0\.0\.1:9\/reports\/new\?lt=v1\./);
  const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
  assert.ok(minutes > 9 && minutes <= 10, `expires in ${minutes} min`);
  const tm3 = await launch(req("/api/reports/v1/launch", { body: { ...body, connectorId: "tm3" }, headers: { "x-partner-key": PARTNER_KEY } }), { params: {} });
  assert.equal(tm3.status, 503);
});

test("POST /launch/verify rejects bad tokens", async () => {
  const res = await launchVerify(req("/api/reports/v1/launch/verify", { body: { token: "v1.bad.token" } }), { params: {} });
  assert.equal(res.status, 401);
  assert.equal((await problemOf(res)).code, "TOKEN_INVALID");
  const bad = await launchVerify(req("/api/reports/v1/launch/verify", { body: {} }), { params: {} });
  assert.equal(bad.status, 422);

  // A launch token is exchanged once: replaying it (browser history, proxy logs) is refused.
  const l = await launch(
    req("/api/reports/v1/launch", {
      body: { connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001", clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
      headers: { "x-partner-key": PARTNER_KEY },
    }),
    { params: {} },
  );
  const lt = new URL(LaunchResponseSchema.parse(await l.json()).launchUrl).searchParams.get("lt") ?? "";
  const first = await launchVerify(req("/api/reports/v1/launch/verify", { body: { token: lt } }), { params: {} });
  assert.equal(first.status, 200);
  const replay = await launchVerify(req("/api/reports/v1/launch/verify", { body: { token: lt } }), { params: {} });
  assert.equal(replay.status, 401);
  assert.equal((await problemOf(replay)).code, "TOKEN_INVALID");
});

test("launch → verify → bundle (case A), with HTTP falling back to in-process", async () => {
  const token = await launchSessionFor("sim-pat-001", "sim-ep-1001");
  const res = await bundleRoute(
    req("/api/reports/v1/connectors/tm3-sim/patients/sim-pat-001/episodes/sim-ep-1001/bundle", { token }),
    { params: { id: "tm3-sim", pid: "sim-pat-001", eid: "sim-ep-1001" } },
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = BundleResponseSchema.parse(await res.json());
  const expected = getDemoBundle("megan-hart");
  assert.deepEqual({ ...body.bundle, source: { ...body.bundle.source, fetchedAt: "x" } }, { ...expected, source: { ...expected.source, fetchedAt: "x" } });
  assert.deepEqual(body.dataChecks.map((c) => c.code), ["NO_PRE_INCIDENT_HISTORY", "DNA_WITHOUT_REASON", "MULTIPLE_CLINICIANS"]);
  assert.ok(body.computedFacts.some((f) => f.id === "FACT-attendance"));
  assert.deepEqual(
    body.trace.map((t) => `${t.method} ${t.url.split("?")[0]} ${t.status} ${t.transport}`).sort(),
    [
      "GET /api/tm3-sim/v1/episodes/sim-ep-1001/appointments 200 in-process",
      "GET /api/tm3-sim/v1/episodes/sim-ep-1001/notes 200 in-process",
      "GET /api/tm3-sim/v1/episodes/sim-ep-1001/outcome-measures 200 in-process",
      "GET /api/tm3-sim/v1/patients/sim-pat-001 200 in-process",
      "GET /api/tm3-sim/v1/patients/sim-pat-001/episodes 200 in-process",
    ],
  );
  assert.equal(body.trace.length, 5);
  assert.ok(body.trace.every((t) => t.transport === "in-process" && t.status === 200 && t.ms >= 0));
  assert.ok(body.trace.some((t) => t.url.startsWith("/api/tm3-sim/v1/episodes/sim-ep-1001/notes?page=1&page_size=")));
  assert.ok(!JSON.stringify(body.trace).includes("Bearer"), "the trace never carries the token");
  // Recorded drafts are offered for exactly this record (bundle fingerprint), not for the patient ID alone.
  assert.ok((body.demoDrafts?.templateIds ?? []).includes("solicitor-rta-treating-physio"));
  assert.ok((body.demoDrafts?.formSha256s ?? []).length >= 2);

  // The launch session is bound to case A.
  const other = await bundleRoute(
    req("/api/reports/v1/connectors/tm3-sim/patients/sim-pat-002/episodes/sim-ep-1002/bundle", { token }),
    { params: { id: "tm3-sim", pid: "sim-pat-002", eid: "sim-ep-1002" } },
  );
  assert.equal(other.status, 403);
  assert.equal((await problemOf(other)).code, "SESSION_MISMATCH");

  // A launch session only ever sees its own patient in search.
  const list = await patients(req("/api/reports/v1/connectors/tm3-sim/patients", { token }), { params: { id: "tm3-sim" } });
  const listed = PatientsResponseSchema.parse(await list.json());
  assert.deepEqual(listed.patients.map((p) => p.id), ["sim-pat-001"]);
});

test("bundle needs a session; demo sessions read any demo episode; errors are problem+json", async () => {
  const path = "/api/reports/v1/connectors/tm3-sim/patients/sim-pat-002/episodes/sim-ep-1002/bundle";
  const params = { id: "tm3-sim", pid: "sim-pat-002", eid: "sim-ep-1002" };
  const anon = await bundleRoute(req(path), { params });
  assert.equal(anon.status, 401);
  assert.equal((await problemOf(anon)).code, "UNAUTHORIZED");

  const token = await demoSession();
  const ok = await bundleRoute(req(path, { token }), { params });
  assert.equal(ok.status, 200);
  const body = BundleResponseSchema.parse(await ok.json());
  assert.equal(body.bundle.registration.fullName, "Daniel Brooks");
  assert.equal(body.bundle.referral.type, "employer");

  const missing = await bundleRoute(req(path, { token }), { params: { ...params, eid: "sim-ep-9999" } });
  assert.equal(missing.status, 404);
  const unknownPatient = await bundleRoute(req(path, { token }), { params: { id: "tm3-sim", pid: "sim-pat-999", eid: "x" } });
  assert.equal(unknownPatient.status, 404);
  const tm3 = await bundleRoute(req(path, { token }), { params: { ...params, id: "tm3" } });
  assert.equal(tm3.status, 503);
  assert.equal((await problemOf(tm3)).code, "CONNECTOR_NOT_CONFIGURED");
  const nope = await bundleRoute(req(path, { token }), { params: { ...params, id: "nope" } });
  assert.equal(nope.status, 404);
});

test("GET patients: search, registration-only patients, episode summaries", async () => {
  const token = await demoSession("tm3-sim");
  const all = PatientsResponseSchema.parse(
    await (await patients(req("/api/reports/v1/connectors/tm3-sim/patients", { token }), { params: { id: "tm3-sim" } })).json(),
  );
  assert.equal(all.patients.length, 6);
  const megan = all.patients.find((p) => p.id === "sim-pat-001");
  assert.equal(megan?.displayName, "Megan Hart");
  assert.equal(megan?.registrationOnly, false);
  assert.deepEqual(megan?.episodes.map((e) => [e.id, e.referralType, e.status]), [["sim-ep-1001", "solicitor", "discharged"]]);
  assert.equal(all.patients.filter((p) => p.registrationOnly).length, 3);
  const lane = all.patients.find((p) => p.id === "sim-pat-006");
  assert.equal(lane?.displayName, "Rebecca Lane");
  assert.deepEqual(lane?.episodes.map((e) => [e.id, e.referralType, e.status]), [["sim-ep-1006", "insurer", "open"]]);
  // 1 patients call + 1 episodes call per patient with episodes.
  assert.equal(all.trace.length, 4);

  const hart = PatientsResponseSchema.parse(
    await (await patients(req("/api/reports/v1/connectors/tm3-sim/patients?search=hart", { token }), { params: { id: "tm3-sim" } })).json(),
  );
  assert.deepEqual(hart.patients.map((p) => p.id), ["sim-pat-001"]);

  const fileImportList = await patients(req("/api/reports/v1/connectors/file-import/patients", { token: await demoSession() }), { params: { id: "file-import" } });
  assert.equal(fileImportList.status, 422);
  assert.equal((await problemOf(fileImportList)).code, "CONNECTOR_UNSUPPORTED");
});

test("POST /connectors/file-import/bundle: sample CSV ok, broken file 422 IMPORT_INVALID", async () => {
  const token = await demoSession();
  const res = await fileImport(
    req("/api/reports/v1/connectors/file-import/bundle", { token, body: { format: "csv", content: SAMPLE_IMPORT_FILES.csv.content, fileName: "export.csv" } }),
    { params: {} },
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = BundleResponseSchema.parse(await res.json());
  assert.equal(body.bundle.source.connectorId, "file-import");
  assert.equal(body.bundle.source.label, "export.csv");
  assert.equal(body.bundle.notes.length, 6);
  assert.equal(body.trace.length, 1);
  assert.equal(body.trace[0].method, "PARSE");
  assert.match(body.trace[0].note ?? "", /6 notes · 7 appointments · 2 outcome series/);

  const bad = await fileImport(
    req("/api/reports/v1/connectors/file-import/bundle", { token, body: { format: "text", content: "no dated notes here" } }),
    { params: {} },
  );
  assert.equal(bad.status, 422);
  const problem = await problemOf(bad);
  assert.equal(problem.code, "IMPORT_INVALID");
  assert.match(problem.issues?.[0].message ?? "", /No dated notes found/);

  const launchToken = await launchSessionFor("sim-pat-001", "sim-ep-1001");
  const wrongSession = await fileImport(
    req("/api/reports/v1/connectors/file-import/bundle", { token: launchToken, body: { format: "csv", content: SAMPLE_IMPORT_FILES.csv.content } }),
    { params: {} },
  );
  assert.equal(wrongSession.status, 403);
});

test("POST /connectors/tm3-sim/documents files a signed PDF and verifies the receipt", async () => {
  const token = await launchSessionFor("sim-pat-001", "sim-ep-1001");
  const bundle = getDemoBundle("megan-hart");
  const report = createReport({ template: SOLICITOR_RTA_TEMPLATE, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle) });
  const receipt = await createReceipt({
    report,
    signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
    statementAccepted: true,
    attestations: [...SOLICITOR_RTA_TEMPLATE.attestations],
  });
  const pdf = Buffer.from("%PDF-1.7\n% fictional test document\n%%EOF\n", "latin1");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  // The token /render puts on a FINAL file (x-medreport-file-token) for these bytes and this episode.
  const fileToken = createFileToken({ receiptMac: receipt.mac, sha256, tenantId: "demo", connectorId: "tm3-sim", patientId: "sim-pat-001", episodeId: "sim-ep-1001" });
  const body = {
    patientId: "sim-pat-001",
    episodeId: "sim-ep-1001",
    title: "Treating Physiotherapist Report – Megan Hart",
    fileName: "Hart_M_Treating-Physio-Report_2026-10-06_SIGNED.pdf",
    mimeType: "application/pdf",
    contentBase64: pdf.toString("base64"),
    sha256,
    signReceipt: receipt,
    fileToken,
  };
  const params = { id: "tm3-sim" };
  const res = await documents(req("/api/reports/v1/connectors/tm3-sim/documents", { token, body }), { params });
  assert.equal(res.status, 201, await res.clone().text());
  const ok = DocumentsResponseSchema.parse(await res.json());
  assert.equal(ok.attachReceipt.sha256, body.sha256);
  assert.equal(ok.trace.length, 1);
  assert.equal(ok.trace[0].method, "POST");
  assert.equal(ok.trace[0].url, "/api/tm3-sim/v1/patients/sim-pat-001/documents");

  const forged = await documents(
    req("/api/reports/v1/connectors/tm3-sim/documents", { token, body: { ...body, signReceipt: { ...receipt, signer: { name: "Someone", hcpc: "X" } } } }),
    { params },
  );
  assert.equal(forged.status, 422);
  assert.equal((await problemOf(forged)).code, "RECEIPT_INVALID");

  const tampered = await documents(
    req("/api/reports/v1/connectors/tm3-sim/documents", { token, body: { ...body, sha256: "0".repeat(64) } }),
    { params },
  );
  assert.equal(tampered.status, 422);

  // A valid receipt is not enough: the file must be the one the server issued (token over the bytes).
  const draftPdf = Buffer.from("%PDF-1.7\n% DRAFT – not approved\n%%EOF\n", "latin1");
  const swapped = await documents(
    req("/api/reports/v1/connectors/tm3-sim/documents", {
      token,
      body: { ...body, contentBase64: draftPdf.toString("base64"), sha256: createHash("sha256").update(draftPdf).digest("hex") },
    }),
    { params },
  );
  assert.equal(swapped.status, 422);
  assert.equal((await problemOf(swapped)).code, "RECEIPT_INVALID");
  const noToken = await documents(req("/api/reports/v1/connectors/tm3-sim/documents", { token, body: { ...body, fileToken: undefined } }), { params });
  assert.equal(noToken.status, 422);
  const otherPatientsToken = createFileToken({ receiptMac: receipt.mac, sha256, tenantId: "demo", connectorId: "tm3-sim", patientId: "sim-pat-002", episodeId: "sim-ep-1002" });
  const wrongEpisode = await documents(req("/api/reports/v1/connectors/tm3-sim/documents", { token, body: { ...body, fileToken: otherPatientsToken } }), { params });
  assert.equal(wrongEpisode.status, 422);

  const otherEpisode = await documents(
    req("/api/reports/v1/connectors/tm3-sim/documents", { token, body: { ...body, patientId: "sim-pat-002", episodeId: "sim-ep-1002" } }),
    { params },
  );
  assert.equal(otherEpisode.status, 403);

  const noWriteBack = await documents(
    req("/api/reports/v1/connectors/file-import/documents", { token: await demoSession(), body }),
    { params: { id: "file-import" } },
  );
  assert.equal(noWriteBack.status, 422);
  assert.equal((await problemOf(noWriteBack)).code, "CONNECTOR_UNSUPPORTED");
});
