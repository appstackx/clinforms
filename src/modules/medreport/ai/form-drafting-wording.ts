/**
 * Drafting assembly – what happens to drafted wording between the model and the review (bh2 WD design 1 and 3).
 *
 * 1. No grammar rewriting. Assembly no longer runs core/voice.ts plainClinicalWording on drafted paragraphs: a
 *    hand-written English grammar cannot tell an event from a state, so "On 15/07/2026 I recorded that Mr Ellery took 3
 *    days off work after the accident" became "On 15/07/2026, Mr Ellery took 3 days off…" (B3-4) and other rewrites left
 *    fragments (B1-3, B2-6). What stays are pinned, token-level substitutions that keep the meaning – each idempotent,
 *    and each keeps every figure, date, negation and clinician name (property tests in form-drafting-wording.test.ts):
 *    - explicitRecorderSubject: "I recorded that X, and noted Y" → "I recorded that X, and I noted Y" (the subject the
 *      two verbs share, written once more so the second clause cannot be read as part of X – B2-6);
 *    - yesNoInWordsCase: "Yes – On 13/10/2026 Tom Ellis…" → "Yes – on 13/10/2026 Tom Ellis…" (B3-23);
 *    - noneMissed: "None – 0 sessions missed" → "None" (B3-23).
 *    They run only while the ledger hook "plain-wording" is enabled (core/validation/hooks.ts).
 *
 * 2. Meta-wording is held back, never dropped (R-regression-1, B2-9). META matches only the drafting prompt's own
 *    terms ("recorded opinion only", "narrative from the record", "recorded-opinion questions", "These are …
 *    questions", the question-kind tags) and mid-text self-corrections ("… wait,", "Actually, …", "Let me check…").
 *    The ordinary phrase "recorded opinion" is NOT meta ("Tom Ellis's recorded opinion on 06/05/2026 was…").
 *    holdBackMeta() takes out the smallest whole piece that holds it – a bracketed aside, a leading or trailing clause
 *    when what is left is still a sentence, else the whole sentence (with the broken lower-case run around it) – and
 *    returns it, so assembly shows it as an audited "Drafted text held back – check it" item. The rest of the
 *    paragraph is kept and checked as drafted text: holding back meta-wording never lets an opinion beside it pass.
 *    Ledger hook "meta-wording".
 *
 * Pure; browser and server.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { sentenceStartProblem, splitSentences } from "../core/text/sentences";
import { defineHook, hookEnabled } from "../core/validation/hooks";

/** Ledger hook "plain-wording" (prestrip): the pinned token-level substitutions above. */
export const PLAIN_WORDING_HOOK = defineHook("plain-wording");
/** Ledger hook "meta-wording" (prestrip): holding back drafting meta-wording. */
export const META_WORDING_HOOK = defineHook("meta-wording");

/* ------------------------------------------------------------------------------------------------
 * 1. Pinned token-level substitutions
 * ----------------------------------------------------------------------------------------------*/

const RECORD_VERB = "recorded|noted|observed|found|documented|assessed|measured|examined";

/**
 * "I recorded that the symptoms were consistent with lifting, and noted mild stiffness" → "…, and I noted mild
 * stiffness". Only in a sentence whose subject is the first person "I <verb> that …"; nothing else changes.
 */
export function explicitRecorderSubject(text: string): string {
  const re = new RegExp(`(\\bI (?:${RECORD_VERB}) that\\b[^.;]*?,\\s+and\\s+)((?:also\\s+)?(?:${RECORD_VERB})\\b)`, "g");
  return text.replace(re, (_m, lead: string, verb: string) => `${lead}I ${verb}`);
}

/** Capitalised words that open a sentence without naming anyone (they take lower case after "Yes – "). */
const OPENERS = "On|At|The|This|That|These|Those|In|A|An|His|Her|Their|He|She|They|It|There|From|After|Before|Since|During|When|Both|All|Some|No|Not|Mild|Moderate|Severe";

/** "Yes – On 13/10/2026 …" → "Yes – on 13/10/2026 …"; a name or acronym after the dash keeps its capital. */
export function yesNoInWordsCase(text: string): string {
  return text.replace(new RegExp(`^((?:Yes|No)\\s*[–—-]\\s*)(${OPENERS})\\b`), (_m, lead: string, word: string) => `${lead}${word.toLowerCase()}`);
}

/** "None – 0 sessions missed" (a zero count restating "None") → "None". Exact shapes only. */
export function noneMissed(text: string): string {
  return /^None\s*[–—-]\s*(?:0|no|zero)\s+(?:sessions?|appointments?|visits?)\s+(?:were\s+)?(?:missed|cancelled|not attended)\.?$/i.test(text.trim()) ? "None" : text;
}

/** The pinned substitutions, in order (idempotent). */
export function pinnedWording(text: string): string {
  if (!hookEnabled(PLAIN_WORDING_HOOK)) return text;
  return noneMissed(yesNoInWordsCase(explicitRecorderSubject(text)));
}

/* ------------------------------------------------------------------------------------------------
 * 2. Meta-wording
 * ----------------------------------------------------------------------------------------------*/

