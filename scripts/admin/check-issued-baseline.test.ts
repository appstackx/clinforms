/**
 * bh2 fix round 1 (R1T-WA1-01 / RG-1): the release rule's check for approvals made BEFORE this release. Such a receipt
 * (production minted it – no issued-document or acknowledgement hash) used to be reported UNBOUND, so the pre-deploy
 * gate compared nothing. Now its FINAL copy is issued twice – by this build, exactly as /render FINAL issues it, and by
 * PRODUCTION's own code (a `git archive` of the production commit) – and compared: SAME, or CHANGED with what differs
 * (ids and counts only). Fictional data only (the safety corpus's form and people).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createReceipt } from "../../src/modules/medreport/auth/sign-receipt";
import { productionFormAnswers } from "../../src/modules/medreport/core/forms";
import type { Report, SignReceipt } from "../../src/modules/medreport/core/types";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, postRenderFinal, postSign, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { docxPlainText } from "../../src/modules/medreport/docgen/docx";
import { BLOCKING_OUTCOMES, RELEASE_CODE, baselineTree, checkIssuedReports, loadProductionCode, type IssuingCode } from "./check-issued";

process.env.MEDREPORT_AI_MODE = "demo";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
/** The production commit (main = c883ce5 = e132057 + the PDF font fix + the rollback shim, 26/10/2026). */
const PRODUCTION = process.env.CHECK_ISSUED_BASELINE ?? "c883ce5";

