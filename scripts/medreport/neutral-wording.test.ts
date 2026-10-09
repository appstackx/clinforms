/**
 * Neutral customer-facing wording (core/wording.ts, DISCLOSURE "neutral"): no vendor, model or
 * technology terms anywhere a clinic can see or download – the wording itself, the core labels, the
 * API fields the Studio stores and renders, server messages shown in the Studio, and the case export.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "@/app/api/_medreport-glue";
import { handleAiPayloadPreview } from "@/modules/medreport/api/handlers/ai-payload-preview";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { handleFormsAnalyse } from "@/modules/medreport/api/handlers/forms-analyse";
import { handleHealth } from "@/modules/medreport/api/handlers/health";
import {
  AiPayloadPreviewResponseSchema,
  DraftsResponseSchema,
  FormsAnalyseResponseSchema,
  HealthResponseSchema,
  ProblemSchema,
} from "@/modules/medreport/api/contract";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { NOTICES } from "@/modules/medreport/config.public";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { formTemplateId, formToTemplate } from "@/modules/medreport/core/forms";
import {
  FILL_SOURCE_LABELS,
  FORM_ANALYSIS_MODE_LABELS,
  PARAGRAPH_ORIGIN_LABELS,
  SECTION_KIND_LABELS,
} from "@/modules/medreport/core/labels";
import { applyDraftResult, createFormReport, planDraftGroups } from "@/modules/medreport/core/report-factory";
import type { GenerationMeta, Report } from "@/modules/medreport/core/types";
import {
  DISCLOSURE,
  NEUTRAL_ENGINE,
  WORDING,
  hasBannedTerm,
  neutralLegacyText,
  publicEngineName,
  wordingFor,
} from "@/modules/medreport/core/wording";
import { SAMPLE_FORMS, getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { buildCaseExport, importCase } from "@/modules/medreport/ui/store";
import { reportFingerprint } from "@/modules/medreport/core/fingerprint";
import { ReportSchema } from "@/modules/medreport/core/schemas";
import { getDemoBundle } from "./dev-bundles";

const MODEL = "claude-sonnet-5-5";
const drafts = route(handleDrafts);
const analyse = route(handleFormsAnalyse);
const payloadPreview = route(handleAiPayloadPreview);
const health = route(handleHealth);

function post(path: string, body: unknown): Request {
  return new Request(`http://127.0.0.1:9${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const SECONDS = (ms: number) => `${Math.round(ms / 1000)} s`;
const LINE_LIVE = { sectionKeys: ["F-07", "F-08"], mode: "live", at: "2026-10-06T20:04:00.000Z", durationMs: 6000, model: MODEL, tokens: 1234 };
const LINE_RECORDED = { sectionKeys: ["F-07"], mode: "demo_recorded", at: "2026-10-06T20:04:00.000Z", durationMs: 6000, model: MODEL };
const LINE_SAMPLE = { sectionKeys: ["F-09"], mode: "demo_prewritten", at: "2026-10-06T20:04:00.000Z" };

/** Arguments for every wording function (by path). A model id or an AI_* code is passed wherever one can reach the text. */
const CALLS: Record<string, unknown[][]> = {
  "mode.ariaLabel": [["Demo mode"]],
  "drafting.liveProgress": [[10], [1], []],
  "drafting.groupDone": [["live", MODEL], ["demo_recorded", MODEL], ["demo_prewritten"], [undefined]],
  "drafting.activityDrafted": [[["F-07", "F-08"], "live", MODEL], [["F-07"], "demo_recorded", MODEL], [["F-09"], "demo_prewritten"]],
  "drafting.failureCode": [["AI_TIMEOUT"], ["AI_ERROR"], ["AI_REFUSAL"], ["AI_MAX_TOKENS"], ["LIVE_AI_UNAVAILABLE"], ["NO_DEMO_DRAFT"]],
  "generation.live": [["17 s"], [null]],
  "generation.recorded": [["06/10/2026"]],
  "generation.line": [[LINE_LIVE, SECONDS], [LINE_RECORDED, SECONDS], [LINE_SAMPLE, SECONDS]],
  "answersCopy.panelIntroPortal": [["Northbridge Health (fictional)"]],
  "answersCopy.copyOneAria": [["Date of birth"]],
  "answersCopy.copiedOne": [["Date of birth"]],
  "answersCopy.copiedAll": [[1], [12]],
  "answersCopy.gapsCount": [[1], [3]],
  "answersCopy.leftBlankCount": [[1], [2]],
  "answersCopy.approvedHeader": [["Sarah Reid", "PH-DEMO-01", "09/10/2026"]],
  "payload.recordCaption": [["The record (minimised)", MODEL, "forms-4"]],
  "server.liveLocked": [[3, "use the demo draft"]],
  "server.passcodeRequired": [["draft live from the notes"]],
  "server.liveRateLimited": [[20, "use the demo draft"]],
  "server.sdk.timeout": [["Retry, or use the demo draft."]],
  "server.sdk.rateLimited": [["use the demo draft"]],
  "server.sdk.badRequest": [["draft"]],
  "server.sdk.unreachable": [["Retry, or use the demo draft."]],
  "server.sdk.apiError": [["529", "Retry, or use the demo draft."]],
  "server.sdk.refusal": [["draft", "Retry, or use the demo draft."]],
  "server.sdk.unreadable": [["Retry, or use the demo draft."]],
  "server.analysis.fallbackNote": [["AI_ERROR"]],
  "server.analysis.recordedDetail": [["06/10/2026", MODEL]],
  "server.analysis.tooManyCalls": [[3]],
  "server.analysis.liveDetail": [[{ model: MODEL, chunks: 2, effort: "high", questions: 16 }]],
  "server.analysis.liveFailedRules": [["AI_TIMEOUT"]],
  "server.analysis.liveErrorWarning": [["The drafting service did not answer in time."]],
};

