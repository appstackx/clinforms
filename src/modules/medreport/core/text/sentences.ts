/**
 * The shared sentence tokenizer and the safe-edit primitives (bh-quality plan W0.5; pure, browser and server).
 *
 * Why one tokenizer: the drafting, review and scope code each split text with their own `/[^.!?]+/`
 * regex. A decimal point ends a "sentence" there, so "a score of 8.0, a mild ache" became "…of 8." plus
 * "0, a mild ache", and every one-click fix built on that split could print a fragment or change a figure.
 * This module is the single replacement. No caller is switched here; the owning workstreams switch their
 * copies (draft-fit, review fixes, voice, scope with the notes policy, assemble) to it.
 *
 * splitSentences(text, policy) returns spans with offsets (`text === source.slice(start, end)`). It never
 * splits:
 *   - inside a number, figure or date ("8.0, a mild ache", "52.3 to 29.5", "VAS 6.5/10", "60.5%",
 *     "1.5cm", "08.09.2026", "10.30am") – a stop only ends a sentence when white space follows it;
 *   - after Mr., Mrs., Ms., Mx., Dr., Prof., Rev., Sr. or St. before a name, or an inline abbreviation
 *     (e.g., i.e., approx., cf., vs., incl., esp., NB.), or after no./fig./ref./a month before a number
 *     ("no. 5", "No. of sessions", "8 Sept. 2026");
 *   - after a single initial before a name ("T. Ellis"; not "L." or "R.", which are sides in notes), or a
 *     lettered list marker ("a. neck", "a. Neck pain b. Back pain");
 *   - at a list marker ("1. Bridges 2. Clams", a line starting "2." or "- "), and never inside a range or
 *     a comma list ("3–5 sessions"); a numbered list on one line stays one sentence even with stops between
 *     its items ("Goals: 1. Walk 5km. 2. Return to work.");
 *   - inside a matched pair of quotes or brackets on the same line (an unmatched quote or an apostrophe
 *     protects nothing), nor before a figure right after one ("(Rest advised.) 3 sessions…");
 *   - at an ellipsis standing between spaces, which marks left-out words ("52.3 to 29.5 … 2.7 to 5.3").
 * It does split at "…at rest. He reported…", "…10/10. Pain eased.", before a figure ("…46%. 2 weeks
 * later…", "…in week 1. 2 sessions…" – digits apart from each other are not one number), at a blank line,
 * at a line that starts a bullet or numbered item, after a heading line ending in ":", and at "  • " bullets
 * inside a line.
 *
 * Policies:
 *   - "prose" (drafted answers, typed text): a stop followed by a lower-case word does not end a sentence
 *     (it is usually an abbreviation the lists do not know); a single line break followed by a lower-case
 *     word is a wrapped line, not a new sentence.
 *   - "notes" (terse clinic-system notes): also splits at ". " followed by lower case ("pain 3/10 at rest.
 *     prev back injury 2019, settled. gym 2x/wk." is 3 sentences), and at every line break. Decimals,
 *     dates, titles and inline abbreviations still never split, nor do a few note abbreviations before a
 *     lower-case word ("pt. reports…", "pain ant. knee").
 *   "No." ends a sentence when it is the answer "no" ("Red flags: no. He…"); it never does as "number"
 *   ("no. 5", "No. of sessions").
 *
 * Safe-edit primitives (used by the one-click engine, review/fixes.ts planFix, and by any code that removes
 * or rewrites sentences):
 *   - removeSentences(): removes whole sentences and rejoins the text (the stronger separator is kept, so a
 *     paragraph break is never lost) and returns the removed spans;
 *   - expandToSentences(), sentenceAt(), isSentenceStart(), mapSentences(), sentenceTexts();
 *   - figuresOf() / figureChanges(): figures and dates, compared as multisets – after = before minus the
 *     removed spans (plus any text a fix declares it added);
 *   - sentenceStartProblem(): a sentence starting in lower case, with a digit, a comma or other punctuation;
 *   - checkSafeEdit(): the text-level rules of the one-click engine in one call – whole sentences only,
 *     figures and dates kept, no new sentence with a bad start, no orphaned "He/She recorded …" whose
 *     naming sentence was removed. Domain rules (the box's only answer, clinical negatives, the repeated
 *     twin, re-validation) stay with the engine.
 *   - sentenceKey(): the canonical form of a sentence for comparing and hashing (Section.accepted
 *     sentenceSha, drafted-sentence provenance).
 */

export type SentencePolicy = "prose" | "notes";

/** A slice of a text: `text === source.slice(start, end)`. */
export interface TextSpan {
  /** Offset of the first character (inclusive). */
  readonly start: number;
  /** Offset after the last character (exclusive). */
  readonly end: number;
  readonly text: string;
}

