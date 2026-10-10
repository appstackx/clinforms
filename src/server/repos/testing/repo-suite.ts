/**
 * TESTS ONLY: the repository test suite, run unchanged against every dialect:
 * local SQLite and PGlite (src/server/repos/repos.test.ts) and D1 through the gateway
 * (workers/data-gateway/test). Each run gets a fresh, migrated database from `factory`.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { sql, type Kysely } from "kysely";
import { DataCryptoError } from "../../crypto/envelope";
import { runBatch } from "../../db/batch";
import { classifyDbError } from "../../db/errors";
import type { Database } from "../../db/schema";
import { testCipher } from "../../db/testing/databases";
import { createAccessRequest, deleteAccessRequest, listAccessRequests } from "../access-requests";
import { appendAudit, listAudit } from "../audit";
import { getClinicProfile, upsertClinicProfile } from "../clinic-profile";
import type { RepoContext } from "../context";
import { RepoInputError } from "../context";
import { FILE_CHUNK_BYTES, deleteFormFile, getFormFile, getFormFileMeta, hasFormFile, listFormFiles, putFormFile } from "../form-files";
import { createForm, deleteForm, getForm, listFormMeta, listForms, updateForm } from "../forms";
import { claimLaunchToken, purgeExpiredLaunchTokens } from "../launch-tokens";
import { purgeExpiredReports, purgeOldAccessRequests, runRetention } from "../maintenance";
import { getMemberProfile, listMemberProfiles, upsertMemberProfile } from "../member-profile";
import { createPartnerKey, listPartnerKeys, partnerKeyTenant, revokePartnerKey, verifyPartnerKey } from "../partner-keys";
import { hitRateLimit, peekRateLimit, purgeRateLimits } from "../rate-limits";
import { beginFormFileUpload, formFileChunkIndexes, purgeIncompleteUploads, putFormFileChunk } from "../form-file-uploads";
import { createReport, deleteReport, getReport, getReportMeta, listReports, retentionDeadline, updateReport } from "../reports";
import { getTenantSettings, putTenantSettings } from "../tenant-settings";

export interface SuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

const A = "clinic-a";
const B = "clinic-b";
const SHA = "a".repeat(64);

async function expectDbError(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    assert.equal(classifyDbError(err), expected, String(err));
    return;
  }
  assert.fail(`expected a ${expected} error`);
}

export function defineRepoSuite(label: string, factory: () => Promise<SuiteDb>): void {
  describe(`repositories on ${label}`, () => {
    let suiteDb: SuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-09T10:00:00.000Z");
    const tick = (ms = 1000) => {
      clock += ms;
    };

    before(async () => {
      suiteDb = await factory();
      ctx = { db: suiteDb.db, cipher: testCipher(), now: () => new Date(clock) };
    });
    after(async () => {
      await suiteDb?.close();
    });

    it("forms: create, read, list, optimistic update, conflict, delete", async () => {
      const input = {
        id: "form-1",
        fileSha256: SHA,
        status: "confirmed",
        title: "Physiotherapy report (fictional)",
        referrer: "Harrow & Pike (fictional)",
        kind: "docx",
        payload: { fields: [{ id: "F-01", label: "Name" }] },
      };
      assert.deepEqual(await createForm(ctx, A, input), { ok: true, rev: 1, updatedAt: new Date(clock).toISOString() });
      const again = await createForm(ctx, A, input);
      assert.deepEqual(again, { ok: false, reason: "exists", currentRev: 1 });
      const got = await getForm(ctx, A, "form-1");
      assert.ok(got);
      assert.equal(got.rev, 1);
      assert.equal(got.sampleId, null);
      assert.deepEqual(got.payload, input.payload);
      tick();
      const updated = await updateForm(ctx, A, { ...input, title: "Renamed" }, 1);
      assert.equal(updated.ok, true);
      assert.equal(updated.ok && updated.rev, 2);
      assert.deepEqual(await updateForm(ctx, A, input, 1), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await updateForm(ctx, A, { ...input, id: "nope" }, 1), { ok: false, reason: "not_found" });
      const list = await listForms(ctx, A);
      assert.equal(list.length, 1);
      assert.equal(list[0].title, "Renamed");
      assert.equal((await listFormMeta(ctx, A))[0].rev, 2);
      // the stored payload is ciphertext, not JSON
      const raw = await ctx.db.selectFrom("forms").select("payload_enc").where("tenant_id", "=", A).executeTakeFirstOrThrow();
      assert.match(raw.payload_enc, /^v1\.t1\./);
      assert.ok(!raw.payload_enc.includes("F-01"));
      assert.equal(await deleteForm(ctx, A, "form-1"), true);
      assert.equal(await deleteForm(ctx, A, "form-1"), false);
      await assert.rejects(createForm(ctx, A, { ...input, fileSha256: "XYZ" }), RepoInputError);
    });

    it("reports: optimistic concurrency, ordering, payload-less listing, retention purge", async () => {
      const base = { status: "draft", templateId: "form:form-1", formId: "form-1", payload: { sections: ["x"] } };
      await createReport(ctx, A, { ...base, id: "rep-1", deleteAfter: retentionDeadline(new Date(clock).toISOString(), 1) });
      tick();
      await createReport(ctx, A, { ...base, id: "rep-2", formId: null, templateId: "solicitor" });
      tick();
      const r1 = await updateReport(ctx, A, { ...base, id: "rep-1", status: "approved" }, 1);
      assert.equal(r1.ok && r1.rev, 2);
      assert.deepEqual(await updateReport(ctx, A, { ...base, id: "rep-1" }, 1), { ok: false, reason: "conflict", currentRev: 2 });
      const list = await listReports(ctx, A);
      assert.deepEqual(
        list.map((r) => [r.id, r.rev, r.status]),
        [
          ["rep-1", 2, "approved"],
          ["rep-2", 1, "draft"],
        ],
      );
      assert.deepEqual(list[0].payload, base.payload);
      const metaOnly = await listReports(ctx, A, { withPayload: false });
      assert.equal("payload" in metaOnly[0], false);
      const rep2 = await getReport(ctx, A, "rep-2");
      assert.equal(rep2?.formId, null);
      assert.equal(rep2?.deleteAfter, null);
      // retention: an update that OMITS deleteAfter keeps the stored deadline (it must never switch deletion off)
      const rep1 = await getReport(ctx, A, "rep-1");
      assert.equal(rep1?.deleteAfter, retentionDeadline(rep1!.createdAt, 1));
      tick(3 * 86_400_000);
      assert.equal(await purgeExpiredReports(ctx), 1, "rep-1's deadline passed (rep-2 has none, clinic A has no profile yet)");
      assert.equal(await getReport(ctx, A, "rep-1"), null);
      // null clears an explicit deadline; a timestamp sets one
      await updateReport(ctx, A, { ...base, id: "rep-2", deleteAfter: new Date(clock + 60_000).toISOString() }, 1);
      await updateReport(ctx, A, { ...base, id: "rep-2", deleteAfter: null }, 2);
      assert.equal((await getReport(ctx, A, "rep-2"))?.deleteAfter, null);
      await updateReport(ctx, A, { ...base, id: "rep-2", deleteAfter: new Date(clock - 1000).toISOString() }, 3);
      assert.equal(await purgeExpiredReports(ctx), 1);
      assert.equal(await getReport(ctx, A, "rep-2"), null);
      assert.equal(await deleteReport(ctx, A, "rep-2"), false);
    });

    it("form files: chunked, encrypted, verified on read, idempotent, repairable", async () => {
      const bytes = randomBytes(FILE_CHUNK_BYTES * 2 + 12_345); // 3 chunks → 2 batches
      const sha = createHash("sha256").update(bytes).digest("hex");
      const put = await putFormFile(ctx, A, { bytes, fileName: "form.pdf", mimeType: "application/pdf", expectedSha256: sha });
      assert.deepEqual(put, { sha256: sha, sizeBytes: bytes.length, chunkCount: 3, written: true });
      assert.equal((await putFormFile(ctx, A, { bytes, fileName: "form.pdf", mimeType: "application/pdf" })).written, false);
      const file = await getFormFile(ctx, A, sha);
      assert.ok(file);
      assert.ok(file.bytes.equals(bytes));
      assert.equal(file.fileName, "form.pdf");
      assert.equal(await hasFormFile(ctx, A, sha), true);
      assert.equal((await listFormFiles(ctx, A)).length, 1);
      const chunk0 = await ctx.db
        .selectFrom("form_file_chunks")
        .select("data_enc")
        .where("tenant_id", "=", A)
        .where("sha256", "=", sha)
        .where("idx", "=", 0)
        .executeTakeFirstOrThrow();
      // swapping chunk 0's ciphertext into chunk 1 is caught by the AAD
      await ctx.db
        .updateTable("form_file_chunks")
        .set({ data_enc: chunk0.data_enc })
        .where("tenant_id", "=", A)
        .where("sha256", "=", sha)
        .where("idx", "=", 1)
        .execute();
      await assert.rejects(getFormFile(ctx, A, sha), (err: unknown) => err instanceof DataCryptoError && err.code === "DECRYPT_FAILED");
      // a missing chunk = incomplete = not returned; re-put repairs it
      await ctx.db.deleteFrom("form_file_chunks").where("tenant_id", "=", A).where("sha256", "=", sha).where("idx", "=", 1).execute();
      assert.equal(await hasFormFile(ctx, A, sha), false);
      assert.equal(await getFormFile(ctx, A, sha), null);
      assert.equal((await putFormFile(ctx, A, { bytes, fileName: "form.pdf", mimeType: "application/pdf" })).written, true);
      assert.ok((await getFormFile(ctx, A, sha))?.bytes.equals(bytes));
      await assert.rejects(
        putFormFile(ctx, A, { bytes, fileName: "f", mimeType: "application/pdf", expectedSha256: SHA }),
        RepoInputError,
      );
      assert.equal(await deleteFormFile(ctx, A, sha), true);
      const left = await ctx.db.selectFrom("form_file_chunks").select("idx").where("tenant_id", "=", A).execute();
      assert.equal(left.length, 0);
      assert.equal(await deleteFormFile(ctx, A, sha), false);
      // an empty file is legal (0 chunks)
      const empty = await putFormFile(ctx, A, { bytes: new Uint8Array(0), fileName: "empty.docx", mimeType: "application/octet-stream" });
      assert.equal(empty.chunkCount, 0);
      assert.equal((await getFormFile(ctx, A, empty.sha256))?.bytes.length, 0);
      await deleteFormFile(ctx, A, empty.sha256);
    });

    it("tenant settings, clinic profile and member profile", async () => {
      assert.equal(await getTenantSettings(ctx, A), null);
      await putTenantSettings(ctx, A, { "Harrow & Pike (fictional)": "form-1" });
      tick();
      await putTenantSettings(ctx, A, { other: "form-2" });
      assert.deepEqual((await getTenantSettings(ctx, A))?.referrerLinks, { other: "form-2" });

      const created = await upsertClinicProfile(ctx, A, {
        organizationId: "org_a",
        displayName: "Riverside Physiotherapy (fictional)",
        address: ["1 High Street", "Milton Keynes"],
        postcode: "MK9 1AA",
      });
      assert.equal(created.retentionDays, 365);
      assert.equal(created.draftingEnabled, false);
      tick();
      const updated = await upsertClinicProfile(ctx, A, {
        organizationId: "org_a",
        displayName: "Riverside Physio (fictional)",
        draftingEnabled: true,
        retentionDays: 30,
      });
      assert.equal(updated.createdAt, created.createdAt);
      assert.notEqual(updated.updatedAt, created.updatedAt);
      assert.equal(updated.draftingEnabled, true);
      assert.equal(updated.address, null);
      assert.equal((await getClinicProfile(ctx, A))?.displayName, "Riverside Physio (fictional)");
      await expectDbError(upsertClinicProfile(ctx, B, { organizationId: "org_a", displayName: "Clash" }), "CONSTRAINT_UNIQUE");

      await upsertMemberProfile(ctx, "org_a", "user_1", { jobTitle: "Senior Physiotherapist", hcpcNumber: "PH-DEMO-01", canSign: true });
      await upsertMemberProfile(ctx, "org_a", "user_2", { jobTitle: "Physiotherapist" });
      await upsertMemberProfile(ctx, "org_b", "user_1", { canSign: false });
      const m = await getMemberProfile(ctx, "org_a", "user_1");
      assert.equal(m?.canSign, true);
      assert.equal(m?.hcpcNumber, "PH-DEMO-01");
      assert.equal((await listMemberProfiles(ctx, "org_a")).length, 2);
      assert.equal((await getMemberProfile(ctx, "org_b", "user_1"))?.canSign, false);
    });

    it("audit log is append-only and listed newest first", async () => {
      const e1 = await appendAudit(ctx, A, { userId: "user_1", action: "report.sign", targetType: "report", targetId: "rep-1" });
      tick();
      const e2 = await appendAudit(ctx, A, { userId: "user_1", action: "report.render", detail: { format: "pdf" } });
      await appendAudit(ctx, B, { action: "member.invite" });
      const list = await listAudit(ctx, A);
      assert.deepEqual(
        list.map((e) => e.id),
        [e2.id, e1.id],
      );
      assert.deepEqual(list[0].detail, { format: "pdf" });
      assert.deepEqual(
        (await listAudit(ctx, A, { beforeId: e2.id })).map((e) => e.id),
        [e1.id],
      );
      await expectDbError(ctx.db.updateTable("audit_log").set({ action: "tampered" }).where("id", "=", e1.id).execute(), "APPEND_ONLY");
      await expectDbError(ctx.db.deleteFrom("audit_log").where("id", "=", e1.id).execute(), "APPEND_ONLY");
      await expectDbError(ctx.db.deleteFrom("audit_log").execute(), "APPEND_ONLY");
      // overwriting an entry through conflict resolution is refused too (an upsert on every dialect; REPLACE
      // fails on every dialect: the SQLite trigger, Postgres has no REPLACE, the D1 gateway refuses it)
      const overwrite = { id: e1.id, tenant_id: A, action: "harmless.event", at: new Date(clock).toISOString() };
      await expectDbError(
        ctx.db
          .insertInto("audit_log")
          .values(overwrite)
          .onConflict((oc) => oc.column("id").doUpdateSet({ action: "harmless.event" }))
          .execute(),
        "APPEND_ONLY",
      );
      await assert.rejects(ctx.db.insertInto("audit_log").orReplace().values(overwrite).execute());
      await assert.rejects(ctx.db.replaceInto("audit_log").values(overwrite).execute());
      assert.equal((await listAudit(ctx, A))[1].action, "report.sign");
      await assert.rejects(appendAudit(ctx, A, { action: "Bad Action" }), RepoInputError);
    });

    it("partner keys: shown once, hashed, verified per tenant, revocable", async () => {
      const created = await createPartnerKey(ctx, A, { name: "PMS integration", createdBy: "user_1" });
      assert.match(created.key, /^cfk_clinic-a_[A-Za-z0-9_-]{43}$/);
      assert.equal(created.last4, created.key.slice(-4));
      assert.equal(partnerKeyTenant(created.key), A);
      const listed = await listPartnerKeys(ctx, A);
      assert.equal(listed.length, 1);
      assert.equal(JSON.stringify(listed).includes(created.key), false);
      const stored = await ctx.db.selectFrom("partner_keys").select("key_hash").executeTakeFirstOrThrow();
      assert.equal(stored.key_hash, createHash("sha256").update(created.key).digest("hex"));
      assert.deepEqual(await verifyPartnerKey(ctx, A, created.key), { id: created.id, tenantId: A, name: "PMS integration" });
      assert.equal(await verifyPartnerKey(ctx, B, created.key), null);
      assert.equal(await verifyPartnerKey(ctx, A, created.key.slice(0, -1) + (created.key.endsWith("A") ? "B" : "A")), null);
      assert.equal(await verifyPartnerKey(ctx, A, "garbage"), null);
      assert.equal(await revokePartnerKey(ctx, B, created.id), false);
      assert.equal(await revokePartnerKey(ctx, A, created.id), true);
      assert.equal(await revokePartnerKey(ctx, A, created.id), false);
      assert.equal(await verifyPartnerKey(ctx, A, created.key), null);
    });

    it("launch tokens are claimable exactly once, even concurrently", async () => {
      const expires = new Date(clock + 600_000).toISOString();
      assert.equal(await claimLaunchToken(ctx, "lt_single_0001", expires), true);
      assert.equal(await claimLaunchToken(ctx, "lt_single_0001", expires), false);
      const results = await Promise.all(Array.from({ length: 8 }, () => claimLaunchToken(ctx, "lt_race_00000001", expires)));
      assert.equal(results.filter(Boolean).length, 1);
      tick(700_000);
      assert.equal(await purgeExpiredLaunchTokens(ctx), 2);
    });

    it("rate limits count atomically per window", async () => {
      const key = "live:clinic-a";
      assert.equal((await hitRateLimit(ctx, key, 60_000)).count, 1);
      assert.equal((await hitRateLimit(ctx, key, 60_000)).count, 2);
      const counts = await Promise.all(Array.from({ length: 20 }, () => hitRateLimit(ctx, key, 60_000)));
      assert.deepEqual(
        counts.map((c) => c.count).sort((x, y) => x - y),
        Array.from({ length: 20 }, (_, i) => i + 3),
      );
      assert.equal((await peekRateLimit(ctx, key, 60_000)).count, 22);
      tick(60_000);
      const next = await hitRateLimit(ctx, key, 60_000);
      assert.equal(next.count, 1);
      assert.ok(next.windowStart > counts[0].windowStart);
      assert.equal(await purgeRateLimits(ctx, next.windowStart), 1);
      // Fix wave 2: a hit may count an amount (kilobytes of new data).
      assert.equal((await hitRateLimit(ctx, "store:new-kb:clinic-a", 86_400_000, 1500)).count, 1500);
      assert.equal((await hitRateLimit(ctx, "store:new-kb:clinic-a", 86_400_000, 20)).count, 1520);
      await assert.rejects(hitRateLimit(ctx, "store:new-kb:clinic-a", 86_400_000, 0));
    });

    it("access requests", async () => {
      const req = await createAccessRequest(ctx, {
        clinicName: "Example Physio (fictional)",
        contactName: "Alex Example",
        email: "alex@example.com",
        message: "We would like a demo.",
      });
      assert.equal((await listAccessRequests(ctx))[0].id, req.id);
      await assert.rejects(
        createAccessRequest(ctx, { clinicName: "x", contactName: "y", email: "not-an-email" }),
        RepoInputError,
      );
      assert.equal(await deleteAccessRequest(ctx, req.id), true);
    });

    it("runBatch is atomic: a failing statement rolls back the whole batch", async () => {
      const at = new Date(clock).toISOString();
      await assert.rejects(
        runBatch(ctx.db, [
          ctx.db.insertInto("tenant_settings").values({ tenant_id: "batch-test", referrer_links_json: "{}", updated_at: at }),
          ctx.db.insertInto("tenant_settings").values({ tenant_id: "batch-test", referrer_links_json: "{}", updated_at: at }),
        ]),
      );
      assert.equal(await getTenantSettings(ctx, "batch-test"), null);
      const ok = await runBatch(ctx.db, [
        ctx.db.insertInto("tenant_settings").values({ tenant_id: "batch-test", referrer_links_json: "{}", updated_at: at }),
        ctx.db.updateTable("tenant_settings").set({ referrer_links_json: '{"a":1}' }).where("tenant_id", "=", "batch-test"),
        ctx.db.selectFrom("tenant_settings").select("referrer_links_json").where("tenant_id", "=", "batch-test"),
      ]);
      assert.equal(ok.length, 3);
      assert.deepEqual(ok[2].rows, [{ referrer_links_json: '{"a":1}' }]);
      assert.deepEqual((await getTenantSettings(ctx, "batch-test"))?.referrerLinks, { a: 1 });
    });

    it("retention: the clinic's period applies at purge time; old access requests go after 24 months", async () => {
      const C = "clinic-retention";
      const DAY = 86_400_000;
      const base = { status: "approved", templateId: "solicitor", payload: { fictional: true } };
      const profile = { organizationId: "org_retention", displayName: "Retention Clinic (fictional)", retentionDays: 30 };
      await upsertClinicProfile(ctx, C, profile);
      await createReport(ctx, C, { ...base, id: "old" });
      tick(10 * DAY);
      await createReport(ctx, C, { ...base, id: "recent" });
      await createReport(ctx, C, { ...base, id: "busy" });
      tick(25 * DAY); // old: 35 days since its last change, recent and busy: 25
      await updateReport(ctx, C, { ...base, id: "busy", status: "draft" }, 1); // still being worked on
      await purgeExpiredReports(ctx);
      assert.equal(await getReport(ctx, C, "old"), null, "past the clinic's 30 days");
      assert.ok(await getReport(ctx, C, "recent"));
      // shortening the period applies to EXISTING reports on the next run (nothing to recalculate)
      await upsertClinicProfile(ctx, C, { ...profile, retentionDays: 20 });
      await purgeExpiredReports(ctx);
      assert.equal(await getReport(ctx, C, "recent"), null, "25 days > the new 20");
      assert.ok(await getReport(ctx, C, "busy"), "changed today: kept");

      const request = await createAccessRequest(ctx, { clinicName: "Old Clinic (fictional)", contactName: "Ann Example", email: "ann@old.example" });
      tick(729 * DAY);
      assert.equal(await purgeOldAccessRequests(ctx), 0);
      tick(2 * DAY);
      assert.ok((await purgeOldAccessRequests(ctx)) >= 1);
      assert.ok(!(await listAccessRequests(ctx)).some((r) => r.id === request.id));
      const pass = await runRetention(ctx);
      assert.deepEqual(Object.keys(pass).sort(), ["accessRequests", "incompleteUploads", "launchTokens", "rateLimits", "reports"]);
    });

    it("tenants are isolated by construction (and ciphertext cannot be moved between tenants)", async () => {
      const payloadA = { secret: "tenant A only" };
      await createReport(ctx, A, { id: "same-id", status: "draft", templateId: "t", payload: payloadA });
      await createReport(ctx, B, { id: "same-id", status: "draft", templateId: "t", payload: { secret: "tenant B" } });
      await createForm(ctx, A, { id: "shared-form", fileSha256: SHA, status: "proposed", title: "A", kind: "pdf", payload: 1 });
      assert.equal(await getForm(ctx, B, "shared-form"), null);
      assert.deepEqual(await updateForm(ctx, B, { id: "shared-form", fileSha256: SHA, status: "x", title: "B", kind: "pdf", payload: 2 }, 1), {
        ok: false,
        reason: "not_found",
      });
      assert.equal(await deleteForm(ctx, B, "shared-form"), false);
      assert.equal((await getForm(ctx, A, "shared-form"))?.title, "A");
      assert.deepEqual((await getReport(ctx, B, "same-id"))?.payload, { secret: "tenant B" });
      assert.deepEqual((await listReports(ctx, B)).map((r) => r.id).includes("rep-1"), false);
      const bytes = randomBytes(1000);
      const file = await putFormFile(ctx, A, { bytes, fileName: "a.docx", mimeType: "application/octet-stream" });
      assert.equal(await getFormFile(ctx, B, file.sha256), null);
      assert.equal(await deleteFormFile(ctx, B, file.sha256), false);
      assert.ok(await getFormFile(ctx, A, file.sha256));
      // Copy tenant A's ciphertext into tenant B's row: B cannot decrypt it (per-tenant key + AAD).
      const rowA = await ctx.db
        .selectFrom("reports")
        .select("payload_enc")
        .where("tenant_id", "=", A)
        .where("id", "=", "same-id")
        .executeTakeFirstOrThrow();
      await ctx.db.updateTable("reports").set({ payload_enc: rowA.payload_enc }).where("tenant_id", "=", B).where("id", "=", "same-id").execute();
      await assert.rejects(getReport(ctx, B, "same-id"), (err: unknown) => err instanceof DataCryptoError && err.code === "DECRYPT_FAILED");
      await assert.rejects(getReport(ctx, "Not A Slug", "same-id"), RepoInputError);
      await assert.rejects(getReport(ctx, "a'; drop table reports; --", "same-id"), RepoInputError);
      // The tables are still there and readable.
      const count = await sql<{ n: number }>`select count(*) as n from reports`.execute(ctx.db);
      assert.ok(Number(count.rows[0].n) >= 2);
    });

    it("chunked uploads (Studio store): resumable, length-checked, served only once complete and verified", async () => {
      const size = FILE_CHUNK_BYTES * 2 + 77;
      const bytes = Buffer.alloc(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 251;
      const sha = createHash("sha256").update(bytes).digest("hex");
      const part = (i: number) => bytes.subarray(i * FILE_CHUNK_BYTES, Math.min(size, (i + 1) * FILE_CHUNK_BYTES));
      const input = { sha256: sha, fileName: "upload.pdf", mimeType: "application/pdf", sizeBytes: size };
      assert.equal(await putFormFileChunk(ctx, A, sha, 0, part(0)), "not_started");
      const begun = await beginFormFileUpload(ctx, A, input);
      assert.deepEqual([begun.held, begun.present, begun.meta.chunkCount], ["none", [], 3]);
      assert.equal(await putFormFileChunk(ctx, A, sha, 2, part(2)), "written");
      assert.equal(await putFormFileChunk(ctx, A, sha, 0, part(0)), "written");
      await assert.rejects(putFormFileChunk(ctx, A, sha, 1, part(1).subarray(1)), RepoInputError);
      await assert.rejects(putFormFileChunk(ctx, A, sha, 3, part(2)), RepoInputError);
      assert.deepEqual((await beginFormFileUpload(ctx, A, input)).present, [0, 2], "resume");
      assert.equal(await getFormFile(ctx, A, sha), null, "not served while incomplete");
      assert.equal(await hasFormFile(ctx, A, sha), false);
      assert.deepEqual(await formFileChunkIndexes(ctx, B, sha), [], "per tenant");
      assert.equal(await putFormFileChunk(ctx, A, sha, 1, part(1)), "written");
      const file = await getFormFile(ctx, A, sha);
      assert.ok(file && file.bytes.equals(bytes), "same encryption as putFormFile: read back as a stored file");
      assert.equal((await beginFormFileUpload(ctx, A, input)).held, "all");
      assert.equal(await putFormFileChunk(ctx, A, sha, 0, Buffer.alloc(FILE_CHUNK_BYTES)), "complete", "a complete file is not overwritten");
      assert.ok((await getFormFile(ctx, A, sha))?.bytes.equals(bytes));

      // A partial upload recorded with another size starts afresh; abandoned uploads are purged.
      const other = createHash("sha256").update("abandoned").digest("hex");
      await beginFormFileUpload(ctx, A, { ...input, sha256: other, sizeBytes: FILE_CHUNK_BYTES + 10 });
      assert.equal(await putFormFileChunk(ctx, A, other, 1, Buffer.from("abandoned!")), "written");
      const again = await beginFormFileUpload(ctx, A, { ...input, sha256: other, sizeBytes: FILE_CHUNK_BYTES * 2 + 1 });
      assert.deepEqual([again.held, again.present, again.meta.chunkCount], ["none", [], 3]);
      tick(60_000);
      assert.equal(await purgeIncompleteUploads(ctx, new Date(clock).toISOString()), 1);
      assert.equal(await getFormFileMeta(ctx, A, other), null);
      assert.ok(await getFormFile(ctx, A, sha), "complete files are kept");
      assert.equal(await deleteFormFile(ctx, A, sha), true);
    });

    it("getReportMeta: one report's metadata without decrypting it", async () => {
      await createReport(ctx, A, { id: "meta-1", status: "signed", templateId: "solicitor", payload: { x: 1 } });
      const meta = await getReportMeta(ctx, A, "meta-1");
      assert.deepEqual(meta && [meta.id, meta.rev, meta.status, meta.templateId], ["meta-1", 1, "signed", "solicitor"]);
      // Fix wave 3: the stored (encrypted) size, for the store's growth allowance – larger for a larger payload.
      assert.ok(meta && typeof meta.storedChars === "number" && meta.storedChars > 0);
      await updateReport(ctx, A, { id: "meta-1", status: "signed", templateId: "solicitor", payload: { x: "y".repeat(3000) } }, 1);
      const grown = await getReportMeta(ctx, A, "meta-1");
      assert.ok(grown && meta && (grown.storedChars ?? 0) > (meta.storedChars ?? 0) + 3000);
      assert.equal(await getReportMeta(ctx, B, "meta-1"), null);
      assert.equal(await getReportMeta(ctx, A, "nope"), null);
      await deleteReport(ctx, A, "meta-1");
    });
  });
}
