/**
 * bh2 WA1 – the issue state (core/issue-state.ts): one hashed answer to "what does this box issue", read by the fill,
 * Copy answers, the question summary, the review's statuses and counts, and the validators.
 *
 * Fictional data only: the safety corpus's fictional clinic, patients and synthetic forms (cf-discharge, cf-merge).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyEntries } from "./answer-copy";
import { compileCondition, conditionOf, conditionText, evaluateCondition, legacyConditionOf, type ConditionField } from "./conditions";
import { buildFormAnswers, formToTemplate } from "./forms";
import { boxIssueOf, countOutcomes, controllerSnapshotOf, dispositionVerdict, isReleaseModel, issueContentOf, issueState, migrateDraftToReleaseModel, notApplicableBecause } from "./issue-state";
import { ISSUE_EXCLUDED_KEYS } from "./issue-types";
import { applyDraftResult } from "./report-factory";
import type { FormDefinition, Paragraph, Report, ReportFlag, SectionDisposition } from "./types";
import { validateReport, withHookDisabled } from "./validation";
import { CaseInputSchema, type CaseInput } from "./validation/__corpus__/harness/types";
import { buildCase, CORPUS_AT, type Built } from "./validation/__corpus__/harness/build";
import { actorOf, clinicianOf } from "./validation/__corpus__/harness/fixtures";
import { DOCX_MIME } from "../forms/file";
import { renderFormFile } from "../forms/render-form";
import { openZipSafely } from "../forms/zip-guard";
import { buildQuestionSummaryViewModel } from "../docgen/question-summary";
import { answerableCount, countStatuses, questionStatus } from "../ui/components/review/status";
import { issuedSummary } from "../ui/components/review/approved-banner";
import { buildQuestionGroups, flattenQuestions } from "../ui/components/review/status";

process.env.MEDREPORT_AI_MODE = "demo";

const RECEIPT = { signer: clinicianOf("sarah"), signedAt: CORPUS_AT };

async function built(input: Record<string, unknown>): Promise<Built> {
  return buildCase(CaseInputSchema.parse(input) as CaseInput);
}

function para(id: string, text: string, extra: Partial<Paragraph> = {}): Paragraph {
  return { id, text, sourceIds: ["N-002"], origin: "ai", ...extra };
}

function withBox(report: Report, key: string, paragraphs: Paragraph[]): Report {
  return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, status: "drafted" as const, paragraphs } : s)) };
}

function withDisposition(report: Report, key: string, d: Partial<SectionDisposition> & Pick<SectionDisposition, "kind">, by = actorOf("sarah")): Report {
  return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, disposition: { by, at: CORPUS_AT, ...d } as SectionDisposition } : s)) };
}

function setAnswer(report: Report, key: string, value: boolean | string | null): Report {
  return {
    ...report,
    sections: report.sections.map((s) =>
      s.key === key ? { ...s, status: "complete" as const, answer: { kind: s.answer?.kind ?? "yes_no", value } as NonNullable<typeof s.answer> } : s,
    ),
  };
}

async function finalText(report: Report, form: FormDefinition, bytes: Uint8Array): Promise<string> {
  const answers = buildFormAnswers(report, form, { receipt: RECEIPT });
  const out = await renderFormFile({ form, file: { bytes, mimeType: DOCX_MIME, sha256: form.file.sha256, sizeBytes: bytes.byteLength }, answers, draft: false, format: "original" });
  const xml = openZipSafely(out.bytes).file("word/document.xml")?.asText() ?? "";
  return xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** A deterministic PRNG (mulberry32), so the 200 mutations are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Change only what the receipt does not cover – flags, activity, status, updatedAt – as a forging client would. */
function forge(report: Report, rand: () => number): Report {
  const keys = report.sections.map((s) => s.key);
  const pick = () => keys[Math.floor(rand() * keys.length)];
  const r: Report = { ...report, flags: [...report.flags], activity: [...report.activity] };
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    switch (Math.floor(rand() * 7)) {
      case 0: // a forged acknowledged NOT_APPLICABLE_ANSWERED ("print my answer anyway")
        r.flags.push({ id: `forged-na-${i}`, code: "NOT_APPLICABLE_ANSWERED", severity: "blocking", sectionKey: pick(), message: "forged", acknowledged: { reason: "Print it anyway (forged).", at: CORPUS_AT, by: actorOf("sarah") } } as ReportFlag);
        break;
      case 1: // a forged acknowledged opinion flag
        r.flags.push({ id: `forged-op-${i}`, code: "OPINION_LANGUAGE", severity: "blocking", sectionKey: pick(), message: "forged", evidence: "full recovery", acknowledged: { reason: "Accepted (forged).", at: CORPUS_AT } } as ReportFlag);
        break;
      case 2: // forged answer_set / decision entries
        r.activity.push({ at: CORPUS_AT, actor: "Pat Morgan", action: "answer_set", detail: `${pick()}: forged answer` });
        r.activity.push({ at: CORPUS_AT, actor: "Sarah Reid", action: "edited", detail: `${pick()}: marked not applicable (forged)` });
        break;
      case 3:
        r.flags = [];
        break;
      case 4:
        r.status = rand() < 0.5 ? "draft" : "signed";
        break;
      case 5:
        r.updatedAt = new Date(Date.UTC(2026, 0, 1) + Math.floor(rand() * 1e10)).toISOString();
        break;
      default:
        r.activity = r.activity.slice(0, Math.floor(rand() * (r.activity.length + 1)));
    }
  }
  return r;
}

