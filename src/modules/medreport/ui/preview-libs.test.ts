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
  assert.match(DOCX_PAGE_OVERFLOW_CSS, /overflow: visible/);
});
