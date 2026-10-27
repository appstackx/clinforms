/**
 * bh2 fix round 1 – R1T-WA2-L1 (R1-CLM-09): an address line the record does not have keeps its (empty) line when the
 * cell beside it prints a label on a later line – "Postcode:" on the sixth line beside address lines 1–5 and the
 * postcode – so the postcode stays beside its label. Where nothing beside prints on a later line (a one-line label), the
 * empty line is still left off (fix round 1, B0-32). Fictional Word files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import type { FormFillAnswers } from "../core/forms";
import type { FormDefinition, FormField } from "../core/types";
import { buildDocxOutline } from "./docx-outline";
import { fillDocxReport } from "./docx-fill";
import { DOCX_MIME, sha256Hex } from "./file";

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

const p = (text = "") => `<w:p>${text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ""}</w:p>`;
const tc = (...lines: string[]) => `<w:tc>${lines.map((l) => p(l)).join("")}</w:tc>`;
const CODES = ["<<P_ADDRESS1>>", "<<P_ADDRESS2>>", "<<P_ADDRESS3>>", "<<P_ADDRESS4>>", "<<P_ADDRESS5>>", "<<P_POSTCODE>>"];
const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

function field(id: string, line: number, code: string, part?: { index: number; of: number }): FormField {
  return {
    id,
    label: `Address ${id}`,
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "docx", target: "replace_placeholder", blockId: `t0.r0.c1.p${line}`, placeholderText: code },
    fillSource: part ? { kind: "registration", path: "patient.addressLines", part } : { kind: "registration", path: "patient.postcode" },
    required: false,
    confidence: "high",
  };
}

function formOf(bytes: Uint8Array, fields: FormField[]): FormDefinition {
  return {
    id: "frm_address",
    tenantId: "demo",
    referrer: { name: "Ashby Claims Review (fictional)", type: "mlc" },
    title: "Address (fictional)",
    file: { fileName: "address.docx", mimeType: DOCX_MIME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-27T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-27T09:00:00.000Z",
    updatedAt: "2026-10-27T09:00:00.000Z",
  };
}

const FIELDS = [...[1, 2, 3, 4, 5].map((i) => field(`F-0${i}`, i - 1, CODES[i - 1], { index: i, of: 5 })), field("F-06", 5, CODES[5])];
/** Two address lines and a postcode: lines 3–5 are empty on purpose (core/forms: blank). */
const ANSWERS: FormFillAnswers = {
  "F-01": { text: "1 Test Street (fictional)" },
  "F-02": { text: "Testtown" },
  "F-03": { text: "", blank: true },
  "F-04": { text: "", blank: true },
  "F-05": { text: "", blank: true },
  "F-06": { text: "ZZ1 1ZZ" },
};

/** Each line of the value cell (t0.r0.c1), "" for an empty one (a cell of one line has no per-line blocks). */
function valueLines(out: Uint8Array): string[] {
  const blocks = buildDocxOutline(out).blocks;
  const lines = blocks.filter((b) => /^t0\.r0\.c1\.p\d+$/.test(b.id)).map((b) => b.text.trim());
  return lines.length > 0 ? lines : blocks.filter((b) => b.id === "t0.r0.c1").map((b) => b.text.trim());
}

test("R1T-WA2-L1: beside 'Address:' … 'Postcode:' (label on line 6) the empty address lines stay, so the postcode keeps its line", () => {
  const bytes = docx(`<w:tbl><w:tr>${tc("Address:", "", "", "", "", "Postcode:")}${tc(...CODES.map(esc))}</w:tr></w:tbl>`);
  const out = fillDocxReport(bytes, formOf(bytes, FIELDS), ANSWERS, { draft: false });
  assert.deepEqual(valueLines(out.bytes), ["1 Test Street (fictional)", "Testtown", "", "", "", "ZZ1 1ZZ"], "the postcode is on line 6, beside 'Postcode:'");
  for (const id of ["F-03", "F-04", "F-05"]) assert.equal(out.outcomes.find((o) => o.fieldId === id)?.outcome, "cleared", id);
  assert.equal(out.outcomes.some((o) => o.fatal), false);
});

test("B0-32 kept: beside a one-line label the empty address lines are still left off", () => {
  const bytes = docx(`<w:tbl><w:tr>${tc("Location of treatment")}${tc(...CODES.map(esc))}</w:tr></w:tbl>`);
  const out = fillDocxReport(bytes, formOf(bytes, FIELDS), ANSWERS, { draft: false });
  assert.deepEqual(valueLines(out.bytes), ["1 Test Street (fictional)", "Testtown", "ZZ1 1ZZ"]);
});

test("an empty last line (nothing after it to keep in line) is still left off, whatever is printed beside it", () => {
  const bytes = docx(`<w:tbl><w:tr>${tc("Address:", "", "", "Phone:")}${tc(esc(CODES[0]), esc(CODES[1]), esc(CODES[2]))}</w:tr></w:tbl>`);
  const fields = [1, 2, 3].map((i) => field(`F-0${i}`, i - 1, CODES[i - 1], { index: i, of: 3 }));
  const out = fillDocxReport(bytes, formOf(bytes, fields), { "F-01": { text: "1 Test Street (fictional)" }, "F-02": { text: "", blank: true }, "F-03": { text: "", blank: true } }, { draft: false });
  assert.deepEqual(valueLines(out.bytes), ["1 Test Street (fictional)"]);
});