/** One sentence (or list item, or heading line) of a text. Never empty, never starts or ends with white space. */
export interface SentenceSpan extends TextSpan {
  /** Position in the split (0-based). */
  readonly index: number;
  /** Offset where the words start: after the list marker and its space, else `start`. */
  readonly bodyStart: number;
  /** The bullet or list marker that opens the item ("-", "•", "1.", "2)", "(a)"), if any. */
  readonly marker?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Character classes and abbreviation lists
 * ----------------------------------------------------------------------------------------------*/

const TERMINALS = ".!?\u2026"; // . ! ? …
/** Closing quotes and brackets that may follow the stop ('rest." He', 'note.) He'). */
const CLOSERS = "\"\u201D\u2019')]}";
/** Opening quotes and brackets: a sentence may start with one. */
const OPENERS = "\"\u201C\u2018'([{";
/** Bullet characters that start an item anywhere on a line ("Neck pain • Back pain"). */
const INLINE_BULLETS = "\u2022\u25AA\u25E6\u2023"; // • ▪ ◦ ‣
/** Characters after a stop (and white space) that start a new sentence, besides letters and digits. */
const NEXT_STARTERS = "#\u00A3$\u20AC~?"; // "#" (fracture), £, $, €, "~6 sessions", "?fracture"
/** Dashes and bullets that, followed by a space, start an item. */
const DASH_BULLETS = "-*\u2013\u2014\u00B7" + INLINE_BULLETS;

/** A list or bullet marker at the start of a line (followed by white space). */
const LINE_MARKER = /^(?:[-*\u2022\u25AA\u25E6\u2023\u2013\u2014\u00B7]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\([A-Za-z]\)|\([ivx]{1,4}\)|[ivx]{1,4}[.)])(?=\s)/;
/** A bullet that starts an item anywhere. */
const INLINE_MARKER = /^[\u2022\u25AA\u25E6\u2023](?=\s)/;

/** Titles before a name: never end a sentence. */
const TITLES: readonly string[] = ["mr", "mrs", "ms", "mx", "dr", "prof", "rev", "sr", "st"];
/** Abbreviations that are always followed by more of the same sentence. Compared lower case, with and without dots. */
const INLINE_ABBREVIATIONS: readonly string[] = ["e.g", "eg", "i.e", "ie", "approx", "appx", "cf", "viz", "vs", "incl", "esp", "nb", "n.b", "ca", "re", "wrt", "w.r.t", "aka", "a.k.a"];
/** Abbreviations that do not end a sentence when a number follows ("no. 5", "Sept. 2026"); "no." also before "of". */
const BEFORE_NUMBER: readonly string[] = ["no", "nos", "fig", "figs", "ref", "tel", "ext", "vol", "pp", "para", "paras", "sect", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];
/**
 * Note abbreviations that are usually followed by more of the same note ("pt. reports…", "pain ant. knee",
 * "9 a.m. on Monday"): under the notes policy they do not end a sentence before a lower-case word. Anything
 * else ("etc.", units such as "wk." or "min.") is an ordinary word: it ends a sentence before a capital or a
 * figure, and in notes before a lower-case word too.
 */
const NOTES_CLAUSE_ABBREVIATIONS: readonly string[] = [
  "pt", "pts", "obs", "imp", "rx", "tx", "hx", "dx", "sx", "prev", "poss", "bilat", "lat", "med", "ant", "post",
  "sup", "inf", "a.m", "p.m",
];

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}
function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}
function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ch.length > 0 && ch.toLowerCase() !== ch.toUpperCase();
}
function isLower(ch: string | undefined): boolean {
  return isLetter(ch) && ch === ch!.toLowerCase();
}
function isUpper(ch: string | undefined): boolean {
  return isLetter(ch) && ch === ch!.toUpperCase();
}
function inSet(chars: string, ch: string | undefined): boolean {
  return ch !== undefined && ch.length === 1 && chars.indexOf(ch) >= 0;
}

/* ------------------------------------------------------------------------------------------------
 * Quotes and brackets
 * ----------------------------------------------------------------------------------------------*/

interface OpenMark {
  closer: string;
  at: number;
}

/**
 * Positions where a sentence may not be cut because they lie inside a matched pair of quotes or brackets
 * on one line: `guard[p] === 1` for open < p <= close. An unmatched opener (or an apostrophe) protects
 * nothing, so one stray quote cannot swallow the rest of a paragraph.
 */
