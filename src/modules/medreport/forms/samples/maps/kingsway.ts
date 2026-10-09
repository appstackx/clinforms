import "server-only";

/**
 * Pre-confirmed form map: Kingsway Case Management (fictional) – Return to Work Assessment
 * (KCM-RTW-01, Word). Heading-based: numbered headings, "Answer: ____" lines with dotted continuation
 * lines, inline "Name: ____  Date of birth: ____" blanks (several in one paragraph), ☐ tick-box lines.
 *
 * Owner: forms-engine agent.
 */
import type { FormDefinition } from "../../../core/types";
import { NARRATIVE, OPINION, after, placeholder, reg, sampleFormDefinition, signoff, ticks } from "./common";

const U = (n: number) => "_".repeat(n);
const DOTS = (n: number) => ".".repeat(n);
const ANSWER = U(78);
const A = "Section A – Employee details";
const B = "Section B – Clinical findings";
const C = "Section C – Fitness for work";
const D = "Section D – Declaration";

export const KINGSWAY_FORM: FormDefinition = sampleFormDefinition({
  id: "frm_sample_kingsway_rtw01",
  sampleId: "kingsway-rtw-assessment",
  referrer: { name: "Kingsway Case Management (fictional)", type: "case_manager" },
  title: "Return to Work Assessment",
  versionLabel: "KCM-RTW-01 Rev. 2 (01/2026)",
  fields: [
    { label: "Employer / client reference", guidance: "The employer's or client's reference from the referral.", answerType: "short_text", anchor: placeholder("p3", DOTS(34)), fillSource: reg("referral.reference") },
    { label: "Kingsway case no.", guidance: "Kingsway's own case number, from their instruction letter. Optional – entered by staff when they have it; the clinic record does not hold it.", answerType: "short_text", anchor: placeholder("p3", DOTS(26)), fillSource: reg("referral.reference"), required: false },
    { label: "Employee name", section: A, guidance: "The employee's full name as registered.", answerType: "short_text", anchor: placeholder("p5", U(36)), fillSource: reg("patient.fullName") },
    { label: "Date of birth", section: A, guidance: "The employee's date of birth.", answerType: "date", anchor: placeholder("p5", U(16)), fillSource: reg("patient.dob") },
    { label: "Job title", section: A, guidance: "Occupation from the registration record.", answerType: "short_text", anchor: placeholder("p6", U(30)), fillSource: reg("patient.occupation") },
    { label: "Employer", section: A, guidance: "Employer from the registration record.", answerType: "short_text", anchor: placeholder("p6", U(32)), fillSource: reg("patient.employer") },
    { label: "Date of injury / onset", section: A, guidance: "Date of the injury from the referral / incident record.", answerType: "date", anchor: placeholder("p7", U(14)), fillSource: reg("incident.date"), note: "First of three blanks on this line." },
    { label: "Date first seen", section: A, guidance: "Date of the first attended appointment.", answerType: "date", anchor: placeholder("p7", U(14)), fillSource: reg("episode.firstSeen"), note: "Second blank on this line." },
    { label: "Date last seen", section: A, guidance: "Date of the last attended appointment.", answerType: "date", anchor: placeholder("p7", U(14)), fillSource: reg("episode.lastSeen"), note: "Third blank on this line." },
    {
      label: "1. Nature of the injury and diagnosis",
      section: B,
      guidance: "How the injury happened (as reported) and the working diagnosis recorded by the treating clinician.",
      answerType: "long_text",
      anchor: placeholder("p10", ANSWER),
      fillSource: NARRATIVE,
    },
    {
      label: "2. Treatment provided to date, including the number of sessions attended",
      section: B,
      guidance: "The treatment and exercise programme given, and attendance (sessions attended and any missed or cancelled).",
      answerType: "long_text",
      anchor: placeholder("p14", ANSWER),
      fillSource: NARRATIVE,
    },
    {
      label: "3. Current functional capacity",
      section: B,
      guidance:
        "Lifting and carrying, bending, prolonged sitting and standing at the latest review, as recorded, and whether a formal functional or lifting assessment was carried out (if none is documented, say so – never infer one).",
      answerType: "long_text",
      anchor: after("p18"),
      fillSource: NARRATIVE,
    },
    {
      label: "4. In your opinion, is the employee fit to return to their normal duties?",
      section: C,
      guidance: "Clinical opinion on fitness for normal duties – only as recorded by the treating clinician.",
      answerType: "yes_no",
      options: ["Yes", "No"],
      anchor: ticks("p24", ["Yes", "No"]),
      fillSource: OPINION,
    },
    {
      label: "5. If not, are they fit for modified or restricted duties?",
      section: C,
      guidance: "Clinical opinion on modified or restricted duties – only as recorded; “Not applicable” when fit for normal duties.",
      answerType: "single_choice",
      options: ["Yes, with the adjustments below", "No", "Not applicable"],
      anchor: ticks("p26", ["Yes, with the adjustments below", "No", "Not applicable"]),
      fillSource: OPINION,
    },
    {
      label: "6. Recommended adjustments or restrictions",
      section: C,
      guidance: "Lifting limits, reduced hours, tasks to avoid and for how long – as recommended by the treating clinician.",
      answerType: "long_text",
      anchor: after("p28"),
      fillSource: OPINION,
    },
    {
      label: "7. Recommended return-to-work plan and timescale",
      section: C,
      guidance: "The return-to-work plan and timescale recommended by the treating clinician (e.g. phased return).",
      answerType: "long_text",
      anchor: placeholder("p32", ANSWER),
      fillSource: OPINION,
    },
    {
      label: "8. Is further treatment required? If so, please give details.",
      section: C,
      guidance: "Further treatment recommended by the treating clinician, or discharge to self-management, as recorded.",
      answerType: "long_text",
      anchor: placeholder("p35", ANSWER),
      fillSource: OPINION,
    },
    {
      label: "9. When should the employee be reviewed?",
      section: C,
      guidance: "The review interval recommended by the treating clinician, as recorded.",
      answerType: "short_text",
      anchor: placeholder("p38", U(40)),
      fillSource: OPINION,
    },
    { label: "Therapist name", section: D, guidance: "Approving clinician's name (from the approval).", answerType: "clinician_name", anchor: placeholder("p41", U(34)), fillSource: signoff("name") },
    { label: "HCPC no.", section: D, guidance: "Approving clinician's HCPC number.", answerType: "hcpc_number", anchor: placeholder("p41", U(16)), fillSource: signoff("hcpc") },
    { label: "Signature", section: D, guidance: "Electronic approval statement.", answerType: "signature", anchor: placeholder("p42", U(38)), fillSource: signoff("signature") },
    { label: "Date", section: D, guidance: "Date of approval.", answerType: "date_signed", anchor: placeholder("p42", U(16)), fillSource: signoff("date") },
  ],
});
