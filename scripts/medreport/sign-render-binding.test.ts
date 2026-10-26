/**
 * bh2 WA1 design 6–7 (R-security-1, E5, AC-ISSUE-1, AC-ISSUE-5, AC-ISSUE-6): /sign binds what is issued, /render FINAL
 * issues exactly that – or refuses.
 *
 * - /sign runs a dry-run FINAL fill of the referrer's file with the receipt's own signer and time; the MAC-covered
 *   receipt records the document's content hash and the hash of the acknowledgements the approval relied on.
 * - /render FINAL fills again and compares: changing only what the receipt does not cover (flags, activity, status,
 *   updatedAt) gives 409 or the identical document, never a different one; a receipt whose hashes do not match gives an
 *   audited 409 ISSUED_COPY_CHANGED; a receipt from before the release renders exactly as before.
 * - In a clinic's Studio /sign approves exactly the stored revision (409 STALE_REPORT otherwise) – never a report the
 *   clinic does not hold, never when its store cannot be read; its dry run fills the clinic's file (409 ISSUE_REFUSED
 *   when none is at hand). The public demo sends the file with the approval (422 without it), except for a bundled form.
 * - A merge code in a box that issues nothing is cleared, so an approval is never followed by a refused FINAL copy;
 *   one in an optional blank box blocks; when the validators do not know of a code, the dry run still refuses
 *   (409 ISSUE_REFUSED) – never "approved, then 422".
 *
 * Fictional data only: the safety corpus's fictional clinic and synthetic forms.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleRender } from "../../src/modules/medreport/api/handlers/render";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { bindHandler } from "../../src/modules/medreport/api/http";
import type { AuditEvent, MedreportDeps } from "../../src/modules/medreport/api/deps";
import { withAttestedConfirmation } from "../../src/modules/medreport/auth/attestations";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import { createReceipt } from "../../src/modules/medreport/auth/sign-receipt";
import type { FormDefinition, Report, SignReceipt } from "../../src/modules/medreport/core/types";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { mutateOutsideReceipt } from "../../src/modules/medreport/core/validation/__corpus__/harness/evaluate";
import { CORPUS_TENANT, clinicianOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { FORM_ATTESTATIONS } from "../../src/modules/medreport/core/forms";
import { HARROW_PIKE_FORM } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { completedSampleReport } from "./form-sample-answers";
import { bytesToBase64, createHttpHarness, postRenderFinal, postSign, putStoredReport } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { openZipSafely } from "../../src/modules/medreport/forms/zip-guard";
import { issuedContentSha256 } from "../../src/modules/medreport/api/handlers/sign/receipt";

process.env.MEDREPORT_AI_MODE = "demo";

async function built(input: Record<string, unknown>, signMode: "tenant" | "demo" = "demo"): Promise<Built> {
  return buildCase(CaseInputSchema.parse({ ...input, signMode }) as CaseInput, { signMode });
}

interface Res {
  status: number;
  code: string | null;
  json: Record<string, unknown> | null;
  bytes: Uint8Array | null;
  headers: Headers;
}

const demoAuth = () => ({ authorization: `Bearer ${createSessionToken({ tenantId: "demo", kind: "demo" }).token}` });

async function call(deps: MedreportDeps, handler: typeof handleSign, url: string, body: unknown): Promise<Res> {
  const req = new Request(`http://localhost/api/reports/v1${url}`, { method: "POST", headers: { "content-type": "application/json", ...demoAuth() }, body: JSON.stringify(body) });
  const res = await bindHandler(handler, () => deps)(req, { params: {} });
  if (/json/.test(res.headers.get("content-type") ?? "")) {
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, code: (json.code as string) ?? null, json, bytes: null, headers: res.headers };
  }
  return { status: res.status, code: null, json: null, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
}

/** The public demo's approval: the fictional signer, and (with `file`) the referrer's file for the dry run. */
async function demoSign(deps: MedreportDeps, b: Built, opts: { file?: boolean } = { file: true }): Promise<Res & { receipt: SignReceipt | null }> {
  const body = {
    report: b.report,
    signer: clinicianOf("sarah"),
    typedSignature: "Sarah Reid",
    statementAccepted: true,
    attestations: [...b.template.attestations],
    form: b.form,
    ...(opts.file !== false && b.fileBytes ? { fileBase64: bytesToBase64(b.fileBytes) } : {}),
  };
  const res = await call(deps, handleSign, "/sign", body);
  return { ...res, receipt: res.status === 200 ? ((res.json as { receipt: SignReceipt }).receipt ?? null) : null };
}