function guardedPositions(text: string): Uint8Array {
  const n = text.length;
  const guard = new Uint8Array(n + 1);
  let stack: OpenMark[] = [];
  const closeTop = (closer: string, at: number): boolean => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].closer !== closer) continue;
      for (let p = stack[k].at + 1; p <= at; p++) guard[p] = 1;
      stack = stack.slice(0, k);
      return true;
    }
    return false;
  };
  const hasOpen = (closer: string) => stack.some((m) => m.closer === closer);
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : undefined;
    const next = i + 1 < n ? text[i + 1] : undefined;
    const prevOpens = prev === undefined || isSpace(prev) || inSet(OPENERS, prev) || inSet("-\u2013\u2014/", prev);
    if (ch === "\n") {
      stack = []; // pairs never span a line break
    } else if (ch === "(") stack.push({ closer: ")", at: i });
    else if (ch === "[") stack.push({ closer: "]", at: i });
    else if (ch === "{") stack.push({ closer: "}", at: i });
    else if (ch === ")" || ch === "]" || ch === "}") closeTop(ch, i);
    else if (ch === "\u201C") stack.push({ closer: "\u201D", at: i });
    else if (ch === "\u201D") closeTop("\u201D", i);
    else if (ch === "\u2018") {
      if (next !== undefined && !isSpace(next)) stack.push({ closer: "\u2019", at: i });
    } else if (ch === "\u2019") {
      // "Tom’s" is an apostrophe; a closing quote is followed by a space, punctuation or the end.
      if (hasOpen("\u2019") && !isLetter(next) && !isDigit(next)) closeTop("\u2019", i);
    } else if (ch === '"') {
      if (hasOpen('"')) closeTop('"', i);
      else if (prevOpens && next !== undefined && !isSpace(next)) stack.push({ closer: '"', at: i });
    } else if (ch === "'") {
      if (hasOpen("'") && prev !== undefined && !isSpace(prev) && !isLetter(next) && !isDigit(next)) closeTop("'", i);
      else if (prevOpens && (isLetter(next) || isDigit(next))) stack.push({ closer: "'", at: i });
    }
  }
  return guard;
}

/* ------------------------------------------------------------------------------------------------
 * The splitter
 * ----------------------------------------------------------------------------------------------*/

interface ScanState {
  readonly text: string;
  readonly policy: SentencePolicy;
  /** Offset after the last line break before the current position. */
  lineStart: number;
  /** Offset of the last cut (where the current sentence began). */
  segStart: number;
  /** The last numeric list marker recognised: its number, the line it is on and the offset of its digits. */
  lastMarker: { num: number; lineStart: number; at: number } | null;
  /** The last lettered list marker recognised ("a.", "b."), likewise. */
  lastLetter: { code: number; lineStart: number; at: number } | null;
  /** Offsets of recognised numeric list markers (the digit), so a span starting there gets the marker. */
  readonly markerAt: Set<number>;
}

/** The token before the stop at `i`, without leading quotes or brackets, and where it starts. */
function tokenBefore(text: string, i: number): { tok: string; tokStart: number } {
  let k = i;
  while (k > 0 && !isSpace(text[k - 1])) k--;
  while (k < i && inSet(OPENERS, text[k])) k++;
  return { tok: text.slice(k, i), tokStart: k };
}

/** The trailing word of a token, letters with inner dots: "2x/wk" → "wk", "e.g" → "e.g", "10/10" → "". */
function alphaTail(tok: string): string {
  const m = /[A-Za-z\u00C0-\u024F](?:[A-Za-z\u00C0-\u024F]|\.(?=[A-Za-z\u00C0-\u024F]))*$/.exec(tok);
  return m ? m[0] : "";
}

/** Whether only spaces or tabs lie between the line start and `pos`. */
function onlyIndentBefore(text: string, lineStart: number, pos: number): boolean {
  for (let k = lineStart; k < pos; k++) if (text[k] !== " " && text[k] !== "\t") return false;
  return true;
}

/** Whether `next` (at offset b) starts a new sentence after an ordinary stop. */
function startsNewSentence(text: string, b: number, policy: SentencePolicy): boolean {
  const next = text[b];
  if (isUpper(next) || isDigit(next) || inSet(OPENERS, next) || inSet(NEXT_STARTERS, next)) return true;
  if (inSet(DASH_BULLETS, next) && isSpace(text[b + 1])) return true;
  return policy === "notes" && isLower(next);
}

/** A bare number "1"–"99" before a stop is a list marker: at a line start, "1." after a colon with "2." later on the line, or the next number of a list on this line. */
function isListMarker(st: ScanState, tokStart: number, num: number, stopAt: number): boolean {
  const { text } = st;
  if (onlyIndentBefore(text, st.lineStart, tokStart)) return true;
  if (st.lastMarker && st.lastMarker.lineStart === st.lineStart && st.lastMarker.num === num - 1) return true;
  if (num !== 1) return false;
  let k = tokStart;
  while (k > st.lineStart && isSpace(text[k - 1])) k--;
  if (k === tokStart || (text[k - 1] !== ":" && text[k - 1] !== ";")) return false;
  const lineEnd = text.indexOf("\n", stopAt);
  return /(?:^|\s)2[.)]\s/.test(text.slice(stopAt + 1, lineEnd < 0 ? text.length : lineEnd));
}

