/**
 * TESTS ONLY: the integration module's suite – data import (batches, rows, check / import / undo page by page) with
 * the records and diary adapters wired, and the NATIVE connector (bundle by permission, filing back) – on node:sqlite
 * and PGlite (../integration-repos.test.ts) and on D1 through the gateway (workers/data-gateway/test/
 * pms-integration-stack.test.ts). Two clinics: nothing of clinic B is ever readable or changeable from A; every batch
 * state change is audited in its own batch; a re-run imports nothing twice; undo removes only what that import made
 * and keeps anything changed since; the tenant-scope guard over every statement at the end.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import type { RepoContext } from "../../../context";
import { createPractitioner, createService, createSite } from "../../directory";
import { setEntitlement } from "../../entitlements";
import { createCase, createAuthorisation } from "../../cases";
import { countPatients, createPatient, getPatient } from "../../patients";
import { createReferrer } from "../../referrers";
import { createNoteDraft, saveNoteDraft, signNote } from "../../records/notes";
import { recordOutcome } from "../../records/outcomes";
import { getDiaryItem, updateAppointmentDetails } from "../../diary/appointments";
import { templateHeaders, type ImportKind } from "../../../../../modules/pms/integration/import-kinds";
import { suggestMapping } from "../../../../../modules/pms/integration/mapping";
import { toCsv, parseCsv } from "../../../../../modules/pms/integration/csv";
import {
  appendImportRows,
  approveImportBatch,
  createImportBatch,
  finishImportUpload,
  getImportBatch,
  listImportBatches,
  listImportRows,
  setImportMapping,
} from "../import-batches";
import { createFormRequest, latestOpenFormRequest, listFormRequests } from "../form-requests";
import { listFiledForms, readFiledFormFile } from "../filed-forms";
import { runCheckPage, runImportPage, runUndoPage, undoBlocker, type StepProgress } from "../../../../pms/integration/importer";
import { diaryAdapter, recordsAdapter } from "../../../../pms/integration/adapters";
import type { IntegrationPorts } from "../../../../pms/integration/ports";
import { createNativeConnector, type NativeCaller } from "../../../../pms/native-connector";
import type { ConnectorContext } from "../../../../../modules/medreport/connectors/types";
import type { PmsPermission } from "../../../../../modules/pms/core/permissions";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";

export interface IntegrationSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_a", sessionId: "sess_a" };
const OWNER_B = { userId: "user_owner_b", sessionId: "sess_b" };
const PORTS: IntegrationPorts = { records: recordsAdapter, diary: diaryAdapter, billing: null };

/** Fictional patients file (our template's headers). */
export function patientsCsv(count: number, offset = 0): { headers: string[]; rows: string[][] } {
  const headers = templateHeaders("patients");
  const col = (label: string) => headers.indexOf(label);
  const rows: string[][] = [];
  for (let i = 0; i < count; i++) {
    const n = offset + i + 1;
    const r = headers.map(() => "");
    r[col("Patient reference")] = `old-${String(n).padStart(6, "0")}`;
    r[col("First name")] = ["Ava", "Ben", "Cara", "Dev", "Ella", "Finn"][n % 6];
    r[col("Last name")] = `Sample${n}`;
    r[col("Date of birth")] = `${String((n % 28) + 1).padStart(2, "0")}/${String((n % 12) + 1).padStart(2, "0")}/19${50 + (n % 49)}`;
    r[col("Email")] = `patient${n}@example.com`;
    r[col("Mobile phone")] = `07700 900${String(n % 1000).padStart(3, "0")}`;
    r[col("Postcode")] = `ZZ99 ${n % 10}AA`;
    rows.push(r);
  }
  return { headers, rows };
}

