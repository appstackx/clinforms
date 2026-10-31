/**
 * Outcome questionnaires a patient answers in the portal (pure, browser-safe): the records module's measures
 * (src/modules/pms/records/outcomes.ts – NDI, ODI, NPRS, PSFS, QuickDASH) turned into a form of one-choice
 * questions, and the patient's answers turned back into the records module's item scores, which the records module
 * scores (the same arithmetic as when a clinician enters them).
 *
 * WORDING (Q-K8): the app holds no licensed questionnaire text. A question is the measure's section topic (the
 * records module's labels, or the design's short topic for QuickDASH) with a plain answer scale written for the
 * product. Until the clinic's licences are checked, a score from the portal is labelled "from the patient's
 * portal" so the clinician knows the wording differed from the paper form.
 */
import { MEASURES, type OutcomeAnswers, type OutcomeMeasureId } from "../records/outcomes";
import type { Answers, FormDefinition, FormField } from "./forms";

/** Topics the patient reads for the QuickDASH items (the records module holds item numbers only). */
const QUICKDASH_TOPICS = [
  "Opening a tight or new jar",
  "Heavy household chores",
  "Carrying a shopping bag or briefcase",
  "Washing your back",
  "Using a knife to cut food",
  "Activities that take some force or impact through your arm, shoulder or hand",
  "How much your arm, shoulder or hand problem affected your social activities",
  "How much it limited your work or other daily activities",
  "Arm, shoulder or hand pain",
  "Tingling (pins and needles) in your arm, shoulder or hand",
  "Difficulty sleeping because of the pain",
];

const DIFFICULTY_0_5 = ["No problem", "A little difficult", "Quite difficult", "Very difficult", "I need a lot of help", "I can't do this at all"];
const DIFFICULTY_1_5 = ["No difficulty", "Mild difficulty", "Moderate difficulty", "Severe difficulty", "Unable"];
const SEVERITY_1_5 = ["None", "Mild", "Moderate", "Severe", "Extreme"];
const PAIN_0_10 = Array.from({ length: 11 }, (_, i) => (i === 0 ? "0 – no pain" : i === 10 ? "10 – worst pain imaginable" : String(i)));
const ABILITY_0_10 = Array.from({ length: 11 }, (_, i) => (i === 0 ? "0 – I can't do it" : i === 10 ? "10 – as well as before the problem" : String(i)));

/** The patient-facing title of each measure (no licensed names on the patient's screen are needed). */
export const OUTCOME_FORM_TITLES: Readonly<Record<OutcomeMeasureId, string>> = {
  odi: "Back pain questionnaire",
  ndi: "Neck pain questionnaire",
  nprs: "Pain rating",
  psfs: "Everyday activities",
  quickdash: "Arm, shoulder and hand questionnaire",
};

export interface OutcomeFormOptions {
  /** PSFS: the activities the patient named at the first visit (3–5), from the latest PSFS on the record. */
  psfsActivities?: readonly { key: string; name: string }[];
}

function scaleFor(measure: OutcomeMeasureId, index: number): readonly string[] {
  if (measure === "odi" || measure === "ndi") return DIFFICULTY_0_5;
  if (measure === "nprs") return PAIN_0_10;
  if (measure === "psfs") return ABILITY_0_10;
  return index >= 8 ? SEVERITY_1_5 : DIFFICULTY_1_5;
}

/** Whether a measure can be sent to the patient now (PSFS needs the activities named at the first visit). */
export function outcomeFormProblem(measure: OutcomeMeasureId, options: OutcomeFormOptions = {}): string | null {
  if (measure === "psfs" && (options.psfsActivities ?? []).length < 3) {
    return "The PSFS needs the activities the patient named at the first visit – record a PSFS in clinic first.";
  }
  return null;
}

/**
 * The form the patient answers. Field ids are the records module's item keys, so answers map back one to one.
 * ODI's sex-life section is optional (as the design shows); NDI and ODI may leave at most two sections out.
 */
export function outcomeQuestionnaire(measure: OutcomeMeasureId, options: OutcomeFormOptions = {}): FormDefinition {
  const def = MEASURES[measure];
  if (measure === "psfs") {
    const activities = (options.psfsActivities ?? []).slice(0, 5);
    return {
      fields: activities.map((a) => ({ id: a.key, type: "choice", label: a.name, help: "How well can you do this today?", required: true, options: [...ABILITY_0_10], sensitive: true })),
    };
  }
  const fields: FormField[] = def.items.map((item, i) => {
    const label = measure === "quickdash" ? QUICKDASH_TOPICS[i] : measure === "nprs" ? "How bad is your pain right now?" : item.label;
    const optional = measure === "odi" && item.key === "s8";
    return {
      id: item.key,
      type: "choice",
      label: optional ? `${label} (optional – you can skip this one)` : label,
      required: !optional,
      options: [...scaleFor(measure, i)],
      sensitive: true,
    };
  });
  return { fields };
}

/** The patient's answers (option texts) as the records module's item scores (and PSFS activity names). */
export function outcomeAnswersFrom(measure: OutcomeMeasureId, form: FormDefinition, answers: Answers): OutcomeAnswers {
  const def = MEASURES[measure];
  const items: Record<string, number | null> = {};
  const activities: Record<string, string> = {};
  for (const item of def.items) items[item.key] = null;
  for (const field of form.fields) {
    if (!(field.id in items)) continue;
    const value = answers[field.id];
    const index = typeof value === "string" ? (field.options ?? []).indexOf(value) : -1;
    items[field.id] = index < 0 ? null : def.min + index;
    if (measure === "psfs") activities[field.id] = field.label;
  }
  if (measure !== "psfs") return { items };
  // Unnamed PSFS slots stay empty (the scorer refuses a rating without a name).
  for (const key of Object.keys(items)) if (!(key in activities)) delete items[key];
  return { items, activities };
}
