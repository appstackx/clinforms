/**
 * Hand-made referrer form maps for tests and for validating the drafting prompts before the bundled
 * sample forms exist (fictional organisations only). They are FormDefinitions as staff would confirm
 * them: Word anchors in a single answer table, so they are also valid input for the forms engine.
 *
 *   HAND_MLC_FORM       – an MLC's treating physiotherapist form (case A, Megan Hart): history,
 *                         symptoms, treatment, progress, then prognosis / restrictions / recommendations.
 *   HAND_EMPLOYER_FORM  – an employer's fitness-for-work form (case B, Daniel Brooks): fit for work as a
 *                         tick-box choice, adjustments, review.
 *
 * Owner: ai agent.
 */
import { formatCellBlockId } from "@/modules/medreport/core/forms";
import type { FillSource, FormDefinition, FormField } from "@/modules/medreport/core/types";

const AT = "2026-10-06T09:00:00.000Z";

type FieldSpec = Omit<FormField, "id" | "anchor" | "confidence" | "required" | "guidance"> &
  Partial<Pick<FormField, "required" | "guidance" | "confidence" | "anchor">>;

function fields(specs: FieldSpec[]): FormField[] {
  return specs.map((spec, i) => {
    const id = `F-${String(i + 1).padStart(2, "0")}`;
    return {
      id,
      guidance: spec.guidance ?? `Answer “${spec.label}”.`,
      anchor: spec.anchor ?? { kind: "docx", target: "table_cell", blockId: formatCellBlockId([{ t: 0, r: i, c: 1 }]) },
      required: spec.required ?? true,
      confidence: spec.confidence ?? "high",
      ...spec,
    };
  });
}

const reg = (path: Extract<FillSource, { kind: "registration" }>["path"]): FillSource => ({ kind: "registration", path });
const NARRATIVE: FillSource = { kind: "notes_narrative" };
const OPINION: FillSource = { kind: "clinician_opinion" };

