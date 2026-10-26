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
 *    questions", the question-kind tags – old and forms-9's, also on their own: "(clinician-opinion)", "Kind:
 *    record-narrative.") and self-corrections ("… wait,", "Actually, …", "Correction: …", "On reflection, …", "Let me
 *    check…") – in every sentence of the paragraph, not only its first (bh2 WD review M4). A self-correction inside
 *    quoted speech ("“it is sore, I mean, really sore”") is the patient's words, not the drafting's.
 *    The ordinary phrase "recorded opinion" is NOT meta ("Tom Ellis's recorded opinion on 06/05/2026 was…").
 *    holdBackMeta() takes out the smallest whole piece that holds it – a bracketed aside, a leading or trailing clause
 *    when what is left is still a sentence, else the whole sentence (with the broken lower-case run around it) – and
 *    returns it, so assembly shows it as an audited "Drafted text held back – check it" item. A RETRACTION – a later
 *    sentence that opens by correcting what came before ("… at discharge. Actually, that was at the first assessment
 *    …", "… Wait, that is from the first note.") – puts the sentences before it in doubt as well: they are held back
 *    with it (`retracted`), never printed as if the correction had not been made. The rest of the paragraph is kept
 *    and checked as drafted text: holding back meta-wording never lets an opinion beside it pass.
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

/**
 * "Yes – On 13/10/2026 …" → "Yes – on 13/10/2026 …"; a name or an acronym after the dash keeps its capital ("Yes – A&E
 * attendance …": the opener must be a whole word followed by a space).
 */
export function yesNoInWordsCase(text: string): string {
  return text.replace(new RegExp(`^((?:Yes|No)\\s*[–—-]\\s*)(${OPENERS})(?=\\s)`), (_m, lead: string, word: string) => `${lead}${word.toLowerCase()}`);
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
  // forms-9's tags, echoed with or without a noun after them: "(clinician-opinion)", "Kind: record-narrative.",
  // "a clinician opinion question".
  /\b(?:clinician-opinion|record-narrative)\b/i,
  /\b(?:clinician opinion|record narrative)\s+(?:questions?|box(?:es)?|kinds?|tags?)\b/i,
  /\bkind\s*[=:]\s*["“]?(?:clinician[- ]opinion|record[- ]narrative|recorded opinion only|narrative from the record)/i,
  /\bThese are [\w -]{0,40}questions\b/i,
  /\b(?:the|this) question kind\b/i,
];
/** Self-corrections: the drafting thinking aloud. */
const SELF_CORRECTION: readonly RegExp[] = [
  /(?:\.{3}|…)\s*(?:wait|hmm+|actually|no,|sorry|oops|correction|let me)\b/i,
  /^[([]?\s*(?:(?:no|oh|ok(?:ay)?|right|well|hmm+)\s*[,.!:;\u2013\u2014-]?\s*)?(?:wait|hmm+|actually|sorry|oops|correction|on reflection|on second thoughts?|scratch that|I mean)\b(?:\s*[,:;.!\u2013\u2014-]|\s+(?:that|this|it|no|not|the|I|he|she|they|there)\b)/i,
  /,\s*(?:actually|sorry|correction|I mean|wait)\s*[,:;\u2013\u2014-]/i,
  /,\s*or rather\b/i,
  /\blet me (?:check|re-?check|look again|re-?read|count|recount|think|correct)\b/i,
  /\bscratch that\b/i,
  /\bI (?:mean|meant),/,
];
/** A sentence that opens by correcting what came before it ("Actually, that was …", "Wait, that is from …"). */
const RETRACTION =
  /^[([]?\s*(?:(?:no|oh|ok(?:ay)?|right|well|hmm+)\s*[,.!:;\u2013\u2014-]?\s*)?(?:wait|hmm+|actually|sorry|oops|correction|on reflection|on second thoughts?|scratch that|I mean)\b(?:\s*[,:;.!\u2013\u2014-]|\s+(?:that|this|it|no|not|the|I|he|she|they|there)\b)/i;

/** Whether `text` opens by correcting what came before it – in an earlier paragraph too ("Actually, that was …"). */
export function opensWithRetraction(text: string): boolean {
  return hookEnabled(META_WORDING_HOOK) && RETRACTION.test(text.trim());
}

/** The [start, end) spans of quoted speech in `text` (“…”, ‘…’ spanning words, "…"). */
function quotedSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /“[^”]*”|"[^"]*"|‘[^’]*’(?![a-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** The first meta match in `text`: [start, end) of the matched words, or null. A self-correction in quoted speech is not one. */
export function metaMatch(text: string): { start: number; end: number } | null {
  for (const re of PROMPT_TERMS) {
    const m = re.exec(text);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  const quotes = quotedSpans(text);
  const quoted = (i: number) => quotes.some(([a, b]) => i > a && i < b);
  for (const re of SELF_CORRECTION) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      if (!quoted(m.index)) return { start: m.index, end: m.index + m[0].length };
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return null;
}

/** Whether `text` holds drafting meta-wording – in any of its sentences. */
export function hasMetaWording(text: string): boolean {
  return metaMatch(text) !== null || splitSentences(text, "notes").some((p) => metaMatch(p.text) !== null);
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
  /** What was held back as meta-wording, as written, in order. */
  heldBack: string[];
  /**
   * What was held back because the drafting retracted it: each a run of the sentences a retraction puts in doubt and
   * the retraction itself ("Lumbar movement was limited by 50% at discharge. Actually, that was at the first
   * assessment; …"), as written. Never printed; assembly shows it as its own audited item.
   */
  retracted: string[];
}

/**
 * Hold back drafting meta-wording (see the header). Unchanged – `heldBack` and `retracted` empty – when there is none,
 * or while the "meta-wording" hook is disabled.
 */
export function holdBackMeta(text: string): MetaHoldBack {
  if (!hookEnabled(META_WORDING_HOOK) || !hasMetaWording(text)) return { text, heldBack: [], retracted: [] };
  const pieces = splitSentences(text, "notes");
  const kept: string[] = pieces.map((p) => p.text);
  const asides = new Map<number, string>();
  const held = new Set<number>();
  const retracting = new Set<number>();
  pieces.forEach((p, i) => {
    if (metaMatch(p.text) === null) return;
    if (i > 0 && RETRACTION.test(p.text)) {
      // A retraction: it and every sentence before it, and the broken run after it.
      for (let j = 0; j <= i; j++) {
        held.add(j);
        asides.delete(j);
      }
      retracting.add(i);
      for (let j = i + 1; j < pieces.length && sentenceStartProblem(pieces[j]) !== undefined; j++) held.add(j);
      return;
    }
    if (held.has(i)) return;
    const part = metaPart(p.text);
    if (part.kept !== null && part.kept !== p.text) {
      kept[i] = part.kept;
      asides.set(i, part.held);
      return;
    }
    held.add(i);
    // The broken run around it: the fragments next to it (pieces that start in lower case or with a comma).
    for (let j = i - 1; j >= 0 && sentenceStartProblem(pieces[j]) !== undefined && sentenceStartProblem(pieces[j + 1]) !== undefined; j--) held.add(j);
    for (let j = i + 1; j < pieces.length && sentenceStartProblem(pieces[j]) !== undefined; j++) held.add(j);
  });
  const runs: Array<{ text: string; retracted: boolean }> = [];
  let run: string[] = [];
  let runRetracted = false;
  let out = "";
  let lastKept = -1;
  const close = () => {
    if (run.length) runs.push({ text: run.join(" "), retracted: runRetracted });
    run = [];
    runRetracted = false;
  };
  pieces.forEach((p, i) => {
    if (held.has(i)) {
      run.push(p.text);
      if (retracting.has(i)) runRetracted = true;
      return;
    }
    close();
    if (lastKept >= 0) out += text.slice(pieces[lastKept].end, p.start).includes("\n") ? "\n" : " ";
    out += kept[i];
    lastKept = i;
  });
  close();
  const keptAsides = Array.from(asides.entries())
    .filter(([i]) => !held.has(i))
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t);
  return {
    text: out.trim(),
    heldBack: [...runs.filter((r) => !r.retracted).map((r) => r.text), ...keptAsides],
    retracted: runs.filter((r) => r.retracted).map((r) => r.text),
  };
}
