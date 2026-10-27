/**
 * The document model between the RTF reader (reader.ts) and the Word writer (docx-writer.ts): only what
 * a referrer's report template needs – paragraphs with character formatting, tables with widths,
 * borders and merged cells, page set-up, page headers and footers.
 *
 * Measurements are in twips (1/1440 inch) as in RTF and WordprocessingML; font sizes in half-points.
 * Browser-safe and pure.
 */

export interface RunStyle {
  bold: boolean;
  italic: boolean;
  /** WordprocessingML underline value ("single", "double", "dotted", …) or null. */
  underline: string | null;
  strike: boolean;
  caps: boolean;
  smallCaps: boolean;
  /** Half-points (RTF \fs; 24 = 12 pt). */
  size: number;
  /** Font name; null = the document's default font. */
  font: string | null;
  /** RRGGBB, or null for automatic. */
  color: string | null;
  vertAlign: "superscript" | "subscript" | null;
}

export type Inline =
  /** `generated`: written by the converter itself (a form field's fill-in line), not the template's own text. */
  | { kind: "text"; text: string; style: RunStyle; generated?: boolean }
  /** A mail-merge field while its paragraph is read (resolved to an answer space when the paragraph ends). */
  | { kind: "merge"; name: string; style: RunStyle }
  | { kind: "tab"; style: RunStyle }
  | { kind: "break"; style: RunStyle }
  /** A character of a symbol font kept as a Word symbol (w:sym), e.g. a Wingdings arrow. */
  | { kind: "sym"; font: string; char: number; style: RunStyle }
  /** PAGE / NUMPAGES in a page header or footer: a live Word field with its last printed result. */
  | { kind: "field"; instr: "PAGE" | "NUMPAGES" | "SECTIONPAGES"; text: string; style: RunStyle }
  /**
   * Fix round 1 (B0-14): a PNG or JPEG picture (a provider's logo) drawn in line with the text, `width` × `height` twips
   * – also a picture frame (\shp) the template placed, drawn where it is anchored.
   */
  | { kind: "picture"; format: "png" | "jpeg"; data: Uint8Array; width: number; height: number; style: RunStyle };

export interface Border {
  /** WordprocessingML border value: "single", "double", "dotted", "dashed", "thick", "nil". */
  style: string;
  /** Width in twips (RTF \brdrw). */
  width: number;
  color: string | null;
  /** Space in points (RTF \brsp is in twips; converted on write). */
  space: number;
}

export interface Borders {
  top?: Border;
  left?: Border;
  bottom?: Border;
  right?: Border;
  insideH?: Border;
  insideV?: Border;
}

export interface TabStop {
  pos: number;
  align: "left" | "center" | "right" | "decimal";
  leader: "none" | "dot" | "hyphen" | "underscore" | "heavy" | "middleDot";
}

export interface ParagraphStyle {
  align: "left" | "center" | "right" | "both";
  left: number;
  right: number;
  /** Negative = hanging indent. */
  firstLine: number;
  before: number;
  after: number;
  /**
   * Line spacing as RTF gives it: \sl (0 = single) and \slmult (true: a multiple, 240 = single; false:
   * positive = at least, negative = exactly).
   */
  lineRaw: number;
  lineMult: boolean;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  /** 0–8 (heading level 1–9), else null. */
  outlineLevel: number | null;
  tabs: TabStop[];
  borders: Borders | null;
}

export interface Paragraph {
  kind: "paragraph";
  style: ParagraphStyle;
  /** Character formatting of the paragraph mark (keeps the height of blank lines). */
  mark: RunStyle;
  inlines: Inline[];
}

export interface CellDef {
  /** Right boundary (RTF \cellx), from the left margin. */
  right: number;
  borders: Borders;
  vMerge: "restart" | "continue" | null;
  hMerge: "first" | "merge" | null;
  vAlign: "top" | "center" | "bottom";
  /** Background RRGGBB, or null. */
  shading: string | null;
}

export interface RowDef {
  /** Left edge of the row (RTF \trleft). */
  left: number;
  /** Half the space between cells (RTF \trgaph) – the cell's left and right text margin. */
  gap: number;
  cells: CellDef[];
  /** Row height: positive = at least, negative = exactly, 0 = automatic. */
  height: number;
  header: boolean;
  cantSplit: boolean;
  align: "left" | "center" | "right";
  borders: Borders;
  padLeft: number | null;
  padRight: number | null;
  autofit: boolean;
}

