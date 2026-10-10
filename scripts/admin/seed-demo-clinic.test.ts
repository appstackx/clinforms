/**
 * The demonstration-clinic seed (src/server/admin/demo-clinic.ts, npm run admin:seed-demo-clinic) on local SQLite and
 * Postgres (PGlite), with FICTIONAL inputs only: the bundled Northfield sample form and its recorded map, a portal
 * question set written here, and answers written here for the fictional patient Rebecca Lane (sim-pat-006) – never the
 * gitignored insurer forms. Covers: refusal without an existing owner account (nothing written), dry run, the clinic +
 * owner + profile, attested maps (valid for the clinic, refused for another), encrypted files and reports that decrypt,
 * validate and pass the real store / fill-preview handlers, the copy text, audit rows under both tenants, idempotency,
 * refreshing the drafts, and the signing check. The import file is checked against the simulated clinic system's
 * bundle; with the local demo assets present, the seeded answers are compared with the local demo's.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

process.env.MEDREPORT_AI_MODE = "demo";

import {
  DEMO_CLINIC,
  DEMO_PATIENT_ID,
  DEMO_SETUP_BY,
  checkSigningSecret,
  draftReportFromRecordedAnswers,
  prepareDemoSeed,
  seedDemoClinic,
  type DemoClinicSeedInput,
} from "../../src/server/admin/demo-clinic";
import { assembleDraft } from "../../src/modules/medreport/ai/assemble";
import { DEMO_CLINIC as PUBLIC_DEMO_CLINIC } from "../../src/modules/medreport/config.public";
import { PLATFORM_USER_ID } from "../../src/server/auth/create-auth";
import { DEMO_DRAFT_FORMAT, type DemoDraftFile } from "../../src/modules/medreport/ai/demo-format";
import { generateDraftGroup } from "../../src/modules/medreport/ai/generate";
import { RECORDED_FORM_ANALYSIS_FORMAT, RecordedFormAnalysisSchema, type RecordedFormAnalysis } from "../../src/modules/medreport/ai/recorded-forms";
import { StoreFormResponseSchema, StoreReportResponseSchema, storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { requireAttestedForm, resolveTemplate } from "../../src/modules/medreport/api/resolve-template";
import { verifyFormConfirmation, withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { buildAnswersCopy, copyFormOf } from "../../src/modules/medreport/core/answer-copy";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { formAnchorKeys, formToTemplate } from "../../src/modules/medreport/core/forms";
import { parsePortalQuestions, questionFields, questionSetFile } from "../../src/modules/medreport/core/question-set";
import { ReportSchema } from "../../src/modules/medreport/core/schemas";
import type { FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { parseImport } from "../../src/modules/medreport/connectors/file-import/parser";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { generateReport } from "../../src/modules/medreport/ui/components/new/generate";
import NORTHFIELD_RECORDED from "../../src/modules/medreport/ai/recorded/forms/northfield-rehab-progress.json";
import { PLATFORM_AUDIT_TENANT } from "../../src/server/admin/platform-console";
import { createPgliteTestDb, createSqliteTestDb, testCipher, type TestDb } from "../../src/server/db/testing/databases";
import type { DataCipher } from "../../src/server/crypto/envelope";
import { listAudit } from "../../src/server/repos/audit";
import { getFormFile, listFormFiles } from "../../src/server/repos/form-files";
import { listForms } from "../../src/server/repos/forms";
import { getReport, listReports } from "../../src/server/repos/reports";
import { member, storeDeps, storeFetch } from "../medreport/store-harness";
import { createTenantStore } from "../../src/server/store/tenant-store";
import { getDemoBundle } from "../medreport/dev-bundles";
import { DEMO_NOTES_FILE_NAME, demoPatientNotesJson } from "./demo-patient-import";

const SECRET = "seed-demo-clinic-test-signing-secret".padEnd(48, "s");
const OWNER = { id: "u-demo-owner", email: "demo.owner@example.com", name: "Sarah Reid" };
const AT = "2026-10-11T09:00:00.000Z";
const NOTICE = "Fictional form used for a test only – not affiliated with anyone. Fictional patient data.";
const TENANT = DEMO_CLINIC.slug;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Recorded-style answers for every drafted question of `form`: notes questions cite N-001, opinions are gaps. */
function answersFor(form: FormDefinition, sampleId: string): DemoDraftFile {
  const anchors = formAnchorKeys(form);
  const fields: DemoDraftFile["fields"] = {};
  const sections: DemoDraftFile["groups"][string]["sections"] = [];
  const gaps: DemoDraftFile["groups"][string]["gaps"] = [];
  for (const f of form.fields) {
    if (f.fillSource.kind !== "notes_narrative" && f.fillSource.kind !== "clinician_opinion") continue;
    fields[f.id] = { anchor: anchors.get(f.id) ?? "", answerType: f.answerType, label: f.label };
    const text = f.answerType === "long_text" || f.answerType === "short_text";
    if (f.fillSource.kind === "notes_narrative" && text) {
      sections.push({ sectionKey: f.id, paragraphs: [{ text: "[CLAIMANT] reported right shoulder pain after lifting a cabin case on 22/08/2026.", sourceIds: ["N-001"], basis: "patient_reported" }] });
    } else {
      sections.push({ sectionKey: f.id, paragraphs: [] });
      gaps.push({ sectionKey: f.id, issue: "No clinician recorded this in the notes.", suggestedQuestion: "What is your view?", relatedNoteIds: [] });
    }
  }
  return {
    format: DEMO_DRAFT_FORMAT,
    formatVersion: 1,
    patientId: DEMO_PATIENT_ID,
    templateId: `form:${form.id}`,
    templateVersion: "1",
    sampleId,
    formSha256: form.file.sha256,
    fields,
    mode: "demo_prewritten",
    promptVersion: "test",
    groups: { all: { sections, gaps } },
  };
}

