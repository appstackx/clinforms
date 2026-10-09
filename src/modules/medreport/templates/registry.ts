/**
 * Report template registry. Pure data – safe in the browser and on the server.
 *
 * Do NOT import the generated .docx base64 modules here (they are large and server-only); docgen
 * maps `docxTemplateId` → tagged Word template on the server.
 *
 * Extension point: further templates (e.g. the uploadable fictional "clinic-style" template) are added
 * in `./extensions.ts`, which the forms-engine agent (formerly docgen) owns. Built-ins below are owned by the forms-engine agent (formerly docgen) too
 * (wording), but their IDs and section keys are part of the contract.
 */
import type { ReportTemplate } from "../core/types";
import { EXTENSION_TEMPLATES } from "./extensions";

/** Signer attestations shown in the sign dialog (three, per the spec). */
export const DEFAULT_ATTESTATIONS = [
  "I have checked every statement in this report against the source records it cites.",
  "Opinions in this report are my own, or are clearly attributed to the clinician who recorded them.",
  "I understand that the automated checks cannot detect a paraphrase error that cites a valid note, and I have reviewed the drafted text for that.",
] as const;

export const SOLICITOR_TEMPLATE_ID = "solicitor-rta-treating-physio" as const;
export const EMPLOYER_TEMPLATE_ID = "employer-fitness-for-work" as const;

const ATTRIBUTE_ONLY =
  "Write as reported in the record, attributing every statement: patient-reported (\"[CLAIMANT] reported…\") or clinician-observed (\"On DD/MM/YYYY the treating physiotherapist recorded…\"), naming which clinician where notes are by more than one. Cite the note IDs. Do not strengthen hedged wording. If the record does not cover something the section needs, raise a gap instead of guessing.";

