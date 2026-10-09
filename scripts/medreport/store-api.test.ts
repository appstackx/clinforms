/**
 * Tenant storage API (/api/reports/v1/store/**, wave 2) – the handlers on an in-memory TenantStore:
 * sign-in and two-step checks, same-origin writes, tenant isolation, revisions (If-Match, 409 with the stored
 * copy), approval receipts and form-map attestations, chunked uploads (resume, damage, type checks), settings,
 * audit rows; and /render + /forms/fill-preview reading the clinic's stored form file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.MEDREPORT_AI_MODE = "demo";

import { createReceipt } from "../../src/modules/medreport/auth/sign-receipt";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { MAX_FORM_FILE_BYTES } from "../../src/modules/medreport/config.public";
import { FORM_ATTESTATIONS } from "../../src/modules/medreport/core/forms";
import type { Clinician, FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { sha256Hex } from "../../src/modules/medreport/forms/file";
import {
  STORE_API_ENDPOINTS,
  STORE_FILE_CHUNK_BYTES,
  StoreConflictSchema,
  StoreFileInitResponseSchema,
  StoreFormResponseSchema,
  StoreReportResponseSchema,
  StoreSnapshotResponseSchema,
  parseRevTag,
  revTag,
  storeApiPaths,
  storeChunkCount,
} from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { FILE_CHUNK_BYTES } from "../../src/server/repos/form-files";
import { ORIGIN, member, storeDeps, storeFetch } from "./store-harness";
import { completedSampleReport } from "./form-sample-answers";

const A = "clinic-a";
const B = "clinic-b";
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };

function setup() {
  const store = createMemoryTenantStore();
  const deps = storeDeps(store, {
    a: member(A),
    b: member(B),
    nofactor: member(A, { twoFactorVerified: false }),
  });
  const as = (who: string | null, origin?: string) => storeFetch(deps, { member: who, origin });
  return { store, deps, as };
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

function reportFor(tenantId: string, id = "rpt_store_test"): Report {
  const form = { ...HARROW_PIKE_RAW, tenantId };
  return { ...completedSampleReport("megan-hart", form, { id }), tenantId };
}

function formFor(tenantId: string): FormDefinition {
  return { ...HARROW_PIKE_RAW, tenantId };
}

/** A fake PDF (no streams) of `size` bytes – passes the type and limit checks. */
function fakePdf(size: number, seed = "a"): Uint8Array<ArrayBuffer> {
  const head = Buffer.from("%PDF-1.4\n", "latin1");
  const tail = Buffer.from("\n%%EOF\n", "latin1");
  const filler = Buffer.alloc(size - head.length - tail.length);
  for (let i = 0; i < filler.length; i++) filler[i] = i % 64 === 63 ? 0x0a : 0x61 + ((i + seed.charCodeAt(0)) % 20);
  filler[0] = 0x25; // "%": the filler is one long comment
  return new Uint8Array(Buffer.concat([head, filler, tail]));
}

async function upload(f: typeof fetch, bytes: Uint8Array, name = "form.pdf"): Promise<Response> {
  const sha256 = sha256Hex(bytes);
  const size = bytes.byteLength;
  const init = await f(storeApiPaths.files(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256, size, name, mime: "application/pdf" }) });
  assert.equal(init.status, 200, await init.clone().text());
  for (let i = 0; i < storeChunkCount(size); i++) {
    const part = bytes.slice(i * STORE_FILE_CHUNK_BYTES, Math.min(size, (i + 1) * STORE_FILE_CHUNK_BYTES));
    const res = await f(storeApiPaths.fileChunk(sha256, i, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part });
    assert.equal(res.status, 200, await res.clone().text());
  }
  return f(storeApiPaths.fileComplete(sha256), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size, name, mime: "application/pdf" }) });
}

test("every store endpoint has a thin route binding its handler; chunk size = the server's chunk size", () => {
  for (const ep of STORE_API_ENDPOINTS) {
    const file = path.join(process.cwd(), "src/app", ep.path, "route.ts");
    const route = fs.readFileSync(file, "utf8");
    assert.match(route, new RegExp(`export const ${ep.method} = route\\(${ep.fn}\\);`), ep.path);
    assert.match(route, /export const runtime = "nodejs"/, ep.path);
    assert.match(route, /export const dynamic = "force-dynamic"/, ep.path);
    assert.match(fs.readFileSync(path.join(process.cwd(), "src/modules/medreport/api/handlers", ep.handler), "utf8"), new RegExp(`export const ${ep.fn}\\b`));
  }
  assert.equal(STORE_FILE_CHUNK_BYTES, FILE_CHUNK_BYTES);
  assert.equal(parseRevTag('"12"'), 12);
  assert.equal(parseRevTag('W/"3"'), 3);
  assert.equal(parseRevTag("7"), 7);
  assert.equal(parseRevTag('"0"'), null);
  assert.equal(parseRevTag("abc"), null);
  assert.equal(revTag(4), '"4"');
});

