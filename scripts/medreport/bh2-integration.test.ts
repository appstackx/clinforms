/**
 * bh2-rc1 cross-workstream integration tests (plan WI): what one workstream produces, read by another, on the merged
 * release/bh-trial-2. Each test pins one seam that no workstream branch could test on its own:
 *
 * - WA2 outcomes through WA1's dry run: a fatal fill outcome refuses the approval (409 ISSUE_REFUSED) before anything is
 *   approved, in words that fit an approval (nothing was approved – never "use Create amended version"); and WA1's
 *   parse reads an uncertain or two-way choice answer as WA2's fill does – never a definite tick.
 * - WB's voice flags through WC's acknowledgement policy: the first-person licence (ii) on drafted text ("while
 *   covering my annual leave", a colleague's note naming the approver) is the approver's to confirm; any other drafted
 *   first person is never acknowledged; a person's own "I recorded …" beside a kept drafted sentence is the approver's
 *   to confirm, a first person inside drafted residue never.
 * - WC's store through WA1's /sign: a staff member's store write that gives a clinician's box a condition ruling it
 *   out is refused by the store (403); a copy stored past the store anyway is still refused at /sign (409), because
 *   /sign reads the attested map's own conditions.
 * - WC's decisions through WA1's issue state: a person's "applies anyway" / "not applicable" about a box read from a
 *   TEXT controller records that text (WA1's controllerSnapshotOf), so the decision stands until the text changes.
 * - WC's Adopt through WB's opinion and attribution checks: what the approver adopted with one audited click is the
 *   approver's own (no OPINION_LANGUAGE); changed since, it is checked again; drafted residue kept in it never is.
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
import { compileConditions, type ConditionField } from "../../src/modules/medreport/core/conditions";
import { dispositionIsStale } from "../../src/modules/medreport/core/issue-state";
import { setDisposition } from "../../src/modules/medreport/ui/components/review/reducer";
import type { Report, ReportFlag } from "../../src/modules/medreport/core/types";
import { canAcknowledge, validateReport } from "../../src/modules/medreport/core/validation";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { actorOf, clinicianOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { bytesToBase64, createHttpHarness, postSign, putStoredReport } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { runSteps } from "../../src/modules/medreport/core/validation/__corpus__/harness/reducer";
import { CANDIDATE_ENGINE } from "../../src/modules/medreport/core/validation/__corpus__/harness/engine";
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

/** The case's report with the validators' flags, the voice owner being its approver (as /validate and /sign run it). */
async function validated(input: Record<string, unknown>): Promise<{ report: Report; flags: ReportFlag[] }> {
  const b = await buildCase(CaseInputSchema.parse(input) as CaseInput, {});
  const owner = b.report.approver ? { name: b.report.approver.name, hcpc: b.report.approver.hcpc } : null;
  const res = validateReport(b.report, b.template, { form: b.form, ...(owner ? { voice: { owner } } : {}) });
  return { report: { ...b.report, flags: res.flags }, flags: res.flags };
}

const voiceFlag = (flags: readonly ReportFlag[]) => flags.find((f) => f.code === "OTHER_CLINICIAN_VOICE");
const COVERING = { id: "N-003", author: "tom", date: "2026-04-15", type: "follow_up", subjective: "Covering Sarah Reid's annual leave. Pain 3/10.", objective: "Lumbar flexion 80%." };

describe("WB's voice flags through WC's acknowledgement policy", () => {
  it("drafted text: the first-person licence (ii) is the approver's to confirm – staff and colleagues may not; other drafted first person: never", async () => {
    const licence = await validated({ notes: [COVERING], box: "treatment_provided", paragraph: { text: "Tom Ellis, physiotherapist, saw Mr Testcase on 15/04/2026 while covering my annual leave.", cites: ["N-003"] } });
    const f = voiceFlag(licence.flags);
    assert.ok(f, "flagged");
    assert.equal(canAcknowledge(f!, licence.report, actorOf("sarah")), true, "the approver");
    for (const who of ["pat", "tom", "chris"] as const) assert.equal(canAcknowledge(f!, licence.report, actorOf(who)), false, who);
    const drafted = await validated({ box: "examination_findings", paragraph: { text: "At that appointment I recorded full, pain-free lumbar range of movement.", cites: ["N-002"] } });
    const g = voiceFlag(drafted.flags);
    assert.ok(g, "flagged");
    assert.equal(canAcknowledge(g!, drafted.report, actorOf("sarah")), false, "a drafted first person over a colleague's note: never");
  });

  it("a person's text: their own first person beside a kept drafted sentence is the approver's to confirm; a first person inside drafted residue never", async () => {
    const own = await validated({ author: null, box: "examination_findings", paragraph: { text: "No further treatment was given. At that appointment I recorded full, pain-free lumbar range of movement.", cites: ["N-002"], origin: "edited", originalText: "No further treatment was given. (drafted wording)" } });
    const f = voiceFlag(own.flags);
    assert.ok(f, "flagged");
    assert.equal(canAcknowledge(f!, own.report, actorOf("sarah")), true, "the approver confirms the person's own words");
    assert.equal(canAcknowledge(f!, own.report, actorOf("pat")), false, "never staff");
    const residue = await validated({ author: null, box: "examination_findings", paragraph: { text: "No further treatment was given. At that appointment I recorded full, pain-free lumbar range of movement.", cites: ["N-002"], origin: "edited", originalText: "At that appointment I recorded full, pain-free lumbar range of movement." } });
    const g = voiceFlag(residue.flags);
    assert.ok(g, "flagged");
    assert.equal(canAcknowledge(g!, residue.report, actorOf("sarah")), false, "the drafted first person kept: drafted-text strictness");
  });
});