export const SOLICITOR_RTA_TEMPLATE: ReportTemplate = {
  id: SOLICITOR_TEMPLATE_ID,
  name: "Treating physiotherapist report (RTA personal injury)",
  documentTitle: "Treating Physiotherapist Report",
  audience: "solicitor",
  description:
    "Factual report from the treating physiotherapist for a solicitor in a road traffic accident personal injury claim. Built from the clinical record; the treating clinician's prognosis is written or confirmed by the clinician. Not a MedCo initial medical report.",
  version: "1.0.0",
  scope: { excludeFields: [], excludeTerms: [] },
  sections: [
    {
      key: "introduction",
      title: "Introduction and instructions",
      kind: "from_records",
      guidance:
        "Code-generated: who instructed the report (name, type, reference), who it concerns, the clinic, and that it is based solely on the clinic's records.",
      required: true,
    },
    {
      key: "claimant_details",
      title: "Claimant details",
      kind: "from_records",
      guidance: "Code-generated from registration: name, date of birth, age at the date of the report, occupation, employer.",
      required: true,
    },
    {
      key: "records_reviewed",
      title: "Records reviewed",
      kind: "from_records",
      guidance:
        "Code-generated summary of the records reviewed (notes with dates and authors, appointment history, outcome measures). The full list appears in the appendix with cited records marked.",
      required: true,
      blocks: ["records_reviewed"],
    },
    {
      key: "incident_history",
      title: "History of the incident (as reported)",
      kind: "ai_narrative",
      guidance: `Describe the incident as the claimant reported it at assessment: date, mechanism (e.g. stationary vehicle struck from behind), seating position, seatbelt, immediate symptoms and onset, and any first treatment sought. ${ATTRIBUTE_ONLY} Do not comment on liability or causation.`,
      required: true,
    },
    {
      key: "presenting_complaints",
      title: "Presenting complaints",
      kind: "ai_narrative",
      guidance: `Summarise the symptoms reported at the initial assessment: location, nature, severity (quote recorded scores only), aggravating and easing factors, and effect on work, sleep, driving and daily activities. ${ATTRIBUTE_ONLY}`,
      required: true,
    },
    {
      key: "examination_findings",
      title: "Examination findings (as recorded)",
      kind: "ai_narrative",
      guidance: `Report the objective findings exactly as recorded: range of movement, palpation, neurological screen, special tests, and the recorded working diagnosis or classification (e.g. WAD grade) attributed to the clinician who recorded it. ${ATTRIBUTE_ONLY} Never add a diagnosis that is not in the notes.`,
      required: true,
    },
    {
      key: "treatment_provided",
      title: "Treatment provided",
      kind: "ai_narrative",
      guidance: `Describe the treatment given across the episode (manual therapy, exercise prescription, advice, home exercise programme) and how it changed over time, citing the notes. Do not restate attendance counts; they appear in the Attendance section. ${ATTRIBUTE_ONLY}`,
      required: true,
    },
    {
      key: "attendance",
      title: "Attendance",
      kind: "from_records",
      guidance: "Code-generated from the appointment history (FACT-attendance) with the attendance table, including missed and cancelled appointments and any recorded reasons.",
      required: true,
      blocks: ["attendance"],
    },
    {
      key: "outcome_measures",
      title: "Outcome measures",
      kind: "from_records",
      guidance: "Code-generated from the recorded scores (FACT-outcomes-*) with the outcome table and chart: each instrument, dates, values and the change.",
      required: true,
      blocks: ["outcomes"],
    },
    {
      key: "progress_current_status",
      title: "Progress and current status",
      kind: "ai_narrative",
      guidance: `Describe progress through the episode and the status at the most recent note: symptoms, function, return to work and activities, and discharge status. Quote outcome scores only by citing the FACT-outcomes-* IDs. ${ATTRIBUTE_ONLY}`,
      required: true,
    },
    {
      key: "prognosis",
      title: "Prognosis (treating clinician's opinion)",
      kind: "clinician_opinion",
      guidance:
        "Only attribute a prognosis that a clinician actually recorded in a note, with its date and citation (\"On DD/MM/YYYY the treating physiotherapist recorded that…\"). Never form, extend or firm up a prognosis, and never use causation or \"balance of probabilities\" wording. If no prognosis is recorded, return no paragraphs and raise a gap asking the treating physiotherapist for their opinion.",
      required: true,
    },
    {
      key: "declaration",
      title: "Declaration and statement of truth",
      kind: "declaration",
      guidance: "Fixed text from the template (optional block). Confirm exact wording with the instructing solicitor.",
      required: false,
    },
  ],
  declarationText: [
    "I understand that my duty is to help the court on matters within my expertise, and that this duty overrides any obligation to the person from whom I have received instructions or by whom I am paid. I believe that I have complied with that duty.",
    "I confirm that I have made clear which facts and matters referred to in this report are within my own knowledge and which are not. Those that are within my own knowledge I confirm to be true. The opinions I have expressed represent my true and complete professional opinions on the matters to which they refer.",
    "I understand that proceedings for contempt of court may be brought against anyone who makes, or causes to be made, a false statement in a document verified by a statement of truth without an honest belief in its truth.",
  ].join("\n\n"),
  declarationNote:
    "CPR Part 35-style wording. Confirm exact wording with the instructing solicitor before signing; a treating clinician's factual report may need different wording from an expert report.",
  attestations: [...DEFAULT_ATTESTATIONS],
  docxTemplateId: "riverside-solicitor-v1",
};

