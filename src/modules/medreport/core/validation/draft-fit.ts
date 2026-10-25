/**
 * DRAFT_FIT (warnings – Blue Heart fix round 1): drafted wording that does not fit where it goes on the form. Never
 * blocking; each is acknowledged or fixed by editing (only unedited drafted text, origin "ai", is checked).
 * - "shorten" (B0-5): a short answer that goes in a table cell, or fills a blank inside the form's printed sentence ("To
 *   return to …", "…/10"), written as a dated, attributed sentence or more than 12 words – it should be the value
 *   alone ("Dog walking", "Daily", "6/10"); the citation keeps its source. Questions drafted from the notes only (an
 *   opinion keeps its attribution).
 * - "comment" (B0-23): commentary about the notes inside an answer ("The notes are written by…", "so I can only
 *   describe…") – it would be printed on the form.
 * - "repeat" (B0-16; fix round 2, B1-4): a numbered row whose name cell ("Activity 2") repeats an earlier row's name
 *   ("Activity 1") – the same item drafted twice. Rows are compared by their name cell only: two rows may well share a
 *   frequency or a status ("Stopped since the accident"). Blocking, acknowledged with a reason.
 * - "later note" (B0-6): on an initial assessment form, a paragraph citing a note dated after that assessment.
 * - "earlier note" (fix round 2, B1-6): on a discharge or progress form, a bare measure (a score or percentage in a
 *   compact place, no date) citing only notes older than the latest one – "Overall improvement 60%" from a month before
 *   discharge.
 * - "wording" (fix round 2, B1-3): a fragment the first-person rewrite left – "On 15/07/2026: that…", "On 15/07/2026: in
 *   my assessment…", "Past medical history: that…" – would be printed as it is.
 *
 * Owner: ai agent.
 */
import { formatUkDate } from "../dates";
import { compactPlace, reportKindOf } from "../forms";
import { initialAssessmentView } from "../scope";
import type { FormField, ReportFlag } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

// compactPlace moved to core/forms.ts (fix round 2, B1-12: the forms engine needs it too); kept here for imports.
export { compactPlace } from "../forms";

const DATED = /\b\d{2}\/\d{2}\/\d{4}\b/;
const ATTRIBUTED = /\b(?:recorded|reported|told|noted|stated|described|assessed)\b/i;
const COMMENTARY = /\b(?:the notes (?:are|were) (?:all )?written by|(?:so )?i can only (?:describe|say|give)|the (?:record|notes) (?:does|do) not (?:set out|say|state|record)|it is not possible to (?:say|tell) from the (?:notes|record))\b/i;
/** Fix round 2 (B1-13): a trailing "; no pain score recorded for the headaches" – what the notes lack is the gap's to say. */
const TRAILING_ABSENCE = /[;,–—]\s*(?:but |and |with )?(?:no|not) (?:[\w/-]+ ){0,6}?(?:was |were |is |are |has been |have been )?(?:recorded|documented|stated)\b(?: (?:for|in|at|about|on) [^.;]*)?\s*(?=[.;]|$)/i;

/** Guidance that asks for more than the value alone (fix round 2, B1-12). */
const MORE_THAN_THE_VALUE = /\b(?:one or two lines|two lines|a sentence or two|and the symptoms|with (?:the )?(?:reason|details|symptoms))\b/i;

/** "discharge" for a discharge or final report, "progress" for an interim or progress report, else null. */
export function currentStateForm(title: string): "discharge" | "progress" | null {
  if (reportKindOf(title) === "discharge") return "discharge";
  return /\b(?:interim|progress|review)\b/i.test(title) ? "progress" : null;
}

