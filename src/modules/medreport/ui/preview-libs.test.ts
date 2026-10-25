/**
 * Fix round 1 (B0-30): the Word preview honours a table's negative indent (Proclaim's tblInd -680, which docx-preview
 * ignores) – read from document.xml in document order, nested tables included.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCX_PAGE_OVERFLOW_CSS, tableIndentsOf } from "./preview-libs";

test("table indents in document order: negative, positive, none, attribute order and nested tables", () => {
  const xml = [
    '<w:tbl><w:tblPr><w:tblW w:w="10800" w:type="dxa"/><w:tblInd w:w="-680" w:type="dxa"/></w:tblPr><w:tr><w:tc>',
    '<w:tbl><w:tblPr><w:tblInd w:type="dxa" w:w="108"/></w:tblPr></w:tbl>',
    "</w:tc></w:tr></w:tbl>",
    "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/></w:tblPr></w:tbl>",
    '<w:tbl><w:tblPr><w:tblInd w:w="-5" w:type="pct"/></w:tblPr></w:tbl>',
  ].join("");
  assert.deepEqual(tableIndentsOf(xml), [-680, 108, null, null], "a percentage indent is not a twips margin");
  // Fix round 2 (B1-22): with indents and anchored drawings placed as Word places them, the page is cut at its edge.
  assert.match(DOCX_PAGE_OVERFLOW_CSS, /overflow: hidden/);
});

test("fix round 2 (B1-22): drawings anchored to the page or its margins are placed by their frame; no automatic hyphenation", async () => {
  const { anchorPlacementsOf, docxPageCss, pageGeometryOf } = await import("./preview-libs");
  // TPN's page (A4 portrait, 1-inch margins) and its header logo: 4902200 EMU from the margin, at the top of the page.
  const page = pageGeometryOf('<w:body><w:sectPr><w:pgSz w:w="11900" w:h="16840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body>');
  assert.deepEqual(page, { width: 595, height: 842, left: 72, right: 72, top: 72, bottom: 72 });
  const logo = '<w:drawing><wp:anchor simplePos="0" behindDoc="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>4902200</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:align>top</wp:align></wp:positionV><wp:extent cx="1682750" cy="1289050"/><wp:wrapSquare wrapText="bothSides"/></wp:anchor></w:drawing>';
  const inline = '<w:drawing><wp:inline><wp:extent cx="12700" cy="12700"/></wp:inline></w:drawing>';
  const byParagraph = '<w:drawing><wp:anchor simplePos="0"><wp:positionH relativeFrom="column"><wp:posOffset>11430</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>668020</wp:posOffset></wp:positionV><wp:extent cx="7578090" cy="495300"/><wp:wrapNone/></wp:anchor></w:drawing>';
  // A text box as Word saves it: docx-preview draws the Fallback, so the Choice's drawing is not one of its drawings.
  const alternate = `<mc:AlternateContent><mc:Choice Requires="wps">${byParagraph}</mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent>`;
  const placed = anchorPlacementsOf(`<w:hdr><w:p><w:r>${logo}</w:r><w:r>${inline}</w:r><w:r>${alternate}</w:r><w:r>${byParagraph}</w:r></w:p></w:hdr>`, page!);
  assert.equal(placed.length, 3, "the logo, the inline picture and the paragraph-anchored box – not the Choice");
  assert.deepEqual(placed[0], { left: 458, top: 0, width: 132.5, height: 101.5 });
  assert.ok(placed[0]!.left + placed[0]!.width <= page!.width, "ends inside the page, as in Word");
  assert.equal(placed[1], null, "inline: in the text");
  assert.equal(placed[2], null, "anchored to a paragraph: in the text, cut at the page edge");
  const css = docxPageCss(".mr-preview");
  assert.match(css, /^\.mr-preview section\.docx \{ overflow: hidden !important; \}/);
  assert.match(css, /\.mr-preview \.docx, \.mr-preview \.docx \* \{ hyphens: manual !important;/);
});