test("store endpoints: 501 without storage, 401 signed out, 403 without two-step, same-origin JSON writes only", async () => {
  const { as, deps } = setup();
  const noStore = storeFetch({ ...deps, tenantStore: undefined }, { member: "a" });
  assert.equal((await noStore(storeApiPaths.snapshot())).status, 501);
  assert.equal((await as(null)(storeApiPaths.snapshot())).status, 401);
  const nofactor = await as("nofactor")(storeApiPaths.snapshot());
  assert.equal(nofactor.status, 403);
  assert.equal((await nofactor.json()).code, "TWO_FACTOR_REQUIRED");

  const report = reportFor(A);
  const crossSite = await as("a", "https://evil.example")(storeApiPaths.report(report.id), json({ report }));
  assert.equal(crossSite.status, 403);
  // A write without Origin (not a browser) is refused too.
  const { handleStoreReportPut } = await import("../../src/modules/medreport/api/handlers/store-reports");
  const { bindHandler } = await import("../../src/modules/medreport/api/http");
  const bare = await bindHandler(handleStoreReportPut, () => deps)(
    new Request(`${ORIGIN}${storeApiPaths.report(report.id)}`, { method: "PUT", headers: { cookie: "member=a", "content-type": "application/json" }, body: JSON.stringify({ report }) }),
    { params: { id: report.id } },
  );
  assert.equal(bare.status, 403);
  const form = await as("a")(storeApiPaths.report(report.id), { method: "PUT", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "report=1" });
  assert.equal(form.status, 415);
});

test("reports: create, read, update with If-Match, 409 with the stored copy, clinic forced from the sign-in, audit", async () => {
  const { as, store } = setup();
  const f = as("a");
  const report = { ...reportFor("demo"), tenantId: "demo" }; // a browser copy filed under another clinic
  const created = await f(storeApiPaths.report(report.id), json({ report }));
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal(created.headers.get("etag"), '"1"');
  const body = StoreReportResponseSchema.parse(await created.json());
  assert.equal(body.rev, 1);
  assert.equal(body.report.tenantId, A, "stored under the member's clinic");

  const again = await f(storeApiPaths.report(report.id), json({ report }));
  assert.equal(again.status, 409);
  const exists = StoreConflictSchema.parse(await again.json());
  assert.equal(exists.code, "REV_CONFLICT");
  assert.equal(exists.current?.rev, 1);
  assert.equal(exists.current?.report?.id, report.id);

  const edited: Report = { ...body.report, patientLabel: "Megan Hart (edited)", updatedAt: "2026-10-09T11:00:00.000Z" };
  const updated = await f(storeApiPaths.report(report.id), json({ report: edited }, { "if-match": '"1"' }));
  assert.equal(updated.status, 200);
  assert.equal(updated.headers.get("etag"), '"2"');

  const stale = await f(storeApiPaths.report(report.id), json({ report: { ...edited, patientLabel: "stale" } }, { "if-match": '"1"' }));
  assert.equal(stale.status, 409);
  const conflict = StoreConflictSchema.parse(await stale.json());
  assert.equal(conflict.current?.rev, 2);
  assert.equal(conflict.current?.report?.patientLabel, "Megan Hart (edited)");

  const got = await f(storeApiPaths.report(report.id));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("etag"), '"2"');
  assert.equal(StoreReportResponseSchema.parse(await got.json()).report.patientLabel, "Megan Hart (edited)");

  const mismatch = await f(storeApiPaths.report("rpt_other"), json({ report: edited }, { "if-match": '"2"' }));
  assert.equal(mismatch.status, 422);
  const invalid = await f(storeApiPaths.report(report.id), json({ report: { ...edited, sections: "nope" } }, { "if-match": '"2"' }));
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).code, "VALIDATION_FAILED");
  const badTag = await f(storeApiPaths.report(report.id), json({ report: edited }, { "if-match": "latest" }));
  assert.equal(badTag.status, 422);
  const gone = await f(storeApiPaths.report("rpt_never"), json({ report: { ...edited, id: "rpt_never" } }, { "if-match": '"1"' }));
  assert.equal(gone.status, 404);

  const snap = StoreSnapshotResponseSchema.parse(await (await f(storeApiPaths.snapshot())).json());
  assert.equal(snap.tenantId, A);
  assert.deepEqual(snap.reports.map((r) => [r.id, r.rev, r.status]), [[report.id, 2, "draft"]]);
  assert.equal(JSON.stringify(snap).includes("Megan"), false, "summaries carry no patient data");

  const del = await f(storeApiPaths.report(report.id), { method: "DELETE", headers: { "if-match": '"1"' } });
  assert.equal(del.status, 409, "a stale delete is refused");
  const ok = await f(storeApiPaths.report(report.id), { method: "DELETE" });
  assert.deepEqual(await ok.json(), { deleted: true });
  assert.deepEqual(await (await f(storeApiPaths.report(report.id), { method: "DELETE" })).json(), { deleted: false });
  assert.equal((await f(storeApiPaths.report(report.id))).status, 404);

  assert.deepEqual(
    store.auditLog.map((e) => [e.tenantId, e.action, e.targetId, e.userId]),
    [
      [A, "report.create", report.id, "user-clinic-a"],
      [A, "report.update", report.id, "user-clinic-a"],
      [A, "report.delete", report.id, "user-clinic-a"],
    ],
  );
  assert.equal(JSON.stringify(store.auditLog).includes("Megan"), false, "no patient data in the audit log");
});

