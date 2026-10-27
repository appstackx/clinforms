/**
 * bh2 WF – the Studio's Word preview (ui/preview-libs.ts): the fix-round-3 work kept (B2-27 anchored drawings placed once
 * the review's host is shown, B2-28 page-number fields, page counts and tab stops) and the leftovers fixed (B3-22):
 * page-number fields kept as simple fields in a paragraph, single line spacing as Word sets it, and headers and footers
 * drawn behind the page's text. Synthetic XML in ClinForms' own words – never a referrer's form. The pure parts are
 * tested here; the drawing itself was checked in a browser on the 17 forms (bh2 WF report). Downloads are unaffected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NUMPAGES_TOKEN,
  PAGE_TOKEN,
  anchorPlacementsOf,
  applySimplePageFields,
  applyWordSingleSpacing,
  continuousSheetNote,
  docxPageCss,
  fillPageTokens,
  nextTabStop,
  pageFieldToken,
  pageGeometryOf,
  pagesOfAppXml,
  placeDocxDrawings,
  simplePageFieldsOf,
  wordLineHeight,
} from "./preview-libs";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const run = (text: string) => `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const simple = (instr: string, result: string) => `<w:fldSimple w:instr="${instr}"><w:r><w:t>${result}</w:t></w:r></w:fldSimple>`;
/** A footer as the RTF conversion writes it: "Page N of M" with both numbers as simple fields in the paragraph. */
const FOOTER = `<w:ftr ${W}><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run("Page ")}${simple(" PAGE ", "2")}${run(" of ")}${simple(" NUMPAGES ", "3")}</w:p></w:ftr>`;

interface Node {
  type: string;
  text?: string;
  cssStyle?: Record<string, string>;
  className?: string;
  children?: Node[];
}
const t = (text: string): Node => ({ type: "text", text });
const r = (text: string, css: Record<string, string> = {}): Node => ({ type: "run", cssStyle: css, children: [t(text)] });
const p = (...children: Node[]): Node => ({ type: "paragraph", children });
function drawn(node: Node): string {
  if (node.type === "text") return node.text ?? "";
  return (node.children ?? []).map(drawn).join("");
}

test("B3-22: a paragraph's simple page-number fields are found where docx-preview drops them, with the count Word saved", () => {
  const scan = simplePageFieldsOf(FOOTER);
  assert.deepEqual(scan.texts, ["Page  of "], "the text as docx-preview draws it: both fields and their results gone");
  assert.deepEqual(scan.fields, [
    { index: 0, at: 5, token: PAGE_TOKEN },
    { index: 0, at: 9, token: NUMPAGES_TOKEN },
  ]);
  assert.equal(scan.savedPages, 3, "the NUMPAGES result the file was saved with");
  // A simple field inside a run is kept by docx-preview (markPageFields draws it); another field is dropped, no token.
  const other = simplePageFieldsOf(`<w:hdr ${W}><w:p>${run("Printed ")}<w:fldSimple w:instr=" DATE \\@ dd/MM/yyyy "><w:r><w:t>01/01/2026</w:t></w:r></w:fldSimple></w:p><w:p><w:r><w:fldSimple w:instr="PAGE"/></w:r></w:p></w:hdr>`);
  assert.deepEqual(other.texts, ["Printed ", ""]);
  assert.deepEqual(other.fields, []);
  assert.equal(other.savedPages, null);
});

