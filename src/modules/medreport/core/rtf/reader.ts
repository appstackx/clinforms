/**
 * RTF reader: bytes → RtfDocument (model.ts). One pass over the bytes (linear time), a group stack with a
 * hard depth limit, and caps on the number of blocks and text pieces, so a hostile file cannot make it
 * hang or exhaust memory. Malformed or incomplete files throw RtfConversionError with a plain-English
 * message.
 *
 * What it reads (what Word, TM3-style letter templates, WordPad and macOS TextEdit write):
 * - groups, control words and symbols, `\'hh` bytes in the document / font code page (Windows-1252
 *   built in), `\uN` with the `\ucN` fallback skip, `\bin`;
 * - paragraphs (`\par`, `\pard`), line and page breaks, tabs and tab stops, alignment, indents, spacing,
 *   keep-with-next, outline levels (headings, also from the style sheet), paragraph borders;
 * - bold, italic, underline, strike, caps, font, size, colour, super/subscript; hidden and deleted text
 *   is left out;
 * - tables (`\trowd` … `\cellx`, `\cell`, `\row`), nested tables (`\itap`, `\nestcell`, `\nestrow`,
 *   `\nesttableprops`), cell widths, borders, shading, vertical alignment, row heights, header rows,
 *   horizontal (`\clmgf`/`\clmrg`) and vertical (`\clvmgf`/`\clvmrg`) merges;
 * - fields: the visible result is kept, except mail-merge fields (below); FORMCHECKBOX → ☐/☒;
 *   FORMTEXT → "__________" (or "[default text]"); FORMDROPDOWN → "[A / B]";
 *   FORMCHECKBOX → ☐/☒; FORMTEXT → "__________" (or "[default text]"); FORMDROPDOWN → "[A / B]";
 *   SYMBOL fields and symbol fonts (Wingdings tick boxes → ☐/☒, Symbol bullets → •); PAGE/NUMPAGES in a
 *   page header or footer stay live fields;
 * - page size, orientation and margins of the first section; the first section's page headers and
 *   footers (default, first page, even pages) – kept as Word headers and footers.
 *
 * Left out (counted in RtfStats for the notes shown to staff): pictures, embedded objects, drawn shapes
 * and text boxes, footnotes, comments; later sections' page set-up and headers (section breaks become
 * page breaks). Ignored without a note: style sheet formatting (Word writes every property on the
 * paragraph itself), lists' automatic numbering (the printed bullet / number text is kept), bookmarks,
 * document information, colour schemes and other `\*` destinations.
 *
 * Browser-safe and pure.
 */
import {
  CHECKED_BOX,
  UNCHECKED_BOX,
  codepageForCharset,
  decodeBytes,
  isDoubleByteCodepage,
  isLeadByte,
  symbolFontKind,
  symbolGlyph,
  type SymbolFontKind,
} from "./codepages";
import { isPracticeCodeName } from "../practice-merge-codes";
import { isRtfBytes } from "./sniff";
import {
  defaultCellDef,
  defaultParagraphStyle,
  defaultRowDef,
  defaultRunStyle,
  emptyStats,
  type Block,
  type Border,
  type Borders,
  type CellDef,
  type HeaderKind,
  type Inline,
  type PageSetup,
  type Paragraph,
  type ParagraphStyle,
  type RowDef,
  type RtfDocument,
  type RtfStats,
  type RunStyle,
  type TabStop,
  type TableRow,
} from "./model";

export type RtfErrorCode = "RTF_INVALID" | "RTF_TRUNCATED" | "RTF_TOO_COMPLEX" | "RTF_TOO_LARGE";

export class RtfConversionError extends Error {
  readonly code: RtfErrorCode;
  constructor(code: RtfErrorCode, message: string) {
    super(message);
    this.name = "RtfConversionError";
    this.code = code;
  }
}

export const RTF_LIMITS = {
  /** Deepest group nesting accepted (Word's own files stay well under 40). */
  maxDepth: 256,
  /** Paragraphs and table cells together (a long referrer form has a few thousand). */
  maxBlocks: 60_000,
  /** Text pieces, tabs, breaks and symbols together. */
  maxInlines: 400_000,
  /**
   * Cell definitions kept with the table rows (each row keeps its own copy of up to 63 `\cellx`), so a
   * small file that repeats one wide row definition cannot fill the memory.
   */
  maxCellDefs: 200_000,
} as const;

export interface RtfReadLimits {
  maxDepth?: number;
  maxBlocks?: number;
  maxInlines?: number;
  maxCellDefs?: number;
}

/** A picture's hex digits as text (ASCII; any length – never spread into function arguments). */
const ASCII = new TextDecoder("latin1");

/** Module-level (not per call): the reader calls these once per control word of a file of up to 12 MB. */
function isLetter(b: number): boolean {
  return (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a);
}

function hex(b: number | undefined): number {
  return b === undefined ? -1 : b >= 0x30 && b <= 0x39 ? b - 0x30 : b >= 0x61 && b <= 0x66 ? b - 0x57 : b >= 0x41 && b <= 0x46 ? b - 0x37 : -1;
}

/* ------------------------------------------------------------------------------------------------
 * Reader state
 * ----------------------------------------------------------------------------------------------*/

type Dest =
  | "normal"
  | "skip"
  | "fonttbl"
  | "colortbl"
  | "stylesheet"
  | "fldinst"
  | "formfield"
  | "ffname"
  | "ffdeftext"
  | "ffl"
  | "collect"
  | "nesttableprops"
  | "upr"
  /** Fix round 1 (B0-14): a picture's data and properties (\pict). */
  | "pict"
  /** Fix round 1 (B0-14): a Word 97+ picture's group (\*\shppict) or a shape (\shp) – only a \pict inside is read. */
  | "shppict"
  | "shape"
  /** A text box's text (\shptxt): not carried over – only a picture in it is read, and whether it held any text. */
  | "shapetext";

interface FontInfo {
  name: string;
  nameDone: boolean;
  charset: number | null;
  cpg: number | null;
}

interface FieldCtx {
  instr: string;
  type: string;
  args: string[];
  ff: { type: number | null; res: number | null; defres: number | null; name: string; deftext: string; items: string[] };
  resultSeen: boolean;
  collect: boolean;
  collected: string;
  collectStyle: RunStyle | null;
  textMark: number;
  story: Story;
  style: RunStyle;
  /** Where the field's result goes: the text (normal), or an outer field's instruction / result. */
  outerDest: Dest;
  outerDestField: FieldCtx | null;
}

interface State {
  dest: Dest;
  uprOuter: Dest;
  run: RunStyle;
  /** Font index of the current text (for its code page / symbol-font kind). */
  font: number | null;
  para: ParagraphStyle;
  inTable: boolean;
  itap: number;
  styleIndex: number | null;
  uc: number;
  hidden: boolean;
  story: Story;
  /** The innermost field whose group this is in. */
  field: FieldCtx | null;
  /** The field that owns the current destination (fldinst, collect, ffname…). */
  destField: FieldCtx | null;
  ownsField: boolean;
  ownsStory: HeaderTarget | null;
  starPending: boolean;
  styleEntry: { index: number; name: string; done: boolean } | null;
  ownsStyleEntry: boolean;
  fflItem: { text: string } | null;
  /** Fix round 1 (B0-14): the picture being read (owned by its \pict group), and the shape around it. */
  pict: PictCtx | null;
  ownsPict: boolean;
  shape: ShapeCtx | null;
  ownsShape: boolean;
}

/** A picture while it is read: its format, sizes and data (hex text or \bin bytes). */
interface PictCtx {
  format: "png" | "jpeg" | "other" | null;
  goalW: number;
  goalH: number;
  scaleX: number;
  scaleY: number;
  pxW: number;
  pxH: number;
  hex: string[];
  hexLength: number;
  binary: Uint8Array | null;
  tooLarge: boolean;
  shape: ShapeCtx | null;
}

/** A shape (\shp) while it is read: its box, and the picture it holds (a picture frame), if any. */
interface ShapeCtx {
  left: number;
  right: number;
  top: number;
  bottom: number;
  sawPicture: boolean;
  /** A text box with text of its own (left out – counted as a text box). */
  hadText: boolean;
  picture: Extract<Inline, { kind: "picture" }> | null;
}

/**
 * Pictures carried over: each at most `maxBytes` (decoded), together at most `totalBytes`, at most `maxPictures` – a
 * template's logos are far smaller, and the converted form stays well inside the upload limit (a larger picture is left
 * out and noted, as before).
 */
export const RTF_PICTURE_LIMITS = { maxBytes: 1_000_000, totalBytes: 1_500_000, maxPictures: 24 } as const;

interface HeaderTarget {
  footer: boolean;
  kind: HeaderKind;
}

interface ParaSnapshot {
  style: ParagraphStyle;
  mark: RunStyle;
  inTable: boolean;
  itap: number;
  styleIndex: number | null;
}

interface TableCtx {
  rows: TableRow[];
  row: Block[][];
  cell: Block[];
}

const MERGE_FILLER = /[\s\u00a0\u2002\u2003\u2005]+/g;

/* ------------------------------------------------------------------------------------------------
 * Stories: the body, and each page header / footer
 * ----------------------------------------------------------------------------------------------*/

class Story {
  readonly blocks: Block[] = [];
  inlines: Inline[] = [];
  /** \page / \sect: the next paragraph written starts on a new page. */
  pageBreakNext = false;
  /** Number of non-empty text pieces added (fields use it to see whether their result printed anything). */
  textCount = 0;
  private readonly stack: TableCtx[] = [];

  constructor(
    private readonly r: Reader,
    readonly isHeaderFooter: boolean,
  ) {}

  hasContent(): boolean {
    return this.inlines.length > 0;
  }

  depth(): number {
    return this.stack.length;
  }

