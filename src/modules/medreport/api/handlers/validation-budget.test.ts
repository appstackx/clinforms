/**
 * bh2 fix round 1 (R1T-WA1-03 – the integration half of SEC-1 and SAF-1): POST /validate, /sign and /render refuse a
 * body over the validators' budget (core/validation VALIDATION_BUDGET) with 413 before any validator runs, so no
 * request – the public demo's included – can make the validators work on text no real report holds. A real-size report
 * passes as before. Fictional data only (the safety corpus).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken } from "../../auth/session-token";
import type { Report } from "../../core/types";
import { VALIDATION_BUDGET, validationBudgetExcess } from "../../core/validation";
import { CaseInputSchema, type CaseInput } from "../../core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../core/validation/__corpus__/harness/build";
import { bindHandler, type MedreportHandler } from "../http";
import type { MedreportDeps } from "../deps";
import { handleRender } from "./render";
import { handleSign } from "./sign";
import { handleValidate } from "./validate";

process.env.MEDREPORT_AI_MODE = "demo";

async function demoCase(): Promise<Built> {
  return buildCase(
    CaseInputSchema.parse({ report: "form:cf-discharge", signMode: "demo", box: "F-32", paragraph: { text: "Lumbar movement full and pain-free at discharge.", cites: ["N-002"] } }) as CaseInput,
  );
}

async function post(handler: MedreportHandler, url: string, body: unknown): Promise<{ status: number; code: string | null; ms: number }> {
  const started = Date.now();
  const req = new Request(`http://localhost/api/reports/v1${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${createSessionToken({ tenantId: "demo", kind: "demo" }).token}` },
    body: JSON.stringify(body),
  });
  const res = await bindHandler(handler, () => ({}) as MedreportDeps)(req, { params: {} });
  const type = res.headers.get("content-type") ?? "";
  const code = /json/.test(type) ? (((await res.json()) as { code?: string }).code ?? null) : (await res.arrayBuffer(), null);
  return { status: res.status, code, ms: Date.now() - started };
}

const withBox = (report: Report, key: string, paragraphs: Report["sections"][number]["paragraphs"]): Report => ({
  ...report,
  sections: report.sections.map((s) => (s.key === key ? { ...s, paragraphs } : s)),
});

/** SEC-1's shape: one box, one-line sentences – here one paragraph of about 4.3 MB (inside the 4.4 MB body cap). */
function hostileText(chars: number): string {
  const sentence = "He will make a full recovery within 6 weeks. ";
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);
}

describe("the validators' budget (R1T-WA1-03)", () => {
  it("a real-size report is well inside it; each limit, once exceeded, is named", async () => {
    const b = await demoCase();
    assert.equal(validationBudgetExcess(b.report, b.form), null);
    const para = (n: number, chars: number) => Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, text: "x".repeat(chars), sourceIds: [], origin: "clinician" as const }));
    assert.equal(validationBudgetExcess(withBox(b.report, "F-32", para(1, VALIDATION_BUDGET.paragraphChars + 1)))?.what, "paragraphChars");
    assert.equal(validationBudgetExcess(withBox(b.report, "F-32", para(11, 9_500)))?.what, "textChars");
    assert.equal(validationBudgetExcess(withBox(b.report, "F-32", para(VALIDATION_BUDGET.paragraphs + 1, 1)))?.what, "paragraphs");
    const tomb = (n: number, chars: number) => Array.from({ length: n }, (_, i) => ({ paragraphId: `t-${i}`, text: "y".repeat(chars), sourceIds: [], by: { memberId: "demo", name: "Sarah Reid", role: "clinician" as const, canSign: true }, at: "2026-10-26T10:00:00.000Z" }));
    const withTombs = (t: ReturnType<typeof tomb>) => ({ ...b.report, sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, tombstones: t } : s)) }) as Report;
    assert.equal(validationBudgetExcess(withTombs(tomb(1, VALIDATION_BUDGET.tombstoneChars + 1)))?.what, "tombstoneChars");
    assert.equal(validationBudgetExcess(withTombs(tomb(6, 9_500)))?.what, "tombstoneTextChars");
    assert.equal(validationBudgetExcess(withTombs(tomb(VALIDATION_BUDGET.tombstones + 1, 1)))?.what, "tombstones");
    const notes = { ...b.report, bundleSnapshot: { ...b.report.bundleSnapshot, notes: [...b.report.bundleSnapshot.notes, { ...b.report.bundleSnapshot.notes[0], id: "N-999", subjective: "z".repeat(VALIDATION_BUDGET.noteChars + 1) }] } } as Report;
    assert.equal(validationBudgetExcess(notes)?.what, "noteChars");
    const form = { ...b.form!, fields: Array.from({ length: VALIDATION_BUDGET.formFields + 1 }, () => b.form!.fields[0]) };
    assert.equal(validationBudgetExcess(b.report, form)?.what, "formFields");
  });

  it("/validate, /sign and /render refuse a 4.3 MB one-box body with 413 in well under a second; a real-size report is checked as before", async () => {
    const b = await demoCase();
    const hostile = withBox(b.report, "F-32", [{ id: "F-32-p1", text: hostileText(4_300_000), sourceIds: ["N-002"], origin: "ai" }]);
    const fileBase64 = Buffer.from(b.fileBytes!).toString("base64");
    const sign = { signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, typedSignature: "Sarah Reid", statementAccepted: true, attestations: [...b.template.attestations], form: b.form };
    for (const [label, handler, url, body] of [
      ["/validate", handleValidate, "/validate", { report: hostile, form: b.form }],
      ["/sign", handleSign, "/sign", { ...sign, report: hostile }],
      ["/render", handleRender, "/render?format=original", { report: hostile, form: b.form }],
    ] as const) {
      const res = await post(handler, url, body);
      assert.equal(res.status, 413, `${label}: ${res.status} ${res.code}`);
      assert.equal(res.code, "PAYLOAD_TOO_LARGE", label);
      assert.ok(res.ms < 1_500, `${label}: refused in ${res.ms} ms`);
    }
    // SAF-1's shape: an edited paragraph and one long tombstone of drafted text.
    const tombstone = { ...b.report, sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, tombstones: [{ paragraphId: "gone", text: hostileText(140_000), sourceIds: ["N-002"], by: { memberId: "demo", name: "Sarah Reid", role: "clinician" as const, canSign: true }, at: "2026-10-26T10:00:00.000Z" }] } : s)) } as Report;
    const refused = await post(handleValidate, "/validate", { report: tombstone, form: b.form });
    assert.deepEqual([refused.status, refused.code], [413, "PAYLOAD_TOO_LARGE"]);
    assert.ok(refused.ms < 1_000, `refused in ${refused.ms} ms`);

    const real = await post(handleValidate, "/validate", { report: b.report, form: b.form });
    assert.equal(real.status, 200, `${real.status} ${real.code}`);
    const draft = await post(handleRender, "/render?format=original", { report: b.report, form: b.form, fileBase64 });
    assert.equal(draft.status, 200, `${draft.status} ${draft.code}`);
  });
});