function hasCommit(ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A report as production made it: no reportModel, approver, frozen condition or person's decision. */
function productionMade(report: Report): Report {
  const out = { ...report, sections: report.sections.map(({ condition: _c, disposition: _d, ...s }) => s) } as Report;
  delete (out as { reportModel?: number }).reportModel;
  delete (out as { approver?: unknown }).approver;
  return out;
}

/** The fictional discharge form, answered as production approved it: "Is more treatment advised?" = No, then a line in "If yes, …". */
const LEGACY: Record<string, unknown> = {
  report: "form:cf-discharge",
  answers: { "F-05": false, "F-37": "A little", "F-38": true },
  box: "F-06",
  paragraph: { text: "Two further sessions of physiotherapy are advised.", cites: [], origin: "clinician", by: "sarah" },
  boxes: { "F-26": [{ text: "45 minutes", cites: [], origin: "clinician", by: "sarah" }] },
};

async function built(input: Record<string, unknown>): Promise<Built> {
  return buildCase(CaseInputSchema.parse(input) as CaseInput);
}

/** Approve as production did: the release's /sign for signer, time and map, then a receipt without the release's hashes. */
async function approveAsProduction(h: HttpHarness, b: Built, report: Report): Promise<SignReceipt> {
  const signed = await postSign(h, { report, template: b.template, form: b.form, signer: "sarah", mode: b.tenantId === CORPUS_TENANT ? "tenant" : "demo", fileBytes: b.fileBytes });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const r = signed.receipt as SignReceipt;
  return createReceipt({ report, signer: r.signer, statementAccepted: true, attestations: [...r.attestations], ...(r.formMapSha256 ? { formMapSha256: r.formMapSha256 } : {}), ...(r.approvedVia ? { approvedVia: r.approvedVia } : {}), now: new Date(r.signedAt) });
}

async function clinicWith(h: HttpHarness, b: Built): Promise<void> {
  const form = b.form!;
  assert.equal((await h.store.createForm(CORPUS_TENANT, { id: form.id, status: "confirmed", title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form })).ok, true);
  await h.store.beginUpload(CORPUS_TENANT, { sha256: form.file.sha256, fileName: form.file.fileName, mimeType: form.file.mimeType, sizeBytes: b.fileBytes!.byteLength });
  assert.equal(await h.store.putChunk(CORPUS_TENANT, form.file.sha256, 0, b.fileBytes!), "written");
}

const skip = hasCommit(PRODUCTION) ? false : `no git history for ${PRODUCTION}`;

describe("check-issued: an approval made before this release is compared with production's own FINAL copy (R1T-WA1-01)", { skip, timeout: 5 * 60_000 }, () => {
  let production: IssuingCode;

  it("loads production's code as a separate build, and refuses a baseline that already holds this release", async () => {
    const tree = baselineTree(PRODUCTION, ROOT);
    production = await loadProductionCode(tree.dir);
    assert.notEqual(production.finalAnswers, RELEASE_CODE.finalAnswers);
    await assert.rejects(() => loadProductionCode(ROOT), /issue state/);
  });

  it("SAME where this build issues what production issued; CHANGED – with the reason – where it does not; NOT_COMPARED without a baseline", async () => {
    const h = createHttpHarness();
    const b = await built(LEGACY);
    await clinicWith(h, b);
    const store = (id: string, r: Report, formId = b.form!.id) => h.store.createReport(CORPUS_TENANT, { id, status: "signed", templateId: r.templateId, formId, payload: { ...r, id } });

    // 0. A fictional initial-assessment form, production-made, "If yes, describe them" answered after a No: identical.
    const i = await built({ report: "form:cf-initial", answers: { "F-07": false, "F-04": "Yes" }, box: "F-08", paragraph: { text: "Worry about lifting at work.", cites: [], origin: "clinician", by: "sarah" } });
    await clinicWith(h, i);
    const initial = { ...productionMade(i.report), id: "rpt_legacy_same" };
    const r0 = await approveAsProduction(h, i, initial);
    assert.equal((await store(initial.id, { ...initial, status: "signed", receipt: r0 }, i.form!.id)).ok, true);

    // 1. The discharge form, production-made, every box answered, the "If yes" line after a No: the answers are
    //    production's; on bh2-rc1's forms engine one cell is laid out differently (WA2's negative-right-indent fix) –
    //    CHANGED "layout only". (With WA2's frozen pre-release engine, R1T-WA2-02, it is SAME.)
    const legacy = { ...productionMade(b.report), id: "rpt_legacy_layout" };
    const receipt = await approveAsProduction(h, b, legacy);
    assert.equal((await store(legacy.id, { ...legacy, status: "signed", receipt })).ok, true);

    // 2. The same, but "Session length" left unanswered – production printed its default; bh2-rc1's engine refuses that
    //    copy (never a different one). (With WA2's frozen pre-release engine it issues production's: SAME.)
    const withDefault = productionMade(
      (await built({ ...LEGACY, boxes: {} })).report,
    );
    const defaultReport = { ...withDefault, id: "rpt_legacy_default" };
    const r2 = await approveAsProduction(h, b, defaultReport);
    assert.equal((await store(defaultReport.id, { ...defaultReport, status: "signed", receipt: r2 })).ok, true);

    const rows = await checkIssuedReports(h.store, CORPUS_TENANT, { production });
    const byId = Object.fromEntries(rows.map((r) => [r.reportId, r]));
    assert.equal(byId.rpt_legacy_same?.receipt, "pre-release");
    assert.deepEqual([byId.rpt_legacy_same?.outcome, byId.rpt_legacy_same?.detail], ["SAME", "Word: identical"], JSON.stringify(byId.rpt_legacy_same));
    // R1T-WA1-01's guarantee, whichever forms engine issues it: never different answers, never different text – the copy
    // is production's, or laid out differently with the same text, or refused (each reported, never silent).
    const layout = byId.rpt_legacy_layout;
    assert.ok(layout?.outcome === "SAME" || (layout?.outcome === "CHANGED" && /^Word: layout only \(same text\); the answers are the same/.test(layout.detail ?? "")), JSON.stringify(layout));
    const withDefaultRow = byId.rpt_legacy_default;
    assert.ok(withDefaultRow?.outcome === "SAME" || (withDefaultRow?.outcome === "CHANGED" && /^this build refuses the final copy \(422 FORM_INVALID\); the answers are the same/.test(withDefaultRow.detail ?? "")), JSON.stringify(withDefaultRow));
    for (const row of rows) assert.equal(/Word text: \d+ lines? differ|answers differ in/.test(row.detail ?? ""), false, JSON.stringify(row));
    assert.ok(BLOCKING_OUTCOMES.includes("CHANGED"));
    // Ids, counts and codes only – never the report's wording.
    assert.equal(JSON.stringify(rows).includes("physiotherapy"), false);
    assert.equal(JSON.stringify(rows).includes("45 minutes"), false);

    // Without production's code the gate is NOT passed (it compared nothing).
    const blind = Object.fromEntries((await checkIssuedReports(h.store, CORPUS_TENANT)).map((r) => [r.reportId, r]));
    assert.equal(blind.rpt_legacy_same?.outcome, "NOT_COMPARED");
    assert.ok(BLOCKING_OUTCOMES.includes("NOT_COMPARED"));
  });

  it("CHANGED names the boxes whose answers differ, by id – the earlier run-time condition reading, had it stayed, is caught", async () => {
    const h = createHttpHarness();
    const b = await built(LEGACY);
    await clinicWith(h, b);
    const legacy = { ...productionMade(b.report), id: "rpt_legacy_reading" };
    const receipt = await approveAsProduction(h, b, legacy);
    assert.equal((await h.store.createReport(CORPUS_TENANT, { id: legacy.id, status: "signed", templateId: legacy.templateId, formId: b.form!.id, payload: { ...legacy, status: "signed", receipt } })).ok, true);
    // A build that leaves F-06 out (as bh2-rc1's run-time reading did – RG-1).
    const drop = (report: Report): Report => ({ ...report, sections: report.sections.map((s) => (s.key === "F-06" ? { ...s, paragraphs: [] } : s)) });
    const dropsF06: IssuingCode = {
      ...RELEASE_CODE,
      label: "a build that drops F-06",
      finalAnswers: (report, form, rc) => ({ ...RELEASE_CODE.finalAnswers(report, form, rc), "F-06": { leftBlank: true } }),
      finalFormCopy: (input) => RELEASE_CODE.finalFormCopy({ ...input, report: drop(input.report) }),
    };
    const rows = await checkIssuedReports(h.store, CORPUS_TENANT, { production: dropsF06 });
    assert.equal(rows[0]?.outcome, "CHANGED");
    assert.match(rows[0]?.detail ?? "", /Word text: \d+ lines? differ/);
    assert.match(rows[0]?.detail ?? "", /answers differ in F-06/);
  });

  it("this build's side is exactly what /render FINAL issues for a receipt production minted (the public demo: no clinic notice)", async () => {
    const h = createHttpHarness();
    const b = await built({ ...LEGACY, signMode: "demo" });
    const legacy = productionMade(b.report);
    const receipt = await approveAsProduction(h, b, legacy);
    const approved: Report = { ...legacy, status: "signed", receipt };
    const final = await postRenderFinal(h, { report: approved, receipt, form: b.form, fileBytes: b.fileBytes, member: "sarah", mode: "demo" });
    assert.equal(final.status, 200, JSON.stringify(final.body));
    assert.equal(final.headers.get("x-medreport-render"), "final");
    const file = RELEASE_CODE.decodeFormFile(Buffer.from(b.fileBytes!).toString("base64"));
    const mine = await RELEASE_CODE.finalFormCopy({ report: approved, form: b.form!, file, receipt, continuationLabel: "" });
    assert.equal(docxPlainText(mine.bytes), docxPlainText(final.bytes!));
    assert.deepEqual(RELEASE_CODE.finalAnswers(approved, b.form!, receipt), productionFormAnswers(approved, b.form!, { receipt }));
    // …and it prints the approved "If yes" line (RG-1: bh2-rc1 dropped it).
    assert.match(docxPlainText(final.bytes!), /Two further sessions of physiotherapy are advised\./);
  });
});