/** Upload a file as a batch (parts of `part`), finish the upload with our template's mapping. */
export async function uploadBatch(ctx: RepoContext, tenantId: string, kind: ImportKind, file: { headers: string[]; rows: string[][] }, actor: typeof OWNER, part = 1000): Promise<string> {
  const b = await createImportBatch(ctx, tenantId, { kind, fileName: `${kind}.csv`, delimiter: ",", headers: file.headers, expectedRows: file.rows.length }, actor);
  for (let i = 0; i < file.rows.length; i += part) await appendImportRows(ctx, tenantId, b.id, { firstRowNo: i + 1, rows: file.rows.slice(i, i + part) }, actor);
  assert.equal(await finishImportUpload(ctx, tenantId, b.id, suggestMapping(kind, file.headers), actor), true);
  return b.id;
}

/** Runs a page-by-page step until done. */
export async function untilDone(step: () => Promise<StepProgress>): Promise<StepProgress> {
  for (let i = 0; i < 100_000; i++) {
    const p = await step();
    if (p.done) return p;
  }
  throw new Error("step never finished");
}

export async function checkAndImport(ctx: RepoContext, tenantId: string, batchId: string, actor: typeof OWNER, ports: IntegrationPorts = PORTS, pages?: { check?: number; import?: number }): Promise<StepProgress> {
  await untilDone(() => runCheckPage(ctx, tenantId, batchId, actor, ports, pages?.check));
  const checked = await getImportBatch(ctx, tenantId, batchId);
  assert.ok(checked && checked.status === "checked");
  assert.equal(await approveImportBatch(ctx, tenantId, batchId, checked.rev, actor, { sample: 0, leftOut: 0 }), true);
  return untilDone(() => runImportPage(ctx, tenantId, batchId, actor, ports, pages?.import));
}

function caller(tenantId: string, perms: PmsPermission[], actor = OWNER): NativeCaller {
  return { tenantId, can: (p) => perms.includes(p), siteIds: null, actor };
}

function connectorCtx(tenantId: string): ConnectorContext {
  return { tenantId, credentials: { kind: "none" }, baseUrl: "", fetch: () => Promise.reject(new Error("no HTTP")), trace: [] };
}

function fakePdf(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, "latin1"));
}

