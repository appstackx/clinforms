/**
 * Records REAL Claude analyses of the bundled fictional sample forms and freezes them into
 * src/modules/medreport/ai/recorded/forms/<sampleId>.json, stamped "demo_recorded" with the date, the
 * serving model, the effort and the prompt version. POST /forms/analyse returns them in demo mode when
 * the uploaded file's SHA-256 matches (badged "Recorded Claude analysis"). Rewrites the registry
 * ai/recorded/forms/index.ts. Exercises the live path end to end: forms-engine outline → chunked
 * parallel Claude calls → post-validation.
 *
 *   node --env-file=.env.local --import ./scripts/medreport/test-setup.mjs --import tsx \
 *     scripts/medreport/record-form-analyses.ts [--samples=harrow-pike-treating-physio,…] [--effort=low|medium|high] \
 *     [--no-write] [--review=<file.md>]
 *
 * For every sample with a hand-made map (the forms engine's `loadForm`), prints the differences
 * between Claude's map and the hand map: questions only one of them found, and answer type / fill
 * source / options / required differences for questions that use the same answer space. Prints
 * timings and token usage. Never prints the API key. Form text goes only to the --review file.
 * The model is the app's own (config.server.ts aiModel(), default "claude-sonnet-5-5") and the effort
 * defaults to the live default (form-analysis.ts DEFAULT_ANALYSIS_EFFORT).
 *
 * Owner: ai agent.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyseFormFile, type AnalyseFormFileResult } from "@/modules/medreport/ai/analyse-form";
import { DraftGenerationError } from "@/modules/medreport/ai/types";
import { RECORDED_FORM_ANALYSIS_FORMAT, type RecordedFormAnalysis } from "@/modules/medreport/ai/recorded-forms";
import { DEFAULT_ANALYSIS_EFFORT, FORM_ANALYSIS_PROMPT_VERSION } from "@/modules/medreport/ai/form-analysis";
import type { AiEffort, FormDefinition, FormField } from "@/modules/medreport/core/types";
import { formAnchorKey } from "@/modules/medreport/core/forms";
import { sha256Hex } from "@/modules/medreport/forms/file";
import { SAMPLE_FORMS, type SampleFormEntry } from "@/modules/medreport/forms/samples/registry";

const OUT_DIR = path.join(process.cwd(), "src/modules/medreport/ai/recorded/forms");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

/** Where a field writes its answer, comparable across two maps of the same file. */
function anchorKey(f: FormField): string {
  return formAnchorKey(f.anchor);
}

function sourceText(f: FormField): string {
  const s = f.fillSource;
  switch (s.kind) {
    case "registration":
      return `registration ${s.path}`;
    case "computed_fact":
      return `computed ${s.factId}${s.format ? `/${s.format}` : ""}`;
    case "signoff":
      return `signoff ${s.part}`;
    default:
      return s.kind;
  }
}

/** Plain-text differences between Claude's map and the hand map. */
function diffMaps(live: FormDefinition, hand: FormDefinition): string[] {
  const out: string[] = [];
  const handBy = new Map<string, FormField[]>();
  for (const f of hand.fields) handBy.set(anchorKey(f), [...(handBy.get(anchorKey(f)) ?? []), f]);
  const used = new Set<FormField>();
  for (const f of live.fields) {
    const candidates = (handBy.get(anchorKey(f)) ?? []).filter((h) => !used.has(h));
    const h = candidates[0];
    if (!h) {
      out.push(`+ only Claude: ${f.id} "${f.label}" (${f.answerType}, ${sourceText(f)}) at ${anchorKey(f)}`);
      continue;
    }
    used.add(h);
    const d: string[] = [];
    if (f.answerType !== h.answerType) d.push(`answer type ${f.answerType} vs hand ${h.answerType}`);
    if (sourceText(f) !== sourceText(h)) d.push(`source ${sourceText(f)} vs hand ${sourceText(h)}`);
    if (JSON.stringify(f.options ?? []) !== JSON.stringify(h.options ?? [])) d.push(`options ${JSON.stringify(f.options ?? [])} vs hand ${JSON.stringify(h.options ?? [])}`);
    if (f.required !== h.required) d.push(`required ${f.required} vs hand ${h.required}`);
    if (d.length) out.push(`~ ${f.id}/${h.id} "${h.label}": ${d.join("; ")}`);
  }
  for (const h of hand.fields) if (!used.has(h)) out.push(`- only hand map: ${h.id} "${h.label}" (${h.answerType}, ${sourceText(h)}) at ${anchorKey(h)}`);
  return out;
}

function reviewMarkdown(sample: SampleFormEntry, result: AnalyseFormFileResult, diffs: string[]): string {
  const f = result.form;
  const lines = [
    `# ${sample.id} – ${f.title}`,
    "",
    `referrer: ${f.referrer.name} (${f.referrer.type}); version ${f.versionLabel ?? "-"}; ${f.fields.length} fields; mode ${f.analysis.mode}; ${f.analysis.durationMs} ms; usage ${JSON.stringify(f.analysis.usage)}`,
    "",
    "| ID | Label | Section | Type | Source | Anchor | Conf | Note |",
    "|---|---|---|---|---|---|---|---|",
    ...f.fields.map((x) => `| ${x.id} | ${x.label} | ${x.section ?? ""} | ${x.answerType}${x.options ? ` ${JSON.stringify(x.options)}` : ""} | ${sourceText(x)} | ${anchorKey(x)} | ${x.confidence} | ${x.note ?? ""} |`),
    "",
    "Warnings:",
    ...f.analysis.warnings.map((w) => `- ${w}`),
    "",
    "Trace:",
    ...(result.trace ?? []).map((t) => `- ${t.label}: ${t.status}, ${t.ms} ms – ${t.detail ?? ""}`),
    "",
    "Differences from the hand map:",
    ...(diffs.length ? diffs.map((d) => `- ${d}`) : ["- none"]),
  ];
  return lines.join("\n");
}

