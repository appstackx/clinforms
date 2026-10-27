/**
 * bh2 fix round 1 – WC: who decides what, the source labels and the review's offers (R1T-WC-03 … R1T-WC-12, LOW
 * items L1–L8). Each test reproduces the reported shape on the corpus's fictional clinic (Sarah Reid approves, Tom Ellis
 * may sign, Pat Morgan is staff) through the real store and /sign handlers, the review reducer and the review's own
 * components (rendered to markup). Fictional data only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FormDefinition, Gap, Paragraph, Report, ReportFlag, ReportSection } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { ackPolicyOf } from "../../src/modules/medreport/core/validation/acknowledge";
import { isClinicianBox, isClinicianGap, pendingProposal, ruledOutByRule } from "../../src/modules/medreport/core/provenance";
import { buildCase, ownerOf, type Built } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { CORPUS_TENANT, actorOf } from "../../src/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { createHttpHarness, postSign, putStoredReport, type HttpHarness } from "../../src/modules/medreport/core/validation/__corpus__/harness/http";
import { CaseInputSchema } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { reviewReducer } from "../../src/modules/medreport/ui/components/review/use-review-state";
import { answerSource, paragraphProvenanceLine } from "../../src/modules/medreport/ui/components/review/provenance";
import { storedSuggestion } from "../../src/modules/medreport/ui/components/review/gaps";
import { setStructuredAnswer, splitOutPlan, storedAnswerValue } from "../../src/modules/medreport/ui/components/review/reducer";
import { lastRunWallMs } from "../../src/modules/medreport/ui/components/review/labels";
import { QuestionCard, blankRecordReason, needsClinicianText, oneClicksForBox } from "../../src/modules/medreport/ui/components/review/question-card";
import { gapProvenance } from "../../src/modules/medreport/ui/components/review/issues";
import { offersForFlag, reviewOneClicks } from "../../src/modules/medreport/ui/components/review/one-click-offers";
import { buildQuestionGroups, flattenQuestions } from "../../src/modules/medreport/ui/components/review/status";
import { offeredFixes, applyFixProposal, undoProposal } from "../../src/modules/medreport/ui/components/review/fixes";
import { issueDetails } from "../../src/modules/medreport/core/issue-state";
import { DEMO_IMPORT_ACTOR } from "../../src/modules/medreport/api/handlers/store-reports";

(globalThis as unknown as { React: typeof React }).React = React;

const SARAH = actorOf("sarah");
const PAT = actorOf("pat");
const TOM = actorOf("tom");

async function formCase(input: Record<string, unknown> = {}, report = "form:cf-discharge"): Promise<Built & { v: Report }> {
  const b = await buildCase(CaseInputSchema.parse({ report, ...input }));
  return { ...b, v: revalidate(b, b.report) };
}
function revalidate(b: Built, r: Report): Report {
  return { ...r, flags: validateReport(r, b.template, { computedFacts: b.computedFacts, form: b.form, voice: { owner: ownerOf(b) as never } }).flags };
}
const box = (r: Report, key: string) => r.sections.find((s) => s.key === key) as ReportSection;
const mapBox = (r: Report, key: string, fn: (s: ReportSection) => ReportSection): Report => ({ ...r, sections: r.sections.map((s) => (s.key === key ? fn(s) : s)) });
async function storeForm(h: HttpHarness, form: FormDefinition): Promise<void> {
  await h.store.createForm(CORPUS_TENANT, { id: form.id, status: form.status, title: form.title, referrer: form.referrer.name, kind: form.kind, fileSha256: form.file.sha256, sampleId: null, payload: form });
}
async function seed(h: HttpHarness, r: Report, as: "sarah" | "pat" | "tom" = "sarah"): Promise<number> {
  const res = await putStoredReport(h, r, as, null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as { rev: number }).rev;
}
const ctxOf = (b: Built) => ({ fields: b.form?.fields ?? null, form: b.form, boxes: b.template.sections });
/** The report with these boxes waiting for drafting (pending, empty, no questions about them). */
function pending(r: Report, keys: string[]): Report {
  const k = new Set(keys);
  return {
    ...r,
    sections: r.sections.map((s) => {
      if (!k.has(s.key)) return s;
      const n = { ...s, status: "pending" as const, paragraphs: [], ...(s.answer ? { answer: { ...s.answer, value: null } } : {}) };
      delete n.answerBy;
      delete n.adoptedBy;
      return n;
    }),
    gaps: r.gaps.filter((g) => !k.has(g.sectionKey)),
    flags: r.flags.filter((f) => !f.sectionKey || !k.has(f.sectionKey)),
  };
}

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-03 (SAF-2): a forged "drafted" tick in an opinion box
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-03: staff's forged redraft of a waiting opinion box with an unstamped tick is refused (F-11 band, F-15 and F-05 yes/no); the same redraft without the tick is stored", async () => {
  for (const [key, value] of [["F-11", "0-3 months"], ["F-15", true], ["F-05", false]] as const) {
    const b = await formCase({ box: key });
    const h = createHttpHarness();
    await storeForm(h, b.form!);
    const base = pending(b.v, [key]);
    const rev = await seed(h, base);
    const redraft = (withTick: boolean): Report => ({
      ...base,
      generation: [...base.generation, { mode: "live", sectionKeys: [key], at: base.updatedAt, promptVersion: "forms-9" }],
      sections: base.sections.map((s) => {
        if (s.key !== key) return s;
        const n = { ...s, status: "drafted" as const, paragraphs: [{ id: `${key}-d1`, text: "Tom Ellis recorded lumbar movement full and pain-free.", sourceIds: ["N-002"], origin: "ai" as const }] };
        return withTick && s.answer ? { ...n, answer: { kind: s.answer.kind, value } } : n;
      }),
    });
    assert.equal((await putStoredReport(h, redraft(true), "pat", rev)).status, 403, `${key}: a drafted tick in an opinion box`);
    assert.equal((await putStoredReport(h, redraft(false), "pat", rev)).status, 200, `${key}: drafting's own redraft`);
  }
});