export interface TableRow {
  def: RowDef;
  /** Each cell's content in order (paragraphs and nested tables). */
  cells: Block[][];
}

export interface Table {
  kind: "table";
  rows: TableRow[];
}

export type Block = Paragraph | Table;

export interface PageSetup {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
  landscape: boolean;
}

export type HeaderKind = "default" | "first" | "even";

/** What the conversion found, kept or left out (counts only; no text). */
export interface RtfStats {
  paragraphs: number;
  tables: number;
  cells: number;
  /** Mail-merge fields (MERGEFIELD fields and typed «Name» / <<Name>>) turned into answer spaces. */
  mergeFields: number;
  /** Their names, distinct, in order (at most 50). */
  mergeFieldNames: string[];
  /**
   * 10/2026: a clinic system's own letter codes (<<P_SURNAME>>, <<DATE>> – upper case in double angle brackets) kept
   * as printed in the body, for the form reading to fill from the record (core/practice-merge-codes.ts).
   */
  practiceCodes: number;
  /** Their names, distinct, in order (at most 50). */
  practiceCodeNames: string[];
  /** Text that looks like another system's fill-in token ([Name], {Name}, $Name$, %Name%) – kept, noted. */
  otherTokens: number;
  /** Up to three of them as printed. */
  otherTokenExamples: string[];
  formTextFields: number;
  formCheckboxes: number;
  formDropdowns: number;
  tickBoxes: number;
  /** Pictures left out (formats other than PNG and JPEG, linked pictures, oversized ones). */
  pictures: number;
  /** Fix round 1 (B0-14): pictures carried over into the Word file (PNG and JPEG, also in picture frames). */
  picturesKept: number;
  objects: number;
  shapes: number;
  footnotes: number;
  comments: number;
  /** Fill-in spaces or merge fields found in a page header or footer (kept as printed, not completed). */
  headerFooterFillIns: number;
  /** Characters that could not be decoded (dropped). */
  undecoded: number;
  /** Section breaks turned into page breaks (single-section output). */
  sections: number;
}

export interface RtfDocument {
  body: Block[];
  headers: Partial<Record<HeaderKind, Block[]>>;
  footers: Partial<Record<HeaderKind, Block[]>>;
  page: PageSetup;
  titlePage: boolean;
  evenAndOdd: boolean;
  defaultFont: string | null;
  defaultTab: number;
  lang: string;
  stats: RtfStats;
}

export const DEFAULT_SIZE = 24;

export function defaultRunStyle(): RunStyle {
  return { bold: false, italic: false, underline: null, strike: false, caps: false, smallCaps: false, size: DEFAULT_SIZE, font: null, color: null, vertAlign: null };
}

export function defaultParagraphStyle(): ParagraphStyle {
  return {
    align: "left",
    left: 0,
    right: 0,
    firstLine: 0,
    before: 0,
    after: 0,
    lineRaw: 0,
    lineMult: false,
    keepNext: false,
    keepLines: false,
    pageBreakBefore: false,
    outlineLevel: null,
    tabs: [],
    borders: null,
  };
}

export function defaultCellDef(): CellDef {
  return { right: 0, borders: {}, vMerge: null, hMerge: null, vAlign: "top", shading: null };
}

export function defaultRowDef(): RowDef {
  return { left: 0, gap: 108, cells: [], height: 0, header: false, cantSplit: false, align: "left", borders: {}, padLeft: null, padRight: null, autofit: false };
}

export function emptyStats(): RtfStats {
  return {
    paragraphs: 0,
    tables: 0,
    cells: 0,
    mergeFields: 0,
    mergeFieldNames: [],
    practiceCodes: 0,
    practiceCodeNames: [],
    otherTokens: 0,
    otherTokenExamples: [],
    formTextFields: 0,
    formCheckboxes: 0,
    formDropdowns: 0,
    tickBoxes: 0,
    pictures: 0,
    picturesKept: 0,
    objects: 0,
    shapes: 0,
    footnotes: 0,
    comments: 0,
    headerFooterFillIns: 0,
    undecoded: 0,
    sections: 0,
  };
}
