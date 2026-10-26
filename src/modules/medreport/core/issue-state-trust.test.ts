/**
 * harden-WA1 (the second review of WA1, check2-WA1): the server decides what a box's condition is, a person's decision
 * is cancelled when a controlling TEXT box changes, a long printed option never breaks a report, and the reader's
 * wrong rule-outs of check2 N2 stay fixed. Fictional forms and wording only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileCondition, compileConditions, conditionText, evaluateCondition, mapConditions, type ConditionField } from "./conditions";
import { boxIssueOf, controllerSnapshotOf, dispositionIsStale, issueDetails, isReleaseModel, legacyRuleOutsBeyondServer, migrateDraftToReleaseModel } from "./issue-state";
import { FrozenConditionSchema, ReportSchema } from "./schemas";
import type { FormDefinition, Report, ReportSection } from "./types";
import { validateReport } from "./validation";
import { CaseInputSchema, type CaseInput } from "./validation/__corpus__/harness/types";
import { buildCase, type Built } from "./validation/__corpus__/harness/build";

process.env.MEDREPORT_AI_MODE = "demo";

async function built(input: Record<string, unknown>): Promise<Built> {
  return buildCase(CaseInputSchema.parse(input) as CaseInput);
}

const FORGED = { controllers: ["F-05"], wants: "yes", text: "If yes", parser: "wa1-c3" };

function withSection(report: Report, key: string, patch: (s: ReportSection) => ReportSection): Report {
  return { ...report, sections: report.sections.map((s) => (s.key === key ? patch(s) : s)) };
}

const PROGNOSIS = { report: "form:cf-discharge", answers: { "F-05": false }, box: "F-10", paragraph: { text: "He will make a full recovery within 6 weeks.", cites: ["N-002"] } };

describe("check2 N1: the server reads a box's condition from the attested map, never from the report's copy", () => {
  it("a condition written into a clinician's box through the store does not rule it out: its drafted prognosis still blocks", async () => {
    const b = await built(PROGNOSIS);
    const honest = validateReport(b.report, b.template, { form: b.form });
    assert.equal(honest.canSign, false);
    const forged = withSection(b.report, "F-10", (s) => ({ ...s, condition: FORGED as never }));
    assert.equal(boxIssueOf(forged, b.form, "F-10")?.state.kind, "answer", "the map's prognosis question has no condition");
    const result = validateReport(forged, b.template, { form: b.form });
    assert.equal(result.canSign, false, "the forged condition drops none of its checks");
    assert.deepEqual(result.blocking.filter((f) => f.sectionKey === "F-10").map((f) => f.code).sort(), honest.blocking.filter((f) => f.sectionKey === "F-10").map((f) => f.code).sort());
    // Without the map (a browser view only), the copy on the sections is what there is to read.
    assert.equal(boxIssueOf(forged, null, "F-10")?.state.kind, "not_applicable");
  });

  it("…under a reader version this build does not know, with reportModel removed, or on a required box with no answer", async () => {
    const b = await built(PROGNOSIS);
    const unknownVersion = withSection(b.report, "F-10", (s) => ({ ...s, condition: { ...FORGED, parser: "zz-9" } as never }));
    assert.equal(boxIssueOf(unknownVersion, b.form, "F-10")?.state.kind, "answer");
    const noModel = { ...withSection(b.report, "F-10", (s) => ({ ...s, condition: FORGED as never })), reportModel: undefined } as Report;
    assert.equal(isReleaseModel(noModel), true, "its frozen conditions still make it a report of this release");
    assert.equal(boxIssueOf(noModel, b.form, "F-10")?.state.kind, "answer");
    assert.equal(boxIssueOf(noModel, b.form, "F-06")?.state.kind, "not_applicable", "the map's own conditions still count");
    const req = await built({ report: "form:cf-discharge", answers: { "F-05": false }, box: "F-31" });
    const emptied = withSection(req.report, "F-31", (s) => ({ ...s, paragraphs: [], condition: FORGED as never }));
    assert.ok(
      validateReport(emptied, req.template, { form: req.form }).blocking.some((f) => f.sectionKey === "F-31"),
      "the 'required' block stays",
    );
  });

  it("a condition removed from a box the map makes conditional comes back from the map (the box is ruled out as on an honest report)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", cites: ["N-002"] }] } });
    const removed = withSection(b.report, "F-06", (s) => {
      const { condition: _c, ...rest } = s;
      void _c;
      return rest as ReportSection;
    });
    const a = issueDetails(b.report, b.form).map((x) => [x.key, x.state.kind]);
    const c = issueDetails(removed, b.form).map((x) => [x.key, x.state.kind]);
    assert.deepEqual(c, a);
  });

  it("an honest report reads exactly as its frozen copy says (the map's reading is what creation froze)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false, "F-07": true } });
    const fromMap = mapConditions((b.form as FormDefinition).fields);
    for (const s of b.report.sections) assert.deepEqual(s.condition ?? null, fromMap.get(s.key) ?? null, s.key);
    assert.deepEqual(issueDetails(b.report, b.form), issueDetails(b.report, b.form, { conditions: "report" }));
  });

  it("a built-in template's report has no conditions: one written into it does not rule a box out", async () => {
    const b = await built({ report: "template:solicitor_rta", box: "progress_current_status", paragraph: { text: "He will make a full recovery within 6 weeks.", cites: ["N-002"] } });
    const ctl = b.report.sections[0].key;
    const forged = {
      ...b.report,
      sections: b.report.sections.map((s) =>
        s.key === ctl ? { ...s, answer: { kind: "yes_no" as const, value: false } } : s.key === "progress_current_status" ? { ...s, condition: { controllers: [ctl], wants: "yes", parser: "wa1-c3" } as never } : s,
      ),
    } as Report;
    assert.notEqual(boxIssueOf(forged, null, "progress_current_status")?.state.kind, "not_applicable");
    assert.equal(validateReport(forged, b.template, {}).canSign, validateReport(b.report, b.template, {}).canSign);
  });

  it("/sign's legacy check: a report shown as one from before the release may not rule out what the server's reading keeps", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-07": true }, box: "F-10", paragraph: { text: "He will make a full recovery within 6 weeks.", cites: ["N-002"] } });
    const strip = (r: Report) => ({ ...r, reportModel: undefined, sections: r.sections.map(({ condition: _c, ...s }) => s) }) as Report;
    const honestLegacy = strip(b.report);
    assert.equal(isReleaseModel(honestLegacy), false);
    assert.deepEqual(legacyRuleOutsBeyondServer(honestLegacy, b.form), [], "the earlier reading of cf-discharge rules out only what the map does");
    const retitled = withSection(honestLegacy, "F-10", (s) => ({ ...s, title: "If not, the prognosis" }));
    assert.equal(boxIssueOf(retitled, b.form, "F-10")?.state.kind, "not_applicable", "the earlier reading reads the rewritten title");
    assert.deepEqual(legacyRuleOutsBeyondServer(retitled, b.form), ["F-10"]);
    assert.deepEqual(legacyRuleOutsBeyondServer(b.report, b.form), [], "a report of this release is the server's reading already");
    // A built-in template's report: its own printed questions are the server's.
    const t = await built({ report: "template:solicitor_rta" });
    const first = t.report.sections[0].key;
    const second = t.report.sections[1].key;
    const forgedTitle = {
      ...t.report,
      reportModel: undefined,
      sections: t.report.sections.map((s) => (s.key === first ? { ...s, answer: { kind: "yes_no" as const, value: false } } : s.key === second ? { ...s, title: "If yes, describe it" } : s)),
    } as Report;
    assert.deepEqual(legacyRuleOutsBeyondServer(forgedTitle, null, t.template.sections), [second]);
    assert.deepEqual(legacyRuleOutsBeyondServer({ ...t.report, reportModel: undefined } as Report, null, t.template.sections), []);
  });

  it("a migrated draft gets exactly the map's conditions", async () => {
    const b = await built({ report: "form:cf-discharge" });
    const legacy = { ...b.report, reportModel: undefined, sections: b.report.sections.map(({ condition: _c, ...s }) => s) } as Report;
    const migrated = migrateDraftToReleaseModel(legacy, b.form);
    const fromMap = mapConditions((b.form as FormDefinition).fields);
    for (const s of migrated.sections) assert.deepEqual(s.condition ?? null, fromMap.get(s.key) ?? null, s.key);
  });
});

describe("check2 N4: a decision is cancelled when a controlling TEXT box changes (B2-13 'filled' readings)", () => {
  const fields: ConditionField[] = [
    { id: "F-27", label: "Daily tasks – task still limited", answerType: "short_text" },
    { id: "F-28", label: "Daily tasks – how limited", answerType: "single_choice", options: ["Limited", "Cannot do"], guidance: "Only when a task is still limited" },
    { id: "F-29", label: "Daily tasks – details", answerType: "short_text" },
  ];
  const conds = compileConditions(fields);
  const sections = (text: string, asAnswer: boolean) =>
    fields.map((f) => ({
      key: f.id,
      title: f.label,
      kind: "ai_narrative",
      status: "drafted",
      paragraphs: f.id === "F-27" && !asAnswer && text ? [{ id: "p1", text, sourceIds: [], origin: "ai" }] : [],
      ...(f.id === "F-27" && asAnswer && text ? { answer: { kind: "text", value: text } } : {}),
      ...(conds.get(f.id) ? { condition: conds.get(f.id) } : {}),
    })) as unknown as ReportSection[];

  it("the snapshot records the text box's text; a later change to it – in paragraphs or a text answer – makes the decision stale", () => {
    assert.ok(conds.get("F-29"), "F-29 reads F-27");
    for (const asAnswer of [false, true]) {
      const empty = controllerSnapshotOf(sections("", asAnswer), "F-29", { release: true });
      assert.equal(dispositionIsStale({ controllerSnapshot: empty }, sections("", asAnswer)), false, "unchanged");
      assert.equal(dispositionIsStale({ controllerSnapshot: empty }, sections("Gardening", asAnswer)), true, `drafted later (${asAnswer ? "answer" : "paragraphs"})`);
      const gardening = controllerSnapshotOf(sections("Gardening", asAnswer), "F-29", { release: true });
      assert.deepEqual(gardening, [{ sectionKey: "F-27", answer: { kind: "text", value: "Gardening" } }]);
      assert.equal(dispositionIsStale({ controllerSnapshot: gardening }, sections("Gardening ", asAnswer)), false, "whitespace aside");
      assert.equal(dispositionIsStale({ controllerSnapshot: gardening }, sections("Gardening and DIY", asAnswer)), true);
      assert.equal(dispositionIsStale({ controllerSnapshot: gardening }, sections("", asAnswer)), true);
    }
    // A snapshot written without the text (an older writer) for a text box that holds some now: cancelled, never kept on a guess.
    assert.equal(dispositionIsStale({ controllerSnapshot: [{ sectionKey: "F-27" }] }, sections("Gardening", false)), true);
  });

  it("a structured controller compares as before", () => {
    const s = [
      { key: "F-05", title: "Is more treatment advised?", kind: "ai_narrative", status: "complete", paragraphs: [{ id: "p", text: "Explained.", sourceIds: [], origin: "ai" }], answer: { kind: "yes_no", value: false } },
    ] as unknown as ReportSection[];
    assert.equal(dispositionIsStale({ controllerSnapshot: [{ sectionKey: "F-05", answer: { kind: "yes_no", value: false } }] }, s), false);
    assert.equal(dispositionIsStale({ controllerSnapshot: [{ sectionKey: "F-05", answer: { kind: "yes_no", value: true } }] }, s), true);
  });
});

describe("check2 N3: a printed option longer than a frozen condition holds never breaks the form's reports", () => {
  it("it is left unresolved (the box applies), and the frozen reading passes the schema", () => {
    const opt = `Modified duties with a graded return ${"and supervised lifting tasks agreed with the occupational health adviser ".repeat(3)}`.trim();
    assert.ok(opt.length > 200);
    const fields: ConditionField[] = [
      { id: "F-01", label: "Current work status", answerType: "single_choice", options: ["Full duties", opt, "Off work"] },
      { id: "F-02", label: "If on modified duties with a graded return and supervised lifting tasks, list the tasks", answerType: "long_text" },
    ];
    const c = compileCondition(fields, "F-02");
    assert.equal(c?.unresolved, true, JSON.stringify(c));
    assert.equal(FrozenConditionSchema.safeParse(c).success, true);
    assert.equal(conditionText(fields, "F-02"), null);
    // A short option is still read.
    const short: ConditionField[] = [{ ...fields[0], options: ["Full duties", "Modified duties", "Off work"] }, { ...fields[1], label: "If on modified duties, list the tasks" }];
    assert.equal(compileCondition(short, "F-02")?.wants, "Modified duties");
  });

  it("a report of a form with such an option is created, stored and read (the schema accepts every frozen reading)", async () => {
    const opt = `Modified duties with a graded return ${"and supervised lifting tasks agreed with the occupational health adviser ".repeat(3)}`.trim();
    const b = await built({
      report: "form:cf-discharge",
      fill: { fieldPatches: { "F-04": { options: ["Full duties", opt, "Off work"] }, "F-06": { label: "If on modified duties with a graded return and supervised lifting tasks, list the tasks" } } },
    });
    assert.equal(b.report.sections.find((s) => s.key === "F-06")?.condition?.unresolved, true);
    assert.equal(ReportSchema.safeParse(b.report).success, true, "the store and /sign accept the report");
    for (const c of Array.from(mapConditions((b.form as FormDefinition).fields).values())) assert.equal(FrozenConditionSchema.safeParse(c).success, true);
  });
});

describe("check2 N2: the reader never rules a box out when the question says more than the clause", () => {
  type Ans = Record<string, boolean | string | null>;
  const yn = (id: string, label: string): ConditionField => ({ id, label, answerType: "yes_no" });
  const txt = (id: string, label: string): ConditionField => ({ id, label, answerType: "long_text" });
  const applies = (fields: ConditionField[], id: string, answers: Ans) => {
    const c = compileCondition(fields, id);
    if (!c) return true;
    const sections = fields.map((f) => ({ key: f.id, title: f.label, ...(f.id in answers ? { answer: { kind: f.answerType === "yes_no" ? "yes_no" : "text", value: answers[f.id] } } : {}) })) as never[];
    return evaluateCondition(c, sections).applies !== false;
  };
  const cases: Array<[string, ConditionField[], string, Ans]> = [
    ["declined", [yn("F-01", "Has the patient declined more sessions?"), txt("F-02", "If more sessions are given, how many?")], "F-02", { "F-01": false }],
    ["stopped (details)", [yn("F-01", "Has the patient stopped medication?"), txt("F-02", "Medication – details")], "F-02", { "F-01": false }],
    ["stop attending", [yn("F-01", "Did the patient stop attending treatment?"), txt("F-02", "If attending treatment, how often?")], "F-02", { "F-01": false }],
    ["failed to attend", [yn("F-01", "Has the patient failed to attend appointments?"), txt("F-02", "If attended appointments, give the dates")], "F-02", { "F-01": false }],
    ["reasons after declined", [yn("F-01", "Has the patient declined more sessions?"), txt("F-02", "Reasons for more sessions")], "F-02", { "F-01": false }],
    ["narrower question", [yn("F-01", "Is the patient working full time?"), txt("F-02", "If working, hours per week")], "F-02", { "F-01": false }],
    ["when-word", [yn("F-01", "Was the patient working before the injury?"), txt("F-02", "If currently working, hours per week")], "F-02", { "F-01": false }],
    ["frame word", [yn("F-01", "Do you advise that he goes back to his job?"), txt("F-02", "If he goes back to his job, which duties?")], "F-02", { "F-01": false }],
    ["back pain", [yn("F-01", "Does the patient have low back pain?"), txt("F-02", "Neck findings"), txt("F-03", "If the pain has returned, describe it")], "F-03", { "F-01": false }],
  ];
  for (const [name, fields, id, answers] of cases) {
    it(`${name}: the box applies`, () => assert.equal(applies(fields, id, answers), true, JSON.stringify(compileCondition(fields, id))));
  }

  it("the readings it should make are still made", () => {
    assert.equal(applies([yn("F-01", "Is the wound healed?"), txt("F-02", "If the wound is not healed, describe it")], "F-02", { "F-01": true }), false);
    assert.equal(applies([yn("F-01", "Is the patient working?"), txt("F-02", "If working, hours per week")], "F-02", { "F-01": false }), false);
    assert.equal(applies([yn("F-01", "Do you think he will recover fully?"), txt("F-02", "If you do not believe he will recover fully, say why")], "F-02", { "F-01": true }), false);
    assert.equal(applies([yn("F-01", "Is the knee getting worse?"), txt("F-02", "If the knee is getting worse, describe it")], "F-02", { "F-01": false }), false);
  });
});
