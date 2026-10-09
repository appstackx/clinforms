/**
 * The Studio's clinic storage end to end on the real database layer: the /store/** handlers → the host's
 * TenantStore (src/server/store/tenant-store.ts) → the encrypted repositories, on local SQLite and Postgres
 * (PGlite). Revisions and 409s, encryption at rest, tenant isolation, chunked uploads (resume, damage), the
 * form file read back by /forms/fill-preview, and audit rows.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

process.env.MEDREPORT_AI_MODE = "demo";

import { withAttestedConfirmation } from "../../modules/medreport/auth/attestations";
import { STORE_FILE_CHUNK_BYTES, StoreConflictSchema, StoreFormResponseSchema, StoreReportResponseSchema, storeApiPaths } from "../../modules/medreport/api/store-contract";
import type { FormDefinition, Report } from "../../modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../modules/medreport/forms/samples/maps/harrow-pike";
import { getSampleForm } from "../../modules/medreport/forms/samples/registry";
import { completedSampleReport } from "../../../scripts/medreport/form-sample-answers";
import { member, storeDeps, storeFetch } from "../../../scripts/medreport/store-harness";
import { createPgliteTestDb, createSqliteTestDb, testCipher, type TestDb } from "../db/testing/databases";
import { listAudit } from "../repos/audit";
import type { RepoContext } from "../repos/context";
import { getFormFile, getFormFileMeta } from "../repos/form-files";
import { createTenantStore } from "./tenant-store";

const A = "clinic-a";
const B = "clinic-b";

function fakePdf(size: number): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.alloc(size, 0x62);
  Buffer.from("%PDF-1.4\n%").copy(bytes, 0);
  for (let i = 80; i < size; i += 80) bytes[i] = 0x0a;
  Buffer.from("\n%%EOF\n").copy(bytes, size - 7);
  return new Uint8Array(bytes);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const put = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function defineSuite(label: string, factory: () => Promise<TestDb> | TestDb): void {
  describe(`clinic storage handlers on ${label}`, () => {
    let testDb: TestDb;
    let ctx: RepoContext;
    let a: typeof fetch;
    let b: typeof fetch;

    before(async () => {
      testDb = await factory();
      ctx = { db: testDb.db, cipher: testCipher() };
      const deps = storeDeps(createTenantStore(() => ctx), { a: member(A), b: member(B) });
      a = storeFetch(deps, { member: "a" });
      b = storeFetch(deps, { member: "b" });
    });
    after(async () => {
      await testDb?.close();
    });

    it("reports: revisions, 409 with the stored copy, encrypted at rest, isolated, audited", async () => {
      const report: Report = { ...completedSampleReport("megan-hart", { ...HARROW_PIKE_RAW, tenantId: A }, { id: "rpt_db" }), tenantId: A };
      const created = await a(storeApiPaths.report(report.id), put({ report }));
      assert.equal(created.status, 201, await created.clone().text());
      const edited = { ...report, patientLabel: "Megan Hart (edited)", updatedAt: "2026-10-09T12:00:00.000Z" };
      assert.equal((await a(storeApiPaths.report(report.id), put({ report: edited }, { "if-match": '"1"' }))).status, 200);
      const stale = await a(storeApiPaths.report(report.id), put({ report }, { "if-match": '"1"' }));
      assert.equal(stale.status, 409);
      const conflict = StoreConflictSchema.parse(await stale.json());
      assert.equal(conflict.current?.rev, 2);
      assert.equal(conflict.current?.report?.patientLabel, "Megan Hart (edited)");

      const row = await ctx.db.selectFrom("reports").select(["payload_enc", "rev", "status", "form_id"]).where("tenant_id", "=", A).where("id", "=", report.id).executeTakeFirstOrThrow();
      assert.equal(Number(row.rev), 2);
      assert.equal(row.form_id, HARROW_PIKE_RAW.id);
      assert.ok(!row.payload_enc.includes("Megan"), "patient data is encrypted at rest");

      assert.equal((await b(storeApiPaths.report(report.id))).status, 404);
      const got = StoreReportResponseSchema.parse(await (await a(storeApiPaths.report(report.id))).json());
      assert.equal(got.report.patientLabel, "Megan Hart (edited)");

      const audit = await listAudit(ctx, A);
      assert.deepEqual(audit.map((e) => e.action).reverse(), ["report.create", "report.update"]);
      assert.ok(audit.every((e) => e.userId === `user-${A}` && e.targetId === report.id));
      assert.ok(!JSON.stringify(audit).includes("Megan"));
    });

    it("forms: an unattested confirmation is stored as proposed; an attested one stays confirmed", async () => {
      const claimed: FormDefinition = { ...HARROW_PIKE_RAW, tenantId: A, status: "confirmed", confirmed: { by: "x", at: "2026-10-01T09:00:00.000Z" } };
      const first = StoreFormResponseSchema.parse(await (await a(storeApiPaths.form(claimed.id), put({ form: claimed }))).json());
      assert.equal(first.form.status, "proposed");
      const attested = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: A }, "Practice manager", "2026-10-09T09:00:00.000Z");
      const second = StoreFormResponseSchema.parse(await (await a(storeApiPaths.form(attested.id), put({ form: attested }, { "if-match": '"1"' }))).json());
      assert.equal(second.form.status, "confirmed");
      const meta = await ctx.db.selectFrom("forms").select(["status", "rev"]).where("tenant_id", "=", A).where("id", "=", attested.id).executeTakeFirstOrThrow();
      assert.deepEqual([meta.status, Number(meta.rev)], ["confirmed", 2]);
    });

    it("files: chunked upload with resume and a damaged attempt; read back through the repository and the fill preview", async () => {
      const bytes = fakePdf(STORE_FILE_CHUNK_BYTES * 2 + 500);
      const sha = sha256(bytes);
      const size = bytes.byteLength;
      const meta = { size, name: "Insurer.pdf", mime: "application/pdf" };
      const part = (i: number) => bytes.slice(i * STORE_FILE_CHUNK_BYTES, Math.min(size, (i + 1) * STORE_FILE_CHUNK_BYTES));
      const chunk = (i: number, body: Uint8Array<ArrayBuffer>) => a(storeApiPaths.fileChunk(sha, i, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body });

      assert.equal((await a(storeApiPaths.files(), postJson({ sha256: sha, ...meta }))).status, 200);
      // A damaged attempt: refused and thrown away.
      const bad = part(1);
      bad[10] ^= 0xff;
      for (const [i, body] of [[0, part(0)], [1, bad], [2, part(2)]] as const) assert.equal((await chunk(i, body)).status, 200);
      const corrupt = await a(storeApiPaths.fileComplete(sha), postJson(meta));
      assert.equal(corrupt.status, 422);
      assert.equal((await corrupt.json()).code, "UPLOAD_CORRUPT");
      const n = await ctx.db.selectFrom("form_file_chunks").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", A).where("sha256", "=", sha).executeTakeFirstOrThrow();
      assert.equal(Number(n.n), 0);
      assert.equal(await getFormFileMeta(ctx, A, sha), null, "the damaged upload was thrown away");

      // Upload again, interrupted after chunk 0, then resumed.
      assert.equal((await a(storeApiPaths.files(), postJson({ sha256: sha, ...meta }))).status, 200);
      assert.equal((await chunk(0, part(0))).status, 200);
      const resume = await (await a(storeApiPaths.files(), postJson({ sha256: sha, ...meta }))).json();
      assert.deepEqual(resume.present, [0]);
      assert.equal((await chunk(1, part(1))).status, 200);
      assert.equal((await chunk(2, part(2))).status, 200);
      const done = await a(storeApiPaths.fileComplete(sha), postJson(meta));
      assert.equal(done.status, 200, await done.clone().text());
      const stored = await getFormFile(ctx, A, sha);
      assert.ok(stored && Buffer.compare(stored.bytes, Buffer.from(bytes)) === 0);
      assert.equal(await getFormFile(ctx, B, sha), null);
      const download = await a(storeApiPaths.file(sha));
      assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
      assert.equal((await b(storeApiPaths.file(sha))).status, 404);

      // A Word form stored by the clinic fills without the browser sending it.
      const docx = await getSampleForm(HARROW_PIKE_RAW.sampleId ?? "")!.loadFile();
      const docxSha = sha256(docx);
      assert.equal((await a(storeApiPaths.files(), postJson({ sha256: docxSha, size: docx.byteLength, name: "harrow.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).status, 200);
      assert.equal((await a(storeApiPaths.fileChunk(docxSha, 0, docx.byteLength), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(docx) })).status, 200);
      const docxDone = await a(storeApiPaths.fileComplete(docxSha), postJson({ size: docx.byteLength, name: "harrow.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      assert.equal((await docxDone.json()).mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const form = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: A }, "Practice manager", "2026-10-01T09:00:00.000Z");
      const report = { ...completedSampleReport("megan-hart", form, { id: "rpt_fill" }), tenantId: A };
      const preview = await a("/api/reports/v1/forms/fill-preview", postJson({ report, form, mode: "draft" }));
      assert.equal(preview.status, 200, await preview.clone().text());
      assert.equal((await b("/api/reports/v1/forms/fill-preview", postJson({ report, form, mode: "draft" }))).status, 422);

      const actions = (await listAudit(ctx, A)).map((e) => e.action);
      assert.equal(actions.filter((x) => x === "file.upload").length, 2);
    });
  });
}

defineSuite("SQLite (node:sqlite)", () => createSqliteTestDb());
defineSuite("Postgres (PGlite)", () => createPgliteTestDb());
