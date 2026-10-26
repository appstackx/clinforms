/**
 * Does a structured answer select one of a choice field's printed options, so the FINAL fill marks it? (WA2 design 2:
 * exported for WA1 design 5 – an unknown or unmatched answer on a choice field blocks, Q-1.) true also when there is
 * nothing to match: no answer yet (placeholders.ts's job), free text, table rows, or a field that prints no options.
 *
 * bh2 W0 follow-up (seam "choice-validator", bh2-base2): created before either workstream starts, so WA1 builds on it
 * while WA2 refines it – WA1 merges first. Today's matching, as the choice validator uses it
 * (core/validation/choice-marks.ts: core/forms matchOption and yesNoOption over the printed options). WA2 owns it and
 * replaces the body with the engine's own matching.
 *
 * Pure – no server-only code: core/validation imports it, and core runs in the browser.
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json.
 */
import { matchOption, yesNoOption } from "../core/forms";
import type { FormAnswer, FormField } from "../core/types";

/** The options as printed: the map's own list, else the anchor's marked cells, kept options or tick boxes. */
function printedOptions(field: Pick<FormField, "anchor" | "options">): string[] {
  if (field.options?.length) return field.options;
  if (field.anchor.kind !== "docx") return [];
  if (field.anchor.target === "mark_cell") return (field.anchor.optionCells ?? []).map((c) => c.option);
  if (field.anchor.target === "checkbox_glyph") return (field.anchor.optionGlyphs ?? []).map((g) => g.option);
  return (field.anchor.optionTexts ?? []).map((o) => o.option);
}

export function choiceAnswerMatches(field: Pick<FormField, "anchor" | "options">, answer: FormAnswer | null | undefined): boolean {
  if (!answer || answer.kind === "text" || answer.kind === "rows" || answer.value === null) return true;
  const options = printedOptions(field);
  // Yes / No: a single printed option is ticked or not; otherwise "Yes" / "No" (or "Y" / "N") must be printed.
  if (typeof answer.value === "boolean") return options.length <= 1 || yesNoOption(options, answer.value) !== null;
  if (typeof answer.value === "string") return options.length === 0 || matchOption(options, answer.value) !== null;
  return true;
}
