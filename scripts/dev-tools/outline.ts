import { parseFormFile } from "@/modules/medreport/ai/analyse-form";
import { buildOutlineBlock, buildFinalInstruction } from "@/modules/medreport/ai/form-analysis";
import { chunkParsedForm } from "@/modules/medreport/ai/form-outline";
import { sha256Hex } from "@/modules/medreport/forms/file";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
async function main() {
  const s = getSampleForm(process.argv[2])!;
  const bytes = await s.loadFile();
  const parsed = await parseFormFile({ bytes, mimeType: s.mimeType, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength });
  console.log(buildOutlineBlock(parsed));
  const chunks = chunkParsedForm(parsed);
  chunks.forEach((c, i) => console.log(`--- chunk ${i}: ${buildFinalInstruction({ fileName: "x", referrer: s.referrer, title: s.title }, c, i, chunks.length)}`));
}
main();
