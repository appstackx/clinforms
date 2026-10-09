/**
 * Records REAL Claude output for the demo cases and freezes it into
 * src/modules/medreport/ai/demo-drafts/*.json, stamped "demo_recorded" with the date, the serving
 * model and the prompt version (badged "Recorded Claude output" in the Studio). Also rewrites the
 * registry ai/demo-drafts/index.ts. This exercises the live path end to end: scope → minimised prompt →
 * client.beta.messages.parse → assembly → validators.
 *
 *   node --env-file=.env.local --import ./scripts/medreport/test-setup.mjs --import tsx \
 *     scripts/medreport/record-demo-drafts.ts [--effort=low|medium|high] [--cases=megan-hart,daniel-brooks] \
 *     [--only=templates|forms] [--samples=harrow-pike-treating-physio,…] [--no-write] [--review=<file.md>] [--sequential]
 *
 * Built-in templates (fallback when a referrer sends no form):
 *   case A Megan Hart → solicitor template; case B Daniel Brooks → employer template.
 *   File: {patientId}__{templateId}.json.
 * Referrer forms (Revision 2) – the bundled sample forms with their confirmed maps:
 *   Megan Hart → harrow-pike-treating-physio (form a, MLC Word form), northfield-rehab-progress (form b,
 *   insurer fillable PDF), and meridian-discharge-report when a map for it exists (recorded analysis);
 *   Daniel Brooks → kingsway-rtw-assessment (form c, case manager Word form) and northfield-rehab-progress
 *   (form b, insurer fillable PDF).
 *   File: {patientId}__form-{sampleId}.json, bound to the form file's SHA-256 (a draft is only used for
 *   that exact file, because its field IDs belong to it). Re-record after the sample files change.
 *
 * The model is the app's own (config.server.ts aiModel(): MEDREPORT_MODEL, default "claude-sonnet-5-5")
 * and the effort defaults to the live default (draft-live.ts DEFAULT_LIVE_EFFORT), so recordings match
 * what live drafting does. Prints timings, token usage and the validator summary per group. Never
 * prints the API key.
 * Answer text goes only to the --review file (fictional data).
 *
 * Owner: ai agent.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assembleDraft } from "@/modules/medreport/ai/assemble";
import { bundleNotesFingerprint } from "@/modules/medreport/ai/bundle-fingerprint";
import { DEMO_DRAFT_FORMAT, demoDraftKey, demoFormDraftKey, groupKey, type DemoDraftFile } from "@/modules/medreport/ai/demo-format";
import { DEFAULT_LIVE_EFFORT } from "@/modules/medreport/ai/draft-live";
import { FORM_DRAFT_PROMPT_VERSION } from "@/modules/medreport/ai/form-prompts";
import { DraftGenerationError, generateDraftGroup, type GenerateDraftResult } from "@/modules/medreport/ai/generate";
import { PROMPT_VERSION } from "@/modules/medreport/ai/prompts";
import { getRecordedFormMap } from "@/modules/medreport/ai/recorded-forms";
import type { DraftsResponse } from "@/modules/medreport/api/contract";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { answerToText, formAnchorKeys, formToTemplate } from "@/modules/medreport/core/forms";
import { createFormReport, createReport, planDraftGroups } from "@/modules/medreport/core/report-factory";
import type { AiEffort, EpisodeBundle, FormDefinition, ReportTemplate } from "@/modules/medreport/core/types";
import { sha256Hex } from "@/modules/medreport/forms/file";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "@/modules/medreport/templates/registry";
import { getDemoBundle } from "./dev-bundles";

const DEMO_DRAFTS_DIR = path.join(process.cwd(), "src/modules/medreport/ai/demo-drafts");

const TEMPLATE_CASES: Record<string, { template: ReportTemplate }> = {
  "megan-hart": { template: SOLICITOR_RTA_TEMPLATE },
  "daniel-brooks": { template: EMPLOYER_FFW_TEMPLATE },
};

/** Referrer forms per case: sample IDs; `optional` ones are skipped quietly when they have no map yet. */
const FORM_CASES: Array<{ slug: string; sampleId: string; optional?: boolean }> = [
  { slug: "megan-hart", sampleId: "harrow-pike-treating-physio" },
  { slug: "megan-hart", sampleId: "northfield-rehab-progress" },
  { slug: "megan-hart", sampleId: "meridian-discharge-report", optional: true },
  { slug: "daniel-brooks", sampleId: "kingsway-rtw-assessment" },
  { slug: "daniel-brooks", sampleId: "northfield-rehab-progress" },
];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

interface GroupRun {
  keys: string[];
  result?: GenerateDraftResult;
  assembled?: DraftsResponse;
  error?: string;
  wallMs: number;
}

interface Job {
  slug: string;
  label: string;
  bundle: EpisodeBundle;
  template: ReportTemplate;
  form?: FormDefinition;
}

