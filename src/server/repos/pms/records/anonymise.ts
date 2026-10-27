/**
 * Anonymising one patient's record after the record-keeping period (rule: src/modules/pms/records/anonymise.ts).
 *
 * Removes: the name (→ "Anonymised patient <number>"), date of birth, sex, contact details, address, emergency
 * contact, GP, alerts and notes, import references, every note's text and body chart, every amendment's text and
 * reason, the outcome measures' answers, attached files (name, description and bytes), case referral reasons, notes,
 * membership and claim numbers, authorisation notes and codes.
 * Keeps: dates, note types and status, who wrote and signed what, outcome scores, payer types – the clinic's figures.
 *
 * Steps (no interactive transactions on D1): a "started" row first, then the records module's tables in ONE atomic
 * batch (the 0121 triggers allow these updates because anonymised_at is set in the same statement), then the
 * shared record through its own repositories (each audited there), then "done" and the audit row. Running it again
 * after an interruption finishes the job.
 */
import { anonymiseCheck, anonymisedLastName, ANONYMISED_FIRST_NAME, lastTreatmentDate } from "../../../../modules/pms/records/anonymise";
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import { ukToday } from "../../../../modules/pms/core/text";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch } from "../../../db/batch";
import { getAuthorisation, getCase, listAuthorisations, listCasesForPatient, updateAuthorisation, updateCase } from "../cases";
import { getPatient, setPatientStatus, updatePatient } from "../patients";
import { getPmsSettings } from "../settings";
import { RepoInputError, assertActor, assertId, assertTenantId, nowIso, pmsAuditQuery, pmsId, type RepoContext } from "../context";
import { lastSignedNoteDate } from "./notes";
import type { AnonymisationRecord } from "../../../../modules/pms/records/types";

const AN = "pms_patient_anonymisations";

export async function getAnonymisation(ctx: RepoContext, tenantId: string, patientId: string): Promise<AnonymisationRecord | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(AN).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).executeTakeFirst();
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    id: row.id,
    patientId: row.patient_id,
    status: row.status as AnonymisationRecord["status"],
    startedAt: row.started_at,
    doneAt: row.done_at,
    byUserId: row.by_user_id,
  };
}

/** The latest treatment date the record shows (last seen, last signed note, last case closed). */
export async function patientLastTreatment(ctx: RepoContext, tenantId: string, patientId: string, lastSeenOn: string | null): Promise<string | null> {
  const [note, cases] = await Promise.all([lastSignedNoteDate(ctx, tenantId, patientId), listCasesForPatient(ctx, tenantId, patientId)]);
  return lastTreatmentDate([lastSeenOn, note, ...cases.map((c) => c.closedOn)]);
}

/** Whether the record may be anonymised today, and why not (for the page and the action). */
export async function anonymiseEligibility(ctx: RepoContext, tenantId: string, patientId: string) {
  const patient = await getPatient(ctx, tenantId, patientId);
  if (!patient) return null;
  const [settings, done, last] = await Promise.all([
    getPmsSettings(ctx, tenantId),
    getAnonymisation(ctx, tenantId, patientId),
    patientLastTreatment(ctx, tenantId, patientId, patient.lastSeenOn),
  ]);
  const today = ukToday(ctx.now ? ctx.now() : new Date());
  const check = anonymiseCheck(
    { dateOfBirth: patient.dateOfBirth, lastTreatmentOn: last, legalHold: patient.legalHold, status: patient.status, alreadyAnonymised: done?.status === "done" },
    today,
    { adultYears: settings.retentionAdultYears, childUntilAge: settings.retentionChildUntilAge },
  );
  return { patient, check, lastTreatmentOn: last, today };
}

export interface AnonymiseOptions {
  /** The patient's number, typed by the person to confirm. */
  confirmNumber: number;
  /** Ticked: "I have reviewed this record and it no longer needs to be kept" (required when the rules give no date). */
  reviewed: boolean;
}

export interface AnonymiseResult {
  notes: number;
  amendments: number;
  outcomes: number;
  attachments: number;
  cases: number;
  authorisations: number;
}

