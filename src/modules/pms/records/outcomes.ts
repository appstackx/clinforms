/**
 * Outcome measures (pure): what is asked, how it is scored, and the score bands shown on screen.
 *
 * The questionnaires themselves are the authors' and publishers' work: the app holds only section topics or item
 * numbers, never the question or answer wording. The clinician uses the clinic's licensed questionnaire and enters
 * the patient's answers (0–5, 1–5 or 0–10 per item); the app does the arithmetic.
 *
 * Scores are stored ×10 as whole numbers (score_tenths: 42.5 % → 425) so both databases hold the same integer.
 *
 *   NDI (Neck Disability Index)          10 sections 0–5 → % of the maximum for the sections answered
 *                                         (at most 2 unanswered); bands after Vernon: 0–8 none, 10–28 mild,
 *                                         30–48 moderate, 50–68 severe, 70+ complete (as %).
 *   ODI (Oswestry Disability Index)      10 sections 0–5 → % of the maximum for the sections answered (at most 2
 *                                         unanswered); bands after Fairbank: 0–20 minimal, 21–40 moderate,
 *                                         41–60 severe, 61–80 very severe, 81–100 bed-bound or overstated.
 *   NPRS (numeric pain rating)           one rating 0–10; 0 none, 1–3 mild, 4–6 moderate, 7–10 severe.
 *   PSFS (Patient-Specific Functional    3–5 activities the patient names, each 0–10 (10 = able as before) →
 *         Scale)                          the average. HIGHER IS BETTER.
 *   QuickDASH                            11 items 1–5 (at least 10 answered) → ((sum ÷ answered) − 1) × 25.
 * Lower is better for every measure except the PSFS.
 */
import { z } from "zod";

export const OUTCOME_MEASURES = ["ndi", "odi", "nprs", "psfs", "quickdash"] as const;
export type OutcomeMeasureId = (typeof OUTCOME_MEASURES)[number];
export const OutcomeMeasureIdSchema = z.enum(OUTCOME_MEASURES);

export interface MeasureItem {
  key: string;
  label: string;
}

export interface MeasureDefinition {
  id: OutcomeMeasureId;
  /** Short name on screen. */
  short: string;
  name: string;
  /** What the clinician does. */
  instructions: string;
  /** Item answers: lowest and highest allowed whole numbers. */
  min: number;
  max: number;
  items: readonly MeasureItem[];
  /** How many items may be left unanswered and still give a score. */
  maxMissing: number;
  /** "percent" = 0–100 %, "points" = a 0–10 or 0–100 scale. */
  unit: "percent" | "points";
  /** Highest possible score (for charts). */
  scoreMax: number;
  higherIsBetter: boolean;
  /** PSFS: the patient names the activities (free text, encrypted). */
  namedActivities?: { min: number; max: number };
}

const sections = (labels: string[]): MeasureItem[] => labels.map((label, i) => ({ key: `s${i + 1}`, label }));

export const MEASURES: Readonly<Record<OutcomeMeasureId, MeasureDefinition>> = {
  ndi: {
    id: "ndi",
    short: "NDI",
    name: "Neck Disability Index",
    instructions: "Enter the score the patient gave for each section (0–5) from the clinic's questionnaire. Leave a section empty if it was not answered.",
    min: 0,
    max: 5,
    items: sections(["Pain intensity", "Personal care", "Lifting", "Reading", "Headaches", "Concentration", "Work", "Driving", "Sleeping", "Recreation"]),
    maxMissing: 2,
    unit: "percent",
    scoreMax: 100,
    higherIsBetter: false,
  },
  odi: {
    id: "odi",
    short: "ODI",
    name: "Oswestry Disability Index",
    instructions: "Enter the score the patient gave for each section (0–5) from the clinic's questionnaire. Leave a section empty if it was not answered.",
    min: 0,
    max: 5,
    items: sections(["Pain intensity", "Personal care", "Lifting", "Walking", "Sitting", "Standing", "Sleeping", "Sex life", "Social life", "Travelling"]),
    maxMissing: 2,
    unit: "percent",
    scoreMax: 100,
    higherIsBetter: false,
  },
  nprs: {
    id: "nprs",
    short: "NPRS",
    name: "Numeric pain rating",
    instructions: "The patient's pain from 0 (no pain) to 10 (worst pain imaginable).",
    min: 0,
    max: 10,
    items: [{ key: "pain", label: "Pain now" }],
    maxMissing: 0,
    unit: "points",
    scoreMax: 10,
    higherIsBetter: false,
  },
  psfs: {
    id: "psfs",
    short: "PSFS",
    name: "Patient-Specific Functional Scale",
    instructions: "Up to five activities the patient finds hard, each rated from 0 (unable to do it) to 10 (able to do it as before the problem). Use the same activities at every review.",
    min: 0,
    max: 10,
    items: [
      { key: "a1", label: "Activity 1" },
      { key: "a2", label: "Activity 2" },
      { key: "a3", label: "Activity 3" },
      { key: "a4", label: "Activity 4" },
      { key: "a5", label: "Activity 5" },
    ],
    maxMissing: 2,
    unit: "points",
    scoreMax: 10,
    higherIsBetter: true,
    namedActivities: { min: 3, max: 5 },
  },
  quickdash: {
    id: "quickdash",
    short: "QuickDASH",
    name: "QuickDASH (arm, shoulder and hand)",
    instructions: "Enter the patient's answer to each of the 11 items (1–5) from the clinic's licensed questionnaire. At least 10 items must be answered.",
    min: 1,
    max: 5,
    items: Array.from({ length: 11 }, (_, i) => ({ key: `q${i + 1}`, label: `Item ${i + 1}` })),
    maxMissing: 1,
    unit: "points",
    scoreMax: 100,
    higherIsBetter: false,
  },
};

