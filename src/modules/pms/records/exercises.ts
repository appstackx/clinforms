/**
 * Home exercise programmes (tracker ex03–ex06) – the pure rules: the platform switch, the clinic library's and a
 * programme's inputs, the dose line, check-ins and the adherence summary. Browser-safe (the builder and the portal
 * use the same schemas and words). Docs: docs/clinic-system/exercise-programmes.md.
 *
 * Off unless BOTH the platform switch CLINFORMS_EXERCISE=on AND the clinic's own setting (pms_exercise_settings,
 * Set-up → Exercises) are on. Off: the record tab, the set-up entry and the portal section are left out and every
 * page and action answers "not found".
 *
 * - The library is the clinic's OWN (name, instructions, cautions, an optional picture link and video link). No
 *   third-party library or content ships with the product; demo clinics can load a few fictional, generic entries
 *   (DEMO_EXERCISES – marked "(demo)").
 * - A programme copies what it uses from the library (a snapshot): editing the library later never changes what a
 *   patient was given. Draft → shared (in the portal, printable, locked) → ended. A change to a shared programme is a
 *   new version that replaces it when shared.
 * - Links are https only and shown as links ("opens another site") – never embedded, so nothing about the patient
 *   reaches another site unless they choose to open it.
 */
import { z } from "zod";
import { PmsIdSchema } from "../core/schemas";

type Env = Readonly<Record<string, string | undefined>>;

export const EXERCISE_ENV = "CLINFORMS_EXERCISE";

/** The platform switch: "on" (any case, trimmed) – anything else is off. */
export function exerciseSwitchOn(env: Env): boolean {
  return (
    String(env[EXERCISE_ENV] ?? "")
      .trim()
      .toLowerCase() === "on"
  );
}

export const EXERCISE_OFF_MESSAGE = "Exercise programmes are not switched on for this clinic.";

export const MAX_PROGRAMME_ITEMS = 30;
export const MAX_LIBRARY_EXERCISES = 500;
export const MAX_CHECKIN_COMMENT = 500;

/** Body areas offered in the library form (free text is not needed for a filter this small). */
export const BODY_AREAS = ["Neck", "Shoulder", "Elbow and wrist", "Hand", "Upper back", "Lower back", "Hip", "Knee", "Ankle and foot", "Whole body", "Balance", "Breathing"] as const;

const squash = (v: string) => v.replace(/[ \t]+/g, " ").trim();

/** Optional text: trimmed; "" → null; at most `max` characters. */
const optional = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() || null : null))
    .refine((v) => v === null || v.length <= max, `At most ${max} characters`);

const required = (max: number, message: string) =>
  z
    .string({ error: message })
    .transform(squash)
    .refine((v) => v.length > 0, message)
    .refine((v) => v.length <= max, `At most ${max} characters`);

/**
 * An optional https link (a picture or video the clinic hosts elsewhere, e.g. an unlisted video). Refused: anything
 * but https, user names or passwords in the link, more than 500 characters. Stored as the parsed address.
 */
export const LinkSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return null;
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full link starting https://" });
      return z.NEVER;
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "Only https:// links, without a user name or password" });
      return z.NEVER;
    }
    const href = url.href;
    if (href.length > 500) {
      ctx.addIssue({ code: "custom", message: "At most 500 characters" });
      return z.NEVER;
    }
    return href;
  });

export const BodyAreaSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : null))
  .refine((v) => v === null || (BODY_AREAS as readonly string[]).includes(v), "Choose a body area from the list");

/** One exercise of the clinic's library (Set-up → Exercises). */
export const LibraryExerciseInputSchema = z.object({
  name: required(120, "Name the exercise"),
  bodyArea: BodyAreaSchema,
  instructions: optional(2000),
  cautions: optional(1000),
  imageUrl: LinkSchema,
  videoUrl: LinkSchema,
});
export type LibraryExerciseInput = z.input<typeof LibraryExerciseInputSchema>;
export type LibraryExerciseValues = z.output<typeof LibraryExerciseInputSchema>;

export interface LibraryExercise {
  id: string;
  rev: number;
  name: string;
  bodyArea: string | null;
  instructions: string | null;
  cautions: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  active: boolean;
  updatedAt: string;
}