test("B3-22: paragraphs are read as docx-preview reads them – entities, a text box's own paragraph, alternative content", () => {
  const xml = [
    `<w:ftr ${W} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">`,
    `<w:p>${run("A &amp; B &#8211; ")}${simple("PAGE", "1")}</w:p>`,
    `<w:p><w:r><w:pict><v:textbox><w:txbxContent><w:p>${run("In a box")}</w:p></w:txbxContent></v:textbox></w:pict></w:r>${run("Outside")}</w:p>`,
    `<w:p><mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:t>One</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>Two</w:t></w:r></mc:Fallback></mc:AlternateContent>${simple("PAGE", "1")}</w:p>`,
    `<w:p/>`,
    `</w:ftr>`,
  ].join("");
  const scan = simplePageFieldsOf(xml);
  assert.deepEqual(scan.texts, ["A & B – ", "Outside", "In a box", null, ""], "a nested paragraph is its own; alternative content: unknown");
  assert.deepEqual(scan.fields, [{ index: 0, at: 8, token: PAGE_TOKEN }], "no field where the paragraph's text is unknown");
});

test("B3-22: the tokens go where the fields stood, in the neighbouring run's type size, and are filled per page", () => {
  const footer: Node = { type: "footer", children: [p(r("Page ", { "font-size": "8pt" }), r(" of ", { "font-size": "8pt" }))] };
  const out = applySimplePageFields(footer as never, FOOTER);
  assert.deepEqual(out, { inserted: 2, savedPages: 3 });
  const para = footer.children![0];
  assert.equal(drawn(para), `Page ${PAGE_TOKEN} of ${NUMPAGES_TOKEN}`);
  assert.deepEqual(para.children!.map((c) => c.cssStyle?.["font-size"]), ["8pt", "8pt", "8pt", "8pt"], "drawn like the words around it");
  assert.equal(fillPageTokens(drawn(para), 1, 3), "Page 1 of 3");
  // Run again on the same tree: the texts no longer match, so nothing is added twice.
  assert.deepEqual(applySimplePageFields(footer as never, FOOTER), { inserted: 0, savedPages: 3 });
});

test("B3-22: a paragraph is matched by its text and its place among the part's paragraphs with that text – never guessed", () => {
  // Two paragraphs drawn "Page  of " in what docx-preview parsed, one in the XML: the counts differ, nothing changes.
  const footer: Node = { type: "footer", children: [p(r("Page "), r(" of ")), p(r("Page "), r(" of "))] };
  assert.equal(applySimplePageFields(footer as never, FOOTER).inserted, 0);
  assert.equal(drawn(footer), "Page  of Page  of ");
  // The second of two equal lines holds the fields: only that one gets the tokens.
  const twoXml = `<w:ftr ${W}><w:p>${run("Ref ")}</w:p><w:p>${run("Ref ")}${simple("PAGE", "1")}</w:p></w:ftr>`;
  const two: Node = { type: "footer", children: [p(r("Ref ")), p(r("Ref "))] };
  assert.equal(applySimplePageFields(two as never, twoXml).inserted, 1);
  assert.deepEqual(two.children!.map(drawn), ["Ref ", `Ref ${PAGE_TOKEN}`]);
  // A field inside a hyperlink: the token goes inside it, between its runs.
  const linkXml = `<w:ftr ${W}><w:p><w:hyperlink w:anchor="top">${run("p. ")}${simple("PAGE", "4")}${run(" end")}</w:hyperlink></w:p></w:ftr>`;
  const link: Node = { type: "footer", children: [p({ type: "hyperlink", children: [r("p. "), r(" end")] })] };
  assert.equal(applySimplePageFields(link as never, linkXml).inserted, 1);
  assert.equal(drawn(link), `p. ${PAGE_TOKEN} end`);
  assert.equal(link.children![0].children![0].children!.length, 3, "inside the hyperlink");
});

test("B3-22: single line spacing is the font's own line height (as Word sets it); other spacing is left as drawn", () => {
  assert.equal(wordLineHeight("1.00"), "normal");
  assert.equal(wordLineHeight("1.15"), "1.15");
  assert.equal(wordLineHeight("calc(100% + 2pt)"), "calc(100% + 2pt)");
  const body: Node = { type: "body", children: [{ ...p(r("Single")), cssStyle: { "line-height": "1.00" } }, { ...p(r("Wider")), cssStyle: { "line-height": "1.50" } }] };
  const defaults = { values: { "margin-bottom": "0.00pt", "line-height": "1.00" } };
  const doc = { stylesPart: { styles: [{ styles: [defaults] }] }, documentPart: { body: body as never }, parts: [] };
  applyWordSingleSpacing(doc);
  assert.equal(defaults.values["line-height"], "normal", "the document defaults (docx-preview's .docx p rule)");
  assert.deepEqual(body.children!.map((c) => c.cssStyle?.["line-height"]), ["normal", "1.50"]);
});