test("tenant isolation: another clinic can neither see nor change a clinic's records", async () => {
  const { as } = setup();
  const report = reportFor(A);
  assert.equal((await as("a")(storeApiPaths.report(report.id), json({ report }))).status, 201);
  const b = as("b");
  assert.equal((await b(storeApiPaths.report(report.id))).status, 404);
  assert.equal((await b(storeApiPaths.report(report.id), json({ report }, { "if-match": '"1"' }))).status, 404);
  assert.deepEqual(await (await b(storeApiPaths.report(report.id), { method: "DELETE" })).json(), { deleted: false });
  const snapB = StoreSnapshotResponseSchema.parse(await (await b(storeApiPaths.snapshot())).json());
  assert.deepEqual(snapB.reports, []);
  // B creating the same id makes B's own copy; A's is untouched.
  const own = await b(storeApiPaths.report(report.id), json({ report: { ...report, patientLabel: "B's copy" } }));
  assert.equal(own.status, 201);
  assert.equal(StoreReportResponseSchema.parse(await own.json()).report.tenantId, B);
  const a = StoreReportResponseSchema.parse(await (await as("a")(storeApiPaths.report(report.id))).json());
  assert.notEqual(a.report.patientLabel, "B's copy");
  assert.equal(a.report.tenantId, A);
});

test("signed reports: only with a receipt that verifies for this clinic and content; approval cannot be undone", async () => {
  const { as } = setup();
  const f = as("a");
  const draft = reportFor(A, "rpt_signed");
  const forged = { ...draft, status: "signed" as const };
  const noReceipt = await f(storeApiPaths.report(draft.id), json({ report: forged }));
  assert.equal(noReceipt.status, 422);
  assert.equal((await noReceipt.json()).code, "RECEIPT_INVALID");

  const receipt = await createReceipt({ report: draft, signer: SARAH, statementAccepted: true, attestations: [...FORM_ATTESTATIONS] });
  const fake = await f(storeApiPaths.report(draft.id), json({ report: { ...forged, receipt: { ...receipt, mac: "x".repeat(43) } } }));
  assert.equal(fake.status, 422);

  const otherClinic = await createReceipt({ report: { ...draft, tenantId: B }, signer: SARAH, statementAccepted: true, attestations: [...FORM_ATTESTATIONS] });
  const wrongTenant = await f(storeApiPaths.report(draft.id), json({ report: { ...forged, receipt: otherClinic } }));
  assert.equal(wrongTenant.status, 422, "a receipt issued for another clinic");

  const changed = await f(storeApiPaths.report(draft.id), json({ report: { ...forged, receipt, patientLabel: "changed after approval" } }));
  assert.equal(changed.status, 422);
  assert.match((await changed.json()).detail, /amendment/);

  const signed = { ...forged, receipt, updatedAt: "2026-10-09T12:00:00.000Z" };
  const ok = await f(storeApiPaths.report(draft.id), json({ report: signed }));
  assert.equal(ok.status, 201, await ok.clone().text());

  const reopened = await f(storeApiPaths.report(draft.id), json({ report: { ...draft, receipt } }, { "if-match": '"1"' }));
  assert.equal(reopened.status, 409);
  assert.equal((await reopened.json()).code, "REPORT_LOCKED");

  // A draft may keep a genuine receipt of its own (edited after approval), never a forged one.
  const draftWithForged = await f(storeApiPaths.report("rpt_d2"), json({ report: { ...draft, id: "rpt_d2", receipt: { ...receipt, mac: "y".repeat(43) } } }));
  assert.equal(draftWithForged.status, 422);
});