/* ------------------------------------------------------------------------------------------------
 * The bases: conditional boxes ruled out and in, printed anyway, a merge code, sessions, a printed default
 * ----------------------------------------------------------------------------------------------*/

async function bases(): Promise<Array<{ name: string; b: Built }>> {
  const out: Array<{ name: string; b: Built }> = [];
  const add = async (name: string, input: Record<string, unknown>, patch?: (r: Report) => Report) => {
    const b = await built(input);
    out.push({ name, b: patch ? { ...b, report: patch(b.report) } : b });
  };
  await add("ruled out, clinician text", { report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", origin: "clinician", by: "sarah" }] } });
  await add("ruled in", { report: "form:cf-discharge", answers: { "F-05": true }, boxes: { "F-06": [{ text: "Six more sessions of exercise.", cites: ["N-002"] }] } });
  await add("printed anyway", { report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "Tom Ellis discharged him to self-management.", cites: ["N-002"] }] }, dispositions: { "F-06": { kind: "applies_anyway", by: "sarah", reason: "It applies." } } });
  await add("lettered and either", { report: "form:cf-discharge", answers: { "F-15": true, "F-16": false, "F-17": false, "F-18": false, "F-39": false, "F-40": true }, boxes: { "F-19": [{ text: "Avoid standing for long.", cites: ["N-002"] }], "F-41": [{ text: "Aching on waking.", cites: ["N-002"] }] } });
  await add("merge code ruled out", { report: "form:cf-merge", answers: { "F-02": false }, boxes: { "F-04": [{ text: "None.", origin: "clinician", by: "sarah" }] } });
  await add("only if not", { report: "form:cf-discharge", answers: { "F-07": true }, boxes: { "F-09": [{ text: "01/12/2026", cites: ["N-002"] }], "F-27": [{ text: "lighter work", origin: "clinician", by: "sarah" }] } });
  return out;
}

describe("issue state: only the content counts (R-security-1, AC-ISSUE-1)", () => {
  it("strips flags, activity, status, updatedAt and the receipt at run time", () => {
    const content = issueContentOf({ sections: [], flags: [1], activity: [2], status: "signed", updatedAt: "x", receipt: {}, id: "r" });
    for (const key of ISSUE_EXCLUDED_KEYS) assert.equal(key in content, false, key);
    assert.equal((content as { id: string }).id, "r");
  });

  it("200 seeded mutations of flags, activity, status and updatedAt never change the issue state or the FINAL text", async () => {
    const rand = rng(20261026);
    const all = await bases();
    let mutations = 0;
    for (const { name, b } of all) {
      const form = b.form as FormDefinition;
      const bytes = b.fileBytes as Uint8Array;
      const state = JSON.stringify(issueState(b.report, form));
      const text = await finalText(b.report, form, bytes);
      const per = Math.ceil(200 / all.length);
      for (let i = 0; i < per; i++, mutations++) {
        const forged = forge(b.report, rand);
        assert.equal(JSON.stringify(issueState(forged, form)), state, `${name} #${i}: issue state`);
        assert.equal(await finalText(forged, form, bytes), text, `${name} #${i}: FINAL text`);
      }
    }
    assert.ok(mutations >= 200, `${mutations} mutations`);
  });
});

describe("issue state: one answer for every consumer (I5, AC-ISSUE-2, AC-ISSUE-3)", () => {
  it("Copy answers = the question summary = the counts = the issue state, and every answer text is in the FINAL document", async () => {
    for (const { name, b } of await bases()) {
      const form = b.form as FormDefinition;
      const report: Report = { ...b.report, status: "signed" };
      const state = issueState(report, form);
      const copied = copyEntries({ ...report, receipt: undefined }, form);
      const text = await finalText(b.report, form, b.fileBytes as Uint8Array);
      const vm = buildQuestionSummaryViewModel(b.report, form, formToTemplate(form), { receipt: { ...RECEIPT, reportId: report.id, tenantId: report.tenantId, contentSha256: "0".repeat(64), statementAccepted: true, attestations: [], mac: "x" } });
      for (const entry of copied) {
        const s = state[entry.key];
        assert.ok(s, `${name} ${entry.key}: in the issue state`);
        if (entry.signoff) continue;
        assert.equal(entry.answer !== null, s.kind === "answer", `${name} ${entry.key}: copied ⇔ answered (${s.kind})`);
        if (s.kind === "not_applicable") assert.equal(entry.status, "not_applicable", `${name} ${entry.key}`);
        const summary = vm.sections.find((x) => x.key === entry.key);
        assert.equal(summary?.isPlaceholder, entry.answer === null, `${name} ${entry.key}: the summary says the same`);
        if (s.kind === "answer" && !s.value && !s.rows) {
          for (const line of s.text.split(/\n+/).filter(Boolean)) assert.ok(text.includes(line.trim()), `${name} ${entry.key}: “${line}” is on the FINAL form`);
        }
        if (s.kind !== "answer") {
          const own = report.sections.find((x) => x.key === entry.key)?.paragraphs.map((p) => p.text).filter(Boolean) ?? [];
          for (const t of own) assert.equal(text.includes(t), false, `${name} ${entry.key}: “${t}” is not issued`);
        }
      }
      const counts = countOutcomes(state);
      assert.equal(counts.answered + counts.notApplicable + counts.leftBlank + counts.recordEmpty + counts.noAnswer + counts.referrerUse + counts.signoff, counts.total, `${name}: the counts add up`);
      assert.equal(counts.total, form.fields.length);
    }
  });

  it("a complete approved form shows 100% – not applicable, nothing in the record and left blank are not in the denominator (B2-24, B3-16)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false } });
    const form = b.form as FormDefinition;
    const template = formToTemplate(form);
    const signed: Report = { ...b.report, status: "signed" };
    const flags = validateReport(signed, template, { form }).flags;
    const qs = flattenQuestions(buildQuestionGroups(signed, form, template));
    const counts = countStatuses(qs.map((q) => questionStatus(q, flags, signed.gaps, false, true, signed)));
    assert.equal(counts.counts.not_applicable >= 1, true, "F-06 is not applicable, counted apart");
    const done = counts.counts.records + counts.counts.drafted + counts.counts.clinician;
    assert.equal(done, answerableCount(counts), "answered and clear = every question that needed an answer");
  });

  it("names why a box is not asked, for its card", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false } });
    assert.match(notApplicableBecause(b.report, b.form, "F-06") ?? "", /“Is more treatment advised\?” is “No”/);
    assert.equal(notApplicableBecause(b.report, b.form, "F-05"), null);
  });
});

