/**
 * DRAFT_FIT (warnings – Blue Heart fix round 1): drafted wording that does not fit where it goes on the form. Warnings
 * except a repeated row or sentence (fix rounds 2 and 3); each is acknowledged or fixed by editing (only unedited drafted
 * text, origin "ai", is checked).
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
 *   my assessment…", "Past medical history: that…" – would be printed as it is. Fix round 3 (B2-6, B2-8, B2-18): also a
 *   lower-case fragment after a date lead, ", and noted …" with no subject, "<noun phrase> as now …", a value restating
 *   the verb printed before its blank ("To return to returning to work"), and the patient named twice in one sentence.
 * - "repeats F-xx" (fix round 3, B2-7): a drafted sentence another box already prints – blocking beside it in its row,
 *   a warning elsewhere; the review removes it in one click.
 * Fix round 3 also: "shorten" for a date lead or an attribution only (B2-14, B2-16 – "None reported" and a date inside
 * the fact are fine; "one or two lines" has a limit of about 30 words), and a whole sentence about what the notes do not
 * hold is commentary (B2-17).
 *
 * Owner: ai agent.
 */
import { formatUkDate } from "../dates";
import { compactPlace, inPrintedSentence, reportKindOf } from "../forms";
import { initialAssessmentView } from "../scope";
import type { FormField, ReportFlag, ReportSection } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";
// Fix round 3 (B2-17): a whole sentence about what the notes do not hold ("No frequency was recorded in that note.").
import { NOTES_ABSENCE_SENTENCE } from "./opinion-language";
import { contentWords } from "./text";

// compactPlace moved to core/forms.ts (fix round 2, B1-12: the forms engine needs it too); kept here for imports.
export { compactPlace } from "../forms";

/**
 * A date lead (fix round 3, B2-14): "On 01/09/2026 …", "At the assessment on 01/09/2026 …", "01/09/2026, Priya Shah
 * recorded …" – not a date inside the fact itself ("prescribed by the GP on 03/09/2026", the date of the injury).
 */