/** Answers as entered: item key → whole number or null (not answered). PSFS also names its activities. */
export interface OutcomeAnswers {
  items: Record<string, number | null>;
  /** PSFS only: item key → the activity in the patient's words. */
  activities?: Record<string, string>;
}

export type ScoreResult =
  | { ok: true; score: number; scoreTenths: number; answered: number; band: string | null }
  | { ok: false; error: string };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percentBand(id: "ndi" | "odi", pct: number): string {
  if (id === "ndi") {
    if (pct < 10) return "No disability";
    if (pct < 30) return "Mild";
    if (pct < 50) return "Moderate";
    if (pct < 70) return "Severe";
    return "Complete";
  }
  if (pct <= 20) return "Minimal";
  if (pct <= 40) return "Moderate";
  if (pct <= 60) return "Severe";
  if (pct <= 80) return "Very severe";
  return "Bed-bound, or symptoms overstated";
}

function painBand(n: number): string {
  if (n === 0) return "No pain";
  if (n <= 3) return "Mild";
  if (n <= 6) return "Moderate";
  return "Severe";
}

/** Scores a set of answers (validation included: the error says what to fix). */
export function scoreOutcome(id: OutcomeMeasureId, answers: OutcomeAnswers): ScoreResult {
  const def = MEASURES[id];
  if (!def) return { ok: false, error: "Unknown measure." };
  const values: number[] = [];
  for (const key of Object.keys(answers.items)) {
    if (!def.items.some((i) => i.key === key)) return { ok: false, error: `Unknown item "${key}".` };
  }
  for (const item of def.items) {
    const v = answers.items[item.key];
    if (v === null || v === undefined) continue;
    if (!Number.isInteger(v) || v < def.min || v > def.max) return { ok: false, error: `${item.label}: enter a whole number from ${def.min} to ${def.max}.` };
    values.push(v);
  }
  if (id === "psfs") {
    const named = def.items.filter((i) => (answers.activities?.[i.key] ?? "").trim() !== "");
    for (const item of def.items) {
      const hasName = (answers.activities?.[item.key] ?? "").trim() !== "";
      const v = answers.items[item.key];
      if (hasName && (v === null || v === undefined)) return { ok: false, error: `${item.label}: rate the activity from 0 to 10.` };
      if (!hasName && v !== null && v !== undefined) return { ok: false, error: `${item.label}: name the activity.` };
    }
    if (named.length < (def.namedActivities?.min ?? 3)) return { ok: false, error: "Name at least three activities and rate each one." };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const score = round1(mean);
    return { ok: true, score, scoreTenths: Math.round(score * 10), answered: values.length, band: null };
  }
  const missing = def.items.length - values.length;
  if (missing > def.maxMissing) {
    return { ok: false, error: def.maxMissing === 0 ? "Enter the rating." : `Too many items left empty: at most ${def.maxMissing} may be unanswered.` };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  if (id === "nprs") {
    return { ok: true, score: sum, scoreTenths: sum * 10, answered: 1, band: painBand(sum) };
  }
  if (id === "quickdash") {
    const score = round1((sum / values.length - 1) * 25);
    return { ok: true, score, scoreTenths: Math.round(score * 10), answered: values.length, band: null };
  }
  const pct = round1((sum / (def.max * values.length)) * 100);
  return { ok: true, score: pct, scoreTenths: Math.round(pct * 10), answered: values.length, band: percentBand(id, pct) };
}

/** "42 %", "6/10", "34.1" – the score as shown. */
export function formatScore(id: OutcomeMeasureId, scoreTenths: number): string {
  const v = scoreTenths / 10;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
  const def = MEASURES[id];
  if (def.unit === "percent") return `${text}%`;
  if (def.scoreMax === 10) return `${text}/10`;
  return `${text}/${def.scoreMax}`;
}

export type ChangeDirection = "better" | "worse" | "same";

/** Change from an earlier score to a later one, in the measure's own direction. */
export function outcomeChange(id: OutcomeMeasureId, fromTenths: number, toTenths: number): { deltaTenths: number; direction: ChangeDirection } {
  const delta = toTenths - fromTenths;
  if (delta === 0) return { deltaTenths: 0, direction: "same" };
  const better = MEASURES[id].higherIsBetter ? delta > 0 : delta < 0;
  return { deltaTenths: delta, direction: better ? "better" : "worse" };
}

/** Input of a recorded measure (the repository scores it again – never trusts a client's score). */
export const OutcomeInputSchema = z.object({
  patientId: z.string().min(1),
  caseId: z.union([z.string().min(1), z.null()]).optional(),
  noteId: z.union([z.string().min(1), z.null()]).optional(),
  measure: OutcomeMeasureIdSchema,
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD"),
  answers: z.object({
    items: z.record(z.string().regex(/^[a-z0-9]{1,8}$/), z.union([z.number(), z.null()])),
    activities: z.record(z.string().regex(/^[a-z0-9]{1,8}$/), z.string().trim().max(120, "At most 120 characters per activity")).optional(),
  }),
});
export type OutcomeInput = z.input<typeof OutcomeInputSchema>;

/** Form values ("3", "", …) → answers. Unparseable text stays as NaN so the scorer reports it. */
export function answersFromForm(id: OutcomeMeasureId, read: (name: string) => string | null): OutcomeAnswers {
  const def = MEASURES[id];
  const items: Record<string, number | null> = {};
  const activities: Record<string, string> = {};
  for (const item of def.items) {
    const raw = (read(`item_${item.key}`) ?? "").trim();
    items[item.key] = raw === "" ? null : /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (def.namedActivities) {
      const name = (read(`activity_${item.key}`) ?? "").trim();
      if (name) activities[item.key] = name.slice(0, 120);
    }
  }
  return def.namedActivities ? { items, activities } : { items };
}

export interface OutcomePoint {
  id: string;
  takenOn: string;
  scoreTenths: number;
  band: string | null;
  caseId: string | null;
}

/** One measure over time for one patient: the points (oldest first) and the change from the first to the latest. */
export interface OutcomeSeries {
  measure: OutcomeMeasureId;
  short: string;
  scoreMax: number;
  higherIsBetter: boolean;
  points: OutcomePoint[];
  first: OutcomePoint;
  latest: OutcomePoint;
  change: { deltaTenths: number; direction: ChangeDirection };
}

/**
 * Groups recorded scores into one series per measure (measures in their fixed order, points by date then id).
 * Scores marked "entered in error" are left out. `caseId` limits the series to one case (episode).
 */
export function outcomeSeries(
  rows: readonly { id: string; measure: OutcomeMeasureId; takenOn: string; scoreTenths: number; band: string | null; caseId: string | null; status: "recorded" | "entered_in_error" }[],
  options: { caseId?: string | null } = {},
): OutcomeSeries[] {
  const out: OutcomeSeries[] = [];
  for (const measure of OUTCOME_MEASURES) {
    const points = rows
      .filter((r) => r.measure === measure && r.status === "recorded" && (options.caseId === undefined || r.caseId === options.caseId))
      .map((r) => ({ id: r.id, takenOn: r.takenOn, scoreTenths: r.scoreTenths, band: r.band, caseId: r.caseId }))
      .sort((a, b) => (a.takenOn === b.takenOn ? (a.id < b.id ? -1 : 1) : a.takenOn < b.takenOn ? -1 : 1));
    if (points.length === 0) continue;
    const def = MEASURES[measure];
    const first = points[0];
    const latest = points[points.length - 1];
    out.push({ measure, short: def.short, scoreMax: def.scoreMax, higherIsBetter: def.higherIsBetter, points, first, latest, change: outcomeChange(measure, first.scoreTenths, latest.scoreTenths) });
  }
  return out;
}