/** A whole number in [min, max], or null (blank). Accepts numbers and the strings a form sends. */
const dose = (min: number, max: number, what: string) =>
  z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = typeof v === "number" ? v : Number(v.trim());
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${what}: a whole number from ${min} to ${max}` });
        return z.NEVER;
      }
      return n;
    });

/** One exercise in a patient's programme: a copy of a library entry (or the clinician's own), with the dose. */
export const ProgrammeItemSchema = z.object({
  /** The library entry it was copied from (null = written for this programme only). Never read back from the library. */
  exerciseId: z.union([PmsIdSchema, z.null()]).optional().transform((v) => v ?? null),
  name: required(120, "Name the exercise"),
  instructions: optional(2000),
  cautions: optional(1000),
  imageUrl: LinkSchema,
  videoUrl: LinkSchema,
  sets: dose(1, 20, "Sets"),
  reps: dose(1, 100, "Repetitions"),
  holdSeconds: dose(1, 600, "Hold (seconds)"),
  timesPerDay: dose(1, 10, "Times a day"),
  daysPerWeek: dose(1, 7, "Days a week"),
  notes: optional(500),
});
export type ProgrammeItemInput = z.input<typeof ProgrammeItemSchema>;
export type ProgrammeItem = z.output<typeof ProgrammeItemSchema>;

export const ProgrammeInputSchema = z.object({
  title: required(120, "Give the programme a title"),
  notes: optional(2000),
  caseId: z
    .union([PmsIdSchema, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  items: z.array(ProgrammeItemSchema).max(MAX_PROGRAMME_ITEMS, `At most ${MAX_PROGRAMME_ITEMS} exercises`),
});
export type ProgrammeInput = z.input<typeof ProgrammeInputSchema>;
export type ProgrammeValues = z.output<typeof ProgrammeInputSchema>;

export const PROGRAMME_STATUSES = ["draft", "shared", "ended"] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

export const PROGRAMME_STATUS_LABELS: Readonly<Record<ProgrammeStatus, string>> = { draft: "Draft", shared: "Shared with the patient", ended: "Ended" };

export interface ProgrammeSummary {
  id: string;
  rev: number;
  patientId: string;
  caseId: string | null;
  replacesId: string | null;
  status: ProgrammeStatus;
  /** Decrypted (null once anonymised). */
  title: string | null;
  itemCount: number;
  sharedAt: string | null;
  sharedByName: string | null;
  endedAt: string | null;
  patientViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseProgramme extends ProgrammeSummary {
  notes: string | null;
  items: ProgrammeItem[];
}

export const CheckinInputSchema = z.object({
  completed: z.boolean({ error: "Say whether you did your exercises" }),
  painScore: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10) {
        ctx.addIssue({ code: "custom", message: "Choose a number from 0 to 10" });
        return z.NEVER;
      }
      return n;
    }),
  comment: optional(MAX_CHECKIN_COMMENT),
});
export type CheckinInput = z.input<typeof CheckinInputSchema>;

export interface ExerciseCheckin {
  id: string;
  rev: number;
  programmeId: string;
  patientId: string;
  /** UK date, "YYYY-MM-DD". */
  doneOn: string;
  completed: boolean;
  painScore: number | null;
  /** Decrypted; null when none was written (or for lists that do not decrypt). */
  comment: string | null;
  updatedAt: string;
}

/** "3 sets × 10 reps · hold 5 s · 2 times a day · 5 days a week" (only what is filled in). */
export function doseLine(item: Pick<ProgrammeItem, "sets" | "reps" | "holdSeconds" | "timesPerDay" | "daysPerWeek">): string {
  const parts: string[] = [];
  const setsReps = [item.sets ? `${item.sets} ${item.sets === 1 ? "set" : "sets"}` : null, item.reps ? `${item.reps} ${item.reps === 1 ? "rep" : "reps"}` : null].filter(Boolean).join(" × ");
  if (setsReps) parts.push(setsReps);
  if (item.holdSeconds) parts.push(`hold ${item.holdSeconds} s`);
  if (item.timesPerDay) parts.push(item.timesPerDay === 1 ? "once a day" : `${item.timesPerDay} times a day`);
  if (item.daysPerWeek) parts.push(item.daysPerWeek === 7 ? "every day" : `${item.daysPerWeek} ${item.daysPerWeek === 1 ? "day" : "days"} a week`);
  return parts.join(" · ");
}

/** A programme item from a library entry (the clinician then sets the dose). */
export function itemFromLibrary(e: Pick<LibraryExercise, "id" | "name" | "instructions" | "cautions" | "imageUrl" | "videoUrl">): ProgrammeItem {
  return { exerciseId: e.id, name: e.name, instructions: e.instructions, cautions: e.cautions, imageUrl: e.imageUrl, videoUrl: e.videoUrl, sets: null, reps: null, holdSeconds: null, timesPerDay: null, daysPerWeek: null, notes: null };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Adherence {
  /** The window, in days, ending today. */
  days: number;
  /** Days in the window with a check-in. */
  checkins: number;
  /** …of which the patient did the exercises. */
  completed: number;
  lastOn: string | null;
  latestPain: number | null;
  /** Average pain over the window's check-ins with a score, one decimal; null = none. */
  averagePain: number | null;
}

/** What the clinician sees about a programme's check-ins over the last `days` days (today included). */
export function adherenceSummary(checkins: readonly Pick<ExerciseCheckin, "doneOn" | "completed" | "painScore">[], today: string, days = 14): Adherence {
  const from = addDays(today, -(days - 1));
  const sorted = checkins.slice().sort((a, b) => b.doneOn.localeCompare(a.doneOn));
  const inWindow = sorted.filter((c) => c.doneOn >= from && c.doneOn <= today);
  const scored = inWindow.filter((c) => c.painScore !== null);
  const latestScored = sorted.find((c) => c.painScore !== null);
  return {
    days,
    checkins: inWindow.length,
    completed: inWindow.filter((c) => c.completed).length,
    lastOn: sorted[0]?.doneOn ?? null,
    latestPain: latestScored?.painScore ?? null,
    averagePain: scored.length ? Math.round((scored.reduce((n, c) => n + (c.painScore ?? 0), 0) / scored.length) * 10) / 10 : null,
  };
}

/** "Did it on 5 of the last 14 days" (null when no check-in at all). */
export function adherenceLine(a: Adherence): string | null {
  if (a.lastOn === null) return null;
  return `Did the exercises on ${a.completed} of the last ${a.days} days (${a.checkins} check-in${a.checkins === 1 ? "" : "s"})`;
}

/**
 * Fictional, generic starter entries for DEMONSTRATION clinics only (Set-up → Exercises → "Add demo exercises" on a
 * demo clinic). Written for this product, deliberately plain, each marked "(demo)": a clinic writes and checks its
 * own instructions before using any of them with a patient.
 */
export const DEMO_EXERCISES: readonly LibraryExerciseValues[] = [
  {
    name: "Seated knee straightening (demo)",
    bodyArea: "Knee",
    instructions: "Sit tall on a firm chair. Slowly straighten one knee until the leg is level, hold, then lower it slowly. Repeat on the other side if advised.",
    cautions: "Demo text – the clinic checks and replaces it before use.",
    imageUrl: null,
    videoUrl: null,
  },
  {
    name: "Heel raises at a counter (demo)",
    bodyArea: "Ankle and foot",
    instructions: "Stand facing a kitchen counter, hands resting on it. Rise up onto your toes, pause, then lower slowly.",
    cautions: "Demo text – the clinic checks and replaces it before use.",
    imageUrl: null,
    videoUrl: null,
  },
  {
    name: "Lying bridge (demo)",
    bodyArea: "Lower back",
    instructions: "Lie on your back with knees bent and feet flat. Tighten your tummy and lift your hips a little way, hold, then lower.",
    cautions: "Demo text – the clinic checks and replaces it before use.",
    imageUrl: null,
    videoUrl: null,
  },
  {
    name: "Shoulder blade squeeze (demo)",
    bodyArea: "Upper back",
    instructions: "Sit or stand tall. Gently draw your shoulder blades back and together, hold, then relax.",
    cautions: "Demo text – the clinic checks and replaces it before use.",
    imageUrl: null,
    videoUrl: null,
  },
  {
    name: "Chin tuck (demo)",
    bodyArea: "Neck",
    instructions: "Sit tall looking straight ahead. Slide your chin straight back, as if making a double chin, hold, then relax.",
    cautions: "Demo text – the clinic checks and replaces it before use.",
    imageUrl: null,
    videoUrl: null,
  },
  {
    name: "Supported single-leg stand (demo)",
    bodyArea: "Balance",
    instructions: "Stand beside a counter with one hand on it. Lift one foot a little and hold your balance, then swap.",
    cautions: "Demo text – the clinic checks and replaces it before use.",
    imageUrl: null,
    videoUrl: null,
  },
];
