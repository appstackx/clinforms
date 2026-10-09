import "server-only";

/**
 * The one place that calls Claude (@anthropic-ai/sdk 0.131.0). Used by live drafting (draft-live.ts)
 * and live form analysis (form-analysis.ts). Never import the SDK outside this folder or in client code.
 *
 * Every call:
 * - client.beta.messages.parse, model aiModel() from config.server.ts (default "claude-sonnet-5-5";
 *   MEDREPORT_MODEL may pick another allow-listed model), betas ["server-side-fallback-2026-07-01"]
 *   with fallbacks "default" (on Claude Sonnet 5.5 the server re-runs a "cyber" or "frontier_llm"
 *   decline on Claude Sonnet 5; other declines come back as stop_reason "refusal"; the serving model
 *   is recorded);
 * - output_config { effort (always explicit: the default differs by model – "high" on Claude Sonnet
 *   5.5, whose levels are recalibrated; "medium" on Claude Opus 5.5), format: betaZodOutputFormat(schema) };
 * - max_tokens 16000 (adaptive thinking is on by default and counts against it);
 * - no `thinking` parameter (Claude Sonnet 5.5 and Opus 5.5 reject {type: "disabled"}; lower effort
 *   instead), no temperature / top_p / top_k, no prefill, no forced tool_choice (400 on both), no API
 *   Citations (incompatible with structured output – our own sourceIds play that role);
 * - cache_control on the frozen system prompt (and wherever the caller marks a content block; the
 *   minimum cacheable prefix on Claude Sonnet 5.5 is 512 tokens);
 * - SDK timeout ~10 s below the route's maxDuration of 60 s, maxRetries 0.
 *
 * stop_reason "refusal" / "max_tokens" and SDK errors become DraftGenerationError with a problem code.
 * A response that does not match the strict schema is retried against a lenient one (same shape,
 * fewer rules) and flagged `lenient`, so the validators can flag what the strict schema would reject.
 *
 * Owner: ai agent.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { aiModel } from "../config.server";
import type { AiEffort, TokenUsage } from "../core/types";
import { WORDING } from "../core/wording";
import { DraftGenerationError } from "./types";

export const LIVE_MAX_TOKENS = 16_000;
/** SDK timeout: about 10 s below the routes' maxDuration (60 s on Vercel Hobby). */
export const LIVE_TIMEOUT_MS = 50_000;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

/** Minimal client surface we use (lets tests inject a fake). */
export interface ClaudeClient {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
}

export type ClaudeContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

let sharedClient: Anthropic | null = null;

/** The shared SDK client; LIVE_AI_UNAVAILABLE when no key is configured. */
export function getClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new DraftGenerationError("LIVE_AI_UNAVAILABLE", WORDING.server.sdk.notConfigured);
  if (!sharedClient) sharedClient = new Anthropic({ apiKey, timeout: LIVE_TIMEOUT_MS, maxRetries: 0 });
  return sharedClient;
}

/** What the call is for, used in user-facing error messages ("draft", "form analysis"). */
export interface CallWording {
  /** e.g. "draft" → "The draft was cut off…". */
  noun: string;
  /** e.g. "use the demo draft" → "Retry, or use the demo draft." */
  alternative: string;
}

/** Map an SDK error to a DraftGenerationError (never includes request content). */
export function mapSdkError(err: unknown, wording: CallWording = { noun: "draft", alternative: "use the demo draft" }): DraftGenerationError {
  if (err instanceof DraftGenerationError) return err;
  const alt = `Retry, or ${wording.alternative}.`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new DraftGenerationError("AI_TIMEOUT", WORDING.server.sdk.timeout(alt), true);
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    return new DraftGenerationError("AI_TIMEOUT", "The request was cancelled.", true);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new DraftGenerationError("LIVE_AI_UNAVAILABLE", WORDING.server.sdk.misconfigured);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new DraftGenerationError("AI_ERROR", WORDING.server.sdk.rateLimited(wording.alternative), true);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new DraftGenerationError("AI_ERROR", WORDING.server.sdk.badRequest(wording.noun), false);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new DraftGenerationError("AI_ERROR", WORDING.server.sdk.unreachable(alt), true);
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : 0;
    return new DraftGenerationError("AI_ERROR", WORDING.server.sdk.apiError(String(status || "unknown"), alt), status >= 500 || status === 0);
  }
  return new DraftGenerationError("AI_ERROR", `The ${wording.noun} failed unexpectedly. ${alt}`, true);
}

