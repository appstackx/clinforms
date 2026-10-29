/**
 * The rollback shim for the clinic system's connector (fix/native-connector-read-shim, 10/2026).
 *
 * The clinic system (K2) adds connector id "native" (core/schemas.ts ConnectorIdSchema): a report started from the
 * clinic system's own patient record carries it on episodeRef.connectorId and bundleSnapshot.source.connectorId. If
 * production is rolled back from K2 to a build without this shim, every such stored report is unreadable (zod rejects
 * the member). With the shim (core/stored-schemas.ts FORWARD_OPEN_ENUMS opens ConnectorIdSchema for reads only):
 *
 * - the report is listed and read whole (clinic store and this browser's store);
 * - its receipt verifies as issued and its FINAL renders – the same document as the same report from a connector
 *   this build knows (the connector id prints nothing of its own);
 * - anything that needs the connector – "Re-use notes", filing back – is a clean 4xx, never a 500;
 * - writes stay strict (a PUT of such a report is refused), and the display falls back to neutral words.
 *
 * The same file runs on K2 (where "native" is a known member): there the read and render assertions hold as well, and
 * the connector-bound actions are still refused with a 4xx (the test deps have no native connector).
 * Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import PizZip from "pizzip";

process.env.MEDREPORT_AI_MODE = "demo";

import { route } from "../../src/app/api/_medreport-glue";
import { handleDocuments } from "../../src/modules/medreport/api/handlers/documents";
import { CONTENT_TYPES } from "../../src/modules/medreport/api/contract";
import { StoreReportResponseSchema, StoreSnapshotResponseSchema, storeApiPaths } from "../../src/modules/medreport/api/store-contract";
import { createMemoryTenantStore } from "../../src/modules/medreport/api/store-memory";
import { formMapSha256, withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createReceipt, verifyReceipt, verifyReceiptMac } from "../../src/modules/medreport/auth/sign-receipt";
import { FORM_ATTESTATIONS } from "../../src/modules/medreport/core/forms";
import { UNKNOWN_MEMBER_LABELS, connectorIdLabel, isKnownConnectorId } from "../../src/modules/medreport/core/labels";
import { reportFingerprint } from "../../src/modules/medreport/core/fingerprint";
import { ConnectorIdSchema, ReportSchema } from "../../src/modules/medreport/core/schemas";
import { FORWARD_OPEN_ENUMS, StoredReportSchema, StoredSignReceiptSchema } from "../../src/modules/medreport/core/stored-schemas";
import type { Clinician, EpisodeBundle, FormDefinition, Report } from "../../src/modules/medreport/core/types";
import { HARROW_PIKE_FORM as HARROW_PIKE_RAW } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { getSampleForm } from "../../src/modules/medreport/forms/samples/registry";
import { originLabel } from "../../src/modules/medreport/ui/components/review/labels";
import { createServerApi } from "../../src/modules/medreport/ui/store/server-api";
import { reportEventProps } from "../../src/modules/medreport/ui/studio-events";
import { completedSampleReport } from "./form-sample-answers";
import { member, storeDeps, storeFetch } from "./store-harness";
import { demoSessionToken } from "./test-actors";

const CLINIC = "native-shim-clinic";
const OTHER = "native-shim-other";
const SARAH: Clinician = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
const SIGNED_AT = new Date("2026-10-28T11:00:00.000Z");
/** Whether this line knows "native" (K2) or not (main + this shim). */
const NATIVE_KNOWN = isKnownConnectorId("native");

const FORM: FormDefinition = withAttestedConfirmation({ ...HARROW_PIKE_RAW, tenantId: CLINIC }, "Practice manager", "2026-10-01T09:00:00.000Z");

/**
 * The record source exactly as K2 writes it (src/server/pms/integration/bundle.ts loadNativeBundle): connector
 * "native", not simulated, the clinic system's patient and case ids, label CLINIC_SYSTEM_NAME ("Clinic system").
 */
function nativeSource(connectorId: string): EpisodeBundle["source"] {
  return {
    connectorId,
    simulated: false,
    fetchedAt: "2026-10-27T09:00:00.000Z",
    externalPatientId: "pat_native_0001",
    externalEpisodeId: "case_native_0001",
    label: "Clinic system",
  } as unknown as EpisodeBundle["source"];
}

