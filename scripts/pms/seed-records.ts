/**
 * Demonstration clinical records for the demo clinic (contract §9): signed and unsigned clinical notes (initial SOAP,
 * follow-ups, discharge summaries), one amendment, body charts and outcome measures over time (NPRS, NDI, ODI,
 * QuickDASH, PSFS) – written for the cases the foundation's demo seed created (scripts/pms/seed-lib.ts), through the
 * records repositories (validation, encryption, audit). Fictional text only.
 *
 * Safety and re-runs:
 *   - refuses a clinic that is not flagged as a demonstration clinic (pms_settings.is_demo);
 *   - idempotent: every row carries an import reference "seed-rec-…"; a second run adds only what is missing (nothing,
 *     normally) and never changes or duplicates a note.
 *
 * Wired into `npm run pms:seed-demo` by the orchestrator (scripts/pms/seed-demo.ts, after seedDemoClinic):
 *   await seedRecords(ctx, slug, { now, log: (line) => console.log(`  ${line}`) });
 */
import { ukToday } from "../../src/modules/pms/core/text";
import type { CaseSummary } from "../../src/modules/pms/core/types";
import type { BodyChart } from "../../src/modules/pms/records/body-chart";
import type { OutcomeInput } from "../../src/modules/pms/records/outcomes";
import { RED_FLAG_OPTIONS } from "../../src/modules/pms/records/templates";
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { listCasesForPatient } from "../../src/server/repos/pms/cases";
import { listPractitioners } from "../../src/server/repos/pms/directory";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { addAmendment, bulkImportNotes, getNote, type ImportNoteInput } from "../../src/server/repos/pms/records/notes";
import { bulkRecordOutcomes } from "../../src/server/repos/pms/records/outcomes";
import { SEED_ACTOR } from "./seed-lib";
import { pmsNow } from "../../src/modules/pms/core/clock";

export interface SeedRecordsOptions {
  /** How many of the demo patients (by patient number) get notes. Default 40. */
  patients?: number;
  now?: Date;
  log?: (line: string) => void;
}

export interface SeedRecordsSummary {
  notes: number;
  signed: number;
  drafts: number;
  amendments: number;
  outcomes: number;
  /** Rows already there from an earlier run (left as they were). */
  skipped: number;
}

const REF = "seed-rec-";

type Area = "neck" | "back" | "shoulder" | "knee" | "ankle" | "other";

function areaOf(title: string): Area {
  const t = title.toLowerCase();
  if (/neck|whiplash|cervical|headache/.test(t)) return "neck";
  if (/back|lumbar|sciatica|lifting/.test(t)) return "back";
  if (/shoulder|elbow|wrist|hand|arm|rotator|tennis/.test(t)) return "shoulder";
  if (/knee|hip|thigh|hamstring|acl|patell/.test(t)) return "knee";
  if (/ankle|foot|achilles|calf|plantar/.test(t)) return "ankle";
  return "other";
}

const WORDS: Record<Area, { part: string; objective: string; treatment: string; marker: { x: number; y: number; view: "front" | "back" } }> = {
  neck: { part: "neck", objective: "Cervical rotation reduced, upper trapezius tender, neurological screen clear (fictional).", treatment: "Soft tissue work, C-spine mobilisations, deep neck flexor exercises.", marker: { x: 50, y: 11, view: "back" } },
  back: { part: "lower back", objective: "Lumbar flexion limited to knee level, straight leg raise negative (fictional).", treatment: "Lumbar mobilisations, graded walking, core exercises.", marker: { x: 50, y: 44, view: "back" } },
  shoulder: { part: "shoulder", objective: "Painful arc 70–120 degrees, resisted external rotation weak (fictional).", treatment: "Rotator cuff loading programme, posture advice.", marker: { x: 33, y: 20, view: "front" } },
  knee: { part: "knee", objective: "Mild effusion, flexion to 110 degrees, ligaments stable (fictional).", treatment: "Quadriceps strengthening, gait re-education.", marker: { x: 42, y: 72, view: "front" } },
  ankle: { part: "ankle", objective: "Swelling over the lateral ligaments, single-leg balance reduced (fictional).", treatment: "Balance programme, calf raises, taping advice.", marker: { x: 43, y: 93, view: "front" } },
  other: { part: "symptoms", objective: "Movement reduced and guarded, no red flags found (fictional).", treatment: "Graded exercise programme and advice.", marker: { x: 50, y: 35, view: "front" } },
};

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function initialSections(area: Area, title: string): Record<string, string> {
  const w = WORDS[area];
  return {
    subjective: `${title}. Pain in the ${w.part}, worse with prolonged sitting; gradual onset, no previous episodes of note. Paracetamol as needed, no known allergies. Works full time; wants to get back to the gym (fictional).`,
    red_flags: RED_FLAG_OPTIONS.join("\n"),
    objective: w.objective,
    assessment: `Mechanical ${w.part} pain, irritability moderate.`,
    plan: `${w.treatment} Review in one week.`,
    consent: "Verbal consent to assessment and treatment.",
  };
}