test("R1T-WC-03: an unstamped answer in an opinion box beside drafted text is a proposal (APPROVER_DECISION), and /sign refuses it until the approver adopts it", async () => {
  const b = await formCase({ box: "F-11", boxes: { "F-11": [{ text: "Tom Ellis recorded lumbar movement full and pain-free.", cites: ["N-002"] }] } });
  const forged = mapBox(b.v, "F-11", (s) => {
    const n = { ...s, answer: { kind: "choice" as const, value: "0-3 months" } };
    delete n.answerBy;
    delete n.adoptedBy;
    return n;
  });
  const p = pendingProposal(forged, box(forged, "F-11"), ctxOf(b));
  assert.ok(p, "drafted text never vouches for an opinion box's answer");
  const v = revalidate(b, forged);
  assert.ok(v.flags.some((f) => f.sectionKey === "F-11" && f.code === "APPROVER_DECISION"));
  const h = createHttpHarness();
  assert.equal((await postSign(h, { report: v, template: b.template, form: b.form, signer: "sarah", mode: "tenant", fileBytes: b.fileBytes })).status, 409);
  const adopted = revalidate(b, reviewReducer(v, { type: "adopt", key: "F-11", actor: SARAH }, ctxOf(b)));
  assert.ok(!adopted.flags.some((f) => f.sectionKey === "F-11" && f.code === "APPROVER_DECISION"), "one audited Adopt");
});