/** Every string a wording object can produce: plain strings, and each function called with CALLS. */
function allStrings(value: unknown, path = "", out: Array<{ path: string; text: string }> = []): Array<{ path: string; text: string }> {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => allStrings(v, `${path}[${i}]`, out));
  else if (typeof value === "function") {
    const calls = CALLS[path];
    assert.ok(calls, `add sample arguments for WORDING.${path} to CALLS`);
    for (const args of calls) allStrings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) allStrings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

function keyShape(value: unknown): unknown {
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, keyShape(v)]));
  return typeof value;
}

test("the default disclosure is neutral, and the neutral wording names no vendor, model or technology", () => {
  assert.equal(DISCLOSURE, "neutral");
  assert.equal(WORDING.disclosure, "neutral");
  const strings = allStrings(WORDING);
  assert.ok(strings.length > 80, `${strings.length} strings checked`);
  const offending = strings.filter((s) => hasBannedTerm(s.text) || /opus|sonnet|haiku|fable|drafting-service/i.test(s.text));
  assert.deepEqual(offending, []);
});

test("the guide's wording is used where the owner set it", () => {
  assert.equal(WORDING.mode.live, "Live drafting");
  assert.equal(WORDING.mode.demo, "Demo mode");
  assert.equal(WORDING.mode.passcodeLabel, "Live drafting passcode");
  assert.equal(WORDING.origin.drafted, "Draft");
  assert.equal(WORDING.drafting.liveProgress(10), "Drafting answers from 10 notes…");
  assert.equal(WORDING.generation.live("17 s"), "Drafted from the notes in 17 s");
  assert.equal(WORDING.generation.recorded("06/10/2026"), "Prepared demo draft (06/10/2026)");
  assert.equal(WORDING.generation.prewritten, "Sample draft (demo)");
  assert.equal(
    WORDING.generation.line({ sectionKeys: ["F-07", "F-08"], mode: "live", at: "2026-10-06T20:04:00.000Z", durationMs: 6000 }, () => "6 s"),
    "F-07, F-08 · drafted 06/10/2026 21:04 · 6 s",
  );
  assert.equal(WORDING.payload.toggle, "See exactly what the drafting service receives");
});

