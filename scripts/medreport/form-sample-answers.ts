/**
 * Completed answers for the bundled sample forms and the two demo cases – as they would stand after
 * drafting AND clinician review: answers drafted from the notes (origin "ai", cited), opinions the
 * clinician recorded (attributed, cited) and the opinions the clinician added at review where the
 * record holds none (origin "clinician", e.g. Megan Hart's prognosis). Used by the forms-engine tests and
 * by render-form-samples.ts to produce DRAFT and FINAL example files. Fictional data only.
 *
 * Owner: forms-engine agent.
 */
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { createFormReport } from "../../src/modules/medreport/core/report-factory";
import type { FormAnswer, FormDefinition, InstructingParty, Paragraph, Report } from "../../src/modules/medreport/core/types";
import { getDemoBundle, type DemoCaseSlug } from "./dev-bundles";

export const SAMPLE_NOW = new Date("2026-10-07T10:15:00.000Z");

type P = { text: string; sourceIds?: string[]; origin?: Paragraph["origin"]; basis?: Paragraph["basis"] };
export interface SampleAnswer {
  paragraphs: P[];
  answer?: FormAnswer;
  /** A gap the drafting raised for this question, already acknowledged by the clinician. */
  gap?: { issue: string; question: string; resolution: string };
}

const ai = (text: string, sourceIds: string[], basis: Paragraph["basis"] = "clinician_observed"): P => ({ text, sourceIds, origin: "ai", basis });
const clinician = (text: string): P => ({ text, origin: "clinician" });

/* ------------------------------------------------------------------------------------------------
 * Case A – Megan Hart
 * ----------------------------------------------------------------------------------------------*/

const MEGAN_MECHANISM = ai(
  "Ms Hart reported that on 12/03/2026 she was the restrained driver of a stationary car queuing at traffic lights when it was struck from behind by another car. The airbags did not deploy and she reported no head strike and no loss of consciousness. Neck stiffness came on the same evening and was worse on waking on 13/03/2026.",
  ["N-001"],
  "patient_reported",
);
const MEGAN_PRESENTING = [
  ai(
    "At the initial assessment on 18/03/2026 Ms Hart reported central and bilateral neck pain, worse on the left, spreading into both upper trapezius areas, with no arm pain, pins and needles or weakness. Pain was 7/10 at worst and 3/10 at best. She reported occipital headaches three to four times a week, each lasting 2–3 hours, and disturbed sleep.",
    ["N-001"],
    "patient_reported",
  ),
  ai(
    "Sarah Reid, physiotherapist, recorded reduced and painful neck movement (flexion 30°, extension 25°, left rotation 45°, right rotation 50°), tenderness of the upper trapezius and levator scapulae (left more than right) and a normal neurological examination. The Neck Disability Index was 42%. Her assessment was a whiplash-associated disorder grade II with a cervicogenic component to the headaches.",
    ["N-001", "FACT-outcomes-NDI"],
  ),
];
const MEGAN_TREATMENT = [
  ai(
    "Treatment comprised soft tissue massage of the upper trapezius and levator scapulae, mobilisation of the neck (central and unilateral PAs and SNAGs), sub-occipital release and thoracic extension mobilisation, weekly and then fortnightly.",
    ["N-001", "N-003", "N-004", "N-006"],
  ),
  ai(
    "A home exercise programme progressed from chin tucks and active rotation to deep neck flexor training, theraband rows and strengthening, with advice on staying active, workstation breaks, a graded return to driving and swimming technique.",
    ["N-001", "N-003", "N-006", "N-008"],
  ),
];
const MEGAN_CURRENT = [
  ai(
    "At the final review on 07/07/2026 Ms Hart reported occasional neck ache (2/10 at worst) after long days at the computer or drives of over an hour, and no pain on most days, with one mild headache in the previous three weeks. She was sleeping well, working full time on normal duties, driving without restriction and swimming twice a week.",
    ["N-010"],
    "patient_reported",
  ),
  ai(
    "Sarah Reid recorded full functional neck movement with a mild pull at end-range left rotation and a normal neurological examination. The Neck Disability Index improved from 42% (18/03/2026) to 24% (06/05/2026) and 12% (07/07/2026), and pain (NPRS) from 7/10 to 4/10 and 2/10.",
    ["N-010", "FACT-outcomes-NDI", "FACT-outcomes-NPRS"],
  ),
];
const MEGAN_FUNCTION = ai(
  "On 07/07/2026 Sarah Reid, physiotherapist, recorded that Ms Hart was working full time on normal duties, driving without restriction and swimming twice a week, with occasional neck ache after long days at the computer or drives of over an hour.",
  ["N-010"],
  "clinician_observed",
);
const MEGAN_RECOMMENDATIONS = ai(
  "On 07/07/2026 Sarah Reid, physiotherapist, discharged Ms Hart from active physiotherapy to self-management with a maintenance home exercise programme and workstation breaks every 30–45 minutes, and advised her to contact the clinic or her GP if her symptoms increase. No further supervised sessions were planned.",
  ["N-010"],
  "clinician_opinion_recorded",
);
const MEGAN_PROGNOSIS = clinician(
  "In my opinion Ms Hart has made a good recovery from a whiplash-associated disorder (grade II). I expect the remaining intermittent neck ache with prolonged sitting or driving to continue to settle with her maintenance exercises over the next three to six months, without further formal treatment.",
);

