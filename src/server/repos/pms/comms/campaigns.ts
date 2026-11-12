/**
 * Bulk email to groups of patients (migration 0146, tracker xt02): the clinic's setting, campaigns, the audience
 * query and the recipients. The rules (who may get marketing, the merge fields, the formatting) are pure:
 * src/modules/pms/comms/campaigns.ts; sending is src/server/pms/comms/campaigns/send.ts.
 *
 * - The setting: one row per clinic, no row = OFF. Revision-checked like the message settings.
 * - A campaign is edited only while it is a draft (conditional UPDATE … WHERE status = 'draft' AND rev = ?), then
 *   scheduled (a time, "now" for Send now), and can be cancelled while it is a draft or scheduled.
 * - When the message run reaches a scheduled campaign it claims it (scheduled → sending, conditional), writes ONE
 *   recipient row per address (the audience as it is at that moment, deduplicated by the lower-case email; the
 *   unique indexes make a second writer harmless), then sets recipients_total – until then a "sending" campaign with
 *   recipients_total 0 is picked up again and its recipients written again (INSERT … ON CONFLICT DO NOTHING).
 * - Recipients are claimed conditionally (pending → processing with a claim token) so two runs never send one.
 * - Subject and body are encrypted (AAD per row); lists never decrypt. Every change and its audit row are one batch.
 * - Never deleted (only offboarding a clinic deletes).
 */
import { sql, type Expression, type SqlBool } from "kysely";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import {
  BulkEmailSettingsInputSchema,
  CampaignInputSchema,
  DEFAULT_DAILY_CAP,
  audienceBounds,
  normaliseAudience,
  parseAudienceJson,
  type AudienceFilters,
  type BulkEmailSettingsInput,
  type CampaignInput,
  type CampaignPurpose,
  type CampaignStatus,
  type RecipientStatus,
} from "../../../../modules/pms/comms/campaigns";
import type { AudienceCount, BulkEmailSettings, Campaign, CampaignReport, CampaignSummary } from "../../../../modules/pms/comms/campaign-view";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
export type { AudienceCount, BulkEmailSettings, Campaign, CampaignReport, CampaignSummary };
import { ukToday } from "../../../../modules/pms/core/text";
import { runBatch, type BatchQuery } from "../../../db/batch";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  decryptField,
  encryptField,
  isOn,
  nowIso,
  num,
  parseInput,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type DbContext,
  type RepoContext,
} from "../context";
import { affected, changeWithAudit, commsAuditWhen } from "./shared";

const S = "pms_bulk_email_settings";
const C = "pms_email_campaigns";
const R = "pms_email_campaign_recipients";

/* ------------------------------------------------------------------------------------------------
 * The clinic's setting
 * ----------------------------------------------------------------------------------------------*/

export async function getBulkEmailSettings(ctx: DbContext, tenantId: string): Promise<BulkEmailSettings> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(S).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!r)
    return {
      tenantId,
      rev: 0,
      enabled: false,
      dailyCap: DEFAULT_DAILY_CAP,
      updatedAt: null,
    };
  return {
    tenantId,
    rev: num(r.rev),
    enabled: isOn(r.enabled),
    dailyCap: num(r.daily_cap),
    updatedAt: r.updated_at,
  };
}

