/**
 * Drafting assembly – when code may enter a drafted structured answer (bh2 WD design 4; C-2, R-safety-7, B3-15).
 *
 * The model proposes an answer ("Yes", "0-3 months", "Grade 2", "Some difficulty"); code enters it only when the record
 * says it, and never when the answer is the clinician's judgement:
 * - an opinion box (fill source clinician_opinion): code never enters its structured answer (bh2 WD review M6; Khuram's
 *   decision on opinions: an opinion is a physio's note quoted, or the approver's own). The drafting's label "recorded
 *   opinion" (basis clinician_opinion_recorded) is the model's own word, not a quote – so a drafted "Yes" to
 *   "Restriction on driving?" is held back with the cited note's own words ("Tom Ellis recorded: “…” (06/05/2026)"),
 *   for the approver to answer; with no recorded basis the gap says no cited note records it ("She lifts boxes at work"
 *   never ticks "Restriction: no heavy lifting"). A held-back opinion answer is never offered as a one-click tick (C-2).
 * - a grade or severity scale (core/forms/answer-shape.ts isGradeScale): never ticked by code, never offered as a
 *   one-click tick – the clinician grades.
 * - a printed duration band on an opinion box ("0-3 months"): never ticked, never offered (R-safety-7). When a cited
 *   clinician note anchors an expectation (WB's findAnchor), the band arithmetic is shown in the gap as information
 *   only: "Sarah Reid recorded “should settle within 4–6 weeks” (16/09/2026), which is within the printed “0-3
 *   months”" (B2-10, B3-10 (c)). The duration is read from the anchored note sentence only – never from the gap, the
 *   option or a drafted paragraph.
 * - any other choice: only when one sentence of a cited note holds the whole option phrase as a fact – not negated,
 *   not a plan, a wish, a question or an earlier episode ("Some difficulty" is never ticked against "… no difficulty
 *   sleeping …", B3-15; "Acupuncture" never from the Plan's "Acupuncture at the next appointment."). Otherwise it is
 *   held back: when the note says otherwise or only plans it, the gap quotes it and offers no one-click (bh2 WD harden
 *   minor 2); when no note mentions it, on a box that is neither an opinion nor the physiotherapist's choice the
 *   person may tick it in one click (ledger hook "tick-suggested").
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

const NEGATOR = /\b(?:no|not|never|nil|none|without|denie[sd]|den(?:y|ies)|free of|absence of|ruled out|isn't|wasn't|doesn't|didn't|hasn't|hadn't|aren't|weren't|cannot|can't|unable|declin(?:ed|es|ing)|refus(?:ed|es|ing)|stopp(?:ed|ing)|discontinued|unsuitable|contraindicated|avoid(?:ed|s|ing)?|yet)\b/i;
/** Words that make a statement a plan, a hope, an advice or a condition rather than a fact. */
const NOT_ASSERTED = /\b(?:to be|plan(?:s|ned|ning)?|consider(?:s|ed|ing)?|if|unless|hope(?:s|d)?|hoping|aim(?:s|ed|ing)?|goal|would|could|may|might|should|will|shall|going to|intend(?:s|ed)?|expect(?:s|ed)?|recommend(?:s|ed|ation)?|advis(?:e|es|ed)|suggest(?:s|ed)?|propos(?:e|es|ed)|discuss(?:ed|ion)?|offer(?:s|ed)?|referr?(?:al|ed)? for|await(?:s|ed|ing)?|pending|possible|possibly|trial of|next session|in future|later|next|keen|eager|wants?|wanted|wish(?:es|ed)?|would like|interested|enquir\w*|asked|ask(?:s|ing)?|quer(?:y|ied|ies)|book(?:ed|ing)?|schedul\w*|arrang(?:e|ed|ing)|request(?:s|ed|ing)?|explained|consent\w*|options?|tb[ca]|to follow|to start|prn|as needed|as required|maybe|perhaps|potential(?:ly)?|likely|unlikely|probabl[ey])\b/i;
/**
 * Words that put a statement before this episode (bh2 WD harden N3): "Had manual therapy for neck pain in 2019",
 * "previous episode", "history of …", "years ago", "before the accident".
 */
const BEFORE_EPISODE =
  /\b(?:previous(?:ly)?(?!\s+(?:session|appointment|visit|review|week|day|note|treatment)s?\b)|prior to (?:the )?(?:accident|injury|incident|this)|in the past|years? ago|last year|history of|h\/o|past episode|episode of|before the (?:accident|injury|incident)|pre-?(?:injury|accident|incident))\b/i;