test("the ai-assisted variant is kept with the same shape, for later", () => {
  const ai = wordingFor("ai-assisted");
  assert.deepEqual(keyShape(ai), keyShape(wordingFor("neutral")));
  assert.equal(ai.mode.live, "Live AI");
  assert.equal(publicEngineName("claude-opus-5-5", "ai-assisted"), "claude-opus-5-5");
  assert.equal(publicEngineName("claude-sonnet-5-5", "ai-assisted"), "claude-sonnet-5-5");
});

test("core labels and notices are neutral", () => {
  const labels = [
    ...Object.values(FILL_SOURCE_LABELS),
    ...Object.values(FORM_ANALYSIS_MODE_LABELS),
    ...Object.values(PARAGRAPH_ORIGIN_LABELS),
    ...Object.values(SECTION_KIND_LABELS),
    ...Object.values(NOTICES),
  ];
  assert.deepEqual(labels.filter(hasBannedTerm), []);
  assert.equal(PARAGRAPH_ORIGIN_LABELS.ai, "Draft");
});

test("engine names and legacy text are neutral", () => {
  assert.equal(publicEngineName("claude-opus-5-5"), NEUTRAL_ENGINE);
  assert.equal(publicEngineName("claude-sonnet-5-5"), NEUTRAL_ENGINE);
  assert.equal(publicEngineName(undefined), undefined);
  const legacy = [
    "Drafted F-07, F-08 (live AI, claude-opus-5-5).",
    "Drafted F-07 (recorded Claude output).",
    "Drafted F-09 (pre-written draft, no AI call).",
    "Could not draft F-10: Claude did not answer in time. Retry, or use the demo draft.",
    "Drafted F-11 (live AI, claude-sonnet-5-5).",
  ].map((t) => neutralLegacyText(t));
  assert.deepEqual(legacy.filter(hasBannedTerm), []);
  assert.equal(legacy[0], "Drafted F-07, F-08 (drafted from the notes).");
  assert.equal(legacy[1], "Drafted F-07 (prepared demo draft).");
  assert.equal(legacy[4], "Drafted F-11 (drafted from the notes).");
});

test("POST /forms/analyse (demo): what the Studio stores and shows is neutral", async () => {
  for (const sample of SAMPLE_FORMS) {
    const bytes = await sample.loadFile();
    const res = await analyse(post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from(bytes).toString("base64"), fileName: sample.fileName, prefer: "demo" }), { params: {} });
    assert.equal(res.status, 200, sample.id);
    const body = FormsAnalyseResponseSchema.parse(await res.json());
    const { analysis } = body.form;
    assert.ok(analysis.model === undefined || analysis.model === NEUTRAL_ENGINE, `${sample.id}: ${analysis.model}`);
    const shown = [...analysis.warnings, ...body.outlineSummary.warnings, ...(body.trace ?? []).flatMap((t) => [t.label, t.detail ?? ""]), FORM_ANALYSIS_MODE_LABELS[analysis.mode]];
    assert.deepEqual(shown.filter(hasBannedTerm), [], sample.id);
  }
  const live = await analyse(
    post("/api/reports/v1/forms/analyse", { fileBase64: Buffer.from(await SAMPLE_FORMS[0].loadFile()).toString("base64"), fileName: SAMPLE_FORMS[0].fileName, prefer: "live" }),
    { params: {} },
  );
  const problem = ProblemSchema.parse(await live.json());
  assert.equal(problem.code, "LIVE_AI_UNAVAILABLE");
  assert.ok(!hasBannedTerm(`${problem.title} ${problem.detail ?? ""}`), `${problem.title} ${problem.detail}`);
});