async function fictionalInputs(): Promise<Omit<DemoClinicSeedInput, "ownerEmail">> {
  const sample = getSampleForm("northfield-rehab-progress");
  assert.ok(sample);
  const bytes = await sample.loadFile();
  const northfield = RecordedFormAnalysisSchema.parse(NORTHFIELD_RECORDED);
  assert.equal(northfield.fileSha256, sha256(bytes));
  const mapA: RecordedFormAnalysis = { ...northfield, sampleId: "test-northfield", form: { ...northfield.form, sampleId: "test-northfield", demoNotice: NOTICE } };

  const parsed = parsePortalQuestions("Treatment progress\nDate of initial assessment\nSummary of progress so far\nPrognosis");
  assert.deepEqual(parsed.errors, []);
  const fields = questionFields(parsed.questions);
  const file = await questionSetFile(fields);
  const portal: FormDefinition = {
    id: "form_test_portal",
    tenantId: "demo",
    referrer: { name: "Example insurer portal (fictional)", type: "insurer" },
    title: "Example portal questions (fictional test)",
    file,
    kind: "questions",
    fields,
    status: "proposed",
    analysis: { mode: "rules", promptVersion: "questions-1", at: AT, warnings: [] },
    createdAt: AT,
    updatedAt: AT,
    sampleId: "test-portal",
    demoNotice: NOTICE,
  };
  const mapB: RecordedFormAnalysis = {
    format: RECORDED_FORM_ANALYSIS_FORMAT,
    formatVersion: 1,
    sampleId: "test-portal",
    fileSha256: file.sha256,
    fileName: file.fileName,
    mode: "demo_prewritten",
    recordedAt: AT,
    promptVersion: "questions-1",
    form: portal,
    outlineSummary: { kind: "questions", answerSpaces: fields.length, headings: ["Treatment progress"], warnings: [] },
  };
  return {
    maps: [
      { name: "test-northfield.json", data: mapA },
      { name: "test-portal.json", data: mapB },
    ],
    files: [{ fileName: "northfield-rehab-progress.pdf", bytes }],
    drafts: [
      { name: `${DEMO_PATIENT_ID}__form-test-northfield.json`, data: answersFor(mapA.form, "test-northfield") },
      { name: `${DEMO_PATIENT_ID}__form-test-portal.json`, data: answersFor(portal, "test-portal") },
    ],
    notes: { fileName: DEMO_NOTES_FILE_NAME, content: demoPatientNotesJson() },
  };
}