/**
 * The clinician's own words as the Studio stores them (as schema-forward-compat.test.ts withOwnWordsStamped): on a
 * clinic's report with no approver, "clinician" text needs a stamp of a member who may approve.
 */
const OWN_WORDS_BY: NonNullable<Report["sections"][number]["paragraphs"][number]["by"]> = { memberId: "user-sample-clinician", name: "Sam Ward (fictional)", role: "clinician", canSign: true, hcpc: "ZZ0005" };

/** An approved report of the clinic as K2 stores it, from `connectorId` ("native", or a known twin). */
async function approvedReport(connectorId: string, id = "rpt_native_shim"): Promise<Report> {
  const base = completedSampleReport("megan-hart", FORM, { id });
  const source = nativeSource(connectorId);
  const draft = {
    ...base,
    tenantId: CLINIC,
    episodeRef: { connectorId, patientId: source.externalPatientId, episodeId: source.externalEpisodeId },
    bundleSnapshot: { ...base.bundleSnapshot, tenantId: CLINIC, source },
  } as unknown as Report;
  if (!draft.approver) for (const sec of draft.sections) for (const p of sec.paragraphs) if (p.origin === "clinician" && !p.by) p.by = OWN_WORDS_BY;
  const receipt = await createReceipt({
    report: draft,
    signer: SARAH,
    statementAccepted: true,
    attestations: [...FORM_ATTESTATIONS],
    formMapSha256: formMapSha256(FORM),
    approvedVia: { kind: "demo", sid: "sid-approval" },
    now: SIGNED_AT,
  });
  return { ...draft, status: "signed", receipt };
}

const reportRow = (r: Report) => ({ id: r.id, status: r.status, templateId: r.templateId, formId: r.form?.formId ?? null, payload: r });

function clinicStore() {
  const store = createMemoryTenantStore();
  const deps = storeDeps(store, { a: member(CLINIC), b: member(OTHER) });
  return { store, deps, as: (who: string) => storeFetch(deps, { member: who }) };
}

async function harrowFileBase64(): Promise<string> {
  return Buffer.from(await getSampleForm(HARROW_PIKE_RAW.sampleId ?? "")!.loadFile()).toString("base64");
}

async function bodyOf(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = () => Buffer.from(bytes).toString("utf8").slice(0, 2000);
  return { status: res.status, headers: res.headers, bytes, text, json: () => JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown };
}

/** A Word file's parts (name → bytes): two renders of the same content differ only in the ZIP entry timestamps. */
function wordParts(bytes: Uint8Array): Record<string, string> {
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("latin1"), "PK\x03\x04", "a Word file");
  const zip = new PizZip(bytes);
  return Object.fromEntries(
    Object.keys(zip.files)
      .sort()
      .map((name) => [name, zip.files[name].asBinary()]),
  );
}

/* ------------------------------------------------------------------------------------------------ */

test("the read schemas open ConnectorIdSchema; writes stay strict", async () => {
  assert.ok((FORWARD_OPEN_ENUMS as readonly unknown[]).includes(ConnectorIdSchema), "ConnectorIdSchema is a forward-open enum");
  const report = await approvedReport("native");
  assert.deepEqual(StoredReportSchema.parse(report), report, "read whole: nothing dropped or changed");
  assert.equal(ReportSchema.safeParse(report).success, NATIVE_KNOWN, "the write schema takes only the members this line knows");
  // A connector id no line knows is read too (bounded like every open member), and still refused on write.
  const later = structuredClone(report);
  later.episodeRef.connectorId = "later-release-connector" as Report["episodeRef"]["connectorId"];
  assert.equal(StoredReportSchema.safeParse(later).success, true);
  assert.equal(ReportSchema.safeParse(later).success, false);
  const tooLong = structuredClone(report);
  tooLong.episodeRef.connectorId = "x".repeat(81) as Report["episodeRef"]["connectorId"];
  assert.equal(StoredReportSchema.safeParse(tooLong).success, false, "an open member is still bounded");
  const empty = structuredClone(report);
  empty.episodeRef.connectorId = "" as Report["episodeRef"]["connectorId"];
  assert.equal(StoredReportSchema.safeParse(empty).success, false);
});