test("R1T-WC-03: a create by staff holding an unstamped answer in an opinion box or the physiotherapist's choice is refused", async () => {
  const b = await formCase({ actor: "pat" });
  const h = createHttpHarness();
  await storeForm(h, b.form!);
  const factory = (r: Report): Report => ({
    ...r,
    sections: r.sections.map((s) => {
      const n = { ...s, paragraphs: s.paragraphs.filter((p) => p.origin === "ai" || p.origin === "from_records") };
      delete n.answerBy;
      delete n.adoptedBy;
      const filled = n.paragraphs.some((p) => p.origin === "from_records");
      if ((n.kind === "clinician_opinion" || (n.kind === "from_records" && !filled)) && n.answer && n.answer.kind !== "text") n.answer = { ...n.answer, value: null };
      return n;
    }),
    flags: [],
  });
  const fresh = factory(b.v);
  assert.equal((await putStoredReport(h, { ...fresh, id: "rpt_fresh" }, "pat", null)).status, 201);
  const tick = mapBox(fresh, "F-15", (s) => ({ ...s, answer: { kind: "yes_no", value: false } }));
  assert.equal((await putStoredReport(h, { ...tick, id: "rpt_tick" }, "pat", null)).status, 403, "an opinion box");
  const physio = mapBox(fresh, "F-04", (s) => ({ ...s, answer: { kind: "choice", value: "Full duties" } }));
  assert.equal((await putStoredReport(h, { ...physio, id: "rpt_physio" }, "pat", null)).status, 403, "the physiotherapist's choice");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-04 (SAF-3): drafted text rewritten in place
 * ----------------------------------------------------------------------------------------------*/

const DOSE_NOTE = [{ id: "N-001", author: "sarah", date: "2026-03-18", type: "initial_assessment", subjective: "Lifting injury at work on 12/03/2026. Taking ibuprofen.", objective: "No red flags." }];

test("R1T-WC-04: staff cannot rewrite drafted text in place – a dropped clause in an opinion box, a flipped negation in the findings, a fix record forged as the approver's", async () => {
  const b = await formCase({ notes: DOSE_NOTE, boxes: { "F-10": [{ text: "He was taking ibuprofen, and he has made a full recovery.", cites: ["N-001"] }], "F-32": [{ text: "No red flags were found on examination.", cites: ["N-001"] }] } });
  const h = createHttpHarness();
  await storeForm(h, b.form!);
  const rev = await seed(h, b.v);
  const rewrite = (key: string, text: string, fixes?: Paragraph["fixes"]) => mapBox(b.v, key, (s) => ({ ...s, paragraphs: s.paragraphs.map((p, i) => (i === 0 ? { ...p, text, ...(fixes ? { fixes } : {}) } : p)) }));
  assert.equal((await putStoredReport(h, rewrite("F-10", "He was taking ibuprofen."), "pat", rev)).status, 403, "a dropped clause");
  assert.equal((await putStoredReport(h, rewrite("F-32", "Red flags were found on examination."), "pat", rev)).status, 403, "a flipped negation");
  const forgedFix = [{ kind: "value-only", by: SARAH as never, at: b.v.updatedAt, edits: [{ start: 0, end: "No red flags were found on examination.".length, text: "Red flags were found on examination." }] }];
  assert.equal((await putStoredReport(h, rewrite("F-32", "Red flags were found on examination.", forgedFix), "pat", rev)).status, 403, "a fix record stamped as someone else");
  const ownFix = [{ kind: "value-only", by: PAT as never, at: b.v.updatedAt, edits: [{ start: 0, end: "No red flags were found on examination.".length, text: "Red flags were found on examination." }] }];
  assert.equal((await putStoredReport(h, rewrite("F-32", "Red flags were found on examination.", ownFix), "pat", rev)).status, 403, "a 'fix' the engine never offers");
});

test("R1T-WC-04: a one-click fix the engine offers (and its undo) is stored, the paragraph still drafted; in an opinion box only the approver's", async () => {
  const drafted = { text: "He was taking ibuprofen.", cites: ["N-001"], originalText: "He was taking ibuprofen." };
  const b = await formCase({ notes: DOSE_NOTE, boxes: { "F-32": [drafted], "F-10": [drafted] } });
  const h = createHttpHarness();
  await storeForm(h, b.form!);
  let rev = await seed(h, b.v);
  const fixFor = (who: typeof PAT, key: string) => offeredFixes(b.v, { actor: who, template: b.template, form: b.form }).find((f) => f.sectionKey === key && f.after !== f.before && f.after.trim());
  const patFix = fixFor(PAT, "F-32");
  assert.ok(patFix, "the engine offers staff '(dose not stated)' in the findings");
  const fixed = applyFixProposal(b.v, patFix, PAT);
  const res = await putStoredReport(h, fixed, "pat", rev);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const stored = (res.body as { report: Report }).report;
  const p = box(stored, "F-32").paragraphs[0];
  assert.equal(p.origin, "ai");
  assert.equal(p.fixes?.length, 1);
  rev = (res.body as { rev: number }).rev;
  const undone = applyFixProposal(stored, undoProposal(patFix, b.v), PAT);
  assert.equal((await putStoredReport(h, undone, "pat", rev)).status, 200, "an undo back to the drafted wording");
  // In the opinion box the approver's fix is stored; staff's (even the engine's own fix) is not.
  const h2 = createHttpHarness();
  await storeForm(h2, b.form!);
  const rev2 = await seed(h2, b.v);
  const sarahFix = fixFor(SARAH, "F-10");
  assert.ok(sarahFix, "the engine offers the approver the fix in the opinion box");
  assert.equal(fixFor(PAT, "F-10"), undefined, "never offered to staff there");
  assert.equal((await putStoredReport(h2, applyFixProposal(b.v, sarahFix, PAT), "pat", rev2)).status, 403);
  assert.equal((await putStoredReport(h2, applyFixProposal(b.v, sarahFix, SARAH), "sarah", rev2)).status, 200);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-05 (SAF-4): "not applicable" only where a rule rules the box out
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-05: staff's 'not applicable' settle of an opinion gap on a box that applies is refused; on a ruled-out box it is stored; the review reopens a stale one", async () => {
  const settle = (r: Report, key: string): Report => ({ ...r, gaps: r.gaps.map((g) => (g.sectionKey === key && !g.resolution ? { ...g, resolution: { kind: "resolved" as const, text: "Not applicable.", at: r.updatedAt, notApplicable: true } } : g)) });
  for (const [answer, want] of [[true, 403], [false, 200]] as const) {
    const b = await formCase({ answers: { "F-05": answer }, answersBy: { "F-05": "sarah" }, gaps: [{ box: "F-06", issue: "No clinician recorded which treatment is advised." }] });
    const h = createHttpHarness();
    await storeForm(h, b.form!);
    const rev = await seed(h, b.v);
    assert.equal((await putStoredReport(h, settle(b.v, "F-06"), "pat", rev)).status, want, `F-05 = ${answer}`);
    assert.equal(ruledOutByRule(b.v, ctxOf(b)).has("F-06"), !answer);
  }
  // F-09 (an opinion box no condition rules out): the staff settle never stands, in the store or in the review.
  const b = await formCase({ gaps: [{ box: "F-09", issue: "No clinician recorded an expected date of a full return." }] });
  const h = createHttpHarness();
  await storeForm(h, b.form!);
  const rev = await seed(h, b.v);
  assert.equal((await putStoredReport(h, settle(b.v, "F-09"), "pat", rev)).status, 403);
  const gap = b.v.gaps.find((g) => g.sectionKey === "F-09")!;
  assert.ok(isClinicianGap(b.v, gap, ctxOf(b)));
});

test("R1T-WC-05: in the review, a 'not applicable' settle stands only where a rule rules the box out; when the answer before it changes, the review reopens it whoever changed it", async () => {
  const b = await formCase({ answers: { "F-05": false }, answersBy: { "F-05": "sarah" }, gaps: [{ box: "F-06", issue: "No clinician recorded which treatment is advised." }] });
  const ctx = ctxOf(b);
  // The rule settles F-06's question (F-05 = No) when anyone answers; Pat then changes F-05 to Yes: F-06's question reopens.
  let r = reviewReducer(b.v, { type: "setAnswer", key: "F-07", value: true, actor: PAT }, ctx);
  const settled = r.gaps.find((g) => g.sectionKey === "F-06")?.resolution;
  assert.ok(settled?.notApplicable, "settled by the rule");
  r = reviewReducer(r, { type: "setAnswer", key: "F-05", value: true, actor: SARAH }, ctx);
  assert.equal(r.gaps.find((g) => g.sectionKey === "F-06")?.resolution, undefined, "reopened when it applies again");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-06 (SEC-3): an approver on every create; the approver-only rules with no approver too
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-06: a create with no approver is refused (staff and clinicians alike); the approver cannot be removed; approver-only rules apply on a report with none", async () => {
  const b = await formCase({ actor: "pat" });
  const h = createHttpHarness();
  const none = { ...b.v };
  delete none.approver;
  for (const who of ["pat", "tom", "sarah"] as const) assert.equal((await putStoredReport(h, { ...none, id: `rpt_none_${who}` }, who, null)).status, 403, who);
  const rev = await seed(h, b.v);
  assert.equal((await putStoredReport(h, none, "sarah", rev)).status, 403, "the approver is never removed");
  // A report stored before this release, with no approver: staff's unstamped "clinician" opinion is refused.
  const legacy = { ...none, id: "rpt_legacy_none" };
  await h.store.createReport(CORPUS_TENANT, { id: legacy.id, status: "draft", templateId: legacy.templateId, formId: legacy.form?.formId ?? null, payload: legacy });
  const opinion = mapBox(legacy, "F-10", (s) => ({ ...s, paragraphs: [{ id: "F-10-c1", text: "He will make a full recovery within 6 weeks.", sourceIds: [], origin: "clinician" }] }));
  assert.equal((await putStoredReport(h, opinion, "pat", 1)).status, 403);
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-07 (SEC-4): a demo import's stamps
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-07: a case imported from the public demo reads as the demo's one fixed user, whatever name its stamps carried", async () => {
  const b = await formCase({ boxes: { "F-31": [{ text: "Lifting injury at work on 12/03/2026.", cites: ["N-001"] }] } });
  const h = createHttpHarness();
  const demoAs = { ...actorOf("sarah"), memberId: "demo" };
  const r: Report = {
    ...b.report,
    id: "rpt_demo_import",
    tenantId: "demo",
    flags: [],
    sections: b.report.sections.map((s) => {
      const n = { ...s, paragraphs: s.paragraphs.filter((p) => p.origin === "ai" || p.origin === "from_records") };
      delete n.answerBy;
      delete n.adoptedBy;
      if (s.key === "F-31") n.paragraphs = [{ id: "F-31-c1", text: "Lifting injury at work in March.", sourceIds: ["N-001"], origin: "edited", by: demoAs }];
      const filled = n.paragraphs.some((p) => p.origin === "from_records");
      if ((n.kind === "clinician_opinion" || (n.kind === "from_records" && !filled)) && n.answer && n.answer.kind !== "text") n.answer = { ...n.answer, value: null };
      return n;
    }),
  };
  const res = await putStoredReport(h, r, "pat", null);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = (res.body as { report: Report }).report;
  const p = box(stored, "F-31").paragraphs[0];
  assert.deepEqual(p.by, DEMO_IMPORT_ACTOR);
  const line = paragraphProvenanceLine(p, box(stored, "F-31"), SARAH);
  assert.equal(line, `Entered by ${DEMO_IMPORT_ACTOR.name}`);
  assert.ok(!/Sarah Reid/.test(line ?? ""));
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-08: someone else's uncited text is adopted, never relabelled "my own words"
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-08: 'These are my own words' over staff's text is refused (review and store); the approver's Adopt keeps 'Entered by Pat Morgan (staff) – adopted by Sarah Reid'", async () => {
  const b = await formCase({ boxes: { "F-31": [] } });
  const ctx = ctxOf(b);
  const h = createHttpHarness();
  const rev0 = await seed(h, b.v);
  let r = revalidate(b, reviewReducer(b.v, { type: "addParagraph", key: "F-31", text: "Lifting injury at work in March; back pain since.", actor: PAT }, ctx));
  const typed = await putStoredReport(h, r, "pat", rev0);
  assert.equal(typed.status, 200, JSON.stringify(typed.body));
  const rev = (typed.body as { rev: number }).rev;
  const pid = box(r, "F-31").paragraphs[0].id;
  assert.ok(r.flags.some((f) => f.sectionKey === "F-31" && f.code === "UNCITED_PARAGRAPH"), "staff's uncited text blocks");
  assert.equal(reviewReducer(r, { type: "markOwnWords", key: "F-31", paragraphId: pid, actor: SARAH }, ctx), r, "never relabelled as the approver's");
  const forged = mapBox(r, "F-31", (s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, origin: "clinician" as const, by: SARAH, ownWords: { by: SARAH, at: r.updatedAt } })) }));
  assert.equal((await putStoredReport(h, forged, "sarah", rev)).status, 403, "the store refuses it too");
  r = revalidate(b, reviewReducer(r, { type: "adopt", key: "F-31", actor: SARAH }, ctx));
  const s = box(r, "F-31");
  assert.ok(!r.flags.some((f) => f.sectionKey === "F-31" && f.severity === "blocking"), "adopted: approvable");
  assert.equal(paragraphProvenanceLine(s.paragraphs[0], s, SARAH), "Entered by Pat Morgan (staff) – adopted by Sarah Reid");
  assert.ok(r.activity.some((a) => a.action === "adopted"), "audited");
  assert.equal((await putStoredReport(h, r, "sarah", rev)).status, 200, "the approver's Adopt is stored");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-09: a printed grade scale is the clinician's whatever question drafting raised
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-09: a printed grade-scale box is a clinician box with a 'record_value' question too; staff's grade is a proposal and staff cannot settle its question", async () => {
  const b = await formCase({ actor: "pat" }, "form:cf-initial");
  const ctx = ctxOf(b);
  const s = box(b.v, "F-10");
  assert.ok(isClinicianBox(b.v, s, ctx), "Severity grade (Grade 1 / 2 / 3)");
  assert.ok(!isClinicianBox(b.v, box(b.v, "F-12"), ctx), "Current medication is not");
  const gap: Gap = { id: "gap-F-10-ab12-1", sectionKey: "F-10", issue: "The notes give no grade.", suggestedQuestion: "?", relatedNoteIds: [], raisedBy: "ai", kind: "record_value" };
  const withGap = { ...b.v, gaps: [...b.v.gaps, gap] };
  assert.ok(isClinicianGap(withGap, gap, ctx));
  const graded = revalidate(b, reviewReducer(withGap, { type: "setAnswer", key: "F-10", value: "Grade 2", actor: PAT }, ctx));
  assert.equal(graded.gaps.find((g) => g.id === gap.id)?.resolution, undefined, "staff's grade does not settle the clinician's question");
  assert.ok(graded.flags.some((f) => f.sectionKey === "F-10" && f.code === "APPROVER_DECISION"), "a proposal the approver adopts");
  const resolved = reviewReducer(graded, { type: "resolveGap", gapId: gap.id, kind: "resolved", text: "Grade from the notes check.", actor: PAT }, ctx);
  assert.equal(resolved, graded, "nor may staff resolve it");
  const h = createHttpHarness();
  await storeForm(h, b.form!);
  const rev = await seed(h, withGap);
  const settled: Report = { ...withGap, gaps: withGap.gaps.map((g) => (g.id === gap.id ? { ...g, resolution: { kind: "resolved" as const, text: "Grade from the notes check.", at: withGap.updatedAt, by: PAT } } : g)) };
  assert.equal((await putStoredReport(h, settled, "pat", rev)).status, 403, "the store refuses staff's settle");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-10: the source label of a drafted tick with no text left
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-10: an answer no person's stamp vouches for, with no text beside it, reads 'drafted' – never 'clinician'", () => {
  const tick = { kind: "ai_narrative", paragraphs: [], answer: { kind: "checkbox", value: true } } as unknown as Pick<ReportSection, "kind" | "paragraphs" | "answer" | "answerBy">;
  assert.equal(answerSource(tick), "drafted");
  assert.equal(answerSource({ ...tick, kind: "from_records" } as typeof tick), "records");
  assert.equal(answerSource({ ...tick, answerBy: PAT } as typeof tick), "staff");
  assert.equal(answerSource({ ...tick, answerBy: SARAH } as typeof tick), "clinician");
  assert.equal(answerSource({ ...tick, paragraphs: [{ id: "c1", text: "My own note.", sourceIds: [], origin: "clinician" }] } as unknown as typeof tick), "clinician");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-11 (I8): a one-click "Tick" stores what the box holds
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-11: a suggestion is stored in the box's own shape – a tick box true, a yes/no true or false, a choice its printed option – and one it cannot hold is never offered", () => {
  const tickBox = { answerType: "checkbox", options: ["Yes"] } as const;
  assert.equal(storedSuggestion(tickBox as never, "Yes"), true);
  assert.equal(storedSuggestion({ answerType: "checkbox", options: ["Restriction: no heavy lifting"] } as never, "Restriction: no heavy lifting"), true);
  assert.equal(storedSuggestion(tickBox as never, "Probably"), undefined);
  assert.equal(storedSuggestion({ answerType: "yes_no", options: ["Yes", "No"] } as never, "No"), false);
  assert.equal(storedSuggestion({ answerType: "yes_no", options: ["Yes", "No"] } as never, "Yes"), true);
  assert.equal(storedSuggestion({ answerType: "single_choice", options: ["No Impact", "Some Impact"] } as never, "no impact"), "No Impact");
  assert.equal(storedSuggestion({ answerType: "single_choice", options: ["No Impact", "Some Impact"] } as never, "Severe"), undefined);
  assert.equal(storedAnswerValue("checkbox", "Yes"), true);
  assert.equal(storedAnswerValue("yes_no", "No"), false);
  assert.equal(storedAnswerValue("yes_no", "Unclear"), undefined);
  assert.equal(storedAnswerValue("choice", "Anything"), "Anything");
});

