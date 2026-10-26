/**
 * bh2-rc1 cross-workstream integration tests (plan WI): what one workstream produces, read by another, on the merged
 * release/bh-trial-2. Each test pins one seam that no workstream branch could test on its own:
 *
 * - WA2 outcomes through WA1's dry run: a fatal fill outcome refuses the approval (409 ISSUE_REFUSED) before anything is
 *   approved, in words that fit an approval (nothing was approved – never "use Create amended version"); and WA1's
 *   parse reads an uncertain or two-way choice answer as WA2's fill does – never a definite tick.
 *
 * Fictional data only: the safety corpus's fictional clinic and synthetic forms.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSign } from "../../src/modules/medreport/api/handlers/sign";
import { bindHandler } from "../../src/modules/medreport/api/http";
import type { MedreportDeps } from "../../src/modules/medreport/api/deps";
import { createSessionToken } from "../../src/modules/medreport/auth/session-token";
import { parseFormAnswerValue } from "../../src/modules/medreport/core/forms";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { clinicianOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { bytesToBase64, createHttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { resolveChoice } from "../../src/modules/medreport/forms/choice-marks";

process.env.MEDREPORT_AI_MODE = "demo";

async function built(input: Record<string, unknown>): Promise<Built> {
  return buildCase(CaseInputSchema.parse({ ...input, signMode: "demo" }) as CaseInput, { signMode: "demo" });
}

/** The public demo's approval by the fictional approver, with the referrer's file for the dry run. */
async function demoSign(deps: MedreportDeps, b: Built): Promise<{ status: number; json: Record<string, unknown> }> {
  const body = { report: b.report, signer: clinicianOf("sarah"), typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...b.template.attestations], form: b.form, fileBase64: bytesToBase64(b.fileBytes as Uint8Array) };
  const req = new Request("http://localhost/api/reports/v1/sign", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${createSessionToken({ tenantId: "demo", kind: "demo" }).token}` }, body: JSON.stringify(body) });
  const res = await bindHandler(handleSign, () => deps)(req, { params: {} });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const YES_NO = { answerType: "yes_no" as const, options: ["Yes", "No"] };

describe("WA2 outcomes through WA1's dry run", () => {
  it("a decided box the fill cannot place refuses the approval: 409 ISSUE_REFUSED naming it, no receipt, worded for an approval", async () => {
    const { deps } = createHttpHarness();
    const answers = { "F-05": false, "F-38": true };
    const ok = await demoSign(deps, await built({ report: "form:cf-discharge", answers }));
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 300));
    // The map points F-38's tick boxes at a row the referrer's file does not have (WA2: not_found is fatal on FINAL).
    const lost = { anchor: { kind: "docx", target: "checkbox_glyph", blockId: "t0.r99.c1", optionGlyphs: [{ option: "Yes", blockId: "t0.r99.c1", glyphIndex: 0 }, { option: "No", blockId: "t0.r99.c1", glyphIndex: 1 }] } };
    const refused = await demoSign(deps, await built({ report: "form:cf-discharge", answers, fill: { fieldPatches: { "F-38": lost } } }));
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "ISSUE_REFUSED");
    assert.equal("receipt" in refused.json, false);
    const issues = (refused.json.issues ?? []) as Array<{ path: string; message: string }>;
    assert.ok(issues.some((i) => /F-38/.test(i.path) || /F-38/.test(i.message)), JSON.stringify(issues));
    const detail = String(refused.json.detail);
    assert.match(detail, /Nothing was approved/);
    assert.doesNotMatch(detail, /amended version|approved report cannot be edited/i, "at /sign nothing is approved yet");
  });

  it("WA1's parse reads an uncertain or two-way choice answer as WA2's fill does: blank, never a definite tick", () => {
    for (const raw of ["No – patient unsure", "No, not asked", "Yes?", "Yes, I think so", "No – TBC", "No response", "No clear answer", "No evidence in the notes", "Yes and no", "Yes/No"]) {
      assert.equal(parseFormAnswerValue(YES_NO, raw).value, null, raw);
      assert.equal(resolveChoice({ ...YES_NO, anchor: { kind: "docx", target: "checkbox_glyph", blockId: "b" } } as never, { text: raw }, ["Yes", "No"]).kind === "chosen", false, `fill: ${raw}`);
    }
    // Clinical negatives and plain answers read as before.
    assert.equal(parseFormAnswerValue(YES_NO, "Yes – no restrictions").value, true);
    assert.equal(parseFormAnswerValue(YES_NO, "No response to treatment").value, false);
    assert.equal(parseFormAnswerValue(YES_NO, "No").value, false);
    assert.equal(parseFormAnswerValue(YES_NO, "Yes").value, true);
    // A single choice: an uncertain answer is none of the options; a printed option that reads like one is itself.
    const course = { answerType: "single_choice" as const, options: ["Improved", "Same", "Worse", "Unsure"] };
    assert.equal(parseFormAnswerValue(course, "Improved?").value, null);
    assert.equal(parseFormAnswerValue(course, "Improved").value, "Improved");
    assert.equal(parseFormAnswerValue(course, "Unsure").value, "Unsure");
  });
});