async function runJob(job: Job, effort: AiEffort, sequential: boolean): Promise<GroupRun[]> {
  const { bundle, template, form } = job;
  const computedFacts = computeFacts(bundle);
  const report = form
    ? createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts })
    : createReport({ template, bundle, instructingParty: bundle.referral, computedFacts });
  const groups = planDraftGroups(report, template);

  const runGroup = async (keys: string[]): Promise<GroupRun> => {
    const started = Date.now();
    try {
      const result = await generateDraftGroup({ template, bundle, instructingParty: bundle.referral, sectionKeys: keys, computedFacts, mode: "live", effort, form });
      const assembled = assembleDraft({ template, bundle, instructingParty: bundle.referral, sectionKeys: keys, computedFacts, output: result.output, meta: result.meta, form });
      return { keys, result, assembled, wallMs: Date.now() - started };
    } catch (err) {
      const msg = err instanceof DraftGenerationError ? `${err.code}: ${err.message}` : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { keys, error: msg, wallMs: Date.now() - started };
    }
  };

  const runs: GroupRun[] = [];
  if (sequential) {
    for (const g of groups) runs.push(await runGroup(g));
  } else {
    runs.push(...(await Promise.all(groups.map(runGroup))));
  }
  return runs;
}

function summarise(label: string, runs: GroupRun[]): string[] {
  return runs.map((r) => {
    if (r.error) return `${label.padEnd(44)} ${groupKey(r.keys).padEnd(42)} ERROR ${r.error}`;
    const m = r.result!.meta;
    const u = m.usage!;
    const a = r.assembled!;
    const blocking = a.flags.filter((f) => f.severity === "blocking");
    const codes = Array.from(new Set(blocking.map((f) => f.code))).join(",") || "-";
    const warnings = a.flags.filter((f) => f.severity === "warning").length;
    const paras = a.sections.reduce((n, s) => n + s.paragraphs.length, 0);
    return [
      label.padEnd(44),
      groupKey(r.keys).padEnd(42),
      `${m.effort}`.padEnd(7),
      `${(m.durationMs! / 1000).toFixed(1)}s`.padStart(6),
      `in ${u.inputTokens}`.padEnd(9),
      `out ${u.outputTokens}`.padEnd(10),
      `cacheR ${u.cacheReadInputTokens ?? 0}`.padEnd(13),
      `cacheW ${u.cacheCreationInputTokens ?? 0}`.padEnd(13),
      `${m.stopReason}`.padEnd(9),
      `${m.model}`.padEnd(16),
      `paras ${paras}`.padEnd(9),
      `gaps ${a.gaps.length}`.padEnd(7),
      `blocking ${blocking.length} (${codes})`,
      `warn ${warnings}`,
    ].join(" ");
  });
}

function reviewMarkdown(job: Job, runs: GroupRun[]): string {
  const out: string[] = [`# ${job.label}`, ""];
  for (const r of runs) {
    out.push(`## ${groupKey(r.keys)}`);
    if (r.error) {
      out.push(`ERROR: ${r.error}`, "");
      continue;
    }
    const m = r.result!.meta;
    out.push(`model ${m.model}, effort ${m.effort}, ${m.durationMs} ms, usage ${JSON.stringify(m.usage)}, stop ${m.stopReason}`, "");
    for (const s of r.assembled!.sections) {
      const answer = s.answer && s.answer.kind !== "text" ? ` → answer: ${answerToText(s) || "(blank)"}` : "";
      out.push(`### ${s.key} ${s.title} [${s.status}]${answer}`);
      for (const p of s.paragraphs) out.push(`- (${p.basis}; ${p.sourceIds.join(", ")}) ${p.text}`);
      out.push("");
    }
    for (const g of r.assembled!.gaps) out.push(`- GAP [${g.sectionKey}] ${g.issue} → ${g.suggestedQuestion} (${g.relatedNoteIds.join(", ")})`);
    for (const f of r.assembled!.flags) out.push(`- FLAG ${f.severity} ${f.code} [${f.sectionKey}/${f.paragraphId ?? f.gapId ?? "-"}] ${f.evidence ?? ""} – ${f.message}`);
    out.push("");
  }
  return out.join("\n");
}

function writeRegistry(): void {
  const files = readdirSync(DEMO_DRAFTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const ident = (f: string) =>
    f
      .replace(/\.json$/, "")
      .replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""))
      .replace(/^[^A-Za-z]/, "d");
  const lines = [
    'import "server-only";',
    "",
    "/**",
    " * Registry of demo drafts, statically imported so the serverless bundle always contains them.",
    " * Keys: `${externalPatientId}__${templateId}` (built-in templates) and",
    " * `${externalPatientId}__form-${sampleId}` (referrer forms). Regenerated by",
    " * scripts/medreport/record-demo-drafts.ts from the .json files in this folder.",
    " *",
    " * Owner: ai agent.",
    " */",
    ...files.map((f) => `import ${ident(f)} from "./${f}";`),
    "",
    "export const DEMO_DRAFT_SOURCES: Record<string, unknown> = {",
    ...files.map((f) => `  "${f.replace(/\.json$/, "")}": ${ident(f)},`),
    "};",
    "",
  ];
  writeFileSync(path.join(DEMO_DRAFTS_DIR, "index.ts"), lines.join("\n"));
}

