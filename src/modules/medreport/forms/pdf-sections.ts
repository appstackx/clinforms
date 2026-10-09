import "server-only";

/**
 * Section headings of a PDF form, and who completes each part, from its printed text.
 *
 * annotatePdfSections(fields, pageText) is called once by readPdfForm (forms/pdf-outline.ts) with the
 * positioned text (pdfjs items with their width and height). It gives every fillable field and every
 * text item the form's own heading above it (`section`, carried across pages) and the party that heading
 * says completes it (`completedBy`, core/parties.ts). Flat-PDF answer boxes and label lines are looked up
 * afterwards with pdfSectionAt(outline, page, y).
 *
 * Headings (no font names are available server-side, so size and numbering decide):
 * - level 1: a numbered heading ("1. Patient details", "4 Treatment goals", "Section 4 – …", "Part B")
 *   printed larger than the body text, or at body size when it names who completes it; an unnumbered
 *   line at least 1.3 × the body size ("Therapist's declaration", "About the patient"); "For office use
 *   only" at any size. Lines with a "?", questions and instructions, contact details and running headers
 *   (the same text at the same height on several pages) are never headings; a title that wraps onto a
 *   second line at the same size is one heading.
 * - level 2: a numbered sub-heading ("2.1 Member's details – to be completed by the policyholder…", "2.2
 *   Your claim"), a short line in capitals printed larger than the body text ("CLAIM DETAILS"), and a
 *   declaration ("8. I confirm that these answers are true…") inside a part of
 *   the form that is not already a declaration or signature section.
 *
 * Who completes it: the heading's own wording ("– to be completed by the policyholder", "Therapist's
 * declaration", "Therapist details", "… consent form"); else a "to be completed by" line in the first three
 * lines under it (later in the section, such a line switches the party from there on); else, in a
 * declaration or signature section, its signer ("The member named in part A must sign…", "I am the
 * therapist treating this patient…", "Doctor's signature:"). A level-2 heading inherits its section's party;
 * "For … use only" is the insurer's.
 *
 * Owner: forms-engine agent (multi-party forms).
 */
import { completerParty, headingParty, signerParty } from "../core/parties";
import type { Party, PdfFormOutline } from "../core/types";

export interface SectionInfo {
  section?: string;
  completedBy?: Party;
}

type SectionText = { str: string; x: number; y: number; w?: number; h?: number } & SectionInfo;
type SectionField = { page: number; rect: { x: number; y: number; width: number; height: number } } & SectionInfo;

interface Line {
  page: number;
  y: number;
  x: number;
  size: number;
  text: string;
  items: SectionText[];
}

export interface PdfSection {
  page: number;
  /** Baseline of the heading line (PDF points, origin bottom-left). */
  y: number;
  level: 1 | 2;
  title: string;
  completedBy?: Party;
  /** A declaration or signature section. */
  signoff: boolean;
}

interface Segment extends PdfSection {
  lines: number;
  /** The party came from the heading itself (a marker line below does not override it). */
  fromHeading: boolean;
}

