/**
 * "Complete another form for this patient" (25/10/2026): POST /api/reports/v1/store/reports/{id}/reuse and the new
 * report the Studio makes from it.
 *
 * - the handler on an in-memory clinic store: the member's own clinic only (another clinic's report and a missing or
 *   deleted one are the same 404, in plain words), sign-in / two-step / same-origin / JSON rules, a trial that has
 *   ended, the simulated demo system, a launch session narrowed to another episode; the record is the stored copy
 *   (the clinic's current details stamped on, figures and data checks of today), the patient's consent to share the
 *   earlier report is not carried over for uploaded notes – recorded on the report, entered at the notes check or
 *   shown by the notes (review fix) – while a clinic system's record keeps its own, and one "notes.reused" audit row
 *   per read (counts only – no patient data);
 * - the new report (ui/components/new/generate.ts createTargetReport): a NEW id, version 1, no "amends", its activity
 *   says where the notes came from;
 * - usage on the host's real counters (node:sqlite) with live drafting against a fake drafting client (no network):
 *   drafting the new report counts as a report of its own – another form or the same one again – and is never taken
 *   for an amendment.
 * Fictional data only.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "live";
process.env.ANTHROPIC_API_KEY = "test-only-not-a-real-key";
delete process.env.CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE;
delete process.env.CLINFORMS_TENANT_LIVE_CALLS_PER_DAY;
delete process.env.MEDREPORT_LIVE_PASSCODE;

import { BundleResponseSchema, CONTENT_TYPES } from "../../src/modules/medreport/api/contract";
import type { AuthContext, ClinicProfile, MedreportDeps } from "../../src/modules/medreport/api/deps";
import { handleDrafts } from "../../src/modules/medreport/api/handlers/drafts";
import { bindHandler } from "../../src/modules/medreport/api/http";
import { StoreReportReuseResponseSchema, storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore, type MemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { overrideClaudeClientForTests, type ClaudeClient } from "../../src/modules/medreport/ai/claude";
import { generateDraftGroup } from "../../src/modules/medreport/ai/generate";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import { resetMemoryLimits } from "../../src/modules/medreport/auth/shared-limits";
import { createFileImportConnector, readNotesUpload } from "../../src/modules/medreport/connectors/file-import/connector";
import { bundleFromReview } from "../../src/modules/medreport/connectors/file-import/review-bundle";
import { NotesReviewSchema } from "../../src/modules/medreport/connectors/file-import/review-contract";
import { createConnectorRegistry } from "../../src/modules/medreport/connectors/registry";
import { createTm3SimConnector } from "../../src/modules/medreport/connectors/tm3-sim/connector";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { formTemplateId, formToTemplate } from "../../src/modules/medreport/core/forms";
import { KNOWN_ACTIVITY_ACTIONS } from "../../src/modules/medreport/core/report-factory";
import { CONSENT_RECORDED_ACTION, NOTES_REUSED_ACTION, notesReusedDetail, recordForAnotherForm } from "../../src/modules/medreport/core/reuse";
import { REPORT_MODEL } from "../../src/modules/medreport/core/schemas";
import type { EpisodeBundle, FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { runDataChecks } from "../../src/modules/medreport/core/validation/data-checks";
import { WORDING } from "../../src/modules/medreport/core/wording";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { createTargetReport } from "../../src/modules/medreport/ui/components/new/generate";
import { updateRegistration } from "../../src/modules/medreport/ui/components/new/notes-review-model";
import { canRecordConsent } from "../../src/modules/medreport/ui/components/review/review-model";
import { ACTIVITY_GROUPS, activityLabel, describeActivityDetail } from "../../src/lib/activity-copy";
import { createSqliteTestDb } from "../../src/server/db/testing/databases";
import { getUsageMonths, listUsageReportRows } from "../../src/server/repos/usage";
import { ukPeriodOf } from "../../src/server/repos/usage-period";
import { dbUsageRecorder } from "../../src/server/usage/recorder";
import { getDemoBundle } from "./dev-bundles";
import { approverRef, asApproversReport, asFactoryCopy } from "./release-store-fixture";
import { completedSampleReport } from "./form-sample-answers";
import { PRACTICE_PRINTOUT_TEXT } from "./notes-fixtures";
import { ORIGIN, member, storeDeps, storeFetch } from "./store-harness";
import { demoBearer } from "./test-actors";

const A = "reuse-clinic-a";
const B = "reuse-clinic-b";
const CLIN: AuthContext = member(A, {
  role: "clinician",
  name: "Sam Ward (fictional)",
  clinician: { name: "Sam Ward (fictional)", hcpc: "ZZ0005", jobTitle: "Physiotherapist", canSign: true },
});
const PROFILE: ClinicProfile = {
  tenantId: A,
  displayName: "Reuse Physio (fictional)",
  addressLines: ["1 Made-up Road"],
  postcode: "ZZ1 1ZZ",
  retentionDays: 30,
  draftingEnabled: true,
  draftingLimits: { perMinute: 200, perDay: 2000 },
};

/** The record of an UPLOAD of fictional notes (file import), as a report of clinic A holds it. */
const UPLOADED: EpisodeBundle = {
  ...getDemoBundle("megan-hart"),
  tenantId: A,
  source: {
    connectorId: "file-import",
    simulated: false,
    fetchedAt: "2026-10-20T09:00:00.000Z",
    externalPatientId: "imp-pat-reuse-1",
    externalEpisodeId: "imp-ep-reuse-1",
    label: "Notes upload",
  },
  consent: { disclosureConsentRecorded: false },
  // The clinic's details as they were when the notes were uploaded (the server stamps today's on reuse).
  clinic: { name: "Old Name Physio (fictional)", addressLines: [] },
};