test("R1T-WC-11: the reducer stores 'Yes' on a tick box as a tick (no 'not a printed option' block), and refuses a word it cannot hold", async () => {
  const b = await formCase({ box: "F-05" }, "form:cf-initial");
  const r = setStructuredAnswer(b.v, "F-05", "Yes", SARAH);
  assert.deepEqual(box(r, "F-05").answer, { kind: "checkbox", value: true });
  const v = revalidate(b, r);
  assert.ok(!v.flags.some((f) => f.sectionKey === "F-05" && f.code === "MISSING_PLACEHOLDER" && f.severity === "blocking"));
  assert.equal(setStructuredAnswer(b.v, "F-05", "Probably", SARAH), b.v);
});

// (The block the raw word gave depends on the form's mark anchor – reproduced on the recorded CLM EOTS draft by the replay
// probe, wc-fix1 report; here the stored shape is pinned.)
test("R1T-WC-11 (I8): on a single-option tick box whose option is not 'Yes', the one-click stores the tick, never the word", async () => {
  const b = await formCase({ box: "F-05" }, "form:cf-initial");
  const form = { ...b.form!, fields: b.form!.fields.map((f) => (f.id === "F-05" ? { ...f, options: ["Discharged to self-management"] } : f)) };
  const field = form.fields.find((f) => f.id === "F-05")!;
  const value = storedSuggestion(field, "Yes");
  assert.equal(value, true);
  const validate = (r: Report) => validateReport(r, b.template, { computedFacts: b.computedFacts, form, voice: { owner: ownerOf(b) as never } }).flags.filter((f) => f.sectionKey === "F-05" && f.severity === "blocking" && f.code === "MISSING_PLACEHOLDER");
  assert.deepEqual(box(setStructuredAnswer(b.v, "F-05", "Yes", SARAH), "F-05").answer, { kind: "checkbox", value: true }, "never the string 'Yes'");
  assert.equal(validate(setStructuredAnswer(b.v, "F-05", value as boolean, SARAH)).length, 0, "the stored tick passes");
  assert.equal(validate(setStructuredAnswer(b.v, "F-05", "Yes", SARAH)).length, 0, "the reducer stores the word as the tick too");
});