test("forms: clinic forced, unattested or other-clinic confirmations stored as proposed, attested ones kept", async () => {
  const { as, store } = setup();
  const f = as("a");
  const unattested: FormDefinition = { ...formFor(A), status: "confirmed", confirmed: { by: "Practice manager", at: "2026-10-01T09:00:00.000Z" } };
  const res = await f(storeApiPaths.form(unattested.id), json({ form: unattested }));
  assert.equal(res.status, 201);
  const stored = StoreFormResponseSchema.parse(await res.json());
  assert.equal(stored.form.status, "proposed");
  assert.equal(stored.form.confirmed, undefined);
  assert.equal(stored.downgraded, true);

  const demoAttested = withAttestedConfirmation({ ...formFor("demo") }, "Practice manager", "2026-10-01T09:00:00.000Z");
  const demo = StoreFormResponseSchema.parse(await (await f(storeApiPaths.form(demoAttested.id), json({ form: demoAttested }, { "if-match": '"1"' }))).json());
  assert.equal(demo.form.tenantId, A);
  assert.equal(demo.form.status, "proposed", "a confirmation attested for another clinic is not this clinic's");

  const attested = withAttestedConfirmation(formFor(A), "Practice manager", "2026-10-09T09:00:00.000Z");
  const kept = StoreFormResponseSchema.parse(await (await f(storeApiPaths.form(attested.id), json({ form: attested }, { "if-match": '"2"' }))).json());
  assert.equal(kept.form.status, "confirmed");
  assert.equal(kept.downgraded, undefined);
  assert.equal(kept.rev, 3);
  assert.deepEqual(store.auditLog.map((e) => e.action), ["form.create", "form.update", "form.store_confirmed"]);
  assert.equal((store.auditLog[0].detail as { downgraded: boolean }).downgraded, true);

  const got = StoreFormResponseSchema.parse(await (await f(storeApiPaths.form(attested.id))).json());
  assert.equal(got.form.status, "confirmed");
  assert.equal((await as("b")(storeApiPaths.form(attested.id))).status, 404);

  // A portal question set (no file) stores like any other map.
  const questions: FormDefinition = { ...formFor(A), id: "frm_questions", kind: "questions", status: "proposed" };
  delete questions.confirmed;
  assert.equal((await f(storeApiPaths.form(questions.id), json({ form: questions }))).status, 201);
});

test("forms: deleting the last map that uses a file deletes the file; a shared file stays", async () => {
  const { as, store } = setup();
  const f = as("a");
  const bytes = fakePdf(40_000);
  assert.equal((await upload(f, bytes)).status, 200);
  const sha = sha256Hex(bytes);
  const one: FormDefinition = { ...formFor(A), id: "frm_one", status: "proposed", kind: "pdf_flat", file: { fileName: "form.pdf", mimeType: "application/pdf", sha256: sha, sizeBytes: bytes.byteLength } as FormDefinition["file"] };
  delete one.confirmed;
  const two: FormDefinition = { ...one, id: "frm_two" };
  assert.equal((await f(storeApiPaths.form(one.id), json({ form: one }))).status, 201);
  assert.equal((await f(storeApiPaths.form(two.id), json({ form: two }))).status, 201);
  assert.deepEqual(await (await f(storeApiPaths.form(one.id), { method: "DELETE" })).json(), { deleted: true });
  assert.ok(await store.getFileMeta(A, sha), "still used by frm_two");
  assert.deepEqual(await (await f(storeApiPaths.form(two.id), { method: "DELETE" })).json(), { deleted: true });
  assert.equal(await store.getFileMeta(A, sha), null, "gone with its last map");
});