export async function updateBulkEmailSettings(ctx: DbContext, tenantId: string, expectedRev: number, input: BulkEmailSettingsInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("expectedRev must be a whole number.");
  const d = parseInput(BulkEmailSettingsInputSchema, input, "Bulk email settings");
  const current = await getBulkEmailSettings(ctx, tenantId);
  if (current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current.rev };
  const at = nowIso(ctx);
  const audit = {
    action: "pms.bulk_email_settings.update",
    targetType: "pms_bulk_email_settings",
    targetId: tenantId,
    detail: { enabled: d.enabled, dailyCap: d.dailyCap, rev: expectedRev + 1 },
  };
  if (expectedRev === 0) {
    try {
      await writeWithAudit(ctx, [
        ctx.db.insertInto(S).values({
          tenant_id: tenantId,
          rev: 1,
          enabled: b01(d.enabled),
          daily_cap: d.dailyCap,
          updated_by: actor.userId,
          created_at: at,
          updated_at: at,
        }),
        pmsAuditQuery(ctx, tenantId, actor, audit),
      ]);
    } catch (err) {
      if (err instanceof RepoInputError)
        return {
          ok: false,
          reason: "conflict",
          currentRev: (await getBulkEmailSettings(ctx, tenantId)).rev,
        };
      throw err;
    }
    return { ok: true, rev: 1, updatedAt: at };
  }
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(S)
      .set({
        enabled: b01(d.enabled),
        daily_cap: d.dailyCap,
        rev: expectedRev + 1,
        updated_by: actor.userId,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("rev", "=", expectedRev),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      audit,
      ctx.db
        .selectFrom(S)
        .select("tenant_id")
        .where("tenant_id", "=", tenantId)
        .where("rev", "=", expectedRev + 1)
        .where("updated_at", "=", at),
    ),
  ]);
  if (changed === 0)
    return {
      ok: false,
      reason: "conflict",
      currentRev: (await getBulkEmailSettings(ctx, tenantId)).rev,
    };
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/* ------------------------------------------------------------------------------------------------
 * Campaigns
 * ----------------------------------------------------------------------------------------------*/

type CampaignRow = {
  tenant_id: string;
  id: string;
  rev: number;
  name: string;
  purpose: string;
  service_reason: string | null;
  audience_json: string;
  status: string;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  recipients_total: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "name",
  "purpose",
  "service_reason",
  "audience_json",
  "status",
  "scheduled_for",
  "started_at",
  "finished_at",
  "cancelled_at",
  "recipients_total",
  "created_by",
  "created_at",
  "updated_at",
] as const;

function toSummary(r: CampaignRow): CampaignSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    name: r.name,
    purpose: r.purpose as CampaignPurpose,
    serviceReason: r.service_reason,
    audience: parseAudienceJson(r.audience_json),
    status: r.status as CampaignStatus,
    scheduledFor: r.scheduled_for,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    cancelledAt: r.cancelled_at,
    recipientsTotal: num(r.recipients_total),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function encrypted(ctx: RepoContext, tenantId: string, id: string, subject: string, body: string) {
  return {
    subject_enc: encryptField(ctx, tenantId, C, "subject_enc", id, subject) as string,
    body_enc: encryptField(ctx, tenantId, C, "body_enc", id, body) as string,
  };
}

export async function createCampaign(ctx: RepoContext, tenantId: string, input: CampaignInput, actor: PmsActor): Promise<{ id: string; rev: number }> {
  assertTenantId(tenantId);
  const d = parseInput(CampaignInputSchema, input, "Bulk email");
  const id = pmsId(P.campaign, ctx);
  const at = nowIso(ctx);
  const audience = normaliseAudience(d.audience);
  await writeWithAudit(ctx, [
    ctx.db.insertInto(C).values({
      tenant_id: tenantId,
      id,
      rev: 1,
      name: d.name,
      purpose: d.purpose,
      service_reason: d.purpose === "service" ? (d.serviceReason ?? "").trim() : null,
      ...encrypted(ctx, tenantId, id, d.subject, d.body),
      audience_json: JSON.stringify(audience),
      status: "draft",
      scheduled_for: null,
      started_at: null,
      finished_at: null,
      cancelled_at: null,
      recipients_total: 0,
      created_by: actor.userId,
      scheduled_by: null,
      created_at: at,
      updated_at: at,
    }),
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.email_campaign.create",
      targetType: "pms_email_campaign",
      targetId: id,
      detail: { purpose: d.purpose },
    }),
  ]);
  return { id, rev: 1 };
}

