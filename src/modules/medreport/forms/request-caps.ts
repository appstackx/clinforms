/**
 * Size caps for a form map that arrives in a REQUEST (WA2 design 4, R-security-2/3): at most MAX_REQUEST_FIELDS (400)
 * fields, and at most MAX_FIELDS_PER_BLOCK (20) fields with a place in any one block (paragraph or table cell – a
 * field's own block and the blocks of its printed options). Applied to request inputs only (/forms/analyse,
 * /forms/fill-preview, /forms/confirm), never to FormDefinitionSchema, so a stored map always stays readable. A refusal
 * is 422 FORM_TOO_COMPLEX with these issues.
 *
 * Fields sharing one line are legitimate (Blue Heart's 17 maps hold 30 such groups – "Name ____ Date ____", two blanks
 * of one sentence – at most 5 fields in a block), so sharing is never refused here: two answers mapped to the same place
 * – the same (blockId, target, placeholderText) with fewer places than answers – are the fill's collision outcome
 * (forms/docx-fill.ts), fatal on a FINAL copy.
 *
 * bh2 W0 follow-up (seam "form-request-caps", bh2-base2): /forms/confirm (api/handlers/forms-confirm.ts, WE's file)
 * asks it; WA2's handlers (forms-analyse.ts, forms-fill-preview.ts) ask it too.
 *
 * Pure (no server-only code).
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json.
 */
import type { ProblemIssue } from "../api/contract";
import type { FormDefinition, FormField } from "../core/types";

export const MAX_REQUEST_FIELDS = 400;
export const MAX_FIELDS_PER_BLOCK = 20;

/** The Word blocks a field has a place in: its own, and those of its printed options (each once). */
function blocksOf(field: FormField): string[] {
  const a = field.anchor;
  if (a.kind !== "docx") return [];
  const ids = new Set<string>([a.blockId]);
  for (const c of a.optionCells ?? []) ids.add(c.blockId);
  for (const g of a.optionGlyphs ?? []) ids.add(g.blockId);
  for (const o of a.optionTexts ?? []) ids.add(o.blockId);
  return Array.from(ids);
}

export function formRequestCapIssues(form: Pick<FormDefinition, "fields">): ProblemIssue[] {
  const issues: ProblemIssue[] = [];
  if (form.fields.length > MAX_REQUEST_FIELDS) {
    issues.push({ path: "form.fields", message: `This form map has ${form.fields.length} questions; a form can have at most ${MAX_REQUEST_FIELDS}.` });
  }
  const perBlock = new Map<string, number>();
  for (const field of form.fields) for (const id of blocksOf(field)) perBlock.set(id, (perBlock.get(id) ?? 0) + 1);
  for (const [blockId, n] of Array.from(perBlock.entries())) {
    if (n <= MAX_FIELDS_PER_BLOCK) continue;
    issues.push({ path: "form.fields", message: `${n} questions have their place in the same part of the form (${blockId}); at most ${MAX_FIELDS_PER_BLOCK} can share one.` });
    if (issues.length >= 10) break;
  }
  return issues;
}