async function demoRender(deps: MedreportDeps, b: Built, report: Report, receipt: SignReceipt): Promise<Res> {
  return call(deps, handleRender as typeof handleSign, "/render?format=original", { report, receipt, requireFinal: true, form: b.form, fileBase64: bytesToBase64(b.fileBytes as Uint8Array) });
}

function documentText(bytes: Uint8Array): string {
  const xml = openZipSafely(bytes).file("word/document.xml")?.asText() ?? "";
  return xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
}

const NA_CASE = { report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", origin: "clinician", by: "sarah" }] } };

describe("/sign binds the issued document; /render FINAL issues exactly it (R-security-1, E5)", () => {
  it("the receipt carries the issued document's hash and the acknowledgements' hash; FINAL matches it", async () => {
    const { deps } = createHttpHarness();
    const b = await built(NA_CASE);
    const signed = await demoSign(deps, b);
    assert.equal(signed.status, 200, JSON.stringify(signed.json));
    const receipt = signed.receipt as SignReceipt;
    assert.match(receipt.issuedContentSha256 ?? "", /^[0-9a-f]{64}$/);
    assert.match(receipt.acknowledgementsSha256 ?? "", /^[0-9a-f]{64}$/);
    const approved: Report = { ...b.report, status: "signed", receipt };
    const first = await demoRender(deps, b, approved, receipt);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.headers.get("x-medreport-render"), "final");
    assert.equal(issuedContentSha256(first.bytes as Uint8Array), receipt.issuedContentSha256, "the FINAL file is the document checked at approval");
    assert.equal(documentText(first.bytes as Uint8Array).includes("More physiotherapy is advised."), false, "a box that does not apply prints nothing");
  });

  it("changing only flags, activity, status or updatedAt gives 409 or the identical document – never a different one (AC-ISSUE-1)", async () => {
    const { deps } = createHttpHarness();
    for (const input of [NA_CASE, { report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "Tom Ellis discharged him to self-management.", cites: ["N-002"] }] }, dispositions: { "F-06": { kind: "applies_anyway", by: "sarah", reason: "It applies." } } }]) {
      const b = await built(input);
      const signed = await demoSign(deps, b);
      assert.equal(signed.status, 200, JSON.stringify(signed.json));
      const receipt = signed.receipt as SignReceipt;
      const approved: Report = { ...b.report, status: "signed", receipt, flags: (signed.json as { flags: Report["flags"] }).flags };
      const base = await demoRender(deps, b, approved, receipt);
      assert.equal(base.status, 200);
      for (const kinds of [["flags-ack-na"], ["activity-answer-set"], ["status-draft"], ["updatedAt"], ["flags-clear"], ["flags-ack-na", "activity-answer-set", "status-draft", "updatedAt"]]) {
        const forged = await demoRender(deps, b, mutateOutsideReceipt(approved, kinds), receipt);
        if (forged.status === 409) continue;
        assert.equal(forged.status, 200, `${kinds.join("+")}: ${JSON.stringify(forged.json)}`);
        assert.equal(documentText(forged.bytes as Uint8Array), documentText(base.bytes as Uint8Array), `${kinds.join("+")}: identical text`);
      }
    }
  });

  it("a receipt whose hashes do not match is refused with an audited 409 ISSUED_COPY_CHANGED", async () => {
    const h = createHttpHarness();
    const audit: AuditEvent[] = [];
    (h.deps as MedreportDeps & { audit: MedreportDeps["audit"] }).audit = async (_t, e) => {
      audit.push(e);
    };
    // Tenant mode (the clinic's audit trail): sign as Sarah, then mint receipts that differ only in one bound hash.
    const b = await built(NA_CASE, "tenant");
    const signed = await postSign(h, { report: b.report, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    const good = signed.receipt as SignReceipt;
    const { mac: _mac, contentSha256: _c, reportId: _r, tenantId: _t, signedAt, ...rest } = good;
    for (const additions of [{ acknowledgementsSha256: "1".repeat(64) }, { acknowledgementsSha256: good.acknowledgementsSha256, issuedContentSha256: "2".repeat(64) }]) {
      const bad = await createReceipt({ report: b.report, signer: rest.signer, statementAccepted: true, attestations: rest.attestations, formMapSha256: rest.formMapSha256, approvedVia: rest.approvedVia, now: new Date(signedAt), additions });
      const res = await postRenderFinal(h, { report: { ...b.report, status: "signed", receipt: bad }, receipt: bad, form: b.form, fileBytes: b.fileBytes, member: "sarah", mode: "tenant" });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.code, "ISSUED_COPY_CHANGED");
    }
    assert.ok(audit.some((e) => (e.detail as Record<string, unknown>)?.refused === "ISSUED_COPY_CHANGED" && (e.detail as Record<string, unknown>)?.what === "acknowledgements"));
    assert.ok(audit.some((e) => (e.detail as Record<string, unknown>)?.refused === "ISSUED_COPY_CHANGED" && (e.detail as Record<string, unknown>)?.what === "document"));
  });

  it("a receipt from before the release (no bound hashes) renders exactly the release's document (AC-ISSUE-6)", async () => {
    const { deps } = createHttpHarness();
    const b = await built(NA_CASE);
    const signed = await demoSign(deps, b);
    const receipt = signed.receipt as SignReceipt;
    const bound = await demoRender(deps, b, { ...b.report, status: "signed", receipt }, receipt);
    const legacy = await createReceipt({ report: b.report, signer: receipt.signer, statementAccepted: true, attestations: receipt.attestations, formMapSha256: receipt.formMapSha256, approvedVia: receipt.approvedVia, now: new Date(receipt.signedAt) });
    assert.equal("issuedContentSha256" in legacy, false);
    const old = await demoRender(deps, b, { ...b.report, status: "signed", receipt: legacy }, legacy);
    assert.equal(old.status, 200, JSON.stringify(old.json));
    assert.equal(old.headers.get("x-medreport-render"), "final");
    assert.equal(issuedContentSha256(old.bytes as Uint8Array), issuedContentSha256(bound.bytes as Uint8Array));
  });
});