/** Changes a DRAFT (with the revision the editor saw). Not a draft any more → not_found. */
export async function updateCampaign(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, input: CampaignInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "campaign id");
  const d = parseInput(CampaignInputSchema, input, "Bulk email");
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(C)
      .set({
        name: d.name,
        purpose: d.purpose,
        service_reason: d.purpose === "service" ? (d.serviceReason ?? "").trim() : null,
        ...encrypted(ctx, tenantId, id, d.subject, d.body),
        audience_json: JSON.stringify(normaliseAudience(d.audience)),
        rev: expectedRev + 1,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "draft")
      .where("rev", "=", expectedRev),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      {
        action: "pms.email_campaign.update",
        targetType: "pms_email_campaign",
        targetId: id,
        detail: { purpose: d.purpose, rev: expectedRev + 1 },
      },
      ctx.db
        .selectFrom(C)
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev + 1)
        .where("updated_at", "=", at),
    ),
  ]);
  if (changed === 1) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  const now = await getCampaignSummary(ctx, tenantId, id);
  if (!now || now.status !== "draft") return { ok: false, reason: "not_found" };
  return { ok: false, reason: "conflict", currentRev: now.rev };
}

export async function getCampaignSummary(ctx: DbContext, tenantId: string, id: string): Promise<CampaignSummary | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(C).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toSummary(r as CampaignRow) : null;
}

/** One campaign with its subject and body (decrypted). */
export async function getCampaign(ctx: RepoContext, tenantId: string, id: string): Promise<Campaign | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(C).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!r) return null;
  return {
    ...toSummary(r as unknown as CampaignRow),
    subject: decryptField(ctx, tenantId, C, "subject_enc", r.id, r.subject_enc) ?? "",
    body: decryptField(ctx, tenantId, C, "body_enc", r.id, r.body_enc) ?? "",
  };
}

/** Newest first, no text decrypted. */
export async function listCampaigns(ctx: DbContext, tenantId: string, limit = 100): Promise<CampaignSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(C)
    .select(SUMMARY_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .orderBy("id", "desc")
    .limit(Math.min(Math.max(1, limit), 500))
    .execute();
  return rows.map((r) => toSummary(r as CampaignRow));
}

/** Draft → scheduled at `sendAt` (UTC ISO; "now" for Send now). False when it is no longer that draft. */
export async function scheduleCampaign(ctx: DbContext, tenantId: string, id: string, expectedRev: number, sendAt: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  if (!Number.isFinite(Date.parse(sendAt))) throw new RepoInputError("Choose when to send.");
  const at = nowIso(ctx);
  const when = new Date(Math.max(Date.parse(sendAt), Date.parse(at))).toISOString();
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(C)
      .set({
        status: "scheduled",
        scheduled_for: when,
        scheduled_by: actor.userId,
        rev: expectedRev + 1,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "draft")
      .where("rev", "=", expectedRev),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      {
        action: "pms.email_campaign.schedule",
        targetType: "pms_email_campaign",
        targetId: id,
        detail: { sendAt: when },
      },
      ctx.db.selectFrom(C).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "scheduled").where("updated_at", "=", at),
    ),
  ]);
  return changed === 1;
}

/** Draft or scheduled → cancelled. False once it has started sending (or was already cancelled). */
export async function cancelCampaign(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(C)
      .set((eb) => ({
        status: "cancelled",
        cancelled_at: at,
        rev: eb("rev", "+", 1),
        updated_at: at,
      }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "in", ["draft", "scheduled"]),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      {
        action: "pms.email_campaign.cancel",
        targetType: "pms_email_campaign",
        targetId: id,
        detail: {},
      },
      ctx.db.selectFrom(C).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "cancelled").where("cancelled_at", "=", at),
    ),
  ]);
  return changed === 1;
}

/** Campaigns the run should work on: scheduled and due, or sending. */
export async function campaignsToRun(ctx: DbContext, tenantId: string, now: string): Promise<CampaignSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(C)
    .select(SUMMARY_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where((eb) => eb.or([eb("status", "=", "sending"), eb.and([eb("status", "=", "scheduled"), eb("scheduled_for", "<=", now)])]))
    .orderBy("id")
    .limit(20)
    .execute();
  return rows.map((r) => toSummary(r as CampaignRow));
}

/* ------------------------------------------------------------------------------------------------
 * The audience
 * ----------------------------------------------------------------------------------------------*/

/**
 * Patients the campaign may go to, as the query sees them now: active records (not deceased, archived, merged or
 * anonymised) with an email address; marketing: with the marketing-email opt-in and not known to be under 18;
 * service: not opted out of reminder emails. Then the clinic's filters.
 */