test("a stored 'native' report is listed and read whole by the clinic's Studio", async () => {
  const { store, as } = clinicStore();
  const report = await approvedReport("native");
  assert.equal((await store.createReport(CLINIC, reportRow(report))).ok, true);
  const f = as("a");

  const snapshot = await bodyOf(await f(storeApiPaths.snapshot()));
  assert.equal(snapshot.status, 200, snapshot.text());
  assert.deepEqual(
    StoreSnapshotResponseSchema.parse(snapshot.json()).reports.map((r) => r.id),
    [report.id],
    "listed",
  );
  const raw = await bodyOf(await f(storeApiPaths.report(report.id)));
  assert.equal(raw.status, 200, raw.text());
  assert.deepEqual(StoreReportResponseSchema.parse(raw.json()).report, report);
  const read = await createServerApi(f).getReport(report.id);
  assert.ok(read);
  assert.deepEqual(read.report, report, "the Studio's copy keeps every key and member");
  // Another clinic still never sees it.
  assert.equal((await as("b")(storeApiPaths.report(report.id))).status, 404);
});

test("public demo store: a 'native' report in this browser is listed and read whole", async () => {
  const report = await approvedReport("native");
  const items = new Map<string, string>();
  const localStorage = {
    get length() {
      return items.size;
    },
    key: (i: number) => Array.from(items.keys())[i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
  };
  const g = globalThis as Record<string, unknown>;
  g.window = { localStorage, sessionStorage: localStorage, dispatchEvent: () => true };
  try {
    const browser = await import("../../src/modules/medreport/ui/store/browser-backend");
    localStorage.setItem(browser.REPORT_KEY_PREFIX + report.id, JSON.stringify(report));
    assert.deepEqual(browser.listReports(), [report]);
    assert.deepEqual(browser.getReport(report.id), report);
  } finally {
    delete g.window;
  }
});

test("its receipt verifies as issued", async () => {
  const report = StoredReportSchema.parse(await approvedReport("native"));
  const receipt = report.receipt!;
  assert.deepEqual(StoredSignReceiptSchema.parse(receipt), receipt);
  assert.equal(await reportFingerprint(report), receipt.contentSha256);
  assert.deepEqual(await verifyReceipt(receipt, report, { tenantId: CLINIC }), { ok: true, contentSha256: receipt.contentSha256 });
  assert.equal(verifyReceiptMac(receipt, { tenantId: CLINIC }), true);
  assert.deepEqual(await verifyReceipt(receipt, report, { tenantId: OTHER }), { ok: false, reason: "TENANT_MISMATCH" });
  // Changing the connector after approval breaks the fingerprint, as for any other change.
  const changed = { ...report, episodeRef: { ...report.episodeRef, connectorId: "file-import" as const } };
  assert.deepEqual(await verifyReceipt(receipt, changed), { ok: false, reason: "HASH_MISMATCH" });
});

test("its FINAL renders from what the Studio read – the same document as the same report from a connector this build knows", async () => {
  const { store, as } = clinicStore();
  const native = await approvedReport("native");
  assert.equal((await store.createReport(CLINIC, reportRow(native))).ok, true);
  const f = as("a");
  const read = await createServerApi(f).getReport(native.id);
  assert.ok(read);
  const fileBase64 = await harrowFileBase64();
  const render = (r: Report) =>
    f("/api/reports/v1/render?format=original", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: r, receipt: r.receipt, form: FORM, fileBase64, requireFinal: true }),
    });
  const final = await bodyOf(await render(read.report));
  assert.equal(final.status, 200, final.text());
  assert.equal(final.headers.get("x-medreport-render"), "final");
  assert.equal(final.headers.get("x-medreport-content-sha256"), native.receipt!.contentSha256);

  // The twin: the same record from the real TM3 connector (not simulated, same label). The connector id is not printed,
  // so the FINAL documents are identical part for part.
  const twin = await approvedReport("tm3", "rpt_native_shim_twin");
  const twinFinal = await bodyOf(await render(twin));
  assert.equal(twinFinal.headers.get("x-medreport-render"), "final", twinFinal.text());
  assert.equal(final.headers.get("content-type"), twinFinal.headers.get("content-type"));
  const strip = (parts: Record<string, string>) =>
    Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.split(native.id).join("ID").split(twin.id).join("ID")]));
  assert.deepEqual(strip(wordParts(final.bytes)), strip(wordParts(twinFinal.bytes)), "FINAL documents are identical, byte for byte");
});

