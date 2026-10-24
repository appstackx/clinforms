/**
 * RTF templates up to 12 MB (10/2026): a clinic system's letter template stores its logos as hex text, so it may be
 * up to MAX_RTF_FILE_BYTES raw as long as everything EXCEPT picture / object / binary data stays within
 * MAX_FORM_FILE_BYTES (core/rtf/prescan.ts, one linear pass that mirrors exactly what the reader skips).
 *
 * - large-picture fixtures (built here: fictional forms with 3, 8 and 11.5 MB of picture data) convert in the
 *   browser path and the server path to the same bytes, quickly, with the picture noted as left out;
 * - refused: over 12 MB in all; over 2.5 MB of text and layout besides pictures; a non-RTF file over 2.5 MB;
 * - hostile files (a picture group that tries to end early with an invalid escape, \bin runs, unclosed and deeply
 *   nested picture groups, millions of control words or empty groups inside a picture, a million tiny pictures)
 *   finish quickly with bounded memory, and the existing memory-bomb checks still refuse what they refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MEDREPORT_AI_MODE = "demo";

import { HttpError } from "@/modules/medreport/api/http";
import { MAX_FORM_FILE_BYTES, MAX_RTF_FILE_BYTES } from "@/modules/medreport/config.public";
import { RtfConversionError, assertRtfWithinLimits, convertRtfToDocx, prescanRtf } from "@/modules/medreport/core/rtf";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { decodeFormFile, sha256Hex } from "@/modules/medreport/forms/file";
import { FormFileError, readFormFile } from "@/modules/medreport/ui/components/forms/analyse";

const MB = 1024 * 1024;
const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** A fictional one-page referrer form with `pictureMb` of logo data (hex, as Word writes it) and optional extras. */
function template(pictureMb: number, extra = ""): Uint8Array {
  const line = "89504e470d0a1a0a0000000d49484452".repeat(4) + "\r\n"; // 130 bytes per hex line
  const hex = line.repeat(Math.ceil((pictureMb * MB) / line.length));
  return enc(
    `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Arial;}}{\\*\\themedata 504b0304}\r\n` +
      `\\pard\\plain\\f0 {\\*\\shppict{\\pict{\\*\\picprop}\\pngblip\\picw100\\pich100 ${hex}}}{\\nonshppict{\\pict\\wmetafile8 0102}}\\par\r\n` +
      `\\pard Heathfield Medical Reporting (fictional) \\endash  Initial Assessment\\par\r\n` +
      `\\pard Claimant: <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>>\\par\r\n\\pard Date of Birth: <<P_DOB>>\\par\r\n` +
      `\\pard History: ____________________\\par ${extra}}`,
  );
}

function rtfError(fn: () => unknown): RtfConversionError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof RtfConversionError, String(err));
    return err;
  }
  assert.fail("expected an RtfConversionError");
}

test("pre-scan: picture, object, theme and binary data are payload; the rest is text – exactly what the reader skips", () => {
  const t = template(1);
  const scan = prescanRtf(t);
  assert.equal(scan.totalBytes, t.byteLength);
  assert.ok(scan.payloadBytes > MB && scan.textBytes < 2000, JSON.stringify(scan));
  assert.equal(scan.payloadBytes + scan.textBytes, scan.totalBytes);
  // \binN: N raw bytes are payload (braces inside them do not count).
  const bin = enc(`{\\rtf1 {\\pict\\bin6 }}{{{\\par}x}`);
  assert.equal(prescanRtf(bin).textBytes, bin.byteLength - prescanRtf(bin).payloadBytes);
  const outside = enc(`{\\rtf1 a\\bin5 {{{{{b}`);
  assert.equal(prescanRtf(outside).payloadBytes, 5, "a binary run outside a picture is skipped by the reader too");
  // A picture group that never closes counts to the end (the reader skips it and reports the file as incomplete).
  assert.equal(prescanRtf(enc(`{\\rtf1 x{\\pict abcdef`)).textBytes, `{\\rtf1 x{`.length, "payload starts at the control word");
  // Escaped braces and an invalid \' do not change the nesting – as in the reader.
  assert.equal(prescanRtf(enc(`{\\rtf1 {\\pict ab\\}cd}tail}`)).textBytes, `{\\rtf1 {tail}`.length);
  assert.equal(prescanRtf(enc(`{\\rtf1 {\\pict \\'}tail}`)).textBytes, `{\\rtf1 {tail}`.length, "\\' followed by a brace: the brace closes the picture");
  // Text is never counted as payload because of a word that merely starts like one ("\\pictures" is not \\pict).
  const word = enc(`{\\rtf1 {\\pictures x}{\\binder y}}`);
  assert.equal(prescanRtf(word).payloadBytes, 0);
});