async function countRows(db: TestDb["db"]) {
  const n = async (table: "organization" | "member" | "user" | "invitation" | "forms" | "reports" | "form_files" | "audit_log" | "clinic_profile") =>
    Number((await db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow()).n);
  // The platform's own user ("ClinForms", no password: cannot sign in) is the author of platform audit rows.
  const people = Number((await db.selectFrom("user").select((eb) => eb.fn.countAll<number>().as("n")).where("id", "!=", PLATFORM_USER_ID).executeTakeFirstOrThrow()).n);
  return {
    organization: await n("organization"),
    member: await n("member"),
    user: people,
    invitation: await n("invitation"),
    forms: await n("forms"),
    reports: await n("reports"),
    files: await n("form_files"),
    audit: await n("audit_log"),
    profiles: await n("clinic_profile"),
  };
}

function defineSuite(label: string, factory: () => Promise<TestDb> | TestDb): void {
  describe(`demonstration clinic seed on ${label}`, () => {
    let testDb: TestDb;
    let cipher: DataCipher;
    let inputs: Omit<DemoClinicSeedInput, "ownerEmail">;
    let previousSecret: string | undefined;

    before(async () => {
      previousSecret = process.env.MEDREPORT_SIGNING_SECRET;
      process.env.MEDREPORT_SIGNING_SECRET = SECRET;
      testDb = await factory();
      cipher = testCipher();
      inputs = await fictionalInputs();
    });
    after(async () => {
      if (previousSecret === undefined) delete process.env.MEDREPORT_SIGNING_SECRET;
      else process.env.MEDREPORT_SIGNING_SECRET = previousSecret;
      await testDb?.close();
    });

    it("refuses when the owner has no account, and writes nothing (never creates an account)", async () => {
      const before = await countRows(testDb.db);
      await assert.rejects(seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: OWNER.email, confirm: true }), /No account with that email address/);
      assert.deepEqual(await countRows(testDb.db), before);
    });

    it("dry run: plans the clinic, forms and reports, and writes nothing", async () => {
      await testDb.db
        .insertInto("user")
        .values({ id: OWNER.id, name: OWNER.name, email: OWNER.email, emailVerified: true, image: null, createdAt: AT, updatedAt: AT, twoFactorEnabled: true })
        .execute();
      const before = await countRows(testDb.db);
      const result = await seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: OWNER.email });
      assert.equal(result.dryRun, true);
      assert.deepEqual(await countRows(testDb.db), before);
      assert.deepEqual(
        result.steps.map((s) => `${s.kind}:${s.status}`),
        ["clinic:create", "owner:create", "file:create", "form:create", "form:create", "report:create", "report:create"],
      );
      assert.equal(result.reports.length, 2);
    });

    it("creates the fictional clinic with the existing account as owner, attested maps, files and draft reports", async () => {
      const before = await countRows(testDb.db);
      const result = await seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: OWNER.email.toUpperCase(), confirm: true });
      assert.equal(result.dryRun, false);
      const after = await countRows(testDb.db);
      assert.equal(after.user, before.user, "no account created");
      assert.equal(after.invitation, before.invitation, "no invitation");
      assert.deepEqual([after.organization, after.member, after.profiles, after.forms, after.files, after.reports], [1, 1, 1, 2, 1, 2]);

      const org = await testDb.db.selectFrom("organization").selectAll().where("slug", "=", TENANT).executeTakeFirstOrThrow();
      assert.equal(org.name, "Riverside Physiotherapy (fictional)");
      const owner = await testDb.db.selectFrom("member").selectAll().where("organizationId", "=", org.id).executeTakeFirstOrThrow();
      assert.deepEqual([owner.userId, owner.role], [OWNER.id, "owner"]);
      const profile = await testDb.db.selectFrom("clinic_profile").selectAll().where("tenant_id", "=", TENANT).executeTakeFirstOrThrow();
      assert.equal(Number(profile.retention_days), 30);
      assert.equal(Number(profile.drafting_enabled), 1);
      assert.match(profile.phone ?? "", /^01632 960 ?\d{3}$/, "Ofcom drama range");
      assert.equal(profile.email, "clinic@example.com");
      assert.ok(JSON.parse(profile.address_json ?? "[]").some((l: string) => /\(fictional\)/.test(l)));

      // Maps: confirmed by the set-up, attested for this clinic only; the footer kept.
      const ctx = { db: testDb.db, cipher };
      const forms = (await listForms<FormDefinition>(ctx, TENANT)).map((f) => f.payload);
      assert.equal(forms.length, 2);
      for (const form of forms) {
        assert.equal(form.status, "confirmed");
        assert.equal(form.tenantId, TENANT);
        assert.equal(form.confirmed?.by, DEMO_SETUP_BY);
        assert.equal(form.demoNotice, NOTICE);
        assert.deepEqual(verifyFormConfirmation(form, { tenantId: TENANT }), { ok: true, mapSha256: form.confirmed?.mapSha256 });
        assert.equal(requireAttestedForm(form, TENANT), null);
        assert.deepEqual(verifyFormConfirmation(form, { tenantId: "other-clinic" }), { ok: false, reason: "TENANT_MISMATCH" });
        assert.deepEqual(verifyFormConfirmation({ ...form, tenantId: "other-clinic" }, { tenantId: "other-clinic" }), { ok: false, reason: "BAD_MAC" });
      }
      // A secret other than the environment's does not verify.
      process.env.MEDREPORT_SIGNING_SECRET = "another-environment-secret".padEnd(48, "x");
      assert.equal(verifyFormConfirmation(forms[0], { tenantId: TENANT }).ok, false);
      process.env.MEDREPORT_SIGNING_SECRET = SECRET;

      // The form file: encrypted in chunks, neutral stored name, decrypts to the same bytes.
      const files = await listFormFiles(ctx, TENANT);
      assert.deepEqual(files.map((f) => f.fileName), ["form.pdf"]);
      const stored = await getFormFile(ctx, TENANT, files[0].sha256);
      assert.equal(sha256(new Uint8Array(stored?.bytes ?? [])), files[0].sha256);

      // Reports: drafts (rev 1) that decrypt, parse, validate and point at their attested map.
      const metas = await listReports(ctx, TENANT, { withPayload: false });
      assert.equal(metas.length, 2);
      for (const meta of metas) {
        assert.deepEqual([meta.rev, meta.status], [1, "draft"]);
        const row = await testDb.db.selectFrom("reports").select("payload_enc").where("tenant_id", "=", TENANT).where("id", "=", meta.id).executeTakeFirstOrThrow();
        assert.ok(!row.payload_enc.includes("Rebecca"), "encrypted at rest");
        const report = ReportSchema.parse((await getReport(ctx, TENANT, meta.id))?.payload) as Report;
        const form = forms.find((f) => f.id === report.form?.formId);
        assert.ok(form, "the report's form is in the clinic's library");
        assert.equal(report.tenantId, TENANT);
        assert.equal(report.status, "draft");
        assert.equal(report.author, undefined, "no author: the review offers 'Write in my own voice' to the clinician");
        assert.equal(report.episodeRef.connectorId, "file-import");
        assert.equal(report.episodeRef.patientId, DEMO_PATIENT_ID);
        assert.equal(report.bundleSnapshot.clinic?.name, "Riverside Physiotherapy (fictional)");
        assert.equal(report.bundleSnapshot.referral.membershipNumber, "DEMO-POL-0001", "the insurer's numbers came through the import");
        assert.ok(report.generation.length > 0 && report.generation.every((g) => g.model === undefined || g.model === "drafting-service"));
        const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
        assert.ok(resolved.ok);
        const validation = validateReport(report, formToTemplate(form));
        assert.deepEqual(report.flags.map((f) => f.code).sort(), validation.flags.map((f) => f.code).sort());
        const drafted = report.sections.filter((s) => s.paragraphs.some((p) => p.origin === "ai"));
        if (form.kind !== "questions") assert.ok(drafted.length > 0, "recorded answers applied");
        const copy = buildAnswersCopy({ report, form: copyFormOf(form) });
        assert.ok(copy.text.includes("Rebecca Lane"));
      }

      // Audit: under the clinic as the app writes it, and under the platform; ids and counts only.
      const clinicAudit = await listAudit(ctx, TENANT, { limit: 100 });
      const actions = clinicAudit.map((e) => e.action);
      for (const a of ["clinic.create", "member.add", "file.upload", "form.create", "form.confirm", "notes.imported", "report.create"]) assert.ok(actions.includes(a), a);
      const platform = (await listAudit(ctx, PLATFORM_AUDIT_TENANT, { limit: 100 })).map((e) => e.action);
      for (const a of ["platform.clinic_create", "platform.member_add", "platform.demo_forms_seed", "platform.demo_reports_seed"]) assert.ok(platform.includes(a), a);
      const all = JSON.stringify(await testDb.db.selectFrom("audit_log").selectAll().execute());
      for (const word of ["Rebecca", "Lane", "northfield-rehab-progress.pdf", "DEMO-POL"]) assert.ok(!all.includes(word), word);
    });

    it("the stored reports pass the server's checks: opened, form map read, previewed from the stored file", async () => {
      const ctx = { db: testDb.db, cipher };
      const deps = storeDeps(createTenantStore(() => ctx), { me: member(TENANT, { userId: OWNER.id, role: "owner" }), other: member("other-clinic") });
      const me = storeFetch(deps, { member: "me" });
      const other = storeFetch(deps, { member: "other" });
      const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      for (const meta of await listReports(ctx, TENANT, { withPayload: false })) {
        const res = await me(storeApiPaths.report(meta.id));
        assert.equal(res.status, 200, await res.clone().text());
        const { report } = StoreReportResponseSchema.parse(await res.json());
        const formRes = await me(storeApiPaths.form(report.form?.formId ?? ""));
        assert.equal(formRes.status, 200);
        const { form } = StoreFormResponseSchema.parse(await formRes.json());
        assert.equal(form.status, "confirmed", "the store keeps the attested confirmation");
        const preview = await me("/api/reports/v1/forms/fill-preview", post({ report, form, mode: "draft" }));
        assert.equal(preview.status, 200, await preview.clone().text());
        assert.equal(preview.headers.get("content-type"), "application/pdf");
        assert.equal(preview.headers.get("x-medreport-render"), "draft");
        assert.equal((await other(storeApiPaths.report(meta.id))).status, 404, "another clinic never sees it");
        assert.equal((await other("/api/reports/v1/forms/fill-preview", post({ report, form, mode: "draft" }))).status, 403);
      }
    });

    it("is idempotent: a second run keeps everything and writes nothing", async () => {
      const before = await countRows(testDb.db);
      const result = await seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: OWNER.email, confirm: true });
      assert.ok(result.steps.every((s) => s.status === "keep"), JSON.stringify(result.steps));
      assert.deepEqual(await countRows(testDb.db), before);
    });

    it("--refresh-reports replaces this patient's drafts (audited) and keeps the rest", async () => {
      const ctx = { db: testDb.db, cipher };
      const ids = (await listReports(ctx, TENANT, { withPayload: false })).map((r) => r.id).sort();
      const result = await seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: OWNER.email, confirm: true, refreshReports: true });
      assert.equal(result.steps.filter((s) => s.kind === "report" && s.status === "delete").length, 2);
      const now = (await listReports(ctx, TENANT, { withPayload: false })).map((r) => r.id).sort();
      assert.equal(now.length, 2);
      assert.ok(now.every((id) => !ids.includes(id)));
      const actions = (await listAudit(ctx, TENANT, { limit: 200 })).map((e) => e.action);
      assert.equal(actions.filter((a) => a === "report.delete").length, 2);
      assert.equal((await countRows(testDb.db)).forms, 2);
    });

    it("refuses a clinic id held by another clinic, and an account that is already a member with another role", async () => {
      await assert.rejects(
        seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: OWNER.email, clinic: { slug: TENANT, name: "Another clinic (fictional)" } }),
        /exists under another name/,
      );
      await testDb.db
        .insertInto("user")
        .values({ id: "u-staff", name: "Sam Staff", email: "staff@example.com", emailVerified: true, image: null, createdAt: AT, updatedAt: AT, twoFactorEnabled: true })
        .execute();
      const org = await testDb.db.selectFrom("organization").select("id").where("slug", "=", TENANT).executeTakeFirstOrThrow();
      await testDb.db.insertInto("member").values({ id: "m-staff", organizationId: org.id, userId: "u-staff", role: "staff", createdAt: AT }).execute();
      await assert.rejects(seedDemoClinic(testDb.db, cipher, { ...inputs, ownerEmail: "staff@example.com" }), /already a member/);
      assert.throws(() => prepareDemoSeed({ ...inputs, ownerEmail: OWNER.email, clinic: { name: "Riverside Physiotherapy" } }), /\(fictional\)/);
    });
  });
}