/** A lead left without its sentence (fix round 2, B1-3). */
const FRAGMENT = /^On \d{2}\/\d{2}\/\d{4}: (?:in (?:my|the)|that)\b|: that\b|\bwith \d+ did not attend\b/;

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The first `n` characters of `text`, ending at a whole word. */
const excerpt = (text: string, n: number) => (text.length <= n ? text : text.slice(0, n).replace(/\s+\S*$/, "")).replace(/[\s.,;:]+$/, "");

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

  const formFields = input.form?.fields ?? [];
  // Fix round 2 (B1-6): on a discharge or progress form a bare value states the patient's position now.
  const current = input.report.form ? currentStateForm(input.report.form.title) : null;
  const latestNote = input.bundle.notes.map((n) => n.date).sort().pop() ?? null;

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (p.origin !== "ai" || !hasText(p)) continue;
    const field = fields.get(section.key);
    const place = section.paragraphs[0] === p ? compactPlace(field, formFields) : null;
    // Fix round 2 (B1-12): the guidance may ask for more than the value ("the pain score and the symptoms, in one or
    // two lines") or for dates; a long answer in a narrow column is only kept free of the date lead and attribution.
    const more = MORE_THAN_THE_VALUE.test(field?.guidance ?? "");
    const datesAsked = /\bdates?\b/i.test(`${field?.label ?? ""} ${field?.guidance ?? ""}`);
    const long = place === "narrow" || more;
    // (A trailing "; no pain score recorded" is commentary – flagged below – not an attribution to shorten.)
    const attributed = ATTRIBUTED.test(p.text.replace(TRAILING_ABSENCE, ""));
    if (place && ((DATED.test(p.text) && !datesAsked) || attributed || (!long && words(p.text).length > 12))) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "shorten",
          message:
            place === "blank"
              ? "Shorten for the box: this answer fills a blank inside the form's printed sentence, so it should be the words that complete it – no date and no “recorded” or “told”. Its citation keeps the source."
              : long
                ? "Shorten for the box: this answer goes in a narrow table cell – keep what the form asks for, without a date lead or “recorded” / “told”. Its citation keeps the source."
                : "Shorten for the box: this answer goes in a table cell, so it should be the value alone (for example “Dog walking”, “Daily”, “6/10”, “Lower back”) – no date and no “recorded” or “told”. Its citation keeps the source.",
        }),
      );
    }
    // Fix round 2 (B1-6): a bare value from an earlier note is printed as the patient's position now.
    const cited = p.sourceIds.map((id) => noteDate.get(id)).filter((d): d is string => Boolean(d)).sort();
    // A measure (a score, a percentage) – an area or an activity named at the assessment is still that area.
    const measure = /\d/.test(p.text) && words(p.text).length <= 6;
    if (current && latestNote && (place === "cell" || place === "blank") && measure && !DATED.test(p.text) && cited.length > 0 && cited[cited.length - 1] < latestNote) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: `earlier note ${cited[cited.length - 1]}`,
          message: `From an earlier note (${formatUkDate(cited[cited.length - 1])}) – check it is still right ${current === "discharge" ? "at discharge" : "now"}: the latest note is of ${formatUkDate(latestNote)}.`,
        }),
      );
    }
    const fragment = FRAGMENT.exec(p.text);
    if (fragment) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "wording",
          message: `Check the wording: “${excerpt(p.text, fragment.index + fragment[0].length + 30)}…” is not a whole sentence – it would be printed as it is.`,
        }),
      );
    }
    const lead = COMMENTARY.exec(p.text);
    const trailing = lead ? null : TRAILING_ABSENCE.exec(p.text);
    const said = lead ? `${lead[0]}…` : trailing ? trailing[0].replace(/^[;,–—]\s*/, "").trim() : null;
    if (said) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "comment",
          message: `Remove the comment about the notes (“${said}”): it would be printed on the form.`,
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

  // Numbered rows of one table: "Activity 2" repeating "Activity 1" – the name cells (nothing after the number) only.
  const rows = new Map<string, Array<{ key: string; n: number; title: string }>>();
  for (const s of input.report.sections ?? []) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(s.title.trim());
    if (!m || m[3].trim() !== "" || !firstText.has(s.key)) continue;
    const id = m[1];
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
          severity: "blocking",
          sectionKey: row.key,
          ...(p && { paragraphId: p.id }),
          evidence: `repeat ${earlier.key}`,
          message: `This repeats “${earlier.title}” (${earlier.key}) – the same item would be printed twice. Give the next item the notes record, or leave this row blank; acknowledge it with a reason if both rows are right.`,
        }),
      );
    });
  });
  return flags;
}
