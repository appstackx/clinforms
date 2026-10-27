/**
 * Pure helpers for the mapping editor: plain-English anchor descriptions, new fields, applying a
 * location picked in the preview, and the option lists for the selects.
 *
 * bh2 WE (designs 2 and 4): the mapping page's groups come from the same outline as the review (core/forms/headings.ts
 * formOutline); the map lint's findings are its hints (mappingLint); L5 also blocks confirming, as on the server.
 *
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { formAnchorPdfFieldNames, parseBlockId } from "../../../core/forms";
import { UNTITLED_HEADING, formOutline } from "../../../core/forms/headings";
import { acceptsJudgement, lintFormMap, type LintIssue } from "../../../core/form-map-lint";
import { memberActor } from "../../../core/actor";
import { appointmentColumnsFor, tableColumnsOf } from "../../../core/form-tables";
import { findPracticeCodes, humaniseMergeCodes, practiceCode, practiceCodeWords, practiceCodesInWords } from "../../../core/practice-merge-codes";
import { REGISTRATION_PATH_LABELS } from "../../../core/labels";
import { nextQuestionAnchor, questionAnchor } from "../../../core/question-set";
import { FORM_FIELD_ID_PATTERN } from "../../../core/schemas";
import type {
  ComputedFactFormat,
  DocxAnchorTarget,
  FactId,
  FillSource,
  FormAnchor,
  FormDefinition,
  FormField,
  FormKind,
  PdfCharFormat,
  PdfOptionField,
  RegistrationPath,
  SignoffPart,
} from "../../../core/types";
import type { StudioMember } from "../../host-hooks";
import type { PreviewPick } from "../shared/original-form-preview";

export const DOCX_TARGET_LABELS: Record<DocxAnchorTarget, string> = {
  table_cell: "Into an answer cell",
  after_paragraph: "On a new line after the question",
  replace_placeholder: "Replacing placeholder text",
  content_control: "Into a Word content control",
  checkbox_glyph: "Ticking a ☐ box",
  legacy_form_field: "Into a legacy Word form field",
  mark_cell: "Marking a cell of a table",
  delete_options: "Keeping one printed option, deleting the others",
};

export const FACT_OPTIONS: ReadonlyArray<{ id: FactId; label: string }> = [
  { id: "FACT-attendance", label: "Attendance (sessions attended, missed)" },
  { id: "FACT-episode", label: "Episode dates" },
  { id: "FACT-age", label: "Age at the date of the report" },
  { id: "FACT-outcomes-NDI", label: "Outcome scores – NDI" },
  { id: "FACT-outcomes-ODI", label: "Outcome scores – ODI" },
  { id: "FACT-outcomes-NPRS", label: "Outcome scores – NPRS (pain)" },
  { id: "FACT-outcomes-PSFS", label: "Outcome scores – PSFS" },
  { id: "FACT-outcomes-QuickDASH", label: "Outcome scores – QuickDASH" },
];

/** "Table 2, row 4, cell 2" (1-based for people) for a Word block ID. */
export function describeBlock(blockId: string): string {
  const parsed = parseBlockId(blockId);
  if (!parsed) return `Location “${blockId}”`;
  if (parsed.kind === "paragraph") return `Paragraph ${parsed.p + 1}`;
  const path = parsed.cells.map((c, i) => `${i === 0 ? "Table" : "nested table"} ${c.t + 1}, row ${c.r + 1}, cell ${c.c + 1}`).join(" › ");
  return parsed.p === undefined ? path : `${path}, line ${parsed.p + 1}`;
}