const FORM: FormDefinition = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: A }, "Practice manager", "2026-10-01T09:00:00.000Z");
/** A second referrer form of the clinic (the same questions under another id and title – fictional). */
const FORM2: FormDefinition = withAttestedConfirmation(
  { ...HARROW_PIKE_RAW, id: "frm_reuse_second_form", title: "Second referrer form (fictional)", referrer: { name: "Second Referrer (fictional)", type: "insurer" }, tenantId: A },
  "Practice manager",
  "2026-10-01T09:00:00.000Z",
);
const FIELD = FORM.fields.find((f) => f.fillSource.kind === "notes_narrative" || f.fillSource.kind === "clinician_opinion")?.id ?? "F-07";

/** A stored report of clinic A completed from the uploaded notes. */
function sourceReport(id: string, extra: Partial<Report> = {}): Report {
  // bh2 fix round 1 (WC, R1T-WC-06): stored as the Studio stores it – with its approving clinician (Sam).
  const r = asApproversReport(completedSampleReport("megan-hart", FORM, { id }), CLIN);
  return {
    ...r,
    tenantId: A,
    episodeRef: { connectorId: "file-import", patientId: UPLOADED.source.externalPatientId, episodeId: UPLOADED.source.externalEpisodeId },
    bundleSnapshot: UPLOADED,
    ...extra,
  };
}

const connectors = createConnectorRegistry([createTm3SimConnector(), createFileImportConnector()]);

function setup(opts: { profile?: ClinicProfile | null; usage?: MedreportDeps["usage"]; actors?: Record<string, AuthContext> } = {}) {
  const store: MemoryTenantStore = createMemoryTenantStore();
  const profile = opts.profile === undefined ? PROFILE : opts.profile;
  const deps: MedreportDeps = {
    ...storeDeps(store, opts.actors ?? { a: CLIN, b: member(B), nofactor: member(A, { twoFactorVerified: false }), staff: member(A, { userId: "user-staff-a", role: "staff" }) }),
    connectors,
    clinicProfile: async (t) => (profile && t === A ? profile : null),
    ...(opts.usage ? { usage: opts.usage } : {}),
  };
  const as = (who: string | null, origin?: string) => storeFetch(deps, { member: who, origin });
  return { store, deps, as };
}

async function putReport(f: typeof fetch, report: Report): Promise<void> {
  const res = await f(storeApiPaths.report(report.id), { method: "PUT", headers: { "content-type": CONTENT_TYPES.json }, body: JSON.stringify({ report }) });
  assert.equal(res.status, 201, await res.clone().text());
}

const reuse = (f: typeof fetch, id: string, init: RequestInit = {}) =>
  f(storeApiPaths.reportReuse(id), { method: "POST", headers: { "content-type": CONTENT_TYPES.json }, body: "{}", ...init });

