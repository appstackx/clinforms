/**
 * Home exercise programmes (ex03–ex06) for the screens and the portal. Rules: ./access.ts and
 * src/modules/pms/records/exercises.ts. Docs: docs/clinic-system/exercise-programmes.md.
 *
 * Two switches, both off by default: the platform's CLINFORMS_EXERCISE=on, then the clinic's own setting (Set-up →
 * Exercises). With either off every function here answers "not found" (the set-up page needs only the platform's).
 *
 *   settings.setup  – switch it on or off for the clinic; the clinic's exercise library (add, change, archive)
 *   clinical.view   – read a patient's programmes, their exercises and the patient's check-ins (never reception)
 *   clinical.write  – start, edit, share, end and re-version a programme
 *
 * Opening a programme and printing it are recorded in the patient's history (pms.exercise_programme.view / .pdf).
 * The patient (portal): only their OWN SHARED programmes, while the clinic's portal and this feature are on.
 */
import "server-only";
import { CheckinInputSchema, LibraryExerciseInputSchema, ProgrammeInputSchema, exerciseSwitchOn, adherenceSummary, DEMO_EXERCISES, MAX_LIBRARY_EXERCISES, type Adherence, type CheckinInput, type ExerciseCheckin, type ExerciseProgramme, type LibraryExercise, type LibraryExerciseInput, type ProgrammeInput, type ProgrammeSummary } from "../../../modules/pms/records/exercises";
import { ukToday } from "../../../modules/pms/core/text";
import { pmsNow } from "../../../modules/pms/core/clock";
import type { CaseSummary, PmsActor } from "../../../modules/pms/core/types";
import { RepoInputError, type DbContext, type RepoContext } from "../../repos/context";
import { listCasesForPatient } from "../../repos/pms/cases";
import { getPatient } from "../../repos/pms/patients";
import { getPmsSettings } from "../../repos/pms/settings";
import { getBookingSettings } from "../../repos/pms/portal/settings";
import { getAnonymisation } from "../../repos/pms/records/anonymise";
import {
  createLibraryExercise,
  createProgramme,
  draftReplacing,
  endProgramme,
  getExerciseSettings,
  getLibraryExercise,
  getProgramme,
  listCheckins,
  listCheckinsForPatient,
  listLibraryExercises,
  listProgrammesForPatient,
  markProgrammeViewedByPatient,
  recordProgrammeAccess,
  saveCheckin,
  saveProgrammeDraft,
  setExercisesEnabled,
  setLibraryExerciseActive,
  shareProgramme,
  updateLibraryExercise,
} from "../../repos/pms/records/exercises";
import { renderProgrammePdf, programmePdfFileName } from "./exercise-pdf";
import { attempt, fail, guard, noteAuthorOf, notFound, ok, patientInClinic, saveFailure, type RecordsActor, type Result } from "./access";

type Env = Readonly<Record<string, string | undefined>>;

/** The platform switch (CLINFORMS_EXERCISE=on). */
export function exercisesAvailable(env: Env = process.env): boolean {
  return exerciseSwitchOn(env);
}

/** Both switches: the platform's and the clinic's own. */
export async function exercisesOnForClinic(ctx: DbContext, tenantId: string, env: Env = process.env): Promise<boolean> {
  if (!exercisesAvailable(env)) return false;
  return (await getExerciseSettings(ctx, tenantId)).enabled;
}

/** The input's own field errors (null = valid) – the repositories validate again. */
function invalid(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown) {
  const r = schema.safeParse(input);
  if (r.success) return null;
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error?.issues ?? []) fieldErrors[i.path.map(String).join(".") || "_"] ??= i.message;
  const first = Object.values(fieldErrors)[0] ?? "Check the fields marked below.";
  return fail("invalid", Object.keys(fieldErrors).some((k) => k.startsWith("items.")) ? `An exercise needs fixing: ${first}` : "Check the fields marked below.", { fieldErrors });
}

const today = (ctx: RepoContext) => ukToday(ctx.now ? ctx.now() : pmsNow());

/* ------------------------------------------------------------------------------------------------
 * Set-up → Exercises
 * ----------------------------------------------------------------------------------------------*/

export interface ExerciseSetupView {
  enabled: boolean;
  isDemo: boolean;
  library: LibraryExercise[];
}