/** The drafting prompt's own terms (ai/form-prompts.ts) and its question-kind tags, old and new. */
const PROMPT_TERMS: readonly RegExp[] = [
  /\brecorded[- ]opinion only\b/i,
  /\brecorded-opinion\b/i,
  /\bnarrative from the record\b/i,
  /\b(?:clinician-opinion|record-narrative) (?:question|box|kind)s?\b/i,
  /\bkind\s*=\s*["“]?(?:clinician-opinion|record-narrative|recorded opinion only|narrative from the record)/i,
  /\bThese are [\w -]{0,40}questions\b/i,
  /\b(?:the|this) question kind\b/i,
];
/** Mid-text self-corrections: the drafting thinking aloud. */
const SELF_CORRECTION: readonly RegExp[] = [
  /(?:\.{3}|…)\s*(?:wait|hmm+|actually|no,|sorry|oops|correction|let me)\b/i,
  /^(?:wait|hmm+|actually|sorry|oops|correction|on reflection|on second thoughts?)\b\s*[,:;.-]/i,
  /\blet me (?:check|re-?check|look again|re-?read|count|recount|think|correct)\b/i,
  /\bscratch that\b/i,
  /\bI (?:mean|meant),/,
];

/** The first meta match in `text`: [start, end) of the matched words, or null. */
export function metaMatch(text: string): { start: number; end: number } | null {
  for (const re of [...PROMPT_TERMS, ...SELF_CORRECTION]) {
    const m = re.exec(text);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/** Whether `text` holds drafting meta-wording. */
export function hasMetaWording(text: string): boolean {
  return metaMatch(text) !== null;
}

/** The bracketed aside "( … )" around [start, end), if the piece has one. */
function bracketAround(piece: string, start: number, end: number): { start: number; end: number } | null {
  const open = piece.lastIndexOf("(", start);
  const close = piece.indexOf(")", end);
  if (open < 0 || close < 0 || piece.slice(open, close).includes(")") || piece.slice(open + 1, start).includes("(")) return null;
  return { start: open, end: close + 1 };
}

/** What is left of a piece without [start, end), tidied; null when it is no longer a sentence on its own. */
function remainder(piece: string, start: number, end: number): string | null {
  const rest = `${piece.slice(0, start)} ${piece.slice(end)}`.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,;:–-]+/, "").trim();
  if (!/[A-Za-z]/.test(rest)) return null;
  if (sentenceStartProblem(rest) !== undefined) return null;
  return rest;
}

/**
 * The smallest removable part of one sentence-piece holding meta-wording: a bracketed aside, a leading clause up to its
 * first comma or a trailing clause after its last comma – when what is left is still a sentence – else the whole piece.
 */
function metaPart(piece: string): { kept: string | null; held: string } {
  const m = metaMatch(piece);
  if (!m) return { kept: piece, held: "" };
  const bracket = bracketAround(piece, m.start, m.end);
  if (bracket) {
    const rest = remainder(piece, bracket.start, bracket.end);
    if (rest) return { kept: rest, held: piece.slice(bracket.start, bracket.end) };
  }
  const firstComma = piece.indexOf(",");
  if (firstComma > 0 && m.end <= firstComma) {
    const rest = remainder(piece, 0, firstComma + 1);
    if (rest) return { kept: rest, held: piece.slice(0, firstComma + 1).trim() };
  }
  const lastComma = piece.lastIndexOf(",");
  if (lastComma > 0 && m.start > lastComma) {
    const head = piece.slice(0, lastComma).trim();
    const rest = head && sentenceStartProblem(head) === undefined ? `${head.replace(/[,;:\s]+$/, "")}.` : null;
    if (rest) return { kept: rest, held: piece.slice(lastComma + 1).trim() };
  }
  return { kept: null, held: piece };
}

export interface MetaHoldBack {
  /** The text that stays (may be ""). */
  text: string;
  /** What was held back, as written, in order. */
  heldBack: string[];
}

/**
 * Hold back drafting meta-wording (see the header). Unchanged – `heldBack` empty – when there is none, or while the
 * "meta-wording" hook is disabled.
 */
export function holdBackMeta(text: string): MetaHoldBack {
  if (!hookEnabled(META_WORDING_HOOK) || !hasMetaWording(text)) return { text, heldBack: [] };
  const pieces = splitSentences(text, "notes");
  const kept: string[] = pieces.map((p) => p.text);
  const asides: string[] = [];
  const held = new Set<number>();
  pieces.forEach((p, i) => {
    if (!hasMetaWording(p.text)) return;
    const part = metaPart(p.text);
    if (part.kept !== null && part.kept !== p.text) {
      kept[i] = part.kept;
      asides.push(part.held);
      return;
    }
    held.add(i);
    // The broken run around it: the fragments next to it (pieces that start in lower case or with a comma).
    for (let j = i - 1; j >= 0 && sentenceStartProblem(pieces[j]) !== undefined && sentenceStartProblem(pieces[j + 1]) !== undefined; j--) held.add(j);
    for (let j = i + 1; j < pieces.length && sentenceStartProblem(pieces[j]) !== undefined; j++) held.add(j);
  });
  const runs: string[] = [];
  let run: string[] = [];
  let out = "";
  let lastKept = -1;
  pieces.forEach((p, i) => {
    if (held.has(i)) {
      run.push(p.text);
      return;
    }
    if (run.length) runs.push(run.join(" "));
    run = [];
    if (lastKept >= 0) out += text.slice(pieces[lastKept].end, p.start).includes("\n") ? "\n" : " ";
    out += kept[i];
    lastKept = i;
  });
  if (run.length) runs.push(run.join(" "));
  return { text: out.trim(), heldBack: [...runs, ...asides] };
}
