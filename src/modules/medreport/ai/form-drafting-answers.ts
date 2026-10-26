/**
 * Drafting assembly – when code may enter a drafted structured answer (bh2 WD design 4; C-2, R-safety-7, B3-15).
 *
 * The model proposes an answer ("Yes", "0-3 months", "Grade 2", "Some difficulty"); code enters it only when the record
 * says it, and never when the answer is the clinician's judgement:
 * - an opinion box (fill source clinician_opinion): only an answer whose supporting paragraph attributes an opinion a
 *   clinician recorded (basis clinician_opinion_recorded) in a cited note – "She lifts boxes at work" never ticks
 *   "Restriction: no heavy lifting". A held-back opinion answer is never offered as a one-click tick (C-2).
 * - a grade or severity scale (core/forms/answer-shape.ts isGradeScale): never ticked by code, never offered as a
 *   one-click tick – the clinician grades.
 * - a printed duration band on an opinion box ("0-3 months"): never ticked, never offered (R-safety-7). When a cited
 *   clinician note anchors an expectation (WB's findAnchor), the band arithmetic is shown in the gap as information
 *   only: "Sarah Reid recorded “should settle within 4–6 weeks” (16/09/2026), which is within the printed “0-3
 *   months”" (B2-10, B3-10 (c)). The duration is read from the anchored note sentence only – never from the gap, the
 *   option or a drafted paragraph.
 * - any other choice: only when one sentence of a cited note holds the whole option phrase, not negated ("Some
 *   difficulty" is never ticked against "… no difficulty sleeping …", B3-15). Otherwise it is held back; on a box that
 *   is neither an opinion nor the physiotherapist's choice the person may tick it in one click (ledger hook
 *   "tick-suggested").
 *
 * Every gap carries Gap.kind (core/schemas.ts GapKindSchema), from which the review words "Needs clinician input".
 *
 * Pure; browser and server.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { formatUkDate } from "../core/dates";
import { bandContaining, isDurationBandList, quotedDuration } from "../core/duration-bands";
import { isGradeScale } from "../core/forms/answer-shape";
import { recordSourceOf } from "../core/forms";
import { splitSentences } from "../core/text/sentences";
import type { FormField, Gap, Note, Paragraph } from "../core/types";
import { findAnchor } from "../core/validation/attribution-anchor";
import { defineHook, hookEnabled } from "../core/validation/hooks";

/** Ledger hook "tick-suggested" (one-click): a held-back choice offered as one click on a box a person may tick. */
export const TICK_SUGGESTED_HOOK = defineHook("tick-suggested");

export type GapKind = NonNullable<Gap["kind"]>;

/** A box only a clinician decides: an opinion, or the physiotherapist's own choice on each report. */
export function isClinicianBox(field: Pick<FormField, "fillSource" | "guidance">): boolean {
  return field.fillSource.kind === "clinician_opinion" || recordSourceOf(field) === "physio_choice";
}

const NEGATOR = /\b(?:no|not|never|nil|none|without|denie[sd]|den(?:y|ies)|free of|absence of|ruled out|isn't|wasn't|doesn't|didn't|hasn't|hadn't)\b/i;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9%/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words of an option that carry no meaning of their own ("Fit WITH A phased return"). */
const LINKING = new Set(["a", "an", "the", "with", "for", "of", "to", "in", "on", "at", "and", "or", "as", "by", "from", "is", "are", "be", "was", "were"]);

/** The words an option is made of, linking words aside ("Fit with a phased return" → fit, phased, return). */
export function optionWords(option: string): string[] {
  return normalise(option)
    .split(" ")
    .filter((w) => w && !LINKING.has(w));
}

/**
 * The sentence of a cited note that states the whole option (B3-15): the words of the option in their order in ONE
 * sentence, with at most two linking words between them – "fit for a phased return" states "Fit with a phased return",
 * "some stiffness … no difficulty" never states "Some difficulty" – and no negation before it in that sentence (a
 * negation the option itself holds, as in "Not fit", is part of the phrase). Never a word found somewhere else in the
 * notes. Null when none does.
 */
export function optionStatedIn(option: string, notes: readonly string[]): string | null {
  const words = optionWords(option);
  if (words.length === 0) return null;
  const optionNegated = words.some((w) => NEGATOR.test(w));
  const same = (t: string, w: string) => t === w || (w.length >= 5 && t.startsWith(w.slice(0, w.length - 1)));
  /** The phrase starting at token i: its words in order, with at most two linking words between them. */
  const phraseAt = (tokens: readonly string[], i: number): boolean => {
    if (!same(tokens[i], words[0])) return false;
    let j = i;
    for (const w of words.slice(1)) {
      let k = j + 1;
      let skipped = 0;
      while (k < tokens.length && LINKING.has(tokens[k]) && !same(tokens[k], w) && skipped < 2) {
        k++;
        skipped++;
      }
      if (k >= tokens.length || !same(tokens[k], w)) return false;
      j = k;
    }
    return true;
  };
  for (const text of notes) {
    for (const s of splitSentences(text, "notes")) {
      const tokens = normalise(s.text).split(" ");
      for (let i = 0; i < tokens.length; i++) {
        if (!phraseAt(tokens, i)) continue;
        if (!optionNegated && NEGATOR.test(tokens.slice(0, i).join(" "))) continue;
        return s.text;
      }
    }
  }
  return null;
}

/** The option's words no cited source uses at all (for the gap's wording). */
export function optionWordsMissing(option: string, notes: readonly string[]): string[] {
  const all = ` ${normalise(notes.join(" "))} `;
  return optionWords(option).filter((w) => !all.includes(` ${w}`));
}

