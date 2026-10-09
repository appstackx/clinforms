import "server-only";

/**
 * Drafting entry point used by POST /drafts and scripts/medreport/record-demo-drafts.ts. Chooses live
 * Claude or a demo draft and returns the raw structured output plus provenance. The caller then runs
 * assembleDraft() (ai/assemble.ts): paragraph/gap IDs, re-identification, dropped IDs, validators →
 * DraftsResponse.
 *
 * The handler decides the mode (resolveAiMode(), the x-medreport-passcode check and the per-instance
 * rate cap in auth/passcode.ts) before calling this; `mode: "live"` here means "already authorised".
 *
 * Owner: ai agent. Signatures are final.
 */
import { isDraftableKind } from "../core/report-factory";
import { draftDemo } from "./draft-demo";
import { draftLive } from "./draft-live";
import { DraftGenerationError, type GenerateDraftInput, type GenerateDraftResult } from "./types";

export { DraftGenerationError } from "./types";
export type { DraftErrorCode, GenerateDraftInput, GenerateDraftResult } from "./types";

/** Throws DraftGenerationError("AI_ERROR") unless every key is a draftable section of the template. */
export function assertDraftableKeys(input: Pick<GenerateDraftInput, "template" | "sectionKeys">): void {
  if (input.sectionKeys.length === 0) throw new DraftGenerationError("AI_ERROR", "No sections to draft.");
  for (const key of input.sectionKeys) {
    const spec = input.template.sections.find((s) => s.key === key);
    if (!spec || !isDraftableKind(spec.kind)) {
      throw new DraftGenerationError("AI_ERROR", `"${key}" is not a section that can be drafted in this template.`);
    }
  }
}

/**
 * Draft one group of sections.
 * - live: client.beta.messages.parse with the configured model (aiModel(), default "claude-sonnet-5-5"),
 *   betas ["server-side-fallback-2026-07-01"],
 *   fallbacks "default", output_config {effort, format: betaZodOutputFormat(DraftGroupOutputSchema)},
 *   max_tokens 16000, cache_control on the frozen system prompt and the episode block, no thinking
 *   param, no prefill, no forced tool_choice; stop_reason "refusal"/"max_tokens" → DraftGenerationError.
 * - demo: ai/demo-drafts/{patientId}__{templateId}.json (forms: {patientId}__form-{sampleId}.json bound
 *   to the form file's SHA-256) filtered to `sectionKeys`; meta.mode "demo_prewritten" or
 *   "demo_recorded" (with recordedAt/model/promptVersion from the file). No delay.
 * - referrer forms (`input.form`): the form prompt (ai/form-prompts.ts) and FormDraftGroupOutputSchema
 *   (a structured `answer` per field); assembleDraft() parses it into `section.answer`.
 */
export async function generateDraftGroup(input: GenerateDraftInput): Promise<GenerateDraftResult> {
  assertDraftableKeys(input);
  return input.mode === "live" ? draftLive(input) : draftDemo(input);
}
