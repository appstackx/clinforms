/**
 * Case export file format ("Export case JSON" / "Import case JSON" on the Studio home).
 *
 * The export is a file a clinic downloads, so it follows the customer-facing wording (core/wording.ts):
 * no vendor or model names, and no internal technology words in its keys or values. Version 2 stores
 * the report in a PUBLIC ENCODING of the internal Report:
 *
 *   paragraph origin "ai"          → "draft"
 *   gap raisedBy "ai"              → "draft"
 *   section kind "ai_narrative"    → "narrative"
 *   generation[].model             → generation[].engine   (always the neutral engine name)
 *   generation[].promptVersion     → generation[].draftingVersion
 *   generation[].stopReason        → generation[].finish   (values renamed, see FINISH_NAMES)
 *   activity[].detail              → text from an earlier build rewritten (neutralLegacyText)
 *
 * The encoding is reversible: decodeCaseReport() restores the internal Report exactly, so an approved
 * report still re-hashes to its receipt's content fingerprint (core/fingerprint.ts) after import. The
 * activity log is outside the fingerprint. One exception: a report signed by an earlier build that
 * stored a vendor model id in generation[].model is exported with the neutral engine name too (the
 * download rule wins), so its receipt no longer verifies after import.
 *
 * Version 1 files (the internal Report as stored) are still accepted on import.
 *
 * Pure and browser-safe.
 */
import type { CASE_EXPORT_FORMAT } from "./schemas";
import type { Gap, GenerationMeta, Paragraph, ParagraphOrigin, Report, ReportSection, SectionKind } from "./types";
import { NEUTRAL_ENGINE, neutralLegacyText, publicEngineName } from "./wording";

export const CASE_EXPORT_FORMAT_VERSION = 2 as const;

/** The public name of the internal origin/raisedBy value "ai". */
export const PUBLIC_DRAFT_ORIGIN = "draft" as const;

/** The internal section kind "ai_narrative" and its public name. */
const INTERNAL_NARRATIVE_KIND = "ai_narrative" as const satisfies SectionKind;
export const PUBLIC_NARRATIVE_KIND = "narrative" as const;

/** Internal stop reasons → their names in the export. Unknown values are kept as they are. */
const FINISH_NAMES: Readonly<Record<string, string>> = {
  end_turn: "complete",
  max_tokens: "length_limit",
  stop_sequence: "stop_marker",
  tool_use: "structured_step",
  pause_turn: "paused",
  refusal: "declined",
  model_context_window_exceeded: "input_too_long",
};
const FINISH_INTERNAL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FINISH_NAMES).map(([internal, name]) => [name, internal]),
);

export type PublicParagraph = Omit<Paragraph, "origin"> & {
  origin: Exclude<ParagraphOrigin, "ai"> | typeof PUBLIC_DRAFT_ORIGIN;
};
export type PublicSection = Omit<ReportSection, "paragraphs" | "kind"> & {
  kind: Exclude<SectionKind, typeof INTERNAL_NARRATIVE_KIND> | typeof PUBLIC_NARRATIVE_KIND;
  paragraphs: PublicParagraph[];
};
export type PublicGap = Omit<Gap, "raisedBy"> & { raisedBy?: "system" | typeof PUBLIC_DRAFT_ORIGIN };
export type PublicGeneration = Omit<GenerationMeta, "model" | "promptVersion" | "stopReason"> & {
  engine?: string;
  draftingVersion: string;
  finish?: string;
};
export type PublicCaseReport = Omit<Report, "sections" | "gaps" | "generation"> & {
  sections: PublicSection[];
  gaps: PublicGap[];
  generation: PublicGeneration[];
};

export interface CaseExport {
  format: typeof CASE_EXPORT_FORMAT;
  formatVersion: typeof CASE_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  product: { name: string; version: string };
  report: PublicCaseReport;
}

function encodeGeneration(g: GenerationMeta): PublicGeneration {
  const { model, promptVersion, stopReason, ...rest } = g;
  return {
    ...rest,
    ...(model ? { engine: publicEngineName(model) ?? NEUTRAL_ENGINE } : {}),
    draftingVersion: promptVersion,
    ...(stopReason ? { finish: FINISH_NAMES[stopReason] ?? stopReason } : {}),
  };
}

/** The report as a clinic downloads it (public encoding, see the file header). */
export function encodeCaseReport(report: Report): PublicCaseReport {
  return {
    ...report,
    sections: report.sections.map((s) => ({
      ...s,
      kind: s.kind === INTERNAL_NARRATIVE_KIND ? PUBLIC_NARRATIVE_KIND : s.kind,
      paragraphs: s.paragraphs.map((p) => ({ ...p, origin: p.origin === "ai" ? PUBLIC_DRAFT_ORIGIN : p.origin })),
    })),
    gaps: report.gaps.map((g) => {
      const { raisedBy, ...rest } = g;
      return raisedBy === undefined ? rest : { ...rest, raisedBy: raisedBy === "ai" ? PUBLIC_DRAFT_ORIGIN : raisedBy };
    }),
    generation: report.generation.map(encodeGeneration),
    activity: report.activity.map((a) => ({ ...a, detail: neutralLegacyText(a.detail) })),
  };
}

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const mapArray = (v: unknown, fn: (item: Loose) => Loose): unknown => (Array.isArray(v) ? v.map((i) => (isObject(i) ? fn(i) : i)) : v);

/**
 * The internal Report from a public-encoded one (version 2 files). Works on unvalidated input and
 * returns it unvalidated: the caller checks the result with ReportSchema.
 */
export function decodeCaseReport(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  return {
    ...raw,
    sections: mapArray(raw.sections, (s) => ({
      ...s,
      ...(s.kind === PUBLIC_NARRATIVE_KIND ? { kind: INTERNAL_NARRATIVE_KIND } : {}),
      paragraphs: mapArray(s.paragraphs, (p) => (p.origin === PUBLIC_DRAFT_ORIGIN ? { ...p, origin: "ai" } : p)),
    })),
    gaps: mapArray(raw.gaps, (g) => (g.raisedBy === PUBLIC_DRAFT_ORIGIN ? { ...g, raisedBy: "ai" } : g)),
    generation: mapArray(raw.generation, (g) => {
      const { engine, draftingVersion, finish, ...rest } = g;
      return {
        ...rest,
        ...(engine !== undefined ? { model: engine } : {}),
        ...(draftingVersion !== undefined ? { promptVersion: draftingVersion } : {}),
        ...(finish !== undefined ? { stopReason: typeof finish === "string" ? (FINISH_INTERNAL[finish] ?? finish) : finish } : {}),
      };
    }),
  };
}