type ParseOutcome<T> = { ok: true; data: T; lenient: boolean } | { ok: false; reason: "schema" | "json" };

/**
 * betaZodOutputFormat(strict), wrapped so a parse failure is reported rather than thrown: the
 * stop_reason can then be checked first (a truncated or refused response is not JSON).
 */
function outputFormat<T>(strict: z.ZodType<T>, lenient?: z.ZodType<T>) {
  const format = betaZodOutputFormat(strict);
  return {
    ...format,
    parse: (content: string): ParseOutcome<T> => {
      try {
        return { ok: true, data: format.parse(content) as T, lenient: false };
      } catch {
        try {
          const raw: unknown = JSON.parse(content);
          if (!lenient) return { ok: false, reason: "schema" };
          const loose = lenient.safeParse(raw);
          return loose.success ? { ok: true, data: loose.data, lenient: true } : { ok: false, reason: "schema" };
        } catch {
          return { ok: false, reason: "json" };
        }
      }
    },
  };
}

export interface StructuredCallInput<T> {
  system: string;
  /** User-message content blocks in order (stable prefix first; mark cache breakpoints with cache_control). */
  content: ClaudeContentBlock[];
  schema: z.ZodType<T>;
  /** Same shape with fewer rules, tried when the strict parse fails. */
  lenient?: z.ZodType<T>;
  effort: AiEffort;
  wording: CallWording;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
  client?: ClaudeClient;
}

export interface StructuredCallResult<T> {
  data: T;
  lenient: boolean;
  /** Model that served the request (differs from the requested model after a server-side fallback). */
  model: string;
  startedAt: string;
  durationMs: number;
  usage: TokenUsage;
  stopReason?: string;
}

/** One structured-output call to Claude with the house rules above. */
export async function callClaudeStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>> {
  const client = input.client ?? getClaudeClient();
  const timeout = input.timeoutMs ?? LIVE_TIMEOUT_MS;
  const format = outputFormat(input.schema, input.lenient);
  const started = Date.now();

  let response;
  try {
    response = await client.beta.messages.parse(
      {
        model: aiModel(),
        max_tokens: input.maxTokens ?? LIVE_MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: input.content }],
        output_config: { effort: input.effort, format },
      },
      { timeout, maxRetries: 0, signal: input.signal },
    );
  } catch (err) {
    throw mapSdkError(err, input.wording);
  }
  const durationMs = Date.now() - started;
  const alt = `Retry, or ${input.wording.alternative}.`;

  if (response.stop_reason === "refusal") {
    throw new DraftGenerationError("AI_REFUSAL", WORDING.server.sdk.refusal(input.wording.noun, alt), true);
  }
  if (response.stop_reason === "max_tokens") {
    throw new DraftGenerationError("AI_MAX_TOKENS", `The ${input.wording.noun} was cut off before it was complete. ${alt}`, true);
  }
  if (response.stop_reason === "model_context_window_exceeded") {
    throw new DraftGenerationError("AI_ERROR", `This ${input.wording.noun} request is too large for one call.`, false);
  }
  const outcome = response.parsed_output as ParseOutcome<T> | null;
  if (!outcome || !outcome.ok) {
    throw new DraftGenerationError("AI_ERROR", WORDING.server.sdk.unreadable(alt), true);
  }

  const usage = response.usage;
  return {
    data: outcome.data,
    lenient: outcome.lenient,
    model: response.model,
    startedAt: new Date(started).toISOString(),
    durationMs,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      ...(usage.cache_read_input_tokens != null && { cacheReadInputTokens: usage.cache_read_input_tokens }),
      ...(usage.cache_creation_input_tokens != null && { cacheCreationInputTokens: usage.cache_creation_input_tokens }),
    },
    stopReason: response.stop_reason ?? undefined,
  };
}
