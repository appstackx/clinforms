/**
 * Pure helpers for the mapping editor: plain-English anchor descriptions, new fields, applying a
 * location picked in the preview, and the option lists for the selects.
 *
 * Owner: studio-a agent.
 */
import { formAnchorPdfFieldNames, parseBlockId } from "../../../core/forms";
import { appointmentColumnsFor, tableColumnsOf } from "../../../core/form-tables";
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
import type { PreviewPick } from "../shared/original-form-preview";

export const DOCX_TARGET_LABELS: Record<DocxAnchorTarget, string> = {
  table_cell: "Into an answer cell",
  after_paragraph: "On a new line after the question",
  replace_placeholder: "Replacing placeholder text",
  content_control: "Into a Word content control",
  checkbox_glyph: "Ticking a ☐ box",
  legacy_form_field: "Into a legacy Word form field",
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
          return `Replaces “${anchor.placeholderText ?? "…"}” – ${where}`;
        case "content_control":
          return `Content control – ${where}`;
        case "checkbox_glyph": {
          const opts = anchor.optionGlyphs?.map((g) => g.option).filter(Boolean) ?? [];
          return `Tick boxes${opts.length ? ` (${opts.join(" / ")})` : ""} – ${where}`;
        }
        case "legacy_form_field":
          return `Word form field – ${where}`;
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

/**
 * Where the answer goes, in words a practice manager uses ("In the box next to “Date of birth”"). The
 * technical location (block, table, row, cell) is shown only under "Edit the location by hand".
 */
export function plainAnchorDescription(field: Pick<FormField, "anchor" | "label">): string {
  const a = field.anchor;
  const q = quoteLabel(field.label);
  switch (a.kind) {
    case "docx":
      switch (a.target) {
        case "table_cell":
          return `In the answer box for ${q}`;
        case "after_paragraph":
          return `On the lines under ${q}`;
        case "replace_placeholder": {
          const ph = (a.placeholderText ?? "").trim();
          return /^[_.…\s-]+$/.test(ph) || !ph ? `On the blank line for ${q}` : `In place of “${ph.length > 40 ? `${ph.slice(0, 38)}…` : ph}”`;
        }
        case "content_control":
          return `In the grey field for ${q}`;
        case "checkbox_glyph": {
          const opts = a.optionGlyphs?.map((g) => `“${g.option}”`).filter(Boolean) ?? [];
          return opts.length ? `Ticks one of the boxes ${opts.join(" / ")}` : "Ticks the box";
        }
        case "legacy_form_field":
          return `In the form field for ${q}`;
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