/** Where the answer goes, in plain English. */
export function describeAnchor(anchor: FormAnchor): string {
  switch (anchor.kind) {
    case "docx": {
      const where = describeBlock(anchor.blockId);
      switch (anchor.target) {
        case "table_cell":
          return `Answer cell – ${where}`;
        case "after_paragraph":
          return `New line after ${where.toLowerCase()}`;
        case "replace_placeholder":
          return anchor.writeAfter
            ? `After the printed “${anchor.placeholderText ?? "…"}” – ${where}`
            : `Replaces “${anchor.placeholderText ?? "…"}”${anchor.clearPlaceholder ? " (never printed, even before it is answered)" : ""} – ${where}`;
        case "content_control":
          return `Content control – ${where}`;
        case "checkbox_glyph": {
          const opts = anchor.optionGlyphs?.map((g) => g.option).filter(Boolean) ?? [];
          return `Tick boxes${opts.length ? ` (${opts.join(" / ")})` : ""} – ${where}`;
        }
        case "legacy_form_field":
          return `Word form field – ${where}`;
        case "mark_cell": {
          const cells = anchor.optionCells ?? [];
          return `Marks “${anchor.mark ?? "X"}” in one cell (${cells.map((c) => `${c.option}: ${describeBlock(c.blockId).toLowerCase()}`).join(" / ")})`;
        }
        case "delete_options":
          return anchor.placeholderText
            ? `Keeps one of “${anchor.placeholderText}”, deletes the others – ${where}`
            : `Keeps one printed option, deletes the others (${(anchor.optionTexts ?? []).map((o) => o.option).join(" / ")}) – ${where}`;
      }
      return where;
    }
    case "pdf_field": {
      if (anchor.optionFields?.length) {
        return `PDF tick boxes ${anchor.optionFields.map((o) => `“${o.fieldName}”${o.onValue ? ` [${o.onValue}]` : ""} (${o.option})`).join(" / ")}`;
      }
      const labels = anchor.optionLabels?.length && anchor.options?.length === anchor.optionLabels.length
        ? `: ${anchor.options.map((v, i) => `${v} = ${anchor.optionLabels?.[i] || "?"}`).join(", ")}`
        : "";
      return `PDF field “${anchor.fieldName}” (${anchor.fieldType})${labels}`;
    }
    case "pdf_overlay":
      return `Page ${anchor.page}, box at ${Math.round(anchor.x)}, ${Math.round(anchor.y)} (${Math.round(anchor.width)} × ${Math.round(anchor.height)} pt)${anchor.dateSlots?.length ? `, date in ${anchor.dateSlots.length} parts` : ""}${anchor.ruledRows?.length ? `, on ${anchor.ruledRows.length} printed lines` : ""}`;
    case "pdf_char_fields":
      return `${anchor.fieldNames.length} character boxes “${anchor.fieldNames[0]}” to “${anchor.fieldNames[anchor.fieldNames.length - 1]}” (${CHAR_FORMAT_LABELS[anchor.format]})`;
    case "pdf_table":
      return `PDF table: ${anchor.rows.length} rows × ${anchor.columns.length} columns (${anchor.columns.map((c) => c.header || c.key).join(" / ")})`;
    case "pdf_overlay_table":
      return `Page ${anchor.page}, table of ${anchor.rowTops.length} rows × ${anchor.columns.length} columns, first row top at ${Math.round(anchor.rowTops[0] ?? 0)} pt`;
    case "pdf_overlay_ticks":
      return `Page ${anchor.page}, tick boxes ${anchor.options.map((o) => `“${o.option}” at ${Math.round(o.x)}, ${Math.round(o.y)}`).join(", ")}`;
  }
}

/** How one-character boxes are written, for people. */
export const CHAR_FORMAT_LABELS: Record<PdfCharFormat, string> = {
  DDMMYYYY: "date as DDMMYYYY",
  DDMMYY: "date as DDMMYY",
  chars: "one character per box",
};

function quoteLabel(label: string): string {
  const t = label.replace(/\s+/g, " ").trim().replace(/[:?]$/, "");
  return `“${t.length > 48 ? `${t.slice(0, 46)}…` : t}”`;
}

/** Printed text quoted in a place's description: clinic-system codes in plain words, at most 40 characters. */
function quotePrinted(text: string): string {
  const t = humaniseMergeCodes(text);
  return `“${t.length > 40 ? `${t.slice(0, 38)}…` : t}”`;
}

/**
 * Where the answer goes, in words a practice manager uses ("In the box next to “Date of birth”"). The
 * technical location (block, table, row, cell) is shown only under "Edit the location by hand" – the only
 * place a clinic-system code is shown as printed (“In place of the merge code for the patient's first name”).
 */
/** What a question is filled with, in words (fix round 1, B0-29: said when it is not what the code usually prints). */
const FILLED_WITH: Partial<Record<RegistrationPath, string>> = {
  "episode.firstSeen": "the first appointment's date",
  "episode.lastSeen": "the last appointment's date",
  "episode.dischargeDate": "the discharge date",
  "incident.date": "the date of the accident",
  "report.date": "the date of the report",
  "staff.entry": "what staff type in on each report",
};