/** A lower-case letter before a stop is a list marker: at a line start, "a." after a colon with "b." later on the line, or the next letter of a list on this line. */
function isLetterMarker(st: ScanState, tokStart: number, letter: string, stopAt: number): boolean {
  const { text } = st;
  const code = letter.charCodeAt(0);
  const prev = st.lastLetter;
  const lineEnd = text.indexOf("\n", stopAt);
  const restOfLine = text.slice(stopAt + 1, lineEnd < 0 ? text.length : lineEnd);
  const ok =
    onlyIndentBefore(text, st.lineStart, tokStart) ||
    (prev !== null && prev.lineStart === st.lineStart && prev.at >= st.segStart && prev.code + 1 === code) ||
    (letter === "a" && /[:;]\s*$/.test(text.slice(st.lineStart, tokStart)) && /(?:^|\s)b[.)]\s/.test(restOfLine));
  if (ok) st.lastLetter = { code, lineStart: st.lineStart, at: tokStart };
  return ok;
}

/**
 * Whether the single "." at `i` ends a sentence, given the first character after the white space at `b`.
 * `policy` decides lower-case continuations. Records the numbered or lettered list markers it recognises.
 */
function periodEndsSentence(st: ScanState, i: number, b: number, policy: SentencePolicy): boolean {
  const { text } = st;
  const next = text[b];
  const { tok, tokStart } = tokenBefore(text, i);
  const word = alphaTail(tok);
  if (word) {
    const lw = word.toLowerCase();
    const bare = lw.replace(/\./g, "");
    if (TITLES.indexOf(bare) >= 0 && tok === word) return false;
    if (INLINE_ABBREVIATIONS.indexOf(lw) >= 0 || INLINE_ABBREVIATIONS.indexOf(bare) >= 0) return false;
    if (BEFORE_NUMBER.indexOf(bare) >= 0) {
      if (isDigit(next) || next === "#") return false;
      if ((bare === "no" || bare === "nos") && /^of\b/i.test(text.slice(b))) return false;
    }
    if (word.length === 1 && tok === word) {
      if (isLower(word)) {
        if (!isUpper(next)) return false; // "a. neck", "c. 6 weeks"
        if (isLetterMarker(st, tokStart, word, i)) return false; // "a. Neck pain b. Back pain"
      } else if (isUpper(next) && word !== "L" && word !== "R") return false; // an initial: "T. Ellis" ("38° R. Palpation…" is a side)
    }
    if (/^[A-Z]\.[A-Z]$/.test(word) && tok === word && isUpper(next)) return false; // "J.R. Ellis"
    if (policy === "notes" && isLower(next) && (NOTES_CLAUSE_ABBREVIATIONS.indexOf(lw) >= 0 || NOTES_CLAUSE_ABBREVIATIONS.indexOf(bare) >= 0)) return false;
  } else if (/^\d{1,2}$/.test(tok)) {
    const num = Number(tok);
    if (isListMarker(st, tokStart, num, i)) {
      st.lastMarker = { num, lineStart: st.lineStart, at: tokStart };
      st.markerAt.add(tokStart);
      return false;
    }
  }
  return startsNewSentence(text, b, policy);
}

/** Whether a list that started on this line inside the current sentence goes on at `b` with its next number ("1. Walk 5km. 2. Return…"). */
function listGoesOn(st: ScanState, b: number): boolean {
  const m = st.lastMarker;
  if (!m || m.lineStart !== st.lineStart || m.at < st.segStart) return false;
  const next = /^(\d{1,2})[.)]\s/.exec(st.text.slice(b, b + 4));
  return next !== null && Number(next[1]) === m.num + 1;
}

/**
 * Whether the run of stops text[i, termEnd) ends a sentence before the character at `b`. `closed` is true when
 * a closing quote or bracket follows the stop: then only a capital, an opening quote or a bullet starts a new
 * sentence ("(Rest advised.) He…"), not a figure.
 */
function stopEndsSentence(st: ScanState, i: number, termEnd: number, b: number, policy: SentencePolicy, closed: boolean): boolean {
  const { text } = st;
  if (listGoesOn(st, b)) return false;
  const run = text.slice(i, termEnd);
  const next = text[b];
  const capitalNext = isUpper(next) || inSet(OPENERS, next) || (inSet(DASH_BULLETS, next) && isSpace(text[b + 1]));
  if (/^[.\u2026]+$/.test(run) && run !== ".") {
    // An ellipsis: a new sentence only before a capital or an opening quote ("pain... manageable" goes on);
    // one standing between spaces marks left-out words ("52.3 to 29.5 … 2.7 to 5.3").
    return capitalNext && i > 0 && !isSpace(text[i - 1]);
  }
  const ends = run === "." ? periodEndsSentence(st, i, b, policy) : startsNewSentence(text, b, policy); // "?" or "!"
  return ends && (!closed || capitalNext);
}

