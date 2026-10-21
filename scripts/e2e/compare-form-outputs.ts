/**
 * Compare the completed forms two e2e runs downloaded (scripts/e2e/forms-regression.cjs), e.g. a build of
 * main and a branch: same file names in both final-outputs folders.
 *   Word: every part of the package byte for byte (ZIP dates and compression aside), and the outline
 *         (every paragraph and table cell's text by block ID).
 *   PDF:  page count and sizes, and every page's text (pdf.js), in order.
 * Prints IDENTICAL / EQUIVALENT / DIFFERENT per file and exits 1 on any difference.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/e2e/compare-form-outputs.ts <dirA> <dirB>
 */
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { loadPdfjs, pdfjsDocumentParams } from "@/modules/medreport/forms/pdfjs";

async function pdfFacts(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pdf = await task.promise;
  const pages: Array<{ size: string; text: string }> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ size: `${Math.round(vp.width)}x${Math.round(vp.height)}`, text: content.items.map((it) => ("str" in it ? it.str : "")).join("|") });
  }
  await task.destroy();
  return pages;
}

function docxFacts(bytes: Uint8Array) {
  const zip = new PizZip(bytes);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files).sort()) if (!zip.files[name].dir) parts[name] = zip.file(name)!.asText();
  return { parts, outline: buildDocxOutline(bytes).blocks.map((b) => `${b.id}\t${b.text}`) };
}

(async () => {
  const [a, b] = process.argv.slice(2);
  const files = fs.readdirSync(a).filter((n) => /\.(docx|pdf)$/.test(n)).sort();
  let bad = 0;
  for (const name of files) {
    const fa = path.join(a, name);
    const fb = path.join(b, name);
    if (!fs.existsSync(fb)) {
      console.log(`MISSING   ${name} (only in ${a})`);
      bad++;
      continue;
    }
    const ba = new Uint8Array(fs.readFileSync(fa));
    const bb = new Uint8Array(fs.readFileSync(fb));
    if (Buffer.compare(Buffer.from(ba), Buffer.from(bb)) === 0) {
      console.log(`IDENTICAL ${name} (${ba.byteLength} bytes)`);
      continue;
    }
    if (name.endsWith(".docx")) {
      const xa = docxFacts(ba);
      const xb = docxFacts(bb);
      const names = Array.from(new Set([...Object.keys(xa.parts), ...Object.keys(xb.parts)])).sort();
      const diff = names.filter((n) => xa.parts[n] !== xb.parts[n]);
      const outlineSame = JSON.stringify(xa.outline) === JSON.stringify(xb.outline);
      if (diff.length === 0 && outlineSame) console.log(`EQUIVALENT ${name}: all ${names.length} parts identical (only ZIP container bytes differ); ${xa.outline.length} blocks identical`);
      else {
        bad++;
        console.log(`DIFFERENT ${name}: parts ${diff.join(", ") || "-"}; outline ${outlineSame ? "same" : "differs"}`);
        xa.outline.forEach((l, i) => {
          if (l !== xb.outline[i]) console.log(`   - ${l.slice(0, 160)}\n   + ${(xb.outline[i] ?? "").slice(0, 160)}`);
        });
      }
    } else {
      const pa = await pdfFacts(ba);
      const pb = await pdfFacts(bb);
      if (JSON.stringify(pa) === JSON.stringify(pb)) console.log(`EQUIVALENT ${name}: ${pa.length} pages, same sizes and the same text on every page (file bytes differ: PDF IDs / dates)`);
      else {
        bad++;
        console.log(`DIFFERENT ${name}: pages ${pa.length} vs ${pb.length}`);
        pa.forEach((p, i) => {
          if (JSON.stringify(p) !== JSON.stringify(pb[i])) console.log(`   page ${i + 1}: ${p.size} vs ${pb[i]?.size}\n   - ${p.text.slice(0, 300)}\n   + ${(pb[i]?.text ?? "").slice(0, 300)}`);
        });
      }
    }
  }
  console.log(bad ? `${bad} file(s) differ` : `All ${files.length} files match`);
  process.exit(bad ? 1 : 0);
})();