describe("POST /store/reports/{id}/reuse – the handler", () => {
  test("own clinic: the stored record, re-stamped with today's clinic details, figures and checks; one 'notes.reused' row with counts only", async () => {
    resetMemoryLimits();
    const { as, store } = setup();
    const f = as("a");
    await putReport(f, sourceReport("rpt_reuse_draft"));
    const before = store.auditLog.length;

    const res = await reuse(f, "rpt_reuse_draft");
    assert.equal(res.status, 200, await res.clone().text());
    const body = StoreReportReuseResponseSchema.parse(await res.json());
    const { data, source } = body;
    BundleResponseSchema.parse(data);
    // The same patient and notes as the earlier report – nothing uploaded again.
    assert.equal(data.bundle.registration.fullName, UPLOADED.registration.fullName);
    assert.equal(data.bundle.notes.length, UPLOADED.notes.length);
    assert.deepEqual(data.bundle.notes.map((n) => n.id), UPLOADED.notes.map((n) => n.id));
    assert.equal(data.bundle.appointments.length, UPLOADED.appointments.length);
    assert.deepEqual(data.bundle.source, UPLOADED.source, "the same episode (connector, patient and episode ids)");
    assert.equal(data.bundle.tenantId, A);
    assert.equal(data.bundle.clinic?.name, "Reuse Physio (fictional)", "the clinic's current details, as for a new upload");
    assert.deepEqual(
      data.computedFacts.map((x) => x.id),
      computeFacts(UPLOADED).map((x) => x.id),
    );
    assert.ok(data.dataChecks.some((c) => c.code === "CONSENT_NOT_RECORDED"), "the notes did not record consent");
    assert.equal(data.trace[0].method, "READ");
    assert.deepEqual(source, {
      reportId: "rpt_reuse_draft",
      status: "draft",
      version: 1,
      formId: FORM.id,
      formTitle: FORM.title,
      referrerName: FORM.referrer.name,
      consentReset: false,
    });

    const rows = store.auditLog.slice(before);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "notes.reused");
    assert.equal(rows[0].targetType, "report");
    assert.equal(rows[0].targetId, "rpt_reuse_draft", "which report's notes were reused");
    assert.equal(rows[0].tenantId, A);
    assert.equal(rows[0].userId, CLIN.userId);
    assert.deepEqual(rows[0].detail, {
      notes: UPLOADED.notes.length,
      appointments: UPLOADED.appointments.length,
      outcomeScores: UPLOADED.outcomeMeasures.reduce((n, m) => n + m.points.length, 0),
      sourceStatus: "draft",
      sourceVersion: 1,
      consentReset: false,
    });
    const audit = JSON.stringify(store.auditLog);
    for (const s of [UPLOADED.registration.fullName, UPLOADED.registration.lastName, UPLOADED.registration.dob]) assert.ok(!audit.includes(s), "no patient data in the audit log");
    // Reading creates nothing: the clinic still holds one report.
    assert.equal((await store.listReports(A)).length, 1);
  });

  test("an approved report (and an amended version) can be reused too; the version is told", async () => {
    resetMemoryLimits();
    const { as, store } = setup();
    const signed = sourceReport("rpt_reuse_signed_v2", { status: "signed", version: 2, amends: { reportId: "rpt_reuse_signed", version: 1, approvedAt: "2026-10-21T10:00:00.000Z" } });
    // Stored as the server holds an approved report (the receipt rules are store-reports.ts's, tested elsewhere).
    const created = await store.createReport(A, { id: signed.id, status: "signed", templateId: signed.templateId, formId: FORM.id, payload: signed });
    assert.equal(created.ok, true);
    const res = await reuse(as("a"), signed.id);
    assert.equal(res.status, 200, await res.clone().text());
    const { source } = StoreReportReuseResponseSchema.parse(await res.json());
    assert.equal(source.status, "signed");
    assert.equal(source.version, 2);
  });

  test("another clinic's report, a missing one and a deleted one: the same plain 404 – nothing revealed, nothing audited", async () => {
    resetMemoryLimits();
    const { as, store } = setup();
    await putReport(as("a"), sourceReport("rpt_reuse_private"));
    const before = store.auditLog.length;
    for (const [who, id] of [
      ["b", "rpt_reuse_private"],
      ["a", "rpt_reuse_never_existed"],
    ] as const) {
      const res = await reuse(as(who), id);
      assert.equal(res.status, 404, `${who} ${id}`);
      const problem = (await res.json()) as { code: string; title: string; detail: string };
      assert.equal(problem.code, "NOT_FOUND");
      assert.equal(problem.title, WORDING.server.access.reuseGoneTitle);
      assert.equal(problem.detail, WORDING.server.access.reuseGoneDetail);
      assert.match(problem.detail, /deleted, or removed at the end of your clinic's retention period/);
      assert.doesNotMatch(JSON.stringify(problem), /Megan|Hart|reuse-clinic-a/, "nothing about the other clinic's report");
    }
    // Deleted (by a member, or by the retention job): gone for reuse too.
    const del = await as("a")(storeApiPaths.report("rpt_reuse_private"), { method: "DELETE" });
    assert.equal(del.status, 200);
    const gone = await reuse(as("a"), "rpt_reuse_private");
    assert.equal(gone.status, 404);
    assert.equal(store.auditLog.slice(before).filter((r) => r.action === "notes.reused").length, 0);
  });

  test("sign-in rules: signed out 401, no two-step 403, the public demo 401, another site 403, not JSON 415; staff may start a report", async () => {
    resetMemoryLimits();
    const { as, deps } = setup();
    await putReport(as("a"), sourceReport("rpt_reuse_rules"));
    assert.equal((await reuse(as(null), "rpt_reuse_rules")).status, 401);
    const nofactor = await reuse(as("nofactor"), "rpt_reuse_rules");
    assert.equal(nofactor.status, 403);
    assert.equal(((await nofactor.json()) as { code: string }).code, "TWO_FACTOR_REQUIRED");
    const demo = await reuse(storeFetch(deps, {}), "rpt_reuse_rules", { headers: { "content-type": CONTENT_TYPES.json, authorization: demoBearer() } });
    assert.equal(demo.status, 401, "a public-demo session never reads a clinic's records");
    assert.equal((await reuse(as("a", "https://evil.example"), "rpt_reuse_rules")).status, 403);
    assert.equal((await reuse(as("a"), "rpt_reuse_rules", { headers: { "content-type": "text/plain" } })).status, 415);
    const staff = await reuse(as("staff"), "rpt_reuse_rules");
    assert.equal(staff.status, 200, "whoever may start a report today (any role) may start one from these notes");
    // A Studio page opened for another clinic than the sign-in's is refused (fix wave 2 headers).
    const other = await reuse(as("a"), "rpt_reuse_rules", { headers: { "content-type": CONTENT_TYPES.json, "x-clinforms-tenant": B } });
    assert.equal(other.status, 403);
  });

  test("a clinic whose trial has ended starts no new report from these notes (403 TRIAL_ENDED); the earlier report still opens", async () => {
    resetMemoryLimits();
    const live = setup();
    await putReport(live.as("a"), sourceReport("rpt_reuse_trial"));
    const ended = setup({ profile: { ...PROFILE, trial: { state: "ended" }, contactEmail: "support@example.com" } });
    // The same stored report, in the clinic whose trial has now ended.
    const stored = await live.store.getReport(A, "rpt_reuse_trial");
    assert.ok(stored);
    await ended.store.createReport(A, { id: "rpt_reuse_trial", status: "draft", templateId: stored.payload ? (stored.payload as Report).templateId : "", formId: FORM.id, payload: stored.payload });
    const res = await reuse(ended.as("a"), "rpt_reuse_trial");
    assert.equal(res.status, 403);
    const problem = (await res.json()) as { code: string; detail: string };
    assert.equal(problem.code, "TRIAL_ENDED");
    assert.match(problem.detail, /starting a new report is not available/);
    assert.equal((await ended.as("a")(storeApiPaths.report("rpt_reuse_trial"))).status, 200, "existing reports stay available");
    assert.equal(ended.store.auditLog.filter((r) => r.action === "notes.reused").length, 0);
  });

  test("a record from the public demo's simulated system is not a clinic's (403); a launch session for another episode is refused (403)", async () => {
    resetMemoryLimits();
    const { as, store, deps } = setup();
    const simulated = { ...sourceReport("rpt_reuse_sim"), bundleSnapshot: { ...getDemoBundle("megan-hart"), tenantId: A } };
    await store.createReport(A, { id: simulated.id, status: "draft", templateId: simulated.templateId, formId: FORM.id, payload: simulated });
    const sim = await reuse(as("a"), "rpt_reuse_sim");
    assert.equal(sim.status, 403);
    assert.equal(((await sim.json()) as { code: string }).code, "CONNECTOR_NOT_AVAILABLE");

    await putReport(as("a"), sourceReport("rpt_reuse_episode"));
    // The member opened ClinForms from the clinic system for ANOTHER patient's episode ("user+launch").
    const launch = createSessionToken({
      tenantId: A,
      kind: "launch",
      connectorId: "file-import",
      patientId: "imp-pat-someone-else",
      episodeId: "imp-ep-someone-else",
    }).token;
    const res = await reuse(storeFetch(deps, { member: "a" }), "rpt_reuse_episode", {
      headers: { "content-type": CONTENT_TYPES.json, authorization: `Bearer ${launch}` },
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code: string }).code, "SESSION_MISMATCH");
  });

  test("consent recorded on the earlier report ('Record consent') is not carried over", async () => {
    resetMemoryLimits();
    const { as, store } = setup();
    const f = as("a");
    // Recorded on the report in the Studio (the notes did not show it): activity "consent_recorded".
    const onReport = sourceReport("rpt_reuse_consent_on_report", {
      bundleSnapshot: { ...UPLOADED, consent: { disclosureConsentRecorded: true, date: "2026-10-21" } },
      activity: [
        ...sourceReport("x").activity,
        { at: "2026-10-21T10:00:00.000Z", actor: "Sam Ward (fictional)", action: CONSENT_RECORDED_ACTION, detail: "Recorded the patient's consent to share the report, given on 21/10/2026." },
      ],
    });
    await putReport(f, onReport);
    const a = StoreReportReuseResponseSchema.parse(await (await reuse(f, onReport.id)).json());
    assert.equal(a.source.consentReset, true);
    assert.deepEqual(a.data.bundle.consent, { disclosureConsentRecorded: false });
    assert.ok(a.data.dataChecks.some((c) => c.code === "CONSENT_NOT_RECORDED" && c.severity === "blocking"), "approval needs it recorded again");
    assert.equal(store.auditLog.at(-1)?.detail?.consentReset, true);
  });

  // Review fix R-security-1 / R-correctness-1: consent that staff ENTER AT THE NOTES CHECK ("Consent to share the
  // report: Recorded" + date) lands in the record exactly like consent the notes showed – nothing tells them apart –
  // so for uploaded notes recorded consent is never carried into another form, however it was recorded.
  test("consent staff entered at the notes check (real read → check → confirm) is not carried over: blocking again on the new form", async () => {
    resetMemoryLimits();
    const now = new Date("2026-10-10T09:00:00.000Z");
    const read = await readNotesUpload(
      { tenantId: A, credentials: { kind: "none" }, baseUrl: "", fetch: (u, i) => fetch(u, i), trace: [] },
      { format: "text", content: PRACTICE_PRINTOUT_TEXT, fileName: "printout.txt" },
      { now },
    );
    assert.equal(read.kind, "review");
    if (read.kind !== "review") return;
    let review = NotesReviewSchema.parse(read.review);
    assert.equal(review.registration.consent, "", "the fictional notes do not record consent");
    // A fresh upload as read: consent not recorded, approval blocked.
    const fresh = bundleFromReview(review, { tenantId: A, now });
    assert.ok(fresh.ok, JSON.stringify(!fresh.ok && fresh.issues));
    if (!fresh.ok) return;
    assert.equal(fresh.bundle.consent.disclosureConsentRecorded, false);
    // Staff choose "Recorded" (05/10/2026) at the notes check for the FIRST form, then confirm (file-import-confirm.ts).
    review = updateRegistration(updateRegistration(review, "consent", "yes"), "consentDate", "2026-10-05");
    const confirmed = bundleFromReview(review, { tenantId: A, now });
    assert.ok(confirmed.ok, JSON.stringify(!confirmed.ok && confirmed.issues));
    if (!confirmed.ok) return;
    assert.deepEqual(confirmed.bundle.consent, { disclosureConsentRecorded: true, date: "2026-10-05" });
    assert.ok(!runDataChecks(confirmed.bundle).some((c) => c.code === "CONSENT_NOT_RECORDED"), "the first form may be approved");

    // Report A on the first form, stored by a member with the staff role (no "consent_recorded" activity).
    const { as, store } = setup();
    const f = as("staff");
    const reportA = sourceReport("rpt_reuse_consent_notes_check", {
      episodeRef: { connectorId: "file-import", patientId: confirmed.bundle.source.externalPatientId, episodeId: confirmed.bundle.source.externalEpisodeId },
      bundleSnapshot: confirmed.bundle,
    });
    assert.ok(!reportA.activity.some((x) => x.action === CONSENT_RECORDED_ACTION));
    await putReport(f, asFactoryCopy(reportA));
    const before = store.auditLog.length;
    const res = await reuse(f, reportA.id);
    assert.equal(res.status, 200, await res.clone().text());
    const body = StoreReportReuseResponseSchema.parse(await res.json());
    assert.equal(body.source.consentReset, true, "the Studio says consent must be recorded again");
    assert.deepEqual(body.data.bundle.consent, { disclosureConsentRecorded: false }, "no consent (and no date) carried into the other form");
    assert.ok(body.data.dataChecks.some((c) => c.code === "CONSENT_NOT_RECORDED" && c.severity === "blocking"), "approval of the other form is blocked until consent is recorded");
    assert.equal(store.auditLog.slice(before).find((r) => r.action === "notes.reused")?.detail?.consentReset, true);
    // The earlier report keeps its own consent.
    const storedA = await store.getReport(A, reportA.id);
    assert.deepEqual((storedA?.payload as Report).bundleSnapshot.consent, { disclosureConsentRecorded: true, date: "2026-10-05" });

    // The new report from it starts with consent not recorded, and "Record consent" is offered on it.
    const second = createTargetReport({ data: body.data, target: { kind: "form", form: FORM2 }, reusedFrom: body.source });
    assert.equal(second.bundleSnapshot.consent.disclosureConsentRecorded, false);
    assert.equal(canRecordConsent(second), true);
    assert.match(second.activity.find((x) => x.action === NOTES_REUSED_ACTION)?.detail ?? "", /consent to share that report is not carried over: record it on this report before approval\.$/);
  });

  test("consent the uploaded notes showed is not carried over either (the record cannot tell it from consent entered by staff)", async () => {
    resetMemoryLimits();
    const { as } = setup();
    const f = as("a");
    const inNotes = sourceReport("rpt_reuse_consent_in_notes", { bundleSnapshot: { ...UPLOADED, consent: { disclosureConsentRecorded: true, date: "2026-10-01" } } });
    await putReport(f, inNotes);
    const b = StoreReportReuseResponseSchema.parse(await (await reuse(f, inNotes.id)).json());
    assert.equal(b.source.consentReset, true);
    assert.deepEqual(b.data.bundle.consent, { disclosureConsentRecorded: false });
    assert.ok(b.data.dataChecks.some((c) => c.code === "CONSENT_NOT_RECORDED" && c.severity === "blocking"));
  });

  test("a record from a clinic system keeps the consent the clinic system holds (fetching it afresh gives the same)", () => {
    const fromSystem: EpisodeBundle = {
      ...UPLOADED,
      source: { ...UPLOADED.source, connectorId: "tm3", label: "Clinic system" },
      consent: { disclosureConsentRecorded: true, date: "2026-10-01" },
    };
    const kept = recordForAnotherForm({ bundleSnapshot: fromSystem, activity: [] });
    assert.equal(kept.consentReset, false);
    assert.deepEqual(kept.bundle.consent, { disclosureConsentRecorded: true, date: "2026-10-01" });
    // Recorded on the earlier report itself: reset (belt and braces – "Record consent" is offered for uploaded notes only).
    const onReport = recordForAnotherForm({
      bundleSnapshot: fromSystem,
      activity: [{ at: "2026-10-21T10:00:00.000Z", actor: "Sam Ward (fictional)", action: CONSENT_RECORDED_ACTION, detail: "…" }],
    });
    assert.equal(onReport.consentReset, true);
    // No consent recorded at all: nothing to reset (the data check blocks approval anyway).
    const none = recordForAnotherForm({ bundleSnapshot: UPLOADED, activity: [] });
    assert.equal(none.consentReset, false);
    assert.equal(none.bundle, UPLOADED);
  });
});

