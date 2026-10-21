/**
 * RTF → Word converter (core/rtf): every construct a referrer's report template uses, character
 * decoding, tables (widths, borders, merges, nesting), fields (mail merge, form fields, symbols), tick
 * boxes, page headers and footers, page set-up, what is left out and noted, malformed and hostile input
 * (truncation, depth, size, time), determinism and the package itself (well-formed parts, stored ZIP
 * with valid CRCs). The forms engine on the converted files is covered in scripts/medreport/rtf-forms.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { hasBannedTerm } from "../wording";
import {
  RTF_NOTE_PREFIX,
  RtfConversionError,
  convertRtfToDocx,
  isConvertedFromRtf,
  isRtfBytes,
  isRtfConversionNote,
  rtfNoteText,
  wordFileNameFor,
  type RtfConversionResult,
} from "./index";
import { crc32 } from "./zip";

const MAX = 2.5 * 1024 * 1024;
const enc = (s: string) => new TextEncoder().encode(s);
/** An RTF \uN control word (built so that no literal backslash-u escape appears in this source). */
const U = (n: number) => `${"\\"}u${n}`;
const doc = (body: string, head = "") => `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}{\\f1\\fnil\\fcharset2 Wingdings;}{\\f2\\froman\\fcharset2 Symbol;}{\\f3\\fnil\\fcharset2 Wingdings 2;}{\\f4\\froman\\fcharset204 Times New Roman Cyr;}}{\\colortbl;\\red255\\green0\\blue0;\\red217\\green226\\blue243;}${head}\n${body}}`;
const convert = (rtf: string, opts: Partial<{ maxBytes: number; maxDepth: number; maxBlocks: number; maxInlines: number }> = {}): RtfConversionResult =>
  convertRtfToDocx(enc(rtf), { maxBytes: MAX, ...opts });

function part(docx: Uint8Array, name: string): string {
  const zip = new PizZip(docx, { checkCRC32: true });
  const file = zip.file(name);
  assert.ok(file, `${name} exists`);
  return file.asText();
}
const body = (r: RtfConversionResult) => part(r.docx, "word/document.xml");

function wellFormed(xml: string): void {
  new DOMParser({
    onError: (level, msg) => {
      if (level !== "warning") throw new Error(`XML ${level}: ${msg}`);
    },
  }).parseFromString(xml, "application/xml");
}

/** Visible text of the body, paragraphs joined by "|" and cells by "¦" (w:t, tabs as spaces). */
function texts(xml: string): string[] {
  const out: string[] = [];
  const re = /<w:p>([\s\S]*?)<\/w:p>|<w:p\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1] ?? "";
    out.push(
      inner
        .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, "")
        .replace(/<w:tab\/>/g, " ")
        .replace(/<w:br\/>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    );
  }
  return out;
}

