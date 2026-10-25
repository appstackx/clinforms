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
 * it passes when a cited note records the same status as a fact ("back on normal duties"). "Without
 * restrictions" equals a note's "no restrictions"; "worked on balance" is exercise, not "on balance"; "drills
 * caused mild discomfort" reports a note's "drills cause mild discomfort". Every other match is unchanged.
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

const WORK = "(?:duties|duty|work|hours|shifts?|role|job|employment)";
const ACTIVITY = "(?:activities|activity|routine|hobbies|hobby|sports?|training|exercises?|gym|driving)";
/** One describing word may stand between: "normal working hours", "normal 12-hour shifts", "usual gym routine". */
const ONE_WORD = "(?:(?!(?:and|or|but|at|in|on|with|by|so|then|for|of|to|from|after|before)\\b)[a-z0-9-]+ )?";
/** What a "normal" or pre-injury level belongs to when it is a work or activity: " duties", " daily activities". */
const STATUS_TAIL = ` ${ONE_WORD}(?:${WORK}|${ACTIVITY})\\b`;
/** Wording a note uses for the same full level: "normal duties", "full duties", "usual training", "all activities". */
const FULL_LEVEL = "(?:normal|full|usual|regular|all|pre-?(?:accident|injury|incident))";

/**
 * Words that make a recorded status something other than a fact – negated, hedged, planned or hoped for – when
 * they come before it in its sentence: "not yet on full duties", "nearly back on normal duties", "should be able
 * to return to full duties", "graded return to full duties", "goal: normal training", "before the accident".
 */
const NOT_A_FACT =
  /\b(?:not|no longer|never|yet|unable|cannot|can't|won't|isn't|wasn't|hasn't|haven't|hadn't|should|would|will|could|may|might|must|expect\w*|anticipat\w*|aim\w*|goals?|plan\w*|hop(?:e|es|ed|ing)|want\w*|wish\w*|graded|phased|gradual\w*|towards?|until|if|unless|when|once|before|nearly|almost|mostly|largely|partly|partial\w*|some|target\w*|advis\w*|recommend\w*|request\w*|try\w*|attempt\w*|return(?:ing)? to|to return)\b/;

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

/** Whether the global `re` matches `source` at least once as a plain fact (nothing in NOT_A_FACT before it in its sentence). */
function recordedAsFact(source: string, re: RegExp): boolean {
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (!NOT_A_FACT.test(textBefore(source, m.index, SENTENCE_END))) return true;
  }
  return false;
}

/**
 * "Returned to normal duties" / "back to his normal training" states a work or activity status. It passes when
 * a cited note records that status at a full level, as a fact: "then back on normal duties" or "full duties"
 * supports "returned to normal duties", "driving normally" supports "returned to normal driving"; "back on light
 * duties", "not yet on full duties" or "should be able to return to full duties" do not. Work and activities are
 * not interchangeable.
 */
function statusRecorded(hit: OpinionHit, source: string): boolean {
  const work = new RegExp(`\\b${WORK}$`).test(hit.phrase);
  const nouns = work ? WORK : ACTIVITY;
  const verbs = work ? "working" : "(?:driving|training|exercising)";
  const status = new RegExp(`\\b(?:${FULL_LEVEL} ${ONE_WORD}${nouns}|${verbs} normally)\\b`, "g");
  return recordedAsFact(source.replace(HISTORY_FIELDS, ""), status);
}

/** "Without restrictions" and "with no restrictions" say the same; "no further restrictions" needs "further". */
function sameRestrictionWording(hit: OpinionHit, source: string): boolean {
  const m = /^(?:no|without) (further |any )?(restriction|limitation)s?$/.exec(hit.phrase);
  if (!m) return false;
  const qualifier = m[1] === "further " ? "further " : "(?:any |further )?";
  return new RegExp(`\\b(?:no|without) ${qualifier}${m[2]}s?\\b`).test(source);
}

const EXERCISE_WORD =
  "(?:work(?:s|ed|ing)?|focus(?:es|ed|sed|ing|sing)?|concentrat(?:e|es|ed|ing)|emphasis|exercises?|drills?|training|programme|progress(?:ed|ing)?|practi[sc](?:e|es|ed|ing))";

/**
 * "Worked on balance and strength", "focused on strengthening and on balance": exercise, not the standard of
 * proof – the exercise word comes straight before "on balance", or before a list of what was worked on.
 */
function exerciseOnBalance(hit: OpinionHit): boolean {
  if (new RegExp(`\\b${EXERCISE_WORD} $`).test(hit.before)) return true;
  return / (?:and|or) $/.test(hit.before) && new RegExp(`\\b${EXERCISE_WORD} on `).test(hit.before);
}

/** "Cutting drills caused mild discomfort" reports a note's "cutting drills cause mild discomfort" (same words either side). */
function sameCausalWording(hit: OpinionHit, source: string): boolean {
  const prev = /([a-z0-9-]+) $/.exec(hit.before)?.[1];
  const next = /^ ([a-z0-9-]+)/.exec(hit.after)?.[1];
  if (hit.phrase !== "caused" || !prev || !next) return false;
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
      `\\b(?:back|return(?:ed|ing|s)?) to (?:his |her |their )?(?:full fitness\\b|(?:normal|pre-?(?:accident|injury|incident))\\b(?!${STATUS_TAIL}))`,
      "g",
    ),
  },
  {
    label: "return to normal work or activity",
    re: new RegExp(`\\b(?:back|return(?:ed|ing|s)?) to (?:his |her |their )?(?:normal|pre-?(?:accident|injury|incident))${STATUS_TAIL}`, "g"),
    allow: statusRecorded,
  },
  { label: "prediction", re: /\bwill (?:make an? |go on to |continue to )?(?:recover|resolve|settle|improve|heal|return|be able|need|require|have|experience|suffer|remain|persist)\w*/g },
  { label: "prediction", re: /\b(?:should|would) (?:recover|resolve|settle|improve|heal)\w*/g },
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