describe("/sign approves what the clinic holds (WA1 design 6, C6)", () => {
  it("the stored revision approves; an edited or overtaken body is refused 409 STALE_REPORT", async () => {
    const h = createHttpHarness();
    const b = await built({ report: "template:solicitor_rta", box: "progress_current_status", paragraph: { text: "On 06/05/2026 Tom Ellis recorded that Mr Testcase was working amended duties.", cites: ["N-002"] } }, "tenant");
    const seeded = await putStoredReport(h, b.report, "sarah", null);
    assert.equal(seeded.status, 201);
    const same = await postSign(h, { report: b.report, template: b.template, form: null, signer: "sarah", mode: "tenant" });
    assert.equal(same.status, 200, JSON.stringify(same.body));
    // Flags, activity and updatedAt are not content: still the stored revision.
    const touched = await postSign(h, { report: { ...b.report, flags: [], updatedAt: "2026-10-22T10:00:00.000Z", activity: [] }, template: b.template, form: null, signer: "sarah", mode: "tenant" });
    assert.equal(touched.status, 200, JSON.stringify(touched.body));
    const edited = { ...b.report, sections: b.report.sections.map((s) => (s.key === "progress_current_status" ? { ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: `${p.text} He was seen again.` })) } : s)) };
    const refused = await postSign(h, { report: edited, template: b.template, form: null, signer: "sarah", mode: "tenant" });
    assert.equal(refused.status, 409);
    assert.equal(refused.code, "STALE_REPORT");
  });
});

/** POST /sign as a member of the corpus clinic, exactly as sent – nothing stored first (the harness's postSign stores). */
async function tenantSign(h: ReturnType<typeof createHttpHarness>, b: Built, report: Report, opts: { file?: boolean } = {}): Promise<Res & { receipt: SignReceipt | null }> {
  const body = {
    report,
    signer: clinicianOf("sarah"),
    typedSignature: "Sarah Reid",
    statementAccepted: true,
    attestations: [...b.template.attestations],
    ...(b.form ? { form: b.form } : {}),
    ...(opts.file && b.fileBytes ? { fileBase64: bytesToBase64(b.fileBytes) } : {}),
  };
  const req = new Request("http://localhost/api/reports/v1/sign", { method: "POST", headers: { "content-type": "application/json", "x-corpus-member": "sarah" }, body: JSON.stringify(body) });
  const res = await bindHandler(handleSign, () => h.deps)(req, { params: {} });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, code: (json.code as string) ?? null, json, bytes: null, headers: res.headers, receipt: res.status === 200 ? ((json as { receipt: SignReceipt }).receipt ?? null) : null };
}

/** The stored-copy row of a report (the clinic's store, as a Studio save leaves it). */
const storeRow = (r: Report) => ({ id: r.id, status: r.status, templateId: r.templateId, formId: r.form?.formId ?? null, payload: r });

