/**
 * OPINION_LANGUAGE: wording that forms or firms up an opinion – recovery, permanence, causation, "balance of
 * probabilities", prognosis, timeframes, fitness for work, the need for treatment, advice, certainty, diagnosis labels,
 * credibility or liability – that no cited clinician's note records.
 *
 * bh2 (plan WB designs 1, 2, 4 and 5; release/bh-trial-2):
 * - 0125dda semantics, kept: no sentence is stripped before matching (the round-3 "No … was recorded" pre-strip and the
 *   narrated "before returning / going back" allows are gone – R-safety-1, R-safety-4); fa14c72's work-status tables
 *   (statusRecorded, F1) and the restriction, causal-wording and balance-exercise allows stay.
 * - B2-1, kept: "in X's opinion" passes only when a cited note X wrote records an opinion (noteGivesOpinion); "I expect
 *   … to ease" needs the same expectation in a cited note.
 * - The phrase test is findAnchor (attribution-anchor.ts), not "the phrase appears somewhere in the cited text": one
 *   sentence of a cited clinician's note must assert it (no goal, plan, question, negator or hedge around it, no
 *   stronger modality, the same polarity, every content word of the drafted clause) – and when the draft names whose
 *   opinion it is ("in Tom Ellis's opinion", "Tom Ellis recorded that…", "In my opinion…"), a note that clinician
 *   wrote. A pattern with its own allow (the work-status, restriction, causal-wording, balance and holder rules) is
 *   accepted by that allow alone, on the holder's notes.
 * - Recall (C-ATTR-1): the list covers about ten paraphrases of each category – recovery ("a good recovery", "back to
 *   his old self", "symptom-free"), prognosis ("the outlook is good", "expected back at work"), fitness ("capable of
 *   his full duties", "ready for full duties", a return to work at any level), causation ("brought on", "led to",
 *   "because of the incident", "was hurt by the lift"), permanence ("lasting", "for life", "here to stay") and the
 *   need for treatment ("needs more physiotherapy", "is advised", "is not required") – and every present or future
 *   modal clause ("needs to", "is required to", "has to", "should", "will", "must", "aims to", "would", "can", "may")
 *   is a need, a plan, an ability or a prediction that a note must record (the anti-deny-list mutations).
 * - check-WB (26/10/2026) fix round:
 *   - M1: a pattern with its own allow (work status, restriction, causal wording, holder) never absorbs the need,
 *     plan, ability or prediction beside it – "He will return to full duties" is judged as "will return" too, which
 *     the note must record (what blocks on production still blocks); a condition, wish, refusal or question in the
 *     note sentence keeps it from anchoring (attribution-text.ts frames).
 *   - M2: findAnchor and the causal allow accept only the clinician's own statement – not the patient's worry,
 *     belief, feeling or wish, a GP's or employer's words, another person, a risk to monitor or an earlier time –
 *     unless the draft keeps that frame.
 *   - M5: recall in other words – "consistent with / in keeping with / compatible with / typical of a …", "responsible
 *     for", "originates from", "cleared for work", "signed off as fit", "no ongoing limitations", "regained full
 *     function", "doing well", "good progress", "for good", "not going to go away", "on track to", "a good chance",
 *     "appropriate", "a candidate for", "he'll …", "in a fortnight".
 *   - Approver acceptances clear only a narrated work-status return the accepted note records (minor 1); an origin
 *     this build does not know is checked (minor 2).
 * - harden-WB (check2-WB, 26/10/2026): faithful drafts of the sample notes and of the recorded drafts anchor again –
 *   light verbs ("made good progress") and the answer particle ("Yes – resolved") carry no claim, another tense of the
 *   auxiliary or an irregular past is the same words ("had settled" / "has settled", "felt" / "feels", "would give way" /
 *   "will give way"), "when" / "after" condition only an outcome to come (D8 is per conjunct, a count of sessions is
 *   narrative), a plan modal or reported advice reads the note's plan instruction ("should avoid twisting" over "Avoid
 *   twisting …", planWordsOf), an outcome in the plan field anchors where the draft reports it as the plan, request,
 *   explanation or advice, "left with" is not a direction ("to the left with his foot planted"), and the note's words
 *   must be the same opinion phrase as the draft's (attribution-anchor.ts samePhraseAt).
 * - A verbatim quotation of a cited note by the clinician the sentence names is never checked inside its quotes – and
 *   is verbatim only when it is the note's whole statement (attribution-anchor.ts quotedVerbatim: a quotation that
 *   leaves out a "not", a hedge, a "?", a goal label, a weaker modal or a condition is checked like any other words).
 * - Origins: drafted text ("ai") is blocking and never acknowledged; text edited or written by staff (origin "edited"
 *   or "staff", or a person's paragraph stamped by someone other than the approver) is blocking and only the approving
 *   clinician may acknowledge it (ackPolicy "approver"); the approver's own words (origin "clinician" not stamped by
 *   someone else) and values filled from the records are not checked – the approver's opinion is theirs to give.
 * - "Accept as the note's words" (Khuram 26/10/2026, design 5): a drafted work-status or return line whose cited note
 *   is the approver's own and records that return passes once the approver accepted that phrase in that sentence
 *   (ReportSection.accepted, hashed and audited; attribution-fixes.ts offers it).
 *
 * Ledger hooks (ledger.json; core/validation/hooks.ts): statusRecorded, sameRestrictionWording, sameCausalWording,
 * exerciseOnBalance, noteGivesOpinion, approver-acceptance (here) and quoted-in-source (attribution-anchor.ts).
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Note, Paragraph, Report, ReportFlag, ReportSection } from "../types";
import { findAnchor, planFramed, quotedVerbatim, type NoteAnchor } from "./attribution-anchor";
import { unsupportedNegatives } from "./attribution-negatives";
import { clinicianNames, draftSentences, droppedFrames, holderAt, quoteOutside, sameName, sha256HexSync, type DraftSentence, type Holder } from "./attribution-text";
import { getValidationContext, hasText, makeFlag, voiceOwnerOf } from "./context";
import { defineHook, hookEnabled } from "./hooks";
import type { ValidatorInput } from "./registry";
import { noteSourceText } from "./sources";
import { escapeRegExp, normaliseForMatch } from "./text";
import { sentenceKey } from "../text/sentences";
import { expandNoteShorthand } from "../voice";
import { adoptionCurrent, paragraphResidue } from "../provenance";

/* Ledger hooks (ledger.json). Each applies only while hookEnabled(id) (the corpus disables them one by one). */
export const STATUS_RECORDED = defineHook("statusRecorded");
export const SAME_RESTRICTION_WORDING = defineHook("sameRestrictionWording");
export const SAME_CAUSAL_WORDING = defineHook("sameCausalWording");
export const EXERCISE_ON_BALANCE = defineHook("exerciseOnBalance");
export const NOTE_GIVES_OPINION = defineHook("noteGivesOpinion");
export const APPROVER_ACCEPTANCE = defineHook("approver-acceptance");
export const NARRATED_RETURN = defineHook("narrated-return");

/** A match in its sentence: the phrase and the rest of its clause (normalised; a clause ends at , ; : . ! ? or a line break). */
export interface OpinionHit {
  phrase: string;
  before: string;
  after: string;
}

export interface OpinionPattern {
  /** Short category shown in the flag message. */
  label: string;
  /** Matched against the NORMALISED sentence (lower case, digits, single spaces, "-" dashes). */
  re: RegExp;
  /** What it claims: an outcome (a note's plan field never records it as having happened) or another opinion. */
  kind?: "outcome" | "opinion";
  /**
   * The pattern's own acceptance – ordinary wording that only looks like this opinion, or the same statement recorded
   * in other words – tested on each cited note's normalised text (the holder's notes only). Patterns without one are
   * accepted by findAnchor.
   */
  allow?(hit: OpinionHit, normalisedSource: string): boolean;
  /** The ledger hook the allow belongs to (a disabled hook accepts nothing). */
  hook?: string;
  /** Also accepted by findAnchor when the allow does not accept it (the phrase asserted in a cited note sentence). */
  anchorToo?: boolean;
}

const N = "\\d+(?:\\.\\d+)?";
const RANGE = `${N}(?: ?(?:-|to|or) ?${N})?`;
const PERIOD = "(?:days?|weeks?|months?|years?)";
const EVENT = "(?:accident|collision|crash|rta|road traffic accident|incident|injury|index event|lifting incident|fall|lift)";

/* Work and activity status ("returned to normal duties") ------------------------------------------ */