const DATED = /^(?:On|At [^,:.]{0,40}? on) \d{2}\/\d{2}\/\d{4}\b|^\d{2}\/\d{2}\/\d{4},? [A-Z][\w'’ -]{0,40}? (?:recorded|reported|noted|told)\b/;
const ATTRIBUTED = /\b(?:recorded|reported|told|noted|stated|described|assessed)\b/i;
/** In a narrow cell (more than the value): an attribution to a clinician, not the patient's own report ("she reported that it helps"). */
const ATTRIBUTED_TO_CLINICIAN = /\b(?:recorded|noted|documented|observed|assessed)\b|\btold (?:me|him|her|them|[A-Z][a-z]+ [A-Z][a-z'’-]+)\b|\b(?:reported|stated|described) to\b|\bas (?:recorded|reported|noted|stated|described) by\b/i;
/** "None reported", "nil recorded", "not recorded" – what the guidance itself asks for (fix round 3, B2-14). */
const NOTHING_REPORTED = /\b(?:none|nil|nothing|not|no (?:\w+ ){0,3}?)(?:was |were )?(?:reported|recorded|noted|stated|described)\b/gi;
/** A recorded opinion's own short attribution (fix round 3, B2-2): "Priya Shah's assessment (01/09/2026): …". */
const OPINION_ATTRIBUTION = /^[A-Z][\w'’-]+(?: [A-Z][\w'’-]+){0,3}['’]s (?:assessment|opinion|impression|diagnosis|view)(?: \(\d{2}\/\d{2}\/\d{4}\))?:\s*/;
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

/**
 * A lead left without its sentence (fix round 2, B1-3; fix round 3, B2-6): "On 15/07/2026: that…", "On 15/07/2026: gentle
 * cervical mobilisations…" (a lower-case fragment after a date lead), "…, and noted mild travel anxiety" with no subject,
 * "the whiplash-associated disorder grade II as now largely resolved" (no verb).
 */
const FRAGMENT = /^(?:On|At [^:]{0,40} on) \d{2}\/\d{2}\/\d{4}: (?:in (?:my|the)\b|that\b|[a-z])|: that\b|\bwith \d+ did not attend\b/;
/** In one sentence: ", and noted X" whose subject went with the record-keeping frame. */
const SUBJECTLESS_AND = /,\s*and (?:also )?(?:noted|recorded|observed)\b/;
/** …unless the sentence's own subject recorded it: "Tom Ellis recorded X, and noted Y" (not "the mechanism he described, and noted"). */
const SUBJECT_BEFORE = /^(?:(?:On|At) [^,]{1,60}, )?(?:I|He|She|They|[A-Z][a-z'’-]+ [A-Z][a-z'’-]+)(?:,[^,]{1,40},)? (?:also )?(?:recorded|noted|observed|assessed|found|examined|documented)\b/;
const NO_VERB_AS_NOW = /^(?:(?!\b(?:recorded|described|assessed|graded|rated|reported|noted|documented|classed|classified|regarded)\b)[^.!?])*\bas now\b/;

/** The sentences of a paragraph (keeps their punctuation). */
const sentencesOf = (text: string) => text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [];

/** The first wording fragment in `text` (B1-3, B2-6), as the place in the text it starts, or null. */
function wordingFragment(text: string): { index: number; length: number } | null {
  const m = FRAGMENT.exec(text);
  if (m) return { index: m.index, length: m[0].length };
  let offset = 0;
  for (const sentence of sentencesOf(text)) {
    const at = text.indexOf(sentence, offset);
    offset = at + sentence.length;
    const and = SUBJECTLESS_AND.exec(sentence);
    if (and && !SUBJECT_BEFORE.test(sentence.slice(0, and.index))) return { index: at + and.index, length: and[0].length };
    const asNow = NO_VERB_AS_NOW.exec(sentence);
    if (asNow) return { index: at, length: asNow[0].length };
  }
  return null;
}

/**
 * Fix round 3 (B2-5): a text box whose printed question is a yes/no ("Is there any evidence of psychosocial factors in
 * this case?") and whose guidance asks for the details "– or “No”": it is answered "Yes – …" or "No", never with a list
 * of facts nobody called by that name.
 */
export function yesNoInWords(field: Pick<FormField, "label" | "guidance" | "answerType"> | undefined): boolean {
  if (!field || (field.answerType !== "long_text" && field.answerType !== "short_text")) return false;
  return /^(?:\(?[a-z0-9]{1,3}[.)]\s*)?(?:is|are|has|have|does|do|was|were|did|any)\b[^?]*\?/i.test(field.label.trim()) && /\bor [“"]no[”"]/i.test(field.guidance ?? "");
}

/**
 * The words the form prints just before a blank ("To return to" in “To return to … with 75% reduced difficulty”), from
 * the map's guidance that quotes the printed sentence – or null.
 */
export function printedLeadOf(field: Pick<FormField, "guidance"> | undefined): string | null {
  for (const m of Array.from((field?.guidance ?? "").matchAll(/[“"]([^”"…]+?)\s*(?:…|\.\.\.)/g))) {
    const lead = m[1].trim();
    if (/[A-Za-z]/.test(lead) && lead.split(/\s+/).length <= 6) return lead;
  }
  return null;
}

/**
 * Fix round 3 (B2-8): a value that restates the printed verb before its blank – "returning to work…" after the printed
 * "To return to" – with the restatement taken off: "work as a senior care assistant…". Later items in the same list
 * lose it too (", returning to work" → ", work"). Unchanged when it does not restate it.
 */
export function withoutPrintedVerb(text: string, lead: string | null): string {
  if (!lead || !/\breturn to$/i.test(lead)) return text;
  const t = text.trim();
  const verb = /^(?:to )?(?:return(?:ing)?|going back|getting back|coming back|get(?:ting)? back|go(?:ing)? back) to\s+/i;
  const inner = /(,\s*|\s+and\s+)(?:returning|going back|getting back|coming back) to\s+/i;
  if (!verb.test(t) && !inner.test(t)) return text;
  // A later item keeps its place in the list: "walking the dog every day, returning to work" → "… every day and work".
  return t.replace(verb, "").replace(new RegExp(inner.source, "gi"), (m: string, sep: string, offset: number, whole: string) => (/,/.test(sep) && !/,|\band\b/.test(whole.slice(offset + m.length)) ? " and " : sep));
}

/**
 * Fix round 3 (B2-16): a compact value with a trailing attribution – "6/10 at worst (2/10 at rest), as recorded by Priya
 * Shah using the Numeric Pain Rating Scale" – as the value alone ("6/10 at worst (2/10 at rest)"); the citation keeps
 * who recorded it. Unchanged when there is no such clause.
 */
export function valueOnly(text: string): string {
  const out = text.replace(/,?\s+(?:as )?(?:recorded|reported|noted|measured|assessed|documented|scored|rated)\s+(?:by|on|at)\s+[^.;]*[.;]?\s*$/i, "").trim();
  return out && out !== text.trim() ? out : text;
}

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
    // Fix round 3 (B2-2, B2-14): a recorded opinion's own short attribution ("Priya Shah's assessment (01/09/2026): …"),
    // "None reported" and a trailing "; no pain score recorded" (commentary, flagged below) are not what to shorten.
    const body = p.text.replace(OPINION_ATTRIBUTION, "").replace(TRAILING_ABSENCE, "").replace(NOTHING_REPORTED, " ");
    const attributed = (long ? ATTRIBUTED_TO_CLINICIAN : ATTRIBUTED).test(body);
    // Guidance asking for "one or two lines" still has its limit (fix round 3, B2-14): about 30 words.
    const lines = /\b(?:one or two lines|two lines|a sentence or two)\b/i.test(field?.guidance ?? "");
    const tooLong = long ? lines && words(body).length > 30 : words(body).length > 12;
    if (place && ((DATED.test(p.text) && !datesAsked) || attributed || tooLong)) {
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
              : long && lines && tooLong
                ? `Shorten for the box: the form asks for one or two lines here, and this answer runs to ${words(body).length} words in a narrow table cell. Keep the score and the main symptoms. Its citation keeps the source.`
                : long
                  ? "Shorten for the box: this answer goes in a narrow table cell – keep what the form asks for, without a date lead or “recorded” / “told”. Its citation keeps the source."
                  : "Shorten for the box: this answer goes in a table cell, so it should be the value alone (for example “Dog walking”, “Daily”, “6/10”, “Lower back”) – no date and no “recorded” or “told”. Its citation keeps the source.",
        }),
      );
    }
    // Fix round 3 (B2-8): "To return to returning to work…" – the value restates the verb printed before its blank.
    const lead = place === "blank" ? printedLeadOf(field) : null;
    if (lead && withoutPrintedVerb(p.text, lead) !== p.text.trim()) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "wording",
          message: `Check the wording: the form already prints “${lead}” before this answer, so it would read “${lead} ${excerpt(inPrintedSentence(p.text), 40)}…”. Start with the activity itself (“${excerpt(withoutPrintedVerb(p.text, lead), 40)}…”).`,
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
    const fragment = wordingFragment(p.text);
    if (fragment) {
      const from = p.text.lastIndexOf(".", fragment.index) + 1;
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "wording",
          message: `Check the wording: “${excerpt(p.text.slice(from).trim(), fragment.index - from + fragment.length + 30)}…” is not a whole sentence – it would be printed as it is.`,
        }),
      );
    }
    // Fix round 3 (B2-18): the patient named twice in one sentence where "he" or "she" belongs.
    const patient = patientName(input.bundle.registration);
    const twice = patient ? sentencesOf(p.text).find((x) => x.split(patient).length > 2) : undefined;
    if (twice && !fragment) {
      flags.push(
        makeFlag({
          code: "DRAFT_FIT",
          severity: "warning",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: "wording",
          message: `Check the wording: “${patient}” is named twice in one sentence (“${excerpt(twice, 70)}…”) – “he”, “she” or “him” / “her” may read better.`,
        }),
      );
    }
    const commentary = COMMENTARY.exec(p.text);
    const absence = commentary ? null : new RegExp(NOTES_ABSENCE_SENTENCE.source).exec(p.text);
    const trailing = commentary || absence ? null : TRAILING_ABSENCE.exec(p.text);
    const said = commentary ? `${commentary[0]}…` : absence ? absence[0].trim() : trailing ? trailing[0].replace(/^[;,–—]\s*/, "").trim() : null;
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
  const rowRepeats = new Set<string>();
  rows.forEach((list) => {
    list.sort((a, b) => a.n - b.n);
    list.forEach((row, i) => {
      const earlier = list.slice(0, i).find((r) => repeats(firstText.get(r.key) ?? "", firstText.get(row.key) ?? ""));
      if (!earlier) return;
      rowRepeats.add(row.key);
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
  // Fix round 3 (B2-7): a drafted sentence another box already prints – blocking beside it in the same row ("Pre-existing
  // conditions" and "… – comments"), a warning elsewhere on the form.
  const byParagraph = new Map<string, RepeatedSentence[]>();
  for (const r of repeatedDraftSentences(input.report.sections ?? [])) {
    if (rowRepeats.has(r.key)) continue;
    const id = `${r.paragraphId}|${r.of}`;
    byParagraph.set(id, [...(byParagraph.get(id) ?? []), r]);
  }
  byParagraph.forEach((list) => {
    const r = list[0];
    const more = list.length > 1 ? ` (and ${list.length - 1} more sentence${list.length === 2 ? "" : "s"})` : "";
    flags.push(
      makeFlag({
        code: "DRAFT_FIT",
        severity: r.withinRow ? "blocking" : "warning",
        sectionKey: r.key,
        paragraphId: r.paragraphId,
        evidence: `repeats ${r.of}`,
        message: r.withinRow
          ? `This repeats ${r.of} (“${r.ofTitle}”) beside it: “${excerpt(r.sentence, 70)}…”${more} would be printed in both. Remove the repeated sentence, or acknowledge it with a reason if both boxes need it.`
          : `This repeats what ${r.of} (“${r.ofTitle}”) says: “${excerpt(r.sentence, 70)}…”${more} would be printed twice on the form. Remove the repeated sentence unless this box needs it too.`,
      }),
    );
  });
  return flags;
}

/** The row a question belongs to: its printed label before " – " ("Activity 1 – comments" → "activity 1"). */
const rowOfLabel = (label: string) => label.split(/\s+[–—-]\s+/)[0].trim().toLowerCase();

export interface RepeatedSentence {
  key: string;
  paragraphId: string;
  sentence: string;
  /** The earlier question that already prints it. */
  of: string;
  ofTitle: string;
  /** Both questions are cells of one row ("Pre-existing conditions" / "Pre-existing conditions – comments"). */
  withinRow: boolean;
}

/**
 * Fix round 3 (B2-7): drafted sentences (unedited, printed) that share 70% or more of their content words with a sentence
 * an earlier question prints – the same assessment drafted into "History", "Findings" and "Any other observations".
 * Sentences of fewer than 3 content words ("None reported", "Daily") are not compared. In form order; pure.
 */
export function repeatedDraftSentences(sections: ReadonlyArray<Pick<ReportSection, "key" | "title" | "answer" | "paragraphs">>): RepeatedSentence[] {
  const seen: Array<{ key: string; title: string; words: Set<string> }> = [];
  const out: RepeatedSentence[] = [];
  for (const s of sections) {
    if (s.answer && s.answer.kind !== "text") continue;
    const mine: typeof seen = [];
    for (const p of s.paragraphs) {
      if (p.origin !== "ai" || !p.text.trim()) continue;
      for (const sentence of sentencesOf(p.text)) {
        const words = new Set(contentWords(sentence));
        if (words.size < 3) continue;
        mine.push({ key: s.key, title: s.title, words });
        // (The same column of two numbered rows – "Activity 1 – frequency" and "Activity 2 – frequency" – may well hold the
        // same value: those rows are compared by their name cells above.)
        const earlier = seen.find((e) => !sameColumnOfRows(e.title, s.title) && Array.from(words).filter((w) => e.words.has(w)).length / words.size >= 0.7);
        if (earlier) out.push({ key: s.key, paragraphId: p.id, sentence, of: earlier.key, ofTitle: earlier.title.trim(), withinRow: rowOfLabel(earlier.title) === rowOfLabel(s.title) });
      }
    }
    seen.push(...mine);
  }
  return out;
}

/** "Activity 1 – frequency" / "Activity 2 – frequency": one column of a table's numbered rows. */
function sameColumnOfRows(a: string, b: string): boolean {
  const col = (t: string) => t.trim().toLowerCase().replace(/\b\d{1,2}\b/g, "#");
  return /\b\d{1,2}\b/.test(a) && /\b\d{1,2}\b/.test(b) && col(a) === col(b) && a.trim() !== b.trim();
}

/** "Mr Ellery" – the patient as drafted answers name them (title and surname), or null without a title. */
function patientName(reg: { title?: string | null; lastName?: string | null }): string | null {
  const title = reg.title?.trim();
  const last = reg.lastName?.trim();
  return title && last ? `${title} ${last}` : null;
}
