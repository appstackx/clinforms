/**
 * Home exercise programmes (migrations 0126–0128; rules: src/modules/pms/records/exercises.ts): the clinic's switch,
 * its own exercise library, patients' programmes and the patient's check-ins.
 *
 * - Every statement names tenant_id; every write is audited in the same batch (or by a conditional audit row that
 *   exists exactly when the change does – ./write.ts). Audit details hold ids, counts and statuses only: never a
 *   title, an exercise, a pain score or a comment.
 * - Encrypted: a programme's title, note and exercises (title_enc, notes_enc, items_enc) and a check-in's comment
 *   (comment_enc), AAD "<tenant>:<table>.<column>:<row id>". The library is the clinic's configuration: plain.
 * - The library hangs off pms_exercise_settings, which hangs off pms_records_settings: a write that needs them
 *   inserts the missing parent rows in its own batch (ON CONFLICT DO NOTHING).
 * - Before the migrations every read answers "off / nothing" (exerciseTablesInstalled); the platform switch keeps
 *   every write path closed anyway.
 * - Who may do what is decided by the service (src/server/pms/records/exercises-service.ts).
 */
import {
  CheckinInputSchema,
  LibraryExerciseInputSchema,
  MAX_LIBRARY_EXERCISES,
  ProgrammeInputSchema,
  ProgrammeItemSchema,
  type CheckinInput,
  type ExerciseCheckin,
  type ExerciseProgramme,
  type LibraryExercise,
  type LibraryExerciseInput,
  type LibraryExerciseValues,
  type ProgrammeInput,
  type ProgrammeItem,
  type ProgrammeStatus,
  type ProgrammeSummary,
} from "../../../../modules/pms/records/exercises";
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { isMissingPmsTable } from "../../../pms/missing-table";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { RepoInputError, assertActor, assertId, assertTenantId, decryptField, encryptField, nowIso, num, parseInput, pmsAuditQuery, pmsId, translateDbError, writeWithAudit, type DbContext, type RepoContext } from "../context";
import { updateWithAudit } from "./write";

const S = "pms_exercise_settings";
const L = "pms_exercises";
const PR = "pms_exercise_programmes";
const CK = "pms_exercise_checkins";
const SETTINGS_ID = "exercises";

/* ------------------------------------------------------------------------------------------------
 * Installed?
 * ----------------------------------------------------------------------------------------------*/

const INSTALLED = new WeakMap<object, true>();