describe("WC's Adopt through WB's opinion and attribution checks", () => {
  const opinionOn = (report: Report, box: string) => report.flags.filter((f) => f.sectionKey === box && f.severity === "blocking" && (f.code === "OPINION_LANGUAGE" || f.code === "OTHER_CLINICIAN_VOICE"));
  const run = async (steps: Array<Record<string, unknown>>, boxes: Record<string, unknown> = { "F-10": [] }) => {
    const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", box: "F-10", boxes, actor: "sarah" }) as CaseInput, {});
    return runSteps(b, steps as never, CANDIDATE_ENGINE);
  };

  it("a colleague's or staff entry the approver adopted is the approver's own: no opinion flag", async () => {
    for (const [by, text] of [["tom", "Settling well with exercise."], ["pat", "He should make a full recovery within 6 weeks."]] as const) {
      const before = await run([{ do: "add", by, box: "F-10", text }]);
      assert.ok(before.report.flags.some((f) => f.sectionKey === "F-10" && f.severity === "blocking"), `${by}: blocked before the Adopt`);
      const after = await run([{ do: "add", by, box: "F-10", text }, { do: "adopt", by: "sarah", box: "F-10" }]);
      assert.equal(after.error, undefined, after.log.join(" | "));
      assert.deepEqual(opinionOn(after.report, "F-10").map((f) => f.evidence), [], `${by}: adopted`);
    }
  });

  it("changed by someone else after the Adopt, the box is checked again", async () => {
    const changed = await run([{ do: "add", by: "pat", box: "F-10", text: "He should make a full recovery within 6 weeks." }, { do: "adopt", by: "sarah", box: "F-10" }, { do: "add", by: "pat", box: "F-10", text: "He will be fit for full duties in 2 weeks." }]);
    assert.ok(changed.report.flags.some((f) => f.sectionKey === "F-10" && f.severity === "blocking" && !f.acknowledged), changed.log.join(" | "));
  });

  it("drafted residue kept in an adopted box keeps drafted-text strictness", async () => {
    const drafted = { "F-10": [{ text: "He is expected to make a full recovery within 6 weeks.", cites: ["N-001"] }] };
    const res = await run([{ do: "edit", by: "pat", box: "F-10", text: "He is expected to make a full recovery within 6 weeks. Seen by Pat." }, { do: "adopt", by: "sarah", box: "F-10" }], drafted);
    assert.ok(opinionOn(res.report, "F-10").length > 0, res.log.join(" | "));
  });
});

describe("WC's store through WA1's /sign", () => {
  it("a forged condition on a clinician's box: the store refuses it (403); stored past the store, /sign still refuses (409)", async () => {
    const h = createHttpHarness();
    const b = await buildCase(CaseInputSchema.parse({ report: "form:cf-discharge", answers: { "F-05": false }, box: "F-10", paragraph: { text: "He will make a full recovery within 6 weeks.", cites: ["N-002"] }, signMode: "tenant" }) as CaseInput, { signMode: "tenant" });
    const forged: Report = { ...b.report, sections: b.report.sections.map((sec) => (sec.key === "F-10" ? ({ ...sec, condition: { controllers: ["F-05"], wants: "yes", text: "If yes", parser: "wa1-c3" } } as typeof sec) : sec)) };
    const put = await putStoredReport(h, forged, "pat", null);
    assert.equal(put.status, 403, JSON.stringify(put.body).slice(0, 300));
    assert.equal(put.code, "DECISION_NOT_ALLOWED");
    // postSign stores the body as it is when the clinic holds no revision (as the Studio saves before approving).
    const signed = await postSign(h, { report: forged, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes });
    assert.equal(signed.status, 409, JSON.stringify(signed.body).slice(0, 300));
    assert.equal(signed.receipt, null);
  });
});

describe("WC's decisions through WA1's issue state", () => {
  it("a decision about a box read from a text controller records the text, and stands until it changes", () => {
    const fields: ConditionField[] = [
      { id: "F-27", label: "Daily tasks – task still limited", answerType: "short_text" },
      { id: "F-28", label: "Daily tasks – how limited", answerType: "single_choice", options: ["Limited", "Cannot do"], guidance: "Only when a task is still limited" },
    ];
    const conds = compileConditions(fields);
    assert.ok(conds.get("F-28"), "F-28 reads F-27");
    const sections = (text: string) =>
      fields.map((f) => ({
        key: f.id,
        title: f.label,
        kind: "ai_narrative",
        status: "drafted",
        paragraphs: f.id === "F-27" && text ? [{ id: "p1", text, sourceIds: [], origin: "ai" }] : [],
        ...(conds.get(f.id) ? { condition: conds.get(f.id) } : {}),
      })) as unknown as Report["sections"];
    const report = { id: "rpt_int", reportModel: 2, approver: { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" }, sections: sections("Gardening"), gaps: [], flags: [], activity: [], updatedAt: "2026-10-26T10:00:00.000Z" } as unknown as Report;
    const decided = setDisposition(report, "F-28", "applies_anyway", actorOf("sarah"), { reason: "Still limited at work." });
    const d = decided.sections.find((s) => s.key === "F-28")?.disposition;
    assert.ok(d, "recorded");
    assert.deepEqual(d!.controllerSnapshot, [{ sectionKey: "F-27", answer: { kind: "text", value: "Gardening" } }]);
    assert.equal(dispositionIsStale(d!, decided.sections), false, "stands as made");
    assert.equal(dispositionIsStale(d!, sections("Gardening and DIY")), true, "cancelled when the text changes");
  });
});