const LETTERS = /[A-Za-z]{3}/;
/** Questions and instructions ("Is the patient…", "Please give…", "If yes…") are never headings. */
const QUESTION_START = /^(?:do|does|did|is|are|was|were|has|have|had|can|could|will|would|should|what|when|where|why|how|which|who|whose|please|if|i|we|you)\b/i;
/** Contact details and web addresses printed large on a cover or back page. */
const CONTACT = /@|https?:|www\.|\.(?:com|co\.uk|org|net|gov\.uk)\b|\b\d{4,} ?\d{3}/i;
const NUMBERED = /^(?:(section|part)\s+([0-9]{1,2}|[a-h])\b[.:)]?|([0-9]{1,2})(?:\.([0-9]{1,2}))?[.)]?|([a-h])[.)])\s*[–—-]?\s*(?=[a-z(‘'"“])/i;
/** "FOR OFFICE USE ONLY", "For Northfield Assurance use only": the referrer's own part of the form. */
const OFFICE_USE_LINE = /^(?:for )?(?:[\w&'()-]+ ){0,4}use only\.?$|^(?:for )?(?:office|official|internal|administrative) use\.?$/i;
/** A short line in capitals ("CLAIM DETAILS"), printed larger than the body text: a sub-heading. */
const CAPITALS = /^[A-Z0-9][A-Z0-9 &/,'’()–—-]{4,58}[A-Z)]$/;
const DECLARATION_LINE = /^(?:\d{1,2}[.)]?\s+)?(?:declaration\b|i (?:hereby )?(?:declare|confirm|certify)\b)/i;
const SIGNOFF_TITLE = /\b(?:declaration|declare|signature|sign(?:ed|-off| off)?|statement of truth|attestation)\b/i;

const clean = (s: string) => s.replace(/[\u0000-\u001f]/g, " ");

/** Text items grouped into lines (same page, baseline within 2.5 pt), in reading order. */
function groupLines(pages: Array<{ page: number; items: SectionText[] }>): Line[] {
  const lines: Line[] = [];
  for (const { page, items } of pages.slice().sort((a, b) => a.page - b.page)) {
    const pageLines: Line[] = [];
    for (const it of items.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (!it.str.trim()) continue;
      const line = pageLines.find((l) => Math.abs(l.y - it.y) <= 2.5);
      if (line) line.items.push(it);
      else pageLines.push({ page, y: it.y, x: it.x, size: 0, text: "", items: [it] });
    }
    for (const line of pageLines) {
      line.items.sort((a, b) => a.x - b.x);
      line.x = line.items[0].x;
      let text = "";
      let prevEnd: number | null = null;
      for (const it of line.items) {
        const s = clean(it.str);
        if (!text) text = s;
        else if (/\s$/.test(text) || /^\s/.test(s) || prevEnd === null || it.x - prevEnd > 0.8) text += ` ${s}`;
        else text += s; // a drop capital or a run split mid-word ("D" + "ate of diagnosis")
        prevEnd = it.w !== undefined ? it.x + it.w : null;
      }
      line.text = text.replace(/\s+/g, " ").trim();
      line.size = Math.max(0, ...line.items.filter((it) => /[A-Za-z0-9]/.test(it.str)).map((it) => it.h ?? 0));
    }
    lines.push(...pageLines.filter((l) => l.text));
  }
  return lines;
}

/** The commonest text size, weighted by characters (0.5 pt steps). */
function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    for (const it of l.items) {
      if (!it.h) continue;
      const size = Math.round(it.h * 2) / 2;
      weight.set(size, (weight.get(size) ?? 0) + it.str.trim().length);
    }
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of Array.from(weight.entries())) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

const headingKey = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, " ").trim();

function headingLevel(line: Line, body: number): 1 | 2 | null {
  const text = line.text;
  if (!LETTERS.test(text) || text.length > 150 || /\?/.test(text) || CONTACT.test(text)) return null;
  if (text.length <= 60 && OFFICE_USE_LINE.test(text)) return 1;
  const big = body > 0 && line.size >= body + 0.75;
  const m = NUMBERED.exec(text);
  if (m) {
    const rest = text.slice(m[0].length).trim();
    if (!LETTERS.test(rest) || /[:,]$/.test(rest)) return null;
    const named = headingParty(rest) !== null;
    if (m[4] !== undefined) {
      // "3.1 …": a sub-heading when it is short and not a question or instruction, or names who completes it.
      if (body > 0 && line.size < body - 0.5) return null;
      if (rest.length > 110) return null;
      return named || (rest.length <= 60 && !QUESTION_START.test(rest)) ? 2 : null;
    }
    if (QUESTION_START.test(rest) && !named) return null;
    if (big && rest.length <= 140) return 1;
    if ((m[1] !== undefined || named) && rest.length <= 140 && (body === 0 || line.size >= body - 0.5)) return 1;
    return null;
  }
  // Unnumbered: much larger than the body text, starting like a heading (not a wrapped sentence).
  if (body > 0 && line.size >= body * 1.3 && text.length <= 100 && /^[A-Z0-9‘'"“(]/.test(text) && !/[,;]$/.test(text) && !QUESTION_START.test(text)) return 1;
  if (body > 0 && line.size >= body + 0.75 && CAPITALS.test(text) && !QUESTION_START.test(text)) return 2;
  return null;
}

/** A heading's own words: the heading-size text of its line (not smaller guidance printed beside it). */
function headingText(line: Line): string {
  const big = line.items.filter((it) => (it.h ?? line.size) >= line.size - 1);
  return big.length === line.items.length ? line.text : big.map((it) => clean(it.str).trim()).join(" ").replace(/\s+/g, " ").trim() || line.text;
}

function truncate(text: string, max = 100): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

/** The sections of a form (in reading order) from its positioned text. */
export function detectPdfSections(pages: Array<{ page: number; items: SectionText[] }>): PdfSection[] {
  return buildSegments(groupLines(pages)).map(({ page, y, level, title, completedBy, signoff }) => ({
    page,
    y,
    level,
    title,
    signoff,
    ...(completedBy && { completedBy }),
  }));
}

function buildSegments(lines: Line[]): Segment[] {
  const body = bodySize(lines);
  const levels = lines.map((l) => headingLevel(l, body));

  // Running headers: the same heading text at the same height on more than one page is page furniture
  // (two declarations on different pages, at different heights, are both headings).
  const placesByText = new Map<string, Line[]>();
  lines.forEach((l, i) => {
    if (!levels[i]) return;
    const key = headingKey(l.text);
    placesByText.set(key, [...(placesByText.get(key) ?? []), l]);
  });
  lines.forEach((l, i) => {
    if (!levels[i]) return;
    const same = placesByText.get(headingKey(l.text)) ?? [];
    if (same.some((o) => o.page !== l.page && Math.abs(o.y - l.y) <= 6)) levels[i] = null;
  });

  const segments: Segment[] = [];
  let top: Segment | null = null;
  let current: Segment | null = null;
  /** The previous line, when it was a heading line (of `current`). */
  let headingLine: Line | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const level = levels[i];
    // A title or heading wrapped onto a second line at the same size: one heading.
    const before: Line | null = headingLine;
    const seg0: Segment | null = current;
    if (
      before !== null &&
      seg0 !== null &&
      before.page === line.page &&
      seg0.lines === 0 &&
      body > 0 &&
      before.size >= body + 0.75 &&
      // The first line reads as unfinished; a big title may wrap anywhere, a smaller heading only mid-phrase.
      !/[.:;!?)]$/.test(before.text) &&
      (before.size >= body * 1.3 || /^[a-z(–—-]/.test(line.text)) &&
      Math.abs(before.size - line.size) <= 0.5 &&
      Math.abs(before.x - line.x) <= 4 &&
      before.y - line.y <= line.size * 1.8 &&
      LETTERS.test(line.text) &&
      line.text.length <= 100 &&
      !/\?/.test(line.text) &&
      !CONTACT.test(line.text) &&
      !NUMBERED.test(line.text)
    ) {
      seg0.title = truncate(`${seg0.title} ${line.text}`, 160);
      const party = headingParty(seg0.title);
      if (party && !seg0.completedBy) {
        seg0.completedBy = party;
        seg0.fromHeading = true;
      }
      seg0.signoff = seg0.signoff || SIGNOFF_TITLE.test(seg0.title);
      headingLine = line;
      continue;
    }
    if (level) {
      const title = headingText(line);
      const party = headingParty(title);
      const inherited: Party | undefined = level === 2 && top !== null ? (top as Segment).completedBy : undefined;
      const seg: Segment = {
        page: line.page,
        y: line.y,
        level,
        title: truncate(title, 160),
        signoff: SIGNOFF_TITLE.test(title),
        lines: 0,
        fromHeading: party !== null,
        ...(party ? { completedBy: party } : inherited ? { completedBy: inherited } : {}),
      };
      if (level === 1) top = seg;
      segments.push(seg);
      current = seg;
      headingLine = line;
      continue;
    }
    headingLine = null;
    if (!current) continue;

    // A declaration inside a part of the form that is not itself a declaration or signature section.
    if (!current.signoff && DECLARATION_LINE.test(line.text)) {
      const seg: Segment = {
        page: line.page,
        y: line.y,
        level: 2,
        title: truncate(line.text),
        signoff: true,
        lines: 0,
        fromHeading: false,
        ...(current.completedBy && { completedBy: current.completedBy }),
      };
      segments.push(seg);
      current = seg;
      continue;
    }

    current.lines += 1;
    const marker = completerParty(line.text);
    if (marker && marker !== current.completedBy) {
      if (current.lines <= 3 && !current.fromHeading) {
        current.completedBy = marker;
        current.fromHeading = true;
      } else {
        // "The following is to be completed by your GP": from this line on.
        const seg: Segment = { ...current, y: line.y, page: line.page, completedBy: marker, lines: 0, fromHeading: true };
        if (current === top) top = seg;
        segments.push(seg);
        current = seg;
      }
      continue;
    }
    if (current.signoff && !current.completedBy) {
      const signer = signerParty(line.text);
      if (signer) current.completedBy = signer;
    }
  }
  return segments;
}

/** The segment in effect at (page, y): the last heading at or above it, carried across pages. */
function segmentAt(segments: Segment[], page: number, y: number): Segment | null {
  let found: Segment | null = null;
  for (const s of segments) {
    if (s.page < page || (s.page === page && s.y >= y - 2)) found = s;
    else break;
  }
  return found;
}

function info(seg: Segment | null): SectionInfo {
  if (!seg) return {};
  return { section: seg.title, ...(seg.completedBy && seg.completedBy !== "unknown" && { completedBy: seg.completedBy }) };
}

/**
 * Give every field and text item its section heading and who completes it (mutates them in place).
 * Called once from readPdfForm, before the text items are copied into the outline.
 */
export function annotatePdfSections(fields: SectionField[], pageText: Array<{ page: number; items: SectionText[] }>): void {
  const lines = groupLines(pageText);
  const segments = buildSegments(lines);
  if (segments.length === 0) return;
  for (const line of lines) {
    const at = info(segmentAt(segments, line.page, line.y));
    for (const it of line.items) Object.assign(it, at);
  }
  for (const f of fields) {
    Object.assign(f, info(segmentAt(segments, f.page, f.rect.y + f.rect.height / 2)));
  }
}

/** A text item as kept in the outline: position, text, and its section when it has one. */
export function outlineTextItem(it: SectionText): { str: string; x: number; y: number } & SectionInfo {
  return {
    str: it.str,
    x: it.x,
    y: it.y,
    ...(it.section && { section: it.section }),
    ...(it.completedBy && { completedBy: it.completedBy }),
  };
}

/**
 * Section and party at a position of an analysed outline (a flat-PDF label line or answer box): those of
 * the nearest text at or above it on the page, else of the last text on an earlier page.
 */
export function pdfSectionAt(pdf: PdfFormOutline, page: number, y: number): SectionInfo {
  let best: SectionText | null = null;
  for (const it of pdf.pageText.find((p) => p.page === page)?.items ?? []) {
    if (it.y >= y - 2 && (!best || it.y < best.y)) best = it;
  }
  for (let p = page - 1; !best && p >= 1; p -= 1) {
    for (const it of pdf.pageText.find((t) => t.page === p)?.items ?? []) {
      if (!best || it.y < best.y) best = it;
    }
  }
  if (!best) return {};
  return { ...(best.section && { section: best.section }), ...(best.completedBy && { completedBy: best.completedBy }) };
}

/** The distinct section headings of an analysed outline, in reading order (outline summary). */
export function pdfSectionTitles(pdf: PdfFormOutline): string[] {
  const out: string[] = [];
  for (const p of pdf.pageText.slice().sort((a, b) => a.page - b.page)) {
    for (const it of p.items.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (it.section && out.indexOf(it.section) < 0) out.push(it.section);
    }
  }
  return out;
}
