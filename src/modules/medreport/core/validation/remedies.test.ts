/**
 * bh2 fix round 1 (R1T-WA1-05 – the wording half of RG-2 – and R1T-WA1-L1): every remedy a refusal, warning or item
 * names is an action the people concerned can take on a screen.
 * - /sign's legacy-reading refusal ("Mark the box as applying …") is gone with the run-time reading it refused (no report
 *   from before the release can count such a mark – it has no approver).
 * - NOT_APPLICABLE_ANSWERED names: remove the answer; correct the answer it depends on; the approving clinician's card
 *   control APPLIES_ANYWAY_ACTION (R1T-WC-12). The last is checked against the review's components once one of them
 *   offers the decision (until WC's control lands the check is a todo – the warning then names a control no screen has).
 * - Staff are never told "Only you can answer this" on a box only the approving clinician settles, nor "mark it as your
 *   own wording" over text someone else entered.
 * Fictional data only (the safety corpus).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { actorOf } from "./__corpus__/harness/fixtures";
import { CaseInputSchema, type CaseInput } from "./__corpus__/harness/types";
import { buildCase, ownerOf, type Built } from "./__corpus__/harness/build";
import { APPLIES_ANYWAY_ACTION, notApplicableAnsweredMessage } from "./conditions";
import { validateReport } from "./index";
import { reviewItems } from "../../ui/components/review/box-items";
import type { Report } from "../types";

process.env.MEDREPORT_AI_MODE = "demo";

const MEDREPORT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const read = (rel: string) => fs.readFileSync(path.join(MEDREPORT, rel), "utf8");

async function built(input: Record<string, unknown>): Promise<Built> {
  return buildCase(CaseInputSchema.parse(input) as CaseInput);
}

function validated(b: Built, report: Report = b.report): Report {
  const { flags } = validateReport(report, b.template, { form: b.form, computedFacts: b.computedFacts, voice: { owner: ownerOf(b) as never } });
  return { ...report, flags };
}

/** Every review component and screen (where a control would have to be). */
function uiSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) out.push({ file: path.relative(MEDREPORT, p), text: fs.readFileSync(p, "utf8") });
    }
  };
  walk(path.join(MEDREPORT, "ui"));
  return out;
}

/** A component that lets a person decide that a ruled-out box applies (WC's R1T-WC-12 control), if any. */
const appliesAnywayControls = () => uiSources().filter((f) => /setDisposition[\s\S]{0,300}applies_anyway|applies_anyway[\s\S]{0,300}setDisposition/.test(f.text));

describe("remedies name actions that exist (R1T-WA1-05)", () => {
  it("/sign no longer refuses with 'mark the box as applying' (the legacy reading and its refusal are gone)", () => {
    for (const rel of ["api/handlers/sign/checks/issue.ts", "api/handlers/sign/index.ts"]) {
      const src = read(rel);
      assert.equal(/as applying and answer it/.test(src), false, rel);
      assert.equal(/legacyReadingCheck\b(?!['’]s)/.test(src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")), false, `${rel}: no legacyReadingCheck in the pipeline`);
    }
  });

  it("NOT_APPLICABLE_ANSWERED names removing the answer, correcting the answer it depends on, and the approver's card control – never 'the approving clinician can say so'", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, box: "F-06", paragraph: { text: "Two further sessions of physiotherapy are advised.", cites: [], origin: "clinician", by: "sarah" } });
    const flag = validated(b).flags.find((f) => f.code === "NOT_APPLICABLE_ANSWERED" && f.sectionKey === "F-06");
    assert.ok(flag, "the warning is raised");
    assert.equal(flag.message, notApplicableAnsweredMessage(b.template.sections.find((s) => s.key === "F-06")?.title ?? "", flag.message.match(/does not apply( \([^)]*\))?/)?.[1] ?? "", true));
    assert.match(flag.message, /Remove it/);
    assert.match(flag.message, /correct the answer it depends on/);
    assert.ok(flag.message.includes(`“${APPLIES_ANYWAY_ACTION}”`));
    assert.equal(/can say so/.test(flag.message), false);
    // The first two exist on every card: an answer can be removed and the controlling answer changed.
    const state = read("ui/components/review/use-review-state.ts");
    assert.match(state, /type: "removeParagraph"/);
    assert.match(state, /type: "setAnswer"/);
  });

  it(`the approver's control the warning names is offered with exactly those words (“${APPLIES_ANYWAY_ACTION}”)`, { todo: appliesAnywayControls().length === 0 ? "R1T-WC-12 (WC): no review component offers the approver's applies-anyway decision yet" : false }, () => {
    const controls = appliesAnywayControls();
    assert.ok(controls.length > 0, "a review component dispatches setDisposition applies_anyway");
    for (const c of controls) assert.ok(c.text.includes(APPLIES_ANYWAY_ACTION) || /APPLIES_ANYWAY_ACTION/.test(c.text), `${c.file}: the control is worded “${APPLIES_ANYWAY_ACTION}”`);
  });
});

describe("staff copy by actor (R1T-WA1-L1)", () => {
  it("a clinician box with no answer: the approver is told 'Only you can answer this'; staff, that the approving clinician (named) answers it", async () => {
    const b = await built({ report: "form:cf-discharge", boxes: { "F-10": [] }, gaps: [{ box: "F-10", issue: "No prognosis is recorded in the notes." }] });
    const report = validated(b);
    const item = (actor: ReturnType<typeof actorOf> | undefined) => reviewItems(report, { template: b.template, form: b.form, ...(actor ? { actor } : {}) }).boxes.get("F-10");
    const approver = item(actorOf("sarah"));
    assert.ok(approver, "F-10 is an item");
    assert.match(approver.instruction, /^Only you can answer this/);
    const staff = item(actorOf("pat"));
    assert.equal(/Only you can answer/.test(staff?.instruction ?? ""), false);
    assert.match(staff?.instruction ?? "", /Only Sarah Reid, the approving clinician, can answer this/);
    assert.match(staff?.instruction ?? "", /proposal/);
    assert.match(staff?.heading ?? "", /approving clinician's opinion/);
    const colleague = item(actorOf("tom"));
    assert.match(colleague?.instruction ?? "", /Only Sarah Reid, the approving clinician/);
    assert.match(item(undefined)?.instruction ?? "", /^Only you can answer this/, "no viewer named: as before");
  });

  it("UNCITED_PARAGRAPH: 'mark it as your own wording' only over the approver's own text; someone else's names who settles it", async () => {
    const b = await built({ report: "form:cf-discharge", box: "F-03", paragraph: { text: "Lumbar strain after a lifting injury at work.", cites: [], origin: "edited", by: "pat" } });
    const pat = validated(b).flags.find((f) => f.code === "UNCITED_PARAGRAPH" && f.sectionKey === "F-03");
    assert.ok(pat);
    assert.equal(/your own wording/.test(pat.message), false);
    assert.match(pat.message, /entered by Pat Morgan/);
    assert.match(pat.message, /Sarah Reid, the approving clinician, can write the answer in their own words/);
    const own = await built({ report: "form:cf-discharge", box: "F-03", paragraph: { text: "Lumbar strain after a lifting injury at work.", cites: [], origin: "edited", by: "sarah" } });
    const sarah = validated(own).flags.find((f) => f.code === "UNCITED_PARAGRAPH" && f.sectionKey === "F-03");
    assert.match(sarah?.message ?? "", /mark it as your own wording/);
  });
});
