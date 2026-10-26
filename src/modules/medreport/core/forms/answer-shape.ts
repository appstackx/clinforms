/**
 * Referrer forms – answer shape: where a short answer drafted from the notes goes when that is a compact place (a table
 * cell, or a blank inside the form's printed sentence).
 *
 * Pure: no React, no Node built-ins, no env. Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split, pure
 * move; draft-fit.ts re-exports compactPlace).
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import type { FormField } from "../types";

/** Where a short answer goes when that is a compact place: a table cell, or a blank inside a printed sentence. */
export function compactPlace(field: FormField | undefined): "cell" | "blank" | null {
  if (!field || field.answerType !== "short_text" || field.fillSource.kind !== "notes_narrative" || field.anchor.kind !== "docx") return null;
  const a = field.anchor;
  if (a.target === "table_cell") return "cell";
  if (a.target === "replace_placeholder" && !a.writeAfter && (a.placeholderText ?? "").trim().length > 0 && (a.placeholderText ?? "").trim().length <= 4) return "blank";
  return null;
}