function audienceWhere(ctx: DbContext, tenantId: string, filters: AudienceFilters, purpose: CampaignPurpose, now: string) {
  const b = audienceBounds(ukToday(new Date(now)), filters, purpose);
  return ctx.db
    .selectFrom("pms_patients as p")
    .where("p.tenant_id", "=", tenantId)
    .where("p.status", "=", "active")
    .where("p.merged_into_id", "is", null)
    .where("p.email", "is not", null)
    .where("p.email", "like", "%_@_%")
    .where((eb) => eb.not(eb.exists(eb.selectFrom("pms_patient_anonymisations as an").select(eb.lit(1).as("one")).whereRef("an.tenant_id", "=", "p.tenant_id").whereRef("an.patient_id", "=", "p.id"))))
    .$if(purpose === "marketing", (q) => q.where("p.marketing_email", "=", 1).where((eb) => eb.or([eb("p.date_of_birth", "is", null), eb("p.date_of_birth", "<=", b.adultBornOnOrBefore as string)])))
    .$if(purpose === "service", (q) => q.where("p.reminder_email", "=", 1))
    .$if(Boolean(b.lastSeenFrom), (q) => q.where("p.last_seen_on", ">=", b.lastSeenFrom as string))
    .$if(Boolean(b.bornOnOrBefore), (q) => q.where("p.date_of_birth", "<=", b.bornOnOrBefore as string))
    .$if(Boolean(b.bornOnOrAfter), (q) => q.where("p.date_of_birth", ">=", b.bornOnOrAfter as string))
    .$if(Boolean(filters.siteId), (q) =>
      q.where((eb) =>
        eb.exists(
          eb
            .selectFrom("pms_appointments as sa")
            .select(eb.lit(1).as("one"))
            .whereRef("sa.tenant_id", "=", "p.tenant_id")
            .whereRef("sa.patient_id", "=", "p.id")
            .where("sa.kind", "=", "appointment")
            .where("sa.site_id", "=", filters.siteId as string)
            .where("sa.status", "!=", "cancelled"),
        ),
      ),
    )
    .$if(filters.upcoming !== "any", (q) =>
      q.where((eb) => {
        const upcoming = eb.exists(
          eb
            .selectFrom("pms_appointments as ua")
            .select(eb.lit(1).as("one"))
            .whereRef("ua.tenant_id", "=", "p.tenant_id")
            .whereRef("ua.patient_id", "=", "p.id")
            .where("ua.kind", "=", "appointment")
            .where("ua.status", "=", "booked")
            .where("ua.starts_at", ">", now),
        );
        return (filters.upcoming === "yes" ? upcoming : eb.not(upcoming)) as Expression<SqlBool>;
      }),
    );
}

export async function countAudience(ctx: DbContext, tenantId: string, filters: AudienceFilters, purpose: CampaignPurpose, now: string): Promise<AudienceCount> {
  assertTenantId(tenantId);
  const r = await audienceWhere(ctx, tenantId, filters, purpose, now)
    .select((eb) => [
      eb.fn.countAll<number>().as("patients"),
      eb.fn
        .count<number>(sql<string>`lower(${sql.ref("p.email")})`)
        .distinct()
        .as("addresses"),
    ])
    .executeTakeFirst();
  return { patients: num(r?.patients ?? 0), addresses: num(r?.addresses ?? 0) };
}