test("POST /drafts (demo) and the report it builds carry no model id; problems shown in the Studio are neutral", async () => {
  const entry = getSampleForm("harrow-pike-treating-physio");
  assert.ok(entry);
  const form = withAttestedConfirmation((await entry.loadForm?.())!, "Practice manager", "2026-10-01T09:00:00.000Z");
  const bundle = getDemoBundle("megan-hart");
  const facts = computeFacts(bundle, { asOf: "2026-10-06" });
  let report: Report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: facts, now: new Date("2026-10-06T10:00:00Z") });
  const [keys] = planDraftGroups(report, formToTemplate(form));
  const res = await drafts(
    post("/api/reports/v1/drafts", { templateId: formTemplateId(form.id), bundle, instructingParty: bundle.referral, sectionKeys: keys, prefer: "demo", form }),
    { params: {} },
  );
  assert.equal(res.status, 200);
  const draft = DraftsResponseSchema.parse(await res.json());
  assert.equal(draft.generation.mode, "demo_recorded");
  assert.equal(draft.generation.model, NEUTRAL_ENGINE);
  report = applyDraftResult(report, draft, { now: new Date("2026-10-06T10:01:00Z") });
  const exported = JSON.stringify(buildCaseExport(report, new Date("2026-10-06T10:02:00Z")));
  assert.ok(!/claude|anthropic|opus|sonnet|haiku/i.test(exported), "the case export names no vendor or model");
  assert.ok(report.sections.some((s) => s.paragraphs.some((p) => p.origin === "ai")), "the fixture has drafted paragraphs");
  assert.ok(!hasBannedTerm(exported), "the case export has no banned term");
  assert.ok(!/"(?:ai|model|prompt\w*|stopReason)"/i.test(exported), "no technology words as keys or values (\"ai\", model, promptVersion, stopReason)");
  assert.ok(report.sections.some((s) => s.kind === "ai_narrative"), "the fixture has narrative sections");
  assert.ok(!/"ai_\w*"|"\w*_ai"/i.test(exported), "no internal ai_* values such as the section kind \"ai_narrative\"");
  assert.deepEqual(report.activity.map((a) => a.detail).filter(hasBannedTerm), []);

  const live = await drafts(
    post("/api/reports/v1/drafts", { templateId: formTemplateId(form.id), bundle, instructingParty: bundle.referral, sectionKeys: keys, prefer: "live", form }),
    { params: {} },
  );
  const problem = ProblemSchema.parse(await live.json());
  assert.ok(!hasBannedTerm(`${problem.title} ${problem.detail ?? ""}`), `${problem.title} ${problem.detail}`);
});

test("the case export rewrites a report stored by an earlier build (unsigned)", () => {
  const bundle = getDemoBundle("megan-hart");
  const legacyGen: GenerationMeta = { mode: "live", sectionKeys: ["F-07"], at: "2026-10-05T10:00:00.000Z", model: "claude-opus-5-5", promptVersion: "forms-4" };
  const entryForm = SAMPLE_FORMS[0];
  assert.ok(entryForm);
  const report = {
    id: "rpt_legacy",
    sections: [],
    gaps: [],
    generation: [legacyGen],
    activity: [{ at: "2026-10-05T10:00:00.000Z", actor: "System", action: "drafted", detail: "Drafted F-07 (live AI, claude-opus-5-5)." }],
    bundleSnapshot: bundle,
  } as unknown as Report;
  const exported = buildCaseExport(report).report;
  assert.equal(exported.generation[0].engine, NEUTRAL_ENGINE);
  assert.equal(exported.generation[0].draftingVersion, "forms-4");
  assert.equal(exported.activity[0].detail, "Drafted F-07 (drafted from the notes).");
});

test("POST /ai/payload-preview: the panel's caption and lists are neutral", async () => {
  const bundle = getDemoBundle("megan-hart");
  const res = await payloadPreview(
    post("/api/reports/v1/ai/payload-preview", { templateId: "solicitor-rta-treating-physio", bundle, instructingParty: bundle.referral }),
    { params: {} },
  );
  assert.equal(res.status, 200);
  const body = AiPayloadPreviewResponseSchema.parse(await res.json());
  assert.equal(body.model, NEUTRAL_ENGINE);
  const shown = [...body.removed, ...body.withheld, body.systemSummary, ...body.blocks.map((b) => b.label), WORDING.payload.recordCaption("The record (minimised)", body.model, body.promptVersion)];
  assert.deepEqual(shown.filter(hasBannedTerm), []);
  const record = body.blocks.find((b) => b.label.startsWith("The record"));
  assert.ok(record && !hasBannedTerm(record.text));
});

test("GET /health (behind the Studio's mode badge) names the engine neutrally", async () => {
  const res = await health(new Request("http://127.0.0.1:9/api/reports/v1/health"), { params: {} });
  assert.equal(res.status, 200);
  const body = HealthResponseSchema.parse(await res.json());
  assert.equal(body.model, NEUTRAL_ENGINE);
  assert.ok(!hasBannedTerm(`${body.product} ${body.model}`));
});