/** A note's field line ("Plan: …", "P: …", "PMH: …") and what kind of field it is. */
const FIELD_LINE = /^\s*(Subjective|Objective|Assessment|Plan|Other|Past medical history|Social history|S|O|A|P|PMH|SH)\s*[:\-–]/i;
const PLAN_FIELD = /^(?:plan|p)$/i;
const PAST_FIELD = /^(?:past medical history|pmh)$/i;
/** A year on its own ("in 2019"), not part of a full date ("18/03/2026"). */
const BARE_YEAR = /(?<![\d/.-])((?:19|20)\d{2})(?![\d/])/g;
/** The full dates of a source (dd/mm/yyyy) – a note's own header carries its date. */
const FULL_DATE = /\b\d{1,2}\/\d{1,2}\/((?:19|20)\d{2})\b/g;
/** Where one clause of a sentence ends and another begins (a negation in one clause is not about the other). */
const CLAUSE_BREAK = /;|\s+(?:but|however|whereas|although|though)\b/i;

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

/** What a cited source says about an option: it states it, it says otherwise, or it only plans, queries or recalls it. */
export interface OptionEvidence {
  kind: "stated" | "negated" | "not_asserted";
  /** The note sentence, as written. */
  sentence: string;
}

/**
 * The sentence of a cited note that states the whole option (B3-15): the words of the option in their order in ONE
 * sentence, with at most two linking words between them – "fit for a phased return" states "Fit with a phased return",
 * "some stiffness … no difficulty" never states "Some difficulty" – and stated as a fact: no negation anywhere in the
 * clause that holds it ("Manual therapy was not used", "Full duties are not yet possible", "Exercise was declined"), and
 * nothing that makes it a plan, a hope, a wish, a question or a condition ("Acupuncture to be considered if no
 * progress", "hopes to return to full duties", "would benefit from manual therapy", "Keen to try acupuncture",
 * "?Acupuncture", "Acupuncture at the next appointment" – bh2 WD review M5, harden N3). A sentence of a note's Plan
 * field is a plan, whatever its words ("Acupuncture at the next appointment."); a sentence of its past medical history,
 * or one placed before this episode ("Had manual therapy for neck pain in 2019", "previous episode", "years ago"), is
 * not this episode's (harden N3). A negation or modal word the option itself holds ("Not fit") is part of the phrase.
 * The clause is the sentence up to a ";", "but", "however", "whereas" or "although". Never a word found somewhere else
 * in the notes.
 *
 * Returns the stating sentence; else the first sentence that says otherwise (`negated`) or only plans, queries or
 * recalls it (`not_asserted`) – for the gap's wording; else null.
 */
export function optionEvidence(option: string, notes: readonly string[]): OptionEvidence | null {
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
  const optionText = ` ${normalise(option)} `;
  const withoutOption = (clause: string): string => {
    let rest = ` ${normalise(clause)} `;
    for (const w of words) rest = rest.replace(new RegExp(` ${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w* `), " ");
    return rest;
  };
  /** A clause, without the option's own words, says the option is negated. */
  const negated = (clause: string): boolean => {
    const m = NEGATOR.exec(withoutOption(clause));
    return Boolean(m && !(optionNegated && optionText.includes(` ${m[0].toLowerCase()} `)));
  };
  /** A clause, without the option's own words, says the option is not a fact (a plan, a wish, a question, the past). */
  const notAsserted = (clause: string): boolean => {
    if (clause.includes("?")) return true;
    const m = NOT_ASSERTED.exec(withoutOption(clause));
    if (m && !optionText.includes(` ${m[0].toLowerCase()} `)) return true;
    return BEFORE_EPISODE.test(clause);
  };
  let fallback: OptionEvidence | null = null;
  for (const text of notes) {
    // The episode's first year: the earliest full date the source gives (a note's header carries its date).
    const years = Array.from(text.matchAll(FULL_DATE), (m) => Number(m[1]));
    const episodeYear = years.length ? Math.min(...years) : null;
    // The field each line belongs to ("Plan: …" and the lines after it, until the next field).
    const fieldAt: Array<{ start: number; field: string }> = [];
    let offset = 0;
    for (const line of text.split("\n")) {
      const m = FIELD_LINE.exec(line);
      if (m) fieldAt.push({ start: offset, field: m[1] });
      offset += line.length + 1;
    }
    const fieldOf = (at: number) => fieldAt.filter((f) => f.start <= at).pop()?.field ?? "";
    for (const s of splitSentences(text, "notes")) {
      const field = fieldOf(s.start);
      // The sentence without its field's label ("Plan: Manual therapy was not used." → "Manual therapy was not used."):
      // the label says which field it is in, never what the sentence says.
      const body = s.text.replace(FIELD_LINE, "").trim();
      const outOfEpisode = PAST_FIELD.test(field) || Array.from(body.matchAll(BARE_YEAR), (m) => Number(m[1])).some((y) => episodeYear === null || y < episodeYear);
      for (const clause of body.split(CLAUSE_BREAK)) {
        const tokens = normalise(clause).split(" ");
        for (let i = 0; i < tokens.length; i++) {
          if (!phraseAt(tokens, i)) continue;
          // A plan's own words first ("to be considered if no progress" is a plan, not a negation), then a negation,
          // then the field or the time it is in ("Plan: Manual therapy was not used." says otherwise).
          if (notAsserted(clause)) fallback ??= { kind: "not_asserted", sentence: body };
          else if (negated(clause)) fallback ??= { kind: "negated", sentence: body };
          else if (PLAN_FIELD.test(field) || outOfEpisode) fallback ??= { kind: "not_asserted", sentence: body };
          else return { kind: "stated", sentence: body };
          break;
        }
      }
    }
  }
  return fallback;
}