/** Whether the line before the break at `a` ends with a stop that ends a sentence (for wrapped prose). */
function lineEndsWithStop(st: ScanState, a: number, b: number): boolean {
  const { text } = st;
  let k = a;
  while (k > 0 && inSet(CLOSERS, text[k - 1])) k--;
  const termEnd = k;
  while (k > 0 && inSet(TERMINALS, text[k - 1])) k--;
  if (k === termEnd) return false;
  return stopEndsSentence(st, k, termEnd, b, "notes", termEnd < a);
}

/** Whether the line before the break at `a` ends with a title or an inline abbreviation ("Dr.", "e.g."). */
function lineEndsWithAbbreviation(text: string, a: number): boolean {
  if (text[a - 1] !== ".") return false;
  const { tok } = tokenBefore(text, a - 1);
  const word = alphaTail(tok);
  if (!word) return false;
  const lw = word.toLowerCase();
  const bare = lw.replace(/\./g, "");
  return (TITLES.indexOf(bare) >= 0 && tok === word) || INLINE_ABBREVIATIONS.indexOf(lw) >= 0 || INLINE_ABBREVIATIONS.indexOf(bare) >= 0;
}

/** Whether the line break run text[a, b) starts a new sentence. */
function lineBreakEndsSentence(st: ScanState, a: number, b: number): boolean {
  const { text } = st;
  if (st.policy === "notes") return true;
  let breaks = 0;
  for (let k = a; k < b; k++) if (text[k] === "\n") breaks++;
  if (breaks >= 2) return true; // a blank line
  if (LINE_MARKER.test(text.slice(b, b + 8))) return true; // the next line is a list item
  if (text[a - 1] === ":") return true; // a heading line
  if (lineEndsWithAbbreviation(text, a)) return false; // "Dr.\nEllery" is a wrapped line
  if (!isLower(text[b])) return true;
  return lineEndsWithStop(st, a, b); // otherwise a wrapped line goes on
}

/**
 * Split `text` into sentences. Each span is trimmed, never empty, and `span.text === text.slice(start, end)`;
 * the text between spans is white space only. See the module comment for what never splits.
 */
export function splitSentences(text: string, policy: SentencePolicy = "prose"): SentenceSpan[] {
  if (!text) return [];
  const n = text.length;
  const guard = guardedPositions(text);
  const st: ScanState = { text, policy, lineStart: 0, segStart: 0, lastMarker: null, lastLetter: null, markerAt: new Set<number>() };
  const cuts: number[] = [];
  const cut = (at: number) => {
    cuts.push(at);
    st.segStart = at;
  };
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (isSpace(ch)) {
      let b = i;
      let hasBreak = false;
      let lastBreak = -1;
      while (b < n && isSpace(text[b])) {
        if (text[b] === "\n") {
          hasBreak = true;
          lastBreak = b;
        }
        b++;
      }
      if (hasBreak) {
        if (i > 0 && b < n && lineBreakEndsSentence(st, i, b)) cut(i);
        st.lineStart = lastBreak + 1;
      }
      i = b;
      continue;
    }
    if (inSet(TERMINALS, ch)) {
      let j = i;
      while (j < n && inSet(TERMINALS, text[j])) j++;
      const termEnd = j;
      while (j < n && inSet(CLOSERS, text[j])) j++;
      const end = j;
      if (end >= n || !isSpace(text[end])) {
        i = termEnd; // "8.0", "e.g.,", "?fracture": not a stop
        continue;
      }
      let b = end;
      let hasBreak = false;
      while (b < n && isSpace(text[b])) {
        if (text[b] === "\n") hasBreak = true;
        b++;
      }
      // At the end of the text nothing follows; at a line break the line-break rule decides.
      if (b < n && !hasBreak && !guard[end] && stopEndsSentence(st, i, termEnd, b, policy, end > termEnd)) cut(end);
      i = end;
      continue;
    }
    if (inSet(INLINE_BULLETS, ch) && i > 0 && isSpace(text[i - 1]) && isSpace(text[i + 1]) && !guard[i] && !onlyIndentBefore(text, st.lineStart, i)) {
      cut(i);
    }
    i++;
  }

  const spans: SentenceSpan[] = [];
  const bounds = [0, ...cuts, n];
  for (let k = 0; k + 1 < bounds.length; k++) {
    let s = bounds[k];
    let e = bounds[k + 1];
    while (s < e && isSpace(text[s])) s++;
    while (e > s && isSpace(text[e - 1])) e--;
    if (s >= e) continue;
    const slice = text.slice(s, e);
    let lineStart = s;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
    const m =
      (onlyIndentBefore(text, lineStart, s) ? LINE_MARKER.exec(slice) : null) ??
      INLINE_MARKER.exec(slice) ??
      (st.markerAt.has(s) ? /^\d{1,2}[.)](?=\s)/.exec(slice) : null);
    let bodyStart = s;
    if (m) {
      bodyStart = s + m[0].length;
      while (bodyStart < e && isSpace(text[bodyStart])) bodyStart++;
    }
    spans.push(m ? { index: spans.length, start: s, end: e, text: slice, bodyStart, marker: m[0] } : { index: spans.length, start: s, end: e, text: slice, bodyStart });
  }
  return spans;
}

