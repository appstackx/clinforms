/**
 * bh2 fix round 1 (R1T-WA1-04, SAF-5): a body's `status` (and `receipt`) is the client's word – outside the hashed
 * content – so it never decides what is checked. /sign, /validate and /render read every body as a report not yet
 * approved: a body saying "signed" no longer switches off APPROVER_DECISION (an approved report holds no proposal), so
 * no receipt is minted – and no FINAL copy issued – over a staff proposal the approver never adopted. Fictional data
 * only (the safety corpus: Pat Morgan's proposal in a clinician box of the fictional discharge form).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReceipt } from "../../auth/sign-receipt";
import type { Report, ReportFlag, SignReceipt } from "../../core/types";
import { CaseInputSchema, type CaseInput } from "../../core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../core/validation/__corpus__/harness/build";
import { createHttpHarness, postRenderFinal, postSign } from "../../core/validation/__corpus__/harness/http";
import { clinicianOf } from "../../core/validation/__corpus__/harness/fixtures";
import { acknowledgementsSha256 } from "./sign/receipt";
import { createSessionToken } from "../../auth/session-token";
import { bindHandler } from "../http";
import type { MedreportDeps } from "../deps";
import { asNotYetApproved } from "./sign/checks/issue";
import { handleValidate } from "./validate";

process.env.MEDREPORT_AI_MODE = "demo";

const PROPOSAL = { report: "form:cf-discharge", box: "F-03", paragraph: { text: "Lumbar strain after a lifting injury at work; discharged.", cites: ["N-001"], origin: "edited", by: "pat" } };

async function built(extra: Record<string, unknown> = {}): Promise<Built> {
  return buildCase(CaseInputSchema.parse({ ...PROPOSAL, ...extra }) as CaseInput);
}

const decision = (flags: readonly ReportFlag[]) => flags.filter((f) => f.code === "APPROVER_DECISION" && f.sectionKey === "F-03" && f.severity === "blocking");

describe("a body's status is never what an approval is checked as (R1T-WA1-04)", () => {
  it("asNotYetApproved: status draft, no receipt – the hashed content untouched", async () => {
    const b = await built();
    const forged = { ...b.report, status: "signed", receipt: { mac: "x" } } as unknown as Report;
    const seen = asNotYetApproved(forged);
    assert.equal(seen.status, "draft");
    assert.equal("receipt" in seen, false);
    assert.deepEqual({ ...seen, status: undefined }, { ...b.report, status: undefined });
    assert.equal(asNotYetApproved(b.report), b.report, "a draft is passed through as it is");
  });

  it("/sign: a body saying 'signed' over Pat's unadopted proposal is refused like the draft (409 APPROVER_DECISION), no receipt", async () => {
    const b = await built();
    const h = createHttpHarness();
    for (const status of ["draft", "signed"] as const) {
      const res = await postSign(h, { report: { ...b.report, status }, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes });
      assert.equal(res.status, 409, `${status}: ${JSON.stringify(res.body).slice(0, 300)}`);
      assert.equal(res.code, "SIGNOFF_BLOCKED");
      assert.equal(decision((res.body as { flags: ReportFlag[] }).flags).length, 1, status);
      assert.equal(res.receipt, null);
    }
  });

  it("/validate: the same proposal is reported whatever status the body claims", async () => {
    const b = await built({ signMode: "demo" });
    const call = async (report: Report) => {
      const req = new Request("http://localhost/api/reports/v1/validate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${createSessionToken({ tenantId: "demo", kind: "demo" }).token}` },
        body: JSON.stringify({ report, form: b.form }),
      });
      const res = await bindHandler(handleValidate, () => ({}) as MedreportDeps)(req, { params: {} });
      return (await res.json()) as { canSign: boolean; flags: ReportFlag[] };
    };
    const draft = await call(b.report);
    const claimed = await call({ ...b.report, status: "signed" });
    assert.equal(decision(draft.flags).length, 1);
    assert.equal(decision(claimed.flags).length, 1, "a body saying 'signed' still holds the proposal");
    assert.equal(claimed.canSign, false);
  });

  it("/render: a receipt minted over that proposal (as bh2-rc1's /sign did for a 'signed' body) makes no FINAL copy", async () => {
    const b = await built();
    const h = createHttpHarness();
    // As the hole minted it: a valid receipt over exactly this content (the MAC verifies, the hash matches), binding the
    // acknowledgements that approval relied on – none (APPROVER_DECISION is never acknowledged; it was switched off).
    const receipt: SignReceipt = await createReceipt({
      report: b.report,
      signer: clinicianOf("sarah"),
      statementAccepted: true,
      attestations: [...b.template.attestations],
      formMapSha256: b.form!.confirmed!.mapSha256!,
      now: new Date("2026-10-27T09:00:00.000Z"),
      additions: { acknowledgementsSha256: acknowledgementsSha256([], b.report.gaps ?? []) },
    });
    const res = await postRenderFinal(h, { report: { ...b.report, status: "signed", receipt }, receipt, form: b.form, fileBytes: b.fileBytes, member: "sarah", mode: "tenant" });
    assert.notEqual(res.headers.get("x-medreport-render"), "final", `${res.status} ${res.code}`);
    assert.deepEqual([res.status, res.code], [409, "SIGNOFF_BLOCKED"]);
    assert.equal(decision((res.body as { flags: ReportFlag[] }).flags).length, 1, "the unadopted proposal is what blocks it");
  });
});