export async function exerciseSetupFor(actor: RecordsActor, env: Env = process.env): Promise<Result<ExerciseSetupView>> {
  const denied = guard(actor, "settings.setup");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  return attempt("exercise_setup", async () => {
    const ctx = actor.repo();
    const [settings, library, pms] = await Promise.all([getExerciseSettings(ctx, actor.tenantId), listLibraryExercises(ctx, actor.tenantId, { includeArchived: true }), getPmsSettings(ctx, actor.tenantId)]);
    return ok({ enabled: settings.enabled, isDemo: pms.isDemo, library });
  });
}

export async function setExercisesEnabledFor(actor: RecordsActor, enabled: boolean, env: Env = process.env): Promise<Result<{ changed: boolean }>> {
  const denied = guard(actor, "settings.setup");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  return attempt("exercise_switch", async () => ok({ changed: await setExercisesEnabled(actor.repo(), actor.tenantId, enabled === true, actor.actor) }));
}

/** Adds (no id) or changes (id + the revision the form saw) a library exercise. */
export async function saveLibraryExerciseFor(actor: RecordsActor, input: LibraryExerciseInput & { id?: string | null; rev?: number }, env: Env = process.env): Promise<Result<{ id: string; rev: number }>> {
  const denied = guard(actor, "settings.setup");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  const bad = invalid(LibraryExerciseInputSchema, input);
  if (bad) return bad;
  return attempt("exercise_save", async () => {
    const ctx = actor.repo();
    if (!input.id) {
      const created = await createLibraryExercise(ctx, actor.tenantId, input, actor.actor);
      return ok({ id: created.id, rev: created.rev });
    }
    const existing = typeof input.id === "string" ? await getLibraryExercise(ctx, actor.tenantId, input.id) : null;
    if (!existing) return notFound();
    const saved = await updateLibraryExercise(ctx, actor.tenantId, existing.id, Number(input.rev), input, actor.actor);
    return saved.ok ? ok({ id: existing.id, rev: saved.rev }) : saveFailure(saved);
  });
}

