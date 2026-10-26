/**
 * OPINION_LANGUAGE: wording that forms or firms up an opinion – recovery, permanence, causation,
 * "balance of probabilities", prognosis, timeframes, fitness for work, certainty, diagnosis labels,
 * credibility or liability – when the cited sources do not contain the same wording.
 *
 * - origin "ai": blocking, and cannot be acknowledged (edit the text instead).
 * - origin "edited": blocking until acknowledged with a reason (Paragraph.ackReason, or an
 *   acknowledgement on the flag).
 * - origin "clinician" / "from_records": not checked – the clinician's own opinion is theirs to give.
 *
 * A phrase is accepted when its normalised form (lower case, number words as digits, "wks" → "weeks")
 * appears in the normalised text of the cited sources, so an AI paragraph may quote a recorded opinion
 * ("fit for a phased return to normal duties over 2 weeks") but not strengthen it ("fit for normal
 * duties").
 *
 * 10/2026 (Blue Heart trial): ordinary clinical wording that only looks like an opinion is told apart
 * (OpinionPattern.allow). "Returned to normal duties" is a work status, not "returned to normal" (recovery):
 * it passes when a cited note records the same return as a fact ("then back on normal duties") and the drafted
 * text states that return ("he can return to normal duties" is a fitness opinion); "returned to normal during
 * work" stays recovery. "Without restrictions" equals a note's "no restrictions"; "worked on balance" is exercise
 * when the note records balance work; "drills caused mild discomfort" reports a note's "drills cause mild
 * discomfort". Every other match is unchanged.
 *
 * Owner: ai agent.
 */
import type { ReportFlag } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";
import { escapeRegExp, normaliseForMatch } from "./text";

/** A match in its paragraph: the phrase and the rest of its clause (normalised; a clause ends at , ; : . ! ? or a line break). */
export interface OpinionHit {
  phrase: string;
  before: string;
  after: string;
}

export interface OpinionPattern {
  /** Short category shown in the flag message. */
  label: string;
  /** Matched against the NORMALISED paragraph text (lower case, digits, single spaces, "-" dashes). */
  re: RegExp;
  /**
   * When set, the source passes if this matches the normalised cited text (stem-level match). When
   * unset, the matched phrase itself must appear in the normalised cited text.
   */
  sourceRe?: RegExp;
  /**
   * When set, also accepts a match the phrase test rejects: ordinary wording that only looks like this
   * opinion, or the same statement recorded in other words in the normalised cited text.
   */
  allow?(hit: OpinionHit, normalisedSource: string): boolean;
}

const N = "\\d+(?:\\.\\d+)?";
const RANGE = `${N}(?: ?(?:-|to|or) ?${N})?`;
const PERIOD = "(?:days?|weeks?|months?|years?)";
const EVENT = "(?:accident|collision|crash|rta|incident|injury|index event|lifting incident|fall)";

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

/** A note's words for a return that happened ("then back on normal duties", "resumed all his usual hobbies") or not. */
const RETURNED_IN_NOTE = "(?:back (?:on|to|at|in)|returned to|resumed|now on) (?:work (?:on|with) )?";
const NOT_RETURNED_IN_NOTE =
  "(?:(?:not|never|\\w+n't) (?:yet )?(?:back (?:on|to|at|in)|returned to|resumed)|yet to (?:return to|resume)) (?:work (?:on|with) )?";