function followUpSections(area: Area, k: number): Record<string, string> {
  const w = WORDS[area];
  return {
    subjective: k === 1 ? "Some easing since the first session; exercises done most days (fictional)." : "Steady improvement, sleeping better (fictional).",
    objective: `Range improving. ${w.objective.split(",")[0]} less than at the start.`,
    assessment: "Progressing as expected.",
    plan: `${w.treatment} Progress the home programme.`,
  };
}

function dischargeSections(area: Area): Record<string, string> {
  return {
    reason: "Goals met; self-managing (fictional).",
    summary: `Course of treatment for the ${WORDS[area].part}: manual therapy and a home programme.`,
    outcome: "Pain and function much improved compared with the start (see the outcome measures).",
    advice: "Continue the home programme three times a week.",
    onward: "Discharge letter to the GP.",
  };
}

function chartFor(area: Area, intensity: number): BodyChart {
  const m = WORDS[area].marker;
  return { markers: [{ view: m.view, x: m.x, y: m.y, kind: "pain", intensity, label: `Main area of pain (${WORDS[area].part})` }] };
}

const MEASURE_FOR: Record<Area, "ndi" | "odi" | "quickdash" | null> = { neck: "ndi", back: "odi", shoulder: "quickdash", knee: null, ankle: null, other: null };

/** Answers giving roughly `pct` % for a 10-section 0–5 index, or the QuickDASH (11 items 1–5). */
function indexAnswers(measure: "ndi" | "odi" | "quickdash", pct: number): OutcomeInput["answers"] {
  if (measure === "quickdash") {
    const v = Math.max(1, Math.min(5, Math.round(1 + (pct / 100) * 4)));
    return { items: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i + 1}`, v])) };
  }
  const total = Math.round((pct / 100) * 50);
  return { items: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i + 1}`, Math.min(5, Math.floor(total / 10) + (i < total % 10 ? 1 : 0))])) };
}