describe("the new report (Studio) and the wording", () => {
  test("createTargetReport from reused notes: a NEW report id, version 1, never an amendment; the activity says where the notes came from", async () => {
    const source = sourceReport("rpt_reuse_origin", { status: "signed", version: 2, amends: { reportId: "rpt_reuse_v1", version: 1, approvedAt: "2026-10-21T10:00:00.000Z" } });
    const { bundle, consentReset } = recordForAnotherForm(source);
    const now = new Date("2026-10-25T12:00:00.000Z");
    const report = createTargetReport({
      data: { bundle, computedFacts: computeFacts(bundle) },
      target: { kind: "form", form: FORM2 },
      reusedFrom: { formTitle: FORM.title, status: source.status, consentReset },
      now: () => now,
    });
    assert.notEqual(report.id, source.id);
    assert.match(report.id, /^rpt_/);
    assert.equal(report.amends, undefined, "never linked as an amendment");
    assert.equal(report.version, undefined, "version 1");
    assert.equal(report.status, "draft");
    assert.equal(report.receipt, undefined);
    assert.equal(report.form?.formId, FORM2.id);
    assert.equal(report.patientLabel, source.patientLabel);
    assert.deepEqual(report.episodeRef, source.episodeRef, "the same patient and episode");
    assert.deepEqual(report.activity.map((a) => a.action), ["created", NOTES_REUSED_ACTION]);
    assert.equal(report.activity[1].detail, notesReusedDetail({ formTitle: FORM.title, status: "signed", consentReset: false }));
    assert.match(report.activity[1].detail, /already checked for the report on “.+” \(approved\) – the notes were not uploaded again\.$/);
    assert.ok((KNOWN_ACTIVITY_ACTIONS as readonly string[]).includes(NOTES_REUSED_ACTION));
    // Without reusedFrom nothing changes (a fresh upload).
    const fresh = createTargetReport({ data: { bundle, computedFacts: computeFacts(bundle) }, target: { kind: "form", form: FORM2 }, now: () => now });
    assert.deepEqual(fresh.activity.map((a) => a.action), ["created"]);
  });

  test("a report from reused notes is made by the same factory as a new one: it carries this release's report model (W0.6, cross-cutting rule reuse-notes)", () => {
    const source = sourceReport("rpt_reuse_model", { status: "signed" });
    const { bundle, consentReset } = recordForAnotherForm(source);
    const data = { bundle, computedFacts: computeFacts(bundle) };
    const reused = createTargetReport({ data, target: { kind: "form", form: FORM2 }, reusedFrom: { formTitle: FORM.title, status: source.status, consentReset } });
    const fresh = createTargetReport({ data, target: { kind: "form", form: FORM2 } });
    assert.equal(reused.reportModel, REPORT_MODEL);
    assert.equal(fresh.reportModel, REPORT_MODEL);
    assert.equal(reused.approver, undefined, "no approver until WC's picker passes one – the same as a new report");
    assert.equal(fresh.approver, undefined);
  });

  test("recordForAnotherForm is pure: the earlier report is untouched", () => {
    const source = sourceReport("rpt_reuse_pure", {
      bundleSnapshot: { ...UPLOADED, consent: { disclosureConsentRecorded: true, date: "2026-10-21" } },
      activity: [{ at: "2026-10-21T10:00:00.000Z", actor: "Sam Ward (fictional)", action: CONSENT_RECORDED_ACTION, detail: "…" }],
    });
    const copy = JSON.stringify(source);
    const { bundle, consentReset } = recordForAnotherForm(source);
    assert.equal(consentReset, true);
    assert.equal(bundle.consent.disclosureConsentRecorded, false);
    assert.equal(JSON.stringify(source), copy);
    assert.ok(runDataChecks(bundle).some((c) => c.code === "CONSENT_NOT_RECORDED"));
    assert.match(notesReusedDetail({ formTitle: null, status: "draft", consentReset: true }), /an earlier report \(draft\).*record it on this report before approval\.$/);
  });

  test("the clinic's activity page: a label, the Reports group and a counts-only description", () => {
    // Review fix R-correctness-4: written on every read (a reload, Back, or leaving without a form), so it says the
    // notes were opened – it never claims another form was completed (that is the new report's "Report started").
    assert.equal(activityLabel("notes.reused"), "Patient notes opened from an earlier report");
    assert.doesNotMatch(activityLabel("notes.reused"), /another form|completed|reused for/i);
    assert.equal(activityLabel("report.create"), "Report started");
    assert.ok(ACTIVITY_GROUPS.find((g) => g.label === "Reports")?.actions.includes("notes.reused"));
    assert.equal(
      describeActivityDetail("notes.reused", { notes: 8, appointments: 9, outcomeScores: 6, sourceStatus: "signed", sourceVersion: 1, consentReset: true }),
      "8 notes, 9 appointments, 6 outcome scores · from an approved report · consent to be recorded again",
    );
    assert.equal(describeActivityDetail("notes.reused", { notes: 1, appointments: 1, outcomeScores: 0, sourceStatus: "draft", consentReset: false }), "1 note, 1 appointment, 0 outcome scores · from a draft report");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Usage: live drafting (fake client), the host's real counters
 * ----------------------------------------------------------------------------------------------*/

const USAGE = { input_tokens: 4000, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let recordedOutput: unknown = null;
const fakeClient: ClaudeClient = {
  beta: {
    messages: {
      parse: (async () => ({ stop_reason: "end_turn", usage: USAGE, model: "claude-sonnet-5-5", parsed_output: { ok: true, data: recordedOutput, lenient: false } })) as unknown as ClaudeClient["beta"]["messages"]["parse"],
    },
  },
};

describe("usage: a report from reused notes counts as a report of its own – never as an amendment", () => {
  before(async () => {
    overrideClaudeClientForTests(fakeClient);
    // The fake client answers with the recorded answers of the same fictional case (bound to the demo record).
    const demoBundle = { ...getDemoBundle("megan-hart"), tenantId: A };
    const demo = await generateDraftGroup({
      template: formToTemplate(FORM),
      bundle: demoBundle,
      instructingParty: demoBundle.referral,
      sectionKeys: [FIELD],
      computedFacts: computeFacts(demoBundle),
      mode: "demo",
      form: FORM,
    });
    recordedOutput = demo.output;
  });
  after(() => overrideClaudeClientForTests(null));

  test("real handlers, real counters: earlier report 1, new report on another form 2, the same form again 3; no amendment rows", async () => {
    resetMemoryLimits();
    const db = createSqliteTestDb();
    try {
      const { as, deps } = setup({ usage: dbUsageRecorder(() => db.db), actors: { a: CLIN } });
      const f = as("a");
      const month = async () => (await getUsageMonths({ db: db.db }, A, [ukPeriodOf(new Date())]))[0];
      const draft = async (report: Report, form: FormDefinition) => {
        const req = new Request(`${ORIGIN}/api/reports/v1/drafts`, {
          method: "POST",
          headers: { "content-type": CONTENT_TYPES.json, origin: ORIGIN, cookie: "member=a" },
          body: JSON.stringify({
            templateId: formTemplateId(form.id),
            bundle: report.bundleSnapshot,
            instructingParty: report.instructingParty,
            sectionKeys: [FIELD],
            form,
            reportId: report.id,
            // What the Studio sends (generate.ts): "amendsReportId" only for an amended version.
            ...(report.amends ? { amendsReportId: report.amends.reportId } : {}),
            prefer: "live",
          }),
        });
        const res = await bindHandler(handleDrafts, () => deps)(req, { params: {} });
        assert.equal(res.status, 200, await res.clone().text());
      };

      // The earlier report: stored, drafted live, = 1 report.
      const earlier = sourceReport("rpt_reuse_usage_src");
      await putReport(f, earlier);
      await draft(earlier, FORM);
      let m = await month();
      assert.equal(m.billableReports, 1);

      // "Complete another form for this patient": the record from the server, a new report on FORM2.
      const reused = StoreReportReuseResponseSchema.parse(await (await reuse(f, earlier.id)).json());
      const second = createTargetReport({ data: reused.data, target: { kind: "form", form: FORM2 }, reusedFrom: reused.source, approver: approverRef(CLIN) });
      assert.notEqual(second.id, earlier.id);
      assert.equal(second.amends, undefined);
      await putReport(f, second);
      await draft(second, FORM2);
      await draft(second, FORM2); // re-drafting the new report: still one report
      m = await month();
      assert.equal(m.billableReports, 2, "the new report on another form counts on its own");
      assert.equal(m.reportsStarted, 2);
      assert.equal(m.amendmentsApproved, 0);

      // The same form as the earlier report, chosen again from the same notes: a new report too (as a fresh upload).
      const again = StoreReportReuseResponseSchema.parse(await (await reuse(f, earlier.id)).json());
      const third = createTargetReport({ data: again.data, target: { kind: "form", form: FORM }, reusedFrom: again.source, approver: approverRef(CLIN) });
      await putReport(f, third);
      await draft(third, FORM);
      m = await month();
      assert.equal(m.billableReports, 3);

      for (const r of [second, third]) {
        const rows = await listUsageReportRows({ db: db.db }, A, r.id);
        assert.equal(rows.length, 1, r.id);
        assert.equal(rows[0].root_report_id, r.id, "its own root – not an amendment of the earlier report");
        assert.equal(rows[0].billable_via, "drafted");
      }
    } finally {
      await db.close();
    }
  });
});
