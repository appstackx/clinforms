/**
 * RtfDocument (model.ts) → a Word .docx package (WordprocessingML). Writes plain, conventional markup
 * the forms engine already reads (forms/docx-dom.ts): body paragraphs and tables in document order,
 * direct paragraph and run formatting, outline levels for headings, ☐/☒ as text, page headers and
 * footers as their own parts, and (fix round 1, B0-14) PNG and JPEG pictures as inline drawings with their bytes in
 * word/media. Deterministic: the same document always gives the same bytes.
 *
 * Tables: every row's cell boundaries (RTF \cellx) go into one grid for the table, so rows with
 * different cell layouts keep their widths (cells span grid columns with w:gridSpan, rows that start
 * later or end earlier get w:gridBefore / w:gridAfter). Always fixed layout (even when the RTF asked
 * for autofit), so answers written in later do not resize the columns.
 *
 * Browser-safe and pure.
 */
import {
  DEFAULT_SIZE,
  type Block,
  type Border,
  type Borders,
  type CellDef,
  type HeaderKind,
  type Inline,
  type Paragraph,
  type ParagraphStyle,
  type RtfDocument,
  type RunStyle,
  type Table,
  type TableRow,
} from "./model";
import { RtfConversionError } from "./reader";
import { zipStored, type ZipEntry } from "./zip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* ------------------------------------------------------------------------------------------------
 * Escaping
 * ----------------------------------------------------------------------------------------------*/

/** Text without what XML 1.0 cannot hold (C0 except tab/LF/CR, U+FFFE/FFFF), C1 controls and lone surrogates. */
export function cleanText(text: string): string {
  let out = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let bad: boolean;
    if (c < 0x20) bad = c !== 0x09 && c !== 0x0a && c !== 0x0d;
    else if (c >= 0x7f && c <= 0x9f) bad = true;
    else if (c === 0xfffe || c === 0xffff) bad = true;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      bad = true;
    } else bad = c >= 0xdc00 && c <= 0xdfff;
    if (bad) {
      out += text.slice(start, i);
      start = i + 1;
    }
  }
  return start === 0 ? text : out + text.slice(start);
}