test("large-picture templates (3, 8 and 11.5 MB) convert – browser and server give the same bytes – and the picture is noted", async () => {
  for (const size of [3, 8, 11.5]) {
    const rtf = template(size);
    assert.ok(rtf.byteLength > MAX_FORM_FILE_BYTES && rtf.byteLength <= MAX_RTF_FILE_BYTES, `${size} MB fixture`);
    const started = Date.now();
    const local = await readFormFile({ name: "Heathfield IA.rtf", bytes: rtf });
    const ms = Date.now() - started;
    assert.ok(ms < 3000, `${size} MB converted in ${ms} ms`);
    const server = decodeFormFile(b64(rtf), { convertRtf: true });
    assert.equal(local.sha256, server.sha256, "the same Word file in the browser and on the server");
    assert.equal(sha256Hex(local.bytes), local.sha256);
    assert.ok(local.bytes.byteLength < 50_000, "the converted Word file is small");
    assert.equal(local.convertedFrom?.sizeBytes, rtf.byteLength);
    assert.ok(local.convertedFrom?.notes.some((n) => /picture/.test(n)), "the logo is noted as left out");
    const texts = buildDocxOutline(local.bytes).blocks.map((b) => b.text);
    assert.ok(texts.includes("Claimant: <<P_TITLE>> <<P_FIRSTNAM>> <<P_SURNAME>>"));
  }
});

test("refused: over 12 MB in all, over 2.5 MB besides pictures, and any other file over 2.5 MB – with a plain message", async () => {
  const huge = template(12.2);
  assert.ok(huge.byteLength > MAX_RTF_FILE_BYTES);
  assert.equal(rtfError(() => assertRtfWithinLimits(huge)).code, "RTF_TOO_LARGE");
  await assert.rejects(readFormFile({ name: "Too big.rtf", bytes: huge }), (err: Error) => err instanceof FormFileError && /RTF templates can be up to 12 MB/.test(err.message));
  assert.throws(() => decodeFormFile(b64(huge), { convertRtf: true }), (err: HttpError) => err instanceof HttpError && err.status === 413);

  const wordy = template(1, `\\pard ${"Paragraph of template text that is not a picture. ".repeat(56_000)}\\par `);
  assert.ok(prescanRtf(wordy).textBytes > MAX_FORM_FILE_BYTES && wordy.byteLength < MAX_RTF_FILE_BYTES);
  const msg = rtfError(() => convertRtfToDocx(wordy, { maxBytes: MAX_FORM_FILE_BYTES })).message;
  assert.match(msg, /holds 2\.\d MB of text and layout besides its pictures; the limit is 2\.5 MB/);
  await assert.rejects(readFormFile({ name: "Wordy.rtf", bytes: wordy }), FormFileError);
  assert.throws(() => decodeFormFile(b64(wordy), { convertRtf: true }), (err: HttpError) => err instanceof HttpError && err.status === 413);

  // Not RTF: 2.5 MB as before, also through the RTF-converting paths.
  const pdf = new Uint8Array(3 * MB);
  pdf.set(enc("%PDF-1.4\n"));
  assert.throws(() => decodeFormFile(b64(pdf), { convertRtf: true }), (err: HttpError) => err instanceof HttpError && err.status === 413);
  await assert.rejects(readFormFile({ name: "big.pdf", bytes: pdf }), (err: Error) => err instanceof FormFileError && /the limit is 2\.5 MB/.test(err.message));
  // Without convertRtf (the clinic store, every Word / PDF path) an RTF is refused exactly as before, whatever its size.
  assert.throws(() => decodeFormFile(b64(template(3)), {}), (err: HttpError) => err instanceof HttpError && err.status === 413);
  assert.throws(() => decodeFormFile(b64(enc("{\\rtf1 small}")), {}), (err: HttpError) => err instanceof HttpError && err.status === 422);
});

test("hostile files finish quickly with bounded memory (inside and around picture groups)", () => {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = Date.now();
  const doc = (inner: string, close = "}") => enc(`{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard Name: ____\\par ${inner}${close}`);
  // An early end through an invalid escape is seen: the text after it is text, and over the limit.
  assert.equal(rtfError(() => assertRtfWithinLimits(doc(`{\\pict \\'} ${"text ".repeat((3 * MB) / 5)}}`))).code, "RTF_TOO_LARGE");
  // \bin runs that would jump over braces, unclosed and deeply nested pictures.
  assert.equal(rtfError(() => convertRtfToDocx(doc(`{\\pict\\bin999999999 ${"ab".repeat(MB)}}`, ""), { maxBytes: MAX_FORM_FILE_BYTES })).code, "RTF_TRUNCATED");
  assert.equal(rtfError(() => convertRtfToDocx(doc(`{\\pict ${"ab".repeat(4 * MB)}`, ""), { maxBytes: MAX_FORM_FILE_BYTES })).code, "RTF_TRUNCATED");
  assert.equal(rtfError(() => convertRtfToDocx(doc(`{\\pict ${"{".repeat(11 * MB)}`), { maxBytes: MAX_FORM_FILE_BYTES })).code, "RTF_TOO_COMPLEX");
  // Millions of control words, empty groups or tiny pictures: linear, nothing kept.
  for (const inner of [`{\\pict ${"\\x".repeat((11.5 * MB) / 2)}}`, `{\\pict ${"{}".repeat((11.5 * MB) / 2)}}`, "{\\pict ab}".repeat(1_100_000)]) {
    const t = Date.now();
    const r = convertRtfToDocx(doc(inner), { maxBytes: MAX_FORM_FILE_BYTES });
    assert.ok(r.docx.byteLength < 20_000);
    assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
  }
  assert.ok(Date.now() - started < 10_000, `all took ${Date.now() - started} ms`);
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 400 * MB, "memory stays bounded");
});