describe("issue state: people's decisions (WA1 design 2)", () => {
  it("only the approver's “applies anyway” prints a ruled-out box; staff's does not count (AC-ISSUE-4)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "Tom Ellis discharged him to self-management.", cites: ["N-002"] }] } });
    const form = b.form as FormDefinition;
    assert.equal(issueState(b.report, form)["F-06"].kind, "not_applicable");
    const byApprover = withDisposition(b.report, "F-06", { kind: "applies_anyway", reason: "It applies." });
    assert.equal(issueState(byApprover, form)["F-06"].kind, "answer");
    const byStaff = withDisposition(b.report, "F-06", { kind: "applies_anyway", reason: "Print it." }, actorOf("pat"));
    assert.equal(issueState(byStaff, form)["F-06"].kind, "not_applicable");
    const byOther = withDisposition(b.report, "F-06", { kind: "applies_anyway", reason: "Print it." }, actorOf("tom"));
    assert.equal(dispositionVerdict(byOther, byOther.sections.find((s) => s.key === "F-06")!, form.fields.find((f) => f.id === "F-06")!, true), "not_allowed", "a clinician who is not the approver");
  });

  it("a change to the controlling answer cancels a person's decision (stale controllerSnapshot)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": true }, boxes: { "F-06": [{ text: "Six more sessions.", cites: ["N-002"] }] } });
    const form = b.form as FormDefinition;
    const snapshot = controllerSnapshotOf(b.report.sections, "F-06");
    assert.deepEqual(snapshot.map((s) => [s.sectionKey, s.answer?.value]), [["F-05", true]]);
    const decided = withDisposition(b.report, "F-06", { kind: "not_applicable", reason: "Covered elsewhere.", controllerSnapshot: snapshot });
    assert.deepEqual(issueState(decided, form)["F-06"], { kind: "not_applicable", reason: "person" });
    const flipped = setAnswer(decided, "F-05", null);
    assert.equal(boxIssueOf(flipped, form, "F-06")?.dispositionVerdict, "stale");
    assert.equal(issueState(flipped, form)["F-06"].kind, "answer", "the decision no longer counts: the box applies and prints");
  });

  it("“left blank” counts on optional boxes only, and an answer cancels it (B2-26)", async () => {
    const b = await built({ report: "form:cf-discharge" });
    const form = b.form as FormDefinition;
    const required = withDisposition({ ...b.report, sections: b.report.sections.map((s) => (s.key === "F-32" ? { ...s, paragraphs: [] } : s)) }, "F-32", { kind: "left_blank", reason: "Nothing recorded." });
    assert.deepEqual(issueState(required, form)["F-32"], { kind: "blank", reason: "no_answer" });
    assert.equal(validateReport(required, formToTemplate(form), { form }).canSign, false, "a required box is never approved blank");
    const optional = withDisposition(b.report, "F-26", { kind: "left_blank", reason: "Not recorded." });
    assert.deepEqual(issueState(optional, form)["F-26"], { kind: "blank", reason: "left_blank" });
    const answered = withBox(optional, "F-26", [para("p-26", "45 minutes", { origin: "clinician" })]);
    assert.equal(issueState(answered, form)["F-26"].kind, "answer");
    assert.equal(boxIssueOf(answered, form, "F-26")?.dispositionVerdict, "cancelled");
  });

  it("on a clinician's box only the approver's “not applicable” counts", async () => {
    const b = await built({ report: "form:cf-discharge" });
    const form = b.form as FormDefinition;
    const byStaff = withDisposition(b.report, "F-10", { kind: "not_applicable", reason: "No." }, actorOf("pat"));
    assert.notEqual(issueState(byStaff, form)["F-10"].kind, "not_applicable");
    const byApprover = withDisposition(b.report, "F-10", { kind: "not_applicable", reason: "Not asked by this referrer." });
    assert.deepEqual(issueState(byApprover, form)["F-10"], { kind: "not_applicable", reason: "person" });
  });
});