function rtfError(fn: () => unknown): RtfConversionError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof RtfConversionError, `expected RtfConversionError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected an RtfConversionError");
}

/* ------------------------------------------------------------------------------------------------
 * Detection and the package
 * ----------------------------------------------------------------------------------------------*/

test("isRtfBytes: {\\rtf after an optional byte-order mark and white space; nothing else", () => {
  assert.equal(isRtfBytes(enc("{\\rtf1\\ansi hi}")), true);
  assert.equal(isRtfBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...Array.from(enc("\r\n {\\rtf1 x}"))])), true);
  assert.equal(isRtfBytes(enc("%PDF-1.7")), false);
  assert.equal(isRtfBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), false);
  assert.equal(isRtfBytes(enc("{rtf1}")), false);
  assert.equal(isRtfBytes(enc("hello")), false);
  assert.equal(isRtfBytes(new Uint8Array(0)), false);
});

test("the package: stored ZIP with valid CRCs, the parts Word needs, well-formed XML, no images", () => {
  const r = convert(doc("Hello\\par"));
  const zip = new PizZip(r.docx, { checkCRC32: true });
  assert.deepEqual(Object.keys(zip.files).sort(), ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/settings.xml", "word/styles.xml"]);
  for (const name of Object.keys(zip.files)) wellFormed(zip.file(name)!.asText());
  assert.match(part(r.docx, "[Content_Types].xml"), /wordprocessingml\.document\.main\+xml/);
  assert.match(part(r.docx, "word/settings.xml"), /compatibilityMode" w:uri="http:\/\/schemas\.microsoft\.com\/office\/word" w:val="15"/);
  // Every entry is stored (method 0) with a correct CRC-32.
  const view = new DataView(r.docx.buffer, r.docx.byteOffset, r.docx.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0, "stored");
  assert.equal(crc32(enc("123456789")), 0xcbf43926, "CRC-32 check value");
});

test("deterministic: the same RTF always gives the same bytes", () => {
  const rtf = doc("{\\b Name:} ____\\par\\trowd\\cellx3000\\cellx6000\\intbl A\\cell B\\cell\\row\\pard After\\par");
  const a = convert(rtf).docx;
  const b = convert(rtf).docx;
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

/* ------------------------------------------------------------------------------------------------
 * Text, characters and formatting
 * ----------------------------------------------------------------------------------------------*/

test("paragraphs, line breaks, tabs and the literal escapes", () => {
  const r = convert(doc("First\\par Second\\line next\\tab end\\par \\\\ \\{braces\\} \\~nbsp\\_hyph\\par\nLast"));
  const t = texts(body(r));
  assert.deepEqual(t, ["First", "Second\nnext end", "\\ {braces} \u00a0nbsp\u2011hyph", "Last"]);
});

test("code page 1252, \\uN with the \\ucN fallback skip, surrogate pairs, other code pages", () => {
  const r = convert(
    doc(
      `caf\\'e9 \\'80 \\'93q\\'94 \\'a3 ${U(8217)}\\'92 ${U(8364)}? \\uc2${U(9744)}xx\\uc0${U(9746)} \\uc1${U(-10179)}?${U(-8704)}? {\\f4 \\'cf\\'f0\\'e8} \\'81end\\par`,
    ),
  );
  assert.equal(texts(body(r))[0], "café € “q” £ ’ € ☐☒\ud83d\ude00 При end");
  assert.equal(r.stats.undecoded, 1, "0x81 is undefined in Windows-1252");
});

test("character formatting: bold, italic, underline, strike, caps, size, font, colour, super/subscript; \\plain resets", () => {
  const xml = body(convert(doc("{\\b B}{\\i I}{\\ul U}{\\uldb D}{\\strike S}{\\caps C}{\\fs32 Big}{\\f2 \\'b7}{\\cf1 Red}{\\super 2}{\\sub x}{\\b\\plain P}\\par")));
  assert.match(xml, /<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">B</);
  assert.match(xml, /<w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">I</);
  assert.match(xml, /<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">U</);
  assert.match(xml, /<w:u w:val="double"\/>/);
  assert.match(xml, /<w:strike\/>/);
  assert.match(xml, /<w:caps\/>/);
  assert.match(xml, /<w:sz w:val="32"\/><w:szCs w:val="32"\/><\/w:rPr><w:t xml:space="preserve">Big</);
  assert.match(xml, /<w:t xml:space="preserve">•<\/w:t>/, "Symbol bullet → •");
  assert.match(xml, /<w:color w:val="FF0000"\/><\/w:rPr><w:t xml:space="preserve">Red</);
  assert.match(xml, /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2</);
  assert.match(xml, /<w:vertAlign w:val="subscript"\/>/);
  assert.match(xml, /<w:r><w:t xml:space="preserve">P<\/w:t><\/w:r>/, "\\plain: no formatting");
});

test("paragraph formatting: alignment, indents, spacing, keep-with-next, page break before, outline level, tab stops, borders", () => {
  const xml = body(
    convert(doc("\\pard\\qc\\li720\\ri360\\fi-360\\sb120\\sa240\\sl360\\slmult1\\keepn\\outlinelevel1\\tqr\\tldot\\tx9000\\brdrb\\brdrs\\brdrw10 Heading\\par\\pard\\qj\\pagebb Body\\par")),
  );
  assert.match(
    xml,
    /<w:pPr><w:keepNext\/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"\/><\/w:pBdr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"\/><\/w:tabs><w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"\/><w:ind w:left="720" w:right="360" w:hanging="360"\/><w:jc w:val="center"\/><w:outlineLvl w:val="1"\/>/,
  );
  assert.match(xml, /<w:pPr><w:pageBreakBefore\/><w:jc w:val="both"\/><\/w:pPr><w:r><w:t xml:space="preserve">Body/);
});

test("headings from the style sheet (\\sN with \\outlinelevel or a “heading N” name)", () => {
  const head = "{\\stylesheet{\\ql Normal;}{\\s1\\outlinelevel0\\b heading 1;}{\\s2 heading 2;}{\\*\\cs10 Default Paragraph Font;}}";
  const xml = body(convert(doc("\\pard\\s1 Title\\par\\pard\\s2 Sub\\par\\pard Body\\par", head)));
  assert.match(xml, /<w:outlineLvl w:val="0"\/><\/w:pPr><w:r><w:t xml:space="preserve">Title/);
  assert.match(xml, /<w:outlineLvl w:val="1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Sub/);
  assert.doesNotMatch(xml, /Normal|Default Paragraph Font/, "style names are not text");
});

test("hidden and deleted text is left out; ignored destinations never leak text", () => {
  const r = convert(
    doc(
      "{\\info{\\title Secret title}{\\author Someone}}{\\*\\generator Writer;}{\\*\\unknowndest leaked}{\\*\\bkmkstart b1}Shown{\\v hidden}{\\deleted gone} {\\xe index}{\\*\\atnid x}text\\par",
    ),
  );
  assert.deepEqual(texts(body(r)), ["Shown text"]);
});

test("pictures, objects, shapes and footnotes are left out and counted in the notes", () => {
  const r = convert(
    doc(
      "A{\\*\\shppict{\\pict\\pngblip 89504e47}}{\\nonshppict{\\pict\\wmetafile8 0100}}B{\\pict\\jpegblip ffd8}C{\\object\\objemb{\\*\\objdata 0102}{\\result{\\pict\\wmetafile8 01}}}D{\\shp{\\*\\shpinst{\\sp{\\sn x}{\\sv 1}}{\\shptxt Box text}}}{\\shprslt Fallback}E{\\footnote\\chftn Note}F\\par",
    ),
  );
  assert.deepEqual(texts(body(r)), ["ABCDEF"]);
  assert.deepEqual([r.stats.pictures, r.stats.objects, r.stats.shapes, r.stats.footnotes], [2, 1, 1, 1]);
  assert.equal(r.notes.length, 4);
  assert.match(r.notes[0], /^Converted from RTF: 2 pictures \(such as a logo\) could not be carried over and were left out\.$/);
  assert.match(r.notes[1], /text box or drawn shape was left out/);
  for (const n of r.notes) {
    assert.ok(isRtfConversionNote(n));
    assert.equal(hasBannedTerm(n), false, n);
  }
  assert.equal(rtfNoteText(r.notes[0]).startsWith("2 pictures"), true);
});

test("\\bin data is skipped by length; characters XML cannot hold are dropped", () => {
  // \uN takes the next character as its fallback (\uc1): "?" here; a lone surrogate and U+FFFF are dropped.
  const r = convert(doc(`A{\\pict\\bin5 {}\\x\\}B ${U(1)}?${U(65535)}?C${U(-10179)}? D\\par`));
  assert.deepEqual(texts(body(r)), ["AB C D"]);
  wellFormed(body(r));
});

/* ------------------------------------------------------------------------------------------------
 * Tables
 * ----------------------------------------------------------------------------------------------*/

const ROW = (cells: string[], defs: string) => `\\trowd\\trgaph108\\trleft-108${defs}${cells.map((c) => `\\pard\\intbl ${c}\\cell`).join("")}\\row`;

test("tables: widths from \\cellx, borders, shading, header row, row height; text before and after", () => {
  const defs = "\\trhdr\\trrh400\\trbrdrt\\brdrs\\brdrw10\\clbrdrt\\brdrs\\brdrw10\\clbrdrb\\brdrdb\\brdrw20\\clcbpat2\\cellx3000\\clvertalc\\cellx9000";
  const xml = body(convert(doc(`Before\\par${ROW(["{\\b Name}", ""], defs)}${ROW(["Date of birth", ""], "\\cellx3000\\cellx9000")}\\pard After\\par`)));
  assert.match(xml, /<w:tbl><w:tblPr><w:tblW w:w="9108" w:type="dxa"\/><w:tblInd w:w="-108" w:type="dxa"\/><w:tblBorders><w:top w:val="single" w:sz="4"/);
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/);
  assert.match(xml, /<w:tblGrid><w:gridCol w:w="3108"\/><w:gridCol w:w="6000"\/><\/w:tblGrid>/);
  assert.match(xml, /<w:trPr><w:trHeight w:val="400"\/><w:tblHeader\/><\/w:trPr>/);
  assert.match(xml, /<w:tcW w:w="3108" w:type="dxa"\/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"\/><w:bottom w:val="double" w:sz="8"/);
  assert.match(xml, /<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"\/>/);
  assert.match(xml, /<w:vAlign w:val="center"\/>/);
  assert.deepEqual(texts(xml), ["Before", "Name", "", "Date of birth", "", "After"]);
  assert.equal((xml.match(/<w:tr>/g) ?? []).length, 2);
});

test("rows with different cell layouts share one grid (w:gridSpan); \\clmgf/\\clmrg merge across; \\clvmgf/\\clvmrg merge down", () => {
  const two = "\\cellx3000\\cellx9000";
  const merged = "\\clmgf\\cellx3000\\clmrg\\cellx9000";
  const three = "\\clvmgf\\cellx3000\\cellx6000\\cellx9000";
  const threeCont = "\\clvmrg\\cellx3000\\cellx6000\\cellx9000";
  const xml = body(
    convert(doc(`${ROW(["Heading across", ""], merged)}${ROW(["Q1", ""], two)}${ROW(["Outcome", "At start", ""], three)}${ROW(["", "At end", ""], threeCont)}\\pard\\par`)),
  );
  assert.match(xml, /<w:tblGrid><w:gridCol w:w="3108"\/><w:gridCol w:w="3000"\/><w:gridCol w:w="3000"\/><\/w:tblGrid>/);
  // Row 1: one cell over the whole width; row 2: label + a cell over two grid columns.
  const rows = xml.split("<w:tr>").slice(1);
  assert.equal((rows[0].match(/<w:tc>/g) ?? []).length, 1);
  assert.match(rows[0], /<w:tcW w:w="9108" w:type="dxa"\/><w:gridSpan w:val="3"\/>/);
  assert.match(rows[1], /<w:tcW w:w="6000" w:type="dxa"\/><w:gridSpan w:val="2"\/>/);
  assert.match(rows[2], /<w:vMerge w:val="restart"\/>/);
  assert.match(rows[3], /<w:vMerge\/>/);
  assert.equal((rows[2].match(/<w:tc>/g) ?? []).length, 3);
});

test("nested tables (\\itap, \\nestcell, \\nesttableprops … \\nestrow) become a table inside the cell", () => {
  const inner = "\\pard\\intbl\\itap2 In A\\nestcell\\pard\\intbl\\itap2 In B\\nestcell{\\*\\nesttableprops\\trowd\\cellx2000\\cellx4000\\nestrow}{\\nonesttables\\par}";
  const rtf = doc(`\\trowd\\cellx5000\\cellx9000\\pard\\intbl\\itap1 Outer A\\par${inner}\\pard\\intbl\\itap1\\cell\\pard\\intbl\\itap1 Outer B\\cell\\row\\pard After\\par`);
  const xml = body(convert(rtf));
  wellFormed(xml);
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 2);
  const outerFirstCell = xml.slice(xml.indexOf("<w:tc>"), xml.indexOf("Outer B"));
  assert.match(outerFirstCell, /Outer A[\s\S]*<w:tbl>[\s\S]*In A[\s\S]*In B[\s\S]*<\/w:tbl><w:p>/, "nested table inside the cell, followed by a paragraph");
  assert.doesNotMatch(xml, /nonesttables/);
});

test("Cocoa (TextEdit) tables: \\itap1, \\lastrow and \\-newline paragraph ends", () => {
  const rtf = doc("Intro\\\n\\itap1\\trowd \\trgaph108\\trleft-108 \\clbrdrt\\brdrs\\brdrw20 \\cellx4320\n\\clbrdrt\\brdrs\\brdrw20 \\cellx8640\n\\pard\\intbl\\itap1 Label\\cell \n\\pard\\intbl\\itap1 \\cell \\lastrow\\row\n\\pard Done\\\n");
  const xml = body(convert(rtf));
  assert.deepEqual(texts(xml), ["Intro", "Label", "", "Done"]);
});

test("a table with more cells than definitions, or none, still gets widths", () => {
  const xml = body(convert(doc("\\trowd\\cellx3000\\pard\\intbl A\\cell B\\cell C\\cell\\row\\pard\\par")));
  assert.equal((xml.match(/<w:tc>/g) ?? []).length, 3);
  assert.match(xml, /<w:tblGrid>(<w:gridCol w:w="\d+"\/>){3}<\/w:tblGrid>/);
  const none = body(convert(doc("\\pard\\intbl A\\cell B\\cell\\row\\pard\\par")));
  assert.equal((none.match(/<w:tc>/g) ?? []).length, 2);
  wellFormed(none);
});

/* ------------------------------------------------------------------------------------------------
 * Fields, form fields and tick boxes
 * ----------------------------------------------------------------------------------------------*/

test("mail-merge fields (MERGEFIELD, typed «Name» and <<Name>>) become answer spaces beside their labels; nested fields in instructions do not leak", () => {
  const r = convert(
    doc(
      "Name: {\\field{\\*\\fldinst { MERGEFIELD Patient_Name \\\\* MERGEFORMAT }}{\\fldrslt {\\'abPatient_Name\\'bb}}}\\par " +
        "DOB: {\\field{\\*\\fldinst MERGEFIELD \"Date of Birth\"}{\\fldrslt }}\\par " +
        "Typed: \\'abClinic_Ref\\'bb and {\\'ab}{\\b Split}{\\i _Ref}{\\'bb}.\\par " +
        "Angled: <<Referral Date>>\\par " +
        "{\\field{\\*\\fldinst IF {\\field{\\*\\fldinst MERGEFIELD Sex}{\\fldrslt F}} = \"F\" \"Mrs\" \"Mr\"}{\\fldrslt Mrs}} Smith\\par " +
        "{\\field{\\*\\fldinst HYPERLINK \"https://example.invalid/\"}{\\fldrslt Link text}}\\par",
    ),
  );
  const xml = body(r);
  assert.deepEqual(texts(xml), ["Name: __________", "DOB: __________", "Typed: __________ and __________.", "Angled: __________", "Mrs Smith", "Link text"]);
  assert.equal(r.stats.mergeFields, 5);
  assert.deepEqual(r.stats.mergeFieldNames, ["Patient_Name", "Date of Birth", "Clinic_Ref", "Split_Ref", "Referral Date"]);
  assert.doesNotMatch(xml, /example\.invalid|HYPERLINK|MERGEFIELD|«|»|&lt;&lt;/);
  assert.ok(r.notes.includes("Converted from RTF: 5 mail-merge fields from your clinic system («Patient_Name», «Date of Birth», «Clinic_Ref») were turned into answer boxes – check the mapping once."));
});

test("a line or table cell that is only mail-merge fields becomes an empty answer space; other tokens are kept and noted", () => {
  const field = (name: string) => `{\\field{\\*\\fldinst MERGEFIELD ${name}}{\\fldrslt \\'ab${name}\\'bb}}`;
  const r = convert(
    doc(
      `Address:\\par ${field("Address_1")}\\par \\'abTown\\'bb, \\'abPostcode\\'bb\\par ` +
        `\\trowd\\cellx3000\\cellx9000\\pard\\intbl Referral reference\\cell \\'abReferral Ref\\'bb\\cell\\row ` +
        `\\trowd\\cellx3000\\cellx9000\\pard\\intbl Treating therapist\\cell ${field("Therapist")}\\cell\\row ` +
        "\\pard Case: [Case_ID] \\{Claim\\} $DOB$ %REF% and [ordinary words, with commas]\\par " +
        `Form field: {\\field{\\*\\fldinst FORMTEXT {\\*\\formfield{\\fftype0{\\*\\ffname T}}}}{\\fldrslt Default}}\\par`,
    ),
  );
  const xml = body(r);
  assert.deepEqual(texts(xml), ["Address:", "", "", "Referral reference", "", "Treating therapist", "", "Case: [Case_ID] {Claim} $DOB$ %REF% and [ordinary words, with commas]", "Form field: [Default]"]);
  assert.equal(r.stats.mergeFields, 5);
  assert.equal(r.stats.otherTokens, 4, "[Case_ID] {Claim} $DOB$ %REF% – not the sentence in brackets, not the form field's own [Default]");
  assert.deepEqual(r.stats.otherTokenExamples, ["[Case_ID]", "{Claim}", "$DOB$"]);
  assert.ok(r.notes.some((n) => /4 placeholders that another system may fill in \(\[Case_ID\], \{Claim\}, \$DOB\$\) were kept as printed – check whether each one is an answer box/.test(n)));
});

test("merge fields in a page header become fill-in lines there too, and are noted", () => {
  const r = convert(doc("{\\header \\pard Re: {\\field{\\*\\fldinst MERGEFIELD Patient}{\\fldrslt \\'abPatient\\'bb}}\\tab <<Ref>>\\par}Body\\par"));
  const header = part(r.docx, "word/header1.xml");
  assert.match(header, /Re: __________<\/w:t><w:tab\/><w:t xml:space="preserve">__________/);
  assert.doesNotMatch(header, /«|&lt;&lt;/);
  assert.equal(r.stats.headerFooterFillIns, 2);
});

test("form fields: FORMTEXT → a fill-in line (or [default]), FORMCHECKBOX → ☐/☒, FORMDROPDOWN → [A / B]", () => {
  const formText = (name: string, result: string, deftext = "") =>
    `{\\field{\\*\\fldinst { FORMTEXT }{\\*\\formfield{\\fftype0\\fftypetxt0{\\*\\ffname ${name}}${deftext ? `{\\*\\ffdeftext ${deftext}}` : ""}}}}{\\fldrslt {${result}}}}`;
  const check = (props: string) => `{\\field{\\*\\fldinst { FORMCHECKBOX }{{\\*\\datafield 6500}{\\*\\formfield{\\fftype1\\fftypetxt0${props}{\\*\\ffname C}}}}}{\\fldrslt }}`;
  const r = convert(
    doc(
      `Diagnosis: ${formText("T1", `${U(8194)}\\'20${U(8194)}\\'20`)}\\par ` +
        `Ref: ${formText("T2", "Not known")}\\par ` +
        `Def: ${formText("T3", "", "N/A")}\\par ` +
        `Yes ${check("\\ffres25")} No ${check("\\ffres25\\ffdefres1")} Maybe ${check("\\ffres1")}\\par ` +
        `Fit: {\\field{\\*\\fldinst FORMDROPDOWN {\\*\\formfield{\\fftype2\\ffres25{\\*\\ffname D}{\\*\\ffl Fit}{\\*\\ffl Unfit}}}}{\\fldrslt }}\\par`,
    ),
  );
  assert.deepEqual(texts(body(r)), ["Diagnosis: __________", "Ref: [Not known]", "Def: [N/A]", "Yes ☐ No ☒ Maybe ☒", "Fit: [Fit / Unfit]"]);
  assert.deepEqual([r.stats.formTextFields, r.stats.formCheckboxes, r.stats.formDropdowns], [3, 3, 1]);
  assert.doesNotMatch(body(r), /FORMTEXT|FORMCHECKBOX|ffname|6500/);
});

test("tick boxes: Wingdings and Wingdings 2 boxes, \\u boxes, SYMBOL fields → ☐/☒; other symbols kept as Word symbols", () => {
  const r = convert(
    doc(
      `A {\\f1 \\'a8} B {\\f1 \\'fe} C {\\f3 \\'a3} D ${U(9744)}? E {\\f1 ${U(-3928)}?} F {\\field{\\*\\fldinst SYMBOL 168 \\\\f "Wingdings" \\\\s 11}{\\fldrslt\\f1}} G {\\f1 \\'fc} H {\\f1 \\'31}\\par`,
    ),
  );
  const xml = body(r);
  assert.equal(texts(xml)[0], "A ☐ B ☒ C ☐ D ☐ E ☐ F ☐ G ✓ H ");
  assert.match(xml, /<w:sym w:font="Wingdings" w:char="F031"\/>/, "an unmapped Wingdings character stays a symbol");
  assert.equal(r.stats.tickBoxes, 6);
});

