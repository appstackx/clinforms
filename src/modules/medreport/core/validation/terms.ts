/**
 * TERM_NOT_IN_SOURCE: a clinical term from the notes must be written as the record or the clinic's
 * glossary writes it. Drafted text is checked against the full forms in CLINICAL_ABBREVIATIONS
 * (core/voice.ts) for every term the record uses (its abbreviation, e.g. "WAD", or its full form):
 * a phrase that matches the full form except for ONE word is a corrupted term when that word appears
 * nowhere in the record AND starts like the expected word or takes its place in the term's hyphenated
 * compound – "whale-associated disorder" for "whiplash-associated disorder" (WAD).
 *
 * Not flagged: the exact full form; another glossary term ("passive range of movement"); a glossary
 * term with a word in front of it ("full range of movement" contains "range of movement"); a word the
 * record itself uses ("tenderness to palpation" when the notes say "to"); a different ending of the same
 * word ("glide"/"glides", "low"/"lower"); a different phrase that shares words with a term ("a graded
 * exercise programme", "soft tissue massage", "home exercises were").
 *
 * Blocking, like an unsupported date: a wrong diagnosis or test name must not reach a signed report.
 * The signer can correct the wording (the flag clears) or acknowledge it with a reason.
 * Checks origin "ai" and "edited" text. Known limit: a corrupted word outside the glossary's terms is
 * not caught – click-to-source review and the signer's attestation cover it.
 *
 * Pure; browser and server. Owner: ai agent.
 */
import { CLINICAL_ABBREVIATIONS } from "../voice";
import type { ReportFlag } from "../types";
import { CHECKED_ORIGINS, getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

interface Token {
  word: string;
  start: number;
  end: number;
}

const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

function tokens(text: string): Token[] {
  const out: Token[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    out.push({ word: m[0].toLowerCase().replace(/[’]/g, "'").replace(/'s?$/, ""), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function wordsOf(text: string): string[] {
  return tokens(text).map((t) => t.word);
}

/** "glide"/"glides", "low"/"lower", "programme"/"program": a different ending, not a different word. */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.indexOf(short) === 0;
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((w, i) => sameStem(w, b[i]));
}

interface Term {
  abbreviation: string;
  fullForm: string;
  words: string[];
  /** Whether word k is joined to word k + 1 by a hyphen in the full form ("whiplash-associated"). */
  hyphenAfter: boolean[];
}

const TERMS: Term[] = CLINICAL_ABBREVIATIONS.map(([abbreviation, fullForm]) => {
  const toks = tokens(fullForm);
  return { abbreviation, fullForm, words: toks.map((t) => t.word), hyphenAfter: toks.map((t) => fullForm.charAt(t.end) === "-") };
}).filter((t) => t.words.length >= 2);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How the record uses the term: its abbreviation as a token, its full form, or not at all. */
function recordUses(term: Term, sourceText: string, sourceWords: string[]): "abbreviation" | "full" | null {
  if (new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term.abbreviation)}(?![A-Za-z0-9])`).test(sourceText)) return "abbreviation";
  const n = term.words.length;
  for (let i = 0; i + n <= sourceWords.length; i++) if (sameWords(sourceWords.slice(i, i + n), term.words)) return "full";
  return null;
}

export function validateTerms(input: ValidatorInput): ReportFlag[] {
  const ctx = getValidationContext(input);
  const checked = ctx.paragraphs.filter(({ paragraph: p }) => hasText(p) && CHECKED_ORIGINS.indexOf(p.origin) >= 0);
  if (checked.length === 0) return [];

  const sourceText = Array.from(ctx.sourceTexts.values()).join("\n");
  const sourceWords = wordsOf(sourceText);
  const vocabulary = new Set(sourceWords);
  const used = TERMS.map((term) => ({ term, as: recordUses(term, sourceText, sourceWords) })).filter((u) => u.as !== null);
  if (used.length === 0) return [];

  const flags: ReportFlag[] = [];
  for (const { paragraph: p, section } of checked) {
    const toks = tokens(p.text);
    const seen = new Set<string>();
    for (const { term, as } of used) {
      const n = term.words.length;
      for (let i = 0; i + n <= toks.length; i++) {
        const window = toks.slice(i, i + n).map((t) => t.word);
        const differ = window.map((w, k) => (sameStem(w, term.words[k]) ? -1 : k)).filter((k) => k >= 0);
        if (differ.length !== 1) continue;
        const k = differ[0];
        const odd = window[k];
        if (vocabulary.has(odd)) continue;
        // The signature of a corrupted term, not a different phrase ("a graded exercise programme",
        // "soft tissue massage"): the odd word starts like the expected one ("whale" / "whiplash"), or
        // takes its place inside the term's hyphenated compound ("whale-associated").
        const expected = term.words[k];
        const hyphenated = term.hyphenAfter[k] ? p.text.charAt(toks[i + k].end) === "-" : k > 0 && term.hyphenAfter[k - 1] && p.text.charAt(toks[i + k].start - 1) === "-";
        if (odd.slice(0, 2) !== expected.slice(0, 2) && !hyphenated) continue;
        const rest = window.filter((_, j) => j !== k);
        if (TERMS.some((other) => other !== term && (sameWords(window, other.words) || sameWords(rest, other.words)))) continue;
        const evidence = p.text.slice(toks[i].start, toks[i + n - 1].end);
        if (seen.has(evidence.toLowerCase())) continue;
        seen.add(evidence.toLowerCase());
        flags.push(
          makeFlag({
            code: "TERM_NOT_IN_SOURCE",
            severity: "blocking",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence,
            message: `"${evidence}" is not how the record writes this term: the notes use ${as === "abbreviation" ? `${term.abbreviation} (${term.fullForm})` : `"${term.fullForm}"`}, and "${odd}" appears nowhere in the record. Correct the wording against the note, or acknowledge it if it is right.`,
          }),
        );
      }
    }
  }
  return flags;
}