const OWNER = "(?:his |her |their |the )?(?:all (?:his |her |their |the )?)?";
const FULL_LEVEL = "(?:normal|full|usual|regular|all|pre-?(?:accident|injury|incident))";
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
  /\b(?:not|\w+n't|never|yet|cannot|unable|should|would|could|may|might|will|must|(?:un)?likely|unrealistic|plan\w*|expect\w*|anticipat\w*|hop(?:e|es|ed|ing)|aim\w*|goals?|target\w*|until|unless|if|pending|due|other than)\b|^(?: ?:|,? (?:from|by|within|next|soon|for|but|except|apart|only|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|,? in (?:\d|a |an |the next |several )[^ ]* ?(?:days?|weeks?|months?|fortnight))|\?$/;

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
 */
function statusRecorded(hit: OpinionHit, source: string): boolean {
  const m = new RegExp(`\\b(?:(${DESCRIBER}) )?(${WORK}|${ACTIVITY})$`).exec(hit.phrase);
  if (!m) return false;
  const negated = NOT_RETURNED_DRAFT.test(hit.before);
  if (!negated && (/^return(?:s|ing)?\b/.test(hit.phrase) || NOT_A_FACT_DRAFT.test(hit.before))) return false;
  if (RECOVERY_SUBJECT.test(hit.before)) return false;
  const [, describer, noun] = m;
  const job = new RegExp(`^${JOB}$`).test(noun);
  const same = job ? JOB : `${noun.replace(/(?:ies|y|s)$/, "")}(?:ies|y|s)?`;
  const describers = describer && !PLAIN_DESCRIBER.test(describer) ? `${escapeRegExp(describer)} ` : `(?:${DESCRIBER} )?`;
  const doing = job ? `working normally|${WORKING_IN_FULL}` : noun === "hours" ? "working full[- ]time" : DOING_NORMALLY[noun] && `${DOING_NORMALLY[noun]} normally`;
  const recorded = negated
    ? `${NOT_RETURNED_IN_NOTE}${OWNER}(?:${FULL_LEVEL} )?${describers}${same}`
    : `${RETURNED_IN_NOTE}${OWNER}${FULL_LEVEL} ${describers}${same}${doing ? `|${doing}` : ""}`;
  return noteRecords(source, recorded);
}

/** The note side depends only on the note and the wording looked for, so it is remembered for the last note read. */
let rememberedNote: string | null = null;
const remembered = new Map<string, boolean>();

/** Whether `source` records `recorded` (a regex source) as a fact: no hedge, negation, modal or plan in its sentence. */
function noteRecords(source: string, recorded: string): boolean {
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
 * word either side of "caused", in the drafted text and in the note.
 */
function sameCausalWording(hit: OpinionHit, source: string): boolean {
  const prev = /([a-z0-9-]+) $/.exec(hit.before)?.[1];
  const next = /^ ([a-z0-9-]+)/.exec(hit.after)?.[1];
  if (hit.phrase !== "caused" || !prev || !next || FUNCTION_WORD.test(prev) || FUNCTION_WORD.test(next)) return false;
  return new RegExp(`\\b${escapeRegExp(prev)} caus(?:e|es|ed|ing) ${escapeRegExp(next)}\\b`).test(source);
}

/** The phrase list. Order matters only for the order of flags. */
export const OPINION_PATTERNS: readonly OpinionPattern[] = [
  // Recovery and prognosis
  { label: "recovery", re: /\b(?:full|complete|total)(?:ly)? recover(?:y|ed)\b/g },
  { label: "recovery", re: /\brecover(?:ed|s)? (?:fully|completely)\b/g },
  { label: "recovery", re: /\b(?:resolved|recovered|resolution)\b/g },
  {
    label: "recovery",
    re: new RegExp(
      `\\b(?:back|return(?:ed|ing|s)?) to (?:all )?(?:his |her |their )?(?:full fitness\\b|(?:normal|pre-?(?:accident|injury|incident))\\b(?!${STATUS_TAIL}))`,
      "g",
    ),
  },
  {
    label: "return to normal work or activity",
    re: new RegExp(`\\b(?:back|return(?:ed|ing|s)?) to (?:all )?(?:his |her |their )?(?:normal|pre-?(?:accident|injury|incident))${STATUS_TAIL}`, "g"),
    allow: statusRecorded,
  },
  { label: "prediction", re: /\bwill (?:make an? |go on to |continue to )?(?:recover|resolve|settle|improve|heal|return|be able|need|require|have|experience|suffer|remain|persist)\w*/g },
  { label: "prediction", re: /\b(?:should|would) (?:recover|resolve|settle|improve|heal)\w*/g },
  { label: "prediction", re: /\b(?:should|would|could|may|might) (?:now )?be (?:able|fit|ready|back)\b/g },
  { label: "prediction", re: /\b(?:expected|anticipated|predicted) to\b/g },
  { label: "prediction", re: /\b(?:is|are|was|were|seems?|appears?|remains?) (?:highly |very |most |quite )?(?:un)?likely\b/g },
  { label: "prediction", re: /\b(?:most|highly|very) likely\b/g },
  { label: "prediction", re: /\blikelihood\b/g },
  { label: "prognosis", re: /\bprognos(?:is|es|tic)\b/g },
  { label: "timeframe", re: new RegExp(`\\bwithin (?:the next |a further |another )?${RANGE} ${PERIOD}\\b`, "g") },
  { label: "timeframe", re: new RegExp(`\\bin (?:the next |a further |another )?${RANGE} ${PERIOD}'? time\\b`, "g") },
  { label: "timeframe", re: new RegExp(`\\b${RANGE} ${PERIOD} (?:from|after|post|following) (?:the )?${EVENT}\\b`, "g") },
  { label: "timeframe", re: new RegExp(`\\b${RANGE} ${PERIOD} post-${EVENT}\\b`, "g") },

  // Permanence
  { label: "permanence", re: /\bpermanent(?:ly)?\b/g },
  { label: "permanence", re: /\blong-? ?term\b/g },
  { label: "permanence", re: /\blife-? ?long\b/g },
  { label: "permanence", re: /\bindefinite(?:ly)?\b/g },
  { label: "permanence", re: /\bchronic\b/g },
  { label: "permanence", re: /\birreversible\b/g },

  // Causation
  { label: "causation", re: /\bcaus(?:ed|ation|al|ally|ative)\b/g, allow: sameCausalWording },
  { label: "causation", re: /\battribut(?:able|ed) to\b/g },
  { label: "causation", re: /\bas a (?:direct |likely |probable )?(?:result|consequence) of\b/g },
  { label: "causation", re: /\b(?:resulted|resulting|arising|arose|stem(?:s|med)?) from\b/g },
  { label: "causation", re: new RegExp(`\\bdue to (?:the |this |that |his |her |their )?${EVENT}\\b`, "g") },
  { label: "causation", re: /\bsecondary to\b/g },
  { label: "causation", re: new RegExp(`\\bconsistent with (?:the |this |that |his |her |their )?(?:reported )?(?:${EVENT}|mechanism)\\b`, "g") },
  { label: "causation", re: new RegExp(`\\b(?:${EVENT})-? ?related\\b`, "g") },
  { label: "causation", re: new RegExp(`\\brelated to (?:the |this |that |his |her |their )?${EVENT}\\b`, "g") },
  { label: "causation", re: /\bwould not have (?:occurred|happened|developed|arisen)\b/g },
  { label: "causation", re: /\bbut for\b/g },

  // Legal standard of proof
  { label: "balance of probabilities", re: /\b(?:on )?(?:the )?balance of probabilit(?:y|ies)\b/g },
  { label: "balance of probabilities", re: /\bmore (?:likely|probable) than not\b/g },
  { label: "balance of probabilities", re: /\bon balance\b/g, allow: exerciseOnBalance },
  { label: "balance of probabilities", re: /\bin all (?:likelihood|probability)\b/g },

  // Fitness for work and restrictions
  { label: "fitness for work", re: /\b(?:un)?fit (?:for|to)\b[^.;:!?]{0,80}?\b(?:work|duties|duty|employment|job|role|shifts?)\b/g },
  { label: "fitness for work", re: /\b(?:no|without) (?:further |any )?(?:restrictions?|limitations?)\b/g, allow: sameRestrictionWording },

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
  { label: "liability", re: /\b(?:negligen\w*|liab(?:le|ility)|at fault|to blame)\b/g },
];

export interface OpinionMatch {
  label: string;
  /** The phrase as matched in the normalised text. */
  phrase: string;
}

/** Opinion phrases in `text` that do not appear in `normalisedSource`. Pure; exported for tests and the UI. */
export function findUnsupportedOpinionPhrases(text: string, normalisedSource: string): OpinionMatch[] {
  const norm = normaliseForMatch(text);
  const out: OpinionMatch[] = [];
  const seen = new Set<string>();
  for (const pattern of OPINION_PATTERNS) {
    const re = new RegExp(pattern.re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const phrase = m[0].trim();
      if (seen.has(phrase)) continue;
      const quoted = pattern.sourceRe ? pattern.sourceRe.test(normalisedSource) : normalisedSource.indexOf(phrase) >= 0;
      if (quoted) continue;
      const end = m.index + m[0].length;
      const hit: OpinionHit = { phrase, before: textBefore(norm, m.index, CLAUSE_END), after: textAfter(norm, end, CLAUSE_END) };
      if (pattern.allow?.(hit, normalisedSource)) continue;
      seen.add(phrase);
      out.push({ label: pattern.label, phrase });
    }
  }
  return out;
}

/** Find `phrase` (normalised) in the original text, case-insensitively, for evidence/highlighting. */
function originalSpan(text: string, phrase: string): string {
  const idx = text.toLowerCase().indexOf(phrase);
  return idx >= 0 ? text.slice(idx, idx + phrase.length) : phrase;
}

export function validateOpinionLanguage(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];

  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p) || (p.origin !== "ai" && p.origin !== "edited")) continue;
    const cited = ctx.cited(p);
    for (const match of findUnsupportedOpinionPhrases(p.text, cited.normalisedText)) {
      const evidence = originalSpan(p.text, match.phrase);
      const flag = makeFlag({
        code: "OPINION_LANGUAGE",
        severity: "blocking",
        sectionKey: section.key,
        paragraphId: p.id,
        evidence,
        message:
          p.origin === "ai"
            ? `Opinion wording (${match.label}) "${evidence}" is not in the cited record. Drafted text may only attribute an opinion a clinician recorded – edit the paragraph.`
            : `Opinion wording (${match.label}) "${evidence}" is not in the cited record. If this is your own opinion, acknowledge it with a reason; otherwise reword it.`,
      });
      const reason = p.origin === "edited" ? p.ackReason?.trim() : undefined;
      if (reason) flag.acknowledged = { reason, at: input.report.updatedAt };
      flags.push(flag);
    }
  }
  return flags;
}