/** The ids among `patientIds` that still match the campaign (re-checked when each email is sent). */
export async function stillInAudience(ctx: DbContext, tenantId: string, filters: AudienceFilters, purpose: CampaignPurpose, now: string, patientIds: readonly string[]): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  const out = new Map<string, string>();
  for (let i = 0; i < patientIds.length; i += 90) {
    const rows = await audienceWhere(ctx, tenantId, filters, purpose, now)
      .select(["p.id", "p.email"])
      .where("p.id", "in", patientIds.slice(i, i + 90))
      .execute();
    for (const r of rows) out.set(r.id, String(r.email).trim().toLowerCase());
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Starting a campaign: its recipients
 * ----------------------------------------------------------------------------------------------*/

const RECIPIENT_CHUNK = 40;

/**
 * Claims a due scheduled campaign (scheduled → sending) – or takes one already "sending" whose recipients were not
 * all written – and writes its recipients, one per address. Returns the number of recipients, or null when another
 * run has it / it is not due.
 */
export async function startCampaign(ctx: RepoContext, tenantId: string, id: string, actor: PmsActor): Promise<number | null> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  let campaign = await getCampaignSummary(ctx, tenantId, id);
  if (!campaign) return null;
  if (campaign.status === "scheduled") {
    const claimed = await changeWithAudit(ctx, [
      ctx.db
        .updateTable(C)
        .set((eb) => ({
          status: "sending",
          started_at: at,
          rev: eb("rev", "+", 1),
          updated_at: at,
        }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("status", "=", "scheduled")
        .where("scheduled_for", "<=", at),
      commsAuditWhen(
        ctx,
        tenantId,
        actor,
        {
          action: "pms.email_campaign.start",
          targetType: "pms_email_campaign",
          targetId: id,
          detail: { purpose: campaign.purpose },
        },
        ctx.db.selectFrom(C).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "sending").where("started_at", "=", at),
      ),
    ]);
    if (claimed !== 1) return null;
    campaign = { ...campaign, status: "sending", startedAt: at };
  }
  if (campaign.status !== "sending") return null;
  if (campaign.recipientsTotal > 0) return campaign.recipientsTotal;

  // Everyone the audience holds now, oldest record first; one row per address (the first record keeps it).
  const seen = new Set<string>();
  const picked: { patientId: string; address: string }[] = [];
  let after = "";
  for (;;) {
    const page = await audienceWhere(ctx, tenantId, campaign.audience, campaign.purpose, at).select(["p.id", "p.email"]).where("p.id", ">", after).orderBy("p.id").limit(500).execute();
    for (const r of page) {
      const address = String(r.email).trim().toLowerCase();
      if (address.length < 3 || address.length > 254 || seen.has(address)) continue;
      seen.add(address);
      picked.push({ patientId: r.id, address });
    }
    if (page.length < 500) break;
    after = page[page.length - 1].id;
  }
  for (let i = 0; i < picked.length; i += RECIPIENT_CHUNK) {
    const chunk = picked.slice(i, i + RECIPIENT_CHUNK);
    await writeWithAudit(ctx, [
      ...chunk.map((p) =>
        ctx.db
          .insertInto(R)
          .values({
            tenant_id: tenantId,
            id: pmsId(P.campaignRecipient, ctx),
            campaign_id: id,
            patient_id: p.patientId,
            address_key: p.address,
            status: "pending",
            message_id: null,
            skip_reason: null,
            claim_token: null,
            claimed_at: null,
            sent_on: null,
            created_at: at,
            updated_at: at,
          })
          .onConflict((oc) => oc.doNothing()),
      ),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.email_campaign.start",
        targetType: "pms_email_campaign",
        targetId: id,
        detail: {
          recipients: chunk.length,
          part: Math.floor(i / RECIPIENT_CHUNK) + 1,
        },
      }),
    ]);
  }
  const total = await countRecipients(ctx, tenantId, id);
  if (total === 0) {
    await finishCampaign(ctx, tenantId, id, actor);
    return 0;
  }
  await ctx.db
    .updateTable(C)
    .set({ recipients_total: total, updated_at: nowIso(ctx) })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("recipients_total", "=", 0)
    .execute();
  return total;
}

async function countRecipients(ctx: DbContext, tenantId: string, campaignId: string): Promise<number> {
  const r = await ctx.db
    .selectFrom(R)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("campaign_id", "=", campaignId)
    .executeTakeFirst();
  return num(r?.n ?? 0);
}

