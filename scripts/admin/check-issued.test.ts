/**
 * bh2 WA1 design 7 – the release rule's check (scripts/admin/check-issued.ts): every approved report of a clinic is
 * issued again from the clinic's store and compared with what its receipt binds. Read-only; ids and outcomes only.
 * Also the clinic's /sign dry run on the STORED form file (tenant mode). Fictional data only (the safety corpus).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReceipt } from "../../src/modules/medreport/auth/sign-receipt";
import type { Report, SignReceipt } from "../../src/modules/medreport/core/types";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, postSign } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { checkIssuedReports } from "./check-issued";

process.env.MEDREPORT_AI_MODE = "demo";

describe("check-issued: approved reports issued again and compared with their receipts (release rule)", () => {
  it("OK when the document and acknowledgements still match; CHANGED when either differs; UNBOUND for an earlier receipt", async () => {
    const h = createHttpHarness();
    const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", origin: "clinician", by: "sarah" }] } }) as CaseInput);
    const form = b.form!;
    const bytes = b.fileBytes!;
    // The clinic holds the form map and the referrer's file (one chunk).
    assert.equal((await h.store.createForm(CORPUS_TENANT, { id: form.id, status: "confirmed", title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form })).ok, true);
    await h.store.beginUpload(CORPUS_TENANT, { sha256: form.file.sha256, fileName: form.file.fileName, mimeType: form.file.mimeType, sizeBytes: bytes.byteLength });
    assert.equal(await h.store.putChunk(CORPUS_TENANT, form.file.sha256, 0, bytes), "written");

    // A clinic's /sign fills the STORED file as a dry run: the receipt binds the issued document.
    const signed = await postSign(h, { report: b.report, template: b.template, form, signer: "sarah", mode: "tenant" });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    const receipt = signed.receipt as SignReceipt;
    assert.match(receipt.issuedContentSha256 ?? "", /^[0-9a-f]{64}$/);
    const store = (id: string, r: Report) => h.store.createReport(CORPUS_TENANT, { id, status: "signed", templateId: r.templateId, formId: form.id, payload: { ...r, id } });
    const approved: Report = { ...b.report, status: "signed", receipt };
    assert.equal((await store(b.report.id, approved)).ok, true);

    // The same report approved with receipts that bind something else, or nothing (before the release).
    const mint = async (id: string, additions?: Parameters<typeof createReceipt>[0]["additions"]) => {
      const report = { ...b.report, id };
      const r = await createReceipt({ report, signer: receipt.signer, statementAccepted: true, attestations: receipt.attestations, formMapSha256: receipt.formMapSha256, now: new Date(receipt.signedAt), ...(additions ? { additions } : {}) });
      assert.equal((await store(id, { ...report, status: "signed", receipt: r })).ok, true);
    };
    await mint("rpt_doc_changed", { issuedContentSha256: "3".repeat(64), acknowledgementsSha256: receipt.acknowledgementsSha256 });
    await mint("rpt_acks_changed", { issuedContentSha256: receipt.issuedContentSha256, acknowledgementsSha256: "4".repeat(64) });
    await mint("rpt_legacy");
    // A draft is not checked.
    assert.equal((await h.store.createReport(CORPUS_TENANT, { id: "rpt_draft", status: "draft", templateId: b.report.templateId, formId: form.id, payload: { ...b.report, id: "rpt_draft" } })).ok, true);

    const rows = await checkIssuedReports(h.store, CORPUS_TENANT);
    const byId = Object.fromEntries(rows.map((r) => [r.reportId, r]));
    assert.equal(byId[b.report.id]?.outcome, "OK");
    assert.deepEqual([byId.rpt_doc_changed?.outcome, byId.rpt_doc_changed?.detail], ["CHANGED", "document"]);
    assert.deepEqual([byId.rpt_acks_changed?.outcome, byId.rpt_acks_changed?.detail], ["CHANGED", "acknowledgements"]);
    assert.equal(byId.rpt_legacy?.outcome, "UNBOUND");
    assert.equal(byId.rpt_draft, undefined);
    // Ids and outcomes only – nothing of the report's content.
    assert.equal(JSON.stringify(rows).includes("physiotherapy"), false);

    // The clinic's map edited after approval: /render refuses that map for this receipt, so there is nothing to compare
    // (check-WA1 minor 7) – MAP_CHANGED, never a false CHANGED.
    const stored = await h.store.getForm(CORPUS_TENANT, form.id);
    const edited = { ...form, fields: form.fields.map((f, i) => (i === 0 ? { ...f, label: `${f.label} (edited)` } : f)) };
    assert.equal((await h.store.updateForm(CORPUS_TENANT, { id: form.id, status: "confirmed", title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: edited }, stored?.rev ?? 1)).ok, true);
    const after = Object.fromEntries((await checkIssuedReports(h.store, CORPUS_TENANT)).map((r) => [r.reportId, r]));
    assert.equal(after[b.report.id]?.outcome, "MAP_CHANGED");
    assert.equal(after.rpt_doc_changed?.outcome, "MAP_CHANGED");
    assert.equal(after.rpt_legacy?.outcome, "UNBOUND");
  });
});