/** The clinic's store holding the referrer's file of `b` (one chunk). */
async function storeFile(h: ReturnType<typeof createHttpHarness>, b: Built): Promise<void> {
  const form = b.form as FormDefinition;
  const bytes = b.fileBytes as Uint8Array;
  await h.store.beginUpload(CORPUS_TENANT, { sha256: form.file.sha256, fileName: form.file.fileName, mimeType: form.file.mimeType, sizeBytes: bytes.byteLength });
  assert.equal(await h.store.putChunk(CORPUS_TENANT, form.file.sha256, 0, bytes), "written");
}

const TEXT_CASE = { report: "template:solicitor_rta", box: "progress_current_status", paragraph: { text: "On 06/05/2026 Tom Ellis recorded that Mr Testcase was working amended duties.", cites: ["N-002"] } };

describe("a clinic's /sign never approves what it cannot check (check-WA1 M1: it fails closed)", () => {
  it("a report the clinic does not hold – never stored, or an edited copy under a new id – is refused 409 STALE_REPORT", async () => {
    const h = createHttpHarness();
    const b = await built(TEXT_CASE, "tenant");
    const never = await tenantSign(h, b, b.report);
    assert.deepEqual([never.status, never.code], [409, "STALE_REPORT"], JSON.stringify(never.json));
    assert.equal((await h.store.createReport(CORPUS_TENANT, storeRow(b.report))).ok, true);
    assert.equal((await tenantSign(h, b, b.report)).status, 200, "the stored revision approves");
    const edited = { ...b.report, id: `${b.report.id}x`, sections: b.report.sections.map((s) => (s.key === "progress_current_status" ? { ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, text: `${p.text} He was seen again.` })) } : s)) };
    const renamed = await tenantSign(h, b, edited);
    assert.deepEqual([renamed.status, renamed.code], [409, "STALE_REPORT"]);
  });

  it("a store that cannot be read refuses (409 STALE_REPORT); only a deployment without data keys has no store to check", async () => {
    const h = createHttpHarness();
    const b = await built(TEXT_CASE, "tenant");
    assert.equal((await h.store.createReport(CORPUS_TENANT, storeRow(b.report))).ok, true);
    const store = h.store as unknown as { getReport: (...a: unknown[]) => Promise<unknown> };
    const getReport = store.getReport.bind(store);
    try {
      store.getReport = async () => {
        throw new Error("D1_ERROR: network connection lost");
      };
      const failed = await tenantSign(h, b, b.report);
      assert.deepEqual([failed.status, failed.code], [409, "STALE_REPORT"], JSON.stringify(failed.json));
      // No data keys at all (src/server/crypto DataCryptoError "BAD_KEYRING"): nothing can be held, so there is nothing to check.
      store.getReport = async () => {
        throw Object.assign(new Error("CLINFORMS_DATA_KEYS is not set."), { name: "DataCryptoError", code: "BAD_KEYRING" });
      };
      assert.equal((await tenantSign(h, b, b.report)).status, 200);
    } finally {
      store.getReport = getReport;
    }
  });

  it("the dry run fills the clinic's file: none at hand, or a store that cannot read it, refuses 409 ISSUE_REFUSED – never an unbound approval", async () => {
    const h = createHttpHarness();
    const b = await built(NA_CASE, "tenant");
    assert.equal((await h.store.createReport(CORPUS_TENANT, storeRow(b.report))).ok, true);
    const none = await tenantSign(h, b, b.report);
    assert.deepEqual([none.status, none.code], [409, "ISSUE_REFUSED"], JSON.stringify(none.json));
    // The browser's copy, checked against the map's SHA-256, when the clinic holds none.
    const sent = await tenantSign(h, b, b.report, { file: true });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.match(sent.receipt?.issuedContentSha256 ?? "", /^[0-9a-f]{64}$/);
    // The clinic's stored copy.
    await storeFile(h, b);
    const held = await tenantSign(h, b, b.report);
    assert.equal(held.status, 200, JSON.stringify(held.json));
    assert.equal(held.receipt?.issuedContentSha256, sent.receipt?.issuedContentSha256, "the same document either way");
    const files = h.store as unknown as { getFile: (...a: unknown[]) => Promise<unknown> };
    const getFile = files.getFile.bind(files);
    try {
      files.getFile = async () => {
        throw new Error("chunk 0 does not decrypt");
      };
      const unreadable = await tenantSign(h, b, b.report, { file: true });
      assert.deepEqual([unreadable.status, unreadable.code], [409, "ISSUE_REFUSED"], JSON.stringify(unreadable.json));
    } finally {
      files.getFile = getFile;
    }
  });

  it("the public demo sends the referrer's file with the approval (422 without it); a bundled form is completed with the server's own copy", async () => {
    const { deps } = createHttpHarness();
    const b = await built(NA_CASE);
    const missing = await demoSign(deps, b, { file: false });
    assert.deepEqual([missing.status, missing.code], [422, "VALIDATION_FAILED"], JSON.stringify(missing.json));
    assert.equal((missing.json as { issues?: Array<{ path: string }> }).issues?.[0]?.path, "fileBase64");
    const sample = withAttestedConfirmation(HARROW_PIKE_FORM, "Practice manager", "2026-10-01T09:00:00.000Z");
    const report = completedSampleReport("megan-hart", sample);
    const res = await call(deps, handleSign, "/sign", { report, signer: clinicianOf("sarah"), typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...FORM_ATTESTATIONS], form: sample });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.match((res.json as { receipt: SignReceipt }).receipt.issuedContentSha256 ?? "", /^[0-9a-f]{64}$/, "bound to the bundled file");
  });
});