function writeRegistry(): void {
  const files = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const ident = (f: string) =>
    f
      .replace(/\.json$/, "")
      .replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""))
      .replace(/^[^A-Za-z]/, "r");
  const lines = [
    'import "server-only";',
    "",
    "/**",
    " * Registry of recorded form analyses (real Claude output for the bundled sample forms), statically",
    " * imported so the serverless bundle always contains them. Keys: sample ID. Regenerated by",
    " * scripts/medreport/record-form-analyses.ts from the .json files in this folder.",
    " *",
    " * Owner: ai agent.",
    " */",
    ...files.map((f) => `import ${ident(f)} from "./${f}";`),
    "",
    "export const RECORDED_FORM_ANALYSIS_SOURCES: Record<string, unknown> = {",
    ...files.map((f) => `  "${f.replace(/\.json$/, "")}": ${ident(f)},`),
    "};",
    "",
  ];
  writeFileSync(path.join(OUT_DIR, "index.ts"), lines.join("\n"));
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY is not set. Run with: node --env-file=.env.local …");
    process.exit(1);
  }
  const effort = (arg("effort") ?? DEFAULT_ANALYSIS_EFFORT) as AiEffort;
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`Unknown effort "${effort}"`);
  const wanted = arg("samples")?.split(",").filter(Boolean);
  const samples = SAMPLE_FORMS.filter((s) => !wanted || wanted.includes(s.id));
  if (samples.length === 0) throw new Error(`No sample forms match ${wanted?.join(", ") ?? "(none bundled)"}.`);
  const write = arg("no-write") === undefined;
  const reviewPath = arg("review");

  const review: string[] = [];
  let failed = false;
  // Samples run one after another; each analysis runs its chunks in parallel.
  for (const sample of samples) {
    const bytes = await sample.loadFile();
    const file = { bytes, mimeType: sample.mimeType, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength };
    const started = Date.now();
    let result: AnalyseFormFileResult;
    try {
      result = await analyseFormFile({ file, fileName: sample.fileName, referrer: sample.referrer, title: sample.title, mode: "live", effort });
    } catch (err) {
      failed = true;
      console.error(`${sample.id.padEnd(30)} ERROR ${err instanceof DraftGenerationError ? `${err.code}: ${err.message}` : err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      continue;
    }
    const f = result.form;
    if (f.analysis.mode !== "live") {
      failed = true;
      console.error(`${sample.id.padEnd(30)} Claude did not complete the analysis (${f.analysis.mode}); not written. ${f.analysis.warnings.join(" ")}`);
      continue;
    }
    const u = f.analysis.usage;
    console.log(
      [
        sample.id.padEnd(30),
        effort.padEnd(7),
        `${((Date.now() - started) / 1000).toFixed(1)}s wall`.padEnd(12),
        `chunks ${result.live?.chunks} (${(result.live?.chunkMs ?? []).map((ms) => (ms / 1000).toFixed(1)).join("/")}s)`.padEnd(26),
        `in ${u?.inputTokens} out ${u?.outputTokens} cacheR ${u?.cacheReadInputTokens ?? 0} cacheW ${u?.cacheCreationInputTokens ?? 0}`.padEnd(48),
        `${f.analysis.model}`.padEnd(16),
        `fields ${f.fields.length} dropped ${result.dropped} repaired ${result.repaired}`,
      ].join(" "),
    );

    const hand = await sample.loadForm?.();
    const diffs = hand && hand.file.sha256 === file.sha256 && hand.analysis.mode !== "demo_recorded" ? diffMaps(f, hand) : [];
    if (hand && hand.analysis.mode !== "demo_recorded") {
      console.log(diffs.length ? diffs.map((d) => `    ${d}`).join("\n") : "    no differences from the hand map");
    }
    review.push(reviewMarkdown(sample, result, diffs));

    if (!write) continue;
    const record: RecordedFormAnalysis = {
      format: RECORDED_FORM_ANALYSIS_FORMAT,
      formatVersion: 1,
      sampleId: sample.id,
      fileSha256: file.sha256,
      fileName: sample.fileName,
      mode: "demo_recorded",
      recordedAt: new Date().toISOString(),
      model: f.analysis.model,
      promptVersion: FORM_ANALYSIS_PROMPT_VERSION,
      effort,
      ...(f.analysis.durationMs !== undefined && { durationMs: f.analysis.durationMs }),
      ...(result.live && { chunks: result.live.chunks }),
      ...(u && { usage: u }),
      form: { ...f, sampleId: sample.id },
      outlineSummary: result.outlineSummary,
      note: "Real Claude analysis of a bundled fictional sample form, recorded by scripts/medreport/record-form-analyses.ts and post-validated against the parsed document.",
    };
    mkdirSync(OUT_DIR, { recursive: true });
    const target = path.join(OUT_DIR, `${sample.id}.json`);
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`    wrote ${path.relative(process.cwd(), target)}`);
  }
  if (write) writeRegistry();
  if (reviewPath) {
    writeFileSync(reviewPath, review.join("\n\n"));
    console.log(`review written to ${reviewPath}`);
  }
  if (failed) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