/** The sentences of `text` as strings (trimmed, in order). */
export function sentenceTexts(text: string, policy: SentencePolicy = "prose"): string[] {
  return splitSentences(text, policy).map((s) => s.text);
}

/** The sentence that contains `offset` (start <= offset < end), if any. */
export function sentenceAt(text: string, offset: number, policy: SentencePolicy = "prose"): SentenceSpan | undefined {
  return splitSentences(text, policy).find((s) => s.start <= offset && offset < s.end);
}

/** Whether `offset` (after any white space) is where a sentence, or the words of a list item, begin. */
export function isSentenceStart(text: string, offset: number, policy: SentencePolicy = "prose"): boolean {
  let p = offset;
  while (p < text.length && isSpace(text[p])) p++;
  return splitSentences(text, policy).some((s) => s.start === p || s.bodyStart === p);
}

/**
 * The smallest range of whole sentences that covers every sentence overlapping [start, end) – the way to
 * turn a regex match into "remove that sentence". Undefined when the range touches no sentence.
 */
export function expandToSentences(text: string, start: number, end: number, policy: SentencePolicy = "prose"): { start: number; end: number } | undefined {
  const hit = splitSentences(text, policy).filter((s) => s.start < Math.max(end, start + 1) && start < s.end);
  if (hit.length === 0) return undefined;
  return { start: hit[0].start, end: hit[hit.length - 1].end };
}

/** Replace each sentence with `fn(span)`; the white space between sentences is kept exactly. */
export function mapSentences(text: string, fn: (span: SentenceSpan) => string, policy: SentencePolicy = "prose"): string {
  let out = "";
  let last = 0;
  for (const span of splitSentences(text, policy)) {
    out += text.slice(last, span.start) + fn(span);
    last = span.end;
  }
  return out + text.slice(last);
}

function countBreaks(s: string): number {
  let c = 0;
  for (let k = 0; k < s.length; k++) if (s[k] === "\n") c++;
  return c;
}

/**
 * Remove whole sentences – those `select` picks (a predicate, or sentence indexes) – and rejoin the text.
 * Where sentences are removed between two kept ones, the stronger of the two separators is kept (a
 * paragraph break wins over a line break, a line break over a space), so lines and paragraphs stay apart.
 * Leading and trailing white space of the text is kept. `removedSpans` are the removed sentences, with
 * offsets into the original text.
 */
export function removeSentences(
  text: string,
  select: ((span: SentenceSpan) => boolean) | readonly number[],
  policy: SentencePolicy = "prose",
): { after: string; removedSpans: TextSpan[] } {
  const spans = splitSentences(text, policy);
  const drop = (s: SentenceSpan) => (typeof select === "function" ? select(s) : select.indexOf(s.index) >= 0);
  const removed = spans.filter(drop);
  if (removed.length === 0) return { after: text, removedSpans: [] };
  const kept = spans.filter((s) => !drop(s));
  const removedSpans = removed.map((s) => ({ start: s.start, end: s.end, text: s.text }));
  if (kept.length === 0) return { after: "", removedSpans };
  let out = text.slice(0, spans[0].start);
  for (let k = 0; k < kept.length; k++) {
    const s = kept[k];
    if (k > 0) {
      const prev = kept[k - 1];
      if (prev.index + 1 === s.index) out += text.slice(prev.end, s.start);
      else {
        const before = text.slice(prev.end, spans[prev.index + 1].start);
        const after = text.slice(spans[s.index - 1].end, s.start);
        out += countBreaks(after) > countBreaks(before) ? after : before;
      }
    }
    out += s.text;
  }
  return { after: out + text.slice(spans[spans.length - 1].end), removedSpans };
}

/* ------------------------------------------------------------------------------------------------
 * Figures and dates
 * ----------------------------------------------------------------------------------------------*/

/**
 * Dates (08/09/2026, 08.09.2026, 8-9-26), times (10:30) and numbers with their decimals, thousands,
 * "/10" scores, "%" and "°". Inner spaces are dropped ("7 / 10" → "7/10", "46 %" → "46%").
 */
const FIGURE = /\d{1,4}[./-]\d{1,2}[./-]\d{2,4}(?!\d)|\d{1,2}:\d{2}(?!\d)|\d+(?:,\d{3})*(?:\.\d+)?(?:\s?\/\s?\d+(?:\.\d+)?)?(?:\s?%|\u00B0)?/g;