/* ------------------------------------------------------------------------------------------------
 * R1T-WC-12 (RG-2): the approver's "This applies" and "Not applicable" on the card
 * ----------------------------------------------------------------------------------------------*/

async function cardMarkup(b: Built & { v: Report }, r: Report, key: string, actor: typeof SARAH, mayDecide: boolean): Promise<string> {
  const q = flattenQuestions(buildQuestionGroups(r, b.form, b.template)).find((x) => x.key === key)!;
  const kinds = new Map(issueDetails(r, b.form).filter((x) => x.state.kind === "not_applicable").map((x) => [x.key, (x.state as { reason: string }).reason]));
  const why = kinds.get(key) ? "the answer before it rules it out" : null;
  return renderToStaticMarkup(
    createElement(QuestionCard, {
      q,
      status: "drafted",
      flags: r.flags.filter((f) => f.sectionKey === key),
      gaps: r.gaps.filter((g) => g.sectionKey === key),
      bundle: r.bundleSnapshot,
      connectorId: r.episodeRef.connectorId,
      referrerName: null,
      readOnly: false,
      answerEdited: false,
      answeredByPerson: false,
      receipt: undefined,
      activeSourceId: null,
      drafting: false,
      actor,
      dispatch: () => undefined,
      onOpenSource: () => undefined,
      canAcknowledge: () => false,
      notApplicableBecause: why,
      notAskedKind: (kinds.get(key) as never) ?? null,
      mayDecide,
      approver: r.approver ?? null,
    }),
  );
}