describe("validators read the issue state (WA1 design 5)", () => {
  const opinion = "He will make a full recovery within 6 weeks and is fit for normal duties.";

  it("with the approver's “applies anyway”, opinion, voice and figure checks run on drafted and edited text", async () => {
    for (const origin of ["ai", "edited"] as const) {
      const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, box: "F-06", paragraph: { text: `${opinion} I assessed his back on 06/05/2026. Flexion was 155 degrees.`, cites: ["N-002"], origin } });
      const form = b.form as FormDefinition;
      const template = formToTemplate(form);
      const ruledOut = validateReport(b.report, template, { form }).flags.filter((f) => f.sectionKey === "F-06");
      // Edited text is a person's: they are told it will not be printed (a warning) – nothing else is checked.
      assert.deepEqual(ruledOut.map((f) => f.code), origin === "edited" ? ["NOT_APPLICABLE_ANSWERED"] : [], `${origin}: a box that issues nothing is not checked`);
      const anyway = withDisposition(b.report, "F-06", { kind: "applies_anyway", reason: "It applies." });
      const codes = new Set(validateReport(anyway, template, { form }).flags.filter((f) => f.sectionKey === "F-06").map((f) => f.code));
      for (const code of ["OPINION_LANGUAGE", "OTHER_CLINICIAN_VOICE", "FIGURE_NOT_IN_SOURCE"]) assert.ok(codes.has(code as ReportFlag["code"]), `${origin}: ${code} runs`);
    }
  });

  it("the approver's own typed opinion in a box printed anyway passes", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, box: "F-06", paragraph: { text: "In my opinion a further 4 weeks of exercise is needed.", cites: [], origin: "clinician", by: "sarah", ownWords: "sarah" } });
    const form = b.form as FormDefinition;
    const anyway = withDisposition(b.report, "F-06", { kind: "applies_anyway", reason: "It applies." });
    const res = validateReport(anyway, formToTemplate(form), { form, voice: { owner: clinicianOf("sarah") } });
    assert.deepEqual(res.blocking.filter((f) => f.sectionKey === "F-06"), []);
  });

  it("a person's answer in a box that does not apply is never dropped without a word (B1-1): NOT_APPLICABLE_ANSWERED", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", origin: "clinician", by: "sarah" }] } });
    const form = b.form as FormDefinition;
    const flags = validateReport(b.report, formToTemplate(form), { form }).flags.filter((f) => f.sectionKey === "F-06");
    const na = flags.find((f) => f.code === "NOT_APPLICABLE_ANSWERED");
    assert.ok(na, "the person is told");
    assert.equal(na.severity, "warning");
    assert.equal(na.ackPolicy, "never");
    const drafted = await built({ report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", cites: ["N-002"] }] } });
    assert.equal(validateReport(drafted.report, formToTemplate(form), { form }).flags.some((f) => f.code === "NOT_APPLICABLE_ANSWERED"), false, "a draft nobody chose is simply not printed");
  });

  it("a merge code in a box ruled out by its frozen condition is cleared – approvable; in an optional blank box it blocks", async () => {
    const out = await built({ report: "form:cf-merge", answers: { "F-02": false }, boxes: { "F-04": [{ text: "None.", origin: "clinician", by: "sarah" }] } });
    const form = out.form as FormDefinition;
    const template = formToTemplate(form);
    assert.equal(validateReport(out.report, template, { form }).canSign, true);
    assert.deepEqual(buildFormAnswers(out.report, form, { receipt: RECEIPT })["F-03"], { text: "", blank: true, leftBlank: true });
    assert.equal((await finalText(out.report, form, out.fileBytes as Uint8Array)).includes("<<P_"), false);
    const blank = await built({ report: "form:cf-merge", answers: { "F-02": true }, boxes: { "F-03": [{ text: "Four more weeks.", origin: "clinician", by: "sarah" }] } });
    const res = validateReport(blank.report, template, { form });
    assert.ok(res.blocking.some((f) => f.sectionKey === "F-04" && f.code === "MISSING_PLACEHOLDER" && (f.evidence ?? "").includes("<<P_COMMENTS>>")));
  });

  it("an answer that is none of a choice's printed options blocks on a tick-box form (Q-1, C-FILL-1)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-04": "Part-time" } });
    const form = b.form as FormDefinition;
    const f = validateReport(b.report, formToTemplate(form), { form }).blocking.find((x) => x.sectionKey === "F-04" && x.code === "MISSING_PLACEHOLDER");
    assert.equal(f?.evidence, "Part-time");
    const ok = await built({ report: "form:cf-discharge", answers: { "F-04": "Lighter duties" } });
    assert.equal(validateReport(ok.report, formToTemplate(form), { form }).blocking.some((x) => x.sectionKey === "F-04"), false);
  });

  it("the ledger seams: with “condition-parser” off no box is ruled out; with “not-applicable-drop” off nothing is dropped", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, box: "F-06", paragraph: { text: opinion, cites: ["N-002"] } });
    const form = b.form as FormDefinition;
    const template = formToTemplate(form);
    assert.equal(issueState(b.report, form)["F-06"].kind, "not_applicable");
    await withHookDisabled("condition-parser", async () => {
      assert.equal(issueState(b.report, form)["F-06"].kind, "answer");
    });
    assert.equal(validateReport(b.report, template, { form }).flags.some((f) => f.sectionKey === "F-06" && f.code === "OPINION_LANGUAGE"), false);
    await withHookDisabled("not-applicable-drop", async () => {
      assert.equal(validateReport(b.report, template, { form }).flags.some((f) => f.sectionKey === "F-06" && f.code === "OPINION_LANGUAGE"), true);
    });
  });
});

