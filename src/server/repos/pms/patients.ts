/**
 * `pms_patients` – the shared patient record (owned by the foundation; every module reads it through here).
 *
 * - Demographics and contact details are plain, indexed columns (lists and the diary show them); medical alerts
 *   and notes are encrypted (alerts_enc, notes_enc).
 * - patient_number: 1, 2, 3… per clinic, given by the database in the same statement as the insert (unique per
 *   clinic; a rare clash between two simultaneous registrations is retried).
 * - Updates carry the revision the editor saw (expectedRev): a stale form gets "conflict", never overwrites.
 * - Patients are NEVER deleted by the app (clinical records retention, contract §4): archive instead. Only
 *   offboarding a whole clinic removes them, after a verified export.
 * - Lists return summaries (nothing decrypted); getPatient() decrypts.
 */
import { sql, type Selectable } from "kysely";
import { FOUNDATION_ID_PREFIXES as P } from "../../../modules/pms/core/ids";
import { patientInputSchema, patientPatchSchema, type PatientInput, type PatientPatch } from "../../../modules/pms/core/schemas";
import { isIsoDate, phoneDigits, searchKey, ukToday } from "../../../modules/pms/core/text";
import type { MarketingSource, Patient, PatientStatus, PatientSummary, PmsActor, PmsSaveResult, Sex } from "../../../modules/pms/core/types";
import { runBatch } from "../../db/batch";
import { patientSiteFilter } from "./access";
import { classifyDbError } from "../../db/errors";
import type { PmsPatientsTable } from "../../db/pms-schema/foundation";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  decryptField,
  encryptField,
  guarded,
  isOn,
  jsonLines,
  nowIso,
  num,
  parseInput,
  parseLines,
  patchColumns,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  translateDbError,
  type RepoContext,
} from "./context";
import { pmsNow } from "../../../modules/pms/core/clock";

const T = "pms_patients";

/** Ids per statement of an import undo (D1: 100 bound parameters). */
const UNDO_GROUP = 90;

/** Items whose stored revision is still the one given, read 90 at a time; grouped by that revision. */
async function stillAtRevision(ctx: RepoContext, table: "pms_patients", tenantId: string, items: readonly { id: string; rev: number }[]): Promise<Map<number, string[]>> {
  const wanted = new Map(items.map((i) => [i.id, i.rev]));
  const ids = Array.from(wanted.keys());
  const byRev = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += UNDO_GROUP) {
    const rows = await ctx.db.selectFrom(table).select(["id", "rev"]).where("tenant_id", "=", tenantId).where("id", "in", ids.slice(i, i + UNDO_GROUP)).execute();
    for (const r of rows) {
      const rev = num(r.rev);
      if (wanted.get(r.id) !== rev) continue;
      const list = byRev.get(rev);
      if (list) list.push(r.id);
      else byRev.set(rev, [r.id]);
    }
  }
  return byRev;
}

const MESSAGES = { unique: "A patient with this import reference already exists.", foreignKey: "The patient this record merges into does not exist." };

type Row = Selectable<PmsPatientsTable>;

const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "patient_number",
  "title",
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "phone_mobile",
  "email",
  "postcode",
  "status",
  "alerts_enc",
  "legal_hold",
  "last_seen_on",
  "import_ref",
  "updated_at",
] as const;

function toSummary(r: Pick<Row, (typeof SUMMARY_COLUMNS)[number]>): PatientSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientNumber: num(r.patient_number),
    title: r.title,
    firstName: r.first_name,
    lastName: r.last_name,
    preferredName: r.preferred_name,
    dateOfBirth: r.date_of_birth,
    phoneMobile: r.phone_mobile,
    email: r.email,
    postcode: r.postcode,
    status: r.status as PatientStatus,
    hasAlerts: Boolean(r.alerts_enc),
    legalHold: isOn(r.legal_hold),
    lastSeenOn: r.last_seen_on,
    importRef: r.import_ref,
    updatedAt: r.updated_at,
  };
}

