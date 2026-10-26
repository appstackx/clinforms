/**
 * Review workspace model – labels: the generation badge, origin pills, citation chips, the options a structured
 * answer offers, the read-only answer text and the plain-English lines of what still blocks approval.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import { formatUkDate, formatUkDayMonth } from "../../../core/dates";
import { answerKindFor, answerToText, parseFormAnswerValue } from "../../../core/forms";
import { NOTICES } from "../../../config.public";
import { TENANT_COPY } from "../../studio-copy";
import { WORDING } from "../../wording";
import type { ActivityEntry, ConnectorId, EpisodeBundle, FormDefinition, FormField, GenerationMeta, ParagraphOrigin, Report, ReportFlag, ReportSection } from "../../../core/types";

/* ------------------------------------------------------------------------------------------------
 * Generation badge (honest provenance)
 * ----------------------------------------------------------------------------------------------*/

export interface GenerationSummary {
  label: string;
  tone: "live" | "recorded" | "prewritten" | "none";
  /** One line per drafted group, e.g. "F-07, F-08 · drafted 06/10/2026 21:04 · 6 s" (core/wording.ts). */
  lines: string[];
}

function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s >= 90 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/**
 * The generation badge: "Drafted from the notes in 34 s" (wall time from the first call's start to
 * the last call's end) / "Prepared demo draft (DD/MM/YYYY)" / "Sample draft (demo)" – customer-facing
 * wording from core/wording.ts. Null when nothing has been drafted.
 */
export function generationSummary(generation: readonly GenerationMeta[]): GenerationSummary | null {
  if (generation.length === 0) return null;
  const w = WORDING.generation;
  const lines = generation.map((g) =>
    w.line(
      {
        sectionKeys: g.sectionKeys,
        mode: g.mode,
        at: g.mode === "demo_recorded" ? g.recordedAt ?? g.at : g.at,
        durationMs: g.durationMs,
        model: g.model,
        tokens: g.usage ? g.usage.inputTokens + g.usage.outputTokens : undefined,
      },
      seconds,
    ),
  );
  const live = generation.filter((g) => g.mode === "live");
  const recorded = generation.filter((g) => g.mode === "demo_recorded");
  const others = (n: number) => (n > 0 ? ` (+${n} other group${n === 1 ? "" : "s"})` : "");
  if (live.length > 0) {
    const starts = live.map((g) => Date.parse(g.at)).filter((n) => !Number.isNaN(n));
    const ends = live
      .filter((g) => g.durationMs !== undefined)
      .map((g) => Date.parse(g.at) + (g.durationMs ?? 0))
      .filter((n) => !Number.isNaN(n));
    const wall = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null;
    return {
      label: `${w.live(wall !== null && wall > 0 ? seconds(wall) : null)}${others(generation.length - live.length)}`,
      tone: "live",
      lines,
    };
  }
  if (recorded.length > 0) {
    const dates = recorded.map((g) => g.recordedAt ?? g.at).sort();
    return { label: `${w.recorded(formatUkDate(dates[dates.length - 1]))}${others(generation.length - recorded.length)}`, tone: "recorded", lines };
  }
  return { label: w.prewritten, tone: "prewritten", lines };
}

/* ------------------------------------------------------------------------------------------------
 * Labels: origins and citations
 * ----------------------------------------------------------------------------------------------*/

/**
 * Origin pill text. From-records answers name the clinic system they came from. Once the report is approved
 * (`approved`), a drafted paragraph says where it came from rather than "Draft" (test run 24/10/2026, finding 6).
 */
export function originLabel(origin: ParagraphOrigin, connectorId: ConnectorId, approved = false): string {
  switch (origin) {
    case "from_records":
      return connectorId === "file-import" ? "From clinic records" : "From TM3 records";
    case "ai":
      return approved ? WORDING.origin.draftedApproved : WORDING.origin.drafted;
    case "edited":
      return "Edited";
    case "clinician":
      return "Clinician";
  }
}

/**
 * Why an approved Word form offers no PDF copy here – the approved banner then shows its Word download alone, with
 * this line – or null when it does. The PDF copy needs this deployment's converter (/health `pdfFromWord`); until that
 * is known to be there, no PDF button, so there is never a greyed-out or failing one (test run 24/10/2026). `failed`:
 * the message of a PDF copy that could not be made after all.
 */
export function wordFormPdfNote(input: { formKind: FormDefinition["kind"] | undefined; pdfFromWord: boolean | undefined; failed: string | null }): string | null {
  if (input.formKind !== "docx") return null;
  if (input.failed !== null) return input.failed;
  return input.pdfFromWord === true ? null : NOTICES.wordFormPdfHint;
}