/** The figures and dates in `text`, in order, as they are written (inner spaces dropped). */
export function figuresOf(text: string): string[] {
  return (text.match(FIGURE) ?? []).map((f) => f.replace(/\s+/g, ""));
}

function countAll(items: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function minus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  a.forEach((count, key) => {
    for (let k = 0; k < count - (b.get(key) ?? 0); k++) out.push(key);
  });
  return out;
}

/**
 * Figures an edit lost or gained, compared as multisets: expected = before − removed (+ added).
 * `removed` are the removed spans (or their texts); `added` is text the edit inserted on purpose, such as
 * an attribution prefix with its date. Both lists empty means every figure and date was kept.
 */
export function figureChanges(
  before: string,
  after: string,
  opts: { removed?: readonly (TextSpan | string)[]; added?: readonly string[] } = {},
): { lost: string[]; gained: string[] } {
  const removedFigs = (opts.removed ?? []).flatMap((r) => figuresOf(typeof r === "string" ? r : r.text));
  const expected = countAll(minus(countAll(figuresOf(before)), countAll(removedFigs)).concat((opts.added ?? []).flatMap(figuresOf)));
  const actual = countAll(figuresOf(after));
  return { lost: minus(expected, actual), gained: minus(actual, expected) };
}

/* ------------------------------------------------------------------------------------------------
 * Sentence starts, pronouns and keys
 * ----------------------------------------------------------------------------------------------*/

export type StartProblem = "lower_case" | "digit" | "comma" | "punctuation";

/**
 * How a sentence starts badly: in lower case, with a digit, a comma or other punctuation (";", ":", ")",
 * a dash, "…") – the shapes a cut sentence leaves ("0, a mild ache…"). Leading quotes and brackets are
 * skipped. For a list item (a span with a marker) only commas and punctuation count. Undefined when fine.
 */
export function sentenceStartProblem(sentence: string | SentenceSpan): StartProblem | undefined {
  const isSpan = typeof sentence !== "string";
  const body = isSpan ? sentence.text.slice(sentence.bodyStart - sentence.start) : sentence;
  let k = 0;
  while (k < body.length && (isSpace(body[k]) || inSet(OPENERS, body[k]))) k++;
  const ch = body[k];
  if (ch === undefined) return undefined;
  if (ch === ",") return "comma";
  if (inSet(";:.)]}-\u2013\u2014\u2026", ch)) return "punctuation";
  if (isSpan && sentence.marker) return undefined;
  if (isDigit(ch)) return "digit";
  if (isLower(ch)) return "lower_case";
  return undefined;
}

const PRONOUN_LEAD = /^(?:He|She|They|His|Her|Hers|Their|Him|Them)\b/;

/** Whether the sentence's words start with a personal pronoun ("He recorded…", "Her pain…"). */
function pronounLed(span: SentenceSpan): boolean {
  let body = span.text.slice(span.bodyStart - span.start);
  while (body && inSet(OPENERS, body[0])) body = body.slice(1);
  return PRONOUN_LEAD.test(body);
}

/**
 * The canonical form of a sentence for comparing and hashing: Unicode NFC, curly quotes and apostrophes
 * as straight ones, dashes as "-", "…" as "...", white space collapsed, trimmed. Case and every figure are kept.
 */