defineSuite("SQLite (node:sqlite)", () => createSqliteTestDb());
defineSuite("Postgres (PGlite)", () => createPgliteTestDb());

describe("the demonstration patient's import file", () => {
  it("is the documented JSON format and imports to the simulated clinic system's record (insurer numbers and charges included)", () => {
    const content = demoPatientNotesJson();
    const doc = JSON.parse(content);
    assert.equal(doc.format, "appstackx-reports.import");
    assert.equal(doc.version, 1);
    const imported = parseImport({ format: "json", content, fileName: DEMO_NOTES_FILE_NAME }, { tenantId: "demo", now: new Date(AT) });
    assert.ok(imported.ok, JSON.stringify(!imported.ok && imported.issues));
    const fromImport = imported.bundle;
    const fromSim = getDemoBundle("rebecca-lane");
    assert.equal(fromImport.source.connectorId, "file-import");
    assert.equal(fromImport.source.label, DEMO_NOTES_FILE_NAME);
    assert.deepEqual(fromImport.notes, fromSim.notes);
    assert.deepEqual(fromImport.appointments, fromSim.appointments);
    assert.deepEqual(fromImport.outcomeMeasures, fromSim.outcomeMeasures);
    assert.deepEqual(fromImport.referral, fromSim.referral);
    assert.deepEqual(fromImport.incident, fromSim.incident);
    assert.deepEqual(fromImport.consent, fromSim.consent);
    assert.deepEqual(fromImport.clinicians, fromSim.clinicians);
    assert.deepEqual(fromImport.episodeStatus, fromSim.episodeStatus);
    const { registeredAt: _a, ...regImport } = fromImport.registration as typeof fromImport.registration & { registeredAt?: string };
    const { registeredAt: _b, ...regSim } = fromSim.registration as typeof fromSim.registration & { registeredAt?: string };
    void _a;
    void _b;
    assert.deepEqual(regImport, regSim);
    assert.equal(fromImport.referral.membershipNumber, "DEMO-POL-0001");
    assert.ok(fromImport.appointments.some((a) => a.charge?.amount === 70 && a.charge.paid));
  });
});

