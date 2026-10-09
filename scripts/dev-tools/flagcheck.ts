import { readFileSync } from "node:fs";
import { assembleDraft } from "@/modules/medreport/ai/assemble";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { formToTemplate } from "@/modules/medreport/core/forms";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { getDemoBundle } from "../medreport/dev-bundles";
async function main() {
  const [file, label, effort] = process.argv.slice(2);
  const line = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((x) => x.label === label && x.effort === effort);
  const [slug, sample] = label.split(" → ");
  const form = { ...(await getSampleForm(sample)!.loadForm!())!, sampleId: sample, status: "confirmed" as const };
  const bundle = getDemoBundle(slug);
  const template = formToTemplate(form);
  for (const g of line.groups) {
    const a = assembleDraft({ template, bundle, instructingParty: bundle.referral, sectionKeys: g.keys, computedFacts: computeFacts(bundle), output: g.output, meta: g.meta, form });
    for (const f of a.flags.filter((f) => f.code === "FIGURE_NOT_IN_SOURCE")) {
      const p = a.sections.flatMap((s) => s.paragraphs).find((p) => p.id === f.paragraphId);
      console.log(f.message, "\n  PARA:", p?.sourceIds.join(","), "|", p?.text);
    }
  }
  const n10 = bundle.notes.find((n) => n.id === "N-010");
  console.log("N-010 date:", n10?.date, (n10 as any)?.datetime ?? "");
}
main();