  addText(text: string, style: RunStyle, generated = false): void {
    if (!text) return;
    const last = this.inlines[this.inlines.length - 1];
    if (last && last.kind === "text" && last.style === style && Boolean(last.generated) === generated) {
      last.text += text;
    } else {
      this.r.countInline();
      this.inlines.push(generated ? { kind: "text", text, style, generated } : { kind: "text", text, style });
    }
    this.textCount += 1;
  }

  addInline(inline: Inline): void {
    this.r.countInline();
    this.inlines.push(inline);
    if (inline.kind !== "tab" && inline.kind !== "break") this.textCount += 1;
  }

  private container(level: number): Block[] {
    return level === 0 ? this.blocks : this.stack[level - 1].cell;
  }

  private ensureLevel(level: number): void {
    while (this.stack.length > level) this.closeTable();
    while (this.stack.length < level) {
      // Each table opened counts as a block: paragraphs that alternate between nesting levels (\itap) would
      // otherwise open and close hundreds of tables per paragraph without limit (memory).
      this.r.countBlock();
      this.stack.push({ rows: [], row: [], cell: [] });
    }
  }

  private closeTable(): void {
    const level = this.stack.length;
    const ctx = this.stack.pop();
    if (!ctx) return;
    if (ctx.cell.length > 0) ctx.row.push(ctx.cell);
    if (ctx.row.length > 0) ctx.rows.push({ def: this.r.rowDefCopy(this.r.rowDefFor(level)), cells: ctx.row });
    if (ctx.rows.length === 0) return;
    this.container(this.stack.length).push({ kind: "table", rows: ctx.rows });
    this.r.stats.tables += 1;
  }

  /** End the current paragraph. `level`: table nesting level it belongs to (default: from its properties). */
  endParagraph(snap: ParaSnapshot, level?: number): void {
    const lvl = level ?? (snap.itap > 0 ? snap.itap : snap.inTable ? 1 : 0);
    let style = snap.style;
    const outline = style.outlineLevel ?? (snap.styleIndex !== null ? this.r.styleOutline(snap.styleIndex) : null);
    if (outline !== style.outlineLevel) style = { ...style, outlineLevel: outline };
    if (this.pageBreakNext) {
      style = { ...style, pageBreakBefore: true };
      this.pageBreakNext = false;
    }
    const para: Paragraph = { kind: "paragraph", style, mark: snap.mark, inlines: resolveMergeFields(this.inlines, this.r.stats, this.isHeaderFooter) };
    this.inlines = [];
    this.ensureLevel(Math.min(lvl, this.r.maxDepth));
    this.container(this.stack.length).push(para);
    this.r.countBlock();
    this.r.stats.paragraphs += 1;
    this.r.sectionBreakPending = false;
  }

  endCell(snap: ParaSnapshot, level: number): void {
    this.endParagraph(snap, level);
    const ctx = this.stack[level - 1];
    if (!ctx) return;
    ctx.row.push(ctx.cell);
    ctx.cell = [];
    this.r.countBlock();
    this.r.stats.cells += 1;
  }

  endRow(snap: ParaSnapshot, level: number, def: RowDef): void {
    if (this.inlines.some((i) => i.kind !== "text" || i.text.trim() !== "")) this.endCell(snap, level);
    else this.inlines = [];
    this.ensureLevel(level);
    const ctx = this.stack[level - 1];
    if (ctx.cell.length > 0) {
      ctx.row.push(ctx.cell);
      ctx.cell = [];
    }
    if (ctx.row.length === 0) return;
    ctx.rows.push({ def: this.r.rowDefCopy(def), cells: ctx.row });
    ctx.row = [];
  }

  /** End of the story: the last paragraph (if it has content) and any open tables. */
  finish(snap: ParaSnapshot): Block[] {
    if (this.inlines.length > 0) this.endParagraph(snap);
    this.ensureLevel(0);
    return this.blocks;
  }
}

function cloneRowDef(def: RowDef): RowDef {
  return { ...def, cells: def.cells.map((c) => ({ ...c, borders: { ...c.borders } })), borders: { ...def.borders } };
}

/* ------------------------------------------------------------------------------------------------
 * Destinations
 * ----------------------------------------------------------------------------------------------*/

/** Groups whose content is never visible text (left out whole). */
const SKIP_DESTINATIONS = new Set([
  "info",
  "author",
  "title",
  "subject",
  "operator",
  "keywords",
  "comment",
  "doccomm",
  "company",
  "category",
  "manager",
  "hlinkbase",
  "creatim",
  "revtim",
  "printim",
  "buptim",
  "xe",
  "tc",
  "tcn",
  "txe",
  "rxe",
  "nonesttables",
  "nonshppict",
  "shprslt",
  "fchars",
  "lchars",
  "pnseclvl",
  "pn",
  "ftnsep",
  "ftnsepc",
  "aftnsep",
  "aftnsepc",
  "ftncn",
  "aftncn",
  "objdata",
  "objclass",
  "objname",
  "objalias",
  "objsect",
  "objtime",
  "template",
  "listtable",
  "listoverridetable",
  "revtbl",
  "rsidtbl",
  "filetbl",
  "pgdsctbl",
  "background",
  "datafield",
  "ffhelptext",
  "ffstattext",
  "ffentrymcr",
  "ffexitmcr",
  "bkmkstart",
  "bkmkend",
  "atnid",
  "atnauthor",
  "atndate",
  "atnref",
  "atnicn",
  "atntime",
  "atnparent",
  "atrfstart",
  "atrfend",
  "generator",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "xmlnstbl",
  "mmathPr",
  "docvar",
  "userprops",
  "private",
  "passwordhash",
  "protusertbl",
  "wgrffmtfilter",
  "panose",
  "falt",
  "fname",
  "fontemb",
  "fontfile",
  "blipuid",
  "picprop",
]);

/** `\*` destinations the reader understands; every other `\*` group is left out. */
const STAR_HANDLED = new Set(["fldinst", "formfield", "ffname", "ffdeftext", "ffl", "shppict", "nesttableprops", "ud", "do", "annotation", "footnote", "shp", "shpgrp", "shpinst", "shptxt"]);

const HEADER_WORDS: Record<string, HeaderTarget> = {
  header: { footer: false, kind: "default" },
  headerr: { footer: false, kind: "default" },
  headerl: { footer: false, kind: "even" },
  headerf: { footer: false, kind: "first" },
  footer: { footer: true, kind: "default" },
  footerr: { footer: true, kind: "default" },
  footerl: { footer: true, kind: "even" },
  footerf: { footer: true, kind: "first" },
};

const UNDERLINE_WORDS: Record<string, string> = {
  ul: "single",
  uld: "dotted",
  uldash: "dash",
  uldashd: "dotDash",
  uldashdd: "dotDotDash",
  uldb: "double",
  ulhwave: "wavyHeavy",
  ulldash: "dashLong",
  ulth: "thick",
  ulthd: "dottedHeavy",
  ulthdash: "dashedHeavy",
  ulthdashd: "dashDotHeavy",
  ulthdashdd: "dashDotDotHeavy",
  ulthldash: "dashLongHeavy",
  ululdbwave: "wavyDouble",
  ulw: "words",
  ulwave: "wave",
};

const BORDER_STYLES: Record<string, string> = {
  brdrs: "single",
  brdrth: "thick",
  brdrsh: "single",
  brdrdb: "double",
  brdrdot: "dotted",
  brdrdash: "dashed",
  brdrdashsm: "dashSmallGap",
  brdrdashd: "dotDash",
  brdrdashdd: "dotDotDash",
  brdrhair: "single",
  brdrinset: "inset",
  brdroutset: "outset",
  brdrtriple: "triple",
  brdrwavy: "wave",
  brdrwavydb: "doubleWave",
  brdremboss: "threeDEmboss",
  brdrengrave: "threeDEngrave",
  brdrthtnsg: "thinThickSmallGap",
  brdrtnthsg: "thickThinSmallGap",
  brdrframe: "single",
  brdrnone: "nil",
  brdrnil: "nil",
  brdrtbl: "nil",
};

const SPECIAL_CHARS: Record<string, string> = {
  emdash: "—",
  endash: "–",
  emspace: "\u2003",
  enspace: "\u2002",
  qmspace: "\u2005",
  bullet: "•",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  zwj: "\u200d",
  zwnj: "\u200c",
};

/* ------------------------------------------------------------------------------------------------
 * The reader
 * ----------------------------------------------------------------------------------------------*/

class Reader {
  readonly stats: RtfStats = emptyStats();
  readonly maxDepth: number;
  private readonly maxBlocks: number;
  private readonly maxInlines: number;
  private readonly maxCellDefs: number;
  private blocks = 0;
  private keptPictureBytes = 0;
  private inlineCount = 0;
  private cellDefCount = 0;

  private readonly fonts = new Map<number, FontInfo>();
  private fontEntry: number | null = null;
  private readonly colors: (string | null)[] = [];
  private color = { r: -1, g: -1, b: -1 };
  private readonly styles = new Map<number, { name: string; outline: number | null }>();
  private deff: number | null = null;
  private ansiCp = 1252;
  private defaultTab = 720;
  private lang = "en-GB";

  private readonly body: Story;
  private readonly headers: Partial<Record<HeaderKind, Block[]>> = {};
  private readonly footers: Partial<Record<HeaderKind, Block[]>> = {};
  private readonly page: PageSetup = { width: 12240, height: 15840, top: 1440, right: 1800, bottom: 1440, left: 1800, header: 720, footer: 720, landscape: false };
  private titlePage = false;
  private facing = false;
  private section = 0;
  sectionBreakPending = false;