describe("signing check against a running app", () => {
  it("MATCH with the same secret, MISMATCH with another, UNKNOWN without attested samples", async () => {
    const previous = process.env.MEDREPORT_SIGNING_SECRET;
    process.env.MEDREPORT_SIGNING_SECRET = SECRET;
    try {
      const inputs = await fictionalInputs();
      const map = RecordedFormAnalysisSchema.parse(inputs.maps[0].data);
      const attested = withAttestedConfirmation({ ...map.form, tenantId: "demo" }, "Prepared", AT);
      const serve = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
      assert.deepEqual(await checkSigningSecret("https://app.example", serve({ samples: [{ form: attested }] })), { result: "match" });
      process.env.MEDREPORT_SIGNING_SECRET = "the-deployment-uses-another-secret".padEnd(48, "y");
      assert.deepEqual(await checkSigningSecret("https://app.example", serve({ samples: [{ form: attested }] })), { result: "mismatch" });
      assert.equal((await checkSigningSecret("https://app.example", serve({ samples: [] }))).result, "unknown");
      assert.equal((await checkSigningSecret("http://app.example", serve({ samples: [{ form: attested }] }))).result, "unknown", "https only off localhost");
    } finally {
      if (previous === undefined) delete process.env.MEDREPORT_SIGNING_SECRET;
      else process.env.MEDREPORT_SIGNING_SECRET = previous;
    }
  });
});