function filledWith(source: FillSource): string {
  switch (source.kind) {
    case "registration":
      return FILLED_WITH[source.path] ?? `the record's “${REGISTRATION_PATH_LABELS[source.path]}”`;
    case "computed_fact":
      return "a figure worked out from the record";
    case "notes_narrative":
      return "an answer from the notes";
    case "clinician_opinion":
      return "the clinician's own answer";
    case "signoff":
      return "the approval";
    default:
      return "its answer";
  }
}

/**
 * Whether a clinic-system code is filled with what it usually prints: its own record field, or a line of the address /
 * postcode it stands for. Else the place is described by what the question is really filled with.
 */
function fillsCodeAsUsual(code: string, source: FillSource | undefined): boolean {
  const binding = practiceCode(code.slice(2, -2))?.binding;
  if (!binding || !source) return true;
  if (binding.kind === "record") return source.kind === "registration" && source.path === binding.path;
  if (binding.kind === "address_line") return source.kind === "registration" && source.path === `${binding.family}.addressLines`;
  if (binding.kind === "postcode") return source.kind === "registration" && source.path === `${binding.family}.postcode`;
  if (binding.kind === "not_held") return source.kind === "registration" && source.path === "staff.entry";
  // Decided by the form's label ("Date of Accident" → the accident's date): as usual when it is one of those.
  return source.kind === "registration" && binding.choices.some((c) => c.path === source.path);
}

/** What a clinic-system code usually prints, in words – a code that depends on the clinic's set-up by its name only. */
function usuallyPrints(code: string): string {
  const entry = practiceCode(code);
  if (entry?.binding.kind === "by_label") return `the clinic system's ${entry.label.toLowerCase()}`;
  return practiceCodeWords(code) ?? "something else";
}

export function plainAnchorDescription(field: Pick<FormField, "anchor" | "label"> & Partial<Pick<FormField, "fillSource">>): string {
  const a = field.anchor;
  const q = quoteLabel(humaniseMergeCodes(field.label));
  switch (a.kind) {
    case "docx":
      switch (a.target) {
        case "table_cell":
          return `In the answer box for ${q}`;
        case "after_paragraph":
          return `On the lines under ${q}`;
        case "replace_placeholder": {
          const ph = (a.placeholderText ?? "").trim();
          const codes = practiceCodesInWords(ph);
          if (a.writeAfter) return `After the printed ${codes ?? quotePrinted(ph)}`;
          if (/^[_.…\s-]+$/.test(ph) || !ph) return `On the blank line for ${q}`;
          // Fix round 1 (B0-29): "the merge code for the date of the report" only when that is what goes there.
          const found = findPracticeCodes(ph);
          if (codes && found.length === 1 && field.fillSource && !fillsCodeAsUsual(found[0].text, field.fillSource)) {
            return `${capitalise(filledWith(field.fillSource))}, in place of the code that usually prints ${usuallyPrints(found[0].code)}`;
          }
          return codes ? `In place of the ${codes}` : `In place of ${quotePrinted(ph)}`;
        }
        case "content_control":
          return `In the grey field for ${q}`;
        case "checkbox_glyph": {
          const opts = a.optionGlyphs?.map((g) => `“${g.option}”`).filter(Boolean) ?? [];
          return opts.length ? `Ticks one of the boxes ${opts.join(" / ")}` : "Ticks the box";
        }
        case "legacy_form_field":
          return `In the form field for ${q}`;
        case "mark_cell": {
          const opts = a.optionCells?.map((c) => `“${c.option}”`) ?? [];
          return opts.length > 1 ? `Marks the cell of one of ${opts.join(" / ")}` : `Marks the cell for ${opts[0] ?? q}`;
        }
        case "delete_options": {
          const opts = (a.optionTexts?.length ? a.optionTexts.map((o) => o.option) : []).map((o) => `“${o}”`);
          if (a.placeholderText) return `Keeps one of ${quotePrinted(a.placeholderText)} and deletes the others`;
          return opts.length > 1 ? `Keeps one of ${opts.join(" / ")} and deletes the others` : `Keeps ${opts[0] ?? q} when it applies, deletes it when not`;
        }
      }
      return `For ${q}`;
    case "pdf_field":
      if (a.optionFields?.length) {
        return `Ticks one of the boxes ${a.optionFields.map((o) => `“${o.option}”`).join(" / ")} (the others are left clear)`;
      }
      switch (a.fieldType) {
        case "checkbox":
          if (a.optionLabels && a.optionLabels.length > 1) return `Ticks one of the boxes ${a.optionLabels.map((o) => `“${o}”`).join(" / ")}`;
          return `Ticks the box for ${q}`;
        case "radio":
          return `Selects one of the printed options for ${q}`;
        case "dropdown":
          return `Chooses from the list for ${q}`;
        default:
          return `In the fillable box for ${q}`;
      }
    case "pdf_overlay":
      return `Written on page ${a.page}, in the space for ${q}`;
    case "pdf_char_fields":
      return a.format === "chars"
        ? `One character in each of the ${a.fieldNames.length} boxes for ${q}`
        : `The date written ${a.format === "DDMMYYYY" ? "DD MM YYYY" : "DD MM YY"}, one digit in each of the ${a.fieldNames.length} boxes for ${q}`;
    case "pdf_table":
    case "pdf_overlay_table":
      return `One row per line of the table for ${q} (${tableColumnsOf(a).map((c) => c.header || c.key).join(" / ")})`;
    case "pdf_overlay_ticks":
      return `Marks an X in one of the printed boxes ${a.options.map((o) => `“${o.option}”`).join(" / ")}`;
  }
}

