/**
 * Usage counting from the Report API (25/10/2026, api/usage.ts): which handler records what, for clinic members only,
 * never for the public demo, and never failing or holding up the action. Live drafting runs against a fake drafting
 * client (ai/claude.ts overrideClaudeClientForTests) – no network. Then the same handlers against the host's real
 * counters (src/server/usage/recorder.ts on node:sqlite): drafted twice + approved = ONE report. Fictional data only.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "live";
process.env.ANTHROPIC_API_KEY = "test-only-not-a-real-key";
delete process.env.CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE;
delete process.env.CLINFORMS_TENANT_LIVE_CALLS_PER_DAY;
delete process.env.MEDREPORT_LIVE_PASSCODE;

import { CONTENT_TYPES } from "../../src/modules/medreport/api/contract";
import type { AuthContext, ClinicProfile, MedreportDeps, UsageEvent } from "../../src/modules/medreport/api/deps";
import { handleDrafts } from "../../src/modules/medreport/api/handlers/drafts";
import { handleFormsAnalyse } from "../../src/modules/medreport/api/handlers/forms-analyse";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { bindHandler, type MedreportHandler } from "../../src/modules/medreport/api/http";
import { storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { USAGE_WAIT_MS, recordUsage, usageEpisodeFp, usageEpisodeOfBundle, usageEpisodeOfReport, usageReportKey } from "../../src/modules/medreport/api/usage";
import { overrideClaudeClientForTests, type ClaudeClient } from "../../src/modules/medreport/ai/claude";
import { generateDraftGroup } from "../../src/modules/medreport/ai/generate";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { resetMemoryLimits } from "../../src/modules/medreport/auth/shared-limits";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { FORM_ATTESTATIONS, formTemplateId, formToTemplate } from "../../src/modules/medreport/core/forms";
import type { EpisodeBundle, FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { createSqliteTestDb } from "../../src/server/db/testing/databases";
import { getUsageMonths, getUsageReport, listUsageReportRows } from "../../src/server/repos/usage";
import { ukPeriodOf } from "../../src/server/repos/usage-period";
import { dbUsageRecorder } from "../../src/server/usage/recorder";
import { getDemoBundle } from "./dev-bundles";
import { completedSampleReport } from "./form-sample-answers";
import { member, storeDeps, storeFetch } from "./store-harness";
import { demoBearer } from "./test-actors";

const A = "usage-clinic-a";
const CLIN: AuthContext = member(A, {
  role: "clinician",
  name: "Sam Ward (fictional)",
  clinician: { name: "Sam Ward (fictional)", hcpc: "ZZ0005", jobTitle: "Physiotherapist", canSign: true },
});
const PROFILE: ClinicProfile = { tenantId: A, displayName: "Usage Clinic (fictional)", addressLines: [], retentionDays: 365, draftingEnabled: true };
const FORM: FormDefinition = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: A }, "Practice manager", "2026-10-01T09:00:00.000Z");
const BUNDLE: EpisodeBundle = { ...getDemoBundle("megan-hart"), tenantId: A };
const USAGE = { input_tokens: 4000, output_tokens: 900, cache_read_input_tokens: 1200, cache_creation_input_tokens: 300 };

function reportOf(id: string, extra: Partial<Report> = {}): Report {
  const r = completedSampleReport("megan-hart", FORM, { id });
  return { ...r, tenantId: A, bundleSnapshot: { ...r.bundleSnapshot, tenantId: A }, ...extra };
}

/** The server's usage fingerprints (api/usage.ts): of the bundle drafted, and of a report approved or stored. */
const fpOfBundle = (bundle: EpisodeBundle = BUNDLE) => usageEpisodeFp(A, usageEpisodeOfBundle(bundle, formTemplateId(FORM.id)));
const fpOfReport = (report: Report) => usageEpisodeFp(A, usageEpisodeOfReport(report));