test("R1T-WC-12: on a ruled-out card the approver is offered 'This applies – print my answer'; on a conditional card that applies, 'Not applicable'; staff neither – and the store refuses staff's", async () => {
  const b = await formCase({ answers: { "F-16": false, "F-17": false, "F-18": false }, answersBy: { "F-16": "sarah", "F-17": "sarah", "F-18": "sarah" }, boxes: { "F-19": [] } });
  const ruledOut = await cardMarkup(b, b.v, "F-19", SARAH, true);
  assert.match(ruledOut, /This applies – print my answer/);
  assert.doesNotMatch(await cardMarkup(b, b.v, "F-19", PAT, false), /This applies/);
  const ctx = ctxOf(b);
  const applies = reviewReducer(b.v, { type: "setDisposition", key: "F-19", kind: "applies_anyway", reason: "The approving clinician decided this question applies here.", actor: SARAH }, ctx);
  assert.equal(box(applies, "F-19").disposition?.kind, "applies_anyway");
  assert.ok(applies.activity.some((a) => a.action === "disposition_set"), "audited");
  assert.equal(reviewReducer(b.v, { type: "setDisposition", key: "F-19", kind: "applies_anyway", actor: PAT }, ctx), b.v, "never staff's");
  assert.match(await cardMarkup(b, applies, "F-19", SARAH, true), /Undo – it does not apply/);
  // Applying (F-16 = Yes): the approver may say it does not apply.
  const c = await formCase({ answers: { "F-16": true }, answersBy: { "F-16": "sarah" }, gaps: [{ box: "F-19", issue: "No clinician recorded the restriction's details." }] });
  assert.match(await cardMarkup(c, c.v, "F-19", SARAH, true), />Not applicable</);
  assert.doesNotMatch(await cardMarkup(c, c.v, "F-19", PAT, false), />Not applicable</);
  const na = reviewReducer(c.v, { type: "markNotApplicable", key: "F-19", on: true, reason: "The approving clinician decided this question does not apply here.", actor: SARAH }, ctxOf(c));
  assert.equal(box(na, "F-19").disposition?.kind, "not_applicable");
  assert.ok(na.gaps.filter((g) => g.sectionKey === "F-19").every((g) => g.resolution), "its question settled by the decision");
  const h = createHttpHarness();
  await storeForm(h, c.form!);
  const rev = await seed(h, c.v);
  const staffNa = mapBox(c.v, "F-19", (s) => ({ ...s, disposition: { kind: "not_applicable" as const, by: PAT, at: c.v.updatedAt } }));
  assert.equal((await putStoredReport(h, staffNa, "pat", rev)).status, 403);
  const staffApplies = mapBox(b.v, "F-19", (s) => ({ ...s, disposition: { kind: "applies_anyway" as const, by: PAT, at: b.v.updatedAt } }));
  const h2 = createHttpHarness();
  const rev2 = await seed(h2, b.v);
  assert.equal((await putStoredReport(h2, staffApplies, "pat", rev2)).status, 403);
});