/**
 * The question the mapping review opens on: the first that needs a decision – “Needs review” before “Check”,
 * each in the form's order – or the first question when none does.
 */
/**
 * The question the mapping review opens on: one to check ("Needs review" before "Check") – and (fix round 1, B0-29) of
 * those, a required one before an optional one, and a clinical question before a detail staff type in; else the first.
 */
export function firstQuestionToCheck(fields: ReadonlyArray<Pick<FormField, "id" | "confidence"> & Partial<Pick<FormField, "required" | "fillSource">>>): string | null {
  const staffEntry = (f: (typeof fields)[number]) => f.fillSource?.kind === "registration" && f.fillSource.path === "staff.entry";
  // Fix B1-17(c), B2-30: "Needs review" before "Check" first (as the comment above says), then a required question before
  // an optional one, then a clinical question before a detail staff type in or the sign-off.
  const minor = (f: (typeof fields)[number]) => staffEntry(f) || f.fillSource?.kind === "signoff";
  const rank = (f: (typeof fields)[number]) => [f.confidence === "high" ? 1 : 0, f.confidence === "low" ? 0 : 1, f.required === false ? 1 : 0, minor(f) ? 1 : 0];
  const before = (a: number[], b: number[]) => {
    const i = a.findIndex((v, k) => v !== b[k]);
    return i >= 0 && a[i] < b[i];
  };
  let best: { id: string; r: number[] } | null = null;
  for (const f of fields) {
    const r = rank(f);
    if (!best || before(r, best.r)) best = { id: f.id, r };
  }
  return best?.id ?? null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The mapping page's list order (fix round 1, B0-29): numbered questions printed in a table's columns ("Treatment
 * date 1", "Treatment date 7", "Treatment date 2"…) are listed by their number; everything else in the form's order.
 */
export function listedInOrder<T extends Pick<FormField, "id" | "label">>(fields: readonly T[]): T[] {
  const stem = (f: T) => /^(.*?)(\d+)(\D*)$/.exec(f.label.trim());
  const out: T[] = [];
  let i = 0;
  while (i < fields.length) {
    const m = stem(fields[i]);
    let j = i + 1;
    if (m) while (j < fields.length && stem(fields[j])?.[1] === m[1] && stem(fields[j])?.[3] === m[3]) j += 1;
    const run = fields.slice(i, j);
    out.push(...(run.length > 2 ? run.slice().sort((x, y) => Number(stem(x)![2]) - Number(stem(y)![2])) : run));
    i = j;
  }
  return out;
}

/** Next free field ID ("F-23"). */
export function nextFieldId(form: Pick<FormDefinition, "fields">): string {
  let max = 0;
  for (const f of form.fields) {
    if (!FORM_FIELD_ID_PATTERN.test(f.id)) continue;
    max = Math.max(max, Number(f.id.slice(2)));
  }
  return `F-${String(max + 1).padStart(2, "0")}`;
}

/** A default anchor for a new field of this form kind (to be picked in the preview). */
export function defaultAnchor(kind: FormKind): FormAnchor {
  switch (kind) {
    case "docx":
      return { kind: "docx", target: "after_paragraph", blockId: "p0" };
    case "pdf_acroform":
      return { kind: "pdf_field", fieldName: "choose-a-field", fieldType: "text" };
    case "pdf_flat":
      return { kind: "pdf_overlay", page: 1, x: 72, y: 72, width: 220, height: 14 };
    case "questions":
      // Portal questions have no file: a virtual place in the summary (core/question-set.ts).
      return questionAnchor(0);
  }
}

export function newField(form: Pick<FormDefinition, "fields" | "kind">, section?: string): FormField {
  return {
    id: nextFieldId(form),
    label: "New question",
    ...(section ? { section } : {}),
    guidance: "",
    answerType: "short_text",
    anchor: form.kind === "questions" ? nextQuestionAnchor(form.fields) : defaultAnchor(form.kind),
    fillSource: { kind: "notes_narrative" },
    required: false,
    confidence: "high",
    note: "Added by staff.",
  };
}

/** The anchor after the user picked a location in the preview. */
export function anchorFromPick(current: FormAnchor, pick: PreviewPick): FormAnchor {
  if (pick.kind === "docx") {
    const keepTarget =
      current.kind === "docx" &&
      (current.target === "replace_placeholder" || current.target === "content_control" || current.target === "legacy_form_field");
    if (keepTarget && current.kind === "docx") return { ...current, blockId: pick.blockId };
    return { kind: "docx", target: pick.isCell ? "table_cell" : "after_paragraph", blockId: pick.blockId };
  }
  if (pick.kind === "pdf_field") {
    // A box that already belongs to this answer (one of its tick boxes, character boxes or table cells)
    // keeps the anchor.
    if (
      formAnchorPdfFieldNames(current).indexOf(pick.fieldName) >= 0 &&
      (current.kind === "pdf_char_fields" || current.kind === "pdf_table" || (current.kind === "pdf_field" && current.optionFields?.length))
    ) {
      return current;
    }
    return { kind: "pdf_field", fieldName: pick.fieldName, fieldType: pick.fieldType, ...(pick.options && { options: pick.options }) };
  }
  const prev = current.kind === "pdf_overlay" ? current : null;
  const height = prev?.height ?? 14;
  return {
    kind: "pdf_overlay",
    page: pick.page,
    x: pick.x,
    y: Math.max(0, pick.y - height + 3),
    width: prev?.width ?? 220,
    height,
    ...(prev?.fontSize && { fontSize: prev.fontSize }),
  };
}

/**
 * A fill source of the given kind, keeping compatible details from the current one. `anchor` lets a
 * table question start its appointments columns from the printed headers.
 */
export function fillSourceOfKind(kind: FillSource["kind"], current: FillSource, anchor?: FormAnchor): FillSource {
  if (kind === current.kind) return current;
  switch (kind) {
    case "appointments_table":
      return { kind, columns: (anchor && appointmentColumnsFor(tableColumnsOf(anchor))) || {} };
    case "registration":
      return { kind, path: "patient.fullName" satisfies RegistrationPath };
    case "computed_fact":
      return { kind, factId: "FACT-attendance", format: "summary" satisfies ComputedFactFormat };
    case "signoff":
      return { kind, part: "signature" satisfies SignoffPart };
    case "fixed":
      return { kind, value: "" };
    default:
      return { kind };
  }
}

/** Options as edited in a textarea (one per line) → array (empty → undefined). */
export function parseOptions(text: string): string[] | undefined {
  const opts = text
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  return opts.length ? Array.from(new Set(opts)) : undefined;
}

/** Stable comparison of two form maps (unsaved-changes check). */
export function sameMapping(a: FormDefinition, b: FormDefinition): boolean {
  const strip = (f: FormDefinition) => JSON.stringify({ ...f, updatedAt: "", status: "", confirmed: undefined });
  return strip(a) === strip(b);
}

/* ------------------------------------------------------------------------------------------------
 * Fillable-PDF options: printed labels, one question across several tick boxes, character boxes
 * ----------------------------------------------------------------------------------------------*/

/**
 * Tick boxes as edited in a textarea, one per line: "Option = field name" or "Option = field name [on
 * value]". Lines without "=" are ignored. Empty → undefined.
 */
export function parseOptionFields(text: string): PdfOptionField[] | undefined {
  const out: PdfOptionField[] = [];
  for (const line of text.split("\n")) {
    const m = /^(.*?)\s*=\s*(.+?)(?:\s*\[([^\]]+)\])?\s*$/.exec(line.trim());
    if (!m || !m[1].trim() || !m[2].trim()) continue;
    out.push({ option: m[1].trim(), fieldName: m[2].trim(), ...(m[3]?.trim() ? { onValue: m[3].trim() } : {}) });
  }
  return out.length ? out : undefined;
}

export function formatOptionFields(options: readonly PdfOptionField[] | undefined): string {
  return (options ?? []).map((o) => `${o.option} = ${o.fieldName}${o.onValue ? ` [${o.onValue}]` : ""}`).join("\n");
}

/** Field names as edited in a textarea (one per line, or separated by commas), in order. */
export function parseFieldNames(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * The anchor with its tick-box options replaced: the first box becomes the field name; none left →
 * a plain field anchor again.
 */
export function withOptionFields(anchor: Extract<FormAnchor, { kind: "pdf_field" }>, options: PdfOptionField[] | undefined): FormAnchor {
  const { optionFields: _old, ...rest } = anchor;
  void _old;
  if (!options?.length) return rest;
  return { ...rest, fieldName: options[0].fieldName, fieldType: "checkbox", optionFields: options };
}

/** The anchor with the printed label of export value `i` set (labels kept aligned with the options). */
export function withOptionLabel(anchor: Extract<FormAnchor, { kind: "pdf_field" }>, i: number, label: string): FormAnchor {
  const n = anchor.options?.length ?? 0;
  const labels = Array.from({ length: n }, (_, k) => anchor.optionLabels?.[k] ?? "");
  labels[i] = label;
  const { optionLabels: _old, ...rest } = anchor;
  void _old;
  return labels.some((l) => l.trim()) ? { ...rest, optionLabels: labels } : rest;
}

/**
 * Fix round 1 (B0-9, B0-25): whether this member may confirm a form mapping, or change or remove a confirmed one – an
 * owner, administrator or clinician (the server's CONFIRM_ROLES; staff prepare reports and check proposed maps). The
 * public demo (no member) acts as a clinician. The server decides in the end; this only stops offering what it refuses.
 */
export function mayConfirmForms(member: Pick<StudioMember, "role"> | undefined): boolean {
  return member?.role !== "staff";
}


/* ------------------------------------------------------------------------------------------------
 * bh2 WE: one outline for both screens, and the map lint as hints
 * ----------------------------------------------------------------------------------------------*/

/** One group of the mapping page: the review's group (same outline), with the questions of it that are shown. */
export interface MappingGroup<T> {
  /** The outline group's index (two groups of the same title stay apart, as on the review). */
  key: string;
  /** The form's heading; UNTITLED_HEADING for a run without one; "" when the form prints no headings at all. */
  title: string;
  fields: T[];
}

/**
 * The mapping page's groups: the questions shown (`visible`, in the page's list order), grouped by the outline the review
 * uses (core/forms/headings.ts formOutline over the whole map), consecutive questions of one group together.
 */
export function mappingGroups<T extends Pick<FormField, "id">>(fields: ReadonlyArray<Pick<FormField, "id" | "section" | "label">>, visible: readonly T[]): MappingGroup<T>[] {
  const outline = formOutline(fields);
  const groupOf = new Map<string, number>();
  outline.forEach((g, gi) => g.entries.forEach((e) => groupOf.set(fields[e.index].id, gi)));
  const out: MappingGroup<T>[] = [];
  for (const f of visible) {
    const gi = groupOf.get(f.id) ?? -1;
    const key = String(gi);
    const last = out[out.length - 1];
    if (last && last.key === key) last.fields.push(f);
    else out.push({ key, title: gi >= 0 ? outline[gi].title : UNTITLED_HEADING, fields: [f] });
  }
  return out;
}

/** The lint rules shown on the mapping page: the clinic can act on these (L9 and L11 are ClinForms' own loading checks). */
const PAGE_RULES = new Set<LintIssue["rule"]>(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L10", "L12"]);

export interface MappingLint {
  /** Each question's findings (errors and accepted ones). */
  byField: Map<string, LintIssue[]>;
  /** The map's own findings (its notes). */
  mapLevel: LintIssue[];
  /** What blocks confirming, as /forms/confirm refuses it: L5 not accepted. */
  blocking: string[];
  /**
   * The questions whose clinical judgement the map accepts as worded (L5 accepted): /forms/confirm lets only a
   * clinician – or a member who may sign – confirm such a map (check-WE minor 9: the page says so before the click).
   */
  acceptedJudgements: string[];
}

/** The map lint as the mapping page shows it (core/form-map-lint.ts). */
export function mappingLint(form: Pick<FormDefinition, "fields" | "analysis" | "file">): MappingLint {
  const issues = lintFormMap(form).filter((i) => PAGE_RULES.has(i.rule));
  const byField = new Map<string, LintIssue[]>();
  const mapLevel: LintIssue[] = [];
  for (const i of issues) {
    if (!i.fieldId) {
      if (i.severity === "error") mapLevel.push(i);
      continue;
    }
    byField.set(i.fieldId, [...(byField.get(i.fieldId) ?? []), i]);
  }
  const blocking = issues.filter((i) => i.rule === "L5" && i.severity === "error").map((i) => `${i.fieldId}: ${i.message}`);
  const acceptedJudgements = issues.filter((i) => i.rule === "L5" && i.severity === "accepted" && i.fieldId).map((i) => i.fieldId as string);
  return { byField, mapLevel, blocking, acceptedJudgements };
}

/**
 * Whether this member may accept a clinical judgement as the map words it (L5): a clinician – the role, or a member
 * who may sign with a registration number – the same rule /forms/confirm applies to the Actor it stamps
 * (core/form-map-lint.ts acceptsJudgement on core/actor.ts memberActor).
 */
export function mayAcceptJudgement(member: Pick<StudioMember, "role" | "canSign" | "hcpc"> | undefined): boolean {
  if (!member) return true; // the public demo acts as a clinician
  return acceptsJudgement(memberActor({ name: "", role: member.role, canSign: member.canSign, hcpc: member.hcpc }, ""));
}

/**
 * What the mapping page lists before confirming when this member may not accept the map's clinical judgements (the
 * server would refuse the confirmation with 403): who confirms it instead. Null when nothing stands in the way.
 */
export function judgementConfirmProblem(lint: Pick<MappingLint, "acceptedJudgements">, mayAccept: boolean): string | null {
  if (mayAccept || lint.acceptedJudgements.length === 0) return null;
  const ids = lint.acceptedJudgements;
  return `This mapping accepts a clinical judgement as worded on ${ids.length === 1 ? "question" : "questions"} ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? ` and ${ids.length - 6} more` : ""}: a clinician (or a member who may sign) confirms it.`;
}

/** What the mapping page's footer says before confirming (mappingConfirmStatus). */
export interface MappingConfirmStatus {
  /** The status line. */
  status: string;
  /** Who confirms the mapping, under the status line – null when the status line already says it, or nobody else is needed. */
  roleNote: string | null;
}

/**
 * Fix round 1 (R1T-WE-L1, TPN-L4): the mapping page's footer. Problems the member can fix on the page (the form checks,
 * the referrer, an unaccepted clinical judgement) are counted. Who may confirm is never counted as a problem to fix: a
 * member whose role does not confirm forms (staff), or a map that accepts a clinical judgement as worded and a member who
 * may not accept one (judgementConfirmProblem), is told only who confirms it – staff saw "1 problem to fix before
 * confirming" when the only obstacle was their role.
 */
export function mappingConfirmStatus(input: {
  /** Problems the member can fix on this page (not who confirms). */
  fixable: readonly string[];
  /** judgementConfirmProblem: who confirms a map that accepts a clinical judgement as worded, when this member may not. */
  judgementObstacle: string | null;
  mayConfirm: boolean;
  dirty: boolean;
  confirmed: boolean;
  /** Who confirms forms (the Studio copy), shown to a member who may not. */
  confirmRole: string;
}): MappingConfirmStatus {
  const n = input.fixable.length;
  const who = input.judgementObstacle ?? (input.mayConfirm ? null : input.confirmRole);
  if (n) return { status: `${n} ${n === 1 ? "problem" : "problems"} to fix before confirming`, roleNote: who };
  if (input.dirty) return { status: "Unsaved changes", roleNote: who };
  if (input.confirmed) return { status: "No changes", roleNote: who };
  // Only who confirms stands in the way: say so, with no count.
  if (input.judgementObstacle) return { status: input.judgementObstacle, roleNote: null };
  if (!input.mayConfirm) return { status: "Ready for an owner, administrator or clinician to confirm", roleNote: input.confirmRole };
  return { status: "Ready to confirm", roleNote: null };
}