const MEGAN_HARROW: Record<string, SampleAnswer> = {
  "B1. Mechanism of injury": { paragraphs: [MEGAN_MECHANISM] },
  "B2. Presenting symptoms at initial assessment": { paragraphs: MEGAN_PRESENTING },
  "B3. Treatment provided to date": { paragraphs: MEGAN_TREATMENT },
  "B5. Current symptoms and progress": { paragraphs: MEGAN_CURRENT },
  "B6. Has the claimant reached maximum medical improvement?": {
    paragraphs: [clinician("Discharged to self-management on 07/07/2026; I do not expect further gains from supervised physiotherapy.")],
    answer: { kind: "yes_no", value: true },
  },
  "B7. Prognosis": { paragraphs: [MEGAN_PROGNOSIS] },
  "B8. Functional restrictions": { paragraphs: [MEGAN_FUNCTION] },
  "B9. Treatment recommendations": { paragraphs: [MEGAN_RECOMMENDATIONS] },
};

const MEGAN_NORTHFIELD: Record<string, SampleAnswer> = {
  "1. Diagnosis / working diagnosis": {
    paragraphs: [
      ai(
        "Whiplash-associated disorder grade II (Quebec Task Force) with a cervicogenic component to the headaches, recorded by Sarah Reid, physiotherapist, at the initial assessment on 18/03/2026 after a rear-end road traffic accident on 12/03/2026.",
        ["N-001"],
      ),
    ],
  },
  "2. Treatment to date and attendance": { paragraphs: MEGAN_TREATMENT },
  "Treatment completed – claimant discharged": {
    paragraphs: [ai("The discharge note of 07/07/2026 records discharge from active physiotherapy to self-management.", ["N-010"], "record")],
    answer: { kind: "checkbox", value: true },
  },
  "3. Functional limitations affecting work and daily activities": { paragraphs: [MEGAN_FUNCTION] },
  "4. Is the claimant fit for work?": {
    paragraphs: [clinician("Working full time on normal duties at discharge on 07/07/2026.")],
    answer: { kind: "choice", value: "Yes" },
  },
  "5. Recommended further treatment and estimated sessions": { paragraphs: [MEGAN_RECOMMENDATIONS] },
  "6. Expected recovery timescale (prognosis)": { paragraphs: [MEGAN_PROGNOSIS] },
};

/* ------------------------------------------------------------------------------------------------
 * Case B – Daniel Brooks
 * ----------------------------------------------------------------------------------------------*/