test("'Re-use notes' on a 'native' report is a clean 4xx, never a 500; another clinic's is the same 404 as ever", async () => {
  const { store, as } = clinicStore();
  const report = await approvedReport("native");
  assert.equal((await store.createReport(CLINIC, reportRow(report))).ok, true);
  const before = store.auditLog.length;
  const reuse = (who: string) =>
    as(who)(storeApiPaths.reportReuse(report.id), { method: "POST", headers: { "content-type": CONTENT_TYPES.json }, body: "{}" });

  const res = await bodyOf(await reuse("a"));
  assert.ok(res.status >= 400 && res.status < 500, `${res.status} ${res.text()}`);
  const problem = res.json() as { code: string; title: string; detail: string };
  if (!NATIVE_KNOWN) {
    assert.equal(res.status, 403);
    assert.equal(problem.code, "CONNECTOR_NOT_AVAILABLE");
    assert.match(problem.detail, /clinic system/);
    assert.doesNotMatch(JSON.stringify(problem), /TM3|native|Megan|Hart/, "neutral words, no ids or patient data");
  }
  assert.equal(store.auditLog.length, before, "nothing reused, nothing audited");
  assert.equal((await reuse("b")).status, 404, "another clinic: not found, as for any report");
});

test("filing a 'native' report back is a clean 4xx (no such connector here), never a 500", async () => {
  const report = await approvedReport("native");
  const body = {
    patientId: report.episodeRef.patientId,
    episodeId: report.episodeRef.episodeId,
    title: "Harrow & Pike form – Megan Hart",
    fileName: "Hart_M_Harrow-Pike_SIGNED.docx",
    mimeType: CONTENT_TYPES.docx,
    contentBase64: Buffer.from("not a real file").toString("base64"),
    sha256: createHash("sha256").update("not a real file").digest("hex"),
    signReceipt: report.receipt,
    fileToken: "not-a-token",
  };
  const res = await route(handleDocuments)(
    new Request("http://127.0.0.1:9/api/reports/v1/connectors/native/documents", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${demoSessionToken()}` },
      body: JSON.stringify(body),
    }),
    { params: { id: "native" } },
  );
  assert.ok(res.status >= 400 && res.status < 500, `${res.status} ${await res.text()}`);
});

test("a clinic's store refuses to WRITE a report from a connector this build does not know (writes stay strict)", async () => {
  const { as } = clinicStore();
  const report = { ...(await approvedReport("later-release-connector", "rpt_native_shim_write")), status: "draft" } as Report;
  delete report.receipt;
  const res = await as("a")(storeApiPaths.report(report.id), { method: "PUT", headers: { "content-type": CONTENT_TYPES.json }, body: JSON.stringify({ report }) });
  assert.ok(res.status >= 400 && res.status < 500, `${res.status}`);
});

test("display: an unknown connector id falls back to neutral words; every known connector reads exactly as before", async () => {
  // originLabel: as before for every known connector; a connector this build does not know is the clinic's own record.
  assert.equal(originLabel("from_records", "file-import"), "From clinic records");
  assert.equal(originLabel("from_records", "tm3"), "From TM3 records");
  assert.equal(originLabel("from_records", "tm3-sim"), "From TM3 records");
  assert.equal(originLabel("from_records", "native" as never), "From clinic records");
  assert.equal(originLabel("from_records", "later-release-connector" as never), "From clinic records");

  // The Studio's event source.
  const props = async (connectorId: string) => reportEventProps(await approvedReport(connectorId)).source;
  assert.equal(await props("tm3"), "clinic_system");
  assert.equal(await props("tm3-sim"), "simulated_clinic_system");
  assert.equal(await props("file-import"), "export_upload");
  assert.equal(await props("native"), "clinic_system");
  assert.equal(await props("later-release-connector"), "clinic_system");

  // The home list's source line (when a record has no label): the id for a known connector, as before.
  for (const id of ConnectorIdSchema.options) assert.equal(connectorIdLabel(id), id);
  assert.equal(connectorIdLabel("later-release-connector"), UNKNOWN_MEMBER_LABELS.connectorId);
  assert.equal(UNKNOWN_MEMBER_LABELS.connectorId, "Clinic system");
  assert.equal(isKnownConnectorId("__proto__"), false);
  assert.equal(isKnownConnectorId("constructor"), false);
});
