/**
 * Shared, per-run context for the validators: the scoped bundle, the text of every citable source,
 * figure indexes and normalised text per source (computed once per run), paragraph iteration and a
 * flag factory with stable IDs.
 *
 * Pure; browser and server.
 *
 * Owner: ai agent.
 */
import { applyScope } from "../scope";
import type { FlagSeverity, Paragraph, ReportFlag, ReportFlagCode, ReportSection, TemplateSection } from "../types";
import type { ValidatorInput } from "./index";
import { buildSourceTexts } from "./sources";
import { addToFigureIndex, emptyFigureIndex, normaliseForMatch, type FigureIndex } from "./text";

/** Origins whose text must be backed by citations and is checked for figures and opinion wording. */
export const CHECKED_ORIGINS: ReadonlyArray<Paragraph["origin"]> = ["ai", "edited"];

export interface ParagraphRef {
  section: ReportSection;
  sectionIndex: number;
  spec: TemplateSection | undefined;
  paragraph: Paragraph;
  paragraphIndex: number;
}

export interface CitedSources {
  /** Valid, de-duplicated citable IDs in the order given. */
  validIds: string[];
  /** IDs that are not citable sources of this report. */
  unknownIds: string[];
  /** Figures stated anywhere in the valid cited sources. */
  figures: FigureIndex;
  /** normaliseForMatch() of the valid cited sources joined. */
  normalisedText: string;
}

export interface ValidationContext {
  input: ValidatorInput;
  sourceTexts: Map<string, string>;
  paragraphs: ParagraphRef[];
  cited(paragraph: Paragraph): CitedSources;
}

const cache = new WeakMap<ValidatorInput, ValidationContext>();

export function getValidationContext(input: ValidatorInput): ValidationContext {
  const hit = cache.get(input);
  if (hit) return hit;

  const scoped = applyScope(input.bundle, input.template);
  const sourceTexts = buildSourceTexts(scoped, input.computedFacts ?? [], input.report.instructingParty);
  const figureCache = new Map<string, FigureIndex>();
  const normCache = new Map<string, string>();
  const figuresOf = (id: string): FigureIndex => {
    let idx = figureCache.get(id);
    if (!idx) {
      idx = addToFigureIndex(emptyFigureIndex(), sourceTexts.get(id) ?? "");
      figureCache.set(id, idx);
    }
    return idx;
  };
  const normOf = (id: string): string => {
    let n = normCache.get(id);
    if (n === undefined) {
      n = normaliseForMatch(sourceTexts.get(id) ?? "");
      normCache.set(id, n);
    }
    return n;
  };

  const specByKey = new Map(input.template.sections.map((s) => [s.key, s]));
  const paragraphs: ParagraphRef[] = [];
  (input.report.sections ?? []).forEach((section, sectionIndex) => {
    (section.paragraphs ?? []).forEach((paragraph, paragraphIndex) => {
      paragraphs.push({ section, sectionIndex, spec: specByKey.get(section.key), paragraph, paragraphIndex });
    });
  });

  const ctx: ValidationContext = {
    input,
    sourceTexts,
    paragraphs,
    cited(paragraph) {
      const validIds: string[] = [];
      const unknownIds: string[] = [];
      for (const raw of paragraph.sourceIds ?? []) {
        const id = String(raw).trim();
        if (!id) continue;
        if (sourceTexts.has(id)) {
          if (validIds.indexOf(id) < 0) validIds.push(id);
        } else if (unknownIds.indexOf(id) < 0) {
          unknownIds.push(id);
        }
      }
      const figures = emptyFigureIndex();
      for (const id of validIds) {
        const idx = figuresOf(id);
        (Object.keys(figures) as Array<keyof FigureIndex>).forEach((k) => {
          idx[k].forEach((v) => figures[k].add(v));
        });
      }
      return { validIds, unknownIds, figures, normalisedText: validIds.map(normOf).join("\n") };
    },
  };
  cache.set(input, ctx);
  return ctx;
}

/** True when the paragraph has visible text. */
export function hasText(p: Paragraph): boolean {
  return typeof p.text === "string" && p.text.trim() !== "";
}

/* ------------------------------------------------------------------------------------------------
 * Flags
 * ----------------------------------------------------------------------------------------------*/

export interface FlagSpec {
  code: ReportFlagCode;
  severity: FlagSeverity;
  message: string;
  sectionKey?: string;
  paragraphId?: string;
  gapId?: string;
  evidence?: string;
}

/** Normalised evidence for flag IDs: lower case, single spaces, at most 80 characters. */
export function evidenceKey(evidence: string | undefined): string {
  if (!evidence) return "";
  return normaliseForMatch(evidence).slice(0, 80);
}

/**
 * Stable flag ID: code + section + paragraph (or gap) + normalised evidence, so the UI keeps
 * selection and acknowledgements across re-runs.
 */
export function flagId(spec: Pick<FlagSpec, "code" | "sectionKey" | "paragraphId" | "gapId" | "evidence">): string {
  const parts: string[] = [spec.code, spec.sectionKey ?? "-", spec.paragraphId ?? spec.gapId ?? "-"];
  const ev = evidenceKey(spec.evidence);
  if (ev) parts.push(ev);
  return parts.join(":");
}

export function makeFlag(spec: FlagSpec): ReportFlag {
  const flag: ReportFlag = { id: flagId(spec), code: spec.code, severity: spec.severity, message: spec.message };
  if (spec.sectionKey) flag.sectionKey = spec.sectionKey;
  if (spec.paragraphId) flag.paragraphId = spec.paragraphId;
  if (spec.gapId) flag.gapId = spec.gapId;
  if (spec.evidence) flag.evidence = spec.evidence;
  return flag;
}

/** Keep the first flag for each ID. */
export function dedupeFlags(flags: ReportFlag[]): ReportFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}
