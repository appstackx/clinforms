import "server-only";

/**
 * Types shared by the drafting entry point (generate.ts) and its two back ends (draft-live.ts,
 * draft-demo.ts). Kept separate so the back ends do not import generate.ts (no import cycle);
 * generate.ts re-exports everything here.
 *
 * Owner: ai agent.
 */
import type {
  Clinician,
  AiEffort,
  ComputedFact,
  DraftGapOutput,
  DraftSectionOutput,
  EpisodeBundle,
  FormDefinition,
  GenerationMeta,
  InstructingParty,
  ReportTemplate,
} from "../core/types";

/** A drafted section as the model returns it; form drafts add the structured `answer` string. */
export type DraftSectionOutputWithAnswer = DraftSectionOutput & { answer?: string };

/** Raw drafting output (DraftGroupOutput, or FormDraftGroupOutput for a referrer's form). */
export interface DraftOutput {
  sections: DraftSectionOutputWithAnswer[];
  gaps: DraftGapOutput[];
}

export interface GenerateDraftInput {
  template: ReportTemplate;
  /** UNSCOPED bundle. generateDraftGroup applies the template scope and data minimisation itself. */
  bundle: EpisodeBundle;
  instructingParty: InstructingParty;
  /** 1–2 draftable section keys of `template` (1–4 form field IDs when `form` is set). */
  sectionKeys: string[];
  /**
   * Referrer forms: the form map being completed (`template` is then formToTemplate(form)). Switches
   * to the form prompt and the FormDraftGroupOutput schema (structured answers).
   */
  form?: FormDefinition;
  /** Referrer forms: the clinician who will sign (their own notes are written in the first person). */
  author?: Clinician;
  computedFacts: ComputedFact[];
  /** "live" only after the handler has checked the passcode and rate cap. */
  mode: "live" | "demo";
  effort?: AiEffort;
  signal?: AbortSignal;
}

export interface GenerateDraftResult {
  output: DraftOutput;
  meta: GenerationMeta;
}

export type DraftErrorCode =
  | "AI_REFUSAL"
  | "AI_MAX_TOKENS"
  | "AI_TIMEOUT"
  | "AI_ERROR"
  | "NO_DEMO_DRAFT"
  | "LIVE_AI_UNAVAILABLE";

/** Thrown by generateDraftGroup; the handler maps it to problem+json (UI offers Retry / Use demo draft). */
export class DraftGenerationError extends Error {
  readonly code: DraftErrorCode;
  readonly retryable: boolean;

  constructor(code: DraftErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "DraftGenerationError";
    this.code = code;
    this.retryable = retryable;
  }
}