const DANIEL_DIAGNOSIS = [
  ai(
    "Mr Brooks reported that on 02/06/2026, during a night shift, he lifted a carton of approximately 20 kg from floor level onto a pallet while twisting to his right, with immediate low back pain.",
    ["N-001"],
    "patient_reported",
  ),
  ai(
    "At the initial assessment on 09/06/2026 Tom Ellis, physiotherapist, recorded acute non-specific mechanical low back pain following the lifting injury, with no red flags and no neurological signs.",
    ["N-001"],
  ),
];
const DANIEL_TREATMENT = [
  ai(
    "Mr Brooks attended 6 of 7 appointments between 09/06/2026 and 22/09/2026. One appointment, on 23/06/2026, was cancelled late because he was unable to attend after his first week back on amended night shifts.",
    ["FACT-attendance", "FACT-episode"],
    "record",
  ),
  ai(
    "Treatment comprised soft tissue massage and lumbar mobilisation, a progressive exercise programme moving to loaded strength work (kettlebell deadlift, goblet squat, side plank and suitcase carry), and education on manual handling technique, graded loading and pacing.",
    ["N-001", "N-003", "N-004", "N-005"],
  ),
];
const DANIEL_CAPACITY = [
  ai(
    "At the final review on 22/09/2026 Mr Brooks reported low back pain of 1–2/10 at worst after four nights of shifts, settling on rest days, with no flare-ups in the previous six weeks on amended duties that included occasional lifts up to 15 kg and no repetitive floor-level lifting. He reported being confident with his lifting technique.",
    ["N-006"],
    "patient_reported",
  ),
  ai(
    "Tom Ellis recorded full, pain-free lumbar movement in all directions and a normal neurological examination. The Oswestry Disability Index improved from 48% (09/06/2026) to 18% (22/09/2026). No formal functional capacity or lifting assessment is documented in the records.",
    ["N-006", "FACT-outcomes-ODI"],
  ),
];
const DANIEL_OPINION = "On 22/09/2026 Tom Ellis, physiotherapist, recorded that in his opinion Mr Brooks is fit for a phased return to normal duties over 2 weeks";

const DANIEL_KINGSWAY: Record<string, SampleAnswer> = {
  "1. Nature of the injury and diagnosis": { paragraphs: DANIEL_DIAGNOSIS },
  "2. Treatment provided to date, including the number of sessions attended": { paragraphs: DANIEL_TREATMENT },
  "3. Current functional capacity": {
    paragraphs: DANIEL_CAPACITY,
    gap: {
      issue: "No formal functional capacity or lifting assessment is documented.",
      question: "Was a formal lifting or functional capacity assessment carried out?",
      resolution: "No formal lifting assessment was carried out; the answer says so.",
    },
  },
  "4. In your opinion, is the employee fit to return to their normal duties?": {
    paragraphs: [ai(`${DANIEL_OPINION}.`, ["N-006"], "clinician_opinion_recorded")],
    answer: { kind: "yes_no", value: true },
  },
  "5. If not, are they fit for modified or restricted duties?": {
    paragraphs: [ai(`${DANIEL_OPINION}, so modified duties do not apply.`, ["N-006"], "clinician_opinion_recorded")],
    answer: { kind: "choice", value: "Not applicable" },
  },
  "6. Recommended adjustments or restrictions": {
    paragraphs: [
      ai(
        "On 22/09/2026 Tom Ellis, physiotherapist, recommended a phased return to normal duties over 2 weeks and that Mr Brooks should avoid repetitive lifting over 15 kg for 4 weeks.",
        ["N-006"],
        "clinician_opinion_recorded",
      ),
    ],
  },
  "7. Recommended return-to-work plan and timescale": {
    paragraphs: [
      ai(
        "Phased return to normal duties over 2 weeks, avoiding repetitive lifting over 15 kg for 4 weeks, with a review in 6 weeks, as recommended by Tom Ellis, physiotherapist, on 22/09/2026.",
        ["N-006"],
        "clinician_opinion_recorded",
      ),
    ],
  },
  "8. Is further treatment required? If so, please give details.": {
    paragraphs: [
      ai(
        "No further physiotherapy was planned: on 22/09/2026 Mr Brooks was discharged to self-management, continuing his gym programme two to three times a week and a maintenance home exercise programme, and was advised to contact the clinic if his symptoms recur.",
        ["N-006"],
        "clinician_opinion_recorded",
      ),
    ],
  },
  "9. When should the employee be reviewed?": {
    paragraphs: [ai("In 6 weeks, as recommended by Tom Ellis, physiotherapist, on 22/09/2026.", ["N-006"], "clinician_opinion_recorded")],
  },
};