function docxForm(id: string, title: string, referrer: FormDefinition["referrer"], specs: FieldSpec[], sha: string): FormDefinition {
  return {
    id,
    tenantId: "demo",
    referrer,
    title,
    versionLabel: "v1 (2026)",
    file: {
      fileName: `${id}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: sha.repeat(64).slice(0, 64),
      sizeBytes: 40_000,
    },
    kind: "docx",
    fields: fields(specs),
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: "hand-made", at: AT, warnings: [] },
    confirmed: { by: "Practice manager (demo)", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

export const HAND_MLC_FORM: FormDefinition = docxForm(
  "frm_hand_mlc",
  "Treating Physiotherapist Report",
  { name: "Northgate Medical Reporting (fictional)", type: "mlc" },
  [
    { label: "Claimant name", section: "Part 1 – Claimant", answerType: "short_text", fillSource: reg("patient.fullName") },
    { label: "Date of birth", section: "Part 1 – Claimant", answerType: "date", fillSource: reg("patient.dob") },
    { label: "Instructing party reference", section: "Part 1 – Claimant", answerType: "short_text", fillSource: reg("referral.reference") },
    { label: "Date of accident", section: "Part 1 – Claimant", answerType: "date", fillSource: reg("incident.date") },
    { label: "Date of first treatment", section: "Part 2 – Treatment", answerType: "date", fillSource: reg("episode.firstSeen") },
    {
      label: "Number of sessions attended",
      section: "Part 2 – Treatment",
      answerType: "number",
      fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" },
    },
    {
      label: "Accident circumstances as described by the claimant",
      section: "Part 3 – History",
      guidance: "How the accident happened and the onset of symptoms, as the claimant described them.",
      answerType: "long_text",
      fillSource: NARRATIVE,
    },
    {
      label: "Symptoms and functional difficulties at the first assessment",
      section: "Part 3 – History",
      guidance: "Symptoms reported and their effect on work, sleep, driving and daily activities at the first appointment.",
      answerType: "long_text",
      fillSource: NARRATIVE,
    },
    {
      label: "Any relevant pre-accident history of neck problems?",
      section: "Part 3 – History",
      guidance: "Whether the claimant had neck problems before the accident.",
      answerType: "yes_no",
      options: ["Yes", "No"],
      fillSource: NARRATIVE,
    },
    {
      label: "Treatment provided",
      section: "Part 4 – Treatment and progress",
      guidance: "Treatment given and the home exercise programme.",
      answerType: "long_text",
      fillSource: NARRATIVE,
    },
    {
      label: "Condition at the last appointment",
      section: "Part 4 – Treatment and progress",
      guidance: "Symptoms, function and findings at the most recent appointment, with outcome scores.",
      answerType: "long_text",
      fillSource: NARRATIVE,
    },
    {
      label: "Prognosis",
      section: "Part 5 – Opinion of the treating physiotherapist",
      guidance: "The treating physiotherapist's prognosis for the claimant's recovery.",
      answerType: "long_text",
      fillSource: OPINION,
    },
    {
      label: "Current functional restrictions",
      section: "Part 5 – Opinion of the treating physiotherapist",
      guidance: "Any restrictions on work, driving or daily activities in the physiotherapist's opinion.",
      answerType: "long_text",
      fillSource: OPINION,
    },
    {
      label: "Is further treatment recommended?",
      section: "Part 5 – Opinion of the treating physiotherapist",
      answerType: "yes_no",
      options: ["Yes", "No"],
      fillSource: OPINION,
    },
    { label: "Name of physiotherapist", section: "Declaration", answerType: "clinician_name", fillSource: { kind: "signoff", part: "name" } },
    { label: "HCPC registration number", section: "Declaration", answerType: "hcpc_number", fillSource: { kind: "signoff", part: "hcpc" } },
    { label: "Signature", section: "Declaration", answerType: "signature", fillSource: { kind: "signoff", part: "signature" } },
    { label: "Date", section: "Declaration", answerType: "date_signed", fillSource: { kind: "signoff", part: "date" } },
    { label: "For Northgate use only", answerType: "short_text", required: false, fillSource: { kind: "leave_blank" } },
  ],
  "a1",
);

export const HAND_EMPLOYER_FORM: FormDefinition = docxForm(
  "frm_hand_employer",
  "Fitness for Work – Physiotherapy Report",
  { name: "Ashby Freight Ltd (fictional)", type: "employer" },
  [
    { label: "Employee name", section: "Section A – Employee", answerType: "short_text", fillSource: reg("patient.fullName") },
    { label: "Job title", section: "Section A – Employee", answerType: "short_text", fillSource: reg("patient.occupation") },
    { label: "OH reference", section: "Section A – Employee", answerType: "short_text", fillSource: reg("referral.reference") },
    { label: "Date of injury", section: "Section A – Employee", answerType: "date", fillSource: reg("incident.date") },
    {
      label: "Nature of the injury and how it occurred",
      section: "Section B – Clinical summary",
      answerType: "long_text",
      fillSource: NARRATIVE,
    },
    {
      label: "Current symptoms and function",
      section: "Section B – Clinical summary",
      guidance: "Symptoms and function at the most recent appointment, including outcome scores.",
      answerType: "long_text",
      fillSource: NARRATIVE,
    },
    {
      label: "Has a formal lifting or functional capacity assessment been carried out?",
      section: "Section B – Clinical summary",
      answerType: "yes_no",
      options: ["Yes", "No"],
      fillSource: NARRATIVE,
    },
    {
      label: "In your opinion, is the employee:",
      section: "Section C – Fitness for work",
      guidance: "Tick one: the employee's fitness for their normal role.",
      answerType: "single_choice",
      options: ["Fit for normal duties", "Fit for work with adjustments or a phased return", "Not fit for work at present"],
      fillSource: OPINION,
    },
    {
      label: "Recommended adjustments and restrictions",
      section: "Section C – Fitness for work",
      answerType: "long_text",
      fillSource: OPINION,
    },
    {
      label: "Is a review recommended?",
      section: "Section C – Fitness for work",
      answerType: "yes_no",
      options: ["Yes", "No"],
      fillSource: OPINION,
    },
    { label: "Physiotherapist", section: "Section D – Sign-off", answerType: "clinician_name", fillSource: { kind: "signoff", part: "name" } },
    { label: "Date", section: "Section D – Sign-off", answerType: "date_signed", fillSource: { kind: "signoff", part: "date" } },
  ],
  "b2",
);
