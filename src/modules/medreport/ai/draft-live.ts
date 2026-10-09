import "server-only";

/**
 * Live drafting with Claude. The call itself (model, fallbacks, effort, structured output, caching,
 * timeouts, stop reasons) is ai/claude.ts callClaudeStructured(); this file builds the prompt and
 * picks the output schema:
 * - built-in template: ai/prompts.ts + DraftGroupOutputSchema;
 * - referrer's form (`input.form`): ai/form-prompts.ts + FormDraftGroupOutputSchema (adds the
 *   structured `answer` per field).
 *
 * Content blocks: [template or form block] → [episode block, cache_control] → [final instruction].
 *
 * Owner: ai agent.
 */
import { z } from "zod";
import { DraftGroupOutputSchema, FormDraftGroupOutputSchema, ParagraphBasisSchema } from "../core/schemas";
import type { AiEffort, GenerationMeta } from "../core/types";
import { callClaudeStructured, type ClaudeClient } from "./claude";
import { FORM_DRAFT_PROMPT_VERSION, buildFormPromptParts } from "./form-prompts";
import { PROMPT_VERSION, buildPromptParts } from "./prompts";
import type { DraftOutput, GenerateDraftInput, GenerateDraftResult } from "./types";

export { LIVE_MAX_TOKENS, LIVE_TIMEOUT_MS, FALLBACK_BETA, mapSdkError } from "./claude";

/**
 * Effort used when the request does not override it. Measured on claude-sonnet-5-5 (09/10/2026, the
 * five demo form pairs, README → "Model and effort"): "low" once put a date the cited note does not
 * hold into an answer (blocking FIGURE_NOT_IN_SOURCE) and once wrote "No clinician recorded an
 * opinion…" into an answer box instead of leaving it blank with a gap; "medium" passed every check, at
 * the same time and within a few per cent of the cost. Sonnet 5.5's levels are recalibrated (its API
 * default is "high"), so the effort is always sent explicitly.
 */
export const DEFAULT_LIVE_EFFORT: AiEffort = "medium";

/** @deprecated Use ClaudeClient from ./claude. */
export type DraftClient = ClaudeClient;

const LenientParagraph = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()).catch([]),
  basis: ParagraphBasisSchema.catch("record"),
});
const LenientGap = z.object({
  sectionKey: z.string(),
  issue: z.string(),
  suggestedQuestion: z.string().catch(""),
  relatedNoteIds: z.array(z.string()).catch([]),
});

/** Lenient fallback schema: the same shape, without the min-1 citation rule (validators flag it). */
const LenientDraftOutputSchema: z.ZodType<DraftOutput> = z.object({
  sections: z.array(
    z.object({
      sectionKey: z.string(),
      answer: z.string().optional(),
      paragraphs: z.array(LenientParagraph),
    }),
  ),
  gaps: z.array(LenientGap).catch([]),
});

export async function draftLive(input: GenerateDraftInput, deps: { client?: ClaudeClient } = {}): Promise<GenerateDraftResult> {
  const effort: AiEffort = input.effort ?? DEFAULT_LIVE_EFFORT;
  const form = input.form;
  const parts = form ? buildFormPromptParts({ ...input, form }) : buildPromptParts(input);
  const schema: z.ZodType<DraftOutput> = form ? FormDraftGroupOutputSchema : DraftGroupOutputSchema;

  const result = await callClaudeStructured<DraftOutput>({
    system: parts.system,
    content: [
      { type: "text", text: parts.template },
      { type: "text", text: parts.episode, cache_control: { type: "ephemeral" } },
      { type: "text", text: parts.final },
    ],
    schema,
    lenient: LenientDraftOutputSchema,
    effort,
    wording: form
      ? { noun: "drafting", alternative: "use the demo answers and complete the field yourself" }
      : { noun: "drafting", alternative: "use the demo draft" },
    signal: input.signal,
    client: deps.client,
  });

  const meta: GenerationMeta = {
    mode: "live",
    sectionKeys: input.sectionKeys.slice(),
    at: result.startedAt,
    model: result.model,
    promptVersion: form ? FORM_DRAFT_PROMPT_VERSION : PROMPT_VERSION,
    effort,
    durationMs: result.durationMs,
    usage: result.usage,
    stopReason: result.stopReason,
  };
  return { output: result.data, meta };
}