/** Whether the exercise tables exist (a one-row probe; false before migrations 0126–0128). Remembered once true. */
export async function exerciseTablesInstalled(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  if (INSTALLED.has(ctx.db)) return true;
  try {
    await ctx.db.selectFrom(CK).select("id").where("tenant_id", "=", tenantId).limit(1).execute();
  } catch (err) {
    if ([S, L, PR, CK].some((t) => isMissingPmsTable(err, t))) return false;
    throw err;
  }
  INSTALLED.set(ctx.db, true);
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * The clinic's switch
 * ----------------------------------------------------------------------------------------------*/

export interface ExerciseSettings {
  enabled: boolean;
  rev: number;
  updatedAt: string | null;
}

export async function getExerciseSettings(ctx: DbContext, tenantId: string): Promise<ExerciseSettings> {
  assertTenantId(tenantId);
  if (!(await exerciseTablesInstalled(ctx, tenantId))) return { enabled: false, rev: 0, updatedAt: null };
  const row = await ctx.db.selectFrom(S).select(["enabled", "rev", "updated_at"]).where("tenant_id", "=", tenantId).where("id", "=", SETTINGS_ID).executeTakeFirst();
  return row ? { enabled: num(row.enabled) === 1, rev: num(row.rev), updatedAt: row.updated_at } : { enabled: false, rev: 0, updatedAt: null };
}

/** The parent rows a library write needs (no-ops when they exist): the records settings row, then the switch's. */
function ensureParentRows(ctx: DbContext, tenantId: string, at: string): BatchQuery[] {
  return [
    ctx.db
      .insertInto("pms_records_settings")
      .values({ tenant_id: tenantId, id: "records", rev: 1, updated_by: null, created_at: at, updated_at: at })
      .onConflict((oc) => oc.columns(["tenant_id", "id"]).doNothing()),
    ctx.db
      .insertInto(S)
      .values({ tenant_id: tenantId, id: SETTINGS_ID, records_id: "records", rev: 1, enabled: 0, updated_by: null, created_at: at, updated_at: at })
      .onConflict((oc) => oc.columns(["tenant_id", "id"]).doNothing()),
  ];
}

/** Switches exercise programmes on or off for the clinic. Returns false when nothing changed. */
export async function setExercisesEnabled(ctx: DbContext, tenantId: string, enabled: boolean, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  const before = await getExerciseSettings(ctx, tenantId);
  if (before.rev > 0 && before.enabled === enabled) return false;
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ...ensureParentRows(ctx, tenantId, at),
    ctx.db
      .updateTable(S)
      .set((eb) => ({ enabled: enabled ? 1 : 0, rev: eb("rev", "+", 1), updated_by: who.userId, updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", SETTINGS_ID),
    pmsAuditQuery(ctx, tenantId, who, { action: "pms.exercise_settings.update", targetType: "pms_exercise_settings", targetId: SETTINGS_ID, detail: { enabled } }),
  ]);
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * The clinic's library
 * ----------------------------------------------------------------------------------------------*/

const LIB_COLUMNS = ["id", "rev", "name", "body_area", "instructions", "cautions", "image_url", "video_url", "active", "updated_at"] as const;
type LibRow = { id: string; rev: number; name: string; body_area: string | null; instructions: string | null; cautions: string | null; image_url: string | null; video_url: string | null; active: number; updated_at: string };

function toLibrary(r: LibRow): LibraryExercise {
  return { id: r.id, rev: num(r.rev), name: r.name, bodyArea: r.body_area, instructions: r.instructions, cautions: r.cautions, imageUrl: r.image_url, videoUrl: r.video_url, active: num(r.active) === 1, updatedAt: r.updated_at };
}

export async function listLibraryExercises(ctx: DbContext, tenantId: string, options: { includeArchived?: boolean } = {}): Promise<LibraryExercise[]> {
  assertTenantId(tenantId);
  if (!(await exerciseTablesInstalled(ctx, tenantId))) return [];
  let q = ctx.db.selectFrom(L).select(LIB_COLUMNS).where("tenant_id", "=", tenantId);
  if (!options.includeArchived) q = q.where("active", "=", 1);
  const rows = await q.orderBy("active", "desc").orderBy("name").orderBy("id").limit(MAX_LIBRARY_EXERCISES).execute();
  return rows.map((r) => toLibrary(r as LibRow));
}

export async function getLibraryExercise(ctx: DbContext, tenantId: string, id: string): Promise<LibraryExercise | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(L).select(LIB_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toLibrary(row as LibRow) : null;
}

const libValues = (d: LibraryExerciseValues) => ({ name: d.name, body_area: d.bodyArea, instructions: d.instructions, cautions: d.cautions, image_url: d.imageUrl, video_url: d.videoUrl });

/** Adds an exercise to the clinic's library. */
export async function createLibraryExercise(ctx: DbContext, tenantId: string, input: LibraryExerciseInput, actor: PmsActor): Promise<LibraryExercise> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  const d = parseInput(LibraryExerciseInputSchema, input, "Exercise");
  const count = await ctx.db
    .selectFrom(L)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
  if (num(count?.n ?? 0) >= MAX_LIBRARY_EXERCISES) throw new RepoInputError(`The library holds at most ${MAX_LIBRARY_EXERCISES} exercises.`);
  const id = pmsId(P.exercise, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ...ensureParentRows(ctx, tenantId, at),
    ctx.db.insertInto(L).values({ tenant_id: tenantId, id, settings_id: SETTINGS_ID, rev: 1, ...libValues(d), active: 1, created_by: who.userId, updated_by: who.userId, created_at: at, updated_at: at }),
    pmsAuditQuery(ctx, tenantId, who, { action: "pms.exercise.create", targetType: "pms_exercise", targetId: id }),
  ]);
  return (await getLibraryExercise(ctx, tenantId, id)) as LibraryExercise;
}

/** Changes a library exercise (programmes already given keep their own copy). */
export async function updateLibraryExercise(ctx: DbContext, tenantId: string, id: string, expectedRev: number, input: LibraryExerciseInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "exercise id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(LibraryExerciseInputSchema, input, "Exercise");
  const at = nowIso(ctx);
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db.updateTable(L).set({ ...libValues(d), rev: expectedRev + 1, updated_by: who.userId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev),
    { action: "pms.exercise.update", targetType: "pms_exercise", targetId: id, detail: { rev: expectedRev + 1 } },
    ctx.db.selectFrom(L).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
  );
  if (changed) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  const now = await getLibraryExercise(ctx, tenantId, id);
  return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
}

/** Archives (out of the builder's list) or restores a library exercise. */
export async function setLibraryExerciseActive(ctx: DbContext, tenantId: string, id: string, expectedRev: number, active: boolean, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "exercise id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const at = nowIso(ctx);
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(L)
      .set({ active: active ? 1 : 0, rev: expectedRev + 1, updated_by: who.userId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev),
    { action: active ? "pms.exercise.restore" : "pms.exercise.archive", targetType: "pms_exercise", targetId: id, detail: { rev: expectedRev + 1 } },
    ctx.db.selectFrom(L).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
  );
  if (changed) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  const now = await getLibraryExercise(ctx, tenantId, id);
  return now ? { ok: false, reason: "conflict", currentRev: now.rev } : { ok: false, reason: "not_found" };
}

/* ------------------------------------------------------------------------------------------------
 * Programmes
 * ----------------------------------------------------------------------------------------------*/

const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "patient_id",
  "case_id",
  "replaces_id",
  "status",
  "title_enc",
  "item_count",
  "shared_at",
  "shared_by_name",
  "ended_at",
  "patient_viewed_at",
  "created_at",
  "updated_at",
] as const;
type SummaryRow = {
  tenant_id: string;
  id: string;
  rev: number;
  patient_id: string;
  case_id: string | null;
  replaces_id: string | null;
  status: string;
  title_enc: string | null;
  item_count: number;
  shared_at: string | null;
  shared_by_name: string | null;
  ended_at: string | null;
  patient_viewed_at: string | null;
  created_at: string;
  updated_at: string;
};