/** Another FICTIONAL patient and episode (the exploit tests draft them under ids that already counted). */
const OTHER: EpisodeBundle = {
  ...BUNDLE,
  source: { ...BUNDLE.source, externalPatientId: "sim-pat-099", externalEpisodeId: "sim-ep-099" },
  registration: {
    ...BUNDLE.registration,
    externalPatientId: "sim-pat-099",
    firstName: "Dana",
    lastName: "Other (fictional)",
    fullName: "Dana Other (fictional)",
    dob: "1980-02-02",
  },
};
function otherReportOf(id: string, extra: Partial<Report> = {}): Report {
  const r = reportOf(id, extra);
  return {
    ...r,
    patientLabel: OTHER.registration.fullName,
    episodeRef: { connectorId: OTHER.source.connectorId, patientId: OTHER.source.externalPatientId, episodeId: OTHER.source.externalEpisodeId },
    bundleSnapshot: OTHER,
  };
}

/** The first narrative question of the form, drafted by the recorded answers (the fake client returns those). */
const FIELD = FORM.fields.find((f) => f.fillSource.kind === "notes_narrative" || f.fillSource.kind === "clinician_opinion")?.id ?? "F-07";

type Fake = "ok" | "refusal" | "unreadable";
let fake: Fake = "ok";
let fakeCalls = 0;
let recordedOutput: unknown = null;

const fakeClient: ClaudeClient = {
  beta: {
    messages: {
      parse: (async () => {
        fakeCalls += 1;
        if (fake === "refusal") return { stop_reason: "refusal", usage: USAGE, model: "claude-sonnet-5-5", parsed_output: null };
        if (fake === "unreadable") return { stop_reason: "end_turn", usage: USAGE, model: "claude-sonnet-5-5", parsed_output: { ok: false, reason: "json" } };
        return { stop_reason: "end_turn", usage: USAGE, model: "claude-sonnet-5-5", parsed_output: { ok: true, data: recordedOutput, lenient: false } };
      }) as unknown as ClaudeClient["beta"]["messages"]["parse"],
    },
  },
};

function setup(usage: MedreportDeps["usage"], actors: Record<string, AuthContext> = { a: CLIN }) {
  const store = createMemoryTenantStore();
  const deps: MedreportDeps = { ...storeDeps(store, actors), clinicProfile: async (t) => (t === A ? PROFILE : null), ...(usage ? { usage } : {}) };
  return { deps, as: storeFetch(deps, { member: "a" }) };
}

function capture(): { events: Array<{ tenantId: string; event: UsageEvent }>; recorder: NonNullable<MedreportDeps["usage"]> } {
  const events: Array<{ tenantId: string; event: UsageEvent }> = [];
  return { events, recorder: { record: async (tenantId, event) => void events.push({ tenantId, event }) } };
}