const JOB = "(?:duties|duty|work|role|job|employment)";
const WORK = "(?:duties|duty|work|hours|shifts?|role|job|employment)";
const ACTIVITY = "(?:activities|activity|routine|hobbies|hobby|sports?|training|exercises?|gym|driving)";
/**
 * The only words that may stand between "normal" and the noun: "normal daily activities", "normal working hours",
 * "normal 12-hour shifts". Any other word ("normal during work", "normal pain-free activities") leaves the phrase to
 * the recovery pattern. The words other than daily / working / work must also be in the note.
 */
const DESCRIBER = "(?:daily|everyday|day-to-day|working|work|gym|training|exercise|sporting|social|leisure|household|\\d+-hour)";
const PLAIN_DESCRIBER = /^(?:daily|everyday|day-to-day|working|work)$/;
/** What a "normal" or pre-injury level belongs to when it is a work or activity: " duties", " daily activities". */
const STATUS_TAIL = ` (?:${DESCRIBER} )?(?:${WORK}|${ACTIVITY})\\b(?!-)`;
/** A full level of work ("normal", "full", "usual", "regular", "all", "pre-injury"). */
const FULL_LEVEL = "(?:normal|full|usual|regular|all|pre-?(?:accident|injury|incident))";
/** A reduced level of work: "light", "amended", "phased" … (bh2: a drafted return at one level needs the note's same level). */
const REDUCED_LEVEL = "(?:light|lighter|amended|modified|adjusted|restricted|reduced|phased|graded|partial|part-time)";

/** A note's words for a return that happened ("then back on normal duties", "resumed all his usual hobbies") or not. */
const RETURNED_IN_NOTE = "(?:back (?:on|to|at|in)|returned to|resumed|now on) (?:work (?:on|with) )?";
const NOT_RETURNED_IN_NOTE =
  "(?:(?:not|never|\\w+n't) (?:yet )?(?:back (?:on|to|at|in)|returned to|resumed)|yet to (?:return to|resume)) (?:work (?:on|with) )?";
