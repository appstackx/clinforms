import "server-only";

/**
 * Pre-confirmed form map: Northfield Assurance (fictional) – Rehabilitation Progress Report
 * (NA-RPR-2, fillable PDF). AcroForm text, multi-line, number, check box and radio-group fields.
 *
 * Owner: forms-engine agent.
 */
import type { FormDefinition } from "../../../core/types";
import { BLANK, NARRATIVE, OPINION, pdfText, reg, sampleFormDefinition, sessionsAttended, sessionsMissed, signoff } from "./common";

const CLAIM = "Claim details";
const DECL = "Declaration";

export const NORTHFIELD_FORM: FormDefinition = sampleFormDefinition({
  id: "frm_sample_northfield_rpr2",
  sampleId: "northfield-rehab-progress",
  referrer: { name: "Northfield Assurance (fictional)", type: "insurer" },
  title: "Rehabilitation Progress Report",
  versionLabel: "NA-RPR-2 (Rev. 05/2026)",
  fields: [
    { label: "Policy / claim no.", section: CLAIM, guidance: "The insurer's policy or claim number from the referral.", answerType: "short_text", anchor: pdfText("txtPolicyNo"), fillSource: reg("referral.reference") },
    { label: "Date of injury", section: CLAIM, guidance: "Date of the injury from the referral / incident record.", answerType: "date", anchor: pdfText("txtInjuryDate"), fillSource: reg("incident.date") },
    { label: "Claimant", section: CLAIM, guidance: "The claimant's full name as registered.", answerType: "short_text", anchor: pdfText("txtClaimant"), fillSource: reg("patient.fullName") },
    { label: "Date of birth", section: CLAIM, guidance: "The claimant's date of birth.", answerType: "date", anchor: pdfText("txtDOB"), fillSource: reg("patient.dob") },
    { label: "Date of first treatment", section: CLAIM, guidance: "Date of the first attended appointment.", answerType: "date", anchor: pdfText("txtFirstSeen"), fillSource: reg("episode.firstSeen") },
    { label: "Date of this report", section: CLAIM, guidance: "Today's date (the date the report is prepared).", answerType: "date", anchor: pdfText("txtReportDate"), fillSource: reg("report.date") },
    {
      label: "1. Diagnosis / working diagnosis",
      section: "1. Diagnosis / working diagnosis",
      guidance: "The working diagnosis recorded by the treating clinician, with the mechanism of injury as reported.",
      answerType: "long_text",
      anchor: pdfText("txtQ1Diagnosis"),
      fillSource: NARRATIVE,
    },
    {
      label: "2. Treatment to date and attendance",
      section: "2. Treatment to date and attendance",
      guidance: "Type of treatment, exercise programme and advice given, as recorded across the episode.",
      answerType: "long_text",
      anchor: pdfText("txtQ2Treatment"),
      fillSource: NARRATIVE,
    },
    { label: "Sessions attended", section: "2. Treatment to date and attendance", guidance: "Number of appointments attended.", answerType: "number", anchor: { kind: "pdf_field", fieldName: "numAttended", fieldType: "text" }, fillSource: sessionsAttended },
    { label: "Sessions missed (DNA)", section: "2. Treatment to date and attendance", guidance: "Number of appointments not attended.", answerType: "number", anchor: { kind: "pdf_field", fieldName: "numDNA", fieldType: "text" }, fillSource: sessionsMissed },
    {
      label: "Treatment completed – claimant discharged",
      section: "2. Treatment to date and attendance",
      guidance: "Tick only if the notes record discharge from treatment.",
      answerType: "checkbox",
      anchor: { kind: "pdf_field", fieldName: "chkDischarged", fieldType: "checkbox" },
      fillSource: NARRATIVE,
    },
    {
      label: "3. Functional limitations affecting work and daily activities",
      section: "3. Functional limitations affecting work and daily activities",
      guidance: "Limitations on work and daily activities at the latest review, as recorded by the treating clinician.",
      answerType: "long_text",
      anchor: pdfText("txtQ3Limitations"),
      fillSource: OPINION,
    },
    {
      label: "4. Is the claimant fit for work?",
      section: "4. Is the claimant fit for work?",
      guidance: "Clinical opinion on fitness for work – only as recorded by the treating clinician.",
      answerType: "single_choice",
      options: ["Yes", "No", "Modified duties"],
      anchor: { kind: "pdf_field", fieldName: "rdoFitForWork", fieldType: "radio", options: ["Yes", "No", "Modified duties"] },
      fillSource: OPINION,
    },
    {
      label: "If modified duties, please give details",
      section: "4. Is the claimant fit for work?",
      guidance: "Duties, hours and expected duration – only if modified duties were recommended.",
      answerType: "long_text",
      anchor: pdfText("txtQ4Details"),
      fillSource: OPINION,
      required: false,
    },
    {
      label: "5. Recommended further treatment and estimated sessions",
      section: "5. Recommended further treatment and estimated sessions",
      guidance: "Further treatment recommended by the treating clinician, or discharge to self-management, as recorded.",
      answerType: "long_text",
      anchor: pdfText("txtQ5Further"),
      fillSource: OPINION,
    },
    {
      label: "Estimated number of further sessions",
      section: "5. Recommended further treatment and estimated sessions",
      guidance: "Only a number the treating clinician recorded.",
      answerType: "number",
      anchor: { kind: "pdf_field", fieldName: "numFurtherSessions", fieldType: "text" },
      fillSource: OPINION,
      required: false,
    },
    {
      label: "6. Expected recovery timescale (prognosis)",
      section: "6. Expected recovery timescale (prognosis)",
      guidance: "Clinical opinion on prognosis and recovery timescale – only an opinion a clinician recorded, attributed to them.",
      answerType: "long_text",
      anchor: pdfText("txtQ6Prognosis"),
      fillSource: OPINION,
    },
    { label: "Therapist name", section: DECL, guidance: "Approving clinician's name (from the approval).", answerType: "clinician_name", anchor: pdfText("txtTherapistName"), fillSource: signoff("name") },
    { label: "HCPC registration no.", section: DECL, guidance: "Approving clinician's HCPC number.", answerType: "hcpc_number", anchor: pdfText("txtHCPC"), fillSource: signoff("hcpc") },
    { label: "Signature (typed)", section: DECL, guidance: "Electronic approval statement.", answerType: "signature", anchor: pdfText("txtSignature"), fillSource: signoff("signature") },
    { label: "Date", section: DECL, guidance: "Date of approval.", answerType: "date_signed", anchor: pdfText("txtSignedDate"), fillSource: signoff("date") },
    { label: "Claims handler (insurer use)", section: "For Northfield Assurance use only", guidance: "For the insurer's office – not completed by the clinic.", answerType: "short_text", anchor: pdfText("txtOfficeHandler"), fillSource: BLANK },
    { label: "Date received (insurer use)", section: "For Northfield Assurance use only", guidance: "For the insurer's office – not completed by the clinic.", answerType: "short_text", anchor: pdfText("txtOfficeReceived"), fillSource: BLANK },
  ],
});
