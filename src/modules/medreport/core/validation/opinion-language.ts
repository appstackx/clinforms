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
 * Owner: ai agent.
 */
import type { ReportFlag } from "../types";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";
import { normaliseForMatch } from "./text";

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
}

const N = "\\d+(?:\\.\\d+)?";
const RANGE = `${N}(?: ?(?:-|to|or) ?${N})?`;
const PERIOD = "(?:days?|weeks?|months?|years?)";
const EVENT = "(?:accident|collision|crash|rta|incident|injury|index event|lifting incident|fall)";

/** The phrase list. Order matters only for the order of flags. */
export const OPINION_PATTERNS: readonly OpinionPattern[] = [
  // Recovery and prognosis
  { label: "recovery", re: /\b(?:full|complete|total)(?:ly)? recover(?:y|ed)\b/g },
  { label: "recovery", re: /\brecover(?:ed|s)? (?:fully|completely)\b/g },
  { label: "recovery", re: /\b(?:resolved|recovered|resolution)\b/g },
  { label: "recovery", re: /\b(?:back|return(?:ed|ing|s)?) to (?:his |her |their )?(?:normal|full fitness|pre-?(?:accident|injury|incident))\b/g },
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
  { label: "causation", re: /\bcaus(?:ed|ation|al|ally|ative)\b/g },
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
  { label: "balance of probabilities", re: /\bon balance\b/g },
  { label: "balance of probabilities", re: /\bin all (?:likelihood|probability)\b/g },

  // Fitness for work and restrictions
  { label: "fitness for work", re: /\b(?:un)?fit (?:for|to)\b[^.;:!?]{0,80}?\b(?:work|duties|duty|employment|job|role|shifts?)\b/g },
  { label: "fitness for work", re: /\b(?:no|without) (?:further |any )?(?:restrictions?|limitations?)\b/g },

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
      const supported = pattern.sourceRe ? pattern.sourceRe.test(normalisedSource) : normalisedSource.indexOf(phrase) >= 0;
      if (supported || seen.has(phrase)) continue;
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