const statusOf = (s: string): ProgrammeStatus => (s === "shared" || s === "ended" ? s : "draft");

function toSummary(ctx: RepoContext, r: SummaryRow): ProgrammeSummary {
  return {
    id: r.id,
    rev: num(r.rev),
    patientId: r.patient_id,
    caseId: r.case_id,
    replacesId: r.replaces_id,
    status: statusOf(r.status),
    title: decryptField(ctx, r.tenant_id, PR, "title_enc", r.id, r.title_enc),
    itemCount: num(r.item_count),
    sharedAt: r.shared_at,
    sharedByName: r.shared_by_name,
    endedAt: r.ended_at,
    patientViewedAt: r.patient_viewed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Parses stored items; an entry that no longer passes the schema is kept as far as it can be read. */
function parseItems(json: string | null): ProgrammeItem[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x) => {
      const p = ProgrammeItemSchema.safeParse(x);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}

/** One patient's programmes (newest first) – titles decrypted, the exercises not. */
export async function listProgrammesForPatient(ctx: RepoContext, tenantId: string, patientId: string, options: { status?: ProgrammeStatus } = {}): Promise<ProgrammeSummary[]> {
  assertTenantId(tenantId);
  if (!(await exerciseTablesInstalled(ctx, tenantId))) return [];
  let q = ctx.db.selectFrom(PR).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (options.status) q = q.where("status", "=", options.status);
  const rows = await q.orderBy("id", "desc").limit(200).execute();
  return rows.map((r) => toSummary(ctx, r as SummaryRow));
}

/** The ids of a patient's programmes (the record's history; nothing decrypted). [] before the migrations. */
export async function programmeIdsForPatient(ctx: DbContext, tenantId: string, patientId: string): Promise<string[]> {
  assertTenantId(tenantId);
  if (!(await exerciseTablesInstalled(ctx, tenantId))) return [];
  const rows = await ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).limit(500).execute();
  return rows.map((r) => r.id);
}

export async function getProgramme(ctx: RepoContext, tenantId: string, id: string): Promise<ExerciseProgramme | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(PR)
    .select([...SUMMARY_COLUMNS, "notes_enc", "items_enc"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  return {
    ...toSummary(ctx, row as SummaryRow),
    notes: decryptField(ctx, row.tenant_id, PR, "notes_enc", row.id, row.notes_enc),
    items: parseItems(decryptField(ctx, row.tenant_id, PR, "items_enc", row.id, row.items_enc)),
  };
}

async function patientWritable(ctx: DbContext, tenantId: string, patientId: string): Promise<void> {
  const anonymised = await ctx.db.selectFrom("pms_patient_anonymisations").select("status").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).executeTakeFirst();
  if (anonymised) throw new RepoInputError("This record has been anonymised. Nothing can be added.");
}

async function checkCase(ctx: DbContext, tenantId: string, patientId: string, caseId: string | null): Promise<void> {
  if (!caseId) return;
  const row = await ctx.db.selectFrom("pms_cases").select("id").where("tenant_id", "=", tenantId).where("id", "=", caseId).where("patient_id", "=", patientId).executeTakeFirst();
  if (!row) throw new RepoInputError("That case is not one of this patient's.");
}

/** Starts a draft programme for the patient (optionally a new version of one of theirs: `replacesId`). */
export async function createProgramme(ctx: RepoContext, tenantId: string, patientId: string, input: ProgrammeInput, actor: PmsActor, options: { replacesId?: string | null } = {}): Promise<ExerciseProgramme> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const who = assertActor(actor);
  const d = parseInput(ProgrammeInputSchema, input, "Programme");
  await patientWritable(ctx, tenantId, patientId);
  await checkCase(ctx, tenantId, patientId, d.caseId);
  const replacesId = options.replacesId ?? null;
  if (replacesId) {
    const old = await ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("id", "=", replacesId).where("patient_id", "=", patientId).executeTakeFirst();
    if (!old) throw new RepoInputError("The programme it replaces is not one of this patient's.");
  }
  const id = pmsId(P.exerciseProgramme, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(PR).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        patient_id: patientId,
        case_id: d.caseId,
        replaces_id: replacesId,
        status: "draft",
        title_enc: encryptField(ctx, tenantId, PR, "title_enc", id, d.title),
        notes_enc: encryptField(ctx, tenantId, PR, "notes_enc", id, d.notes),
        items_enc: encryptField(ctx, tenantId, PR, "items_enc", id, JSON.stringify(d.items)),
        item_count: d.items.length,
        shared_at: null,
        shared_by: null,
        shared_by_name: null,
        ended_at: null,
        ended_by: null,
        patient_viewed_at: null,
        created_by: who.userId,
        anonymised_at: null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, who, { action: "pms.exercise_programme.create", targetType: "pms_exercise_programme", targetId: id, detail: { patientId, items: d.items.length, ...(replacesId ? { replacesId } : {}) } }),
    ],
    { foreignKey: "The patient does not exist in this clinic." },
  );
  return (await getProgramme(ctx, tenantId, id)) as ExerciseProgramme;
}

