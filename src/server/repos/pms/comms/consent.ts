/**
 * Message preferences. The flags themselves live on the shared patient record (reminderSms, reminderEmail,
 * marketingSms, marketingEmail – changed through the foundation's updatePatient(), which audits the patient
 * update); `pms_consent_events` keeps how and when each change happened (staff, a STOP reply, the stop-emails
 * link…), the evidence PECR asks a clinic to keep. Opting out of a channel also cancels the patient's planned
 * messages on it. Events are never deleted.
 */
import type { Selectable } from "kysely";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import { ConsentChangeSchema, type ConsentChange } from "../../../../modules/pms/comms/schemas";
import type { ConsentEvent, ConsentSource, MessageChannel, MessagePurpose } from "../../../../modules/pms/comms/types";
import type { PatientPatch } from "../../../../modules/pms/core/schemas";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { PmsConsentEventsTable } from "../../../db/pms-schema/comms";
import { RepoInputError, assertTenantId, nowIso, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";
import { getPatient, updatePatient } from "../patients";
import { cancelPendingForPatient } from "./schedule";

const T = "pms_consent_events";

function toEvent(r: Selectable<PmsConsentEventsTable>): ConsentEvent {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    channel: r.channel as MessageChannel,
    purpose: r.purpose as MessagePurpose,
    action: r.action as ConsentEvent["action"],
    source: r.source as ConsentSource,
    messageId: r.message_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function flagKey(channel: MessageChannel, purpose: MessagePurpose): "reminderSms" | "reminderEmail" | "marketingSms" | "marketingEmail" {
  if (purpose === "marketing") return channel === "sms" ? "marketingSms" : "marketingEmail";
  return channel === "sms" ? "reminderSms" : "reminderEmail";
}

export interface ConsentChangeResult {
  /** False when the preference already had that value (nothing written). */
  changed: boolean;
  /** Planned messages cancelled by an opt-out. */
  cancelled: number;
}

/**
 * Changes one preference of a patient and records how. Retries once when the record changed under it (a STOP
 * reply arriving while reception edits the record).
 */
export async function changeConsent(ctx: RepoContext, tenantId: string, input: ConsentChange, actor: PmsActor): Promise<ConsentChangeResult> {
  assertTenantId(tenantId);
  const d = parseInput(ConsentChangeSchema, input, "Message preference");
  const key = flagKey(d.channel, d.purpose);
  for (let attempt = 0; attempt < 3; attempt++) {
    const patient = await getPatient(ctx, tenantId, d.patientId);
    if (!patient) throw new RepoInputError("The patient does not exist in this clinic.");
    if (patient[key] === d.value) return { changed: false, cancelled: 0 };
    const patch: PatientPatch = { [key]: d.value };
    if (d.purpose === "marketing" && d.value) patch.marketingConsentSource = d.marketingConsentSource ?? null;
    // Withdrawing the last marketing channel clears the source (the foundation clears the time).
    const saved = await updatePatient(ctx, tenantId, patient.id, patient.rev, patch, actor);
    if (!saved.ok) {
      if (saved.reason === "conflict") continue;
      throw new RepoInputError("The patient does not exist in this clinic.");
    }
    const id = pmsId(P.consentEvent, ctx);
    const at = nowIso(ctx);
    const action = d.value ? "opt_in" : "opt_out";
    await writeWithAudit(ctx, [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        patient_id: patient.id,
        channel: d.channel,
        purpose: d.purpose,
        action,
        source: d.source,
        message_id: d.messageId ?? null,
        created_by: actor.userId,
        created_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.consent.change",
        targetType: "pms_patient",
        targetId: patient.id,
        detail: { channel: d.channel, purpose: d.purpose, action, source: d.source },
      }),
    ]);
    let cancelled = 0;
    // Opting out of texts stops every planned text; the stop-emails link stops reminder and follow-up emails only
    // (booking confirmations and change notices still go by email – consent.ts TRANSACTIONAL_KINDS).
    if (!d.value && d.purpose === "service") {
      cancelled = await cancelPendingForPatient(ctx, tenantId, patient.id, d.channel, "opted_out", actor, d.channel === "email" ? ["reminder", "dna"] : undefined);
    }
    return { changed: true, cancelled };
  }
  throw new RepoInputError("The patient's record kept changing. Please try again.");
}

/** How a patient's preferences changed, newest first. */
export async function listConsentEvents(ctx: DbContext, tenantId: string, patientId: string, limit = 50): Promise<ConsentEvent[]> {
  assertTenantId(tenantId);
  return (
    await ctx.db
      .selectFrom(T)
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", patientId)
      .orderBy("id", "desc")
      .limit(Math.min(Math.max(1, limit), 200))
      .execute()
  ).map(toEvent);
}