/** The confirmed map of a bundled sample for its exact file, or a reason why there is none. */
async function sampleForm(sampleId: string): Promise<{ form: FormDefinition } | { skip: string }> {
  const sample = getSampleForm(sampleId);
  if (!sample) return { skip: `no bundled sample "${sampleId}"` };
  const sha = sha256Hex(await sample.loadFile());
  const form = (await sample.loadForm?.()) ?? getRecordedFormMap(sampleId);
  if (!form) return { skip: `sample "${sampleId}" has no form map yet (record its analysis first)` };
  if (form.file.sha256 !== sha) return { skip: `the map of "${sampleId}" belongs to a different file (SHA-256 mismatch)` };
  return { form: { ...form, sampleId, status: "confirmed" } };
}

function demoFile(job: Job, runs: GroupRun[], effort: AiEffort): DemoDraftFile {
  const first = runs[0].result!.meta;
  return {
    format: DEMO_DRAFT_FORMAT,
    formatVersion: 1,
    patientId: job.bundle.source.externalPatientId,
    bundleFingerprint: bundleNotesFingerprint(job.bundle),
    templateId: job.template.id,
    templateVersion: job.template.version,
    ...(job.form && {
      sampleId: job.form.sampleId,
      formSha256: job.form.file.sha256,
      fields: Object.fromEntries(
        Array.from(formAnchorKeys(job.form).entries()).map(([id, anchor]) => {
          const field = job.form!.fields.find((f) => f.id === id)!;
          return [id, { anchor, answerType: field.answerType, label: field.label }];
        }),
      ),
    }),
    mode: "demo_recorded",
    recordedAt: new Date().toISOString(),
    model: first.model,
    promptVersion: job.form ? FORM_DRAFT_PROMPT_VERSION : PROMPT_VERSION,
    effort,
    note: `Real Claude output recorded by scripts/medreport/record-demo-drafts.ts from the fictional simulated TM3 demo case${job.form ? ` on the sample form "${job.form.sampleId}"` : ""}. Raw model output: [CLAIMANT] is replaced with the patient's name when the draft is assembled.`,
    groups: Object.fromEntries(
      runs.map((r) => {
        const m = r.result!.meta;
        return [
          groupKey(r.keys),
          {
            sections: r.result!.output.sections,
            gaps: r.result!.output.gaps,
            recording: { model: m.model ?? "unknown", effort, durationMs: m.durationMs ?? 0, usage: m.usage!, stopReason: m.stopReason },
          },
        ];
      }),
    ),
  };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY is not set. Run with: node --env-file=.env.local …");
    process.exit(1);
  }
  const effort = (arg("effort") ?? DEFAULT_LIVE_EFFORT) as AiEffort;
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`Unknown effort "${effort}"`);
  const slugs = (arg("cases") ?? Object.keys(TEMPLATE_CASES).join(",")).split(",").filter(Boolean);
  const only = arg("only");
  const samples = arg("samples")?.split(",").filter(Boolean);
  const write = arg("no-write") === undefined;
  const sequential = arg("sequential") !== undefined;
  const reviewPath = arg("review");

  const jobs: Job[] = [];
  for (const slug of slugs) {
    if (!TEMPLATE_CASES[slug]) throw new Error(`Unknown case "${slug}"`);
    if (only !== "forms") {
      jobs.push({ slug, label: `${slug} · ${TEMPLATE_CASES[slug].template.id}`, bundle: getDemoBundle(slug), template: TEMPLATE_CASES[slug].template });
    }
    if (only === "templates") continue;
    for (const fc of FORM_CASES.filter((c) => c.slug === slug && (!samples || samples.includes(c.sampleId)))) {
      const found = await sampleForm(fc.sampleId);
      if ("skip" in found) {
        if (!fc.optional || samples) console.error(`${slug} · form ${fc.sampleId}: skipped – ${found.skip}`);
        continue;
      }
      jobs.push({ slug, label: `${slug} · form ${fc.sampleId}`, bundle: getDemoBundle(slug), template: formToTemplate(found.form), form: found.form });
    }
  }

  const review: string[] = [];
  let failed = false;
  for (const job of jobs) {
    const started = Date.now();
    const runs = await runJob(job, effort, sequential);
    console.log(summarise(job.label, runs).join("\n"));
    console.log(`${job.label.padEnd(44)} all groups done in ${((Date.now() - started) / 1000).toFixed(1)}s (wall)`);
    review.push(reviewMarkdown(job, runs));

    if (runs.length === 0 || runs.some((r) => r.error)) {
      failed = true;
      console.error(`${job.label}: not written (${runs.length === 0 ? "nothing to draft" : "a group failed"}).`);
      continue;
    }
    if (!write) continue;
    const file = demoFile(job, runs, effort);
    const key = job.form ? demoFormDraftKey(file.patientId, job.form) : demoDraftKey(file.patientId, file.templateId);
    mkdirSync(DEMO_DRAFTS_DIR, { recursive: true });
    const target = path.join(DEMO_DRAFTS_DIR, `${key}.json`);
    writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`${job.label}: wrote ${path.relative(process.cwd(), target)}`);
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
