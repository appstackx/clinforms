/**
 * Decompression limits (forms/zip-guard.ts): zip bombs in .docx packages and oversized Flate streams
 * in PDFs are refused before any parser inflates them; ordinary files pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import PizZip from "pizzip";
import { HttpError } from "../api/http";
import { decodeFormFile } from "./file";
import { loadDocxDom } from "./docx-dom";
import { ZipLimitError, assertPdfWithinLimits, openZipSafely } from "./zip-guard";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function docxWithBody(text: string): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

/** Rewrite every declared uncompressed size of `name` (local header + central directory) to `size`. */
function lieAboutSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const buf = Buffer.from(bytes);
  const nameBuf = Buffer.from(name, "latin1");
  for (let i = 0; i < buf.length - 4; i++) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x04034b50) {
      const n = buf.readUInt16LE(i + 26);
      if (buf.subarray(i + 30, i + 30 + n).equals(nameBuf)) buf.writeUInt32LE(size, i + 22);
    } else if (sig === 0x02014b50) {
      const n = buf.readUInt16LE(i + 28);
      if (buf.subarray(i + 46, i + 46 + n).equals(nameBuf)) buf.writeUInt32LE(size, i + 24);
    }
  }
  return new Uint8Array(buf);
}

test("an ordinary .docx passes the guard and still opens", () => {
  const bytes = docxWithBody("Hello");
  assert.doesNotThrow(() => openZipSafely(bytes));
  assert.ok(loadDocxDom(bytes).body);
});

test("a .docx whose body inflates beyond the per-part limit is refused before it is read", () => {
  const bomb = docxWithBody("A".repeat(21 * 1024 * 1024));
  assert.ok(bomb.byteLength < 200 * 1024, "the bomb is small on disk");
  assert.throws(() => openZipSafely(bomb), ZipLimitError);
  assert.throws(
    () => loadDocxDom(bomb),
    (err: unknown) => err instanceof HttpError && err.status === 422 && err.init.code === "FORM_INVALID",
  );
  const b64 = Buffer.from(bomb).toString("base64");
  assert.throws(() => decodeFormFile(b64), (err: unknown) => err instanceof HttpError && err.init.code === "FORM_INVALID");
});

test("a part that inflates beyond the size its header declares is refused (lying header)", () => {
  const honest = docxWithBody("B".repeat(2 * 1024 * 1024));
  const lying = lieAboutSize(honest, "word/document.xml", 1000);
  assert.throws(() => openZipSafely(lying), ZipLimitError);
});

test("too many parts are refused", () => {
  const zip = new PizZip();
  for (let i = 0; i < 520; i++) zip.file(`word/media/x${i}.xml`, "<a/>");
  zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body/></w:document>`);
  assert.throws(() => openZipSafely(zip.generate({ type: "uint8array" })), ZipLimitError);
});

test("a PDF with a Flate stream that expands beyond the limit is refused; normal streams pass", () => {
  const small = deflateSync(Buffer.from("BT /F1 12 Tf (Hello) Tj ET"));
  const big = deflateSync(Buffer.alloc(45 * 1024 * 1024, 0x20));
  const pdf = (stream: Buffer) =>
    new Uint8Array(
      Buffer.concat([
        Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
      ]),
    );
  assert.doesNotThrow(() => assertPdfWithinLimits(pdf(small)));
  assert.throws(() => assertPdfWithinLimits(pdf(big)), ZipLimitError);
  assert.throws(
    () => decodeFormFile(Buffer.from(pdf(big)).toString("base64")),
    (err: unknown) => err instanceof HttpError && err.init.code === "FORM_INVALID",
  );
});