test("files: chunked upload, resume, idempotent completion, download, isolation", async () => {
  const { as, store } = setup();
  const f = as("a");
  const bytes = fakePdf(STORE_FILE_CHUNK_BYTES * 2 + 1234);
  const sha = sha256Hex(bytes);
  const size = bytes.byteLength;
  const meta = { size, name: "Insurer form.pdf", mime: "application/pdf" };
  const start = StoreFileInitResponseSchema.parse(await (await f(storeApiPaths.files(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha, ...meta }) })).json());
  assert.deepEqual(start, { sha256: sha, complete: false, chunkBytes: STORE_FILE_CHUNK_BYTES, chunkCount: 3, present: [] });

  // Chunk 0 as raw bytes, chunk 2 as JSON; then the connection "drops".
  const part = (i: number) => bytes.slice(i * STORE_FILE_CHUNK_BYTES, Math.min(size, (i + 1) * STORE_FILE_CHUNK_BYTES));
  assert.equal((await f(storeApiPaths.fileChunk(sha, 0, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part(0) })).status, 200);
  const viaJson = await f(storeApiPaths.fileChunk(sha, 2), json({ size, dataBase64: Buffer.from(part(2)).toString("base64") }));
  assert.equal(viaJson.status, 200, await viaJson.clone().text());

  const early = await f(storeApiPaths.fileComplete(sha), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
  assert.equal(early.status, 409);
  const incomplete = await early.json();
  assert.equal(incomplete.code, "UPLOAD_INCOMPLETE");
  assert.deepEqual(incomplete.missing, [1]);
  assert.equal((await f(storeApiPaths.file(sha))).status, 404, "not served before completion");

  const resume = StoreFileInitResponseSchema.parse(await (await f(storeApiPaths.files(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha, ...meta }) })).json());
  assert.deepEqual(resume.present, [0, 2]);
  // Wrong lengths and indexes are refused.
  assert.equal((await f(storeApiPaths.fileChunk(sha, 1, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part(1).slice(1) })).status, 422);
  assert.equal((await f(storeApiPaths.fileChunk(sha, 3, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part(2) })).status, 422);
  assert.equal((await f(storeApiPaths.fileChunk(sha, 1, MAX_FORM_FILE_BYTES + 1), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part(1) })).status, 422);
  assert.equal((await f(storeApiPaths.fileChunk(sha, 1, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part(1) })).status, 200);

  const done = await f(storeApiPaths.fileComplete(sha), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
  assert.equal(done.status, 200, await done.clone().text());
  assert.deepEqual(await done.json(), { sha256: sha, sizeBytes: size, mimeType: "application/pdf", fileName: "Insurer form.pdf" });
  const twice = await f(storeApiPaths.fileComplete(sha), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
  assert.equal(twice.status, 200, "idempotent");
  const after = StoreFileInitResponseSchema.parse(await (await f(storeApiPaths.files(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha, ...meta }) })).json());
  assert.equal(after.complete, true);
  // A chunk for a complete file is not written (the stored file cannot be damaged that way).
  const late = await f(storeApiPaths.fileChunk(sha, 0, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(STORE_FILE_CHUNK_BYTES) });
  assert.equal((await late.json()).complete, true);

  const got = await f(storeApiPaths.file(sha));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "application/pdf");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), bytes);
  assert.equal((await as("b")(storeApiPaths.file(sha))).status, 404, "another clinic does not hold it");
  // Each successful completion is audited (a retried completion too).
  assert.deepEqual(store.auditLog.map((e) => [e.action, e.targetId]), [["file.upload", sha], ["file.upload", sha]]);
  // A chunk for an upload that was never started is refused.
  const other = sha256Hex(fakePdf(3000, "z"));
  const stray = await f(storeApiPaths.fileChunk(other, 0, 3000), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: fakePdf(3000, "z") });
  assert.equal(stray.status, 409);
  assert.equal((await stray.json()).code, "UPLOAD_INCOMPLETE");
});