const DANIEL_NORTHFIELD: Record<string, SampleAnswer> = {
  "1. Diagnosis / working diagnosis": { paragraphs: DANIEL_DIAGNOSIS },
  "2. Treatment to date and attendance": { paragraphs: DANIEL_TREATMENT },
  "Treatment completed – claimant discharged": {
    paragraphs: [ai("The discharge note of 22/09/2026 records discharge from active physiotherapy to self-management.", ["N-006"], "record")],
    answer: { kind: "checkbox", value: true },
  },
  "3. Functional limitations affecting work and daily activities": DANIEL_KINGSWAY["3. Current functional capacity"],
  "4. Is the claimant fit for work?": {
    paragraphs: [ai(`${DANIEL_OPINION}, avoiding repetitive lifting over 15 kg for 4 weeks.`, ["N-006"], "clinician_opinion_recorded")],
    answer: { kind: "choice", value: "Modified duties" },
  },
  "If modified duties, please give details": DANIEL_KINGSWAY["7. Recommended return-to-work plan and timescale"],
  "5. Recommended further treatment and estimated sessions": DANIEL_KINGSWAY["8. Is further treatment required? If so, please give details."],
  "6. Expected recovery timescale (prognosis)": {
    paragraphs: [clinician("I expect Mr Brooks to be back on full normal duties within 2 weeks and to remain symptom-free with his gym programme; review in 6 weeks as planned.")],
  },
};

/* ------------------------------------------------------------------------------------------------
 * Builder
 * ----------------------------------------------------------------------------------------------*/

const ANSWERS: Record<string, Record<string, SampleAnswer>> = {
  "megan-hart:harrow-pike-treating-physio": MEGAN_HARROW,
  "megan-hart:northfield-rehab-progress": MEGAN_NORTHFIELD,
  "daniel-brooks:kingsway-rtw-assessment": DANIEL_KINGSWAY,
  "daniel-brooks:northfield-rehab-progress": DANIEL_NORTHFIELD,
};

const NORTHFIELD_PARTY: InstructingParty = {
  type: "insurer",
  name: "Northfield Assurance (fictional)",
  reference: "NA-PI-77310",
  contactName: "Rehabilitation team",
  address: "",
};

export function instructingPartyFor(slug: DemoCaseSlug, form: FormDefinition): InstructingParty {
  if (form.sampleId === "northfield-rehab-progress") return NORTHFIELD_PARTY;
  const r = getDemoBundle(slug).referral;
  return { type: r.type, name: r.name, reference: r.reference, contactName: r.contactName, address: r.address };
}

/** A form report for a demo case with every drafted / reviewed answer filled in (ready to approve). */
export function completedSampleReport(slug: DemoCaseSlug, form: FormDefinition, opts: { id?: string } = {}): Report {
  const bundle = getDemoBundle(slug);
  const report = createFormReport({
    form,
    bundle,
    instructingParty: instructingPartyFor(slug, form),
    computedFacts: computeFacts(bundle, { asOf: "2026-10-07" }),
    now: SAMPLE_NOW,
    id: opts.id ?? `rpt_sample_${slug}_${form.sampleId}`,
  });
  // Staff checked any referral reference written into another organisation's form.
  for (const gap of report.gaps) {
    if (gap.raisedBy === "system" && gap.id.endsWith("-referrer")) {
      gap.resolution = { kind: "resolved", text: "Checked against the referral paperwork.", at: SAMPLE_NOW.toISOString() };
    }
  }
  const answers = ANSWERS[`${slug}:${form.sampleId}`] ?? {};
  for (const field of form.fields) {
    const sample = answers[field.label];
    const section = report.sections.find((s) => s.key === field.id);
    if (!sample || !section) continue;
    section.paragraphs = sample.paragraphs.map((p, i) => ({
      id: `${field.id}-p${i + 1}`,
      text: p.text,
      sourceIds: p.sourceIds ?? [],
      origin: p.origin ?? "ai",
      ...(p.basis && { basis: p.basis }),
    }));
    if (sample.answer) section.answer = sample.answer;
    section.status = "complete";
    if (sample.gap) {
      report.gaps.push({
        id: `gap-${field.id}-ai`,
        sectionKey: field.id,
        issue: sample.gap.issue,
        suggestedQuestion: sample.gap.question,
        relatedNoteIds: [],
        raisedBy: "ai",
        resolution: { kind: "acknowledged", text: sample.gap.resolution, at: SAMPLE_NOW.toISOString() },
      });
    }
  }
  return report;
}