test("the case export round-trips: import restores the stored report, so an approved report re-hashes to its receipt", async () => {
  const entry = getSampleForm("harrow-pike-treating-physio");
  assert.ok(entry);
  const form = withAttestedConfirmation((await entry.loadForm?.())!, "Practice manager", "2026-10-01T09:00:00.000Z");
  const bundle = getDemoBundle("megan-hart");
  const facts = computeFacts(bundle, { asOf: "2026-10-06" });
  let report: Report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: facts, now: new Date("2026-10-06T10:00:00Z") });
  const [keys] = planDraftGroups(report, formToTemplate(form));
  const res = await drafts(
    post("/api/reports/v1/drafts", { templateId: formTemplateId(form.id), bundle, instructingParty: bundle.referral, sectionKeys: keys, prefer: "demo", form }),
    { params: {} },
  );
  report = applyDraftResult(report, DraftsResponseSchema.parse(await res.json()), { now: new Date("2026-10-06T10:01:00Z") });
  // A live-style group with every technical field, and a drafted gap.
  report = {
    ...report,
    generation: [
      ...report.generation,
      { mode: "live", sectionKeys: ["F-99"], at: "2026-10-06T10:01:30.000Z", model: NEUTRAL_ENGINE, promptVersion: "forms-4", effort: "medium", durationMs: 14000, usage: { inputTokens: 10, outputTokens: 20 }, stopReason: "end_turn" },
    ],
    gaps: [...report.gaps, { id: "G-x", sectionKey: keys[0], issue: "Not recorded.", suggestedQuestion: "Ask.", relatedNoteIds: [], raisedBy: "ai" }],
  };
  report = ReportSchema.parse(report); // as getReport() reads it back from storage
  const before = await reportFingerprint(report);

  const file = JSON.stringify(buildCaseExport(report), null, 2);
  assert.ok(!hasBannedTerm(file));
  assert.ok(!/"(?:ai|model|promptVersion|stopReason|end_turn)"/.test(file), file.match(/"(?:ai|model|promptVersion|stopReason|end_turn)"/)?.[0]);
  const parsed = JSON.parse(file);
  assert.equal(parsed.formatVersion, 2);
  assert.ok(parsed.report.generation.every((g: Record<string, unknown>) => typeof g.draftingVersion === "string"));
  assert.equal(parsed.report.generation.at(-1).finish, "complete");
  assert.equal(parsed.report.gaps.at(-1).raisedBy, "draft");
  assert.ok(!file.includes("ai_narrative"), "the section kind is exported under its public name");
  assert.ok(parsed.report.sections.some((s: Record<string, unknown>) => s.kind === "narrative"));

  const imported = importCase(file);
  assert.ok(imported.ok, imported.ok ? "" : imported.error);
  assert.deepEqual(imported.report.sections, report.sections);
  assert.deepEqual(imported.report.gaps, report.gaps);
  assert.deepEqual(imported.report.generation, report.generation);
  assert.equal(await reportFingerprint(imported.report), before, "the content fingerprint survives export and import");
});

test("a version 1 case file (stored report as is) still imports", async () => {
  const bundle = getDemoBundle("megan-hart");
  const entry = getSampleForm("harrow-pike-treating-physio");
  assert.ok(entry);
  const form = withAttestedConfirmation((await entry.loadForm?.())!, "Practice manager", "2026-10-01T09:00:00.000Z");
  const report = ReportSchema.parse(
    createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-06" }), now: new Date("2026-10-06T10:00:00Z") }),
  );
  const v1 = { format: "appstackx-reports.case", formatVersion: 1, exportedAt: "2026-10-06T10:00:00.000Z", product: { name: "x", version: "1" }, report };
  const imported = importCase(JSON.stringify(v1));
  assert.ok(imported.ok);
  assert.equal(await reportFingerprint(imported.report), await reportFingerprint(report));
  assert.equal(importCase(JSON.stringify({ ...v1, formatVersion: 3 })).ok, false);
});