  private topDef: RowDef = defaultRowDef();
  private nestDef: RowDef = defaultRowDef();
  private topCell: CellDef = defaultCellDef();
  private nestCell: CellDef = defaultCellDef();
  private borderTarget: Border | null = null;
  private tabAlign: TabStop["align"] = "left";
  private tabLeader: TabStop["leader"] = "none";

  private state: State;
  private readonly stack: State[] = [];
  private skipChars = 0;
  private pendingBytes: number[] = [];
  private pendingCp = 1252;

  constructor(limits: RtfReadLimits) {
    this.maxDepth = limits.maxDepth ?? RTF_LIMITS.maxDepth;
    this.maxBlocks = limits.maxBlocks ?? RTF_LIMITS.maxBlocks;
    this.maxInlines = limits.maxInlines ?? RTF_LIMITS.maxInlines;
    this.maxCellDefs = limits.maxCellDefs ?? RTF_LIMITS.maxCellDefs;
    this.body = new Story(this, false);
    this.state = {
      dest: "normal",
      uprOuter: "normal",
      run: defaultRunStyle(),
      font: null,
      para: defaultParagraphStyle(),
      inTable: false,
      itap: 0,
      styleIndex: null,
      uc: 1,
      hidden: false,
      story: this.body,
      field: null,
      destField: null,
      ownsField: false,
      ownsStory: null,
      starPending: false,
      styleEntry: null,
      ownsStyleEntry: false,
      fflItem: null,
      pict: null,
      ownsPict: false,
      shape: null,
      ownsShape: false,
    };
  }

  /* limits ------------------------------------------------------------------------------------ */

  countBlock(): void {
    this.blocks += 1;
    if (this.blocks > this.maxBlocks) {
      throw new RtfConversionError("RTF_TOO_COMPLEX", "The RTF file has more paragraphs and table cells than a referrer form would. Check that it is the right file.");
    }
  }

  countInline(): void {
    this.inlineCount += 1;
    if (this.inlineCount > this.maxInlines) {
      throw new RtfConversionError("RTF_TOO_COMPLEX", "The RTF file has more text than a referrer form would. Check that it is the right file.");
    }
  }

  rowDefFor(level: number): RowDef {
    return level <= 1 ? this.topDef : this.nestDef;
  }

  /** A table row's own copy of the current row definition, counted against maxCellDefs. */
  rowDefCopy(def: RowDef): RowDef {
    this.cellDefCount += def.cells.length + 1;
    if (this.cellDefCount > this.maxCellDefs) {
      throw new RtfConversionError("RTF_TOO_COMPLEX", "The RTF file has more table cells than a referrer form would. Check that it is the right file.");
    }
    return cloneRowDef(def);
  }

  styleOutline(index: number): number | null {
    return this.styles.get(index)?.outline ?? null;
  }

  /* main loop --------------------------------------------------------------------------------- */