/* ------------------------------------------------------------------------------------------------
 * LOW items
 * ----------------------------------------------------------------------------------------------*/

test("R1T-WC-L1: 'Split it out' is offered only when it changes something, and keeps the sentences' order", async () => {
  const drafted = "He is expected to make a full recovery within six weeks.";
  const b = await formCase({ boxes: { "F-10": [{ text: drafted, cites: ["N-001"] }] } });
  const s = box(b.v, "F-10");
  const own = (text: string): Paragraph => ({ id: "F-10-e1", text, sourceIds: ["N-001"], origin: "edited", originalText: drafted, by: SARAH });
  const section = (p: Paragraph): ReportSection => ({ ...s, paragraphs: [p] });
  assert.equal(splitOutPlan(section(own(drafted.replace("six", "6"))), own(drafted.replace("six", "6"))), null, "all drafted residue: nothing to split");
  const first = own(`${drafted} I reviewed him today and he is settling.`);
  const plan = splitOutPlan(section(first), first);
  assert.ok(plan && plan.draftedFirst, "the drafted sentence came first");
  const r = reviewReducer({ ...b.v, sections: b.v.sections.map((x) => (x.key === "F-10" ? section(first) : x)) }, { type: "splitOutResidue", key: "F-10", paragraphId: "F-10-e1", actor: SARAH });
  assert.deepEqual(box(r, "F-10").paragraphs.map((p) => p.origin), ["ai", "edited"], "the drafted paragraph stays first");
});

test("R1T-WC-L2: the card offers exactly the Flags tab's one-click corrections on each of its flags", async () => {
  const b = await formCase({ notes: DOSE_NOTE, boxes: { "F-32": [{ text: "He was taking ibuprofen.", cites: ["N-001"] }] } });
  const all = reviewOneClicks(b.v, { actor: PAT, template: b.template, form: b.form });
  const card = oneClicksForBox(all, "F-32");
  assert.ok(card && card.fixes.length > 0, "the box has an offer");
  for (const f of b.v.flags.filter((x) => x.sectionKey === "F-32")) assert.deepEqual(offersForFlag(card, f), offersForFlag(all, f));
  assert.equal(oneClicksForBox(all, "F-01"), undefined, "a box with none gets none (it stays memoised)");
  const q = flattenQuestions(buildQuestionGroups(b.v, b.form, b.template)).find((x) => x.key === "F-32")!;
  const html = renderToStaticMarkup(
    createElement(QuestionCard, {
      q, status: "blocked", flags: b.v.flags.filter((f) => f.sectionKey === "F-32"), gaps: [], bundle: b.v.bundleSnapshot, connectorId: b.v.episodeRef.connectorId, referrerName: null,
      readOnly: false, answerEdited: false, answeredByPerson: false, receipt: undefined, activeSourceId: null, drafting: false, actor: PAT, dispatch: () => undefined,
      onOpenSource: () => undefined, canAcknowledge: () => false, mayDecide: false, approver: b.v.approver ?? null, oneClicks: card, report: b.v, template: b.template, form: b.form,
    }),
  );
  assert.match(html, /dose not stated/, "the card shows the offer");
});

