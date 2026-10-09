/**
 * LibreOffice hardening (forms/convert.ts): no secrets in the converter's environment, and a timed-out
 * conversion leaves no LibreOffice process behind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import PizZip from "pizzip";
import { converterEnv, docxToPdf, pdfConversionAvailable } from "./convert";

test("the converter's environment carries no secrets from process.env", () => {
  const before = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "sk-test-should-not-leak";
  process.env.MEDREPORT_SIGNING_SECRET = "signing-should-not-leak";
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-should-not-leak";
  try {
    const env = converterEnv("/tmp/x");
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "TMPDIR"]);
    assert.equal(env.HOME, "/tmp/x");
    assert.ok(!JSON.stringify(env).includes("should-not-leak"));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
  }
});

/** Live (non-zombie) soffice.bin processes. */
function sofficeCount(): number {
  const out = execFileSync("ps", ["-eo", "stat=,args="], { encoding: "utf8" });
  return out.split("\n").filter((l) => /soffice\.bin/.test(l) && !/^\s*Z/.test(l)).length;
}

test("a conversion that times out kills LibreOffice's whole process group", { skip: !pdfConversionAvailable() && "LibreOffice not installed" }, async () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Timeout</w:t></w:r></w:p></w:body></w:document>');
  const before = sofficeCount();
  await assert.rejects(docxToPdf(zip.generate({ type: "uint8array" }), { timeoutMs: 300 }), /timeout/);
  let after = sofficeCount();
  for (let i = 0; i < 20 && after > before; i++) {
    await new Promise((r) => setTimeout(r, 100));
    after = sofficeCount();
  }
  assert.ok(after <= before, "no soffice.bin left running");
});
