import "server-only";

/**
 * Pre-confirmed form map: Harrow & Pike Medico-Legal (fictional) – Treating Physiotherapist Report
 * (Form HPM-TP3, Word). Part A details table (answer cells), Part B question | answer table (two
 * placeholders in B4, ☐ Yes ☐ No in B6), Part C declaration table, office-use box (left blank).
 *
 * Owner: forms-engine agent.
 */
import type { FormDefinition } from "../../../core/types";
import {
  BLANK,
  NARRATIVE,
  OPINION,
  cell,
  placeholder,
  reg,
  sampleFormDefinition,
  sessionsAttended,
  sessionsMissed,
  signoff,
  ticks,
} from "./common";

const A = "Part A – Claimant details";
const B = "Part B – Clinical information";
const C = "Part C – Declaration";

export const HARROW_PIKE_FORM: FormDefinition = sampleFormDefinition({
  id: "frm_sample_harrow_pike_tp3",
  sampleId: "harrow-pike-treating-physio",
  referrer: { name: "Harrow & Pike Medico-Legal (fictional)", type: "mlc" },
  title: "Treating Physiotherapist Report",
  versionLabel: "HPM-TP3 v4.2 (03/2026)",
  fields: [
    { label: "Claimant name", section: A, guidance: "The claimant's full name as registered.", answerType: "short_text", anchor: cell("t1.r0.c1"), fillSource: reg("patient.fullName") },
    { label: "Date of birth", section: A, guidance: "The claimant's date of birth.", answerType: "date", anchor: cell("t1.r1.c1"), fillSource: reg("patient.dob") },
    { label: "Our reference", section: A, guidance: "The referrer's case reference from the referral.", answerType: "short_text", anchor: cell("t1.r2.c1"), fillSource: reg("referral.reference") },
    { label: "Date of accident", section: A, guidance: "Date of the accident from the referral / incident record.", answerType: "date", anchor: cell("t1.r3.c1"), fillSource: reg("incident.date") },
    { label: "Date of first assessment", section: A, guidance: "Date of the first attended appointment (initial assessment).", answerType: "date", anchor: cell("t1.r4.c1"), fillSource: reg("episode.firstSeen") },
    { label: "Date of last treatment", section: A, guidance: "Date of the last attended appointment.", answerType: "date", anchor: cell("t1.r5.c1"), fillSource: reg("episode.lastSeen") },
    {
      label: "B1. Mechanism of injury",
      section: B,
      guidance: "How the accident happened, as the claimant reported it at the initial assessment. Patient-reported history only.",
      answerType: "long_text",
      anchor: cell("t2.r1.c1"),
      fillSource: NARRATIVE,
    },
    {
      label: "B2. Presenting symptoms at initial assessment",
      section: B,
      guidance: "The symptoms reported and the main findings recorded at the initial assessment, including outcome scores taken then.",
      answerType: "long_text",
      anchor: cell("t2.r2.c1"),
      fillSource: NARRATIVE,
    },
    {
      label: "B3. Treatment provided to date",
      section: B,
      guidance: "The treatment given across the episode: manual therapy, exercise programme and advice, as recorded in the notes.",
      answerType: "long_text",
      anchor: cell("t2.r3.c1"),
      fillSource: NARRATIVE,
    },
    {
      label: "B4. Number of sessions attended",
      section: B,
      guidance: "Number of appointments attended (from the appointment record).",
      answerType: "number",
      anchor: placeholder("t2.r4.c1", "__________"),
      fillSource: sessionsAttended,
      note: "First of the two blanks in B4 (“Attended:”).",
    },
    {
      label: "B4. Number of sessions failed to attend",
      section: B,
      guidance: "Number of appointments the claimant did not attend (from the appointment record).",
      answerType: "number",
      anchor: placeholder("t2.r4.c1", "__________"),
      fillSource: sessionsMissed,
      note: "Second blank in B4 (“Failed to attend:”).",
    },
    {
      label: "B5. Current symptoms and progress",
      section: B,
      guidance: "Symptoms and function at the most recent appointment, and progress over the episode including outcome measures.",
      answerType: "long_text",
      anchor: cell("t2.r5.c1"),
      fillSource: NARRATIVE,
    },
    {
      label: "B6. Has the claimant reached maximum medical improvement?",
      section: B,
      guidance: "Clinical opinion. Answer only if a clinician recorded this; otherwise leave for the treating physiotherapist.",
      answerType: "yes_no",
      options: ["Yes", "No"],
      anchor: ticks("t2.r6.c1", ["Yes", "No"]),
      fillSource: OPINION,
    },
    {
      label: "B7. Prognosis",
      section: B,
      guidance: "Clinical opinion on the likely course of recovery and time to recovery. Only an opinion a clinician recorded, attributed to them; otherwise left for the clinician.",
      answerType: "long_text",
      anchor: cell("t2.r7.c1"),
      fillSource: OPINION,
    },
    {
      label: "B8. Functional restrictions",
      section: B,
      guidance: "Restrictions on work, domestic, social or leisure activities, as recorded by the treating clinician.",
      answerType: "long_text",
      anchor: cell("t2.r8.c1"),
      fillSource: OPINION,
    },
    {
      label: "B9. Treatment recommendations",
      section: B,
      guidance: "Whether further treatment is required, its type and number of sessions – the treating clinician's recorded plan or recommendation.",
      answerType: "long_text",
      anchor: cell("t2.r9.c1"),
      fillSource: OPINION,
    },
    { label: "Name", section: C, guidance: "Approving clinician's name (from the approval).", answerType: "clinician_name", anchor: cell("t3.r0.c1"), fillSource: signoff("name") },
    { label: "HCPC registration number", section: C, guidance: "Approving clinician's HCPC number.", answerType: "hcpc_number", anchor: cell("t3.r1.c1"), fillSource: signoff("hcpc") },
    { label: "Signature", section: C, guidance: "Electronic approval statement.", answerType: "signature", anchor: cell("t3.r2.c1"), fillSource: signoff("signature") },
    { label: "Date", section: C, guidance: "Date of approval.", answerType: "date_signed", anchor: cell("t3.r3.c1"), fillSource: signoff("date") },
    { label: "Date received (office use)", section: "For office use only", guidance: "For the referrer's office – not completed by the clinic.", answerType: "short_text", anchor: cell("t4.r1.c1"), fillSource: BLANK },
    { label: "Checked by (office use)", section: "For office use only", guidance: "For the referrer's office – not completed by the clinic.", answerType: "short_text", anchor: cell("t4.r1.c3"), fillSource: BLANK },
  ],
});