/**
 * With the local demo assets (gitignored; MEDREPORT_DEMO_ASSETS_DIR or ../../demo-assets/insurers next to the main
 * checkout), the seeded reports carry exactly the local demo's answers: the same recorded answers through the same
 * generate path, from the simulated clinic system's record there and from the clinic import here.
 */
const ASSETS = (() => {
  const candidates = [
    process.env.MEDREPORT_DEMO_ASSETS_DIR,
    path.resolve(__dirname, "../../demo-assets/insurers"),
    path.resolve(__dirname, "../../../../clinforms/demo-assets/insurers"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(path.join(p, "maps")) && fs.existsSync(path.join(p, "drafts"))) ?? null;
})();

describe("the seeded answers equal the local demo's (local demo assets only)", { skip: ASSETS ? false : "no local demo assets" }, () => {
  it("every form with recorded answers: same answers, sources, gaps and flags", async () => {
    const dir = ASSETS as string;
    const previousDir = process.env.MEDREPORT_DEMO_ASSETS_DIR;
    const previousSecret = process.env.MEDREPORT_SIGNING_SECRET;
    process.env.MEDREPORT_DEMO_ASSETS_DIR = dir;
    process.env.MEDREPORT_SIGNING_SECRET = SECRET;
    try {
      const read = (sub: string) =>
        fs.readdirSync(path.join(dir, sub)).filter((n) => n.endsWith(".json")).sort().map((name) => ({ name, data: JSON.parse(fs.readFileSync(path.join(dir, sub, name), "utf8")) as unknown }));
      const files = fs.readdirSync(dir).filter((n) => /\.(pdf|docx)$/i.test(n)).map((fileName) => ({ fileName, bytes: new Uint8Array(fs.readFileSync(path.join(dir, fileName))) }));
      const prepared = prepareDemoSeed({ ownerEmail: OWNER.email, maps: read("maps"), files, drafts: read("drafts"), notes: { fileName: DEMO_NOTES_FILE_NAME, content: demoPatientNotesJson() } });
      const now = () => new Date(AT);
      const simBundle = getDemoBundle("rebecca-lane");
      let compared = 0;
      for (const p of prepared.forms.filter((f) => f.draft)) {
        // The local demo: the simulated clinic system's record, the map confirmed for the demo, POST /drafts in demo mode.
        const demoForm = withAttestedConfirmation({ ...p.analysis.form, tenantId: "demo", sampleId: p.sampleId, demoNotice: p.analysis.form.demoNotice }, "Demo", AT);
        const template = formToTemplate(demoForm);
        const demo = await generateReport({
          client: {
            async drafts(body) {
              const result = await generateDraftGroup({ template, bundle: body.bundle, instructingParty: body.instructingParty, sectionKeys: body.sectionKeys, computedFacts: computeFacts(body.bundle), mode: "demo", form: demoForm });
              const res = assembleDraft({ template, bundle: body.bundle, instructingParty: body.instructingParty, sectionKeys: body.sectionKeys, computedFacts: computeFacts(body.bundle), output: result.output, meta: result.meta, form: demoForm });
              return res;
            },
            async validate(body) {
              const v = validateReport(body.report, template);
              return { flags: v.flags, canSign: v.canSign, blocking: v.blocking };
            },
          },
          data: { bundle: simBundle, computedFacts: computeFacts(simBundle) },
          target: { kind: "form", form: demoForm },
          author: null,
          concurrency: 1,
          now,
        });
        // The seed: the clinic import, the clinic's own attested map – with the local demo's clinic details for an exact
        // comparison (the seeded clinic's profile differs only in its email address, clinic@example.com).
        const clinicForm = { ...demoForm, tenantId: TENANT };
        const clinic = { name: PUBLIC_DEMO_CLINIC.name, addressLines: [...PUBLIC_DEMO_CLINIC.addressLines], phone: PUBLIC_DEMO_CLINIC.phone, email: PUBLIC_DEMO_CLINIC.email };
        const bundle = { ...prepared.bundle, tenantId: TENANT, clinic };
        const seeded = await draftReportFromRecordedAnswers({ bundle, computedFacts: computeFacts(bundle) }, clinicForm, p.draft as DemoDraftFile, now);
        assert.equal(demo.failedGroups, 0, `${p.sampleId}: the local demo drafts every group`);
        assert.equal(seeded.failedGroups, 0, `${p.sampleId}: the seed drafts every group`);
        const shape = (r: Report) => ({
          sections: r.sections.map((s) => ({ key: s.key, status: s.status, answer: s.answer, paragraphs: s.paragraphs.map((x) => ({ text: x.text, sourceIds: x.sourceIds, origin: x.origin })) })),
          gaps: r.gaps.map((g) => ({ key: g.sectionKey, issue: g.issue })),
          flags: r.flags.map((f) => `${f.code}:${f.sectionKey ?? ""}:${f.severity}`).sort(),
        });
        assert.deepEqual(shape(seeded.report), shape(demo.report), p.sampleId);
        compared += 1;
      }
      assert.ok(compared >= 1);
    } finally {
      if (previousDir === undefined) delete process.env.MEDREPORT_DEMO_ASSETS_DIR;
      else process.env.MEDREPORT_DEMO_ASSETS_DIR = previousDir;
      if (previousSecret === undefined) delete process.env.MEDREPORT_SIGNING_SECRET;
      else process.env.MEDREPORT_SIGNING_SECRET = previousSecret;
    }
  });
});