function esc(text: string): string {
  return cleanText(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(text: string): string {
  return esc(text).replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------------------------------------
 * Output with a size cap
 * ----------------------------------------------------------------------------------------------*/

class Out {
  private parts: string[] = [];
  private length = 0;
  constructor(private readonly budget: { left: number }) {}
  push(s: string): void {
    this.parts.push(s);
    this.length += s.length;
    this.budget.left -= s.length;
    if (this.budget.left < 0) {
      throw new RtfConversionError("RTF_TOO_LARGE", "Converted to Word, this form would be larger than the upload limit. Remove pictures or unused pages from the template, or save it as .docx, and try again.");
    }
  }
  toString(): string {
    return this.parts.join("");
  }
}

interface Ctx {
  defaultFont: string | null;
  rprCache: Map<RunStyle, string>;
  textWidth: number;
  /** Fix round 1 (B0-14): the pictures written so far (the package's media) and the part being written. */
  media: Array<{ file: string; data: Uint8Array }>;
  partRels: string[];
}

const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

/** A picture in line with the text (fix round 1, B0-14): its bytes as word/media/imageN, related from this part. */
function pictureXml(inl: Extract<Inline, { kind: "picture" }>, ctx: Ctx): string {
  const n = ctx.media.length + 1;
  const file = `image${n}.${inl.format === "png" ? "png" : "jpeg"}`;
  ctx.media.push({ file, data: inl.data });
  const rId = `rIdImg${n}`;
  ctx.partRels.push(`<Relationship Id="${rId}" Type="${IMAGE_REL}" Target="media/${file}"/>`);
  // EMU (914400 an inch) from twips (1440 an inch).
  const cx = Math.round(inl.width * 635);
  const cy = Math.round(inl.height * 635);
  return (
    // (The drawing namespace is declared here, so a form without pictures converts to exactly the bytes it did.)
    `<w:r>${rPr(inl.style, ctx)}<w:drawing><wp:inline xmlns:wp="${WP_NS}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${n}" name="Picture ${n}"/><a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}">` +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
  );
}

/* ------------------------------------------------------------------------------------------------
 * Runs
 * ----------------------------------------------------------------------------------------------*/

function rPrInner(st: RunStyle, ctx: Ctx): string {
  let x = "";
  if (st.font && st.font !== ctx.defaultFont) {
    const f = attr(st.font.slice(0, 31));
    x += `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`;
  }
  if (st.bold) x += "<w:b/><w:bCs/>";
  if (st.italic) x += "<w:i/><w:iCs/>";
  if (st.caps) x += "<w:caps/>";
  if (st.smallCaps) x += "<w:smallCaps/>";
  if (st.strike) x += "<w:strike/>";
  if (st.color) x += `<w:color w:val="${st.color}"/>`;
  if (st.size !== DEFAULT_SIZE) x += `<w:sz w:val="${st.size}"/><w:szCs w:val="${st.size}"/>`;
  if (st.underline) x += `<w:u w:val="${st.underline}"/>`;
  if (st.vertAlign) x += `<w:vertAlign w:val="${st.vertAlign}"/>`;
  return x;
}

function rPr(st: RunStyle, ctx: Ctx): string {
  let cached = ctx.rprCache.get(st);
  if (cached === undefined) {
    const inner = rPrInner(st, ctx);
    cached = inner ? `<w:rPr>${inner}</w:rPr>` : "";
    ctx.rprCache.set(st, cached);
  }
  return cached;
}

function runsXml(inlines: Inline[], ctx: Ctx, out: Out): void {
  let curPr: string | null = null;
  let body = "";
  let text = "";
  const flushText = () => {
    if (text) body += `<w:t xml:space="preserve">${esc(text)}</w:t>`;
    text = "";
  };
  const flushRun = () => {
    flushText();
    if (curPr !== null && body) out.push(`<w:r>${curPr}${body}</w:r>`);
    curPr = null;
    body = "";
  };
  for (const inl of inlines) {
    if (inl.kind === "merge") continue; // resolved by the reader; never written
    if (inl.kind === "field") {
      flushRun();
      out.push(`<w:fldSimple w:instr=" ${inl.instr} "><w:r>${rPr(inl.style, ctx)}<w:t xml:space="preserve">${esc(inl.text)}</w:t></w:r></w:fldSimple>`);
      continue;
    }
    if (inl.kind === "picture") {
      flushRun();
      out.push(pictureXml(inl, ctx));
      continue;
    }
    if (inl.kind === "sym") {
      flushRun();
      const ch = inl.char.toString(16).toUpperCase().padStart(4, "0");
      out.push(`<w:r>${rPr(inl.style, ctx)}<w:sym w:font="${attr(inl.font.slice(0, 31))}" w:char="${ch}"/></w:r>`);
      continue;
    }
    const pr = rPr(inl.style, ctx);
    if (curPr !== pr) {
      flushRun();
      curPr = pr;
    }
    if (inl.kind === "text") text += inl.text;
    else {
      flushText();
      body += inl.kind === "tab" ? "<w:tab/>" : "<w:br/>";
    }
  }
  flushRun();
}

/* ------------------------------------------------------------------------------------------------
 * Paragraphs
 * ----------------------------------------------------------------------------------------------*/

function borderXml(side: string, b: Border | undefined): string {
  if (!b) return "";
  if (b.style === "nil") return `<w:${side} w:val="nil"/>`;
  const sz = Math.max(2, Math.min(96, Math.round((b.width * 2) / 5)));
  return `<w:${side} w:val="${b.style}" w:sz="${sz}" w:space="${b.space}" w:color="${b.color ?? "auto"}"/>`;
}

function bordersXml(tag: string, b: Borders | null | undefined, sides: Array<keyof Borders>): string {
  if (!b) return "";
  const inner = sides.map((s) => borderXml(s, b[s])).join("");
  return inner ? `<w:${tag}>${inner}</w:${tag}>` : "";
}

function pPrXml(st: ParagraphStyle, mark: RunStyle, ctx: Ctx): string {
  let x = "";
  if (st.keepNext) x += "<w:keepNext/>";
  if (st.keepLines) x += "<w:keepLines/>";
  if (st.pageBreakBefore) x += "<w:pageBreakBefore/>";
  x += bordersXml("pBdr", st.borders, ["top", "left", "bottom", "right"]);
  if (st.tabs.length) {
    const tabs = st.tabs
      .slice()
      .sort((a, b) => a.pos - b.pos)
      .map((t) => `<w:tab w:val="${t.align}"${t.leader !== "none" ? ` w:leader="${t.leader}"` : ""} w:pos="${t.pos}"/>`)
      .join("");
    x += `<w:tabs>${tabs}</w:tabs>`;
  }
  if (st.before || st.after || st.lineRaw) {
    let sp = "<w:spacing";
    if (st.before) sp += ` w:before="${st.before}"`;
    if (st.after) sp += ` w:after="${st.after}"`;
    if (st.lineRaw) {
      if (st.lineMult) sp += ` w:line="${Math.abs(st.lineRaw)}" w:lineRule="auto"`;
      else if (st.lineRaw > 0) sp += ` w:line="${st.lineRaw}" w:lineRule="atLeast"`;
      else sp += ` w:line="${-st.lineRaw}" w:lineRule="exact"`;
    }
    x += `${sp}/>`;
  }
  if (st.left || st.right || st.firstLine) {
    let ind = "<w:ind";
    if (st.left) ind += ` w:left="${st.left}"`;
    if (st.right) ind += ` w:right="${st.right}"`;
    if (st.firstLine > 0) ind += ` w:firstLine="${st.firstLine}"`;
    else if (st.firstLine < 0) ind += ` w:hanging="${-st.firstLine}"`;
    x += `${ind}/>`;
  }
  if (st.align !== "left") x += `<w:jc w:val="${st.align}"/>`;
  if (st.outlineLevel !== null) x += `<w:outlineLvl w:val="${st.outlineLevel}"/>`;
  const mk = rPr(mark, ctx);
  x += mk;
  return x ? `<w:pPr>${x}</w:pPr>` : "";
}

function paragraphXml(p: Paragraph, ctx: Ctx, out: Out): void {
  out.push(`<w:p>${pPrXml(p.style, p.mark, ctx)}`);
  runsXml(p.inlines, ctx, out);
  out.push("</w:p>");
}

/* ------------------------------------------------------------------------------------------------
 * Tables
 * ----------------------------------------------------------------------------------------------*/

interface CellOut {
  left: number;
  right: number;
  def: CellDef;
  content: Block[];
}

function isBlankParagraph(b: Block): boolean {
  return b.kind === "paragraph" && b.inlines.every((i) => (i.kind === "text" && i.text.trim() === "") || i.kind === "break");
}

/** A row's cells with their left/right boundaries (horizontally merged cells joined). */
function rowCells(row: TableRow, fallbackWidth: number): CellOut[] {
  const defs = row.def.cells;
  const n = Math.max(row.cells.length, defs.length);
  const out: CellOut[] = [];
  let prev = row.def.left;
  const lastWidth = defs.length ? Math.max(100, defs[defs.length - 1].right - (defs.length > 1 ? defs[defs.length - 2].right : row.def.left)) : 0;
  for (let i = 0; i < n; i++) {
    const d = defs[i];
    const width = d ? d.right - prev : lastWidth || Math.max(360, Math.round(fallbackWidth / Math.max(1, n)));
    const right = prev + Math.max(100, width);
    const content = row.cells[i] ?? [];
    const def: CellDef = d ?? { right, borders: {}, vMerge: null, hMerge: null, vAlign: "top", shading: null };
    if (def.hMerge === "merge" && out.length > 0) {
      const last = out[out.length - 1];
      last.right = right;
      if (!content.every(isBlankParagraph)) last.content = [...last.content, ...content];
    } else {
      out.push({ left: prev, right, def, content });
    }
    prev = right;
  }
  return out;
}

/** One grid of column boundaries for the table (at most 63 columns, as in Word). */
function tableGrid(rows: CellOut[][]): number[] {
  const all: number[] = [];
  for (const cells of rows) for (const c of cells) all.push(c.left, c.right);
  all.sort((a, b) => a - b);
  for (const tolerance of [15, 60, 120, 240, 480, 960, 1920]) {
    const grid: number[] = [];
    for (const v of all) if (grid.length === 0 || v - grid[grid.length - 1] > tolerance) grid.push(v);
    if (grid.length <= 64) return grid;
  }
  return [all[0], Math.max(all[0] + 100, all[all.length - 1])];
}

function gridIndex(grid: number[], v: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < grid.length; i++) {
    const d = Math.abs(grid[i] - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function blocksXml(blocks: Block[], ctx: Ctx, out: Out): void {
  for (const b of blocks) {
    if (b.kind === "paragraph") paragraphXml(b, ctx, out);
    else tableXml(b, ctx, out);
  }
  // A table cell (and the document body) must end with a paragraph.
  if (blocks.length === 0 || blocks[blocks.length - 1].kind === "table") out.push("<w:p/>");
}

function tableXml(t: Table, ctx: Ctx, out: Out): void {
  const rows = t.rows.map((r) => rowCells(r, ctx.textWidth));
  const grid = tableGrid(rows);
  if (grid.length < 2) return;
  const first = t.rows[0].def;
  const widths: number[] = [];
  for (let i = 1; i < grid.length; i++) widths.push(Math.max(1, grid[i] - grid[i - 1]));
  const total = grid[grid.length - 1] - grid[0];
  let tblPr = `<w:tblW w:w="${total}" w:type="dxa"/>`;
  if (first.align !== "left") tblPr += `<w:jc w:val="${first.align}"/>`;
  else if (grid[0] !== 0) tblPr += `<w:tblInd w:w="${grid[0]}" w:type="dxa"/>`;
  tblPr += bordersXml("tblBorders", first.borders, ["top", "left", "bottom", "right", "insideH", "insideV"]);
  // Fixed layout always: a form's columns keep their printed widths when answers are written in.
  tblPr += '<w:tblLayout w:type="fixed"/>';
  const padL = first.padLeft ?? first.gap;
  const padR = first.padRight ?? first.gap;
  tblPr += `<w:tblCellMar><w:left w:w="${padL}" w:type="dxa"/><w:right w:w="${padR}" w:type="dxa"/></w:tblCellMar>`;
  out.push(`<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`);
  t.rows.forEach((row, r) => {
    const cells = rows[r];
    if (cells.length === 0) return;
    const startIdx = gridIndex(grid, cells[0].left);
    const endIdx = gridIndex(grid, cells[cells.length - 1].right);
    let trPr = "";
    if (startIdx > 0) trPr += `<w:gridBefore w:val="${startIdx}"/><w:wBefore w:w="${grid[startIdx] - grid[0]}" w:type="dxa"/>`;
    if (endIdx < grid.length - 1) trPr += `<w:gridAfter w:val="${grid.length - 1 - endIdx}"/><w:wAfter w:w="${grid[grid.length - 1] - grid[endIdx]}" w:type="dxa"/>`;
    if (row.def.cantSplit) trPr += "<w:cantSplit/>";
    if (row.def.height > 0) trPr += `<w:trHeight w:val="${row.def.height}"/>`;
    else if (row.def.height < 0) trPr += `<w:trHeight w:val="${-row.def.height}" w:hRule="exact"/>`;
    if (row.def.header) trPr += "<w:tblHeader/>";
    out.push(`<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ""}`);
    let col = startIdx;
    for (const cell of cells) {
      const end = Math.max(col + 1, gridIndex(grid, cell.right));
      const span = end - col;
      const width = grid[Math.min(end, grid.length - 1)] - grid[col];
      let tcPr = `<w:tcW w:w="${Math.max(0, width)}" w:type="dxa"/>`;
      if (span > 1) tcPr += `<w:gridSpan w:val="${span}"/>`;
      if (cell.def.vMerge === "restart") tcPr += '<w:vMerge w:val="restart"/>';
      else if (cell.def.vMerge === "continue") tcPr += "<w:vMerge/>";
      tcPr += bordersXml("tcBorders", cell.def.borders, ["top", "left", "bottom", "right"]);
      if (cell.def.shading) tcPr += `<w:shd w:val="clear" w:color="auto" w:fill="${cell.def.shading}"/>`;
      if (cell.def.vAlign !== "top") tcPr += `<w:vAlign w:val="${cell.def.vAlign}"/>`;
      out.push(`<w:tc><w:tcPr>${tcPr}</w:tcPr>`);
      blocksXml(cell.content, ctx, out);
      out.push("</w:tc>");
      col = end;
    }
    out.push("</w:tr>");
  });
  out.push("</w:tbl>");
}

/* ------------------------------------------------------------------------------------------------
 * Package parts
 * ----------------------------------------------------------------------------------------------*/

function stylesXml(doc: RtfDocument): string {
  const font = attr((doc.defaultFont ?? "Times New Roman").slice(0, 31));
  return (
    `${XML_DECL}<w:styles xmlns:w="${W_NS}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>` +
    `<w:sz w:val="${DEFAULT_SIZE}"/><w:szCs w:val="${DEFAULT_SIZE}"/><w:lang w:val="${doc.lang}" w:eastAsia="${doc.lang}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
    '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    "</w:styles>"
  );
}

function settingsXml(doc: RtfDocument): string {
  return (
    `${XML_DECL}<w:settings xmlns:w="${W_NS}">` +
    `<w:defaultTabStop w:val="${doc.defaultTab}"/>` +
    (doc.evenAndOdd ? "<w:evenAndOddHeaders/>" : "") +
    '<w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    "</w:settings>"
  );
}

interface HeaderPart {
  footer: boolean;
  kind: HeaderKind;
  file: string;
  rId: string;
  xml: string;
}

export interface DocxWriteOptions {
  /** Largest package accepted (bytes); larger throws RTF_TOO_LARGE. */
  maxBytes: number;
}

/** Write the document as .docx bytes. Throws RtfConversionError("RTF_TOO_LARGE"). */
export function writeDocx(doc: RtfDocument, opts: DocxWriteOptions): Uint8Array {
  const budget = { left: opts.maxBytes };
  const page = doc.page;
  let width = page.width;
  let height = page.height;
  if (page.landscape && width < height) [width, height] = [height, width];
  const ctx: Ctx = { defaultFont: doc.defaultFont, rprCache: new Map(), textWidth: Math.max(1440, width - page.left - page.right), media: [], partRels: [] };
  /** Each header / footer part's picture relationships (its own .rels part). */
  const partRels = new Map<string, string[]>();

  const parts: HeaderPart[] = [];
  const addParts = (footer: boolean, set: RtfDocument["headers"]) => {
    for (const kind of ["default", "first", "even"] as HeaderKind[]) {
      const blocks = set[kind];
      if (!blocks) continue;
      const n = parts.filter((p) => p.footer === footer).length + 1;
      const out = new Out(budget);
      const tag = footer ? "ftr" : "hdr";
      out.push(`${XML_DECL}<w:${tag} xmlns:w="${W_NS}" xmlns:r="${R_NS}">`);
      ctx.partRels = [];
      blocksXml(blocks, ctx, out);
      out.push(`</w:${tag}>`);
      const file = `${footer ? "footer" : "header"}${n}.xml`;
      if (ctx.partRels.length) partRels.set(file, ctx.partRels);
      parts.push({ footer, kind, file, rId: `rId${3 + parts.length}`, xml: out.toString() });
    }
  };
  addParts(false, doc.headers);
  addParts(true, doc.footers);

  const body = new Out(budget);
  body.push(`${XML_DECL}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`);
  ctx.partRels = [];
  blocksXml(doc.body, ctx, body);
  const bodyRels = ctx.partRels;
  let sect = "";
  for (const p of parts) sect += `<w:${p.footer ? "footer" : "header"}Reference w:type="${p.kind}" r:id="${p.rId}"/>`;
  sect += `<w:pgSz w:w="${width}" w:h="${height}"${page.landscape ? ' w:orient="landscape"' : ""}/>`;
  sect += `<w:pgMar w:top="${page.top}" w:right="${page.right}" w:bottom="${page.bottom}" w:left="${page.left}" w:header="${page.header}" w:footer="${page.footer}" w:gutter="0"/>`;
  if (doc.titlePage) sect += "<w:titlePg/>";
  body.push(`<w:sectPr>${sect}</w:sectPr></w:body></w:document>`);

  const contentTypes =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (ctx.media.some((m) => m.file.endsWith(".png")) ? '<Default Extension="png" ContentType="image/png"/>' : "") +
    (ctx.media.some((m) => m.file.endsWith(".jpeg")) ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : "") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    parts
      .map((p) => `<Override PartName="/word/${p.file}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${p.footer ? "footer" : "header"}+xml"/>`)
      .join("") +
    "</Types>";
  const rootRels =
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";
  const docRels =
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    parts.map((p) => `<Relationship Id="${p.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${p.footer ? "footer" : "header"}" Target="${p.file}"/>`).join("") +
    bodyRels.join("") +
    "</Relationships>";
  const relsPart = (rels: string[]) => `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;

  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "word/document.xml", data: enc.encode(body.toString()) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
    { name: "word/styles.xml", data: enc.encode(stylesXml(doc)) },
    { name: "word/settings.xml", data: enc.encode(settingsXml(doc)) },
    ...parts.map((p) => ({ name: `word/${p.file}`, data: enc.encode(p.xml) })),
    ...Array.from(partRels.entries()).map(([file, rels]) => ({ name: `word/_rels/${file}.rels`, data: enc.encode(relsPart(rels)) })),
    ...ctx.media.map((m) => ({ name: `word/media/${m.file}`, data: m.data })),
  ];
  const zip = zipStored(entries);
  if (zip.byteLength > opts.maxBytes) {
    throw new RtfConversionError("RTF_TOO_LARGE", "Converted to Word, this form would be larger than the upload limit. Remove pictures or unused pages from the template, or save it as .docx, and try again.");
  }
  return zip;
}