describe("conditions are read once and frozen (WA1 design 3, the S-COND set)", () => {
  const f = (id: string, label: string, answerType = "long_text", guidance = ""): ConditionField => ({ id, label, answerType, guidance });

  it("“Only if … not …” wants No – about the question it depends on (R-safety-9)", () => {
    const fields = [f("F-01", "Has the patient gone back to work?", "yes_no"), f("F-02", "Expected date back", "date"), f("F-03", "Expected date of a full return", "date", "Only if he or she is not yet back at work: when.")];
    assert.deepEqual(pick(compileCondition(fields, "F-03")), { controllers: ["F-01"], wants: "no" });
    // A free clause about something else is never matched to an answer: unresolved, so the box applies.
    const other = [f("F-01", "Has the patient gone back to work?", "yes_no"), f("F-02", "Reason", "long_text", "Only if consent to share was not given: say why.")];
    assert.equal(compileCondition(other, "F-02")?.unresolved, true);
    // Two negations (“not off work”) are never guessed either.
    const twice = [f("F-01", "Is he working at the moment?", "yes_no"), f("F-02", "If he is not off work, the hours he works now")];
    assert.equal(compileCondition(twice, "F-02")?.unresolved, true);
  });

  it("lettered questions: “If yes to b, c or d”, “If (b), (c) or (d) is Yes”", () => {
    const lettered = [f("F-01", "a. Working now?", "yes_no"), f("F-02", "b. Off sick?", "yes_no"), f("F-03", "c. Shorter shifts?", "yes_no"), f("F-04", "d. Lighter tasks?", "yes_no")];
    assert.deepEqual(pick(compileCondition([...lettered, f("F-05", "If yes to b, c or d, list them")], "F-05")), { controllers: ["F-02", "F-03", "F-04"], wants: "yes", match: "any" });
    assert.deepEqual(pick(compileCondition([...lettered, f("F-05", "If (b), (c) or (d) is Yes, give details")], "F-05")), { controllers: ["F-02", "F-03", "F-04"], wants: "yes", match: "any" });
    // A letter the form does not print: unresolved.
    assert.equal(compileCondition([...lettered, f("F-05", "If (b) or (e) is Yes, give details")], "F-05")?.unresolved, true);
    assert.equal(conditionText([...lettered, f("F-05", "If (b), (c) or (d) is Yes, give details")], "F-05"), "any of F-02 (“b. Off sick?”), F-03 (“c. Shorter shifts?”), F-04 (“d. Lighter tasks?”) is Yes");
  });

  it("“either question above” is the two questions just above; “any question above” the whole run", () => {
    const run = [f("F-01", "Home exercises given", "yes_no"), f("F-02", "Pain at night?", "yes_no"), f("F-03", "Pain on waking?", "yes_no")];
    assert.deepEqual(pick(compileCondition([...run, f("F-04", "If no to either question above, describe it")], "F-04")), { controllers: ["F-02", "F-03"], wants: "no", match: "any" });
    assert.deepEqual(pick(compileCondition([...run, f("F-04", "If any question above is Yes, say which")], "F-04")), { controllers: ["F-01", "F-02", "F-03"], wants: "yes", match: "any" });
    assert.deepEqual(pick(compileCondition([...run, f("F-04", "If yes to both questions above, describe the pain")], "F-04")), { controllers: ["F-02", "F-03"], wants: "yes", match: "all" });
  });

  it("unresolved means applicable: a condition that cannot be read is drafted and fully checked", () => {
    const fields = [f("F-01", "Is he working at the moment?", "yes_no"), f("F-02", "If the pain is getting worse, say what is planned")];
    const c = compileCondition(fields, "F-02");
    assert.equal(c?.unresolved, true);
    const sections = [
      { key: "F-01", title: "Is he working at the moment?", answer: { kind: "yes_no" as const, value: false } },
      { key: "F-02", title: "If the pain is getting worse, say what is planned", condition: c ?? undefined },
    ];
    assert.equal(conditionOf(sections, "F-02")?.applies, null);
  });

  it("reads every question the earlier reading read (no run-time fallback for a report this release makes)", () => {
    const titles = ["IF YES, DESCRIBE IT", "If not, the expected date", "Kind – if other, which", "If any question above is Yes, say which", "5. If so, how many?", "(c) If no, why not?"];
    for (const title of titles) {
      const fields = [f("F-01", "Any further treatment?", "yes_no"), f("F-02", title)];
      const legacy = legacyConditionOf([{ key: "F-01", title: "Any further treatment?", answer: { kind: "yes_no", value: true } }, { key: "F-02", title }], "F-02");
      if (legacy) assert.ok(compileCondition(fields, "F-02"), title);
    }
  });

  it("is frozen when the report is created and kept through drafting (B2-4)", async () => {
    const b = await built({ report: "form:cf-discharge" });
    const frozen = b.report.sections.find((s) => s.key === "F-09")?.condition;
    assert.deepEqual(pick(frozen ?? null), { controllers: ["F-07"], wants: "no" });
    const drafted = applyDraftResult(b.report, {
      sections: [{ key: "F-09", title: "x", kind: "clinician_opinion", status: "drafted", fieldId: "F-09", paragraphs: [para("d-1", "01/12/2026")] }],
      gaps: [],
      flags: [],
      generation: { mode: "demo_prewritten", sectionKeys: ["F-09"], at: CORPUS_AT, promptVersion: "test" },
    });
    assert.deepEqual(drafted.sections.find((s) => s.key === "F-09")?.condition, frozen);
  });

  it("a draft from before the release migrates on load; an approved one is never touched", async () => {
    const b = await built({ report: "form:cf-discharge" });
    const legacy = { ...b.report, reportModel: undefined, sections: b.report.sections.map(({ condition: _c, ...s }) => s) } as Report;
    const migrated = migrateDraftToReleaseModel(legacy, b.form);
    assert.equal(migrated.reportModel, 2);
    assert.deepEqual(migrated.sections.find((s) => s.key === "F-06")?.condition, b.report.sections.find((s) => s.key === "F-06")?.condition);
    const signed = { ...legacy, status: "signed" as const };
    assert.equal(migrateDraftToReleaseModel(signed, b.form), signed);
  });
});