test("files: a damaged upload is refused and thrown away; a non-form file is refused", async () => {
  const { as, store } = setup();
  const f = as("a");
  const bytes = fakePdf(STORE_FILE_CHUNK_BYTES + 99);
  const sha = sha256Hex(bytes);
  const size = bytes.byteLength;
  await f(storeApiPaths.files(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha, size, name: "x.pdf", mime: "application/pdf" }) });
  const damaged = bytes.slice(0, STORE_FILE_CHUNK_BYTES);
  damaged[100] ^= 0xff;
  await f(storeApiPaths.fileChunk(sha, 0, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: damaged });
  await f(storeApiPaths.fileChunk(sha, 1, size), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: bytes.slice(STORE_FILE_CHUNK_BYTES) });
  const res = await f(storeApiPaths.fileComplete(sha), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size, name: "x.pdf", mime: "application/pdf" }) });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, "UPLOAD_CORRUPT");
  assert.deepEqual(await store.chunkIndexes(A, sha), [], "the damaged upload was discarded");
  assert.equal(await store.getFileMeta(A, sha), null);
  // Uploading again works.
  assert.equal((await upload(f, bytes)).status, 200);

  const text = new Uint8Array(Buffer.from("just some text, not a form"));
  const notForm = await upload(f, text, "notes.txt");
  assert.equal(notForm.status, 422);
  assert.equal((await notForm.json()).code, "FORM_INVALID");
  assert.equal(await store.getFileMeta(A, sha256Hex(text)), null);
});

test("settings: referrer links are the clinic's own; checked and audited", async () => {
  const { as, store } = setup();
  const put = await as("a")(storeApiPaths.settings(), json({ referrerLinks: { "harrow pike": "frm_sample_harrow_pike_tp3" } }));
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).referrerLinks, { "harrow pike": "frm_sample_harrow_pike_tp3" });
  assert.deepEqual((await (await as("a")(storeApiPaths.settings())).json()).referrerLinks, { "harrow pike": "frm_sample_harrow_pike_tp3" });
  assert.deepEqual((await (await as("b")(storeApiPaths.settings())).json()).referrerLinks, {});
  const snap = StoreSnapshotResponseSchema.parse(await (await as("a")(storeApiPaths.snapshot())).json());
  assert.deepEqual(snap.settings.referrerLinks, { "harrow pike": "frm_sample_harrow_pike_tp3" });
  assert.equal((await as("a")(storeApiPaths.settings(), json({ referrerLinks: { x: "bad id with spaces" } }))).status, 422);
  assert.deepEqual(store.auditLog.map((e) => e.action), ["settings.update"]);
});

test("/forms/fill-preview and /render prefer the clinic's stored copy of the form file; the demo path is unchanged", async () => {
  const { as, store } = setup();
  const form = withAttestedConfirmation(formFor(A), "Practice manager", "2026-10-01T09:00:00.000Z");
  const report = reportFor(A, "rpt_render");
  const original = await getSampleForm(HARROW_PIKE_RAW.sampleId ?? "")!.loadFile();
  const b64 = Buffer.from(original).toString("base64");
  const f = as("a");
  const preview = (body: Record<string, unknown>, who: typeof f = f) =>
    who("/api/reports/v1/forms/fill-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, form, mode: "draft", ...body }) });

  // Not stored yet: the request's file is used; without one, 422.
  assert.equal((await preview({ fileBase64: b64 })).status, 200);
  const missing = await preview({});
  assert.equal(missing.status, 422);
  assert.equal((await missing.json()).issues[0].path, "fileBase64");

  // Stored: no fileBase64 needed, and a different file sent along is ignored in favour of the stored copy.
  const sha = sha256Hex(original);
  await store.beginUpload(A, { sha256: sha, fileName: "harrow.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: original.byteLength });
  assert.equal(await store.putChunk(A, sha, 0, original), "written");
  const stored = await preview({});
  assert.equal(stored.status, 200, await stored.clone().text());
  assert.equal(stored.headers.get("x-medreport-render"), "draft");
  assert.equal((await preview({ fileBase64: Buffer.from(fakePdf(5000)).toString("base64") })).status, 200, "server copy preferred");

  // /render: same rule.
  const render = await f("/api/reports/v1/render?format=original", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, form }) });
  assert.equal(render.status, 200, await render.clone().text());
  assert.equal(render.headers.get("x-medreport-render"), "draft");

  // Another clinic (or the public demo, nobody signed in) does not see the stored copy.
  assert.equal((await preview({}, as("b"))).status, 422);
  assert.equal((await preview({}, as(null))).status, 422);
  assert.equal((await preview({ fileBase64: b64 }, as(null))).status, 200);
});