test("R1T-WC-L3: a held-back opinion number or yes/no is explained as the clinician's opinion, not by the notes' words", () => {
  const gap = { id: "gap-F-08-ab12-choice", kind: "choice_held_back" as const, raisedBy: "system" as const };
  assert.match(needsClinicianText(gap, { opinion: true }), /clinician's opinion/);
  assert.doesNotMatch(needsClinicianText(gap, { opinion: true }), /do not use its words/);
  assert.match(needsClinicianText(gap), /do not use its words/, "a record box keeps its wording");
  assert.match(gapProvenance(gap, { opinion: true }), /clinician's opinion/);
  assert.match(gapProvenance(gap), /a person ticks it/);
});

test("R1T-WC-L4: an empty record line says why for the part involved – never 'the address has no line' on a session row", () => {
  assert.match(blankRecordReason({ fillSource: { kind: "registration", path: "episode.attendedDate" } } as never), /session/);
  assert.match(blankRecordReason({ fillSource: { kind: "registration", path: "patient.addressLine" } } as never), /address/);
  assert.doesNotMatch(blankRecordReason({ fillSource: { kind: "registration", path: "episode.attendedTime" } } as never), /address/);
});

test("R1T-WC-L5: the supporting text of a structured answer is named as such, not as the answer", async () => {
  const b = await formCase({ answers: { "F-07": true }, answersBy: { "F-07": "sarah" }, boxes: { "F-07": [{ text: "Back at work since May.", cites: ["N-002"] }] } });
  const html = await cardMarkup(b, b.v, "F-07", SARAH, true);
  assert.match(html, /aria-label="Supporting text for “Has the patient gone back to work\?” \(not printed\)"/);
});

test("R1T-WC-L6: a numbered row naming the same item as an earlier row may be kept with a reason (its own message says so); other blocking draft-fit checks may not", () => {
  const row = { id: "f1", code: "DRAFT_FIT", severity: "blocking", sectionKey: "F-32", paragraphId: "p1", evidence: "repeat F-31", message: "… or keep it with a reason.", ackPolicy: "member" } as ReportFlag;
  assert.equal(ackPolicyOf(row), "member");
  assert.equal(ackPolicyOf({ ...row, ackPolicy: undefined }), "never", "only where the validator says so");
  assert.equal(ackPolicyOf({ ...row, evidence: "printed lead" }), "never");
  assert.equal(ackPolicyOf({ ...row, code: "UNCITED_PARAGRAPH" }), "never");
});

test("R1T-WC-L7: the drafting time is the last run's – from its first call to its last – not since the report was made", () => {
  const at = (min: number, s = 0) => new Date(Date.UTC(2026, 9, 27, 9, min, s)).toISOString();
  const first = [{ at: at(0), durationMs: 40_000 }, { at: at(0, 2), durationMs: 50_000 }];
  const later = [{ at: at(8), durationMs: 30_000 }, { at: at(8, 1), durationMs: 55_000 }];
  assert.equal(lastRunWallMs([...first, ...later]), 56_000);
  assert.equal(lastRunWallMs(first), 52_000);
  assert.equal(lastRunWallMs([{ at: at(0) }]), null);
});

test("R1T-WC-L8: the store refuses an acknowledgement nobody may make (a 'never' check), by staff or the approver", async () => {
  const b = await formCase({ boxes: { "F-31": [] } });
  const typed = revalidate(b, reviewReducer(b.v, { type: "addParagraph", key: "F-31", text: "Lifting injury at work.", actor: PAT }, ctxOf(b)));
  const flag = typed.flags.find((f) => f.sectionKey === "F-31" && f.code === "UNCITED_PARAGRAPH");
  assert.ok(flag && ackPolicyOf(flag, typed) === "never");
  for (const who of ["pat", "sarah"] as const) {
    const h = createHttpHarness();
    const rev0 = await seed(h, b.v);
    const put = await putStoredReport(h, typed, "pat", rev0);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const rev = (put.body as { rev: number }).rev;
    const acked: Report = { ...typed, flags: typed.flags.map((f): ReportFlag => (f.id === flag.id ? { ...f, acknowledged: { reason: "Checked.", at: typed.updatedAt, by: actorOf(who) } } : f)) };
    assert.equal((await putStoredReport(h, acked, who, rev)).status, 403, who);
  }
});

void TOM;