describe("conditions read by what they name (check-WA1 M2: B2-4, B1-9, B2-13 kept) – never guessed (minor 1)", () => {
  const f = (id: string, label: string, answerType = "long_text", more: Partial<ConditionField> = {}): ConditionField => ({ id, label, answerType, guidance: "", ...more });
  const yn = (id: string, label: string) => f(id, label, "yes_no");
  const tick = (id: string, label: string) => f(id, label, "checkbox");
  const choice = (id: string, label: string, options: string[]) => f(id, label, "single_choice", { options });
  type Ans = Record<string, boolean | string | null>;
  /** The frozen reading of `id`, evaluated against `answers` (and `texts` in text boxes): applies true / false / null. */
  function applies(fields: ConditionField[], id: string, answers: Ans, texts: Record<string, string> = {}): boolean | null {
    const c = compileCondition(fields, id);
    if (!c) return true;
    const kindOf = (t: string) => (t === "single_choice" ? "choice" : t === "checkbox" ? "checkbox" : t === "yes_no" ? "yes_no" : "text");
    const sections = fields.map((x) => ({
      key: x.id,
      title: x.label,
      ...(x.id in answers ? { answer: { kind: kindOf(x.answerType), value: answers[x.id] } as NonNullable<Report["sections"][number]["answer"]> } : {}),
      paragraphs: texts[x.id] ? [para(`${x.id}-p1`, texts[x.id])] : [],
    }));
    return evaluateCondition(c, sections).applies;
  }

  it("a positive clause in the guidance names the tick it depends on: “Only when the tape restriction is kept”", () => {
    const fields = [tick("F-01", "Restriction required – no kneeling"), tick("F-02", "Restriction required – tape support"), f("F-03", "Tape (hours)", "short_text", { guidance: "Only when the tape restriction is kept: how many hours." })];
    assert.deepEqual(pick(compileCondition(fields, "F-03")), { controllers: ["F-02"], wants: "yes" });
    assert.equal(applies(fields, "F-03", { "F-02": false }), false);
    assert.equal(applies(fields, "F-03", { "F-02": true }), true);
    assert.equal(applies(fields, "F-03", {}), null, "not known yet: it applies");
    assert.equal(conditionText(fields, "F-03"), "F-02 (“Restriction required – tape support”) is ticked");
  });

  it("a tick it names can come just after it, or further up: “If you do not advise a brace …”", () => {
    const after = [f("F-01", "Support – please specify", "short_text", { guidance: "Only when a brace or a sling is planned: which one." }), tick("F-02", "Support plan – Brace/Sling")];
    assert.deepEqual(pick(compileCondition(after, "F-01")), { controllers: ["F-02"], wants: "yes" });
    const far = [tick("F-01", "Plan – Knee brace"), yn("F-02", "Is a full recovery expected?"), f("F-03", "Reasons"), f("F-04", "If you do not advise a knee brace at this stage, say why")];
    assert.deepEqual(pick(compileCondition(far, "F-04")), { controllers: ["F-01"], wants: "no" });
    assert.equal(applies(far, "F-04", { "F-01": true }), false);
    assert.equal(applies(far, "F-04", { "F-01": false }), true);
    // A one-word topic is read only against the nearest question before it: never bound further up.
    assert.equal(compileCondition([tick("F-01", "Plan – Brace"), yn("F-02", "Is a full recovery expected?"), f("F-03", "If you do not advise a brace, say why")], "F-03")?.unresolved, true);
  });

  it("a printed option of a choice: “If the knee is getting worse” after a choice that prints “Getting worse”", () => {
    const fields = [choice("F-01", "How is the knee since treatment?", ["Better", "No change", "Getting worse"]), f("F-02", "If the knee is getting worse, what is advised?")];
    assert.deepEqual(pick(compileCondition(fields, "F-02")), { controllers: ["F-01"], wants: "Getting worse" });
    assert.equal(applies(fields, "F-02", { "F-01": "Better" }), false);
    assert.equal(applies(fields, "F-02", { "F-01": "Getting worse" }), true);
    assert.equal(conditionText(fields, "F-02"), "F-01 (“How is the knee since treatment?”) is “Getting worse”");
  });

  it("a condition in the printed heading – “not yet working full duties” – reads the choice: any other option applies", () => {
    const heading = "If he is not on his full duties, list each problem";
    const fields = [choice("F-01", "Work status", ["Back in his normal role", "Shorter shifts", "Absent from work"]), f("F-02", "Problem 1", "short_text", { section: heading }), f("F-03", "Problem 1 – weeks", "short_text", { section: heading })];
    for (const id of ["F-02", "F-03"]) {
      const c = compileCondition(fields, id) as (ReturnType<typeof compileCondition> & { wantsNot?: string }) | null;
      assert.deepEqual([c?.controllers, c?.wantsNot, c?.wants], [["F-01"], "Back in his normal role", undefined], id);
      assert.equal(applies(fields, id, { "F-01": "Back in his normal role" }), false);
      assert.equal(applies(fields, id, { "F-01": "Shorter shifts" }), true);
      assert.equal(applies(fields, id, {}), null);
    }
    // A heading that is an earlier question's own label is a sub-question, not a condition.
    assert.equal(compileCondition([yn("F-01", "If he is not on his full duties, list each problem"), f("F-02", "Problem 1", "short_text", { section: "If he is not on his full duties, list each problem" })], "F-02"), null);
  });

  it("a text box of the same row that names nothing (“None”) rules out the row's choice and details (B2-13)", () => {
    const fields = [
      f("F-01", "Home tasks – task still limited", "short_text"),
      choice("F-02", "Home tasks – status", ["Limited", "Cannot do"]),
      f("F-03", "Home tasks – details", "short_text"),
    ];
    fields[1].guidance = "Limited or Cannot do – the other is struck out. Only when a task is still limited.";
    for (const id of ["F-02", "F-03"]) {
      assert.deepEqual([compileCondition(fields, id)?.controllers, (compileCondition(fields, id) as { filled?: true } | null)?.filled], [["F-01"], true], id);
      assert.equal(applies(fields, id, {}, { "F-01": "None." }), false);
      assert.equal(applies(fields, id, {}, { "F-01": "Carrying shopping" }), true);
      assert.equal(applies(fields, id, {}, {}), null, "nothing drafted yet: it applies");
    }
    assert.equal(conditionText(fields, "F-02"), "F-01 (“Home tasks – task still limited”) names something (not “None”)");
  });

  it("“Reasons for …” and “<X> – details” belong to the yes/no just before them that asks about it (B1-9, B2-5)", () => {
    const reasons = [yn("F-01", "Is more treatment advised?"), f("F-02", "If yes, how many sessions", "short_text"), f("F-03", "Reasons for advising more treatment")];
    assert.deepEqual(pick(compileCondition(reasons, "F-03")), { controllers: ["F-01"], wants: "yes" });
    const details = [yn("F-01", "Is there any swelling at rest?"), f("F-02", "Swelling at rest – details")];
    assert.deepEqual(pick(compileCondition(details, "F-02")), { controllers: ["F-01"], wants: "yes" });
    // About something else: an ordinary question.
    assert.equal(compileCondition([yn("F-01", "Is he taking painkillers?"), f("F-02", "Swelling at rest – details")], "F-02"), null);
  });

  it("never guessed (check-WA1 minor 1): a turned question, a shared word, a numbered reference, an “and” list, a widened clause", () => {
    // (a) "If not <content>" is a clause, not a bare "If not": never read against a question that is itself turned.
    const off = [yn("F-01", "Is he signed off work?"), f("F-02", "If not gone back to work, the expected date", "date")];
    assert.equal(compileCondition(off, "F-02")?.unresolved, true);
    assert.equal(applies(off, "F-02", { "F-01": true }), null);
    // …and read by its words when the question asks exactly that, even past a nearer question.
    const back = [yn("F-01", "Has he gone back to work?"), yn("F-02", "Any pain at night?"), f("F-03", "If not gone back to work, the expected date", "date")];
    assert.deepEqual(pick(compileCondition(back, "F-03")), { controllers: ["F-01"], wants: "no" });
    // (b) One shared word never turns a reading round.
    const shared = [yn("F-01", "Does he need more treatment?"), f("F-02", "If the treatment has not finished, how many sessions remain?")];
    assert.equal(compileCondition(shared, "F-02")?.unresolved, true);
    // (c) A numbered reference is never bound to the nearest question.
    const numbered = [yn("F-01", "1. Is he working?"), yn("F-02", "2. Any pain at night?"), f("F-03", "3. If yes to question 1, give the job")];
    assert.equal(compileCondition(numbered, "F-03")?.unresolved, true);
    // (d) "If no <content>" with nothing it names: unresolved.
    const noImprovement = [yn("F-01", "Is the knee improving?"), yn("F-02", "Was a home programme given?"), f("F-03", "If no improvement, what is planned next")];
    assert.equal(applies(noImprovement, "F-03", { "F-01": false, "F-02": true }) !== false, true);
    // An "and" list is any one of them; "all of" is all of them.
    const lettered = [yn("F-01", "(a) Lifting limited?"), yn("F-02", "(b) Standing limited?"), yn("F-03", "(c) Driving limited?")];
    assert.deepEqual(pick(compileCondition([...lettered, f("F-04", "If yes to a, b and c, give details")], "F-04")), { controllers: ["F-01", "F-02", "F-03"], wants: "yes", match: "any" });
    assert.deepEqual(pick(compileCondition([...lettered, f("F-04", "If yes to all of (a)–(c), give details")], "F-04")), { controllers: ["F-01", "F-02", "F-03"], wants: "yes", match: "all" });
    // A second clause that widens it is never dropped; one that only narrows it ("and if he still takes them") is.
    assert.equal(compileCondition([yn("F-01", "Any red flags?"), f("F-02", "If yes, or if unsure, give details")], "F-02")?.unresolved, true);
    assert.deepEqual(pick(compileCondition([yn("F-01", "Taken painkillers"), f("F-02", "Taken painkillers - If yes, give details and if he still takes them")], "F-02")), { controllers: ["F-01"], wants: "yes" });
  });

  it("a frozen reading the evaluator does not know is unresolved, never “does not apply” (minor 1e)", () => {
    const sections = [
      { key: "F-01", title: "Q", answer: { kind: "yes_no" as const, value: true } },
      { key: "F-02", title: "Kind", answer: { kind: "choice" as const, value: "Light" } },
      { key: "F-03", title: "D" },
    ];
    for (const condition of [
      { controllers: ["F-01"], wants: "Modified duties" },
      { controllers: ["F-01"], wants: "other" },
      { controllers: ["F-02"], wantsNot: 3 },
      { controllers: ["F-01"], filled: true },
      { controllers: ["F-01"], wants: "yes", filled: true },
      { controllers: ["F-01"] },
      { controllers: ["F-01"], wants: "no", match: "most" },
    ]) {
      assert.equal(evaluateCondition(condition as never, sections).applies, null, JSON.stringify(condition));
    }
  });

  it("a report this release made never falls back to the earlier run-time reading (design 8); with the map, the server's reading counts (harden-WA1 N1)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false }, boxes: { "F-06": [{ text: "More physiotherapy is advised.", cites: ["N-002"] }] } });
    assert.equal(b.report.reportModel, 2);
    assert.equal(boxIssueOf(b.report, b.form, "F-06")?.state.kind, "not_applicable");
    const dropped = { ...b.report, sections: b.report.sections.map((s) => (s.key === "F-06" ? (({ condition: _c, ...rest }) => rest)(s) : s)) } as Report;
    // Without the map (a browser view): the sections as they are – no run-time reading of the printed words.
    assert.equal(boxIssueOf(dropped, null, "F-06")?.state.kind, "answer", "never read again from the printed words");
    // With the map: the attested map's own condition, whatever the section holds.
    assert.equal(boxIssueOf(dropped, b.form, "F-06")?.state.kind, "not_applicable", "the map's condition, not the report's copy");
    // Removing reportModel too: still a report of this release (its other sections carry frozen conditions).
    const legacy = { ...dropped, reportModel: undefined } as Report;
    assert.equal(isReleaseModel(legacy), true);
    assert.equal(boxIssueOf(legacy, b.form, "F-06")?.state.kind, "not_applicable");
  });
});

