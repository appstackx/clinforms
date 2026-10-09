/**
 * Pure helpers for the mapping editor: plain-English anchor descriptions, new fields, applying a
 * location picked in the preview, and the option lists for the selects.
 *
 * Owner: studio-a agent.
 */
import { parseBlockId } from "../../../core/forms";
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
    case "pdf_field":
      return `PDF field “${anchor.fieldName}” (${anchor.fieldType})`;
    case "pdf_overlay":
      return `Page ${anchor.page}, box at ${Math.round(anchor.x)}, ${Math.round(anchor.y)} (${Math.round(anchor.width)} × ${Math.round(anchor.height)} pt)`;
  }
}

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
      switch (a.fieldType) {
        case "checkbox":
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

/** A fill source of the given kind, keeping compatible details from the current one. */
export function fillSourceOfKind(kind: FillSource["kind"], current: FillSource): FillSource {
  if (kind === current.kind) return current;
  switch (kind) {
    case "registration":
      return { kind, path: "patient.fullName" satisfies RegistrationPath };
    case "computed_fact":
      return { kind, factId: "FACT-attendance", format: "summary" satisfies ComputedFactFormat };
    case "signoff":
      return { kind, part: "signature" satisfies SignoffPart };
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
