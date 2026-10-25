/**
 * Fix round 3 (B2-31): CLM's Discharge prints its labels line by line in the cell beside the address – "Address:", four
 * empty lines, then "Postcode:". Address lines the record does not have stay as empty lines there, so the postcode stays
 * beside "Postcode:" (fix round 1, B0-32, removed them and the postcode moved up into the address). Elsewhere an emptied
 * line still goes. A small FICTIONAL document that mimics the converted CLM template.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormDefinition, FormField } from "../core/types";
import { fillDocx } from "./docx-fill";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function docx(body: string): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (...lines: string[]) => `<w:tc>${lines.map(p).join("")}</w:tc>`;
const CODES = ["<<P_ADDRESS1>>", "<<P_ADDRESS2>>", "<<P_ADDRESS3>>", "<<P_ADDRESS4>>", "<<P_ADDRESS5>>", "<<P_POSTCODE>>"];

function formOf(rowLabels: string[]): { bytes: Uint8Array; form: FormDefinition } {
  const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bytes = docx(`<w:tbl><w:tr>${cell(...rowLabels)}${cell(...CODES.map(esc))}</w:tr></w:tbl>`);
  const fields: FormField[] = CODES.map((code, i) => ({
    id: `F-${String(i + 5).padStart(2, "0")}`,
    label: i < 5 ? `Address: Postcode – line ${i + 1} of 5` : "Patient's postcode",
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "docx", target: "replace_placeholder", blockId: `t0.r0.c1.p${i}`, placeholderText: code },
    fillSource: { kind: "registration", path: i < 5 ? "patient.addressLines" : "patient.postcode", ...(i < 5 ? { part: { index: i + 1, of: 5 } } : {}) } as FormField["fillSource"],
    required: true,
    confidence: "high",
  }));
  return {
    bytes,
    form: {
      id: "frm_postcode",
      tenantId: "demo",
      referrer: { name: "CLM (fictional)", type: "mlc" },
      title: "Discharge Report (fictional)",
      file: { fileName: "clm.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "0".repeat(64), sizeBytes: 1 },
      kind: "docx",
      fields,
      status: "confirmed",
      analysis: { mode: "rules", promptVersion: "test", at: "2026-10-25T09:00:00.000Z", warnings: [] },
      createdAt: "2026-10-25T09:00:00.000Z",
      updatedAt: "2026-10-25T09:00:00.000Z",
    },
  };
}

/** Each cell's lines, as text. */
function cells(bytes: Uint8Array): string[][] {
  const xml = new PizZip(bytes).file("word/document.xml")!.asText();
  // (An emptied paragraph may be written as <w:p/>.)
  return Array.from(xml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)).map((c) => Array.from(c[1].matchAll(/<w:p\/>|<w:p\b[^>]*[^/]>[\s\S]*?<\/w:p>|<w:p>[\s\S]*?<\/w:p>/g)).map((x) => Array.from(x[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)).map((t) => t[1]).join("")));
}

const ANSWERS = {
  "F-05": { text: "3 Millstream Court (fictional)" },
  "F-06": { text: "Aylesbury" },
  "F-07": { text: "", blank: true },
  "F-08": { text: "", blank: true },
  "F-09": { text: "", blank: true },
  "F-10": { text: "ZZ2 6HP" },
};

test("B2-31: beside a label column printed line by line, the empty address lines stay – the postcode stays beside “Postcode:”", () => {
  const labels = ["Address:", "", "", "", "", "Postcode:", ""];
  const { bytes, form } = formOf(labels);
  const out = cells(fillDocx(bytes, form, ANSWERS, { draft: false }));
  assert.deepEqual(out[1], ["3 Millstream Court (fictional)", "Aylesbury", "", "", "", "ZZ2 6HP"], "it printed “ZZ2 6HP” as the third address line");
  assert.equal(out[0].indexOf("Postcode:"), out[1].indexOf("ZZ2 6HP"));
});

test("B2-31: with a one-line label beside them, the emptied address lines still go (fix round 1, B0-32)", () => {
  const { bytes, form } = formOf(["Address:"]);
  const out = cells(fillDocx(bytes, form, ANSWERS, { draft: false }));
  assert.deepEqual(out[1], ["3 Millstream Court (fictional)", "Aylesbury", "ZZ2 6HP"]);
});