export async function anonymisePatient(ctx: RepoContext, tenantId: string, patientId: string, options: AnonymiseOptions, actor: PmsActor): Promise<AnonymiseResult> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const who = assertActor(actor);
  const state = await anonymiseEligibility(ctx, tenantId, patientId);
  if (!state) throw new RepoInputError("The patient does not exist in this clinic.");
  const { patient, check } = state;
  if (!check.allowed) {
    const when = check.decision?.kind === "review_from" ? ` It can be reviewed from ${check.decision.date.split("-").reverse().join("/")}.` : "";
    throw new RepoInputError(`${check.message}${when}`);
  }
  if (check.needsReview && !options.reviewed) throw new RepoInputError("Confirm that you have reviewed this record and that it no longer needs to be kept.");
  if (options.confirmNumber !== patient.patientNumber) throw new RepoInputError("Type the patient's number to confirm.");

  const at = nowIso(ctx);
  const existing = await getAnonymisation(ctx, tenantId, patientId);
  if (!existing) {
    await ctx.db
      .insertInto(AN)
      .values({ tenant_id: tenantId, id: pmsId(P.anonymisation, ctx), patient_id: patientId, status: "started", started_at: at, done_at: null, by_user_id: who.userId, counts_json: null, created_at: at, updated_at: at })
      .execute();
  }

  // 1. The records module's own tables: one atomic batch.
  const db = ctx.db;
  const results = await runBatch(db, [
    db
      .updateTable("pms_clinical_notes")
      .set({ sections_enc: null, body_chart_enc: null, import_ref: null, anonymised_at: at, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", patientId),
    db
      .updateTable("pms_note_amendments")
      .set({ text_enc: null, reason_enc: null, anonymised_at: at })
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", patientId),
    db
      .updateTable("pms_outcome_measures")
      .set({ answers_enc: null, error_reason_enc: null, import_ref: null, anonymised_at: at, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", patientId),
    db
      .updateTable("pms_attachment_chunks")
      .set({ data_enc: null })
      .where("tenant_id", "=", tenantId)
      .where("attachment_id", "in", (eb) => eb.selectFrom("pms_attachments").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId)),
    db
      .updateTable("pms_attachments")
      .set((eb) => ({
        file_name_enc: null,
        description_enc: null,
        withdrawn_reason_enc: null,
        status: "withdrawn",
        withdrawn_at: eb.fn.coalesce("withdrawn_at", eb.val(at)),
        anonymised_at: at,
        updated_at: at,
      }))
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", patientId),
  ]);
  const affected = (i: number) => Number((results[i] as { numAffectedRows?: bigint | number })?.numAffectedRows ?? 0);

  // 2. The shared record, through its own repositories (each change audited there).
  const cases = await listCasesForPatient(ctx, tenantId, patientId);
  for (const c of cases) {
    const full = await getCase(ctx, tenantId, c.id);
    if (!full) continue;
    const saved = await updateCase(ctx, tenantId, c.id, full.rev, { referralReason: null, notes: null, membershipNumber: null, claimReference: null, importRef: null }, who);
    if (!saved.ok) throw new RepoInputError("A case changed while it was being anonymised. Run it again.");
  }
  const auths = await listAuthorisations(ctx, tenantId, { patientId });
  for (let i = 0; i < auths.length; i++) {
    const full = await getAuthorisation(ctx, tenantId, auths[i].id);
    if (!full) continue;
    if (full.code.startsWith("ANON-") && !full.notes && !full.importRef) continue;
    const saved = await updateAuthorisation(ctx, tenantId, full.id, full.rev, { code: `ANON-${i + 1}`, notes: null, importRef: null }, who);
    if (!saved.ok) throw new RepoInputError("An authorisation changed while it was being anonymised. Run it again.");
  }
  const fresh = await getPatient(ctx, tenantId, patientId);
  if (!fresh) throw new RepoInputError("The patient does not exist in this clinic.");
  const saved = await updatePatient(
    ctx,
    tenantId,
    patientId,
    fresh.rev,
    {
      title: null,
      firstName: ANONYMISED_FIRST_NAME,
      lastName: anonymisedLastName(fresh.patientNumber),
      preferredName: null,
      dateOfBirth: null,
      sex: null,
      email: null,
      phoneMobile: null,
      phoneHome: null,
      phoneWork: null,
      address: null,
      postcode: null,
      occupation: null,
      employer: null,
      emergencyName: null,
      emergencyPhone: null,
      emergencyRelationship: null,
      gpName: null,
      gpPractice: null,
      gpPhone: null,
      gpAddress: null,
      gpPostcode: null,
      consentShareGp: false,
      reminderSms: false,
      reminderEmail: false,
      marketingEmail: false,
      marketingSms: false,
      marketingConsentSource: null,
      alerts: null,
      notes: null,
      importRef: null,
    },
    who,
  );
  if (!saved.ok) throw new RepoInputError("The patient's details changed while they were being anonymised. Run it again.");
  if (fresh.status === "active") await setPatientStatus(ctx, tenantId, patientId, "archived", who);

  const counts: AnonymiseResult = { notes: affected(0), amendments: affected(1), outcomes: affected(2), attachments: affected(4), cases: cases.length, authorisations: auths.length };
  const done = nowIso(ctx);
  await runBatch(db, [
    db.updateTable(AN).set({ status: "done", done_at: done, counts_json: JSON.stringify(counts), updated_at: done }).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId),
    pmsAuditQuery(ctx, tenantId, who, { action: "pms.patient.anonymise", targetType: "pms_patient", targetId: patientId, detail: { ...counts, reviewed: options.reviewed } }),
  ]);
  return counts;
}
