/**
 * DRAFT_FIT (warnings – Blue Heart fix round 1): drafted wording that does not fit where it goes on the form. Never
 * blocking; each is acknowledged or fixed by editing (only unedited drafted text, origin "ai", is checked).
 * - "shorten" (B0-5): a short answer that goes in a table cell, or fills a blank inside the form's printed sentence ("To
 *   return to …", "…/10"), written as a dated, attributed sentence or more than 12 words – it should be the value
 *   alone ("Dog walking", "Daily", "6/10"); the citation keeps its source. Questions drafted from the notes only (an
 *   opinion keeps its attribution).
 * - "comment" (B0-23): commentary about the notes inside an answer ("The notes are written by…", "so I can only
 *   describe…") – it would be printed on the form.
 * - "repeat" (B0-16): a numbered row (Activity 2) that repeats an earlier row of the same table (Activity 1).
 * - "later note" (B0-6): on an initial assessment form, a paragraph citing a note dated after that assessment.
 *
 * Owner: ai agent.
 */
import { formatUkDate } from "../dates";
import { reportKindOf } from "../forms";
import { initialAssessmentView } from "../scope";
import type { FormField, ReportFlag } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

/** Where a short answer goes when that is a compact place: a table cell, or a blank inside a printed sentence. */
export function compactPlace(field: FormField | undefined): "cell" | "blank" | null {
  if (!field || field.answerType !== "short_text" || field.fillSource.kind !== "notes_narrative" || field.anchor.kind !== "docx") return null;
  const a = field.anchor;
  if (a.target === "table_cell") return "cell";
  if (a.target === "replace_placeholder" && !a.writeAfter && (a.placeholderText ?? "").trim().length > 0 && (a.placeholderText ?? "").trim().length <= 4) return "blank";
  return null;
}

const DATED = /\b\d{2}\/\d{2}\/\d{4}\b/;
const ATTRIBUTED = /\b(?:recorded|reported|told|noted|stated|described|assessed)\b/i;
const COMMENTARY = /\b(?:the notes (?:are|were) (?:all )?written by|(?:so )?i can only (?:describe|say|give)|the (?:record|notes) (?:does|do) not (?:set out|say|state|record)|it is not possible to (?:say|tell) from the (?:notes|record))\b/i;

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Two row answers that say the same thing: one's words all in the other's, or most of them shared. */
function repeats(a: string, b: string): boolean {
  const wa = new Set(words(a).filter((w) => w.length > 2));
  const wb = new Set(words(b).filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = Array.from(wa).filter((w) => wb.has(w)).length;
  return shared === Math.min(wa.size, wb.size) || shared / Math.max(wa.size, wb.size) >= 0.6;
}

export function validateDraftFit(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];
  const fields = new Map((input.form?.fields ?? []).map((f) => [f.id, f]));
  const ia = input.report.form && reportKindOf(input.report.form.title) === "initial" ? initialAssessmentView(input.bundle) : null;
  const noteDate = new Map(input.bundle.notes.map((n) => [n.id, n.date]));
  const firstText = new Map<string, string>();

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (p.origin !== "ai" || !hasText(p)) continue;
    const field = fields.get(section.key);
    const place = section.paragraphs[0] === p ? compactPlace(field) : null;
    if (place && (DATED.test(p.text) || ATTRIBUTED.test(p.text) || words(p.text).length > 12)) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "shorten",
          message:
            place === "cell"
              ? "Shorten for the box: this answer goes in a table cell, so it should be the value alone (for example “Dog walking”, “Daily”, “6/10”, “Lower back”) – no date and no “recorded” or “told”. Its citation keeps the source."
              : "Shorten for the box: this answer fills a blank inside the form's printed sentence, so it should be the words that complete it – no date and no “recorded” or “told”. Its citation keeps the source.",
        }),
      );
    }
    const comment = COMMENTARY.exec(p.text);
    if (comment) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "comment",
          message: `Remove the comment about the notes (“${comment[0]}…”): it would be printed on the form.`,
        }),
      );
    }
    if (ia) {
      const later = p.sourceIds.map((id) => noteDate.get(id)).filter((d): d is string => Boolean(d) && (d as string) > ia.date).sort();
      if (later.length > 0) {
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence: `later note ${later[later.length - 1]}`,
            message: `From a later note of ${formatUkDate(later[later.length - 1])} – check it belongs on an initial assessment (${formatUkDate(ia.date)}).`,
          }),
        );
      }
    }
    // Rows are compared on printed answers only (a yes/no, date or choice prints its value, not its supporting text).
    const printed = !section.answer || section.answer.kind === "text";
    if (printed && section.paragraphs[0] === p && !firstText.has(section.key)) firstText.set(section.key, p.text);
  }

  // Numbered rows of one table: "Activity 2" repeating "Activity 1" (same words before and after the number).
  const rows = new Map<string, Array<{ key: string; n: number; title: string }>>();
  for (const s of input.report.sections ?? []) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(s.title.trim());
    if (!m || !firstText.has(s.key)) continue;
    const id = `${m[1]}#${m[3]}`;
    rows.set(id, [...(rows.get(id) ?? []), { key: s.key, n: Number(m[2]), title: s.title.trim() }]);
  }
  rows.forEach((list) => {
    list.sort((a, b) => a.n - b.n);
    list.forEach((row, i) => {
      const earlier = list.slice(0, i).find((r) => repeats(firstText.get(r.key) ?? "", firstText.get(row.key) ?? ""));
      if (!earlier) return;
      const p = (input.report.sections ?? []).find((s) => s.key === row.key)?.paragraphs[0];
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: row.key,
          ...(p && { paragraphId: p.id }),
          evidence: `repeat ${earlier.key}`,
          message: `This repeats “${earlier.title}” (${earlier.key}) – give the next item the notes record, or leave it blank.`,
        }),
      );
    });
  });
  return flags;
}