export interface AnswerDecision {
  /** Enter the drafted answer (true), or hold it back for a person (false). */
  enter: boolean;
  /** The gap that holds it back. */
  gap?: Pick<Gap, "issue" | "suggestedQuestion" | "kind" | "suggestedAnswer">;
}

export interface AnswerInput {
  field: FormField;
  /** The question's printed label (short title). */
  label: string;
  /** The parsed answer value as text ("Yes", "0-3 months"). */
  value: string;
  /** The drafted supporting paragraphs (after assembly's wording steps). */
  paragraphs: readonly Paragraph[];
  /** The cited notes (bundle notes the paragraphs cite). */
  citedNotes: readonly Note[];
  /** The text of every cited source (notes, REG, facts) as the validators see it. */
  citedTexts: readonly string[];
}

/** The band information for a held-back band (information only – never a suggested answer), or "". */
function bandInformation(input: AnswerInput): string {
  if (!isDurationBandList(input.field.options)) return "";
  for (const p of input.paragraphs) {
    for (const s of splitSentences(p.text)) {
      const anchor = findAnchor({ phrase: s.text, sentence: s.text, notes: input.citedNotes });
      if (!anchor) continue;
      const duration = quotedDuration(anchor.sentence);
      const band = duration ? bandContaining(duration, input.field.options ?? []) : null;
      if (!band) continue;
      const note = input.citedNotes.find((n) => n.id === anchor.noteId);
      const date = note ? ` (${formatUkDate(note.date)})` : "";
      return ` ${anchor.author.name} recorded “${anchor.sentence.trim()}”${date}, which is within the printed “${band}” – the band is the clinician's to choose.`;
    }
  }
  return "";
}

/**
 * Whether code enters a drafted structured answer (see the header), and the gap when it does not. Runs after the
 * answer parsed and has a cited supporting paragraph.
 */
export function decideStructuredAnswer(input: AnswerInput): AnswerDecision {
  const { field, label, value } = input;
  const clinician = isClinicianBox(field);
  const options = field.options?.length ? ` (${field.options.join(" / ")})` : "";
  const which = `Which answer should be given to “${label}”${options}?`;

  if (field.fillSource.kind === "clinician_opinion") {
    const recorded = input.paragraphs.some((p) => p.basis === "clinician_opinion_recorded" && p.sourceIds.some((id) => input.citedNotes.some((n) => n.id === id)));
    if (!recorded) {
      return {
        enter: false,
        gap: {
          kind: "no_opinion_recorded",
          issue: `The drafted answer “${value}” to “${label}” has not been entered: no cited note records it as a clinician's opinion.`,
          suggestedQuestion: `${which} It is your clinical opinion – answer it, or leave it blank.`,
        },
      };
    }
  }
  if (field.answerType !== "single_choice") return { enter: true };

  if (isGradeScale(field)) {
    return {
      enter: false,
      gap: {
        kind: "band",
        issue: `“${value}” is a grade on a printed scale, which only the clinician chooses – it has not been ticked.`,
        suggestedQuestion: which,
      },
    };
  }
  if (clinician && isDurationBandList(field.options)) {
    return {
      enter: false,
      gap: {
        kind: "band",
        issue: `The printed time band for “${label}” is the clinician's opinion, so “${value}” has not been ticked.${bandInformation(input)}`,
        suggestedQuestion: which,
      },
    };
  }
  const stated = optionStatedIn(value, input.citedTexts);
  if (stated) return { enter: true };
  // A held-back choice: offered as one click only on a box a person may tick (C-2), while the hook is enabled.
  const oneClick = !clinician && hookEnabled(TICK_SUGGESTED_HOOK);
  return {
    enter: false,
    gap: {
      kind: "choice_held_back",
      issue: `The suggested answer “${value}” is not stated in the cited notes (${missingWording(optionWordsMissing(value, input.citedTexts))}), so it has not been ticked.`,
      suggestedQuestion: oneClick ? `Is “${value}” the right answer to “${label}”? Tick it in one click if it is, or choose another${options}.` : which,
      ...(oneClick ? { suggestedAnswer: value } : {}),
    },
  };
}

function missingWording(missing: readonly string[]): string {
  if (missing.length === 0) return "no sentence of them says it, without a negation";
  const list = missing.map((w) => `“${w}”`);
  return `they do not use the word${missing.length === 1 ? "" : "s"} ${list.length === 2 ? list.join(" and ") : list.join(", ")}`;
}

/** "No … recorded", "does not record …": a gap that says nobody recorded the opinion. */
const NOTHING_RECORDED = /\b(?:no|not|none|nothing|never)\b[^.]*\b(?:record(?:ed|s)?|opinion|stat(?:e|ed|es)|documented)\b|\bdo(?:es)?(?:n't| not) (?:record|state|give|say)\b/i;

/** The kind of a gap the drafting raised, from the box it is on and what it says. */
export function draftedGapKind(field: Pick<FormField, "fillSource" | "guidance" | "options"> | undefined, issue: string, relatedNoteIds: readonly string[]): GapKind {
  if (!field) return "record_value";
  if (field.fillSource.kind === "clinician_opinion") {
    return (field.options?.length ?? 0) > 0 && relatedNoteIds.length > 0 && !NOTHING_RECORDED.test(issue) ? "opinion_not_fitting_options" : "no_opinion_recorded";
  }
  const source = recordSourceOf(field as FormField);
  if (source === "staff_entry") return "staff_entry";
  return "record_value";
}