export const EMPLOYER_FFW_TEMPLATE: ReportTemplate = {
  id: EMPLOYER_TEMPLATE_ID,
  name: "Fitness for work report (employer)",
  documentTitle: "Fitness for Work Report",
  audience: "employer",
  description:
    "Report to an employer on an employee's current function and fitness for work, with recommended adjustments. Scoped: past medical and social history are removed in code before drafting and blocked in the output.",
  version: "1.0.0",
  scope: {
    excludeFields: ["note.pastMedicalHistory", "note.socialHistory"],
    excludeTerms: [
      "past medical history",
      "previous medical history",
      "medical history",
      "PMH",
      "social history",
      "family history",
      "smoker",
      "smoking",
      "alcohol",
      "units per week",
      "recreational drugs",
    ],
  },
  sections: [
    {
      key: "purpose_consent",
      title: "Purpose of this report and consent",
      kind: "from_records",
      guidance: "Code-generated: who requested the report and why, and whether consent to disclosure to the employer is recorded (with date).",
      required: true,
    },
    {
      key: "employee_details",
      title: "Employee details",
      kind: "from_records",
      guidance: "Code-generated from registration: name, date of birth, age, occupation, employer.",
      required: true,
    },
    {
      key: "reason_for_referral",
      title: "Reason for referral",
      kind: "ai_narrative",
      guidance: `State briefly why the employee was referred for physiotherapy: the presenting problem and how it arose at work, as reported. Include only information relevant to fitness for work; never mention unrelated past or social history. ${ATTRIBUTE_ONLY}`,
      required: true,
    },
    {
      key: "functional_status",
      title: "Current functional status",
      kind: "ai_narrative",
      guidance: `Describe the most recently recorded function relevant to the job: lifting, carrying, bending, sitting and standing tolerance, driving, and any recorded functional tests. Cite outcome scores only via FACT-outcomes-* IDs. If a test relevant to the job (e.g. a lifting assessment) is not recorded, raise a gap. ${ATTRIBUTE_ONLY}`,
      required: true,
    },
    {
      key: "treatment_attendance",
      title: "Treatment and attendance",
      kind: "ai_narrative",
      guidance: `Summarise the treatment provided and the employee's engagement with it. The attendance table is added from the records; cite FACT-attendance for any attendance figures rather than restating them. ${ATTRIBUTE_ONLY}`,
      required: true,
      blocks: ["attendance"],
    },
    {
      key: "fitness_opinion",
      title: "Fitness for work (treating clinician's opinion)",
      kind: "clinician_opinion",
      guidance:
        "Only attribute a view on fitness for work or return to duties that a clinician recorded in a note, with its date and citation. Never form or firm up an opinion. If none is recorded, return no paragraphs and raise a gap for the treating physiotherapist.",
      required: true,
    },
    {
      key: "adjustments",
      title: "Recommended adjustments",
      kind: "clinician_opinion",
      guidance:
        "Only attribute adjustments a clinician recorded (e.g. phased return, lifting limits, workstation changes), with citations. If none are recorded, return no paragraphs and raise a gap.",
      required: true,
    },
    {
      key: "review_date",
      title: "Review date",
      kind: "clinician_opinion",
      guidance:
        "Only attribute a review or follow-up date recorded in a note, with its citation. If none is recorded, return no paragraphs and raise a gap asking when the employee should be reviewed.",
      required: true,
    },
    {
      key: "declaration",
      title: "Declaration",
      kind: "declaration",
      guidance: "Fixed professional declaration from the template.",
      required: true,
    },
  ],
  declarationText: [
    "I confirm that this report has been prepared from the clinical records of the physiotherapy provided by me and my colleagues at the clinic, and that the employee consented to its disclosure to their employer.",
    "The facts stated are true to the best of my knowledge and belief, and the opinions expressed are my own professional opinions, given within the limits of my competence as a physiotherapist. This report addresses fitness for work only and does not disclose unrelated health information.",
  ].join("\n\n"),
  attestations: [...DEFAULT_ATTESTATIONS],
  docxTemplateId: "riverside-employer-v1",
};

/** Built-in templates, in display order. */
export const BUILTIN_TEMPLATES: readonly ReportTemplate[] = [SOLICITOR_RTA_TEMPLATE, EMPLOYER_FFW_TEMPLATE];

/** All templates: built-ins followed by extensions. */
export function listTemplates(): ReportTemplate[] {
  return [...BUILTIN_TEMPLATES, ...EXTENSION_TEMPLATES];
}

export function getTemplate(id: string): ReportTemplate | undefined {
  return listTemplates().find((t) => t.id === id);
}

/** Template preselected from the referral's instructing-party type (solicitor → RTA report, etc.). */
export function defaultTemplateFor(type: ReportTemplate["audience"] | undefined): ReportTemplate {
  if (type === "employer") return EMPLOYER_FFW_TEMPLATE;
  return SOLICITOR_RTA_TEMPLATE;
}