/** The sentence of a cited note that states the whole option as a fact (optionEvidence), or null. */
export function optionStatedIn(option: string, notes: readonly string[]): string | null {
  const e = optionEvidence(option, notes);
  return e?.kind === "stated" ? e.sentence : null;
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

  const opinion = field.fillSource.kind === "clinician_opinion";
  if (opinion) {
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
  if (field.answerType !== "single_choice") return opinion ? opinionHeldBack(input, which) : { enter: true };

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
  // An opinion box's answer is the approver's, whatever the notes say: held back with the cited note's own words (C-2;
  // harden minor 3 – never "not stated … without a negation" when the note states it with a qualifier).
  if (opinion) return opinionHeldBack(input, which);
  const evidence = optionEvidence(value, input.citedTexts);
  if (evidence?.kind === "stated") return { enter: true };
  if (evidence) {
    // The note says otherwise, or only plans, queries or recalls it (harden minor 2): said so, and never one click.
    const cut = (t: string) => (t.length > 200 ? `${t.slice(0, 199).trimEnd()}…` : t);
    return {
      enter: false,
      gap: {
        kind: "choice_held_back",
        issue:
          evidence.kind === "negated"
            ? `The suggested answer “${value}” has not been ticked: the cited notes say otherwise – “${cut(evidence.sentence)}”.`
            : `The suggested answer “${value}” has not been ticked: the cited notes give it only as a plan, a question, a wish or from before this episode – “${cut(evidence.sentence)}”.`,
        suggestedQuestion: `${which} Check the notes and choose it yourself, or leave it blank.`,
      },
    };
  }
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

/** Words that say nothing about what a sentence is about (for matching a drafted sentence to a note's). */
const COMMON = new Set(
  ("that this with from were was have has had been will would should could recorded noted reported said told stated their there they them his her him she he the and for not into over after before about which when what " +
    "week weeks days months years hours times daily since until opinion").split(" "),
);

/** The sentence of a cited note that shares the most words with the drafted support (at least two), with its note. */
export function noteWordsFor(paragraphs: readonly Paragraph[], notes: readonly Note[]): { note: Note; sentence: string } | null {
  const wordsOf = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !COMMON.has(w)));
  const drafted = wordsOf(paragraphs.map((p) => p.text).join(" "));
  let best: { note: Note; sentence: string; score: number } | null = null;
  for (const n of notes) {
    const text = [n.subjective, n.objective, n.assessment, n.plan, n.freeText ?? ""].filter(Boolean).join("\n");
    for (const s of splitSentences(text, "notes")) {
      const score = Array.from(wordsOf(s.text)).filter((w) => drafted.has(w)).length;
      if (score >= 2 && (!best || score > best.score)) best = { note: n, sentence: s.text.trim(), score };
    }
  }
  return best ? { note: best.note, sentence: best.sentence } : null;
}

/**
 * An opinion box's drafted answer, held back with the cited note's own words (bh2 WD review M6): the approver answers
 * it; code never ticks an opinion, and it is never a one-click (C-2).
 */
function opinionHeldBack(input: AnswerInput, which: string): AnswerDecision {
  const found = noteWordsFor(input.paragraphs, input.citedNotes);
  const cut = (t: string) => (t.length > 200 ? `${t.slice(0, 199).trimEnd()}…` : t);
  const words = found
    ? ` ${found.note.author.name} recorded: “${cut(found.sentence)}” (${formatUkDate(found.note.date)}).`
    : ` No sentence of the cited ${input.citedNotes.length === 1 ? "note" : "notes"} (${input.citedNotes.map((n) => `${n.author.name}, ${formatUkDate(n.date)}`).join("; ")}) says it in so many words.`;
  return {
    enter: false,
    gap: {
      kind: "choice_held_back",
      issue: `The drafted answer “${input.value}” to “${input.label}” has not been entered: it is the clinician's opinion, which only the approving clinician gives.${words}`,
      suggestedQuestion: `${which} Check the note and answer it yourself, or leave it blank.`,
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
