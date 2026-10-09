import "server-only";

/**
 * Pre-written form map: Ashcroft Medical Reporting (fictional) – Physiotherapy Update Report (AMR-PU-2),
 * a FLAT PDF (no fillable fields). Every answer is written onto the page in the space under or beside
 * its printed question (pdf_overlay boxes from generated/ashcroft-layout.ts, written by
 * scripts/medreport/build-demo-forms.mjs together with the file).
 *
 * Not pre-confirmed in the library: POST /forms/analyse returns it as the "pre-written map of this
 * bundled sample form" when the file is uploaded in demo mode, and staff confirm it themselves.
 *
 * Owner: forms-engine agent.
 */
import type { FormAnchor, FormDefinition } from "../../../core/types";
import { ASHCROFT_LAYOUT } from "../generated/ashcroft-layout";
import { BLANK, NARRATIVE, OPINION, reg, sampleFormDefinition, sessionsAttended, signoff } from "./common";

const box = (b: (typeof ASHCROFT_LAYOUT)[keyof typeof ASHCROFT_LAYOUT]): FormAnchor => ({ kind: "pdf_overlay", page: b.page, x: b.x, y: b.y, width: b.width, height: b.height });
const L = ASHCROFT_LAYOUT;
const A = "Section A – Claimant";
const B = "Section B – Treatment";
const C = "Section C – Opinion";
const D = "Section D – Declaration";

export const ASHCROFT_FORM: FormDefinition = sampleFormDefinition({
  id: "frm_sample_ashcroft_pu2",
  sampleId: "ashcroft-update-report",
  kind: "pdf_flat",
  referrer: { name: "Ashcroft Medical Reporting (fictional)", type: "mlc" },
  title: "Physiotherapy Update Report",
  versionLabel: "AMR-PU-2 (03/2026)",
  warnings: ["This PDF has no fillable fields, so answers are written at the positions of its answer lines. Check every answer in the preview."],
  fields: [
    { label: "Claimant name", section: A, guidance: "The claimant's full name as registered.", answerType: "short_text", anchor: box(L.claimantName), fillSource: reg("patient.fullName") },
    { label: "Date of birth", section: A, guidance: "The claimant's date of birth.", answerType: "date", anchor: box(L.dob), fillSource: reg("patient.dob") },
    {
      label: "Instructing solicitor's reference",
      section: A,
      guidance: "The instructing solicitor's reference from the referral.",
      answerType: "short_text",
      anchor: box(L.solicitorRef),
      fillSource: reg("referral.reference"),
    },
    { label: "Date of accident", section: A, guidance: "Date of the accident from the referral.", answerType: "date", anchor: box(L.accidentDate), fillSource: reg("incident.date") },
    {
      label: "B1. Presenting symptoms at the first assessment",
      section: B,
      guidance: "The symptoms the claimant reported and the clinician found at the first assessment.",
      answerType: "long_text",
      anchor: box(L.b1Symptoms),
      fillSource: NARRATIVE,
    },
    {
      label: "B2. Treatment provided",
      section: B,
      guidance: "Type of treatment, home exercise programme and advice.",
      answerType: "long_text",
      anchor: box(L.b2Treatment),
      fillSource: NARRATIVE,
    },
    { label: "B3. Number of treatment sessions attended", section: B, guidance: "Sessions attended, from the appointment record.", answerType: "number", anchor: box(L.b3Sessions), fillSource: sessionsAttended },
    {
      label: "B4. Current symptoms and level of function",
      section: B,
      guidance: "Symptoms and function at the most recent review.",
      answerType: "long_text",
      anchor: box(L.b4Current),
      fillSource: NARRATIVE,
    },
    {
      label: "C1. Prognosis",
      section: C,
      guidance: "The treating physiotherapist's professional opinion on the expected course of recovery.",
      answerType: "long_text",
      anchor: box(L.c1Prognosis),
      fillSource: OPINION,
    },
    {
      label: "C2. Is further treatment recommended?",
      section: C,
      guidance: "Yes or No, in the clinician's opinion.",
      answerType: "yes_no",
      options: ["Yes", "No"],
      anchor: box(L.c2Further),
      fillSource: OPINION,
    },
    {
      label: "C3. If yes, please give details",
      section: C,
      guidance: "Recommended further treatment, if any.",
      answerType: "long_text",
      anchor: box(L.c3Details),
      fillSource: OPINION,
      required: false,
    },
    { label: "Name", section: D, guidance: "Approving clinician's name (from the approval).", answerType: "clinician_name", anchor: box(L.d1Name), fillSource: signoff("name") },
    { label: "HCPC no.", section: D, guidance: "Approving clinician's HCPC number.", answerType: "hcpc_number", anchor: box(L.d1Hcpc), fillSource: signoff("hcpc") },
    { label: "Signature", section: D, guidance: "Electronic approval statement.", answerType: "signature", anchor: box(L.d2Signature), fillSource: signoff("signature") },
    { label: "Date", section: D, guidance: "Date of approval.", answerType: "date_signed", anchor: box(L.d2Date), fillSource: signoff("date") },
    { label: "File ref.", section: "For Ashcroft use only", guidance: "Ashcroft's own use – left blank.", answerType: "short_text", anchor: box(L.officeRef), fillSource: BLANK },
  ],
});