async function failureOf(ctx: DbContext, tenantId: string, id: string, wanted: ProgrammeStatus[]): Promise<Exclude<PmsSaveResult, { ok: true }>> {
  const now = await ctx.db.selectFrom(PR).select(["rev", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!now) return { ok: false, reason: "not_found" };
  if (!wanted.includes(statusOf(now.status))) throw new RepoInputError(now.status === "ended" ? "This programme has ended." : "This programme has been shared and is locked. Make a new version to change it.");
  return { ok: false, reason: "conflict", currentRev: num(now.rev) };
}

/** Saves a DRAFT (title, note, case, exercises) with the revision the editor saw. A shared programme is locked. */
export async function saveProgrammeDraft(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, input: ProgrammeInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "programme id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(ProgrammeInputSchema, input, "Programme");
  const current = await ctx.db.selectFrom(PR).select(["patient_id"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  await checkCase(ctx, tenantId, current.patient_id, d.caseId);
  const at = nowIso(ctx);
  const items = encryptField(ctx, tenantId, PR, "items_enc", id, JSON.stringify(d.items));
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(PR)
      .set({
        title_enc: encryptField(ctx, tenantId, PR, "title_enc", id, d.title),
        notes_enc: encryptField(ctx, tenantId, PR, "notes_enc", id, d.notes),
        items_enc: items,
        item_count: d.items.length,
        case_id: d.caseId,
        rev: expectedRev + 1,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "draft"),
    { action: "pms.exercise_programme.save", targetType: "pms_exercise_programme", targetId: id, detail: { items: d.items.length, rev: expectedRev + 1 } },
    ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("items_enc", "=", items ?? ""),
  );
  if (changed) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  return failureOf(ctx, tenantId, id, ["draft"]);
}

/**
 * Shares a draft with the patient (portal + printable) and locks it. A new version ends the programme it replaces
 * (if that one is still shared) in the SAME batch, so the patient never sees both.
 */
export async function shareProgramme(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, prescriber: { name: string }, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "programme id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const row = await ctx.db.selectFrom(PR).select(["status", "item_count", "replaces_id", "patient_id"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "draft") return failureOf(ctx, tenantId, id, ["draft"]);
  if (num(row.item_count) < 1) throw new RepoInputError("Add at least one exercise before sharing.");
  await patientWritable(ctx, tenantId, row.patient_id);
  const at = nowIso(ctx);
  const name = String(prescriber.name ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const queries: BatchQuery[] = [
    ctx.db
      .updateTable(PR)
      .set({ status: "shared", shared_at: at, shared_by: who.userId, shared_by_name: name, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "draft")
      .where("item_count", ">", 0),
  ];
  const shared = ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("shared_at", "=", at).where("status", "=", "shared");
  queries.push(auditInsertWhenExists(ctx, tenantId, { action: "pms.exercise_programme.share", targetType: "pms_exercise_programme", targetId: id, detail: { rev: expectedRev + 1, ...(row.replaces_id ? { replacesId: row.replaces_id } : {}) }, userId: who.userId, sessionId: who.sessionId }, shared).query);
  if (row.replaces_id) {
    // The old version ends only when this share happened (its update is conditional on the new row as shared).
    queries.push(
      ctx.db
        .updateTable(PR)
        .set((eb) => ({ status: "ended", ended_at: at, ended_by: who.userId, rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", row.replaces_id)
        .where("patient_id", "=", row.patient_id)
        .where("status", "=", "shared")
        .where((eb) => eb.exists(shared)),
    );
    const ended = ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("id", "=", row.replaces_id).where("status", "=", "ended").where("ended_at", "=", at);
    queries.push(auditInsertWhenExists(ctx, tenantId, { action: "pms.exercise_programme.end", targetType: "pms_exercise_programme", targetId: row.replaces_id, detail: { replacedBy: id }, userId: who.userId, sessionId: who.sessionId }, ended).query);
  }
  let results;
  try {
    results = await runBatch(ctx.db, queries);
  } catch (err) {
    throw translateDbError(err);
  }
  if (Number((results[0] as { numAffectedRows?: bigint | number } | undefined)?.numAffectedRows ?? 0) > 0) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  return failureOf(ctx, tenantId, id, ["draft"]);
}

/** Ends a programme (a draft no longer needed, or a shared one the patient should stop). Kept on the record. */
export async function endProgramme(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "programme id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const at = nowIso(ctx);
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(PR)
      .set({ status: "ended", ended_at: at, ended_by: who.userId, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "in", ["draft", "shared"]),
    { action: "pms.exercise_programme.end", targetType: "pms_exercise_programme", targetId: id, detail: { rev: expectedRev + 1 } },
    ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("ended_at", "=", at),
  );
  if (changed) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  return failureOf(ctx, tenantId, id, ["draft", "shared"]);
}

/** The patient opened the programme in the portal: the first time is kept on the row (audited once). */
export async function markProgrammeViewedByPatient(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(id, "programme id");
  const who = assertActor(actor);
  const at = nowIso(ctx);
  await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db.updateTable(PR).set({ patient_viewed_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("patient_viewed_at", "is", null),
    { action: "pms.exercise_programme.portal_view", targetType: "pms_exercise_programme", targetId: id },
    ctx.db.selectFrom(PR).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("patient_viewed_at", "=", at),
  );
}

/** Who opened or printed a programme (the patient's history shows it). */
export async function recordProgrammeAccess(ctx: DbContext, tenantId: string, id: string, kind: "view" | "pdf" | "portal_pdf", actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  assertId(id, "programme id");
  const who = assertActor(actor);
  await writeWithAudit(ctx, [pmsAuditQuery(ctx, tenantId, who, { action: `pms.exercise_programme.${kind}`, targetType: "pms_exercise_programme", targetId: id })]);
}

/* ------------------------------------------------------------------------------------------------
 * Check-ins
 * ----------------------------------------------------------------------------------------------*/

const CK_COLUMNS = ["tenant_id", "id", "rev", "programme_id", "patient_id", "done_on", "completed", "pain_score", "comment_enc", "updated_at"] as const;
type CkRow = { tenant_id: string; id: string; rev: number; programme_id: string; patient_id: string; done_on: string; completed: number; pain_score: number | null; comment_enc: string | null; updated_at: string };

function toCheckin(ctx: RepoContext, r: CkRow, decrypt: boolean): ExerciseCheckin {
  return {
    id: r.id,
    rev: num(r.rev),
    programmeId: r.programme_id,
    patientId: r.patient_id,
    doneOn: r.done_on,
    completed: num(r.completed) === 1,
    painScore: r.pain_score === null ? null : num(r.pain_score),
    comment: decrypt ? decryptField(ctx, r.tenant_id, CK, "comment_enc", r.id, r.comment_enc) : null,
    updatedAt: r.updated_at,
  };
}

/** A programme's check-ins, newest first (comments decrypted: one programme, opened by a clinician or its patient). */
export async function listCheckins(ctx: RepoContext, tenantId: string, programmeId: string, options: { limit?: number } = {}): Promise<ExerciseCheckin[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 120)), 400);
  const rows = await ctx.db.selectFrom(CK).select(CK_COLUMNS).where("tenant_id", "=", tenantId).where("programme_id", "=", programmeId).orderBy("done_on", "desc").limit(limit).execute();
  return rows.map((r) => toCheckin(ctx, r as CkRow, true));
}

/** A patient's check-ins since `fromDate` for the programme list (no comment decrypted). */
export async function listCheckinsForPatient(ctx: RepoContext, tenantId: string, patientId: string, fromDate: string): Promise<ExerciseCheckin[]> {
  assertTenantId(tenantId);
  if (!(await exerciseTablesInstalled(ctx, tenantId))) return [];
  const rows = await ctx.db
    .selectFrom(CK)
    .select(CK_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("done_on", ">=", fromDate)
    .orderBy("done_on", "desc")
    .limit(1000)
    .execute();
  return rows.map((r) => toCheckin(ctx, r as CkRow, false));
}

/**
 * The patient's check-in for `doneOn` (their UK today) on a SHARED programme of theirs: a new row, or that day's row
 * changed (revision-checked). Audited against the programme (ids only – never the pain score or the comment).
 */
export async function saveCheckin(ctx: RepoContext, tenantId: string, programmeId: string, patientId: string, doneOn: string, input: CheckinInput, actor: PmsActor): Promise<ExerciseCheckin> {
  assertTenantId(tenantId);
  assertId(programmeId, "programme id");
  assertId(patientId, "patient id");
  const who = assertActor(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn)) throw new RepoInputError("A check-in needs its date.");
  const d = parseInput(CheckinInputSchema, input, "Check-in");
  const programme = await ctx.db.selectFrom(PR).select(["status"]).where("tenant_id", "=", tenantId).where("id", "=", programmeId).where("patient_id", "=", patientId).executeTakeFirst();
  if (!programme) throw new RepoInputError("This programme is no longer available.");
  if (programme.status !== "shared") throw new RepoInputError("This programme has ended, so it no longer takes check-ins.");
  const at = nowIso(ctx);
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await ctx.db.selectFrom(CK).select(["id", "rev"]).where("tenant_id", "=", tenantId).where("programme_id", "=", programmeId).where("done_on", "=", doneOn).executeTakeFirst();
    if (!existing) {
      const id = pmsId(P.exerciseCheckin, ctx);
      try {
        await writeWithAudit(
          ctx,
          [
            ctx.db.insertInto(CK).values({
              tenant_id: tenantId,
              id,
              rev: 1,
              programme_id: programmeId,
              patient_id: patientId,
              done_on: doneOn,
              completed: d.completed ? 1 : 0,
              pain_score: d.painScore,
              comment_enc: encryptField(ctx, tenantId, CK, "comment_enc", id, d.comment),
              anonymised_at: null,
              created_at: at,
              updated_at: at,
            }),
            pmsAuditQuery(ctx, tenantId, who, { action: "pms.exercise_checkin.record", targetType: "pms_exercise_programme", targetId: programmeId, detail: { checkinId: id } }),
          ],
          { unique: "taken", foreignKey: "This programme is no longer available." },
        );
      } catch (err) {
        if (err instanceof RepoInputError && err.message === "taken") continue;
        throw err;
      }
      return (await getCheckin(ctx, tenantId, id)) as ExerciseCheckin;
    }
    const rev = num(existing.rev);
    const comment = encryptField(ctx, tenantId, CK, "comment_enc", existing.id, d.comment);
    const changed = await updateWithAudit(
      ctx,
      tenantId,
      who,
      ctx.db
        .updateTable(CK)
        .set({ completed: d.completed ? 1 : 0, pain_score: d.painScore, comment_enc: comment, rev: rev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", existing.id)
        .where("patient_id", "=", patientId)
        .where("rev", "=", rev),
      { action: "pms.exercise_checkin.record", targetType: "pms_exercise_programme", targetId: programmeId, detail: { checkinId: existing.id, changed: true } },
      ctx.db.selectFrom(CK).select("id").where("tenant_id", "=", tenantId).where("id", "=", existing.id).where("rev", "=", rev + 1).where("updated_at", "=", at),
    );
    if (changed) return (await getCheckin(ctx, tenantId, existing.id)) as ExerciseCheckin;
  }
  throw new RepoInputError("Your check-in changed in the meantime. Please try again.");
}

export async function getCheckin(ctx: RepoContext, tenantId: string, id: string): Promise<ExerciseCheckin | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(CK).select(CK_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toCheckin(ctx, row as CkRow, true) : null;
}

/* ------------------------------------------------------------------------------------------------
 * Anonymisation and subject access
 * ----------------------------------------------------------------------------------------------*/

/** The statements that clear a patient's programme and check-in text (for anonymisation's one batch). */
export function anonymiseExerciseQueries(ctx: DbContext, tenantId: string, patientId: string, at: string): BatchQuery[] {
  return [
    ctx.db
      .updateTable(PR)
      .set((eb) => ({ title_enc: null, notes_enc: null, items_enc: null, status: "ended", ended_at: eb.fn.coalesce("ended_at", eb.val(at)), anonymised_at: at, updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", patientId),
    ctx.db.updateTable(CK).set({ comment_enc: null, anonymised_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId),
  ];
}

/** A patient's programmes with their check-ins, decrypted (the subject-access copy). [] before the migrations. */
export async function exerciseDataForPatient(ctx: RepoContext, tenantId: string, patientId: string): Promise<{ programme: ExerciseProgramme; checkins: ExerciseCheckin[] }[]> {
  const list = await listProgrammesForPatient(ctx, tenantId, patientId);
  const out: { programme: ExerciseProgramme; checkins: ExerciseCheckin[] }[] = [];
  for (const s of list.slice().reverse()) {
    const programme = await getProgramme(ctx, tenantId, s.id);
    if (programme) out.push({ programme, checkins: await listCheckins(ctx, tenantId, s.id, { limit: 400 }) });
  }
  return out;
}