function toPatient(ctx: RepoContext, r: Row): Patient {
  return {
    ...toSummary(r),
    rev: num(r.rev),
    sex: (r.sex as Sex | null) ?? null,
    phoneHome: r.phone_home,
    phoneWork: r.phone_work,
    address: parseLines(r.address_json),
    occupation: r.occupation,
    employer: r.employer,
    emergencyName: r.emergency_name,
    emergencyPhone: r.emergency_phone,
    emergencyRelationship: r.emergency_relationship,
    gpName: r.gp_name,
    gpPractice: r.gp_practice,
    gpPhone: r.gp_phone,
    gpAddress: parseLines(r.gp_address_json),
    gpPostcode: r.gp_postcode,
    consentTreatment: isOn(r.consent_treatment),
    consentTreatmentAt: r.consent_treatment_at,
    consentShareGp: isOn(r.consent_share_gp),
    reminderSms: isOn(r.reminder_sms),
    reminderEmail: isOn(r.reminder_email),
    marketingEmail: isOn(r.marketing_email),
    marketingSms: isOn(r.marketing_sms),
    marketingConsentAt: r.marketing_consent_at,
    marketingConsentSource: (r.marketing_consent_source as MarketingSource | null) ?? null,
    alerts: decryptField(ctx, r.tenant_id, T, "alerts_enc", r.id, r.alerts_enc),
    notes: decryptField(ctx, r.tenant_id, T, "notes_enc", r.id, r.notes_enc),
    mergedIntoId: r.merged_into_id,
    archivedAt: r.archived_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function today(ctx: RepoContext): string {
  return ukToday(ctx.now ? ctx.now() : pmsNow());
}

type ParsedPatient = ReturnType<ReturnType<typeof patientInputSchema>["parse"]>;

/** The full insert row for a new patient (patient_number filled in by the caller). */
function newPatientValues(ctx: RepoContext, tenantId: string, id: string, d: ParsedPatient, actor: PmsActor, at: string) {
  const marketing = Boolean(d.marketingEmail || d.marketingSms);
  return {
    tenant_id: tenantId,
    id,
    rev: 1,
    title: d.title ?? null,
    first_name: d.firstName,
    last_name: d.lastName,
    preferred_name: d.preferredName ?? null,
    date_of_birth: d.dateOfBirth ?? null,
    sex: d.sex ?? null,
    email: d.email ?? null,
    phone_mobile: d.phoneMobile ?? null,
    phone_home: d.phoneHome ?? null,
    phone_work: d.phoneWork ?? null,
    address_json: jsonLines(d.address),
    postcode: d.postcode ?? null,
    occupation: d.occupation ?? null,
    employer: d.employer ?? null,
    emergency_name: d.emergencyName ?? null,
    emergency_phone: d.emergencyPhone ?? null,
    emergency_relationship: d.emergencyRelationship ?? null,
    gp_name: d.gpName ?? null,
    gp_practice: d.gpPractice ?? null,
    gp_phone: d.gpPhone ?? null,
    gp_address_json: jsonLines(d.gpAddress),
    gp_postcode: d.gpPostcode ?? null,
    consent_treatment: b01(d.consentTreatment ?? false),
    consent_treatment_at: d.consentTreatment ? at : null,
    consent_share_gp: b01(d.consentShareGp ?? false),
    reminder_sms: b01(d.reminderSms ?? true),
    reminder_email: b01(d.reminderEmail ?? true),
    marketing_email: b01(d.marketingEmail ?? false),
    marketing_sms: b01(d.marketingSms ?? false),
    marketing_consent_at: marketing ? at : null,
    marketing_consent_source: marketing ? (d.marketingConsentSource ?? null) : null,
    alerts_enc: encryptField(ctx, tenantId, T, "alerts_enc", id, d.alerts),
    notes_enc: encryptField(ctx, tenantId, T, "notes_enc", id, d.notes),
    search_name: searchKey(d.firstName, d.lastName, d.preferredName),
    search_phone: [d.phoneMobile, d.phoneHome, d.phoneWork].map(phoneDigits).filter(Boolean).join(" "),
    status: "active",
    legal_hold: 0,
    last_seen_on: null,
    merged_into_id: null,
    archived_at: null,
    import_ref: d.importRef ?? null,
    created_by: actor.userId,
    created_at: at,
    updated_at: at,
  };
}

/** Registers a patient. Returns the record (with its new patient number). */
export async function createPatient(ctx: RepoContext, tenantId: string, input: PatientInput, actor: PmsActor): Promise<Patient> {
  assertTenantId(tenantId);
  const d = parseInput(patientInputSchema(today(ctx)), input, "Patient");
  const id = pmsId(P.patient, ctx);
  const at = nowIso(ctx);
  const values = newPatientValues(ctx, tenantId, id, d, actor, at);
  for (let attempt = 0; ; attempt++) {
    try {
      await runBatch(ctx.db, [
        ctx.db.insertInto(T).values({
          ...values,
          patient_number: sql<number>`(select coalesce(max(p.patient_number), 0) + 1 from pms_patients p where p.tenant_id = ${tenantId})`,
        }),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.patient.create", targetType: "pms_patient", targetId: id }),
      ]);
      break;
    } catch (err) {
      // Two registrations at the same moment can pick the same number: try again (the import reference is the
      // other unique column – that one is a real duplicate).
      const duplicateNumber = classifyDbError(err) === "CONSTRAINT_UNIQUE" && !(await importRefTaken(ctx, tenantId, values.import_ref));
      if (duplicateNumber && attempt < 5) continue;
      throw translateDbError(err, MESSAGES);
    }
  }
  return (await getPatient(ctx, tenantId, id)) as Patient;
}

async function importRefTaken(ctx: RepoContext, tenantId: string, importRef: string | null): Promise<boolean> {
  if (!importRef) return false;
  const row = await ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("import_ref", "=", importRef).executeTakeFirst();
  return Boolean(row);
}

export interface BulkCreateResult {
  ids: string[];
  /** The first and last patient numbers given. */
  firstNumber: number;
  lastNumber: number;
}

/**
 * Registers many patients at once (the demo seed and imports): in batches of 40, each batch atomic with ONE audit
 * row ("pms.patient.bulk_create", counts and ids range only). Numbers continue from the clinic's highest. For a
 * single writer per clinic (scripts): a concurrent registration makes the batch fail on the unique number and
 * nothing of that batch is written.
 */
export async function bulkCreatePatients(ctx: RepoContext, tenantId: string, inputs: PatientInput[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<BulkCreateResult> {
  assertTenantId(tenantId);
  if (inputs.length === 0) return { ids: [], firstNumber: 0, lastNumber: 0 };
  const schema = patientInputSchema(today(ctx));
  const parsed = inputs.map((input, i) => parseInput(schema, input, `Patient ${i + 1}`));
  const max = await ctx.db
    .selectFrom(T)
    .select((eb) => eb.fn.max("patient_number").as("n"))
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
  let next = num(max?.n ?? 0) + 1;
  const firstNumber = next;
  const ids: string[] = [];
  const at = nowIso(ctx);
  for (let i = 0; i < parsed.length; i += 40) {
    const chunk = parsed.slice(i, i + 40);
    const rows = chunk.map((d) => {
      const id = pmsId(P.patient, ctx);
      ids.push(id);
      return { ...newPatientValues(ctx, tenantId, id, d, actor, at), patient_number: next++ };
    });
    try {
      await runBatch(ctx.db, [
        ...rows.map((row) => ctx.db.insertInto(T).values(row)),
        pmsAuditQuery(ctx, tenantId, actor, {
          action: "pms.patient.bulk_create",
          targetType: "pms_patient",
          targetId: rows[0].id,
          detail: { ...detail, count: rows.length, firstNumber: rows[0].patient_number, lastNumber: rows[rows.length - 1].patient_number },
        }),
      ]);
    } catch (err) {
      throw translateDbError(err, MESSAGES);
    }
  }
  return { ids, firstNumber, lastNumber: next - 1 };
}

/** Updates a patient's details with the revision the editor saw. */
export async function updatePatient(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: PatientPatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "patient id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(patientPatchSchema(today(ctx)), patch, "Patient");
  const current = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  const at = nowIso(ctx);
  const set: Record<string, unknown> = {};
  const lines = (v: string[] | null) => jsonLines(v);
  const flag = (v: boolean) => b01(v);
  const fields = patchColumns(
    d,
    {
      title: "title",
      firstName: "first_name",
      lastName: "last_name",
      preferredName: "preferred_name",
      dateOfBirth: "date_of_birth",
      sex: "sex",
      email: "email",
      phoneMobile: "phone_mobile",
      phoneHome: "phone_home",
      phoneWork: "phone_work",
      address: ["address_json", lines],
      postcode: "postcode",
      occupation: "occupation",
      employer: "employer",
      emergencyName: "emergency_name",
      emergencyPhone: "emergency_phone",
      emergencyRelationship: "emergency_relationship",
      gpName: "gp_name",
      gpPractice: "gp_practice",
      gpPhone: "gp_phone",
      gpAddress: ["gp_address_json", lines],
      gpPostcode: "gp_postcode",
      consentShareGp: ["consent_share_gp", flag],
      reminderSms: ["reminder_sms", flag],
      reminderEmail: ["reminder_email", flag],
      alerts: ["alerts_enc", (v: string | null) => encryptField(ctx, tenantId, T, "alerts_enc", id, v)],
      notes: ["notes_enc", (v: string | null) => encryptField(ctx, tenantId, T, "notes_enc", id, v)],
      importRef: "import_ref",
    },
    set,
  );
  // Consent: the time is recorded when it is given; withdrawing clears it.
  if (d.consentTreatment !== undefined && d.consentTreatment !== isOn(current.consent_treatment)) {
    set.consent_treatment = b01(d.consentTreatment);
    set.consent_treatment_at = d.consentTreatment ? at : null;
    fields.push("consentTreatment");
  }
  const marketingEmail = d.marketingEmail ?? isOn(current.marketing_email);
  const marketingSms = d.marketingSms ?? isOn(current.marketing_sms);
  if (d.marketingEmail !== undefined || d.marketingSms !== undefined || d.marketingConsentSource !== undefined) {
    const before = isOn(current.marketing_email) || isOn(current.marketing_sms);
    const after = marketingEmail || marketingSms;
    const source = d.marketingConsentSource === undefined ? current.marketing_consent_source : d.marketingConsentSource;
    if (after && !source) throw new RepoInputError("Patient: marketingConsentSource: Record how the patient agreed to marketing");
    set.marketing_email = b01(marketingEmail);
    set.marketing_sms = b01(marketingSms);
    set.marketing_consent_source = after ? source : null;
    set.marketing_consent_at = after ? (before ? current.marketing_consent_at : at) : null;
    fields.push("marketing");
  }
  if (d.firstName !== undefined || d.lastName !== undefined || d.preferredName !== undefined) {
    set.search_name = searchKey(
      d.firstName ?? current.first_name,
      d.lastName ?? current.last_name,
      d.preferredName === undefined ? current.preferred_name : d.preferredName,
    );
  }
  if (d.phoneMobile !== undefined || d.phoneHome !== undefined || d.phoneWork !== undefined) {
    const pick = (v: string | null | undefined, old: string | null) => (v === undefined ? old : v);
    set.search_phone = [pick(d.phoneMobile, current.phone_mobile), pick(d.phoneHome, current.phone_home), pick(d.phoneWork, current.phone_work)]
      .map(phoneDigits)
      .filter(Boolean)
      .join(" ");
  }
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: current.updated_at };
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(T)
        .set({ ...set, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .executeTakeFirst(),
    MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.patient.update", targetType: "pms_patient", targetId: id, detail: { fields, rev: expectedRev + 1 } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** Archives or restores a patient (or records that they have died). Never deletes. */
export async function setPatientStatus(ctx: RepoContext, tenantId: string, id: string, status: PatientStatus, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "patient id");
  if (!["active", "archived", "deceased"].includes(status)) throw new RepoInputError("Status must be active, archived or deceased.");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set((eb) => ({ status, archived_at: status === "active" ? null : at, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("status", "!=", status)
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.patient.status", targetType: "pms_patient", targetId: id, detail: { status } });
  return changed;
}

/** Puts a record on hold (it must be kept whatever the retention rules say) or takes the hold off. */
export async function setPatientLegalHold(ctx: RepoContext, tenantId: string, id: string, hold: boolean, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "patient id");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set((eb) => ({ legal_hold: b01(hold), rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("legal_hold", "=", b01(!hold))
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.patient.legal_hold", targetType: "pms_patient", targetId: id, detail: { hold } });
  return changed;
}

/**
 * Moves "last seen" forward to `date` (the diary calls this when an appointment is marked attended). A derived
 * column: the diary's own audited write is the record of it, so no extra audit row. Never moves backwards.
 */
export async function touchPatientLastSeen(ctx: RepoContext, tenantId: string, id: string, date: string): Promise<void> {
  assertTenantId(tenantId);
  assertId(id, "patient id");
  if (!isIsoDate(date)) throw new RepoInputError("date must be YYYY-MM-DD.");
  await ctx.db
    .updateTable(T)
    .set({ last_seen_on: date })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where((eb) => eb.or([eb("last_seen_on", "is", null), eb("last_seen_on", "<", date)]))
    .execute();
}

/** One patient, alerts and notes decrypted. */
export async function getPatient(ctx: RepoContext, tenantId: string, id: string): Promise<Patient | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toPatient(ctx, row) : null;
}

/** Summaries by id (the diary and lists), in groups of 90 (D1's parameter limit). */
export async function getPatientSummaries(ctx: RepoContext, tenantId: string, ids: string[]): Promise<Map<string, PatientSummary>> {
  assertTenantId(tenantId);
  const out = new Map<string, PatientSummary>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom(T)
      .select(SUMMARY_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("id", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) out.set(r.id, toSummary(r));
  }
  return out;
}

export interface SearchPatientsOptions {
  /** Name words, a patient number, a phone number, a date of birth (DD/MM/YYYY or YYYY-MM-DD), an email or postcode. */
  q?: string;
  status?: PatientStatus | "any";
  /** Default 25, at most 100. */
  limit?: number;
  offset?: number;
  /** A member's site scope (K2-SITE-004; null/undefined = every site): see patientSiteFilter in ./access.ts. */
  siteIds?: ReadonlySet<string> | null;
}

/** Finds patients (summaries), by last name then first name. */
export async function searchPatients(ctx: RepoContext, tenantId: string, options: SearchPatientsOptions = {}): Promise<PatientSummary[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 25)), 100);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  let q = ctx.db.selectFrom(T).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId);
  if (options.siteIds) q = q.where(patientSiteFilter(tenantId, options.siteIds));
  const status = options.status ?? "active";
  if (status !== "any") q = q.where("status", "=", status);
  const text = (options.q ?? "").trim().slice(0, 120);
  if (text) {
    const ukDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    const digits = phoneDigits(text);
    if (ukDate || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const iso = ukDate ? `${ukDate[3]}-${ukDate[2].padStart(2, "0")}-${ukDate[1].padStart(2, "0")}` : text;
      q = q.where("date_of_birth", "=", iso);
    } else if (/^[0-9 +()-]+$/.test(text) && digits.length > 0) {
      // Up to 5 digits: a patient number. 6 or more: part of a phone number (or a long patient number).
      const n = Number(digits);
      if (digits.length < 6) q = q.where("patient_number", "=", n);
      else if (digits.length <= 7) q = q.where((eb) => eb.or([eb("patient_number", "=", n), eb("search_phone", "like", `%${digits}%`)]));
      else q = q.where("search_phone", "like", `%${digits}%`);
    } else if (text.includes("@")) {
      q = q.where("email", "=", text.toLowerCase());
    } else {
      for (const word of searchKey(text).split(" ").filter(Boolean).slice(0, 5)) {
        q = q.where("search_name", "like", `%${word}%`);
      }
    }
  }
  const rows = await q.orderBy("last_name").orderBy("first_name").orderBy("patient_number").limit(limit).offset(offset).execute();
  return rows.map(toSummary);
}

/** Number of patients (by status). */
export async function countPatients(ctx: RepoContext, tenantId: string, status: PatientStatus | "any" = "active"): Promise<number> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tenantId);
  if (status !== "any") q = q.where("status", "=", status);
  const row = await q.executeTakeFirst();
  return num(row?.n ?? 0);
}

/**
 * Undo of an import (integration): each patient still exactly as imported (the revision the import wrote) has its
 * import reference released and is archived – one UPDATE per group of up to 90 with the same revision and one
 * audit row per group ("pms.patient.import_undo", the count), all in one batch. Returns the ids changed
 * (RETURNING – a patient edited meanwhile is left as it is).
 */
export async function archiveImportedPatients(ctx: RepoContext, tenantId: string, items: readonly { id: string; rev: number }[], actor: PmsActor): Promise<Set<string>> {
  assertTenantId(tenantId);
  for (const i of items) assertId(i.id, "patient id");
  const at = nowIso(ctx);
  const done = new Set<string>();
  const queries = [];
  for (const [rev, ids] of Array.from((await stillAtRevision(ctx, T, tenantId, items)).entries())) {
    for (let i = 0; i < ids.length; i += UNDO_GROUP) {
      const group = ids.slice(i, i + UNDO_GROUP);
      queries.push(
        ctx.db
          .updateTable(T)
          .set((eb) => ({ import_ref: null, status: "archived", archived_at: eb.fn.coalesce("archived_at", sql<string>`${at}`), rev: eb("rev", "+", 1), updated_at: at }))
          .where("tenant_id", "=", tenantId)
          .where("id", "in", group)
          .where("rev", "=", rev)
          .returning("id"),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.patient.import_undo", targetType: "pms_patient", targetId: group[0], detail: { count: group.length } }),
      );
    }
  }
  for (let i = 0; i < queries.length; i += 90) {
    for (const r of await runBatch(ctx.db, queries.slice(i, i + 90))) for (const row of r.rows) if (typeof row.id === "string") done.add(row.id);
  }
  return done;
}