/** sending → sent once nothing is pending or being sent. */
export async function finishCampaign(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(C)
      .set((eb) => ({
        status: "sent",
        finished_at: at,
        rev: eb("rev", "+", 1),
        updated_at: at,
      }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "sending")
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("pms_email_campaign_recipients as rr")
              .select(eb.lit(1).as("one"))
              .where("rr.tenant_id", "=", tenantId)
              .where("rr.campaign_id", "=", id)
              .where("rr.status", "in", ["pending", "processing"]),
          ),
        ),
      ),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      {
        action: "pms.email_campaign.finish",
        targetType: "pms_email_campaign",
        targetId: id,
        detail: {},
      },
      ctx.db.selectFrom(C).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "sent").where("finished_at", "=", at),
    ),
  ]);
  return changed === 1;
}

/* ------------------------------------------------------------------------------------------------
 * Recipients: claim, write, record
 * ----------------------------------------------------------------------------------------------*/

export interface ClaimedRecipient {
  id: string;
  patientId: string;
  addressKey: string;
}

/** A claim older than this is taken back (the run that held it stopped). */
export const STALE_CLAIM_MS = 15 * 60_000;

/**
 * Claims up to `limit` pending recipients for this run (pending → processing with `token`). Claims left by a run that
 * stopped are taken back first: never written (no message) → pending again; written → closed from their message.
 */
export async function claimRecipients(ctx: DbContext, tenantId: string, campaignId: string, token: string, limit: number): Promise<ClaimedRecipient[]> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const stale = new Date(Date.parse(at) - STALE_CLAIM_MS).toISOString();
  await ctx.db
    .updateTable(R)
    .set({
      status: "pending",
      claim_token: null,
      claimed_at: null,
      updated_at: at,
    })
    .where("tenant_id", "=", tenantId)
    .where("campaign_id", "=", campaignId)
    .where("status", "=", "processing")
    .where("message_id", "is", null)
    .where("claimed_at", "<", stale)
    .execute();
  const written = await ctx.db
    .selectFrom("pms_email_campaign_recipients as r")
    .innerJoin("pms_messages as m", (j) => j.onRef("m.tenant_id", "=", "r.tenant_id").onRef("m.id", "=", "r.message_id"))
    .select(["r.id", "m.status"])
    .where("r.tenant_id", "=", tenantId)
    .where("r.campaign_id", "=", campaignId)
    .where("r.status", "=", "processing")
    .where("r.claimed_at", "<", stale)
    .limit(90)
    .execute();
  for (const w of written) {
    const status: RecipientStatus = w.status === "sent" || w.status === "delivered" ? "sent" : w.status === "outbox" ? "outbox" : "failed";
    await ctx.db.updateTable(R).set({ status, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", w.id).where("status", "=", "processing").execute();
  }
  const n = Math.min(Math.max(1, limit), 90);
  const ids = (await ctx.db.selectFrom(R).select("id").where("tenant_id", "=", tenantId).where("campaign_id", "=", campaignId).where("status", "=", "pending").orderBy("id").limit(n).execute()).map(
    (r) => r.id,
  );
  if (!ids.length) return [];
  await ctx.db
    .updateTable(R)
    .set({
      status: "processing",
      claim_token: token,
      claimed_at: at,
      updated_at: at,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "in", ids)
    .where("status", "=", "pending")
    .execute();
  const rows = await ctx.db
    .selectFrom(R)
    .select(["id", "patient_id", "address_key"])
    .where("tenant_id", "=", tenantId)
    .where("claim_token", "=", token)
    .where("status", "=", "processing")
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    addressKey: r.address_key,
  }));
}