describe("check-WA1 minors: the clinician box from the map, the approved counts, a legacy fill", () => {
  it("a clinician's box is the attested map's (fillSource), not the section's own kind (minor 3)", async () => {
    const b = await built({ report: "form:cf-discharge", box: "F-10", paragraph: { text: "He will make a full recovery within 6 weeks.", cites: ["N-002"] } });
    const rewritten = { ...b.report, sections: b.report.sections.map((s) => (s.key === "F-10" ? { ...s, kind: "ai_narrative" as const } : s)) };
    const forged = withDisposition(rewritten, "F-10", { kind: "not_applicable", reason: "Not needed." }, actorOf("pat"));
    assert.equal(boxIssueOf(forged, b.form, "F-10")?.state.kind, "answer");
    assert.equal(boxIssueOf(forged, b.form, "F-10")?.dispositionVerdict, "not_allowed");
    assert.equal(boxIssueOf(withDisposition(rewritten, "F-10", { kind: "not_applicable", reason: "Not needed." }), b.form, "F-10")?.state.kind, "not_applicable", "the approver's counts");
  });

  it("the approved summary counts with the form map, as the review and Copy answers do (minor 2)", async () => {
    const b = await built({ report: "form:cf-discharge", answers: { "F-05": false } });
    const lb = withDisposition(b.report, "F-25", { kind: "left_blank" });
    const approved = { ...lb, status: "signed" as const, receipt: { ...RECEIPT, mac: "x" } as unknown as Report["receipt"] };
    const c = countOutcomes(issueState(lb, b.form));
    const summary = issuedSummary(approved as Report, b.form);
    assert.ok(summary?.includes(`${c.notApplicable} not applicable`), summary ?? "");
    assert.ok(summary?.includes(`${c.leftBlank + c.noAnswer} left blank`), summary ?? "");
    assert.equal(issuedSummary(approved as Report, null), null, "nothing said without the map");
  });

  it("a report from before the release with no section for a field fills it as printed – {} (AC-ISSUE-6, minor 5)", async () => {
    const b = await built({ report: "form:cf-discharge" });
    const legacy = { ...b.report, reportModel: undefined, sections: b.report.sections.filter((s) => s.key !== "F-31").map(({ condition: _c, ...s }) => s) } as Report;
    assert.deepEqual(buildFormAnswers(legacy, b.form as FormDefinition, { receipt: RECEIPT })["F-31"], {});
    const release = { ...b.report, sections: b.report.sections.filter((s) => s.key !== "F-31") };
    assert.deepEqual(buildFormAnswers(release, b.form as FormDefinition, { receipt: RECEIPT })["F-31"], { leftBlank: true });
  });
});

function pick(c: { controllers: string[]; wants?: string; match?: string; unresolved?: boolean } | null): Record<string, unknown> | null {
  if (!c) return null;
  return { controllers: c.controllers, ...(c.wants ? { wants: c.wants } : {}), ...(c.match ? { match: c.match } : {}), ...(c.unresolved ? { unresolved: true } : {}) };
}