export async function seedRecords(ctx: RepoContext, tenantId: string, options: SeedRecordsOptions = {}): Promise<SeedRecordsSummary> {
  const log = options.log ?? (() => undefined);
  const settings = await getPmsSettings(ctx, tenantId);
  if (!settings.isDemo) throw new RepoInputError("This clinic is not flagged as a demonstration clinic: no demonstration records are added.");
  const now = options.now ?? (ctx.now ? ctx.now() : pmsNow());
  const today = ukToday(now);
  const run: RepoContext = { ...ctx, now: () => now };

  const [existingNotes, existingOutcomes] = await Promise.all([
    run.db.selectFrom("pms_clinical_notes").select(["id", "import_ref"]).where("tenant_id", "=", tenantId).where("import_ref", "like", `${REF}%`).execute(),
    run.db.selectFrom("pms_outcome_measures").select("import_ref").where("tenant_id", "=", tenantId).where("import_ref", "like", `${REF}%`).execute(),
  ]);
  const haveNote = new Map(existingNotes.map((r) => [r.import_ref as string, r.id]));
  const haveOutcome = new Set(existingOutcomes.map((r) => r.import_ref as string));

  const practitioners = new Map((await listPractitioners(run, tenantId, { includeInactive: true })).map((p) => [p.id, p]));
  const patients = await run.db
    .selectFrom("pms_patients")
    .select(["id", "import_ref"])
    .where("tenant_id", "=", tenantId)
    .where("import_ref", "like", "sim-pat-%")
    .orderBy("patient_number")
    .limit(Math.min(Math.max(1, options.patients ?? 40), 200))
    .execute();
  if (patients.length === 0) throw new RepoInputError("The demonstration clinic has no demonstration patients yet: run the clinic's demo seed first.");

  const notes: ImportNoteInput[] = [];
  const outcomes: (OutcomeInput & { importRef: string })[] = [];
  let skipped = 0;
  let caseIndex = 0;
  for (const p of patients) {
    const cases: CaseSummary[] = await listCasesForPatient(run, tenantId, p.id);
    for (const c of cases) {
      caseIndex++;
      const area = areaOf(c.title);
      const prac = c.practitionerId ? practitioners.get(c.practitionerId) : undefined;
      const author = prac ? { name: prac.displayName, registration: prac.registrationNumber ?? null, userId: prac.userId ?? null } : { name: "Sarah Reid", registration: "PH-DEMO-01", userId: null };
      const end = c.closedOn && c.closedOn < today ? c.closedOn : today;
      if (c.openedOn > end) continue;
      const dates: string[] = [];
      for (let d = c.openedOn, k = 0; d <= end && k < 5; d = addDays(d, 7), k++) dates.push(d);
      const finished = c.status !== "open" && Boolean(c.closedOn) && (c.closedOn as string) <= today;
      // Every third open case leaves its latest note unsigned (older than the clinic's threshold = overdue).
      const draftLast = !finished && caseIndex % 3 === 0;
      dates.forEach((seenOn, k) => {
        const last = k === dates.length - 1;
        const ref = `${REF}${c.id}-n${k + 1}`;
        if (haveNote.has(ref)) {
          skipped++;
        } else {
          const pain = Math.max(1, 8 - k * 2);
          const input: ImportNoteInput =
            k === 0
              ? { patientId: p.id, caseId: c.id, templateId: "builtin-initial-soap", seenOn, practitionerId: c.practitionerId, author, sections: initialSections(area, c.title), bodyChart: chartFor(area, pain), signed: true, importRef: ref }
              : { patientId: p.id, caseId: c.id, templateId: "builtin-follow-up-soap", seenOn, practitionerId: c.practitionerId, author, sections: followUpSections(area, k), signed: true, importRef: ref };
          if (last && draftLast && k > 0) input.signed = false;
          notes.push(input);
        }
        const pain = Math.max(1, 8 - k * 2);
        const nprsRef = `${REF}${c.id}-o${k + 1}-nprs`;
        if (haveOutcome.has(nprsRef)) skipped++;
        else outcomes.push({ patientId: p.id, caseId: c.id, measure: "nprs", takenOn: seenOn, answers: { items: { pain } }, importRef: nprsRef });
        const measure = MEASURE_FOR[area];
        if (measure && (k === 0 || last)) {
          const mref = `${REF}${c.id}-o${k + 1}-${measure}`;
          if (haveOutcome.has(mref)) skipped++;
          else outcomes.push({ patientId: p.id, caseId: c.id, measure, takenOn: seenOn, answers: indexAnswers(measure, k === 0 ? 44 : 16), importRef: mref });
        }
      });
      if (finished) {
        const ref = `${REF}${c.id}-discharge`;
        if (haveNote.has(ref)) skipped++;
        else notes.push({ patientId: p.id, caseId: c.id, templateId: "builtin-discharge", seenOn: c.closedOn as string, practitionerId: c.practitionerId, author, sections: dischargeSections(area), signed: true, importRef: ref });
      }
    }
  }
  // Megan Hart (sim-pat-001): her patient-specific functional scale over time.
  const megan = patients.find((p) => p.import_ref === "sim-pat-001");
  if (megan) {
    const [first] = await listCasesForPatient(run, tenantId, megan.id);
    if (first) {
      const psfs: [string, number, number, number][] = [
        [first.openedOn, 2, 3, 4],
        [addDays(first.openedOn, 28), 6, 7, 7],
      ];
      psfs.forEach(([takenOn, a1, a2, a3], k) => {
        const ref = `${REF}${first.id}-psfs${k + 1}`;
        if (haveOutcome.has(ref)) skipped++;
        else if (takenOn <= today) outcomes.push({ patientId: megan.id, caseId: first.id, measure: "psfs", takenOn, answers: { items: { a1, a2, a3 }, activities: { a1: "Turning to reverse the car", a2: "Reading for an hour", a3: "Sleeping through the night" } }, importRef: ref });
      });
    }
  }

  const noteIds = notes.length ? await bulkImportNotes(run, tenantId, notes, SEED_ACTOR, { source: "demo-seed-records" }) : [];
  const outcomeIds = outcomes.length ? await bulkRecordOutcomes(run, tenantId, outcomes, SEED_ACTOR, { source: "demo-seed-records" }) : [];

  // One amendment, so the demo shows a signed and amended note: on Megan's first note (once).
  let amendments = 0;
  if (megan) {
    const [first] = await listCasesForPatient(run, tenantId, megan.id);
    const ref = first ? `${REF}${first.id}-n1` : null;
    const id = ref ? (haveNote.get(ref) ?? noteIds[notes.findIndex((n) => n.importRef === ref)]) : undefined;
    const note = id ? await getNote(run, tenantId, id) : null;
    if (note && note.status === "signed" && note.amendmentCount === 0) {
      await addAmendment(run, tenantId, note.id, { kind: "addendum", text: "Patient phoned the next day: headaches eased after the first session (fictional)." }, { name: note.authorName ?? "Sarah Reid", registration: note.signedRegistration }, SEED_ACTOR);
      amendments = 1;
    }
  }

  const summary: SeedRecordsSummary = {
    notes: noteIds.length,
    signed: notes.filter((n) => n.signed).length,
    drafts: notes.filter((n) => !n.signed).length,
    amendments,
    outcomes: outcomeIds.length,
    skipped,
  };
  log(`Clinical records: ${summary.notes} notes (${summary.signed} signed, ${summary.drafts} unsigned), ${summary.amendments} amendment, ${summary.outcomes} outcome measures${skipped ? `; ${skipped} already there` : ""}.`);
  return summary;
}
