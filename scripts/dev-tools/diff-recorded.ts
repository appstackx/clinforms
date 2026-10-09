import { readFileSync } from "node:fs";
import { formAnchorKey } from "@/modules/medreport/core/forms";
import type { FormDefinition, FormField } from "@/modules/medreport/core/types";
const B = process.argv[2] ?? "recorded-forms-backup"; // folder of older recorded analyses to compare against
const N = "src/modules/medreport/ai/recorded/forms";
const src = (f: FormField) => { const s = f.fillSource as any; return s.kind + (s.path ? ` ${s.path}` : "") + (s.factId ? ` ${s.factId}/${s.format ?? ""}` : "") + (s.part ? ` ${s.part}` : ""); };
function keys(form: FormDefinition) { const seen = new Map<string, number>(); return form.fields.map((f) => { const a: any = f.anchor; const base = a.kind === "docx" && a.target !== "checkbox_glyph" ? `docx:${a.blockId}` : formAnchorKey(f.anchor); const k = seen.get(base) ?? 0; seen.set(base, k + 1); return `${base}#${k}`; }); }
for (const id of ["harrow-pike-treating-physio", "northfield-rehab-progress", "kingsway-rtw-assessment", "meridian-discharge-report"]) {
  const o = JSON.parse(readFileSync(`${B}/${id}.json`, "utf8"));
  const n = JSON.parse(readFileSync(`${N}/${id}.json`, "utf8"));
  const ok = keys(o.form), nk = keys(n.form);
  const out: string[] = [];
  n.form.fields.forEach((f: FormField, i: number) => {
    const j = ok.indexOf(nk[i]);
    if (j < 0) return out.push(`+ ${f.id} ${f.label}`);
    const g: FormField = o.form.fields[j];
    const d: string[] = [];
    if (f.answerType !== g.answerType) d.push(`type ${f.answerType} vs ${g.answerType}`);
    if (src(f) !== src(g)) d.push(`source ${src(f)} vs ${src(g)}`);
    if (JSON.stringify(f.options ?? []) !== JSON.stringify(g.options ?? [])) d.push(`options`);
    if (f.required !== g.required) d.push(`required ${f.required} vs ${g.required}`);
    if (f.label.replace(/:$/, "") !== g.label.replace(/:$/, "")) d.push(`label "${f.label}" vs "${g.label}"`);
    if (d.length) out.push(`~ ${f.id}: ${d.join("; ")}`);
  });
  ok.forEach((k, j) => { if (nk.indexOf(k) < 0) out.push(`- ${o.form.fields[j].id} ${o.form.fields[j].label}`); });
  console.log(`${id}: sonnet ${n.form.fields.length} vs opus ${o.form.fields.length}; title "${n.form.title}" / "${o.form.title}"; referrer "${n.form.referrer.name}" / "${o.form.referrer.name}"; warnings ${n.form.analysis.warnings.length} vs ${o.form.analysis.warnings.length}`);
  for (const l of out) console.log("   " + l);
  console.log("   sonnet warnings: " + n.form.analysis.warnings.join(" | "));
  console.log("   opus warnings:   " + o.form.analysis.warnings.join(" | "));
}