/* ------------------------------------------------------------------------------------------------
 * Page set-up, headers and footers, breaks and sections
 * ----------------------------------------------------------------------------------------------*/

test("page size, margins and orientation; page headers and footers as their own parts; PAGE fields stay live", () => {
  const head = "\\paperw16838\\paperh11906\\margl1000\\margr1100\\margt1200\\margb1300\\landscape\\sectd\\headery500\\footery600\\titlepg";
  const rtf = doc(
    "{\\header \\pard Larchfield (fictional)\\tab Ref {\\field{\\*\\fldinst MERGEFIELD Ref}{\\fldrslt \\'abRef\\'bb}}\\par}{\\headerf \\pard First page header\\par}{\\footer \\pard Page {\\field{\\*\\fldinst PAGE}{\\fldrslt 1}} of {\\field{\\*\\fldinst NUMPAGES}{\\fldrslt 3}}\\par}Body\\par",
    head,
  );
  const r = convert(rtf);
  const xml = body(r);
  assert.match(xml, /<w:headerReference w:type="default" r:id="rId3"\/><w:headerReference w:type="first" r:id="rId4"\/><w:footerReference w:type="default" r:id="rId5"\/>/);
  assert.match(xml, /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/><w:pgMar w:top="1200" w:right="1100" w:bottom="1300" w:left="1000" w:header="500" w:footer="600" w:gutter="0"\/><w:titlePg\/>/);
  assert.deepEqual(texts(xml), ["Body"], "header and footer text is not in the body");
  const header = part(r.docx, "word/header1.xml");
  wellFormed(header);
  assert.match(header, /Larchfield \(fictional\)/);
  const footer = part(r.docx, "word/footer1.xml");
  assert.match(footer, /<w:fldSimple w:instr=" PAGE "><w:r><w:t xml:space="preserve">1<\/w:t><\/w:r><\/w:fldSimple>/);
  assert.match(footer, /<w:fldSimple w:instr=" NUMPAGES ">/);
  assert.match(part(r.docx, "word/_rels/document.xml.rels"), /Id="rId5" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/footer" Target="footer1\.xml"/);
  assert.match(part(r.docx, "[Content_Types].xml"), /PartName="\/word\/header2\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.header\+xml"/);
  assert.equal(r.stats.headerFooterFillIns, 1);
  assert.ok(r.notes.some((n) => /page header or footer has 1 fill-in space/.test(n)));
});

test("\\page and \\sect become page breaks (a continuous section break does not); later sections' headers are not used", () => {
  const r = convert(
    doc("One\\par\\page Two\\par Three\\page\\par\\sect\\sectd Four\\par\\sect\\sectd\\sbknone{\\header Later header\\par}Five\\par"),
  );
  const xml = body(r);
  assert.deepEqual(texts(xml), ["One", "Two", "Three", "", "Four", "Five"]);
  const paras = xml.split("<w:p>").slice(1);
  assert.match(paras[1], /^<w:pPr><w:pageBreakBefore\/>/, "Two starts a page");
  assert.match(paras[3], /^<w:pPr><w:pageBreakBefore\/>/, "the paragraph after \\page");
  assert.match(paras[4], /^<w:pPr><w:pageBreakBefore\/>/, "Four (after a page section break)");
  assert.doesNotMatch(paras[5], /pageBreakBefore/, "Five (continuous section break)");
  assert.doesNotMatch(xml, /headerReference/);
  assert.equal(r.stats.sections, 2);
  assert.ok(r.notes.some((n) => /3 sections were joined into one/.test(n)));
});

/* ------------------------------------------------------------------------------------------------
 * Malformed and hostile input
 * ----------------------------------------------------------------------------------------------*/

test("malformed input: not RTF, truncated, cut inside a group → clean errors; junk words and a stray \\' are tolerated", () => {
  assert.equal(rtfError(() => convert("hello")).code, "RTF_INVALID");
  assert.equal(rtfError(() => convert("{\\rtf1\\ansi Some text\\par")).code, "RTF_TRUNCATED");
  assert.equal(rtfError(() => convert(doc("{\\b unclosed").slice(0, -1))).code, "RTF_TRUNCATED");
  const truncated = rtfError(() => convert("{\\rtf1{\\fonttbl{\\f0 Arial;}}\\pard {\\b Name"));
  assert.match(truncated.message, /incomplete/);
  const ok = convert("{\\rtf1 \\zzzunknownword42 \\'zz text \\'4 x\\par}trailing junk } } {");
  assert.deepEqual(texts(body(ok)), ["zz text 4 x"]);
});

test("deep nesting is refused quickly (no stack overflow)", () => {
  const deep = `{\\rtf1 ${"{".repeat(100_000)}x${"}".repeat(100_000)}}`;
  const started = Date.now();
  const err = rtfError(() => convert(deep));
  assert.equal(err.code, "RTF_TOO_COMPLEX");
  assert.ok(Date.now() - started < 2000, "refused quickly");
  // Within the limit it is fine.
  assert.deepEqual(texts(body(convert(`{\\rtf1 ${"{".repeat(200)}deep${"}".repeat(200)}}`))), ["deep"]);
});

test("giant input: linear time, block and size limits, the upload limit for the converted file", () => {
  // 2.4 MB of plain text: converts, well inside the time budget.
  const words = "lorem ipsum dolor sit amet ".repeat(90_000);
  let started = Date.now();
  const big = convert(`{\\rtf1 ${words}\\par}`);
  assert.ok(Date.now() - started < 4000, `plain text took ${Date.now() - started} ms`);
  assert.equal(texts(body(big))[0].length, words.length);

  // 2.4 MB of empty paragraphs and of table cells: refused as too complex, quickly.
  started = Date.now();
  assert.equal(rtfError(() => convert(`{\\rtf1 ${"\\par ".repeat(480_000)}}`)).code, "RTF_TOO_COMPLEX");
  assert.equal(rtfError(() => convert(`{\\rtf1 \\trowd\\cellx100 ${"\\intbl x\\cell\\row ".repeat(140_000)}}`)).code, "RTF_TOO_COMPLEX");
  assert.ok(Date.now() - started < 4000, `refusals took ${Date.now() - started} ms`);

  // Lots of formatting groups on small text pieces: limited by pieces.
  assert.equal(rtfError(() => convert(`{\\rtf1 ${"{\\b x}{\\i y}".repeat(220_000)}}`, { maxInlines: 100_000 })).code, "RTF_TOO_COMPLEX");

  // A converted file over the upload limit.
  assert.equal(rtfError(() => convert(doc("Some text\\par".repeat(200)), { maxBytes: 4000 })).code, "RTF_TOO_LARGE");
});

/* ------------------------------------------------------------------------------------------------
 * Helpers used by the Studio
 * ----------------------------------------------------------------------------------------------*/

test("converted-form helpers: detection by name and type, the Word download name, the note prefix", () => {
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  assert.equal(isConvertedFromRtf({ fileName: "Report.RTF", mimeType: DOCX }), true);
  assert.equal(isConvertedFromRtf({ fileName: "Report.docx", mimeType: DOCX }), false);
  assert.equal(isConvertedFromRtf({ fileName: "Report.rtf", mimeType: "application/pdf" }), false);
  assert.equal(wordFileNameFor({ fileName: "Initial assessment.rtf", mimeType: DOCX }), "Initial assessment.docx");
  assert.equal(wordFileNameFor({ fileName: "Form.docx", mimeType: DOCX }), "Form.docx");
  assert.equal(wordFileNameFor({ fileName: "Form.pdf", mimeType: "application/pdf" }), "Form.pdf");
  assert.equal(RTF_NOTE_PREFIX, "Converted from RTF: ");
  assert.equal(isRtfConversionNote("This PDF has no fillable fields"), false);
});