export async function setLibraryExerciseActiveFor(actor: RecordsActor, id: string, rev: number, active: boolean, env: Env = process.env): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "settings.setup");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  return attempt("exercise_active", async () => {
    const ctx = actor.repo();
    const existing = typeof id === "string" && id ? await getLibraryExercise(ctx, actor.tenantId, id) : null;
    if (!existing) return notFound();
    const saved = await setLibraryExerciseActive(ctx, actor.tenantId, existing.id, rev, active, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

/** DEMONSTRATION clinics only: adds the fictional starter entries not already in the library (by name). */
export async function addDemoExercisesFor(actor: RecordsActor, env: Env = process.env): Promise<Result<{ added: number }>> {
  const denied = guard(actor, "settings.setup");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  return attempt("exercise_demo", async () => {
    const ctx = actor.repo();
    if (!(await getPmsSettings(ctx, actor.tenantId)).isDemo) return fail("invalid", "Demo exercises are only for demonstration clinics.");
    const have = new Set((await listLibraryExercises(ctx, actor.tenantId, { includeArchived: true })).map((e) => e.name));
    let added = 0;
    for (const e of DEMO_EXERCISES) {
      if (have.has(e.name) || have.size + added >= MAX_LIBRARY_EXERCISES) continue;
      await createLibraryExercise(ctx, actor.tenantId, e, actor.actor);
      added++;
    }
    return ok({ added });
  });
}

/* ------------------------------------------------------------------------------------------------
 * The patient's record → Exercises
 * ----------------------------------------------------------------------------------------------*/

export interface ProgrammeRow extends ProgrammeSummary {
  adherence: Adherence;
}

export interface ProgrammesView {
  programmes: ProgrammeRow[];
  cases: CaseSummary[];
  canWrite: boolean;
  anonymised: boolean;
  today: string;
}

async function onOrNotFound(actor: RecordsActor, env: Env): Promise<boolean> {
  return exercisesOnForClinic(actor.repo(), actor.tenantId, env);
}

export async function programmesFor(actor: RecordsActor, patientId: string, env: Env = process.env): Promise<Result<ProgrammesView>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("exercise_programmes", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const day = today(ctx);
    const from = new Date(`${day}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 13);
    const [list, checkins, cases, anon] = await Promise.all([
      listProgrammesForPatient(ctx, actor.tenantId, patient.id),
      listCheckinsForPatient(ctx, actor.tenantId, patient.id, from.toISOString().slice(0, 10)),
      listCasesForPatient(ctx, actor.tenantId, patient.id),
      getAnonymisation(ctx, actor.tenantId, patient.id),
    ]);
    return ok({
      programmes: list.map((p) => ({ ...p, adherence: adherenceSummary(checkins.filter((c) => c.programmeId === p.id), day) })),
      cases,
      canWrite: actor.can("clinical.write") && patient.status === "active" && !anon,
      anonymised: Boolean(anon),
      today: day,
    });
  });
}

export interface ProgrammeView {
  programme: ExerciseProgramme;
  checkins: ExerciseCheckin[];
  adherence: Adherence;
  cases: CaseSummary[];
  /** The library for the builder (drafts, clinical.write only). */
  library: LibraryExercise[];
  canWrite: boolean;
  today: string;
}

async function programmeOfPatient(actor: RecordsActor, patientId: string, programmeId: unknown) {
  const patient = await patientInClinic(actor, patientId);
  if (!patient || typeof programmeId !== "string" || !/^exprog_[0-9A-HJKMNP-TV-Z]{26}$/.test(programmeId)) return null;
  const programme = await getProgramme(actor.repo(), actor.tenantId, programmeId);
  return programme && programme.patientId === patient.id ? { patient, programme } : null;
}

/** One programme, with its check-ins. `recordView`: the page – recorded in the patient's history. */
export async function programmeFor(actor: RecordsActor, patientId: string, programmeId: string, options: { recordView?: boolean } = {}, env: Env = process.env): Promise<Result<ProgrammeView>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("exercise_programme", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const found = await programmeOfPatient(actor, patientId, programmeId);
    if (!found) return notFound();
    const ctx = actor.repo();
    const { patient, programme } = found;
    const anon = await getAnonymisation(ctx, actor.tenantId, patient.id);
    const canWrite = actor.can("clinical.write") && patient.status === "active" && !anon;
    const [checkins, cases, library] = await Promise.all([
      listCheckins(ctx, actor.tenantId, programme.id),
      listCasesForPatient(ctx, actor.tenantId, patient.id),
      canWrite && programme.status === "draft" ? listLibraryExercises(ctx, actor.tenantId) : Promise.resolve([]),
    ]);
    if (options.recordView) await recordProgrammeAccess(ctx, actor.tenantId, programme.id, "view", actor.actor);
    const day = today(ctx);
    return ok({ programme, checkins, adherence: adherenceSummary(checkins, day), cases, library, canWrite, today: day });
  });
}

export async function createProgrammeFor(actor: RecordsActor, patientId: string, input: ProgrammeInput, env: Env = process.env): Promise<Result<{ id: string }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  const bad = invalid(ProgrammeInputSchema, input);
  if (bad) return bad;
  return attempt("exercise_programme_create", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    if (patient.status !== "active") return fail("invalid", "Programmes are only started for active patients.");
    return ok({ id: (await createProgramme(actor.repo(), actor.tenantId, patient.id, input, actor.actor)).id });
  });
}

export async function saveProgrammeFor(actor: RecordsActor, patientId: string, programmeId: string, expectedRev: number, input: ProgrammeInput, env: Env = process.env): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  if (!exercisesAvailable(env)) return notFound();
  const bad = invalid(ProgrammeInputSchema, input);
  if (bad) return bad;
  return attempt("exercise_programme_save", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const found = await programmeOfPatient(actor, patientId, programmeId);
    if (!found) return notFound();
    if (found.patient.status !== "active") return fail("invalid", "Programmes are only changed for active patients.");
    const saved = await saveProgrammeDraft(actor.repo(), actor.tenantId, found.programme.id, expectedRev, input, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

export async function shareProgrammeFor(actor: RecordsActor, patientId: string, programmeId: string, expectedRev: number, env: Env = process.env): Promise<Result<{ rev: number; portal: boolean }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("exercise_programme_share", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const found = await programmeOfPatient(actor, patientId, programmeId);
    if (!found) return notFound();
    if (found.patient.status !== "active") return fail("invalid", "Programmes are only shared with active patients.");
    const author = await noteAuthorOf(actor);
    const prescriber = author.registration ? `${author.name}, ${author.registration}` : author.name;
    const ctx = actor.repo();
    const saved = await shareProgramme(ctx, actor.tenantId, found.programme.id, expectedRev, { name: prescriber }, actor.actor);
    if (!saved.ok) return saveFailure(saved);
    return ok({ rev: saved.rev, portal: (await getBookingSettings(ctx, actor.tenantId)).portal });
  });
}

export async function endProgrammeFor(actor: RecordsActor, patientId: string, programmeId: string, expectedRev: number, env: Env = process.env): Promise<Result<{ rev: number }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("exercise_programme_end", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const found = await programmeOfPatient(actor, patientId, programmeId);
    if (!found) return notFound();
    const saved = await endProgramme(actor.repo(), actor.tenantId, found.programme.id, expectedRev, actor.actor);
    return saved.ok ? ok({ rev: saved.rev }) : saveFailure(saved);
  });
}

/** A new draft copied from a shared (or ended) programme; sharing it ends the one it replaces. */
export async function newVersionFor(actor: RecordsActor, patientId: string, programmeId: string, env: Env = process.env): Promise<Result<{ id: string }>> {
  const denied = guard(actor, "clinical.write");
  if (denied) return denied;
  return attempt("exercise_programme_version", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const found = await programmeOfPatient(actor, patientId, programmeId);
    if (!found) return notFound();
    const { patient, programme } = found;
    if (patient.status !== "active") return fail("invalid", "Programmes are only started for active patients.");
    if (programme.status === "draft") return fail("invalid", "This programme is still a draft: change it directly.");
    if (programme.title === null) return fail("invalid", "This programme was anonymised.");
    // One new version at a time (review fix): a draft already replacing this programme is opened instead of a second.
    if (programme.status === "shared") {
      const existing = await draftReplacing(actor.repo(), actor.tenantId, programme.id);
      if (existing) return ok({ id: existing });
    }
    const copy = await createProgramme(
      actor.repo(),
      actor.tenantId,
      patient.id,
      { title: programme.title, notes: programme.notes, caseId: programme.caseId, items: programme.items },
      actor.actor,
      { replacesId: programme.status === "shared" ? programme.id : null },
    );
    return ok({ id: copy.id });
  });
}

export interface ProgrammeFile {
  fileName: string;
  bytes: Uint8Array;
}

async function pdfOf(ctx: RepoContext, tenantId: string, clinicName: string, programme: ExerciseProgramme, patientName: string): Promise<ProgrammeFile> {
  const booking = await getBookingSettings(ctx, tenantId);
  const bytes = await renderProgrammePdf({
    clinic: { name: clinicName, phone: booking.contactPhone },
    patientName,
    title: programme.title ?? "Exercise programme",
    notes: programme.notes,
    items: programme.items,
    sharedAt: programme.sharedAt,
    prescribedBy: programme.sharedByName,
    status: programme.status,
  });
  return { fileName: programmePdfFileName(programme.sharedAt, today(ctx)), bytes };
}

/** The programme as a PDF for the clinician (any status; a draft is marked). Recorded in the patient's history. */
export async function programmePdfFor(actor: RecordsActor & { clinicName: string }, patientId: string, programmeId: string, env: Env = process.env): Promise<Result<ProgrammeFile>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("exercise_programme_pdf", async () => {
    if (!(await onOrNotFound(actor, env))) return notFound();
    const found = await programmeOfPatient(actor, patientId, programmeId);
    if (!found) return notFound();
    const ctx = actor.repo();
    const file = await pdfOf(ctx, actor.tenantId, actor.clinicName, found.programme, `${found.patient.firstName} ${found.patient.lastName}`);
    await recordProgrammeAccess(ctx, actor.tenantId, found.programme.id, "pdf", actor.actor);
    return ok(file);
  });
}

/* ------------------------------------------------------------------------------------------------
 * The patient portal
 * ----------------------------------------------------------------------------------------------*/

export interface PortalClinicLike {
  tenantId: string;
  name: string;
  settings: { portal: boolean };
}

export interface PortalViewerLike {
  patientId: string;
  actor: PmsActor;
}

/** The portal shows exercises when the platform switch, the clinic's setting and its portal are all on. */
export async function portalExercisesOn(ctx: DbContext, clinic: PortalClinicLike, env: Env = process.env): Promise<boolean> {
  return clinic.settings.portal && (await exercisesOnForClinic(ctx, clinic.tenantId, env));
}

export interface PortalProgrammeRow {
  id: string;
  title: string;
  sharedAt: string | null;
  itemCount: number;
  checkedInToday: boolean;
}

/** The patient's SHARED programmes for the portal's home ([] when off). */
export async function portalProgrammesFor(ctx: RepoContext, clinic: PortalClinicLike, patientId: string, env: Env = process.env): Promise<PortalProgrammeRow[]> {
  if (!(await portalExercisesOn(ctx, clinic, env))) return [];
  // An archived or deceased patient's programmes are not offered (the programme page refuses them too).
  const patient = await getPatient(ctx, clinic.tenantId, patientId);
  if (!patient || patient.status !== "active") return [];
  const day = today(ctx);
  const [list, checkins] = await Promise.all([listProgrammesForPatient(ctx, clinic.tenantId, patientId, { status: "shared" }), listCheckinsForPatient(ctx, clinic.tenantId, patientId, day)]);
  return list.map((p) => ({ id: p.id, title: p.title ?? "Exercise programme", sharedAt: p.sharedAt, itemCount: p.itemCount, checkedInToday: checkins.some((c) => c.programmeId === p.id && c.doneOn === day) }));
}

export interface PortalProgrammeView {
  programme: ExerciseProgramme;
  recent: ExerciseCheckin[];
  todays: ExerciseCheckin | null;
  today: string;
}

async function portalProgramme(ctx: RepoContext, clinic: PortalClinicLike, patientId: string, programmeId: unknown, env: Env): Promise<ExerciseProgramme | null> {
  if (typeof programmeId !== "string" || !/^exprog_[0-9A-HJKMNP-TV-Z]{26}$/.test(programmeId)) return null;
  if (!(await portalExercisesOn(ctx, clinic, env))) return null;
  const programme = await getProgramme(ctx, clinic.tenantId, programmeId);
  if (!programme || programme.patientId !== patientId || programme.status !== "shared") return null;
  const patient = await getPatient(ctx, clinic.tenantId, patientId);
  return patient && patient.status === "active" ? programme : null;
}

/** One of the patient's shared programmes (null = not theirs, not shared, or switched off). The first open is kept. */
export async function portalProgrammeFor(ctx: RepoContext, clinic: PortalClinicLike, viewer: PortalViewerLike, programmeId: string, env: Env = process.env): Promise<PortalProgrammeView | null> {
  const programme = await portalProgramme(ctx, clinic, viewer.patientId, programmeId, env);
  if (!programme) return null;
  if (!programme.patientViewedAt) await markProgrammeViewedByPatient(ctx, clinic.tenantId, programme.id, viewer.actor);
  const day = today(ctx);
  const checkins = await listCheckins(ctx, clinic.tenantId, programme.id, { limit: 14 });
  return { programme, recent: checkins, todays: checkins.find((c) => c.doneOn === day) ?? null, today: day };
}

export type PortalAnswer = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** The patient's check-in for today on one of their shared programmes. */
export async function portalCheckinFor(ctx: RepoContext, clinic: PortalClinicLike, viewer: PortalViewerLike, programmeId: string, input: CheckinInput, env: Env = process.env): Promise<PortalAnswer> {
  const programme = await portalProgramme(ctx, clinic, viewer.patientId, programmeId, env);
  if (!programme) return { ok: false, error: "This programme is no longer available." };
  const parsed = CheckinInputSchema.safeParse(input);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0] ?? "_")] ??= i.message;
    return { ok: false, error: "Please check the answers marked below.", fieldErrors: fe };
  }
  try {
    await saveCheckin(ctx, clinic.tenantId, programme.id, viewer.patientId, today(ctx), input, viewer.actor);
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, error: err.message.replace(/^Check-in: [a-zA-Z.]+: /, "") };
    throw err;
  }
  return { ok: true, message: "Thanks – your clinic can see today's check-in." };
}

/** The patient's own programme as a PDF (recorded in the clinic's trail). */
export async function portalProgrammePdfFor(ctx: RepoContext, clinic: PortalClinicLike, viewer: PortalViewerLike, programmeId: string, env: Env = process.env): Promise<ProgrammeFile | null> {
  const programme = await portalProgramme(ctx, clinic, viewer.patientId, programmeId, env);
  if (!programme) return null;
  const patient = await getPatient(ctx, clinic.tenantId, viewer.patientId);
  if (!patient) return null;
  const file = await pdfOf(ctx, clinic.tenantId, clinic.name, programme, `${patient.firstName} ${patient.lastName}`);
  await recordProgrammeAccess(ctx, clinic.tenantId, programme.id, "portal_pdf", viewer.actor);
  return file;
}