export const ORIGIN_PILL_CLASSES: Record<ParagraphOrigin, string> = {
  from_records: "border-teal-200 bg-teal-50 text-teal-800",
  ai: "border-sky-200 bg-sky-50 text-sky-800",
  edited: "border-violet-200 bg-violet-50 text-violet-800",
  clinician: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

export type SourceKind = "note" | "fact" | "registration" | "unknown";

export function sourceKind(id: string): SourceKind {
  if (id === "REG") return "registration";
  if (/^N-\d{3,}$/.test(id)) return "note";
  if (/^FACT-/.test(id)) return "fact";
  return "unknown";
}

/** Chip text: "N-003 · 21/03", "FACT-attendance", "REG". */
export function citationLabel(id: string, bundle: Pick<EpisodeBundle, "notes">): string {
  const kind = sourceKind(id);
  if (kind === "note") {
    const note = bundle.notes.find((n) => n.id === id);
    return note ? `${id} · ${formatUkDayMonth(note.date)}` : id;
  }
  // Plain words for the record's other sources (the internal ID stays in the chip's accessible name).
  if (kind === "registration") return "Registration";
  if (kind === "fact") {
    if (id === "FACT-attendance") return "Attendance record";
    if (id === "FACT-age") return "Age";
    if (id === "FACT-episode") return "Episode dates";
    const instrument = /^FACT-outcomes-(.+)$/.exec(id)?.[1];
    if (instrument) return `${instrument} scores`;
  }
  return id;
}

/** Accessible name for a citation chip. */
export function citationAriaLabel(id: string, bundle: Pick<EpisodeBundle, "notes">): string {
  const kind = sourceKind(id);
  if (kind === "note") {
    const note = bundle.notes.find((n) => n.id === id);
    return note ? `Source ${id}: note of ${formatUkDate(note.date)} by ${note.author.name}. Show in Sources.` : `Source ${id} (not in this record)`;
  }
  if (kind === "fact") return `Source ${id}: computed from the record. Show in Sources.`;
  if (kind === "registration") return "Source REG: registration details. Show in Sources.";
  return `Unknown source ${id}`;
}

/** Where each source is cited: source ID → section keys, in report order, de-duplicated. */
export function citationsBySource(report: Pick<Report, "sections">): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const section of report.sections) {
    for (const p of section.paragraphs) {
      for (const id of p.sourceIds) {
        const list = out.get(id) ?? [];
        if (list.indexOf(section.key) < 0) list.push(section.key);
        out.set(id, list);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Structured answers: options shown to the reviewer
 * ----------------------------------------------------------------------------------------------*/

export interface AnswerOption {
  /** Shown and written text. */
  label: string;
  value: string | boolean;
}

/** The radio options of a yes/no or single-choice question (as printed where the form prints them). */
export function answerOptions(field: Pick<FormField, "answerType" | "options">): AnswerOption[] {
  const kind = answerKindFor(field.answerType);
  if (kind === "yes_no") {
    const printed = field.options?.length ? field.options : ["Yes", "No"];
    const out: AnswerOption[] = [];
    for (const label of printed) {
      const parsed = parseFormAnswerValue(field, label);
      if (typeof parsed.value === "boolean" && !out.some((o) => o.value === parsed.value)) out.push({ label, value: parsed.value });
    }
    if (!out.some((o) => o.value === true)) out.unshift({ label: "Yes", value: true });
    if (!out.some((o) => o.value === false)) out.push({ label: "No", value: false });
    return out;
  }
  if (kind === "choice") return (field.options ?? []).map((o) => ({ label: o, value: o }));
  return [];
}

/** Text of an answer for the read-only view (structured value, or the paragraphs). */
export function answerText(section: ReportSection): string {
  return answerToText(section);
}

/** Filing entries in the activity log (Save to clinic record). */
export function filedEntries(report: Pick<Report, "activity">): ActivityEntry[] {
  return report.activity.filter((a) => a.action === "filed");
}

/**
 * The review header's line for a staff member (fix round 1, B0-26): what is still open first ("5 items to resolve – then a
 * clinician with signing details approves."); "Ready for a signing clinician" only once nothing blocks approval.
 */
export function staffApprovalNote(openItems: number): string {
  return openItems > 0 ? `${openItems} item${openItems === 1 ? "" : "s"} to resolve – ${TENANT_COPY.review.staffThenApproves}` : TENANT_COPY.review.staffCannotApprove;
}

/** Plain-English list of what still blocks approval (for the tooltip and the dialog). */
export function blockingLines(blocking: readonly ReportFlag[], report: Pick<Report, "sections">, max = 6): string[] {
  const titles = new Map(report.sections.map((s) => [s.key, s.title]));
  const lines = blocking.slice(0, max).map((f) => {
    const where = f.sectionKey ? `${f.sectionKey.startsWith("F-") ? `${f.sectionKey} ` : ""}${titles.get(f.sectionKey) ?? ""}`.trim() : "Whole report";
    return `${where}: ${f.message}`;
  });
  if (blocking.length > max) lines.push(`…and ${blocking.length - max} more.`);
  return lines;
}
