/**
 * Printed notes (PDF) upload: the fictional Priya Nair notes printed to PDF read back as the same
 * notes, authors and SOAP fields as the pasted-notes sample; scans and non-PDFs are refused clearly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFileImportConnector } from "@/modules/medreport/connectors/file-import/connector";
import { ImportError, parseImport } from "@/modules/medreport/connectors/file-import/parser";
import { printedNotesToText } from "@/modules/medreport/connectors/file-import/pdf-notes";
import { SAMPLE_IMPORT_FILES } from "@/modules/medreport/connectors/file-import/samples";
import { PRIYA_NAIR_NOTES_PDF_BASE64 } from "@/modules/medreport/connectors/file-import/samples/generated/priya-nair-notes.pdf.b64";
import type { ConnectorContext } from "@/modules/medreport/connectors/types";

const ctx = (): ConnectorContext => ({ tenantId: "demo", credentials: { kind: "none" }, baseUrl: "", fetch: (u, i) => fetch(u, i), trace: [] });

test("the printed notes PDF reads back as the same notes as the pasted-notes sample", async () => {
  const { text, pages } = await printedNotesToText(PRIYA_NAIR_NOTES_PDF_BASE64);
  assert.equal(pages, 2);
  const fromPdf = parseImport({ format: "text", content: text }, { tenantId: "demo", now: new Date("2026-10-06T09:00:00Z") });
  const fromText = parseImport({ format: "text", content: SAMPLE_IMPORT_FILES.text.content }, { tenantId: "demo", now: new Date("2026-10-06T09:00:00Z") });
  assert.ok(fromPdf.ok && fromText.ok);
  if (!fromPdf.ok || !fromText.ok) return;
  assert.equal(fromPdf.bundle.notes.length, fromText.bundle.notes.length);
  const strip = (s: string | undefined) => (s ?? "").replace(/->/g, "→").replace(/\s+/g, " ").trim();
  fromPdf.bundle.notes.forEach((n, i) => {
    const t = fromText.bundle.notes[i];
    assert.equal(n.date, t.date);
    assert.equal(n.author.name, t.author.name);
    assert.equal(n.type, t.type);
    assert.equal(strip(n.subjective), strip(t.subjective));
    assert.equal(strip(n.plan), strip(t.plan));
  });
  assert.equal(fromPdf.bundle.registration.dob, fromText.bundle.registration.dob);
  assert.deepEqual(fromPdf.warnings.filter((w) => /not a recognised/.test(w.message)), [], "title lines are not reported as junk");
});

test("the file-import connector accepts format pdf and records it in the trace", async () => {
  const c = ctx();
  const bundle = await createFileImportConnector().getEpisodeBundle(c, { upload: { format: "pdf", content: PRIYA_NAIR_NOTES_PDF_BASE64, fileName: "notes.pdf" } });
  assert.ok(bundle.notes.length >= 3);
  assert.equal(c.trace[0].url, "file-import/pdf");
  assert.match(c.trace[0].note ?? "", /printed notes PDF, 2 pages/);
});

test("a PDF without text, or a file that is not a PDF, is refused in plain English", async () => {
  await assert.rejects(printedNotesToText(Buffer.from("hello").toString("base64")), (e: unknown) => e instanceof ImportError && /not a PDF/.test(e.issues[0].message));
  const { PDFDocument } = await import("pdf-lib");
  const blank = await PDFDocument.create();
  blank.addPage();
  const b64 = Buffer.from(await blank.save()).toString("base64");
  await assert.rejects(printedNotesToText(b64), (e: unknown) => e instanceof ImportError && /no readable text/.test(e.issues[0].message));
});