test("B3-22: headers and footers are drawn behind the page's text, as Word draws them; the page is still cut at its edge", () => {
  const css = docxPageCss(".medreport-docx-host");
  assert.match(css, /\.medreport-docx-host section\.docx > header, \.medreport-docx-host section\.docx > footer \{ z-index: 0 !important; \}/);
  assert.match(css, /\.medreport-docx-host section\.docx \{ overflow: hidden !important; \}/, "B1-22 kept");
  assert.match(css, /hyphens: manual !important/, "B1-22 kept");
});

test("kept from fix round 3 (B2-27): TPN-like first-page banner placed inside the page; a host drawn off the page waits", () => {
  const page = pageGeometryOf('<w:sectPr><w:pgSz w:w="11900" w:h="16840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/><w:titlePg/></w:sectPr>')!;
  const banner = '<w:hdr><w:p><w:r><w:drawing><wp:anchor simplePos="0"><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:align>top</wp:align></wp:positionV><wp:extent cx="6413500" cy="1524000"/></wp:anchor></w:drawing></w:r></w:p></w:hdr>';
  const [at] = anchorPlacementsOf(banner, page);
  assert.deepEqual(at, { left: 45, top: 0, width: 505, height: 120 });
  assert.ok(at!.left >= 0 && at!.left + at!.width <= page.width, "inside the page");
  assert.doesNotThrow(() => placeDocxDrawings({ isConnected: false } as unknown as HTMLElement), "nothing pending: a no-op");
  assert.doesNotThrow(() => placeDocxDrawings({ isConnected: true } as unknown as HTMLElement), "nothing pending: a no-op");
});

test("kept from fix round 3 (B2-28): page-number fields, the page count Word saved, a continuous sheet, tab stops", () => {
  assert.equal(pageFieldToken(" PAGE "), PAGE_TOKEN);
  assert.equal(pageFieldToken("NUMPAGES  \\* Arabic"), NUMPAGES_TOKEN);
  assert.equal(pageFieldToken("SECTIONPAGES"), NUMPAGES_TOKEN);
  assert.equal(pageFieldToken(" DATE \\@ dd/MM/yyyy"), null);
  assert.equal(pagesOfAppXml("<Properties><Pages>4</Pages></Properties>"), 4);
  assert.equal(pagesOfAppXml("<Properties/>"), null);
  assert.equal(continuousSheetNote(4), "Shown as one continuous sheet – Word prints this form on 4 pages.");
  assert.equal(continuousSheetNote(null), "Shown as one continuous sheet – Word splits this form into pages when it prints it.");
  assert.equal(continuousSheetNote(1), continuousSheetNote(null), "never 'on 1 pages'");
  // A schedule: "05." at the left, a custom tab at 216 pt for the second column. Word clears the default stops left of a
  // custom tab, so the second column lines up, never at the first default stop (36 pt).
  const stops = [{ pos: 216, style: "left" }];
  assert.equal(nextTabStop(20, stops, 36), 216);
  assert.equal(nextTabStop(150, stops, 36), 216);
  assert.equal(nextTabStop(230, stops, 36), 252, "past the last custom stop: the next default one");
  assert.equal(nextTabStop(10, [], 36), 36, "no custom stops: the defaults");
  assert.equal(nextTabStop(10, [{ pos: 100, style: "clear" }], 36), 36, "a cleared stop is no stop");
});