/** The UPDATE closing a claimed recipient (in the batch with its message, or alone for a skip). */
export function recipientUpdateQuery(
  ctx: DbContext,
  tenantId: string,
  id: string,
  token: string,
  change: {
    status: RecipientStatus;
    messageId?: string | null;
    skipReason?: string | null;
    sentOn?: string | null;
  },
): BatchQuery {
  return ctx.db
    .updateTable(R)
    .set({
      status: change.status,
      ...(change.messageId !== undefined ? { message_id: change.messageId } : {}),
      ...(change.skipReason !== undefined ? { skip_reason: change.skipReason } : {}),
      ...(change.sentOn !== undefined ? { sent_on: change.sentOn } : {}),
      updated_at: nowIso(ctx),
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("claim_token", "=", token);
}

/** After the provider answered: processing recipients → sent / failed (by their message). */
export async function recordRecipientOutcomes(ctx: DbContext, tenantId: string, token: string, outcomes: readonly { recipientId: string; status: "sent" | "failed" }[]): Promise<void> {
  for (let i = 0; i < outcomes.length; i += 90) {
    const chunk = outcomes.slice(i, i + 90);
    await runBatch(
      ctx.db,
      chunk.map((o) =>
        ctx.db
          .updateTable(R)
          .set({ status: o.status, updated_at: nowIso(ctx) })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", o.recipientId)
          .where("claim_token", "=", token)
          .where("status", "=", "processing"),
      ),
    );
  }
}

/** Puts claimed recipients back (the daily cap was reached, or the run stopped before writing them). */
export async function releaseRecipients(ctx: DbContext, tenantId: string, token: string, ids: readonly string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 90) {
    const r = await ctx.db
      .updateTable(R)
      .set({
        status: "pending",
        claim_token: null,
        claimed_at: null,
        updated_at: nowIso(ctx),
      })
      .where("tenant_id", "=", tenantId)
      .where("claim_token", "=", token)
      .where("status", "=", "processing")
      .where("message_id", "is", null)
      .where("id", "in", ids.slice(i, i + 90))
      .executeTakeFirst();
    n += affected(r as { numUpdatedRows?: bigint });
  }
  return n;
}

/** Campaign emails written today (UK day) for the clinic – the daily cap. */
export async function campaignEmailsOn(ctx: DbContext, tenantId: string, day: string): Promise<number> {
  assertTenantId(tenantId);
  const r = await ctx.db
    .selectFrom(R)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("sent_on", "=", day)
    .executeTakeFirst();
  return num(r?.n ?? 0);
}

/* ------------------------------------------------------------------------------------------------
 * Reporting
 * ----------------------------------------------------------------------------------------------*/

export async function campaignReport(ctx: DbContext, tenantId: string, campaignId: string): Promise<CampaignReport> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("pms_email_campaign_recipients as r")
    .leftJoin("pms_messages as m", (j) => j.onRef("m.tenant_id", "=", "r.tenant_id").onRef("m.id", "=", "r.message_id"))
    .select((eb) => ["r.status as rstatus", "m.status as mstatus", "r.skip_reason", eb.fn.countAll<number>().as("n")])
    .where("r.tenant_id", "=", tenantId)
    .where("r.campaign_id", "=", campaignId)
    .groupBy(["r.status", "m.status", "r.skip_reason"])
    .execute();
  const out: CampaignReport = {
    recipients: 0,
    pending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    outbox: 0,
    skipped: 0,
    skipReasons: {},
    unsubscribed: 0,
  };
  for (const r of rows) {
    const n = num(r.n);
    out.recipients += n;
    const m = r.mstatus as string | null;
    if (r.rstatus === "pending" || (r.rstatus === "processing" && (!m || m === "queued"))) out.pending += n;
    else if (r.rstatus === "skipped") {
      out.skipped += n;
      const why = r.skip_reason ?? "other";
      out.skipReasons[why] = (out.skipReasons[why] ?? 0) + n;
    } else if (m === "delivered") {
      out.sent += n;
      out.delivered += n;
    } else if (m === "sent") out.sent += n;
    else if (m === "outbox") out.outbox += n;
    else if (m === "failed" || r.rstatus === "failed") out.failed += n;
    else out.pending += n;
  }
  const u = await ctx.db
    .selectFrom("pms_consent_events as e")
    .innerJoin("pms_email_campaign_recipients as r", (j) => j.onRef("r.tenant_id", "=", "e.tenant_id").onRef("r.message_id", "=", "e.message_id"))
    .select((eb) => eb.fn.count<number>("e.patient_id").distinct().as("n"))
    .where("e.tenant_id", "=", tenantId)
    .where("r.campaign_id", "=", campaignId)
    .where("e.action", "=", "opt_out")
    .where("e.channel", "=", "email")
    .executeTakeFirst();
  out.unsubscribed = num(u?.n ?? 0);
  return out;
}
