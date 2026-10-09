import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { RIVERSIDE_SOLICITOR_V1_DOCX_BASE64 } from "../templates/generated/riverside-solicitor-v1.docx.b64";
import { HttpError } from "../api/http";
import { docxToPdf, pdfConversionAvailable } from "./convert";
import { DOCX_MIME, PDF_MIME, assertFormFileMatches, decodeFormFile, sha256Hex, sniffFormFile } from "./file";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";

const docxBytes = new Uint8Array(Buffer.from(RIVERSIDE_SOLICITOR_V1_DOCX_BASE64, "base64"));

async function tinyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

function httpError(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof HttpError);
    return err;
  }
  assert.fail("expected an HttpError");
}

test("sniffFormFile detects Word and PDF from the bytes, and old .doc files", async () => {
  assert.equal(sniffFormFile(docxBytes), DOCX_MIME);
  assert.equal(sniffFormFile(await tinyPdf()), PDF_MIME);
  assert.equal(sniffFormFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), "doc");
  assert.equal(sniffFormFile(new TextEncoder().encode("hello")), null);
});

test("decodeFormFile returns type, size and SHA-256; rejects junk, .doc and oversize files", async () => {
  const decoded = decodeFormFile(Buffer.from(docxBytes).toString("base64"));
  assert.equal(decoded.mimeType, DOCX_MIME);
  assert.equal(decoded.sizeBytes, docxBytes.byteLength);
  assert.equal(decoded.sha256, sha256Hex(docxBytes));
  assert.equal(httpError(() => decodeFormFile(Buffer.from("not a form").toString("base64"))).init.code, "FORM_INVALID");
  assert.equal(
    httpError(() => decodeFormFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]).toString("base64"))).init.code,
    "FORM_INVALID",
  );
  assert.equal(httpError(() => decodeFormFile(Buffer.from(docxBytes).toString("base64"), { maxBytes: 1000 })).status, 413);
  assert.equal(httpError(() => assertFormFileMatches(decoded, "0".repeat(64))).init.code, "FORM_MISMATCH");
});

test("pdfjs legacy build extracts text in Node (fake worker, no canvas needed)", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  page.drawText("Section C - Prognosis", { x: 20, y: 150, size: 12 });
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(await doc.save()));
  const pdf = await task.promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
  await task.destroy();
  assert.equal(text, "Section C - Prognosis");
});

test("docxToPdf converts with LibreOffice where installed", { skip: !pdfConversionAvailable() && "LibreOffice not installed" }, async () => {
  const pdf = await docxToPdf(docxBytes);
  assert.ok(pdf);
  assert.equal(sniffFormFile(pdf), PDF_MIME);
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
});