const OWNER = "(?:his |her |their |the )?(?:all (?:his |her |their |the )?)?";
/** "Driving normally" records normal driving, and only that. */
const DOING_NORMALLY: Record<string, string> = { driving: "driving", training: "training", exercise: "exercising", exercises: "exercising" };
/** A drafted status that says the return has not happened: "she has not yet returned to her normal 12-hour shifts". */
const NOT_RETURNED_DRAFT =
  /\b(?:(?:has|have|had|is|are|was|were|still) (?:not|never)|hasn't|haven't|hadn't|isn't|wasn't|aren't|weren't) (?:yet )?$|\b(?:has|have|had) yet to $/;
/**
 * Drafted words before "returned to / back to" in its clause that make it a fitness opinion, a prognosis, advice or
 * a contradiction rather than the return the note records: "he can / should / is unable to return", "I recommend a
 * graded return", "he should be back to", "he never returned" (integration review, 10/2026).
 */
const NOT_A_FACT_DRAFT =
  /\b(?:not|\w+n't|no longer|never|neither|unable|cannot|can|could|able|ready|fit|should|would|will|may|might|must|expect\w*|anticipat\w*|aim\w*|goals?|plan\w*|hop(?:e|es|ed|ing)|want\w*|wish\w*|graded|phased|gradual\w*|towards?|unless|if|previous\w*|prior|nearly|almost|partly|partial\w*|target\w*|advis\w*|recommend\w*|request\w*|try\w*|attempt\w*)\b|\b(?:to|be|being|get|getting|go|going) $/;
/** A symptom or body part as the drafted subject makes it recovery: "his symptoms have returned to normal activity levels". */
const RECOVERY_SUBJECT =
  /\b(?:symptoms?|pain|stiffness|swelling|function(?:ing)?|movement|mobility|range|strength|sleep|mood|headaches?|neck|knee|shoulder|hip|ankle|wrist|elbow|spine|(?:his|her|their|the) back) (?:has |have |had |is |are |was |were )?(?:now |fully |also )?$/;
/** A note's current status that records being back at work in full: "working full time with no restrictions" (full time alone: hours). */
const WORKING_IN_FULL = "(?:working|at work) full[- ]time (?:with no|without) (?:restrictions?|limitations?)";

/**
 * Words that make a recorded return something other than a fact – negated, hedged, planned, hoped for or in the
 * past – when they come before it in its sentence: "not yet back on full duties", "nearly back on normal duties",
 * "aim: back to full training", "previously back on full duties", "to be back on", "getting back to".
 */
const NOT_A_FACT_BEFORE =
  /\b(?:not|\w+n't|no longer|never|neither|yet|unable|cannot|should|would|will|could|may|might|must|expect\w*|anticipat\w*|aim\w*|goals?|stg|ltg|objectives?|desired|plan\w*|hop(?:e|es|ed|ing)|want\w*|wish\w*|worr\w*|concern\w*|graded|phased|gradual\w*|towards?|until|unless|if|when|once|before|prior|previous\w*|similar|pre-?(?:accident|injury|incident)|nearly|almost|mostly|largely|partly|partial\w*|some|target\w*|advis\w*|recommend\w*|request\w*|try\w*|attempt\w*)\b|\bin (?:19|20)\d\d\b|\b(?:to|be|being|get|getting|go|going) $/;
/**
 * The same after it: a negation, modal or plan later in its sentence ("back to full training would be premature",
 * "back on full duties is the goal", "is unrealistic"), a question ("back on full duties with breaks?"), or straight
 * after it – a comma allowed – a date, day, limit or label ("from Monday", "in 2 weeks", "for 2 hours a day", ", but
 * avoiding lifting", "other than running", "full duties: no").
 */
const NOT_A_FACT_AFTER =
  /\b(?:not|\w+n't|never|yet|cannot|unable|should|would|could|may|might|will|must|(?:un)?likely|unrealistic|plan\w*|expect\w*|anticipat\w*|hop(?:e|es|ed|ing)|aim\w*|goals?|target\w*|until|unless|if|pending|due|other than)\b|\b(?:before|prior to) (?:the |his |her |their )?(?:accident|collision|crash|rta|incident|injury|fall|lift)\b|^(?: ?:|,? (?:from|by|within|next|soon|for|but|except|apart|only|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|,? in (?:\d|a |an |the next |several )[^ ]* ?(?:days?|weeks?|months?|fortnight))|\?$/;

/** A note's history fields (always its last lines) describe life before the injury, never a current status. */
const HISTORY_FIELDS = /\b(?:past medical history|social history): [^\n]*/g;

const CLAUSE_END = /[,;:.!?\n]/;
const SENTENCE_END = /[;.!?\n]/;
/** Context is read at most this far either side of a match (keeps every check linear on very long text). */
const CONTEXT_MAX = 300;

/** The part of `text` before `index`, back to the last `stop` character (a clause or a sentence). */
function textBefore(text: string, index: number, stop: RegExp): string {
  let i = index;
  while (i > 0 && index - i < CONTEXT_MAX && !stop.test(text.charAt(i - 1))) i -= 1;
  return text.slice(i, index);
}

/** The part of `text` from `index` on, up to the next `stop` character. */
function textAfter(text: string, index: number, stop: RegExp): string {
  let i = index;
  while (i < text.length && i - index < CONTEXT_MAX && !stop.test(text.charAt(i))) i += 1;
  return text.slice(index, i);
}

/**
 * "Returned to normal duties" / "back to his normal training" states a work or activity status. It passes only when
 * a cited note records the same return as a fact: a return ("back on", "returned to", "resumed", "now on") to a
 * full level ("normal", "full", "usual", "all") of the same thing ("then back on normal duties", "back on full
 * hours"), or "<doing> normally" for that one activity ("driving normally" → "normal driving"). "Off normal
 * duties", "pain with all activities", "back on light duties", "not yet back on full duties", "back on full duties
 * from Monday" and a history field do not. Any word for the job counts as the same thing (duties, work, role).
 * A drafted "has not yet returned to her normal shifts" needs the note's "not yet back on … shifts".
 *
 * The drafted side must state that return too: only "returned" or "back" can, and not after a modal, an ability word,
 * advice or a plan ("he can return", "I recommend a graded return", "he should be back to", "he never returned"), and
 * not with a symptom or body part as the subject ("his neck is back to normal work-wise" is recovery).
 *
 * bh2: the same for a return at a reduced level ("returned to light duties" needs the note's "back on light duties")
 * and for one with no level ("back at work" needs a recorded return at any level) – never a stronger level than the
 * note's ("back on amended duties" never supports "returned to full duties").
 */
function statusRecorded(hit: OpinionHit, source: string): boolean {
  if (!returnShape(hit.phrase)) return false;
  const negated = NOT_RETURNED_DRAFT.test(hit.before);
  if (!negated && (/^return(?:s|ing)?\b/.test(hit.phrase) || NOT_A_FACT_DRAFT.test(hit.before))) return false;
  if (RECOVERY_SUBJECT.test(hit.before)) return false;
  return noteRecordsReturn(hit, source, negated);
}

/** The level, describer and noun of a drafted return ("returned to his normal working hours"), or null. */
function returnShape(phrase: string): { level?: string; describer?: string; noun: string } | null {
  const m = new RegExp(`\\b(?:(${FULL_LEVEL}|${REDUCED_LEVEL}) )?(?:(${DESCRIBER}) )?(${WORK}|${ACTIVITY})$`).exec(phrase);
  return m ? { level: m[1], describer: m[2], noun: m[3] } : null;
}

/**
 * The note side of statusRecorded: whether `source` records the return the drafted phrase states (the same thing, at the
 * same level, as a fact – see statusRecorded). `negated`: the draft says it has not happened, and so must the note.
 */
export function noteRecordsReturn(hit: Pick<OpinionHit, "phrase">, source: string, negated = false): boolean {
  const shape = returnShape(hit.phrase);
  if (!shape) return false;
  const { level, describer, noun } = shape;
  const job = new RegExp(`^${JOB}$`).test(noun);
  // A "gym routine" / "training routine" is that activity: the note's "back at the gym" records it.
  const routineOf = noun === "routine" && describer && !PLAIN_DESCRIBER.test(describer) ? describer : null;
  const same = job ? JOB : routineOf ? `${escapeRegExp(routineOf)}(?: routines?)?` : `${noun.replace(/(?:ies|y|s)$/, "")}(?:ies|y|s)?`;
  const describers = routineOf ? "" : describer && !PLAIN_DESCRIBER.test(describer) ? `${escapeRegExp(describer)} ` : `(?:${DESCRIBER} )?`;
  // "usual" / "regular" names the thing the person usually does, not how much of it: a recorded return with no level
  // ("Back at the gym.") supports "returned to her usual gym routine"; a reduced one never does.
  const levelKind = !level ? "none" : /^(?:usual|regular)$/.test(level) ? "habitual" : new RegExp(`^${FULL_LEVEL}$`).test(level) ? "full" : "reduced";
  const doing = job ? `working normally|${WORKING_IN_FULL}` : noun === "hours" ? "working full[- ]time" : DOING_NORMALLY[noun] && `${DOING_NORMALLY[noun]} normally`;
  // The note's level: a full level for a full return, the same word for a reduced one, any level (or none) when the
  // draft gives none – never a stronger level than the note's.
  const noteLevel =
    levelKind === "full"
      ? `${FULL_LEVEL} `
      : levelKind === "habitual"
        ? `(?:${FULL_LEVEL} )?`
        : levelKind === "reduced"
          ? `${escapeRegExp(level as string)} `
          : `(?:(?:${FULL_LEVEL}|${REDUCED_LEVEL}) )?`;
  const recorded = negated
    ? `${NOT_RETURNED_IN_NOTE}${OWNER}(?:${FULL_LEVEL} )?${describers}${same}`
    : `${RETURNED_IN_NOTE}${OWNER}${noteLevel}${describers}${same}${doing && levelKind !== "reduced" ? `|${doing}` : ""}`;
  return noteRecords(source, recorded);
}

/** A past narrative that runs on into the return ("taking 3 days off work before returning", "then going back to"). */
const NARRATED_BEFORE = /\b(?:before|after|then|since|on) (?:(?:going|getting|coming) )?$/;

/**
 * A drafted return line told as a past narrative – "taking 3 days off work before returning to normal duties", "he took
 * 3 days off work before going back to normal duties" (B1-2, B2-11) – which the round-2/3 allows accepted on their own
 * (R-safety-4). Since bh2 it is never accepted automatically: it is what the approving clinician may accept with one
 * click as their own note's words (Khuram 26/10/2026), when their own cited note records that return. A modal, a plan,
 * a date or limit after it, or a symptom as the subject rules it out. Ledger hook "narrated-return".
 */
export function narratedReturn(hit: OpinionHit): boolean {
  if (!hookEnabled(NARRATED_RETURN) || !returnShape(hit.phrase)) return false;
  const gerund = /^returning\b/.test(hit.phrase) || /^back\b/.test(hit.phrase);
  if (!gerund || !NARRATED_BEFORE.test(hit.before)) return false;
  if (/^back\b/.test(hit.phrase) && !/(?:going|getting|coming) $/.test(hit.before)) return false;
  if (/^returning\b/.test(hit.phrase) && /(?:going|getting|coming) $/.test(hit.before)) return false;
  const rest = hit.before.replace(NARRATED_BEFORE, "");
  if (NOT_A_FACT_DRAFT.test(rest) || RECOVERY_SUBJECT.test(rest) || NOT_A_FACT_AFTER.test(hit.after)) return false;
  return true;
}

/** The note side depends only on the note and the wording looked for, so it is remembered for the last note read. */
let rememberedNote: string | null = null;
const remembered = new Map<string, boolean>();

/** Whether `source` records `recorded` (a regex source) as a fact: no hedge, negation, modal or plan in its sentence. */
export function noteRecords(source: string, recorded: string): boolean {
  if (source !== rememberedNote) {
    rememberedNote = source;
    remembered.clear();
  }
  const known = remembered.get(recorded);
  if (known !== undefined) return known;
  const found = recordedAsFact(source.replace(HISTORY_FIELDS, ""), new RegExp(`\\b(?:${recorded})\\b`, "g"));
  remembered.set(recorded, found);
  return found;
}

/** Whether the global `re` matches `text` once with no hedge, negation, modal or plan in the same sentence. */
function recordedAsFact(text: string, re: RegExp): boolean {
  for (let r = re.exec(text); r !== null; r = re.exec(text)) {
    const end = r.index + r[0].length;
    const before = textBefore(text, r.index, SENTENCE_END);
    const after = text.slice(end, end + textAfter(text, end, SENTENCE_END).length + 1); // with the "?" or "." that ends it
    if (!NOT_A_FACT_BEFORE.test(before) && !NOT_A_FACT_AFTER.test(after)) return true;
  }
  return false;
}

/**
 * "Without restrictions" and "with no restrictions" say the same; "no further restrictions" needs "further". Not after
 * a drafted modal ("he can return to work without restrictions"), and only where the note records it as a fact.
 */
function sameRestrictionWording(hit: OpinionHit, source: string): boolean {
  const m = /^(?:no|without) (further |any )?(restriction|limitation)s?$/.exec(hit.phrase);
  if (!m || NOT_A_FACT_DRAFT.test(hit.before)) return false;
  const qualifier = m[1] === "further " ? "further " : "(?:any |further )?";
  return noteRecords(source, `(?:no|without) ${qualifier}${m[2]}s?`);
}

const EXERCISE_WORD =
  "(?:work(?:s|ed|ing)?|focus(?:es|ed|sed|ing|sing)?|concentrat(?:e|es|ed|ing)|emphasis|exercises?|drills?|training|programme|progress(?:ed|ing)?|practi[sc](?:e|es|ed|ing))";

/** What a session works on, in a list before "and on balance": "focused on strengthening and on balance". */
const EXERCISE_TARGET =
  "(?:(?:hip|knee|ankle|core|trunk|quads?|glutes?|calf|lower limb|single-leg) )?(?:strength\\w*|stability|mobility|proprioception|posture|gait|co-?ordination|flexibility|endurance|control|agility|power|conditioning|stretch\\w*|squats?|lunges?|step-ups?)";

/**
 * "Worked on balance and strength", "focused on strengthening and on balance": exercise, not the standard of
 * proof – the exercise word comes straight before "on balance", or before a list of what was worked on; nothing but a
 * list or an exercise word follows it ("his progress on balance suggests…" is the legal phrase); and a cited note
 * records balance work ("single-leg balance").
 */
function exerciseOnBalance(hit: OpinionHit, source: string): boolean {
  if (!/\bbalance\b(?! of probabilit)/.test(source)) return false;
  if (!/^(?:$| (?:and|or|with|using|on|in|exercises?|drills?|work|training|tasks?|activities|board)\b)/.test(hit.after)) return false;
  if (new RegExp(`\\b${EXERCISE_WORD} $`).test(hit.before)) return true;
  return new RegExp(`\\b${EXERCISE_WORD} on (?:(?:his|her|their|the) )?${EXERCISE_TARGET} (?:and|or) $`).test(hit.before);
}

/**
 * Words that say nothing about what caused what: "…at work, which caused pain" is causation however the note's
 * "turning, which causes pain" goes on.
 */
const FUNCTION_WORD =
  /^(?:which|that|it|this|these|those|there|what|who|and|also|or|but|so|then|he|she|they|we|i|you|him|her|them|his|its|their|has|have|had|is|was|were|are|be|been|being|do|does|did|can|could|may|might|must|will|would|should|not|never|only|just|a|an|the|to|of|in|on|at|by|for|with|from|as|all|any|some|no)$/;

/**
 * "Cutting drills caused mild discomfort" reports a note's "cutting drills cause mild discomfort": the same content
 * word either side of "caused", in the drafted text and in the note. bh2: the nearest content words either side
 * (function words between are skipped – "the back pain was caused by the lifting incident" is the note's "the back
 * pain was caused by the lifting incident"), in one sentence the note asserts (no hedge, negation or plan there).
 */
function sameCausalWording(hit: OpinionHit, source: string): boolean {
  if (hit.phrase !== "caused") return false;
  const beforeWords = hit.before.trim().split(/\s+/).filter(Boolean);
  const afterWords = hit.after.trim().split(/\s+/).filter(Boolean);
  const skippedBefore: string[] = [];
  let prev: string | undefined;
  for (let i = beforeWords.length - 1; i >= 0; i--) {
    const w = beforeWords[i].replace(/[^a-z0-9-]/g, "");
    if (!w) continue;
    if (FUNCTION_WORD.test(w)) {
      skippedBefore.unshift(w);
      continue;
    }
    prev = w;
    break;
  }
  const skippedAfter: string[] = [];
  let next: string | undefined;
  for (const raw of afterWords) {
    const w = raw.replace(/[^a-z0-9-]/g, "");
    if (!w) continue;
    if (FUNCTION_WORD.test(w)) {
      skippedAfter.push(w);
      continue;
    }
    next = w;
    break;
  }
  if (!prev || !next || skippedBefore.length > 3 || skippedAfter.length > 3) return false;
  const gap = "(?:[a-z0-9'-]+ ){0,3}";
  const recorded = `${escapeRegExp(prev)} ${gap}caus(?:e|es|ed|ing) ${gap}${escapeRegExp(next)}`;
  // Said by the clinician, not the patient's belief or report ("He believes the pain was caused by …") – unless the
  // draft says whose it is (check-WB M2).
  return noteRecords(source, recorded) && framesKeptInSource(source, recorded, `${hit.before} ${hit.phrase} ${hit.after}`);
}

/** Whether some sentence of `source` that records `recorded` as a fact frames it only as the draft does (attribution-text.ts frames). */
function framesKeptInSource(source: string, recorded: string, draft: string): boolean {
  const text = source.replace(HISTORY_FIELDS, "");
  const re = new RegExp(`\\b(?:${recorded})\\b`, "g");
  for (let r = re.exec(text); r !== null; r = re.exec(text)) {
    const end = r.index + r[0].length;
    const before = textBefore(text, r.index, SENTENCE_END);
    const after = textAfter(text, end, SENTENCE_END);
    if (NOT_A_FACT_BEFORE.test(before) || NOT_A_FACT_AFTER.test(after)) continue;
    if (droppedFrames(`${before} ${r[0]} ${after}`, draft).length === 0) return true;
  }
  return false;
}

/** B2-1: "in Tom Ellis's opinion" passes only when a cited note (that clinician's – the holder rule) records an opinion. */
function noteGivesOpinion(_hit: OpinionHit, source: string): boolean {
  return /\bin (?:my|his|her|their) (?:clinical |professional )?(?:opinion|view)\b|\bopinion (?:is|was) that\b|\bopinion on work\b/.test(source);
}

/* Modal clauses: a need, a plan, an ability, a recommendation or a prediction ------------------- */

const SUBJECT_MODAL =
  "(?:needs? to|is required to|are required to|has to|have to|should|shall|must|ought to|will|would|may|might|can|cannot|can't|won't|wouldn't|shouldn't|mustn't|(?:is|are|am) (?:un)?able to|aims? to|(?:is|are) aiming to|plans? to|(?:is|are) planning to|intends? to|hopes? to|wants? to|(?:is|are) going to)";

/** Months that look like "may": "in May", "by May 2027", "May 2026". */
const MONTH_MAY_BEFORE = /\b(?:in|on|of|by|since|until|from|during|early|late|mid|end of|beginning of|before|after)\s+$/;

/** The label of the work-status and return pattern (the one phrase an approver may accept as their note's words). */
export const RETURN_LABEL = "return to normal work or activity";

/** The phrase list. Order matters only for the order of flags. */
export const OPINION_PATTERNS: readonly OpinionPattern[] = [
  // Recovery and prognosis
  { label: "recovery", kind: "outcome", re: /\b(?:full|complete|total)(?:ly)? recover(?:y|ed)\b/g },
  { label: "recovery", kind: "outcome", re: /\brecover(?:ed|s)? (?:fully|completely)\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:resolved|recovered|resolution)\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:made|make|making|makes|good|great|excellent|steady|slow|full|complete|partial|remarkable|reasonable|satisfactory) (?:an? )?recovery\b/g },
  { label: "recovery", kind: "outcome", re: /\brecover(?:y|ies|ing|s)?\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:fully|completely|totally|entirely|much|far|a lot|significantly|considerably) better\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:back to|returned to|return to) (?:his|her|their) (?:old|usual|normal|former) self\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:got|get|gets|getting|has got|have got) over\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:healed|heals|healing)\b/g },
  // "Symptom-free" is a recovery claim; "pain-free" only as a state of the patient ("he is pain-free"), never in a finding
  // ("full, pain-free lumbar movement", "pain-free sitting for 1 hour").
  { label: "recovery", kind: "outcome", re: /\bsymptom[- ]free\b|\b(?:is|are|was|were|be|been|being|now|remains?|remained|became|become|feels?|felt) (?:now |completely |totally |fully |entirely )?(?:pain|problem|trouble)[- ]free\b(?! (?:lumbar|cervical|thoracic|active|passive|range|movement|motion|flexion|extension|rotation|walking|sitting|standing|squat|lifting|knee|hip|shoulder|neck|back))|\bfree (?:of|from) (?:all |any |his |her |their )?(?:symptoms?|pain)\b|\basymptomatic\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:has|have|had|is|are|was|were) (?:now |fully |completely |all |since )?(?:settled|cleared(?: up)?|gone away|gone(?! (?:back|to|on|into|out|up|down|through|off|in)\b)|disappeared|subsided|abated|ceased|vanished|eased off|worn off)\b/g },
  { label: "recovery", kind: "outcome", re: /\bno longer\b/g },
  // check-WB M5: the same claim in everyday words.
  { label: "recovery", kind: "outcome", re: /\bon the mend\b|\bas good as new\b|\bback on (?:his|her|their) feet\b|\bbounced back\b|\bdoing (?:very |really |extremely )?well\b|\b(?:good|excellent|great|steady|significant|remarkable|satisfactory|slow|limited|poor|no) progress\b|\bprogressing (?:very |really )?well\b/g },
  { label: "recovery", kind: "outcome", re: /\b(?:fully|completely) functional\b|\b(?:full|normal) function\b|\bregain(?:ed|s|ing)? (?:his |her |their )?(?:full |normal |complete )?(?:function|movement|strength|range|mobility|fitness)\b/g },
  { label: "recovery", kind: "outcome", re: /\bno (?:ongoing|residual|lasting|remaining|persisting) (?:limitations?|restrictions?|problems?|symptoms?|issues?|impairment|disability|effects?|deficits?)\b/g },
  {
    label: "recovery",
    kind: "outcome",
    re: new RegExp(
      `\\b(?:back|return(?:ed|ing|s)?) to (?:all )?(?:his |her |their )?(?:full fitness\\b|(?:normal|pre-?(?:accident|injury|incident))\\b(?!${STATUS_TAIL}))`,
      "g",
    ),
  },
  {
    // bh2 (C-ATTR-1): a return to a FULL level of work or activity – normal, full, usual, regular, all, pre-injury
    // ("returned to full duties" from a note's "back on amended duties" is a strengthened status).
    label: RETURN_LABEL,
    kind: "outcome",
    re: new RegExp(`\\b(?:back (?:to|on|at|in)|return(?:ed|ing|s)? to|resum(?:e|ed|es|ing)) (?:all )?(?:his |her |their |the )?(?:normal|full|usual|regular|pre-?(?:accident|injury|incident))${STATUS_TAIL}`, "g"),
    allow: statusRecorded,
    hook: STATUS_RECORDED,
    anchorToo: true,
  },
  { label: "prediction", kind: "outcome", re: /\bwill (?:make an? |go on to |continue to )?(?:recover|resolve|settle|improve|heal|return|be able|need|require|have|experience|suffer|remain|persist)\w*/g },
  { label: "prediction", kind: "outcome", re: /\b(?:should|would) (?:recover|resolve|settle|improve|heal)\w*/g },
  { label: "prediction", kind: "outcome", re: /\b(?:he|she|they|it|we|i|you)'(?:ll|d) [a-z]+/g },
  { label: "prediction", kind: "outcome", re: /\b(?:should|would|could|may|might) (?:now )?be (?:able|fit|ready|back)\b/g },
  { label: "prediction", kind: "outcome", re: /\bcould (?:now )?(?:return|resume|go back|get back)\b/g },
  { label: "prediction", kind: "outcome", re: /\b(?:expected|anticipated|predicted|forecast) to\b/g },
  { label: "prediction", kind: "outcome", re: /\b(?:is|are|was|were|be|been) (?:\w+ )?(?:expected|anticipated|predicted)\b|\bexpected (?:back|to be|within|by)\b|\bcan be expected\b/g },
  // B2-1: "I expect these to ease steadily", "he expects it to settle" – anchored like any other phrase.
  { label: "prediction", kind: "outcome", re: /\bexpect(?:s|ed|ing)?\b(?: [a-z0-9'-]+){0,8}? to (?:ease|settle|resolve|improve|recover|reduce|subside|heal|return|lessen|be)\w*/g },
  { label: "prediction", kind: "outcome", re: /\b(?:i|we) (?:would |do |also )?expect\b/g },
  { label: "prediction", kind: "outcome", re: /\b(?:is|are|was|were|seems?|appears?|remains?) (?:highly |very |most |quite )?(?:un)?likely\b/g },
  { label: "prediction", kind: "outcome", re: /\b(?:most|highly|very) likely\b/g },
  { label: "prediction", kind: "outcome", re: /\blikelihood\b/g },
  { label: "prognosis", kind: "outcome", re: /\bprognos(?:is|es|tic)\b/g },
  { label: "prognosis", kind: "outcome", re: /\b(?:outlook|prospects?)\b/g },
  { label: "prognosis", kind: "outcome", re: /\b(?:good|fair|reasonable|high|low|small|slim|strong|every) (?:chance|likelihood|possibility)\b|\bforesee(?:n|able)?\b|\bon track (?:to|for)\b|\b(?:i|we)'d (?:expect|anticipate|predict)\b/g },
  { label: "timeframe", kind: "outcome", re: new RegExp(`\\bwithin (?:the next |a further |another )?${RANGE} ${PERIOD}\\b`, "g") },
  { label: "timeframe", kind: "outcome", re: new RegExp(`\\bin (?:the next |a further |another )?${RANGE} ${PERIOD}'? time\\b`, "g") },
  { label: "timeframe", kind: "outcome", re: new RegExp(`\\b${RANGE} ${PERIOD} (?:from|after|post|following) (?:the )?${EVENT}\\b`, "g") },
  { label: "timeframe", kind: "outcome", re: new RegExp(`\\b${RANGE} ${PERIOD} post-${EVENT}\\b`, "g") },
  { label: "timeframe", kind: "outcome", re: /\b(?:over|in) the (?:coming|next few|following) (?:days|weeks|months)\b|\bin (?:due )?time\b/g },
  { label: "timeframe", kind: "outcome", re: /\b(?:in|within) (?:a|one|another|the next) (?:week|fortnight|month|year)(?:'s time)?\b/g },

  // Permanence
  { label: "permanence", kind: "outcome", re: /\bpermanent(?:ly)?\b/g },
  { label: "permanence", kind: "outcome", re: /\blong-? ?term\b/g },
  { label: "permanence", kind: "outcome", re: /\blife-? ?long\b/g },
  { label: "permanence", kind: "outcome", re: /\bindefinite(?:ly)?\b/g },
  { label: "permanence", kind: "outcome", re: /\bchronic\b/g },
  { label: "permanence", kind: "outcome", re: /\birreversible\b|\b(?:be |been )?reversed\b|\breversible\b/g },
  { label: "permanence", kind: "outcome", re: /\ba lasting\b|\blasting (?:weakness|damage|effects?|impairment|disability|problems?|symptoms?|restrictions?|limitations?|pain|stiffness)\b|\bfor (?:the rest of (?:his|her|their) )?life\b|\bhere to stay\b|(?<!\b(?:to|on|onto|towards?|the|his|her|their|its|turn(?:s|ed|ing)?|lean(?:s|ed|ing)?|look(?:s|ed|ing)?|rotat(?:e|es|ed|ing|ion)|step(?:s|ped|ping)?|pivot(?:s|ed|ing)?) )\bleft with\b|\bforever\b/g },
  { label: "permanence", kind: "outcome", re: /\bnever (?:fully |completely )?(?:recover|regain|return|resolve|heal|settle|go away|get better|be the same)\w*/g },
  { label: "permanence", kind: "outcome", re: /\bfor good\b|\b(?:not|never) (?:going|likely|expected) to (?:go away|disappear|resolve|clear|settle|improve)\b|\bwon't (?:go away|disappear|resolve|clear|settle|improve)\b|\bnot (?:go away|disappear|resolve|clear up)\b/g },

  // Causation
  { label: "causation", re: /\bcaus(?:ed|ation|al|ally|ative)\b/g, allow: sameCausalWording, hook: SAME_CAUSAL_WORDING },
  { label: "causation", re: /\battribut(?:able|ed) to\b/g },
  { label: "causation", re: /\bas a (?:direct |likely |probable )?(?:result|consequence) of\b/g },
  { label: "causation", re: /\b(?:resulted|resulting|arising|arose|stem(?:s|med)?) from\b/g },
  { label: "causation", re: new RegExp(`\\bdue to (?:the |this |that |his |her |their )?${EVENT}\\b`, "g") },
  { label: "causation", re: /\bsecondary to\b/g },
  { label: "causation", re: new RegExp(`\\bconsistent with (?:the |this |that |his |her |their )?(?:reported )?(?:${EVENT}|mechanism)\\b`, "g") },
  // check-WB M5: any article, the injury's own words, and the other ways of saying it.
  { label: "causation", re: new RegExp(`\\b(?:consistent with|in keeping with|compatible with|typical of|characteristic of|in line with) (?:the |this |that |his |her |their |a |an )?(?:[a-z-]+ ){0,3}?(?:${EVENT}|mechanism|impact|whiplash(?:-associated disorder)?|trauma|collision|strain|sprain)\\b`, "g") },
  { label: "causation", re: /\bresponsible for (?:his |her |their |the |this |these )?(?:[a-z-]+ ){0,2}?(?:pain|symptoms?|injur(?:y|ies)|condition|problems?|stiffness|restrictions?|limitations?|disability)\b/g },
  { label: "causation", re: /\boriginat(?:e|es|ed|ing) (?:from|in)\b|\bset (?:it|this|them|(?:the|his|her|their) (?:pain|symptoms?)) off\b/g },
  { label: "causation", re: new RegExp(`\\b(?:${EVENT}) (?:has |had )?(?:gave|given|left) (?:him|her|them)\\b|\\b(?:injur(?:y|ies)|pain|whiplash|strain|sprain|damage) from (?:the |this |that |his |her |their |a |an )?(?:[a-z-]+ ){0,2}?${EVENT}\\b`, "g") },
  { label: "causation", re: new RegExp(`\\b(?:${EVENT})-? ?related\\b`, "g") },
  { label: "causation", re: new RegExp(`\\brelated to (?:the |this |that |his |her |their )?${EVENT}\\b`, "g") },
  { label: "causation", re: /\bwould not have (?:occurred|happened|developed|arisen)\b/g },
  { label: "causation", re: /\bbut for\b/g },
  // bh2 (C-ATTR-1): the same claim in other words.
  { label: "causation", re: /\bcause of\b/g },
  { label: "causation", re: new RegExp(`\\b(?:${EVENT}|work|job|lifting|it|this|that|which) (?:has |have |had |then |also |directly )?(?:brought on|brings on|bring on|triggered|triggers|led to|leads to|lead to|resulted in|results in)\\b`, "g") },
  { label: "causation", re: new RegExp(`\\b(?:brought on|triggered) by (?:the |this |that |his |her |their |a |an )?(?:[a-z-]+ ){0,2}?(?:${EVENT}|work|job|lifting)\\b`, "g") },
  { label: "causation", re: new RegExp(`\\b(?:because of|owing to|on account of|(?:came|comes|come|coming) from|down to) (?:the |this |that |his |her |their |a |an )?(?:[a-z-]+ ){0,2}?(?:${EVENT}|work|job)\\b`, "g") },
  // An injury done by something ("his back was hurt by the lift") – not what makes a symptom worse ("aggravated by sitting").
  { label: "causation", re: /\b(?:was|were|been|being|got|is|are) (?:hurt|injured|damaged|strained|sprained) by\b/g },

  // Legal standard of proof
  { label: "balance of probabilities", re: /\b(?:on )?(?:the )?balance of probabilit(?:y|ies)\b/g },
  { label: "balance of probabilities", re: /\bmore (?:likely|probable) than not\b/g },
  { label: "balance of probabilities", re: /\bon balance\b/g, allow: exerciseOnBalance, hook: EXERCISE_ON_BALANCE },
  { label: "balance of probabilities", re: /\bin all (?:likelihood|probability)\b/g },

  // Fitness for work and restrictions
  { label: "fitness for work", kind: "outcome", re: /\b(?:un)?fit (?:for|to)\b[^.;:!?]{0,80}?\b(?:work|duties|duty|employment|job|role|shifts?)\b/g },
  { label: "fitness for work", kind: "outcome", re: /\b(?:no|without) (?:further |any )?(?:restrictions?|limitations?)\b/g, allow: sameRestrictionWording, hook: SAME_RESTRICTION_WORDING },
  { label: "fitness for work", kind: "outcome", re: /\b(?:in)?capable of\b|\bready (?:for|to)\b/g },
  { label: "fitness for work", kind: "outcome", re: /\bcleared (?:for|to)\b|\bsigned off (?:as )?(?:fully )?fit\b|\bgood to go\b/g },

  // The need for treatment, advice and recommendations (present and future – a past "I advised" reports a recorded act)
  { label: "need for treatment", re: /\b(?:needs?|requires?)\b|\bneed for\b|\b(?:is|are|was|were|be|been|not) (?:not )?(?:needed|required|necessary|indicated|warranted)\b/g },
  { label: "need for treatment", re: /\b(?:is|are|was|were|be|been|seems?|remains?) (?:clinically |entirely |also |still )?(?:appropriate|justified|warranted|worthwhile|worth (?:continuing|pursuing|trying)|beneficial|advisable)\b|\b(?:good |suitable |an appropriate )?candidate for\b/g },
  { label: "advice", re: /\b(?:is|are|be|being|been) (?:strongly )?(?:advised|recommended|suggested)\b|\b(?:i|we) (?:would )?(?:strongly )?(?:recommend|advise|suggest)\b|\brecommend(?:s|ing)\b|\badvis(?:es|ing|able)\b|\b(?:my|our) recommendations?\b|\bbenefit from\b/g },

  // Modal clauses (the anti-deny-list: "needs to", "is required to", "has to", "should", "will", "must", "aims to" …)
  { label: "need, plan or prediction", re: new RegExp(`\\b${SUBJECT_MODAL}(?: (?:not|now|also|still|then|soon|again|probably|possibly|definitely|certainly|always|never|need to|be able to))? [a-z]+(?:-[a-z]+)?`, "g") },

  // Certainty and diagnosis labels (strengthened hedging)
  { label: "certainty", re: /\b(?:definite(?:ly)?|certainly|undoubted(?:ly)?|unequivocal(?:ly)?|conclusive(?:ly)?|categorical(?:ly)?|clearly)\b/g },
  { label: "certainty", re: /\bwithout (?:any )?doubt\b/g },
  { label: "certainty", re: /\bconfirm(?:s|ed|ing)?\b/g },
  { label: "certainty", re: /\bprov(?:es|ed|en)\b/g },
  { label: "diagnosis", re: /\bdiagnos(?:is|es|ed|e)\b/g },

  // Credibility and liability
  { label: "credibility", re: /\b(?:exaggerat|malinger|embellish|feign)\w*/g },
  { label: "credibility", re: /\b(?:symptom magnification|non-? ?organic|functional overlay|waddell)\w*/g },
  { label: "credibility", re: /\b(?:genuine|credible|reliable|honest|consistent) (?:historian|account|presentation|witness)\b/g },
  { label: "credibility", re: /\b(?:symptoms?|pain|account|presentation|complaints?|history) (?:is|are|was|were|appears?|seems?) (?:entirely |wholly |completely |fully )?(?:genuine|credible|plausible|reliable)\b/g },
  { label: "liability", re: /\b(?:negligen\w*|liab(?:le|ility)|at fault|to blame)\b/g },

  // Whose opinion it is (B2-1): "In Tom Ellis's opinion …" names an opinion – a cited note by that clinician must record one.
  { label: "opinion", re: /\bin (?:his|her|their|[a-z][a-z'-]*(?: [a-z][a-z'-]*)?'s) (?:clinical |professional )?(?:opinion|view)\b|\b[a-z][a-z'-]*(?: [a-z][a-z'-]*)?'s (?:clinical |professional )?opinion (?:is|was) that\b/g, allow: noteGivesOpinion, hook: NOTE_GIVES_OPINION },
];

/* ------------------------------------------------------------------------------------------------
 * Finding the phrases
 * ----------------------------------------------------------------------------------------------*/

export interface OpinionMatch {
  label: string;
  /** The phrase as matched in the normalised text. */
  phrase: string;
}

/** A matched phrase in a normalised sentence. */
export interface RawHit {
  pattern: OpinionPattern;
  label: string;
  phrase: string;
  start: number;
  end: number;
  hit: OpinionHit;
}

/** A modal word that is something else here: the month ("in May"), a figure ("may 2026"), "will" as a noun. */
function falseModal(norm: string, start: number, phrase: string): boolean {
  if (/^may\b/.test(phrase) && (MONTH_MAY_BEFORE.test(norm.slice(Math.max(0, start - 20), start)) || /^may \d/.test(phrase))) return true;
  if (/^can\b/.test(phrase) && /\b(?:a|the|tin|watering) $/.test(norm.slice(Math.max(0, start - 10), start))) return true;
  // "He was unable to attend": a past ability is what happened, not an opinion.
  if (/^(?:un)?able to\b/.test(phrase) && /\b(?:was|were|had been|has been|have been|being) $/.test(norm.slice(Math.max(0, start - 12), start))) return true;
  return false;
}

/**
 * Every opinion phrase of a normalised sentence – the longest match where two overlap (a recovery inside a "full
 * recovery", a return inside "fit for a phased return …"), so each claim is judged once, by its widest phrase.
 */
export function rawOpinionHits(norm: string): RawHit[] {
  const all: RawHit[] = [];
  for (const pattern of OPINION_PATTERNS) {
    const re = new RegExp(pattern.re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const raw = m[0];
      const lead = raw.length - raw.trimStart().length;
      const phrase = raw.trim();
      const start = m.index + lead;
      const end = start + phrase.length;
      if (falseModal(norm, start, phrase)) continue;
      all.push({ pattern, label: pattern.label, phrase, start, end, hit: { phrase, before: textBefore(norm, start, CLAUSE_END), after: textAfter(norm, end, CLAUSE_END) } });
    }
  }
  // Keep the widest: drop a hit inside another one (ties: the earlier pattern). Sorted by start, then the longest first,
  // a hit lies inside an earlier one exactly when some earlier hit reaches as far (linear after the sort – M6).
  const order = all.map((h, i) => ({ h, i })).sort((a, b) => a.h.start - b.h.start || b.h.end - a.h.end || a.i - b.i);
  // (As below, a hit with its own allow never swallows one without.)
  const wide: Array<{ h: RawHit; i: number }> = [];
  let reachAll = -1;
  let reachAllowed = -1;
  for (const o of order) {
    const allowed = Boolean(o.h.pattern.allow);
    if (o.h.end <= reachAll || (allowed && o.h.end <= reachAllowed)) continue;
    wide.push(o);
    if (allowed) reachAllowed = Math.max(reachAllowed, o.h.end);
    else reachAll = Math.max(reachAll, o.h.end);
  }
  // Two hits that share words read one claim: the earlier pattern judges it ("is expected to" is one prediction). But
  // a pattern with its own allow (the work-status, restriction, causal and holder rules) never absorbs a need, plan,
  // ability or prediction beside it: "He will return to full duties" over a note's "Return to full duties when pain
  // allows" is judged as the prediction "will return" too, which the note must record (check-WB M1 – the differential
  // principle: what blocks on production still blocks).
  const absorbAll = new Uint8Array(norm.length + 1);
  const absorbAllowed = new Uint8Array(norm.length + 1);
  const kept: RawHit[] = [];
  for (const { h } of wide.sort((a, b) => a.i - b.i)) {
    const allowed = Boolean(h.pattern.allow);
    let absorbed = false;
    for (let c = h.start; c < h.end && !absorbed; c++) absorbed = absorbAll[c] === 1 || (allowed && absorbAllowed[c] === 1);
    if (absorbed) continue;
    kept.push(h);
    (allowed ? absorbAllowed : absorbAll).fill(1, h.start, h.end);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** A cited note with its normalised text, as the allows read it (header and field lines, the note as written). */
interface CitedNote {
  note: Note;
  norm: string;
}

function citedNotes(ids: readonly string[], notes: readonly Note[]): CitedNote[] {
  const out: CitedNote[] = [];
  for (const id of ids) {
    const note = notes.find((n) => n.id === id);
    if (note && !out.some((c) => c.note.id === id)) out.push({ note, norm: normaliseForMatch(noteSourceText(note)) });
  }
  return out;
}

/** The holder's name, or null: the owner's own opinion needs the owner's notes (strict mode: no owner – none qualifies). */
function holderName(holder: Holder | null, owner: { name: string } | null): string | null | undefined {
  if (!holder) return undefined;
  if (holder.kind === "named") return holder.name;
  return owner?.name ?? null;
}

export interface JudgedHit extends RawHit {
  /** Where a cited note asserts it (findAnchor or the pattern's allow), or null. */
  anchor: NoteAnchor | null;
  /** The approver accepted it as their own note's words (ReportSection.accepted). */
  accepted: boolean;
  /** The note-holder rule ruled it out: the draft names a clinician whose cited notes do not hold it. */
  holder: string | null | undefined;
}

export interface JudgedSentence {
  sentence: DraftSentence;
  hits: JudgedHit[];
}

/** A verbatim quotation inside a sentence: its span in the normalised sentence and whether a cited note by the holder holds it. */
function quotedSpans(s: DraftSentence, notes: readonly Note[], holder: string | null | undefined): Array<{ start: number; end: number; verbatim: boolean }> {
  const out: Array<{ start: number; end: number; verbatim: boolean }> = [];
  // Double quotes, and single quotes around words (never an apostrophe: "Hart's", "o'clock").
  for (const m of [...Array.from(s.norm.matchAll(/"([^"]{3,})"/g)), ...Array.from(s.norm.matchAll(/(?:^|[\s(])'([^']{3,}?)'(?=[\s.,;:!?)]|$)/g))]) {
    const inner = m[1];
    const at = (m.index ?? 0) + m[0].indexOf(inner);
    // What the sentence says outside the quotation keeps a negation, hedge or frame the quotation leaves out (M3).
    const outside = quoteOutside(s.norm, at, at + inner.length);
    const verbatim = Boolean(quotedVerbatim(normaliseForMatch(expandNoteShorthand(inner)), notes, holder ?? null, outside));
    out.push({ start: at, end: at + inner.length, verbatim });
  }
  return out;
}

/** The SHA-256 a ReportSection.accepted entry records for a drafted sentence (core/text/sentences.ts sentenceKey). */
export function sentenceSha(sentence: string): string {
  return sha256HexSync(sentenceKey(sentence));
}

/**
 * Whether the approver accepted this hit in `sentence` as their own cited note's words (an entry by the approver). Only
 * what Khuram's decision (26/10/2026) lets them accept counts, whatever is stored (check-WB minor 1): a drafted
 * work-status or return line told as a past narrative (narratedReturn) that the accepted note – theirs, and cited –
 * records (noteRecordsReturn). Any other stored entry clears nothing.
 */
function acceptedByApprover(section: ReportSection, report: Pick<Report, "approver">, raw: RawHit, sentence: string, notes: readonly Note[], cited: readonly string[]): boolean {
  if (!hookEnabled(APPROVER_ACCEPTANCE)) return false;
  const approver = report.approver;
  if (!approver || !section.accepted?.length) return false;
  if (raw.label !== RETURN_LABEL || !narratedReturn(raw.hit)) return false;
  const sha = sentenceSha(sentence);
  return section.accepted.some((a) => {
    if (a.check !== "OPINION_LANGUAGE" || a.phrase !== raw.phrase || a.sentenceSha !== sha) return false;
    if (a.by.memberId !== approver.memberId || !a.by.canSign) return false;
    if (!a.noteId || !cited.includes(a.noteId)) return false;
    const note = notes.find((n) => n.id === a.noteId);
    return Boolean(note) && sameName(note!.author.name, approver.name) && noteRecordsReturn(raw.hit, normaliseForMatch(noteSourceText(note!)));
  });
}

/**
 * Judge every opinion phrase of a paragraph: its sentence, the holder the sentence names, whether a cited note asserts
 * it and whether the approver accepted it. Used by the validator, the opinion-box rule and the fix generators.
 */
export function judgeParagraphOpinions(input: {
  paragraph: Pick<Paragraph, "text" | "sourceIds">;
  section: ReportSection;
  report: Pick<Report, "approver">;
  notes: readonly Note[];
  people: readonly string[];
  owner: { name: string } | null;
}): JudgedSentence[] {
  const { paragraph: p, section, report, notes, people, owner } = input;
  const cited = p.sourceIds.filter((id) => /^N-\d+$/.test(id));
  const cnotes = citedNotes(cited, notes);
  const out: JudgedSentence[] = [];
  for (const s of draftSentences(p.text, people)) {
    const sentenceHolder = holderName(s.holder, owner);
    const sentenceNotes = sentenceHolder === undefined ? cnotes : sentenceHolder === null ? [] : cnotes.filter((c) => sameName(c.note.author.name, sentenceHolder));
    const quotes = quotedSpans(s, sentenceNotes.map((c) => c.note), sentenceHolder);
    const hits: JudgedHit[] = [];
    for (const raw of rawOpinionHits(s.norm)) {
      // The holder in force where the phrase is ("…; in Tom Ellis's opinion he will need …" – Tom Ellis's notes only).
      const hName = holderName(holderAt(s.norm, raw.start, people, s.holder), owner);
      const holderNotes = hName === undefined ? cnotes : hName === null ? [] : cnotes.filter((c) => sameName(c.note.author.name, hName));
      // Inside a verbatim quotation of the holder's note: those are the note's own words.
      if (quotes.some((q) => q.verbatim && q.start <= raw.start && raw.end <= q.end)) continue;
      let anchor: NoteAnchor | null = null;
      if (raw.pattern.allow) {
        if (!raw.pattern.hook || hookEnabled(raw.pattern.hook)) {
          for (const c of holderNotes) {
            if (raw.pattern.allow(raw.hit, c.norm)) {
              anchor = { noteId: c.note.id, author: c.note.author, sentence: noteSentenceFor(c.note, raw.phrase) };
              break;
            }
          }
        }
        if (!anchor && raw.pattern.anchorToo) {
          anchor = findAnchor({ phrase: raw.phrase, sentence: clauseOf(s, raw), notes: holderNotes.map((c) => c.note), holder: hName ?? null, kind: raw.pattern.kind ?? "opinion", ignore: { people: people.map((x) => x.toLowerCase()) }, context: s.norm.slice(0, raw.start), pattern: raw.pattern.re });
        }
      } else {
        const clause = clauseOf(s, raw);
        const context = s.norm.slice(0, raw.start);
        anchor = findAnchor({
          phrase: raw.phrase,
          sentence: clause,
          notes: holderNotes.map((c) => c.note),
          holder: hName ?? null,
          kind: raw.pattern.kind ?? "opinion",
          ignore: { people: people.map((x) => x.toLowerCase()) },
          context,
          planWords: planWordsOf(raw, planFramed(normaliseForMatch(clause), context)),
          pattern: raw.pattern.re,
        });
      }
      const accepted = !anchor && acceptedByApprover(section, report, raw, s.text, notes, cited);
      hits.push({ ...raw, anchor, accepted, holder: hName });
    }
    out.push({ sentence: s, hits });
  }
  return out;
}

/** Modals that state a plan, need or instruction – what a note's plan line says without one ("Avoid twisting …"). */
const PLAN_MODAL = /^(?:should|ought to|needs? to|has to|have to|plans? to|(?:is|are) planning to|aims? to|(?:is|are) aiming to|intends? to)\b/;
/** Modals that report a plan only where the draft says it is one ("recorded in the plan that sessions would be weekly"). */
const PLAN_MODAL_FRAMED = /^(?:will|would|shall)\b/;
/** Advice words a note's plan line states as the instruction itself ("advising ice and compression" – "Ice and compression …"). */
const ADVICE_WORDS = /^(?:(?:is|are|be|being|been) (?:strongly )?(?:advised|recommended)|recommend(?:s|ing)|advis(?:es|ing))$/;

/**
 * The words of a modal or advice hit that only say it is a plan, need or advice (check2-WB N2), for findAnchor's plan
 * reading: "should", "needs to", "plans to" …; "will" / "would" / "shall" only when the draft reports a plan, request,
 * explanation or advice (`framed`); an advice verb. Never "can", "may", "might", "could" or "must" (ability, possibility
 * and a stronger "must" are not a plan instruction), nor a negated modal.
 */
function planWordsOf(raw: RawHit, framed: boolean): string | undefined {
  if (raw.label === "need, plan or prediction") {
    const m = PLAN_MODAL.exec(raw.phrase) ?? (framed ? PLAN_MODAL_FRAMED.exec(raw.phrase) : null);
    return m ? m[0] : undefined;
  }
  if (raw.label === "advice" && ADVICE_WORDS.test(raw.phrase)) return raw.phrase;
  return undefined;
}

/** The note sentence an allow matched in, as best known (the sentence holding the phrase's last word), else the note's first. */
function noteSentenceFor(note: Note, phrase: string): string {
  const fields = [note.subjective, note.objective, note.assessment, note.plan, note.freeText ?? ""].join("\n");
  const last = phrase.split(/\s+/).pop() ?? "";
  const line = fields.split(/(?<=[.!?\n])\s+/).find((x) => x.toLowerCase().includes(last)) ?? fields.split(/\n/)[0] ?? "";
  return line.trim();
}

/** The drafted clause around a hit (between the sentence's clause boundaries), from its claim when the hit is in it. */
function clauseOf(s: DraftSentence, raw: RawHit): string {
  const words = raw.phrase;
  for (const c of s.clauses) if (c.includes(words)) return c;
  return s.claim || s.norm;
}

/**
 * Opinion phrases in `text` that a cited source (`normalisedSource`, the normalised text of one note or of several
 * joined) does not hold – the phrase-level test on its own, for the unit tables and the UI. No holder rule and no
 * acceptance here: validateOpinionLanguage applies those.
 */
export function findUnsupportedOpinionPhrases(text: string, normalisedSource: string): OpinionMatch[] {
  const note: Note = { id: "N-000", date: "2000-01-01", type: "other", author: { name: "", hcpc: "" }, subjective: normalisedSource, objective: "", assessment: "", plan: "" };
  const out: OpinionMatch[] = [];
  const seen = new Set<string>();
  for (const s of draftSentences(text, [])) {
    for (const raw of rawOpinionHits(s.norm)) {
      if (seen.has(raw.phrase)) continue;
      let ok = false as boolean;
      if (raw.pattern.allow) ok = (!raw.pattern.hook || hookEnabled(raw.pattern.hook)) && raw.pattern.allow(raw.hit, normalisedSource);
      if (!ok && (!raw.pattern.allow || raw.pattern.anchorToo)) ok = Boolean(findAnchor({ phrase: raw.phrase, sentence: clauseOf(s, raw), notes: [note], kind: raw.pattern.kind ?? "opinion" }));
      if (ok) continue;
      seen.add(raw.phrase);
      out.push({ label: raw.label, phrase: raw.phrase });
    }
  }
  return out;
}

/** Find `phrase` (normalised) in the original text, case-insensitively, for evidence/highlighting. */
function originalSpan(text: string, phrase: string): string {
  const idx = text.toLowerCase().indexOf(phrase);
  return idx >= 0 ? text.slice(idx, idx + phrase.length) : phrase;
}

/* ------------------------------------------------------------------------------------------------
 * Who wrote the text, and who may clear its flags
 * ----------------------------------------------------------------------------------------------*/

export type TextAuthorship = "drafted" | "person" | "approver" | "record";

/**
 * Whose words a paragraph is, for the opinion and attribution checks: drafted ("ai"); a person other than the approving
 * clinician – edited text, staff text, or a person's paragraph stamped (`by`) by someone who is not the approver
 * ("person": checked, only the approver may acknowledge); the approver's own words ("approver": a paragraph origin
 * "clinician" not stamped by anyone else – legacy paragraphs carry no stamp); values from the records ("record").
 *
 * bh2-rc1 (WB x WC): with its box (`section`), a person's paragraph in a box the approving clinician adopted
 * (core/provenance.ts adoptionCurrent: Section.adoptedBy by the approver, over exactly the box's present content) is the
 * approver's – the one audited Adopt (WC design 5) is the approver taking those words as their own – unless it keeps
 * drafted residue (core/provenance.ts paragraphResidue: a drafted sentence kept or pasted back keeps drafted-text
 * strictness; WC's Adopt leaves such a paragraph as it is). Changed since, it is a person's again. Drafted text stays
 * drafted, adopted or not.
 */
export function authorshipOf(
  p: Pick<Paragraph, "origin"> & { by?: { memberId: string } },
  report: Pick<Report, "approver">,
  section?: Pick<ReportSection, "answer" | "paragraphs" | "adoptedBy" | "tombstones">,
): TextAuthorship {
  const who = paragraphAuthorship(p, report);
  if (who === "person" && section && adoptionCurrent(section, report.approver ?? null) && "text" in p && paragraphResidue(section, p as Paragraph).length === 0) return "approver";
  return who;
}

function paragraphAuthorship(p: Pick<Paragraph, "origin"> & { by?: { memberId: string } }, report: Pick<Report, "approver">): TextAuthorship {
  switch (p.origin as string) {
    case "ai":
      return "drafted";
    case "edited":
    case "staff":
      return "person";
    case "from_records":
      return "record";
    case "clinician": {
      const by = p.by;
      if (by && report.approver && by.memberId !== report.approver.memberId) return "person";
      if (by && !report.approver) return "person";
      return "approver";
    }
    default:
      // An origin this build does not know (paragraph origins are an open set): checked, and only the approving
      // clinician may acknowledge it – never taken as the approver's own words (check-WB minor 2; design 4).
      return "person";
  }
}

/** True when a box is about work (so "no restrictions" there is a fitness opinion, not a daily-living restriction). */
function aboutWork(section: ReportSection, input: ValidatorInput): boolean {
  return /\b(?:work|duties|duty|employ\w*|job|occupation\w*|fit(?:ness)?)\b/i.test(`${section.title} ${input.form?.fields.find((f) => f.id === section.key)?.label ?? ""}`);
}

export function validateOpinionLanguage(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];
  const owner = voiceOwnerOf(input);
  const people = clinicianNames(input.bundle);

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p)) continue;
    const who = authorshipOf(p, input.report, section);
    if (who === "approver" || who === "record") continue;
    const judged = judgeParagraphOpinions({ paragraph: p, section, report: input.report, notes: input.bundle.notes, people, owner });
    const seen = new Set<string>();
    for (const { hits } of judged) {
      for (const h of hits) {
        if (h.anchor || h.accepted || seen.has(h.phrase)) continue;
        seen.add(h.phrase);
        const label = h.label === "fitness for work" && !aboutWork(section, input) ? "restrictions" : h.label;
        const evidence = originalSpan(p.text, h.phrase);
        const holderText = h.holder ? ` in a note ${h.holder} wrote` : h.holder === null ? " in a note by the approving clinician" : "";
        const flag = makeFlag({
          code: "OPINION_LANGUAGE",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence,
          message:
            who === "drafted"
              ? `Opinion wording (${label}) "${evidence}" is not in the cited record${holderText}. Drafted text may only attribute an opinion a clinician recorded – edit the paragraph.`
              : `Opinion wording (${label}) "${evidence}" is not in the cited record${holderText}. If this is the approving clinician's own opinion, they acknowledge it with a reason; otherwise reword it.`,
        });
        flag.ackPolicy = who === "drafted" ? "never" : "approver";
        const reason = who === "person" && p.origin === "edited" ? p.ackReason?.trim() : undefined;
        if (reason) flag.acknowledged = { reason, at: input.report.updatedAt };
        flags.push(flag);
      }
    }
    // Design 12 (C-3): a clinical negative no cited note records – a warning, never blocking (attribution-negatives.ts).
    flags.push(...unsupportedNegatives(p, section.key, input.bundle.notes));
  }
  return flags;
}