  read(bytes: Uint8Array): RtfDocument {
    const n = bytes.length;
    let i = 0;
    // Optional UTF-8 byte-order mark and leading white space before "{\rtf".
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    while (i < n && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0d || bytes[i] === 0x0a)) i++;
    if (bytes[i] !== 0x7b) throw new RtfConversionError("RTF_INVALID", "This is not an RTF file.");
    let depth = 0;
    let closed = false;
    while (i < n) {
      const c = bytes[i];
      if (c === 0x7b) {
        this.flushBytes();
        this.pushGroup();
        depth += 1;
        i += 1;
        continue;
      }
      if (c === 0x7d) {
        this.flushBytes();
        this.popGroup();
        depth -= 1;
        i += 1;
        if (depth === 0) {
          closed = true;
          break;
        }
        continue;
      }
      if (c === 0x5c) {
        i = this.readControl(bytes, i);
        continue;
      }
      if (c === 0x0d || c === 0x0a) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < n) {
        const b = bytes[j];
        if (b === 0x7b || b === 0x7d || b === 0x5c || b === 0x0d || b === 0x0a) break;
        j++;
      }
      this.text(bytes, i, j);
      i = j;
    }
    if (!closed) {
      throw new RtfConversionError(
        "RTF_TRUNCATED",
        "The RTF file is incomplete: it ends before the document is closed. Save the template again from the program that made it and upload the new file.",
      );
    }
    this.flushBytes();
    const snap = this.snapshot();
    const body = this.body.finish(snap);
    const defaultFont = this.deff !== null ? this.fonts.get(this.deff)?.name || null : null;
    return {
      body,
      headers: this.headers,
      footers: this.footers,
      page: this.page,
      titlePage: this.titlePage,
      evenAndOdd: this.facing && (this.headers.even !== undefined || this.footers.even !== undefined),
      defaultFont,
      defaultTab: this.defaultTab,
      lang: this.lang,
      stats: this.stats,
    };
  }

  private snapshot(): ParaSnapshot {
    const s = this.state;
    return { style: s.para, mark: s.run, inTable: s.inTable, itap: s.itap, styleIndex: s.styleIndex };
  }

  /* groups ------------------------------------------------------------------------------------ */

  private pushGroup(): void {
    if (this.stack.length + 1 > this.maxDepth) {
      throw new RtfConversionError("RTF_TOO_COMPLEX", "The RTF file is nested too deeply to be a referrer form. Save it again from Word, or as .docx, and upload that file.");
    }
    if (this.state.starPending) {
      this.state.starPending = false;
      this.state.dest = "skip";
    }
    this.stack.push(this.state);
    this.state = { ...this.state, ownsField: false, ownsStory: null, ownsStyleEntry: false, starPending: false, ownsPict: false, ownsShape: false };
    this.skipChars = 0;
  }

  private popGroup(): void {
    const s = this.state;
    if (s.ownsPict && s.pict) this.finishPicture(s.pict, s);
    if (s.ownsShape && s.shape) this.finishShape(s.shape, s);
    if (s.ownsField && s.field) this.finishField(s.field);
    if (s.ownsStyleEntry && s.styleEntry) this.finishStyleEntry(s);
    if (s.fflItem && s.dest === "ffl" && s.destField && this.stack[this.stack.length - 1]?.fflItem !== s.fflItem) {
      s.destField.ff.items.push(s.fflItem.text.trim());
    }
    if (s.ownsStory) {
      const blocks = s.story.finish({ style: s.para, mark: s.run, inTable: s.inTable, itap: s.itap, styleIndex: s.styleIndex });
      const target = s.ownsStory.footer ? this.footers : this.headers;
      if (target[s.ownsStory.kind] === undefined) target[s.ownsStory.kind] = blocks;
    }
    const parent = this.stack.pop();
    if (parent) this.state = parent;
    this.skipChars = 0;
  }

  /* text -------------------------------------------------------------------------------------- */

  private text(bytes: Uint8Array, start: number, end: number): void {
    const s = this.state;
    if (s.starPending) {
      s.starPending = false;
      s.dest = "skip";
    }
    if (s.dest === "shapetext") {
      if (s.shape && !s.shape.hadText) for (let k = start; k < end && !s.shape.hadText; k++) if (bytes[k] > 0x20) s.shape.hadText = true;
      return;
    }
    if (s.dest === "skip" || s.dest === "upr" || s.dest === "formfield" || s.dest === "nesttableprops" || s.dest === "shppict" || s.dest === "shape") return;
    if (s.dest === "pict") {
      if (s.pict) this.pictureHex(s.pict, bytes, start, end);
      return;
    }
    let ascii = "";
    for (let k = start; k < end; k++) {
      const b = bytes[k];
      if (this.skipChars > 0) {
        this.skipChars -= 1;
        continue;
      }
      if (b >= 0x80) {
        if (ascii) {
          this.flushBytes();
          this.emit(ascii);
          ascii = "";
        }
        this.byte(b);
        continue;
      }
      if (this.pendingBytes.length) {
        // A single-byte code page decodes per byte; a double-byte one may take this byte as a trail byte.
        if (isDoubleByteCodepage(this.pendingCp) && this.pendingBytes.length % 2 === 1 && b >= 0x40) {
          this.pendingBytes.push(b);
          continue;
        }
        this.flushBytes();
      }
      if (b === 0x09) {
        if (ascii) {
          this.emit(ascii);
          ascii = "";
        }
        this.tab();
        continue;
      }
      if (b < 0x20) continue;
      ascii += String.fromCharCode(b);
    }
    if (ascii) {
      this.flushBytes();
      this.emit(ascii);
    }
  }

  private currentFont(): FontInfo | undefined {
    const idx = this.state.font ?? this.deff;
    return idx === null ? undefined : this.fonts.get(idx);
  }

  private codepage(): number {
    const f = this.currentFont();
    if (f?.cpg) return f.cpg;
    if (f && f.charset !== null) {
      const cp = codepageForCharset(f.charset);
      if (cp) return cp;
    }
    return this.ansiCp;
  }

  private symbolKind(): { kind: SymbolFontKind; name: string } | null {
    if (this.state.dest !== "normal" && this.state.dest !== "collect") return null;
    const f = this.currentFont();
    if (!f) return null;
    const kind = symbolFontKind(f.name, f.charset);
    return kind ? { kind, name: f.name } : null;
  }

  /** One 8-bit character (`\'hh` or raw): a symbol-font glyph, or a byte in the current code page. */
  private byte(b: number): void {
    const sym = this.symbolKind();
    if (sym) {
      this.flushBytes();
      this.symbol(sym.kind, sym.name, b);
      return;
    }
    const cp = this.codepage();
    if (this.pendingBytes.length && cp !== this.pendingCp) this.flushBytes();
    this.pendingCp = cp;
    this.pendingBytes.push(b);
    if (!isDoubleByteCodepage(cp)) this.flushBytes();
    else if (this.pendingBytes.length % 2 === 1 && !isLeadByte(cp, b)) this.flushBytes();
  }

  private flushBytes(): void {
    if (this.pendingBytes.length === 0) return;
    const { text, undecoded } = decodeBytes(this.pendingBytes, this.pendingCp);
    this.pendingBytes = [];
    this.stats.undecoded += undecoded;
    this.emit(text);
  }

  private symbol(kind: SymbolFontKind, fontName: string, code: number): void {
    const glyph = symbolGlyph(kind, fontName, code);
    if (!glyph) return;
    if ("text" in glyph) {
      if (glyph.box) this.stats.tickBoxes += 1;
      // Mapped to Unicode: printed in the ordinary font of the text around it.
      this.emitStyled(glyph.text, { ...this.state.run, font: null });
    } else if (this.state.dest === "normal" && !this.state.hidden) {
      this.state.story.addInline({ kind: "sym", font: glyph.sym.font, char: glyph.sym.char, style: this.state.run });
    }
  }

  /** Visible text for the current destination. */
  private emit(text: string): void {
    this.emitStyled(text, this.state.run);
  }

  private emitStyled(text: string, style: RunStyle): void {
    if (!text) return;
    const s = this.state;
    switch (s.dest) {
      case "normal":
        if (!s.hidden) s.story.addText(text, style);
        return;
      case "fldinst":
        if (s.destField) s.destField.instr += text;
        return;
      case "collect":
        if (s.destField) {
          if (!s.destField.collectStyle) s.destField.collectStyle = style;
          s.destField.collected += text;
        }
        return;
      case "ffname":
        if (s.destField) s.destField.ff.name += text;
        return;
      case "ffdeftext":
        if (s.destField) s.destField.ff.deftext += text;
        return;
      case "ffl":
        if (s.fflItem) s.fflItem.text += text;
        return;
      case "fonttbl":
        this.fontText(text);
        return;
      case "colortbl":
        for (let k = 0; k < text.length; k++) if (text[k] === ";") this.endColor();
        return;
      case "stylesheet":
        if (s.styleEntry && !s.styleEntry.done) {
          const semi = text.indexOf(";");
          if (semi >= 0) {
            s.styleEntry.name += text.slice(0, semi);
            s.styleEntry.done = true;
          } else s.styleEntry.name += text;
        }
        return;
      default:
        return;
    }
  }

  private tab(): void {
    const s = this.state;
    if (s.dest === "normal") {
      if (!s.hidden) s.story.addInline({ kind: "tab", style: s.run });
    } else this.emit(" ");
  }

  private lineBreak(): void {
    const s = this.state;
    if (s.dest === "normal") {
      if (!s.hidden) s.story.addInline({ kind: "break", style: s.run });
    } else this.emit(" ");
  }

  /* control words ------------------------------------------------------------------------------ */

  private readControl(bytes: Uint8Array, i: number): number {
    const n = bytes.length;
    if (i + 1 >= n) return n;
    const c = bytes[i + 1];
    if (isLetter(c) && this.state.dest === "skip") return this.skipControlWord(bytes, i);
    if (isLetter(c)) {
      let j = i + 1;
      while (j < n && isLetter(bytes[j]) && j - i <= 32) j++;
      const word = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i + 1, j)) as number[]);
      while (j < n && isLetter(bytes[j])) j++; // over-long words: the rest is ignored
      let neg = false;
      if (bytes[j] === 0x2d && j + 1 < n && bytes[j + 1] >= 0x30 && bytes[j + 1] <= 0x39) {
        neg = true;
        j++;
      }
      let param: number | null = null;
      let digits = 0;
      while (j < n && bytes[j] >= 0x30 && bytes[j] <= 0x39) {
        if (digits < 10) param = (param ?? 0) * 10 + (bytes[j] - 0x30);
        digits++;
        j++;
      }
      if (param !== null) {
        if (neg) param = -param;
        param = Math.max(-2147483648, Math.min(2147483647, param));
      }
      if (j < n && bytes[j] === 0x20) j++;
      if (word === "bin") {
        this.flushBytes();
        const len = param !== null && param > 0 ? param : 0;
        const pict = this.state.dest === "pict" ? this.state.pict : null;
        if (pict && len > 0) {
          if (len > RTF_PICTURE_LIMITS.maxBytes || j + len > n) pict.tooLarge = true;
          else pict.binary = bytes.slice(j, j + len);
        }
        return Math.min(n, j + len);
      }
      if (word !== "u") this.flushBytes();
      this.word(word, param);
      return j;
    }
    if (c === 0x27) {
      const h1 = hex(bytes[i + 2]);
      const h2 = hex(bytes[i + 3]);
      if (h1 < 0 || h2 < 0) return Math.min(n, i + 2);
      if (this.skipChars > 0) {
        this.skipChars -= 1;
        return i + 4;
      }
      if (this.state.starPending) {
        this.state.starPending = false;
        this.state.dest = "skip";
      }
      if (this.state.dest !== "skip") this.byte(h1 * 16 + h2);
      return i + 4;
    }
    this.flushBytes();
    this.controlSymbol(c);
    return i + 2;
  }

  /**
   * A control word inside a skipped destination (a picture's hex, an embedded object, a theme…; 10/2026, for RTF
   * templates of up to 12 MB): word() would ignore it, so it is stepped over without building the word – only \binN
   * still jumps over its N bytes. Same result as the full path (nothing in a skipped group is read), in a fraction
   * of the time, so a template that is mostly pictures converts quickly.
   */
  private skipControlWord(bytes: Uint8Array, i: number): number {
    const n = bytes.length;
    let j = i + 1;
    while (j < n && isLetter(bytes[j])) j++;
    const bin = j - i - 1 === 3 && bytes[i + 1] === 0x62 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x6e;
    let neg = false;
    if (bytes[j] === 0x2d && j + 1 < n && bytes[j + 1] >= 0x30 && bytes[j + 1] <= 0x39) {
      neg = true;
      j++;
    }
    let param = 0;
    let digits = 0;
    while (j < n && bytes[j] >= 0x30 && bytes[j] <= 0x39) {
      if (digits < 10) param = param * 10 + (bytes[j] - 0x30);
      digits++;
      j++;
    }
    if (j < n && bytes[j] === 0x20) j++;
    this.state.starPending = false; // as word() does for any control word
    if (bin && digits > 0 && !neg) return Math.min(n, j + Math.min(2147483647, param));
    return j;
  }

  private controlSymbol(c: number): void {
    const s = this.state;
    if (c === 0x2a) {
      s.starPending = true;
      return;
    }
    if (s.dest === "skip") return;
    if (this.skipChars > 0) {
      this.skipChars -= 1;
      return;
    }
    switch (c) {
      case 0x5c:
        this.emit("\\");
        return;
      case 0x7b:
        this.emit("{");
        return;
      case 0x7d:
        this.emit("}");
        return;
      case 0x7e:
        this.emit("\u00a0");
        return;
      case 0x5f:
        this.emit("\u2011");
        return;
      case 0x0d:
      case 0x0a:
        this.word("par", null);
        return;
      case 0x09:
        this.tab();
        return;
      default:
        return; // \- optional hyphen, \| \: index entries and anything unknown
    }
  }

  /* pictures (fix round 1, B0-14) ------------------------------------------------------------ */

  private startPicture(shape: ShapeCtx | null): void {
    const s = this.state;
    s.dest = "pict";
    s.pict = { format: null, goalW: 0, goalH: 0, scaleX: 100, scaleY: 100, pxW: 0, pxH: 0, hex: [], hexLength: 0, binary: null, tooLarge: false, shape };
    s.ownsPict = true;
    if (shape) shape.sawPicture = true;
  }

  /** A control word in a shape (\shp, its \*\shpinst) or a Word 97+ picture group: its box, and a \pict inside. */
  private shapeWord(word: string, param: number | null): void {
    const s = this.state;
    const shape = s.dest === "shape" || s.dest === "shapetext" ? s.shape : null;
    const v = param ?? 0;
    switch (word) {
      case "pict":
        this.startPicture(shape);
        return;
      case "shpleft":
        if (shape) shape.left = v;
        return;
      case "shpright":
        if (shape) shape.right = v;
        return;
      case "shptop":
        if (shape) shape.top = v;
        return;
      case "shpbottom":
        if (shape) shape.bottom = v;
        return;
      case "shptxt":
        // A text box: its text is not carried over (counted with the shape); a picture in it (a logo) is.
        if (shape) s.dest = "shapetext";
        return;
      default:
        return;
    }
  }

  private pictureWord(p: PictCtx, word: string, param: number | null): void {
    const v = param ?? 0;
    switch (word) {
      case "pngblip":
        p.format = "png";
        return;
      case "jpegblip":
        p.format = "jpeg";
        return;
      case "emfblip":
      case "wmetafile":
      case "macpict":
      case "pmmetafile":
      case "dibitmap":
      case "wbitmap":
        p.format = "other";
        return;
      case "picwgoal":
        p.goalW = v;
        return;
      case "pichgoal":
        p.goalH = v;
        return;
      case "picscalex":
        p.scaleX = v > 0 ? v : 100;
        return;
      case "picscaley":
        p.scaleY = v > 0 ? v : 100;
        return;
      case "picw":
        p.pxW = v;
        return;
      case "pich":
        p.pxH = v;
        return;
      default:
        return;
    }
  }

  /** A picture's hex digits (linear: kept as slices, joined once at the end). */
  private pictureHex(p: PictCtx, bytes: Uint8Array, start: number, end: number): void {
    if (p.tooLarge || p.format === "other") return;
    p.hexLength += end - start;
    if (p.hexLength > RTF_PICTURE_LIMITS.maxBytes * 2 + 64) {
      p.tooLarge = true;
      p.hex = [];
      return;
    }
    p.hex.push(ASCII.decode(bytes.subarray(start, end)));
  }

  /** The picture's bytes when it is a PNG or JPEG of a sensible size, else null. */
  private pictureData(p: PictCtx): Uint8Array | null {
    if (p.tooLarge || (p.format !== "png" && p.format !== "jpeg")) return null;
    let data = p.binary;
    if (!data) {
      const hexText = p.hex.join("").replace(/[^0-9a-fA-F]/g, "");
      if (hexText.length < 8 || hexText.length % 2 !== 0) return null;
      data = new Uint8Array(hexText.length / 2);
      for (let k = 0; k < data.length; k++) data[k] = parseInt(hexText.substr(k * 2, 2), 16);
    }
    // A whole picture only: the PNG signature and its IHDR header, or a JPEG from its start to its end marker.
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const png = data.length >= 33 && sig.every((b, k) => data![k] === b) && String.fromCharCode(data[12], data[13], data[14], data[15]) === "IHDR";
    const jpeg = data.length >= 128 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
    return (p.format === "png" && png) || (p.format === "jpeg" && jpeg) ? data : null;
  }

  /** Whether one more picture of `bytes` may be carried over (count and total size). */
  private pictureFits(bytes: number): boolean {
    return this.stats.picturesKept < RTF_PICTURE_LIMITS.maxPictures && this.keptPictureBytes + bytes <= RTF_PICTURE_LIMITS.totalBytes;
  }

  /** Twips, from the goal size and scale, else the pixel size at 96 dpi (15 twips a pixel); at least 1 pt. */
  private static pictureSize(p: PictCtx): { width: number; height: number } {
    const w = p.goalW > 0 ? (p.goalW * p.scaleX) / 100 : p.pxW * 15;
    const h = p.goalH > 0 ? (p.goalH * p.scaleY) / 100 : p.pxH * 15;
    return { width: Math.max(20, Math.round(w || 1440)), height: Math.max(20, Math.round(h || 1440)) };
  }

  private finishPicture(p: PictCtx, s: State): void {
    const data = this.pictureData(p);
    if (p.shape) {
      if (data && !p.shape.picture) p.shape.picture = { kind: "picture", format: p.format as "png" | "jpeg", data, ...Reader.pictureSize(p), style: s.run };
      return;
    }
    if (!data || !this.pictureFits(data.length)) {
      this.stats.pictures += 1;
      return;
    }
    this.stats.picturesKept += 1;
    this.keptPictureBytes += data.length;
    s.story.addInline({ kind: "picture", format: p.format as "png" | "jpeg", data, ...Reader.pictureSize(p), style: s.run });
  }

  private finishShape(shape: ShapeCtx, s: State): void {
    if (shape.picture && this.pictureFits(shape.picture.data.length)) {
      this.keptPictureBytes += shape.picture.data.length;
      // A picture frame: drawn in line where it is anchored, at the frame's own size when it gives one.
      const w = shape.right - shape.left;
      const h = shape.bottom - shape.top;
      const sized = w > 0 && h > 0 ? { ...shape.picture, width: w, height: h } : shape.picture;
      this.stats.picturesKept += 1;
      s.story.addInline(sized);
      if (shape.hadText) this.stats.shapes += 1; // the text box's own text is still left out
      return;
    }
    if (shape.sawPicture && !shape.hadText) this.stats.pictures += 1;
    else this.stats.shapes += 1;
  }

  private setRun(patch: Partial<RunStyle>): void {
    this.state.run = { ...this.state.run, ...patch };
  }

  private setPara(patch: Partial<ParagraphStyle>): void {
    this.state.para = { ...this.state.para, ...patch };
  }

  private fontName(index: number): string | null {
    if (index === this.deff) return null;
    const name = this.fonts.get(index)?.name;
    return name || null;
  }

  private colorAt(index: number | null): string | null {
    if (index === null || index < 0) return null;
    return this.colors[index] ?? null;
  }

  private word(word: string, param: number | null): void {
    const s = this.state;
    if (s.starPending) {
      s.starPending = false;
      if (!STAR_HANDLED.has(word)) {
        s.dest = "skip";
        return;
      }
    }
    if (s.dest === "skip") return;
    // Fix round 1 (B0-14): inside a picture, a Word 97+ picture group or a shape, only what describes a picture counts.
    if (s.dest === "pict") {
      if (s.pict) this.pictureWord(s.pict, word, param);
      return;
    }
    if (s.dest === "shppict" || s.dest === "shape" || s.dest === "shapetext") {
      this.shapeWord(word, param);
      return;
    }
    const on = param === null || param !== 0;

    // Destinations ----------------------------------------------------------------------------
    if (SKIP_DESTINATIONS.has(word)) {
      s.dest = "skip";
      return;
    }
    switch (word) {
      case "rtf":
        return;
      case "fonttbl":
        s.dest = "fonttbl";
        this.fontEntry = null;
        return;
      case "colortbl":
        s.dest = "colortbl";
        return;
      case "stylesheet":
        s.dest = "stylesheet";
        return;
      case "pict":
        // Fix round 1 (B0-14): a PNG or JPEG picture is carried over; anything else is counted as left out.
        if (s.dest === "normal" || s.dest === "collect") this.startPicture(null);
        else s.dest = "skip";
        return;
      case "shppict":
        if (s.dest === "normal" || s.dest === "collect") s.dest = "shppict";
        else s.dest = "skip";
        return;
      case "object":
        if (s.dest === "normal" || s.dest === "collect") this.stats.objects += 1;
        s.dest = "skip";
        return;
      case "shp":
        // Fix round 1 (B0-14): a shape is read for a picture it holds (a picture frame); else it is a shape left out.
        if (s.dest === "normal" || s.dest === "collect") {
          s.shape = { left: 0, right: 0, top: 0, bottom: 0, sawPicture: false, hadText: false, picture: null };
          s.ownsShape = true;
          s.dest = "shape";
        } else s.dest = "skip";
        return;
      case "shpgrp":
      case "do":
        if (s.dest === "normal" || s.dest === "collect") this.stats.shapes += 1;
        s.dest = "skip";
        return;
      case "footnote":
        if (s.dest === "normal") this.stats.footnotes += 1;
        s.dest = "skip";
        return;
      case "annotation":
        if (s.dest === "normal") this.stats.comments += 1;
        s.dest = "skip";
        return;
      case "upr":
        s.uprOuter = s.dest;
        s.dest = "upr";
        return;
      case "ud":
        if (s.dest === "upr") s.dest = s.uprOuter;
        return;
      case "field":
        if (s.dest !== "normal" && s.dest !== "fldinst" && s.dest !== "collect") {
          s.dest = "skip";
          return;
        }
        s.field = newField(s.story, s.run, s.dest, s.destField);
        s.ownsField = true;
        return;
      case "fldinst":
        if (!s.field || s.field.resultSeen) {
          s.dest = "skip";
          return;
        }
        s.dest = "fldinst";
        s.destField = s.field;
        return;
      case "fldrslt":
        this.fieldResult();
        return;
      case "formfield":
        s.dest = s.field ? "formfield" : "skip";
        s.destField = s.field;
        return;
      case "ffname":
      case "ffdeftext":
        s.dest = s.field ? word : "skip";
        s.destField = s.field;
        return;
      case "ffl":
        if (!s.field) {
          s.dest = "skip";
          return;
        }
        s.dest = "ffl";
        s.destField = s.field;
        s.fflItem = { text: "" };
        return;
      case "nesttableprops":
        s.dest = "nesttableprops";
        return;
      case "listtext":
      case "pntext":
        return;
      default:
        break;
    }
    if (word in HEADER_WORDS) {
      const target = HEADER_WORDS[word];
      const taken = (target.footer ? this.footers : this.headers)[target.kind] !== undefined;
      if (this.section > 0 || taken || s.dest !== "normal" || s.story !== this.body) {
        s.dest = "skip";
        return;
      }
      s.story = new Story(this, true);
      s.ownsStory = target;
      s.field = null;
      s.destField = null;
      return;
    }

    // Font table, colour table, style sheet ----------------------------------------------------
    if (s.dest === "fonttbl") {
      if (word === "f" && param !== null) {
        this.fontEntry = param;
        if (!this.fonts.has(param)) this.fonts.set(param, { name: "", nameDone: false, charset: null, cpg: null });
      } else if (word === "fcharset" && param !== null && this.fontEntry !== null) {
        const f = this.fonts.get(this.fontEntry);
        if (f) f.charset = param;
      } else if (word === "cpg" && param !== null && this.fontEntry !== null) {
        const f = this.fonts.get(this.fontEntry);
        if (f) f.cpg = param;
      }
      return;
    }
    if (s.dest === "colortbl") {
      if (param !== null && (word === "red" || word === "green" || word === "blue")) {
        const v = Math.max(0, Math.min(255, param));
        if (word === "red") this.color.r = v;
        else if (word === "green") this.color.g = v;
        else this.color.b = v;
      }
      return;
    }
    if (s.dest === "stylesheet" && word === "s" && param !== null) {
      s.styleEntry = { index: param, name: "", done: false };
      s.ownsStyleEntry = true;
      return;
    }

    // Form-field properties ----------------------------------------------------------------------
    if (s.dest === "formfield") {
      const ff = s.destField?.ff;
      if (ff && param !== null) {
        if (word === "fftype") ff.type = param;
        else if (word === "ffres") ff.res = param;
        else if (word === "ffdefres") ff.defres = param;
      }
      return;
    }

    // Document and section ---------------------------------------------------------------------
    switch (word) {
      case "ansi":
        this.ansiCp = 1252;
        return;
      case "mac":
        this.ansiCp = 10000;
        return;
      case "pc":
        this.ansiCp = 437;
        return;
      case "pca":
        this.ansiCp = 850;
        return;
      case "ansicpg":
        if (param !== null && param > 0) this.ansiCp = param;
        return;
      case "deff":
        if (param !== null) this.deff = param;
        return;
      case "deflang":
        if (param === 1033) this.lang = "en-US";
        else if (param === 2057) this.lang = "en-GB";
        return;
      case "deftab":
        if (param !== null && param > 0 && param < 20000) this.defaultTab = param;
        return;
      case "paperw":
      case "pgwsxn":
        if (param !== null && param > 0 && this.section === 0) this.page.width = clampTwips(param, 1440, 31680);
        return;
      case "paperh":
      case "pghsxn":
        if (param !== null && param > 0 && this.section === 0) this.page.height = clampTwips(param, 1440, 31680);
        return;
      case "margl":
      case "marglsxn":
        if (param !== null && this.section === 0) this.page.left = clampTwips(param, 0, 15840);
        return;
      case "margr":
      case "margrsxn":
        if (param !== null && this.section === 0) this.page.right = clampTwips(param, 0, 15840);
        return;
      case "margt":
      case "margtsxn":
        if (param !== null && this.section === 0) this.page.top = clampTwips(param, 0, 15840);
        return;
      case "margb":
      case "margbsxn":
        if (param !== null && this.section === 0) this.page.bottom = clampTwips(param, 0, 15840);
        return;
      case "headery":
        if (param !== null && this.section === 0) this.page.header = clampTwips(param, 0, 15840);
        return;
      case "footery":
        if (param !== null && this.section === 0) this.page.footer = clampTwips(param, 0, 15840);
        return;
      case "landscape":
      case "lndscpsxn":
        if (this.section === 0) this.page.landscape = true;
        return;
      case "titlepg":
        if (this.section === 0) this.titlePage = true;
        return;
      case "facingp":
        this.facing = true;
        return;
      case "sect":
        this.sectionBreak();
        return;
      case "sbknone":
      case "sbkcol":
        if (this.sectionBreakPending) this.body.pageBreakNext = false;
        return;
      case "sbkpage":
      case "sbkodd":
      case "sbkeven":
        if (this.sectionBreakPending) this.body.pageBreakNext = true;
        return;
      default:
        break;
    }

    // Unicode ------------------------------------------------------------------------------------
    if (word === "uc") {
      if (param !== null && param >= 0 && param <= 10) s.uc = param;
      return;
    }
    if (word === "u") {
      if (param === null) return;
      const code = param < 0 ? param + 65536 : param;
      this.flushBytes();
      if (this.skipChars > 0) this.skipChars = 0;
      const sym = this.symbolKind();
      if (sym && code >= 0xf020 && code <= 0xf0ff) this.symbol(sym.kind, sym.name, code);
      else if (sym && code >= 0x20 && code <= 0xff) this.symbol(sym.kind, sym.name, code);
      else if (code === 0x2610 || code === 0x2612 || code === 0x2611 || code === 0x25a1) {
        this.stats.tickBoxes += 1;
        this.emit(String.fromCharCode(code === 0x25a1 ? 0x2610 : code));
      } else if (code === 0x09) this.tab();
      else if (code >= 0x20) this.emit(String.fromCharCode(code));
      this.skipChars = s.uc;
      return;
    }

    // Special characters ---------------------------------------------------------------------------
    switch (word) {
      case "par":
        this.paragraphEnd();
        return;
      case "line":
      case "column":
        this.lineBreak();
        return;
      case "tab":
        this.tab();
        return;
      case "page":
        this.pageBreak();
        return;
      case "cell":
        if (s.dest === "normal") s.story.endCell(this.snapshot(), 1);
        return;
      case "nestcell":
        if (s.dest === "normal") s.story.endCell(this.snapshot(), Math.max(2, s.itap));
        return;
      case "row":
        if (s.dest === "normal") s.story.endRow(this.snapshot(), 1, this.topDef);
        return;
      case "nestrow":
        if (s.dest === "nesttableprops" || s.dest === "normal") {
          const story = s.story;
          story.endRow(this.snapshot(), Math.max(2, story.depth()), this.nestDef);
        }
        return;
      case "chpgn":
        if (s.dest === "normal" && s.story.isHeaderFooter) s.story.addInline({ kind: "field", instr: "PAGE", text: "1", style: s.run });
        return;
      case "chftn":
      case "chatn":
      case "chdate":
      case "chdpl":
      case "chdpa":
      case "chtime":
        return;
      default:
        break;
    }
    const special = SPECIAL_CHARS[word];
    if (special !== undefined) {
      if (this.skipChars > 0) {
        this.skipChars -= 1;
        return;
      }
      this.emit(special);
      return;
    }

    // Character formatting ----------------------------------------------------------------------------
    switch (word) {
      case "plain":
        s.run = defaultRunStyle();
        s.font = this.deff;
        s.hidden = false;
        return;
      case "b":
        this.setRun({ bold: on });
        return;
      case "i":
        this.setRun({ italic: on });
        return;
      case "strike":
      case "striked":
        this.setRun({ strike: on });
        return;
      case "caps":
        this.setRun({ caps: on });
        return;
      case "scaps":
        this.setRun({ smallCaps: on });
        return;
      case "v":
      case "deleted":
        s.hidden = on;
        return;
      case "ulnone":
        this.setRun({ underline: null });
        return;
      case "fs":
        if (param !== null) this.setRun({ size: param > 0 ? Math.max(2, Math.min(3276, param)) : 24 });
        return;
      case "f":
        if (param !== null && s.dest !== "stylesheet") {
          s.font = param;
          this.setRun({ font: this.fontName(param) });
        }
        return;
      case "cf":
        this.setRun({ color: this.colorAt(param) });
        return;
      case "super":
        this.setRun({ vertAlign: "superscript" });
        return;
      case "sub":
        this.setRun({ vertAlign: "subscript" });
        return;
      case "nosupersub":
        this.setRun({ vertAlign: null });
        return;
      default:
        break;
    }
    const ul = UNDERLINE_WORDS[word];
    if (ul !== undefined) {
      this.setRun({ underline: on ? ul : null });
      return;
    }

    // Paragraph formatting ----------------------------------------------------------------------------
    switch (word) {
      case "pard":
        s.para = defaultParagraphStyle();
        s.inTable = false;
        s.itap = 0;
        s.styleIndex = null;
        this.borderTarget = null;
        this.tabAlign = "left";
        this.tabLeader = "none";
        return;
      case "intbl":
        s.inTable = on;
        return;
      case "itap":
        if (param !== null) s.itap = Math.max(0, Math.min(this.maxDepth, param));
        return;
      case "s":
        if (param !== null) s.styleIndex = param;
        return;
      case "ql":
        this.setPara({ align: "left" });
        return;
      case "qc":
        this.setPara({ align: "center" });
        return;
      case "qr":
        this.setPara({ align: "right" });
        return;
      case "qj":
      case "qd":
        this.setPara({ align: "both" });
        return;
      case "li":
      case "lin":
        if (param !== null) this.setPara({ left: clampTwips(param, -31680, 31680) });
        return;
      case "ri":
      case "rin":
        if (param !== null) this.setPara({ right: clampTwips(param, -31680, 31680) });
        return;
      case "fi":
        if (param !== null) this.setPara({ firstLine: clampTwips(param, -31680, 31680) });
        return;
      case "sb":
        if (param !== null) this.setPara({ before: clampTwips(param, 0, 31680) });
        return;
      case "sa":
        if (param !== null) this.setPara({ after: clampTwips(param, 0, 31680) });
        return;
      case "sl":
        if (param !== null) this.setPara({ lineRaw: clampTwips(param, -31680, 31680) });
        return;
      case "slmult":
        this.setPara({ lineMult: param === 1 });
        return;
      case "keepn":
        this.setPara({ keepNext: on });
        return;
      case "keep":
        this.setPara({ keepLines: on });
        return;
      case "pagebb":
        this.setPara({ pageBreakBefore: on });
        return;
      case "outlinelevel":
        this.setPara({ outlineLevel: param !== null && param >= 0 && param <= 8 ? param : null });
        return;
      case "tqr":
        this.tabAlign = "right";
        return;
      case "tqc":
        this.tabAlign = "center";
        return;
      case "tqdec":
        this.tabAlign = "decimal";
        return;
      case "tldot":
        this.tabLeader = "dot";
        return;
      case "tlmdot":
        this.tabLeader = "middleDot";
        return;
      case "tlhyph":
        this.tabLeader = "hyphen";
        return;
      case "tlul":
        this.tabLeader = "underscore";
        return;
      case "tlth":
        this.tabLeader = "heavy";
        return;
      case "tleq":
        this.tabLeader = "none";
        return;
      case "tx":
        if (param !== null && param >= 0 && param <= 31680 && s.para.tabs.length < 64) {
          this.setPara({ tabs: [...s.para.tabs, { pos: param, align: this.tabAlign, leader: this.tabLeader }] });
        }
        this.tabAlign = "left";
        this.tabLeader = "none";
        return;
      case "tb":
        this.tabAlign = "left";
        this.tabLeader = "none";
        return;
      case "brdrt":
      case "brdrb":
      case "brdrl":
      case "brdrr":
      case "box": {
        const b = newBorder();
        const borders: Borders = { ...(s.para.borders ?? {}) };
        if (word === "box") {
          borders.top = b;
          borders.bottom = b;
          borders.left = b;
          borders.right = b;
        } else borders[word === "brdrt" ? "top" : word === "brdrb" ? "bottom" : word === "brdrl" ? "left" : "right"] = b;
        this.setPara({ borders });
        this.borderTarget = b;
        return;
      }
      default:
        break;
    }

    // Borders (paragraph, row and cell) ---------------------------------------------------------------
    const borderStyle = BORDER_STYLES[word];
    if (borderStyle !== undefined) {
      if (this.borderTarget) {
        this.borderTarget.style = borderStyle;
        if (word === "brdrhair") this.borderTarget.width = 5;
        if (word === "brdrth") this.borderTarget.width = Math.max(this.borderTarget.width, 20);
      }
      return;
    }
    if (word === "brdrw") {
      if (this.borderTarget && param !== null) this.borderTarget.width = Math.max(0, Math.min(255, param));
      return;
    }
    if (word === "brdrcf") {
      if (this.borderTarget) this.borderTarget.color = this.colorAt(param);
      return;
    }
    if (word === "brsp") {
      if (this.borderTarget && param !== null) this.borderTarget.space = Math.max(0, Math.min(31, Math.round(param / 20)));
      return;
    }

    // Tables ------------------------------------------------------------------------------------------------
    if (s.dest === "normal" || s.dest === "nesttableprops") this.tableWord(word, param, on);
  }

  private tableWord(word: string, param: number | null, on: boolean): void {
    const nested = this.state.dest === "nesttableprops";
    const def = nested ? this.nestDef : this.topDef;
    const cell = nested ? this.nestCell : this.topCell;
    switch (word) {
      case "trowd":
        if (nested) {
          this.nestDef = defaultRowDef();
          this.nestCell = defaultCellDef();
        } else {
          this.topDef = defaultRowDef();
          this.topCell = defaultCellDef();
        }
        this.borderTarget = null;
        return;
      case "trgaph":
        if (param !== null) def.gap = clampTwips(param, 0, 2880);
        return;
      case "trleft":
        if (param !== null) def.left = clampTwips(param, -15840, 15840);
        return;
      case "trrh":
        if (param !== null) def.height = clampTwips(param, -31680, 31680);
        return;
      case "trhdr":
        def.header = on;
        return;
      case "trkeep":
        def.cantSplit = on;
        return;
      case "trql":
        def.align = "left";
        return;
      case "trqc":
        def.align = "center";
        return;
      case "trqr":
        def.align = "right";
        return;
      case "trpaddl":
        if (param !== null) def.padLeft = clampTwips(param, 0, 2880);
        return;
      case "trpaddr":
        if (param !== null) def.padRight = clampTwips(param, 0, 2880);
        return;
      case "trautofit":
        def.autofit = on;
        return;
      case "trbrdrt":
      case "trbrdrl":
      case "trbrdrb":
      case "trbrdrr":
      case "trbrdrh":
      case "trbrdrv": {
        const b = newBorder();
        const side = ({ trbrdrt: "top", trbrdrl: "left", trbrdrb: "bottom", trbrdrr: "right", trbrdrh: "insideH", trbrdrv: "insideV" } as const)[word];
        def.borders[side] = b;
        this.borderTarget = b;
        return;
      }
      case "clbrdrt":
      case "clbrdrl":
      case "clbrdrb":
      case "clbrdrr": {
        const b = newBorder();
        const side = ({ clbrdrt: "top", clbrdrl: "left", clbrdrb: "bottom", clbrdrr: "right" } as const)[word];
        cell.borders[side] = b;
        this.borderTarget = b;
        return;
      }
      case "clvmgf":
        cell.vMerge = "restart";
        return;
      case "clvmrg":
        cell.vMerge = "continue";
        return;
      case "clmgf":
        cell.hMerge = "first";
        return;
      case "clmrg":
        cell.hMerge = "merge";
        return;
      case "clvertalt":
        cell.vAlign = "top";
        return;
      case "clvertalc":
        cell.vAlign = "center";
        return;
      case "clvertalb":
        cell.vAlign = "bottom";
        return;
      case "clcbpat":
      case "clcbpatraw":
        cell.shading = this.colorAt(param);
        return;
      case "clshdng":
      case "clshdngraw":
        if (param !== null && param > 0 && !cell.shading) {
          const v = Math.round(255 * (1 - Math.min(10000, param) / 10000));
          const hx = v.toString(16).padStart(2, "0").toUpperCase();
          cell.shading = `${hx}${hx}${hx}`;
        }
        return;
      case "cellx":
        if (param === null) return;
        if (def.cells.length >= 63) return;
        cell.right = clampTwips(param, -15840, 31680);
        def.cells.push(cell);
        if (nested) this.nestCell = defaultCellDef();
        else this.topCell = defaultCellDef();
        this.borderTarget = null;
        return;
      default:
        return;
    }
  }

  /* paragraphs, pages, sections ------------------------------------------------------------------------ */

  private paragraphEnd(): void {
    const s = this.state;
    if (s.dest === "normal") s.story.endParagraph(this.snapshot());
    else if (s.dest === "collect" || s.dest === "fldinst") this.emit(" ");
  }

  private pageBreak(): void {
    const s = this.state;
    if (s.dest !== "normal") return;
    const story = s.story;
    if (s.inTable || s.itap > 0) return; // no page breaks inside a table cell
    if (story.inlines.some((i) => i.kind !== "text" || i.text.trim() !== "")) story.endParagraph(this.snapshot());
    else story.inlines = [];
    story.pageBreakNext = true;
  }

  private sectionBreak(): void {
    const s = this.state;
    if (s.dest !== "normal" || s.story !== this.body) return;
    if (this.body.hasContent()) this.body.endParagraph(this.snapshot());
    this.section += 1;
    this.stats.sections += 1;
    this.body.pageBreakNext = true;
    this.sectionBreakPending = true;
  }

  /* fields --------------------------------------------------------------------------------------------- */

  private fieldResult(): void {
    const s = this.state;
    const f = s.field;
    if (!f || f.resultSeen) {
      // A result outside a field (or a second one): plain text.
      if (s.dest === "fldinst" || s.dest === "formfield") s.dest = "skip";
      return;
    }
    f.resultSeen = true;
    parseInstr(f);
    s.dest = f.outerDest;
    s.destField = f.outerDestField;
    f.textMark = f.story.textCount;
    // A field inside another field's instruction or result: its result text goes there as it is.
    if (f.outerDest !== "normal") return;
    const inHeader = f.story.isHeaderFooter;
    switch (f.type) {
      case "FORMCHECKBOX":
        this.emitCheckbox(f, s.run);
        s.dest = "skip";
        return;
      case "FORMTEXT":
      case "FORMDROPDOWN":
        f.collect = true;
        s.dest = "collect";
        s.destField = f;
        return;
      case "SYMBOL":
        this.emitSymbolField(f);
        s.dest = "skip";
        return;
      case "INCLUDEPICTURE":
        this.stats.pictures += 1;
        s.dest = "skip";
        return;
      case "PAGE":
      case "NUMPAGES":
      case "SECTIONPAGES":
        if (inHeader) {
          f.collect = true;
          s.dest = "collect";
          s.destField = f;
        }
        return;
      case "MERGEFIELD":
        // Never printed: an answer space instead (resolveMergeFields), however the result reads.
        f.story.addInline({ kind: "merge", name: mergeName(f) || "field", style: s.run });
        s.dest = "skip";
        return;
      default:
        return;
    }
  }

  private finishField(f: FieldCtx): void {
    if (f.outerDest !== "normal") return;
    if (!f.resultSeen) {
      parseInstr(f);
      // No result was written: print what Word would show.
      switch (f.type) {
        case "FORMCHECKBOX":
          this.emitToStory(f, () => this.emitCheckbox(f, f.style));
          return;
        case "FORMTEXT":
        case "FORMDROPDOWN":
          this.emitFormText(f);
          return;
        case "SYMBOL":
          this.emitToStory(f, () => this.emitSymbolField(f));
          return;
        case "MERGEFIELD":
          f.story.addInline({ kind: "merge", name: mergeName(f) || "field", style: f.style });
          return;
        case "PAGE":
        case "NUMPAGES":
        case "SECTIONPAGES":
          if (f.story.isHeaderFooter) f.story.addInline({ kind: "field", instr: f.type, text: "1", style: f.style });
          return;
        default:
          return;
      }
    }
    if (f.collect) {
      if (f.type === "FORMTEXT" || f.type === "FORMDROPDOWN") this.emitFormText(f);
      else if (f.story.isHeaderFooter) {
        f.story.addInline({ kind: "field", instr: f.type as "PAGE", text: f.collected.trim() || "1", style: f.collectStyle ?? f.style });
      }
      return;
    }
  }

  /** Run `fn` with the field's own story as the output (a field's fallback is printed where it stands). */
  private emitToStory(f: FieldCtx, fn: () => void): void {
    const s = this.state;
    const saved = { dest: s.dest, story: s.story, hidden: s.hidden };
    s.dest = "normal";
    s.story = f.story;
    s.hidden = false;
    try {
      fn();
    } finally {
      s.dest = saved.dest;
      s.story = saved.story;
      s.hidden = saved.hidden;
    }
  }

  private emitCheckbox(f: FieldCtx, style: RunStyle): void {
    const res = f.ff.res;
    const checked = res === 1 || ((res === null || res === 25) && f.ff.defres === 1);
    this.stats.formCheckboxes += 1;
    this.stats.tickBoxes += 1;
    if (f.story.isHeaderFooter) this.stats.headerFooterFillIns += 1;
    f.story.addText(checked ? CHECKED_BOX : UNCHECKED_BOX, { ...style, font: null }, true);
  }

  private emitFormText(f: FieldCtx): void {
    const style = f.collectStyle ?? f.style;
    if (f.story.isHeaderFooter) this.stats.headerFooterFillIns += 1;
    if (f.type === "FORMDROPDOWN") {
      this.stats.formDropdowns += 1;
      const items = f.ff.items.filter(Boolean);
      const label = items.length ? items.join(" / ") : f.collected.replace(MERGE_FILLER, " ").trim();
      f.story.addText(label && label.length <= 60 && !/[[\]]/.test(label) ? `[${label}]` : label || "__________", style, true);
      return;
    }
    this.stats.formTextFields += 1;
    let text = f.collected.replace(MERGE_FILLER, " ").trim();
    if (!text) text = f.ff.deftext.replace(MERGE_FILLER, " ").trim();
    if (!text) f.story.addText("__________", style, true);
    else if (text.length <= 60 && !/[[\]]/.test(text)) f.story.addText(`[${text}]`, style, true);
    else f.story.addText(text, style, true);
  }

  private emitSymbolField(f: FieldCtx): void {
    const code = parseSymbolCode(f.args[0]);
    if (code === null) return;
    const fontArg = switchValue(f.args, "\\f");
    const kind = fontArg ? symbolFontKind(fontArg, null) : null;
    if (kind) this.symbol(kind, fontArg ?? "Symbol", code);
    else if (code >= 0x20) {
      if (code === 0x2610 || code === 0x2612 || code === 0x2611) this.stats.tickBoxes += 1;
      f.story.addText(String.fromCharCode(code), f.style);
    }
  }

  /* font / colour / style tables ----------------------------------------------------------------------- */

  private fontText(text: string): void {
    if (this.fontEntry === null) return;
    const f = this.fonts.get(this.fontEntry);
    if (!f || f.nameDone) return;
    const semi = text.indexOf(";");
    if (semi >= 0) {
      f.name = (f.name + text.slice(0, semi)).trim();
      f.nameDone = true;
    } else f.name += text;
  }

  private endColor(): void {
    const { r, g, b } = this.color;
    if (r < 0 && g < 0 && b < 0) this.colors.push(null);
    else this.colors.push([r, g, b].map((v) => Math.max(0, v).toString(16).padStart(2, "0")).join("").toUpperCase());
    this.color = { r: -1, g: -1, b: -1 };
  }

  private finishStyleEntry(s: State): void {
    const entry = s.styleEntry;
    if (!entry) return;
    const name = entry.name.trim();
    const byName = /^heading\s*(\d)$/i.exec(name);
    const outline = s.para.outlineLevel ?? (byName ? Math.max(0, Math.min(8, Number(byName[1]) - 1)) : null);
    this.styles.set(entry.index, { name, outline });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------------------------------*/

function clampTwips(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function newBorder(): Border {
  return { style: "single", width: 10, color: null, space: 0 };
}

function newField(story: Story, style: RunStyle, outerDest: Dest, outerDestField: FieldCtx | null): FieldCtx {
  return {
    outerDest: outerDest === "collect" || outerDest === "fldinst" ? outerDest : "normal",
    outerDestField,
    instr: "",
    type: "",
    args: [],
    ff: { type: null, res: null, defres: null, name: "", deftext: "", items: [] },
    resultSeen: false,
    collect: false,
    collected: "",
    collectStyle: null,
    textMark: 0,
    story,
    style,
  };
}

/** Field instruction → type (upper case) and arguments (quotes removed; switches kept as "\x"). */
function parseInstr(f: FieldCtx): void {
  if (f.type) return;
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  const instr = f.instr.length > 4000 ? f.instr.slice(0, 4000) : f.instr;
  while ((m = re.exec(instr)) !== null && tokens.length < 40) tokens.push(m[1] !== undefined ? m[1] : m[2]);
  f.type = (tokens[0] ?? "").replace(/^\\+/, "").toUpperCase();
  f.args = tokens.slice(1);
}

function mergeName(f: FieldCtx): string {
  const name = f.args.find((a) => !a.startsWith("\\")) ?? "";
  return name.replace(/[«»]/g, "").trim().slice(0, 60);
}

function switchValue(args: string[], sw: string): string | null {
  const i = args.findIndex((a) => a.toLowerCase() === sw);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function parseSymbolCode(arg: string | undefined): number | null {
  if (!arg) return null;
  const v = /^0x[0-9a-f]+$/i.test(arg) ? parseInt(arg.slice(2), 16) : /^\d+$/.test(arg) ? parseInt(arg, 10) : NaN;
  return Number.isFinite(v) && v >= 0 && v <= 0xffff ? v : null;
}

/* ------------------------------------------------------------------------------------------------
 * Mail-merge fields → answer spaces (10/2026)
 * ----------------------------------------------------------------------------------------------*/

/** A typed merge placeholder: «Name» or <<Name>> (one paragraph, at most 60 characters inside). */
const TYPED_MERGE = /«\s*([^«»\u0000\n]{1,60}?)\s*»|<<\s*([^<>\u0000\n]{1,60}?)\s*>>/g;
/** Another system's fill-in token, kept as printed and noted: [Name], {Name}, $Name$, %Name%. */
const OTHER_TOKENS = /\[[A-Za-z][A-Za-z0-9 _.\-/]{0,39}\]|\{[A-Za-z][A-Za-z0-9 _.\-/]{0,39}\}|\$[A-Za-z][A-Za-z0-9_.]{0,39}\$|%[A-Za-z][A-Za-z0-9_.]{0,39}%/g;
/** What may stand between merge fields in an otherwise empty line ("«Town», «Postcode»"). */
const FILLER_ONLY = /^[\s,;:.\-\u2013\u2014/()]*$/;
/** The fill-in line a merge field becomes when the line has other text ("Patient: __________"). */
export const MERGE_BLANK = "__________";

function notePracticeCode(stats: RtfStats, name: string): void {
  stats.practiceCodes += 1;
  if (stats.practiceCodeNames.length < 50 && !stats.practiceCodeNames.includes(name)) stats.practiceCodeNames.push(name);
}

function noteMergeName(stats: RtfStats, name: string): void {
  stats.mergeFields += 1;
  const n = name.trim().slice(0, 60);
  if (n && stats.mergeFieldNames.length < 50 && !stats.mergeFieldNames.includes(n)) stats.mergeFieldNames.push(n);
}

/**
 * A paragraph's mail-merge fields – MERGEFIELD fields (already "merge" inlines) and typed «Name» /
 * <<Name>> in the template's own text, even split across runs – become answer spaces: a line that is
 * only merge fields (and commas, spaces…) becomes an empty paragraph – an empty table cell when it is a
 * cell's only line; otherwise each becomes a "__________" fill-in line beside its label. Text that looks
 * like another system's token ([Name], {Name}, $Name$, %Name%) is kept and counted for the notes.
 */
function resolveMergeFields(inlines: Inline[], stats: RtfStats, headerFooter: boolean): Inline[] {
  // The template's own text, one character per inline position for anything else (so no token spans it).
  let full = "";
  const starts: number[] = [];
  for (const inl of inlines) {
    starts.push(full.length);
    full += inl.kind === "text" && !inl.generated ? inl.text : "\u0000";
  }
  const ranges: Array<{ start: number; end: number; name: string; keep: boolean }> = [];
  const re = new RegExp(TYPED_MERGE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(full)) !== null) {
    const name = (m[1] ?? m[2] ?? "").trim();
    // 10/2026: a clinic system's own letter code (<<P_SURNAME>>, <<DATE>> – upper case in double angle brackets) is
    // kept as printed in the body, so the form reading can fill it from the record (core/practice-merge-codes.ts);
    // the merge-field safety block still stops approval while one is left. Headers and footers: as before.
    const keep = m[2] !== undefined && !headerFooter && isPracticeCodeName(name);
    ranges.push({ start: m.index, end: m.index + m[0].length, name, keep });
  }
  const other = new RegExp(OTHER_TOKENS.source, "g");
  while ((m = other.exec(full)) !== null) {
    stats.otherTokens += 1;
    if (stats.otherTokenExamples.length < 3 && !stats.otherTokenExamples.includes(m[0])) stats.otherTokenExamples.push(m[0]);
  }
  const hasMarkers = inlines.some((i) => i.kind === "merge");
  if (ranges.length === 0 && !hasMarkers) return inlines;

  // Cut the typed tokens out, leaving a merge marker where each began.
  let work: Inline[] = inlines;
  if (ranges.length > 0) {
    work = [];
    let r = 0;
    inlines.forEach((inl, i) => {
      if (inl.kind !== "text" || inl.generated) {
        work.push(inl);
        return;
      }
      const from = starts[i];
      const to = from + inl.text.length;
      let piece = "";
      for (let pos = from; pos < to; pos++) {
        while (r < ranges.length && ranges[r].end <= pos) r++;
        const range = ranges[r];
        if (range && pos >= range.start && pos < range.end) {
          if (pos === range.start) {
            if (piece) work.push({ kind: "text", text: piece, style: inl.style });
            piece = "";
            work.push(range.keep ? { kind: "text", text: `<<${range.name}>>`, style: inl.style } : { kind: "merge", name: range.name, style: inl.style });
            if (range.keep) notePracticeCode(stats, range.name);
          }
          continue;
        }
        piece += full[pos];
      }
      if (piece) work.push({ kind: "text", text: piece, style: inl.style });
    });
  }

  let merges = 0;
  for (const inl of work) {
    if (inl.kind !== "merge") continue;
    merges += 1;
    noteMergeName(stats, inl.name);
  }
  if (headerFooter) stats.headerFooterFillIns += merges;
  const visible = work.some((inl) => (inl.kind === "text" ? !FILLER_ONLY.test(inl.text) : inl.kind === "sym" || inl.kind === "field"));
  // Only merge fields on this line: an empty line (or cell) is the answer space.
  if (!visible) return [];
  return work.map((inl) => (inl.kind === "merge" ? { kind: "text", text: MERGE_BLANK, style: inl.style, generated: true } : inl));
}

/** Read an RTF file into the document model. Throws RtfConversionError. */
export function readRtf(bytes: Uint8Array, limits: RtfReadLimits = {}): RtfDocument {
  if (!isRtfBytes(bytes)) throw new RtfConversionError("RTF_INVALID", "This is not an RTF file.");
  return new Reader(limits).read(bytes);
}