export function defineIntegrationSuite(label: string, factory: () => Promise<IntegrationSuiteDb>): void {
  describe(`clinic-system integration module on ${label}`, () => {
    let suite: IntegrationSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-11-02T09:00:00.000Z");
    const now = () => new Date(clock++);
    const ids: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now };
      const at = new Date(clock).toISOString();
      for (const [slug, name] of [
        [A, "Riverside Physiotherapy (fictional)"],
        [B, "Harbour Clinic (fictional)"],
      ]) {
        await ctx.db.insertInto("organization").values({ id: `org_${slug}`, name, slug, logo: null, createdAt: at, metadata: null }).execute();
      }
      await setEntitlement(ctx, A, "clinic", { status: "active" }, OWNER);
      ids.site = (await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE" }, OWNER)).id;
      ids.priya = (await createPractitioner(ctx, A, { displayName: "Priya Shah", registrationNumber: "PH-DEMO-03", defaultSiteId: ids.site }, OWNER)).id;
      ids.fu = (await createService(ctx, A, { name: "Follow-up", durationMinutes: 30 }, OWNER)).id;
      ids.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Bluewell Health (fictional)" }, OWNER)).id;
      ids.gp = (await createReferrer(ctx, A, { kind: "gp", name: "Westgate Surgery (fictional)" }, OWNER)).id;
      ids.emily = (await createPatient(ctx, A, { firstName: "Emily", lastName: "Turner", dateOfBirth: "1982-09-27", email: "emily.turner@example.com" }, OWNER)).id;
      ids.case = (
        await createCase(
          ctx,
          A,
          { patientId: ids.emily, title: "Right shoulder – rotator cuff", openedOn: "2026-10-20", payerType: "insurer", payerReferrerId: ids.insurer, referrerId: ids.gp, practitionerId: ids.priya, membershipNumber: "BWH-883201", referralReason: "Shoulder pain on lifting (fictional)" },
          OWNER,
        )
      ).id;
      await createAuthorisation(ctx, A, { caseId: ids.case, patientId: ids.emily, referrerId: ids.insurer, code: "BW-55021", sessionsAuthorised: 6 } as never, OWNER);
      // One signed note and one draft on the case; an outcome score.
      const signed = await createNoteDraft(ctx, A, { patientId: ids.emily, caseId: ids.case, templateId: "builtin-initial-soap", seenOn: "2026-10-27", practitionerId: ids.priya }, { name: "Priya Shah", registration: "PH-DEMO-03" }, OWNER);
      const saved = await saveNoteDraft(ctx, A, signed.id, signed.rev, { sections: { subjective: "Right shoulder pain for 6 weeks (fictional).", assessment: "Rotator cuff related shoulder pain.", plan: "Isometric loading, home programme." } }, OWNER);
      assert.ok(saved.ok);
      assert.ok((await signNote(ctx, A, signed.id, saved.ok ? saved.rev : 0, { name: "Priya Shah", registration: "PH-DEMO-03" }, OWNER)).ok);
      ids.signedNote = signed.id;
      const draft = await createNoteDraft(ctx, A, { patientId: ids.emily, caseId: ids.case, templateId: "builtin-follow-up-soap", seenOn: "2026-10-30", practitionerId: ids.priya }, { name: "Priya Shah" }, OWNER);
      await saveNoteDraft(ctx, A, draft.id, draft.rev, { sections: { subjective: "DRAFT-ONLY-TEXT" } }, OWNER);
      await recordOutcome(ctx, A, { patientId: ids.emily, caseId: ids.case, measure: "nprs", takenOn: "2026-10-27", answers: { items: { pain: 6 } } }, OWNER);
      ids.siteB = (await createSite(ctx, B, { name: "Harbour (fictional)" }, OWNER_B)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("patients: upload in parts → check (nothing written) → import → a re-run imports nothing twice", async () => {
      const file = patientsCsv(130);
      // Row 5: no name (error); row 6 the same reference as row 1 (duplicate in the file).
      const h = file.headers;
      file.rows[4][h.indexOf("First name")] = "";
      file.rows[4][h.indexOf("Last name")] = "";
      file.rows[5][h.indexOf("Patient reference")] = file.rows[0][h.indexOf("Patient reference")];
      const before = await countPatients(ctx, A, "any");
      const id = await uploadBatch(ctx, A, "patients", file, OWNER, 50);
      await untilDone(() => runCheckPage(ctx, A, id, OWNER, PORTS, 40));
      assert.equal(await countPatients(ctx, A, "any"), before, "the check writes nothing to the records");
      const checked = await getImportBatch(ctx, A, id);
      assert.deepEqual([checked?.status, checked?.counts.ready, checked?.counts.errors, checked?.counts.duplicates], ["checked", 128, 1, 1]);
      assert.equal(await approveImportBatch(ctx, A, id, (checked?.rev ?? 0) + 5, OWNER, { sample: 0, leftOut: 2 }), false, "a stale revision changes nothing");
      assert.equal(await approveImportBatch(ctx, A, id, checked?.rev ?? 0, OWNER, { sample: 0, leftOut: 2 }), true);
      const done = await untilDone(() => runImportPage(ctx, A, id, OWNER, PORTS, 30));
      assert.equal(done.status, "imported");
      assert.equal(done.counts?.imported, 128);
      assert.equal(await countPatients(ctx, A, "any"), before + 128);
      const rows = await listImportRows(ctx, A, id, { statuses: ["imported"], limit: 500 });
      assert.ok(rows.every((r) => r.cells === null), "imported rows' uploaded values are wiped");
      // Audit: one row per state change, written with it.
      const audit = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.targetId === id);
      for (const action of ["pms.import_batch.create", "pms.import_batch.upload", "pms.import_batch.check", "pms.import_batch.approve", "pms.import_batch.commit"]) assert.equal(audit.filter((e) => e.action === action).length, 1, action);
      assert.ok(!JSON.stringify(audit).includes("Sample1"), "no patient data in audit rows");
      // Re-run the same file: every row already in the clinic.
      const again = await uploadBatch(ctx, A, "patients", file, OWNER);
      await untilDone(() => runCheckPage(ctx, A, again, OWNER, PORTS));
      const c2 = await getImportBatch(ctx, A, again);
      assert.equal(c2?.counts.ready, 0, JSON.stringify(c2?.counts));
      assert.equal(c2?.counts.duplicates, 129, JSON.stringify(c2?.counts));
      ids.patientsBatch = id;
    });

    it("tenant scope: clinic B never sees or changes clinic A's imports", async () => {
      assert.equal(await getImportBatch(ctx, B, ids.patientsBatch), null);
      assert.equal((await listImportBatches(ctx, B)).length, 0);
      assert.equal((await listImportRows(ctx, B, ids.patientsBatch, { limit: 10 })).length, 0);
      await assert.rejects(runUndoPage(ctx, B, ids.patientsBatch, OWNER_B, PORTS), /does not exist in this clinic/);
      await assert.rejects(appendImportRows(ctx, B, ids.patientsBatch, { firstRowNo: 999, rows: [["x"]] }, OWNER_B), /does not exist in this clinic/);
    });

    it("appointments through the diary: imported, a clash isolated; undo removes only what it made, keeps a changed one", async () => {
      const headers = templateHeaders("appointments");
      const row = (ref: string, patientRef: string, date: string, time: string) => {
        const r = headers.map(() => "");
        r[headers.indexOf("Appointment reference")] = ref;
        r[headers.indexOf("Patient reference")] = patientRef;
        r[headers.indexOf("Date")] = date;
        r[headers.indexOf("Start time")] = time;
        r[headers.indexOf("Length")] = "30";
        r[headers.indexOf("Practitioner")] = "Priya Shah";
        r[headers.indexOf("Site")] = "Bletchley";
        r[headers.indexOf("Appointment type")] = "Follow-up";
        return r;
      };
      const rows = [row("ap-1", "old-000001", "12/10/2026", "09:00"), row("ap-2", "old-000002", "12/10/2026", "09:30"), row("ap-3", "old-000003", "12/10/2026", "09:00"), row("ap-4", "old-000004", "16/11/2026", "10:00")];
      const id = await uploadBatch(ctx, A, "appointments", { headers, rows }, OWNER);
      const done = await checkAndImport(ctx, A, id, OWNER);
      assert.equal(done.counts?.imported, 3, "the clash with ap-1 is skipped");
      assert.equal(done.counts?.skipped, 1);
      const imported = await listImportRows(ctx, A, id, { statuses: ["imported"], limit: 10 });
      const ap4 = imported.find((r) => r.rowNo === 4);
      assert.ok(ap4?.targetId);
      const item = await getDiaryItem(ctx, A, ap4.targetId);
      assert.deepEqual([item?.status, item?.source], ["booked", "import"], "a future appointment without a status is booked");
      // The patients import cannot be undone while these appointments depend on it.
      assert.match(String(await undoBlocker(ctx, A, (await getImportBatch(ctx, A, ids.patientsBatch))!)), /Undo the cases, appointments/);
      // Someone changes ap-2 after the import: undo keeps it.
      const ap2 = imported.find((r) => r.rowNo === 2)!;
      const changed = await updateAppointmentDetails(ctx, A, ap2.targetId!, 1, { notes: "Changed after the import (fictional)" }, OWNER);
      assert.ok(changed.ok);
      const undone = await untilDone(() => runUndoPage(ctx, A, id, OWNER, PORTS));
      assert.deepEqual([undone.status, undone.counts?.undone, undone.counts?.kept], ["undone", 2, 1]);
      assert.equal(await getDiaryItem(ctx, A, ap4.targetId), null, "removed");
      assert.ok(await getDiaryItem(ctx, A, ap2.targetId!), "kept");
    });

    it("undo of patients: unchanged ones archived and their references released; 7 days only", async () => {
      // A patient changed since the import is kept: give one a case.
      const rows = await listImportRows(ctx, A, ids.patientsBatch, { statuses: ["imported"], limit: 500 });
      const keep = rows[0].targetId!;
      await createCase(ctx, A, { patientId: keep, title: "Case added after the import", openedOn: "2026-11-02" }, OWNER);
      const later: RepoContext = { ...ctx, now: () => new Date(clock + 8 * 86_400_000) };
      assert.match(String(await undoBlocker(later, A, (await getImportBatch(ctx, A, ids.patientsBatch))!)), /undone for 7 days/);
      // The appointments import (undone) kept ap-2, which still belongs to old-000002: that patient is kept too.
      const undone = await untilDone(() => runUndoPage(ctx, A, ids.patientsBatch, OWNER, PORTS, 25));
      assert.equal(undone.status, "undone");
      assert.equal((undone.counts?.undone ?? 0) + (undone.counts?.kept ?? 0), 128);
      assert.ok((undone.counts?.kept ?? 0) >= 1);
      assert.equal((await getPatient(ctx, A, keep))?.status, "active", "kept");
      const gone = rows.find((r) => r.targetId !== keep && r.rowNo > 10)!;
      const archived = await getPatient(ctx, A, gone.targetId!);
      assert.deepEqual([archived?.status, archived?.importRef], ["archived", null]);
      assert.equal((await listAudit(ctx, A, { limit: 2000 })).filter((e) => e.targetId === ids.patientsBatch && e.action === "pms.import_batch.undo").length, 1);
    });

    it("mapping: a remap of a checked import clears the check and needs the current revision", async () => {
      const id = await uploadBatch(ctx, A, "patients", patientsCsv(3, 5000), OWNER);
      await untilDone(() => runCheckPage(ctx, A, id, OWNER, PORTS));
      const b = (await getImportBatch(ctx, A, id))!;
      const stale = await setImportMapping(ctx, A, id, b.rev - 1, b.mapping!, OWNER);
      assert.deepEqual(stale, { ok: false, reason: "conflict" });
      const ok = await setImportMapping(ctx, A, id, b.rev, b.mapping!, OWNER);
      assert.ok(ok.ok);
      const after = (await getImportBatch(ctx, A, id))!;
      assert.equal(after.status, "mapping");
      assert.equal((await listImportRows(ctx, A, id, { statuses: ["staged"], limit: 10 })).length, 3);
      assert.equal((await listAudit(ctx, A, { limit: 2000 })).filter((e) => e.targetId === id && e.action === "pms.import_batch.map").length, 1, "the refused remap wrote no audit row");
    });

    it("native connector: signed notes and outcomes only for clinical members, never drafts; files the approved form back", async () => {
      const deps = (c: NativeCaller | null, entitled = true) => ({ caller: async () => c, repo: () => ctx, ports: () => PORTS, entitled: async () => entitled, now });
      const ref = { patientId: ids.emily, episodeId: ids.case };
      await createFormRequest(ctx, A, { patientId: ids.emily, caseId: ids.case, referrerId: ids.insurer, consentRecorded: true, consentOn: "2026-10-27", formRef: "form_x", formTitle: "Initial assessment report", clinicalPrefill: true }, OWNER);

      const clinical = await createNativeConnector(deps(caller(A, ["patients.view", "clinical.view", "patients.referral"]))).getEpisodeBundle(connectorCtx(A), ref);
      assert.equal(clinical.notes.length, 1, "the signed note only");
      assert.ok(!JSON.stringify(clinical).includes("DRAFT-ONLY-TEXT"), "a draft is never sent");
      assert.match(clinical.notes[0].assessment, /Rotator cuff/);
      assert.equal(clinical.outcomeMeasures[0]?.instrument, "NPRS");
      assert.equal(clinical.referral.authorisationNumber, "BW-55021");
      assert.equal(clinical.referral.insurerName, "Bluewell Health (fictional)");
      assert.equal(clinical.consent.disclosureConsentRecorded, true);
      assert.match(String(clinical.referral.reason), /lifting/);

      const reception = await createNativeConnector(deps(caller(A, ["patients.view"]))).getEpisodeBundle(connectorCtx(A), ref);
      assert.deepEqual([reception.notes.length, reception.outcomeMeasures.length], [0, 0], "no clinical prefill without clinical.view");
      assert.equal(reception.referral.reason, undefined, "no referral reason without patients.referral");

      for (const [c, entitled, why] of [
        [caller(B, ["patients.view", "clinical.view"], OWNER_B), true, "another clinic's member"],
        [null, true, "no member"],
        [caller(A, ["clinical.view"]), true, "no patients.view"],
        [caller(A, ["patients.view", "clinical.view"]), false, "no clinic-system package"],
      ] as const) {
        await assert.rejects(createNativeConnector(deps(c as NativeCaller | null, entitled)).getEpisodeBundle(connectorCtx(A), ref), (e: Error) => e.name === "ConnectorError", why);
      }
      await assert.rejects(createNativeConnector(deps(caller(A, ["patients.view"]))).getEpisodeBundle(connectorCtx(A), { patientId: ids.emily, episodeId: "case_00000000000000000000000000" }), /Open the form again/);

      // Filing back: the approved PDF, with who approved it; the request is marked filed in the same batch.
      const bytes = fakePdf("approved referrer form (fictional)");
      const sha = createHash("sha256").update(bytes).digest("hex");
      const receipt = { reportId: "rpt_test1", tenantId: A, contentSha256: "a".repeat(64), signer: { name: "Priya Shah", hcpc: "PH-DEMO-03" }, signedAt: "2026-11-02T09:30:00.000Z", statementAccepted: true, attestations: [] };
      const connector = createNativeConnector(deps(caller(A, ["patients.view", "clinical.view"])));
      const attach = await connector.attachDocument!(connectorCtx(A), { patientId: ids.emily, episodeId: ids.case, title: "Initial assessment report – Bluewell Health (fictional) (PDF)", fileName: "initial-assessment.pdf", mimeType: "application/pdf", contentBase64: Buffer.from(bytes).toString("base64"), sha256: sha, receipt: receipt as never });
      assert.equal(attach.sha256, sha);
      const filed = await listFiledForms(ctx, A, { caseId: ids.case });
      assert.deepEqual([filed.length, filed[0].signerName, filed[0].signerRegistration, filed[0].signedAt], [1, "Priya Shah", "PH-DEMO-03", "2026-11-02T09:30:00.000Z"]);
      assert.equal((await readFiledFormFile(ctx, A, filed[0].id))?.bytes.length, bytes.length);
      assert.equal(await latestOpenFormRequest(ctx, A, ids.case), null, "the request is filed");
      assert.equal((await listFormRequests(ctx, A, ids.case))[0].filedFormId, filed[0].id);
      // Filing the same approval again adds nothing; another clinic reads nothing.
      await connector.attachDocument!(connectorCtx(A), { patientId: ids.emily, episodeId: ids.case, title: "again", fileName: "initial-assessment.pdf", mimeType: "application/pdf", contentBase64: Buffer.from(bytes).toString("base64"), sha256: sha, receipt: receipt as never });
      assert.equal((await listFiledForms(ctx, A, { caseId: ids.case })).length, 1);
      assert.equal((await listFiledForms(ctx, B, { caseId: ids.case })).length, 0);
      assert.equal(await readFiledFormFile(ctx, B, filed[0].id), null);
      const audit = (await listAudit(ctx, A, { limit: 2000 })).map((e) => e.action);
      for (const a of ["pms.form_request.create", "pms.native.bundle_read", "pms.filed_form.create"]) assert.ok(audit.includes(a), a);
    });

    it("csv round trip of the fixtures (the browser parses what the suite sends)", () => {
      const f = patientsCsv(3);
      const t = parseCsv(toCsv([f.headers, ...f.rows]));
      assert.deepEqual(t.rows, f.rows);
    });

    it("every statement named its clinic (tenant-scope guard)", () => {
      if (!suite.log) return;
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
