/**
 * Linear-time text helpers for the notes readers (wave 3 security fixes).
 *
 * A regular expression such as /\s+$/ or /[\s|•]+$/ (or a global split on optional spaces round a bar) rescans a long run of matching characters from
 * every position it starts at, so it takes quadratic time on a padded line: one small upload could keep the server
 * busy for minutes (the notes reader is reachable from a public-demo session). These helpers walk a string once.
 * The readers also run their structural patterns (headings, "Label: value" lines, signatures) only on lines up to
 * STRUCTURE_LINE_CHARS long; a longer line is note text, kept as written.
 *
 * Browser-safe and pure.
 *
 * Owner: integration agent.
 */

/** Longest line the readers try to read as a heading, a "Label: value" line or a signature. */
export const STRUCTURE_LINE_CHARS = 1_000;

const SPACE = /\s/;

export function isSpace(c: string): boolean {
  return SPACE.test(c);
}

/** A predicate for whitespace plus the given characters. */
export function spaceOr(chars: string): (c: string) => boolean {
  return (c) => SPACE.test(c) || chars.indexOf(c) >= 0;
}

export function trimEndWhere(s: string, strip: (c: string) => boolean): string {
  let end = s.length;
  while (end > 0 && strip(s.charAt(end - 1))) end -= 1;
  return end === s.length ? s : s.slice(0, end);
}

export function trimStartWhere(s: string, strip: (c: string) => boolean): string {
  let start = 0;
  while (start < s.length && strip(s.charAt(start))) start += 1;
  return start === 0 ? s : s.slice(start);
}

export function trimWhere(s: string, strip: (c: string) => boolean): string {
  return trimEndWhere(trimStartWhere(s, strip), strip);
}

const isNewline = (c: string) => c === "\n";

/** Leading and trailing line breaks removed (the text in between is kept as written). */
export function trimNewlines(s: string): string {
  return trimWhere(s, isNewline);
}

/** Every run of whitespace as one space (a global /\s+/ replace is linear: each run is matched once). */
export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ");
}

const SEPARATORS_ANY = "|•·–—";
const SEPARATORS_SPACED = "–—-";

/**
 * Heading text split at its separators in one pass: a dash with whitespace on both sides (" – ", " - "), a bar or
 * a bullet ("|", "•", "·") or an en/em dash, each with any whitespace round it. A hyphen without whitespace after it
 * ("Follow-up", " -3") is not a separator. Parts come with their start offsets in `text`.
 */
export function splitHeadingSegments(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const n = text.length;
  let last = 0;
  let i = 0;
  const skipSpaces = (from: number) => {
    let k = from;
    while (k < n && SPACE.test(text.charAt(k))) k += 1;
    return k;
  };
  const cut = (at: number, next: number) => {
    out.push({ text: text.slice(last, at), start: last });
    last = next;
    i = next;
  };
  while (i < n) {
    const c = text.charAt(i);
    if (SPACE.test(c)) {
      const j = skipSpaces(i);
      const d = text.charAt(j);
      if (d && SEPARATORS_SPACED.indexOf(d) >= 0 && j + 1 < n && SPACE.test(text.charAt(j + 1))) {
        cut(i, skipSpaces(j + 1));
        continue;
      }
      if (d && SEPARATORS_ANY.indexOf(d) >= 0) {
        cut(i, skipSpaces(j + 1));
        continue;
      }
      i = j;
      continue;
    }
    if (SEPARATORS_ANY.indexOf(c) >= 0) {
      cut(i, skipSpaces(i + 1));
      continue;
    }
    i += 1;
  }
  out.push({ text: text.slice(last), start: last });
  return out;
}