describe("the /sign dry run: never an approval followed by a refused FINAL copy (AC-ISSUE-5)", () => {
  it("a merge code in a box ruled out by its condition: approvable, and cleared from the issued form", async () => {
    const { deps } = createHttpHarness();
    const b = await built({ report: "form:cf-merge", answers: { "F-02": false }, boxes: { "F-04": [{ text: "None.", origin: "clinician", by: "sarah" }] } });
    const signed = await demoSign(deps, b);
    assert.equal(signed.status, 200, JSON.stringify(signed.json));
    const final = await demoRender(deps, b, { ...b.report, status: "signed", receipt: signed.receipt as SignReceipt }, signed.receipt as SignReceipt);
    assert.equal(final.status, 200, JSON.stringify(final.json));
    assert.equal(documentText(final.bytes as Uint8Array).includes("<<P_"), false);
  });

  it("a merge code in an optional box left blank blocks approval", async () => {
    const { deps } = createHttpHarness();
    const b = await built({ report: "form:cf-merge", answers: { "F-02": true }, boxes: { "F-03": [{ text: "Four more weeks of exercise.", origin: "clinician", by: "sarah" }] } });
    const signed = await demoSign(deps, b);
    assert.equal(signed.status, 409);
    assert.equal(signed.code, "SIGNOFF_BLOCKED");
  });

  it("a code the validators do not know of (no record of it on the map): the dry run refuses – 409 ISSUE_REFUSED, no receipt", async () => {
    const { deps } = createHttpHarness();
    const b = await built({ report: "form:cf-merge", answers: { "F-02": true }, boxes: { "F-03": [{ text: "Four more weeks of exercise.", origin: "clinician", by: "sarah" }] } });
    const { mergeFields: _m, ...analysis } = (b.form as FormDefinition).analysis;
    const form = withAttestedConfirmation({ ...(b.form as FormDefinition), analysis }, "Pat Morgan", "2026-10-21T09:00:00.000Z");
    const signed = await demoSign(deps, { ...b, form });
    assert.equal(signed.status, 409, JSON.stringify(signed.json));
    assert.equal(signed.code, "ISSUE_REFUSED");
    assert.equal(signed.receipt, null);
    // Without the file there is nothing to fill: the approval is refused (never "approved, then 422" – check-WA1 M1).
    const noFile = await demoSign(deps, { ...b, form }, { file: false });
    assert.equal(noFile.status, 422, JSON.stringify(noFile.json));
    assert.equal(noFile.code, "VALIDATION_FAILED");
    assert.equal(noFile.receipt, null);
  });

  it("a staff-prepared report approved by Sarah, with a first-person paragraph on her own notes, renders FINAL", async () => {
    const h = createHttpHarness();
    const b = await built(
      { report: "form:cf-discharge", author: null, approver: "sarah", box: "F-32", paragraph: { text: "At my initial assessment on 18/03/2026 lumbar flexion was 50% limited.", cites: ["N-001"], origin: "edited", by: "pat" } },
      "tenant",
    );
    const signed = await postSign(h, { report: b.report, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    const final = await postRenderFinal(h, { report: { ...b.report, status: "signed", receipt: signed.receipt as SignReceipt }, receipt: signed.receipt as SignReceipt, form: b.form, fileBytes: b.fileBytes, member: "sarah", mode: "tenant" });
    assert.equal(final.status, 200, JSON.stringify(final.body));
    assert.equal(final.headers.get("x-medreport-render"), "final");
  });
});
