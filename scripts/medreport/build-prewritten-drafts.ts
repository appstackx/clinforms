/**
 * Builds the PRE-WRITTEN demo answers for case A (Megan Hart) on the flat Ashcroft PDF form, so the
 * "even a non-fillable PDF" demo has drafted answers without a live drafting call. Every paragraph is taken
 * unchanged from the RECORDED answers to the equivalent question on Harrow & Pike's form (same
 * patient, same notes, same citations); questions nobody recorded an opinion on stay empty with the
 * recorded gaps. The file is labelled "demo_prewritten" ("Pre-written draft – no AI call"), never as a
 * live or recorded draft.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/build-prewritten-drafts.ts
 *   (then: scripts/medreport/stamp-demo-drafts.ts, and re-run when either form or the recording changes)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEMO_DRAFT_FORMAT, type DemoDraftFile } from "@/modules/medreport/ai/demo-format";
import { formAnchorKeys, formTemplateId } from "@/modules/medreport/core/forms";
import { ASHCROFT_FORM } from "@/modules/medreport/forms/samples/maps/ashcroft";

const DIR = path.join(process.cwd(), "src/modules/medreport/ai/demo-drafts");
const source = JSON.parse(readFileSync(path.join(DIR, "sim-pat-001__form-harrow-pike-treating-physio.json"), "utf8")) as DemoDraftFile;

type Section = DemoDraftFile["groups"][string]["sections"][number];
type Gap = DemoDraftFile["groups"][string]["gaps"][number];
const sections = new Map<string, Section>();
const gaps = new Map<string, Gap[]>();
for (const g of Object.values(source.groups)) {
  for (const s of g.sections) sections.set(s.sectionKey, s);
  for (const gap of g.gaps) gaps.set(gap.sectionKey, [...(gaps.get(gap.sectionKey) ?? []), gap]);
}

/** Ashcroft field ← Harrow & Pike field (same question, worded differently). */
const FROM: Record<string, string> = {
  "F-05": "F-08", // Presenting symptoms at the first assessment ← B2. Presenting symptoms at initial assessment
  "F-06": "F-09", // Treatment provided ← B3. Treatment provided to date
  "F-08": "F-12", // Current symptoms and level of function ← B5. Current symptoms and progress
  "F-09": "F-14", // Prognosis ← B7. Prognosis (nothing recorded: empty + gap)
  "F-10": "F-16", // Is further treatment recommended? ← B9. Treatment recommendations (gap)
};

const outSections: Section[] = [];
const outGaps: Gap[] = [];
for (const [to, from] of Object.entries(FROM)) {
  const s = sections.get(from);
  if (!s) throw new Error(`No recorded section ${from}`);
  const field = ASHCROFT_FORM.fields.find((f) => f.id === to)!;
  // A yes/no question gets no paragraphs from a narrative answer: the recorded gap explains why.
  const structured = field.answerType === "yes_no";
  outSections.push({ sectionKey: to, answer: "", paragraphs: structured ? [] : s.paragraphs });
  for (const g of gaps.get(from) ?? []) outGaps.push({ ...g, sectionKey: to });
}

/** Drafted questions with no equivalent answer: empty (an optional follow-on question – "If yes, …"). */
const EMPTY = ["F-11"]; // C3. If yes, please give details (optional; C2 carries the recorded gap)
for (const to of EMPTY) {
  if (!ASHCROFT_FORM.fields.some((f) => f.id === to)) throw new Error(`No Ashcroft field ${to}`);
  outSections.push({ sectionKey: to, answer: "", paragraphs: [] });
}

const keys = formAnchorKeys(ASHCROFT_FORM);
const file: DemoDraftFile = {
  format: DEMO_DRAFT_FORMAT,
  formatVersion: 1,
  patientId: "sim-pat-001",
  templateId: formTemplateId(ASHCROFT_FORM.id),
  templateVersion: ASHCROFT_FORM.versionLabel ?? "1",
  sampleId: "ashcroft-update-report",
  formSha256: ASHCROFT_FORM.file.sha256,
  fields: Object.fromEntries(
    ASHCROFT_FORM.fields.map((f) => [f.id, { anchor: keys.get(f.id) ?? "", answerType: f.answerType, label: f.label }]),
  ),
  mode: "demo_prewritten",
  promptVersion: `prewritten-from-${source.promptVersion}`,
  note: `Pre-written for the demo – no drafting call. Each paragraph is copied unchanged from the recorded answer to the same question on Harrow & Pike's form (sim-pat-001__form-harrow-pike-treating-physio.json, recorded ${source.recordedAt?.slice(0, 10) ?? "?"} on prompt ${source.promptVersion}; same patient, notes and citations); prognosis and further treatment were not recorded by any clinician, so they stay empty with the recorded gaps. Rebuilt by scripts/medreport/build-prewritten-drafts.ts whenever that recording changes.`,
  groups: { [[...Object.keys(FROM), ...EMPTY].join("+")]: { sections: outSections, gaps: outGaps } },
};
writeFileSync(path.join(DIR, "sim-pat-001__form-ashcroft-update-report.json"), `${JSON.stringify(file, null, 2)}\n`);
console.log(`Wrote sim-pat-001__form-ashcroft-update-report.json (${outSections.length} questions, ${outGaps.length} gaps)`);