export function sentenceKey(sentence: string): string {
  return sentence
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------------------------------------
 * The safe-edit check
 * ----------------------------------------------------------------------------------------------*/

export type SafeEditProblem =
  /** A removed span is not a run of whole sentences. */
  | { kind: "partial_sentence"; span: TextSpan }
  /** A figure or date was lost or gained (beyond the removed spans and the declared additions). */
  | { kind: "figures_changed"; lost: string[]; gained: string[] }
  /** A sentence the edit created starts in lower case, with a digit, a comma or punctuation. */
  | { kind: "bad_start"; sentence: string; problem: StartProblem }
  /** A "He/She …" sentence lost the sentence that named its subject, or now follows a different one. */
  | { kind: "orphaned_pronoun"; sentence: string };

/** Capitalised words that open a sentence without naming anyone ("The notes…", "On 08/09/2026…"). */
const NOT_A_NAME: readonly string[] = [
  "The", "This", "That", "These", "Those", "A", "An", "On", "At", "In", "From", "By", "For", "During", "After",
  "Before", "Since", "When", "While", "If", "As", "His", "Her", "Their", "Its", "It", "There", "No", "None",
  "Both", "All", "Each", "Every", "Some", "Any", "Further", "Our", "My", "Your", "He", "She", "They", "We", "I",
];
const TITLE_NAME = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr)\.?\s+[A-Z]/;
const TWO_CAPITALS = /\b([A-Z][a-z]+(?:['\u2019-][A-Za-z]+)*)\s+(?=[A-Z][a-z])/g;

/**
 * Whether a sentence names a person: a title and a name ("Mr Ashworth", "Dr. Reid") or two capitalised words in
 * a row that do not start with a common opener ("Tom Ellis", "Priya Shah's"). Capitalised terms such as
 * "Oswestry Disability Index" also count, which only makes the orphan check more lenient.
 */
function namesSomeone(text: string): boolean {
  if (TITLE_NAME.test(text)) return true;
  const re = new RegExp(TWO_CAPITALS.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) if (NOT_A_NAME.indexOf(m[1]) < 0) return true;
  return false;
}

/** The nearest sentence before `k` that names someone without starting with a pronoun – the subject "He" refers to. */
function namingKey(spans: readonly SentenceSpan[], k: number): string | null {
  for (let j = k - 1; j >= 0; j--) if (!pronounLed(spans[j]) && namesSomeone(spans[j].text)) return sentenceKey(spans[j].text);
  return null;
}

/** A stop, then white space, then a comma or other punctuation: where a cut sentence would start (". , and he…"). */
const STOP_THEN_PUNCTUATION = /[.!?\u2026]["\u201D\u2019')\]}]*\s+(?=[,;:)\]}])/g;

/**
 * The pieces whose starts the safe-edit check looks at: the sentences under the notes policy (so ". and he…"
 * is a piece of its own even in prose), plus every point inside one where a stop is followed by punctuation.
 */
function startPieces(text: string): Array<string | SentenceSpan> {
  const out: Array<string | SentenceSpan> = [];
  for (const span of splitSentences(text, "notes")) {
    out.push(span);
    const re = new RegExp(STOP_THEN_PUNCTUATION.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(span.text)) !== null) out.push(span.text.slice(m.index + m[0].length));
  }
  return out;
}

const pieceText = (p: string | SentenceSpan) => (typeof p === "string" ? p : p.text);

/**
 * The text-level rules every one-click edit must pass (bh-quality plan WD 6). Returns the problems found,
 * empty when the edit is safe:
 *   - every removed span is a run of whole sentences of `before` (surrounding white space allowed);
 *   - figures and dates: after = before − removedSpans (+ `added`, text the edit inserted on purpose);
 *   - nothing the edit created starts badly (sentenceStartProblem): the starts are read on the notes-policy
 *     pieces of both texts, so "Pain eased. and he rested." and "Pain eased. , and he rested." are caught in
 *     prose too, and a piece that was already in `before` is never reported;
 *   - no pronoun-led sentence ("He recorded…") now refers to a different naming sentence (the nearest earlier
 *     sentence that names someone, see namesSomeone) than it did in `before` – removing "Tom Ellis recorded…"
 *     or "Priya Shah reviewed…" in front of it is caught – and no new pronoun-led sentence is left with no
 *     naming sentence when `before` had one.
 */
export function checkSafeEdit(input: {
  before: string;
  after: string;
  removedSpans?: readonly TextSpan[];
  added?: readonly string[];
  policy?: SentencePolicy;
}): SafeEditProblem[] {
  const policy = input.policy ?? "prose";
  const problems: SafeEditProblem[] = [];
  const before = splitSentences(input.before, policy);
  const after = splitSentences(input.after, policy);

  for (const span of input.removedSpans ?? []) {
    let s = span.start;
    let e = span.end;
    while (s < e && isSpace(input.before[s])) s++;
    while (e > s && isSpace(input.before[e - 1])) e--;
    const first = before.find((x) => x.start === s);
    const last = before.find((x) => x.end === e);
    if (!first || !last || first.index > last.index) problems.push({ kind: "partial_sentence", span });
  }

  const figures = figureChanges(input.before, input.after, { removed: input.removedSpans, added: input.added });
  if (figures.lost.length > 0 || figures.gained.length > 0) problems.push({ kind: "figures_changed", ...figures });

  const beforePieces = startPieces(input.before).map((p) => sentenceKey(pieceText(p)));
  for (const piece of startPieces(input.after)) {
    const problem = sentenceStartProblem(piece);
    if (problem && beforePieces.indexOf(sentenceKey(pieceText(piece))) < 0) problems.push({ kind: "bad_start", sentence: pieceText(piece), problem });
  }

  const beforeKeys = before.map((s) => sentenceKey(s.text));
  const used = new Set<number>();
  const namedBefore = before.some((s) => !pronounLed(s) && namesSomeone(s.text));
  for (let k = 0; k < after.length; k++) {
    if (!pronounLed(after[k])) continue;
    const key = sentenceKey(after[k].text);
    const j = beforeKeys.findIndex((x, idx) => x === key && !used.has(idx));
    const now = namingKey(after, k);
    if (j >= 0) {
      used.add(j);
      if (namingKey(before, j) !== now) problems.push({ kind: "orphaned_pronoun", sentence: after[k].text });
    } else if (now === null && namedBefore) {
      problems.push({ kind: "orphaned_pronoun", sentence: after[k].text });
    }
  }
  return problems;
}