async function call(
  deps: MedreportDeps,
  handler: MedreportHandler,
  path: string,
  body: unknown,
  headers: Record<string, string> = { cookie: "member=a" },
): Promise<Response> {
  // bh2 WA1 (design 6): a clinic approves only the revision it holds – store the report first, as the Studio does.
  const signing = (body as { report?: Report } | null)?.report;
  if (path === "/sign" && deps.tenantStore && signing && !headers.authorization && !(await deps.tenantStore.getReport(signing.tenantId, signing.id))) {
    await deps.tenantStore.createReport(signing.tenantId, { id: signing.id, status: signing.status, templateId: signing.templateId, formId: signing.form?.formId ?? null, payload: signing });
  }
  const req = new Request(`http://localhost/api/reports/v1${path}`, {
    method: "POST",
    headers: { "content-type": CONTENT_TYPES.json, origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });
  return bindHandler(handler, () => deps)(req, { params: {} });
}

const draftBody = (extra: Record<string, unknown> = {}) => ({
  templateId: formTemplateId(FORM.id),
  bundle: BUNDLE,
  instructingParty: BUNDLE.referral,
  sectionKeys: [FIELD],
  form: FORM,
  reportId: "rpt_usage_1",
  ...extra,
});

const signBody = (report: Report) => ({
  report,
  signer: { name: "Sam Ward (fictional)", hcpc: "ZZ0005" },
  typedSignature: "Sam Ward (fictional)",
  statementAccepted: true,
  attestations: [...FORM_ATTESTATIONS],
  form: FORM,
});

before(async () => {
  overrideClaudeClientForTests(fakeClient);
  const template = formToTemplate(FORM);
  const demo = await generateDraftGroup({
    template,
    bundle: BUNDLE,
    instructingParty: BUNDLE.referral,
    sectionKeys: [FIELD],
    computedFacts: computeFacts(BUNDLE),
    mode: "demo",
    form: FORM,
  });
  recordedOutput = demo.output;
});
after(() => overrideClaudeClientForTests(null));

describe("usage recorded by the Report API handlers", () => {
  test("live drafting: a successful call with its tokens and model; a refused one as a failed call with its tokens; a fallback to recorded answers counted once as failed", async () => {
    resetMemoryLimits();
    const c = capture();
    const t = setup(c.recorder);
    fake = "ok";
    const ok = await call(t.deps, handleDrafts, "/drafts", draftBody({ prefer: "live" }));
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal((await ok.json()).generation.mode, "live");
    assert.deepEqual(c.events, [
      {
        tenantId: A,
        event: {
          kind: "drafting_call",
          reportId: "rpt_usage_1",
          episodeFp: fpOfBundle(),
          succeeded: true,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 4000, outputTokens: 900, cacheReadInputTokens: 1200, cacheCreationInputTokens: 300 },
        },
      },
    ]);
    fake = "refusal";
    const refused = await call(t.deps, handleDrafts, "/drafts", draftBody({ prefer: "live", amendsReportId: "rpt_prev" }));
    assert.equal(refused.status, 502);
    assert.deepEqual(c.events[1].event, {
      kind: "drafting_call",
      reportId: "rpt_usage_1",
      amendsReportId: "rpt_prev",
      episodeFp: fpOfBundle(),
      succeeded: false,
      usage: { inputTokens: 4000, outputTokens: 900, cacheReadInputTokens: 1200, cacheCreationInputTokens: 300 },
      model: "claude-sonnet-5-5",
    });
    fake = "unreadable";
    const fellBack = await call(t.deps, handleDrafts, "/drafts", draftBody({ prefer: "live" }));
    assert.equal(fellBack.status, 200, await fellBack.clone().text());
    assert.notEqual((await fellBack.json()).generation.mode, "live", "the recorded answers stand in");
    assert.equal(c.events.length, 3);
    assert.equal((c.events[2].event as { succeeded: boolean }).succeeded, false);
  });

  test("demo answers never count; the public demo never counts anything", async () => {
    resetMemoryLimits();
    const c = capture();
    const t = setup(c.recorder);
    const before = fakeCalls;
    const demo = await call(t.deps, handleDrafts, "/drafts", draftBody({ prefer: "demo" }));
    assert.equal(demo.status, 200, await demo.clone().text());
    assert.equal(fakeCalls, before, "no drafting call");
    // The public demo: a demo session approves a demo report (its own fictional clinicians).
    const demoForm = withAttestedConfirmation(HARROW_PIKE_RAW, "Practice manager", "2026-10-01T09:00:00.000Z");
    const demoReport = completedSampleReport("megan-hart", demoForm, { id: "rpt_public_demo" });
    const signed = await call(
      t.deps,
      handleSign,
      "/sign",
      { ...signBody(demoReport), signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, typedSignature: "Sarah Reid", form: demoForm },
      { authorization: demoBearer() },
    );
    assert.equal(signed.status, 200, await signed.clone().text());
    assert.deepEqual(c.events, []);
  });

  test("approval, report start (with the amended report) and a form reading are recorded; a failing or slow recorder never fails the action", async () => {
    resetMemoryLimits();
    const c = capture();
    const t = setup(c.recorder);
    const signed = await call(
      t.deps,
      handleSign,
      "/sign",
      signBody(reportOf("rpt_sign_1", { amends: { reportId: "rpt_sign_0", version: 1, approvedAt: "2026-10-20T10:00:00.000Z" }, version: 2 })),
    );
    assert.equal(signed.status, 200, await signed.clone().text());
    assert.deepEqual(c.events.at(-1)?.event, {
      kind: "report_approved",
      reportId: "rpt_sign_1",
      amendsReportId: "rpt_sign_0",
      episodeFp: fpOfReport(reportOf("rpt_sign_1")),
    });
    const created = await t.as(storeApiPaths.report("rpt_store_1"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: reportOf("rpt_store_1", { status: "draft", receipt: undefined }) }),
    });
    assert.equal(created.status, 201, await created.clone().text());
    assert.deepEqual(c.events.at(-1)?.event, { kind: "report_started", reportId: "rpt_store_1", episodeFp: fpOfReport(reportOf("rpt_store_1")) });
    const file = Buffer.from(await getSampleForm("harrow-pike-treating-physio")!.loadFile()).toString("base64");
    const read = await call(t.deps, handleFormsAnalyse, "/forms/analyse", { fileBase64: file, fileName: "form.pdf", prefer: "demo" });
    assert.equal(read.status, 200, await read.clone().text());
    assert.deepEqual(c.events.at(-1)?.event, { kind: "form_read", read: true, liveCalls: 0, failedCalls: 0 });

    // A recorder that throws: the approval still succeeds.
    const broken = setup({ record: async () => Promise.reject(new Error("database down")) });
    const stillSigned = await call(broken.deps, handleSign, "/sign", signBody(reportOf("rpt_sign_2")));
    assert.equal(stillSigned.status, 200);
    // A recorder that hangs: recordUsage gives up waiting after USAGE_WAIT_MS.
    const started = Date.now();
    await recordUsage(
      { ...broken.deps, usage: { record: () => new Promise(() => undefined) } },
      { via: "user", tenantId: A },
      { kind: "question_set_created", formId: "frm_1" },
    );
    assert.ok(Date.now() - started >= USAGE_WAIT_MS - 50 && Date.now() - started < USAGE_WAIT_MS + 1000);
  });

  test("a demo clinic (made-up data) counts like any clinic: its PH-DEMO approval is recorded; a refused made-up number records nothing", async () => {
    resetMemoryLimits();
    const demoMember = member(A, {
      role: "clinician",
      name: "Sarah Reid",
      clinician: { name: "Sarah Reid", hcpc: "PH-DEMO-01", jobTitle: "Physiotherapist", canSign: true },
    });
    const demoSign = (id: string) => ({ ...signBody(reportOf(id)), signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, typedSignature: "Sarah Reid" });
    const c = capture();
    const t = setup(c.recorder, { a: demoMember });
    const demoDeps: MedreportDeps = { ...t.deps, clinicProfile: async (tenant) => (tenant === A ? { ...PROFILE, demoClinic: true } : null) };
    const signed = await call(demoDeps, handleSign, "/sign", demoSign("rpt_demo_clinic_1"));
    assert.equal(signed.status, 200, await signed.clone().text());
    assert.deepEqual(c.events, [{ tenantId: A, event: { kind: "report_approved", reportId: "rpt_demo_clinic_1", episodeFp: fpOfReport(reportOf("rpt_demo_clinic_1")) } }]);
    // The same made-up number in a real clinic: refused before anything is counted.
    const refused = await call(t.deps, handleSign, "/sign", demoSign("rpt_demo_clinic_2"));
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code?: string }).code, "DEMO_NUMBER_NOT_ALLOWED");
    assert.equal(c.events.length, 1);
  });

  test("end to end on the host's counters: drafted twice, re-drafted and approved twice = ONE report; tokens of every call", async () => {
    resetMemoryLimits();
    const db = createSqliteTestDb();
    try {
      const t = setup(dbUsageRecorder(() => db.db));
      fake = "ok";
      for (let i = 0; i < 3; i++) assert.equal((await call(t.deps, handleDrafts, "/drafts", draftBody({ prefer: "live", reportId: "rpt_e2e" }))).status, 200);
      for (let i = 0; i < 2; i++) assert.equal((await call(t.deps, handleSign, "/sign", signBody(reportOf("rpt_e2e")))).status, 200);
      assert.equal((await call(t.deps, handleSign, "/sign", signBody(reportOf("rpt_records_only")))).status, 200);
      const [m] = await getUsageMonths({ db: db.db }, A, [ukPeriodOf(new Date())]);
      assert.equal(m.billableReports, 2, "rpt_e2e at its first drafting, rpt_records_only at its approval");
      assert.equal(m.billableOnApproval, 1);
      assert.equal(m.reportsApproved, 2);
      assert.equal(m.draftingCalls, 3);
      assert.equal(m.inputTokens, 12000);
      assert.equal(m.costMicroUsd, 3 * (4000 * 2 + 900 * 10 + 1200 * 0.2 + 300 * 2 * 1.25));
      assert.equal((await getUsageReport({ db: db.db }, A, "rpt_e2e"))?.billable_via, "drafted");
    } finally {
      await db.close();
    }
  });

  test("the fingerprint is the server's: the same for the Studio's drafting and its approval of one report, different for another patient; 22 characters, no patient data", () => {
    const drafted = fpOfBundle();
    assert.match(drafted, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(fpOfReport(reportOf("rpt_any")), drafted, "drafting (bundle) and approval (report) of one report agree");
    assert.equal(fpOfReport(reportOf("rpt_other_id")), drafted, "the report id is not part of it");
    assert.notEqual(fpOfBundle(OTHER), drafted);
    assert.equal(fpOfReport(otherReportOf("rpt_x")), fpOfBundle(OTHER));
    assert.notEqual(usageEpisodeFp("another-clinic", usageEpisodeOfBundle(BUNDLE, formTemplateId(FORM.id))), drafted);
    assert.notEqual(usageEpisodeFp(A, usageEpisodeOfBundle(BUNDLE, "pi-report")), drafted, "another form or template");
    for (const s of [BUNDLE.registration.fullName, BUNDLE.registration.dob, BUNDLE.source.externalPatientId]) assert.ok(!drafted.includes(s));
    // Report ids: the Studio's as they are; anything else as a keyed hash.
    assert.equal(usageReportKey("rpt_0123456789abcdef"), "rpt_0123456789abcdef");
    assert.match(usageReportKey("sam@example.com") ?? "", /^h_[A-Za-z0-9_-]{32}$/);
    assert.equal(usageReportKey("sam@example.com"), usageReportKey("sam@example.com"));
  });

  test("FIX (security review 25/10/2026): ids chosen by the browser no longer keep reports out of the allowance – real handlers, real counters", async () => {
    resetMemoryLimits();
    const db = createSqliteTestDb();
    try {
      const store = createMemoryTenantStore();
      const deps: MedreportDeps = {
        ...storeDeps(store, { a: CLIN }),
        // Generous limits for this test only (it makes ~20 live calls to the fake client).
        clinicProfile: async (t) => (t === A ? { ...PROFILE, draftingLimits: { perMinute: 500, perDay: 5000 } } : null),
        usage: dbUsageRecorder(() => db.db),
      };
      const month = async () => (await getUsageMonths({ db: db.db }, A, [ukPeriodOf(new Date())]))[0];
      const draft = async (extra: Record<string, unknown>) => {
        const res = await call(deps, handleDrafts, "/drafts", draftBody({ prefer: "live", ...extra }));
        assert.equal(res.status, 200, await res.clone().text());
      };
      const sign = async (report: Report) => {
        const res = await call(deps, handleSign, "/sign", signBody(report));
        assert.equal(res.status, 200, await res.clone().text());
      };
      fake = "ok";

      // Baseline: rpt_first drafted live and approved = 1 report.
      await draft({ reportId: "rpt_first" });
      await sign(reportOf("rpt_first"));
      let m = await month();
      assert.equal(m.billableReports, 1);

      // V1 – another patient drafted 5 times under the counted report's id: ONE new report (it was free before).
      for (let i = 0; i < 5; i++) await draft({ reportId: "rpt_first", bundle: OTHER, instructingParty: OTHER.referral });
      m = await month();
      assert.equal(m.billableReports, 2);
      assert.equal(m.draftingCalls, 6);
      assert.equal((await listUsageReportRows({ db: db.db }, A, "rpt_first")).length, 2, "one row per fingerprint");

      // V2 – five new reports of another patient, each claiming to amend the approved one: each counts (free before).
      for (let i = 0; i < 5; i++) await draft({ reportId: `rpt_new_${i}`, amendsReportId: "rpt_first", bundle: OTHER, instructingParty: OTHER.referral });
      m = await month();
      assert.equal(m.billableReports, 7);

      // V3 – a records-only report of another patient approved with a made-up report.amends: counts at approval.
      await sign(otherReportOf("rpt_records_forged", { amends: { reportId: "rpt_first", version: 1, approvedAt: "2026-10-20T10:00:00.000Z" }, version: 2 }));
      m = await month();
      assert.equal(m.billableReports, 8);
      assert.equal(m.billableOnApproval, 1);
      assert.equal(m.amendmentsApproved, 0);

      // The Studio's own amendment (same patient, episode and form): drafted again and approved – never counts.
      const v2 = reportOf("rpt_first_v2", { amends: { reportId: "rpt_first", version: 1, approvedAt: "2026-10-20T10:00:00.000Z" }, version: 2 });
      await draft({ reportId: "rpt_first_v2", amendsReportId: "rpt_first" });
      await sign(v2);
      m = await month();
      assert.equal(m.billableReports, 8);
      assert.equal(m.amendmentsApproved, 1);

      // Honest re-drafting and re-approving of one report: still once.
      for (let i = 0; i < 2; i++) await draft({ reportId: "rpt_honest" });
      for (let i = 0; i < 2; i++) await sign(reportOf("rpt_honest"));
      m = await month();
      assert.equal(m.billableReports, 9);

      // An odd report id: the clinic's store cannot hold it, so it is never approved (bh2 WA1 design 6: a clinic approves only
      // what it holds – 409 STALE_REPORT); drafted, it counts once, under a hashed key.
      for (let i = 0; i < 2; i++) assert.equal((await call(deps, handleSign, "/sign", signBody(reportOf("rpt odd id")))).status, 409);
      await draft({ reportId: "rpt odd id" });
      m = await month();
      assert.equal(m.billableReports, 10);
      assert.equal(await getUsageReport({ db: db.db }, A, "rpt odd id"), null, "never stored as sent");

      // A refused live call used tokens: its report counts; the retry that works does not count it again.
      fake = "refusal";
      const refused = await call(deps, handleDrafts, "/drafts", draftBody({ prefer: "live", reportId: "rpt_refused" }));
      assert.equal(refused.status, 502);
      m = await month();
      assert.equal(m.billableReports, 11);
      fake = "ok";
      await draft({ reportId: "rpt_refused" });
      m = await month();
      assert.equal(m.billableReports, 11);
      assert.equal(m.failedCalls, 1);
    } finally {
      fake = "ok";
      await db.close();
    }
  });
});
