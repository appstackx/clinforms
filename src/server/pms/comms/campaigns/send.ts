/**
 * Sending bulk emails (tracker xt02). Part of every message run (the cron route, src/server/pms/comms/cron.ts) when
 * the platform switch CLINFORMS_BULK_EMAIL=on and the clinic's own setting is on; "Send now" on the campaign page
 * runs it for the clinic straight away.
 *
 * For each due campaign: start it (its recipients, one per address – ../../../repos/pms/comms/campaigns.ts), then in
 * rounds of up to 40: claim recipients → check each AGAIN against the campaign's rules at this moment (consent,
 * deceased / archived / merged / anonymised, the filters, the same address) → write the message (pms_messages, the
 * outbox pattern) and the recipient's row in one batch with one audit row → hand the written emails to the email
 * provider (outbox by default: kept, never sent) → record the answers. Rate limits: at most
 * CAMPAIGN_EMAILS_PER_RUN per clinic per run and the clinic's daily cap (UK day); what is left goes in a later run.
 *
 * Every email: the clinic's name as sender, its reply-to, a footer with the clinic's name and POSTAL address and why
 * the patient gets it, a one-click unsubscribe link signed for that patient and message (List-Unsubscribe +
 * List-Unsubscribe-Post headers, RFC 8058). A campaign without a postal address to show does not send.
 */
import { randomBytes } from "node:crypto";
import { CAMPAIGN_EMAILS_PER_RUN, renderCampaign, type CampaignPurpose, type CampaignValues } from "../../../../modules/pms/comms/campaigns";
import { messageBlock } from "../../../../modules/pms/comms/consent";
import { COMMS_ID_PREFIXES } from "../../../../modules/pms/comms/ids";
import { pmsNowMs } from "../../../../modules/pms/core/clock";
import { ukToday } from "../../../../modules/pms/core/text";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { nowIso, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../../../repos/pms/context";
import {
  campaignEmailsOn,
  campaignsToRun,
  claimRecipients,
  finishCampaign,
  getBulkEmailSettings,
  getCampaign,
  recipientUpdateQuery,
  recordRecipientOutcomes,
  startCampaign,
  stillInAudience,
  type Campaign,
} from "../../../repos/pms/comms/campaigns";
import { getMessagingContacts } from "../../../repos/pms/comms/contacts";
import { outboundInsertQuery, recordSendOutcomes, type SendOutcome } from "../../../repos/pms/comms/messages";
import { getCommsSettings } from "../../../repos/pms/comms/settings";
import { listSites } from "../../../repos/pms/directory";
import { SYSTEM_ACTOR, PROVIDER_UNKNOWN, type DispatchDeps } from "../dispatch";
import { signStopToken, stopLinkUrl } from "../links";
import type { OutboundEmail } from "../providers";
import { clinicContact, type ClinicContact } from "../render";
import { greetingName } from "../../../../modules/pms/comms/consent";

/** Why a recipient failed without a message: no unsubscribe link could be signed (the report's reason). */
export const NO_UNSUBSCRIBE_LINK = "no_unsubscribe_link";

/** Who the emails come from and what their footer shows. postalAddress null = the campaign cannot send. */
export interface CampaignSender {
  contact: ClinicContact;
  postalAddress: string | null;
}

/** The clinic's postal address: its profile (Settings → Clinic), else its first active site with an address. */
export async function campaignSender(ctx: RepoContext, tenantId: string): Promise<CampaignSender> {
  const settings = await getCommsSettings(ctx, tenantId);
  const contact = await clinicContact(ctx, tenantId, settings);
  let lines = [...(contact.address ?? []), contact.postcode].filter((l): l is string => Boolean(l && l.trim()));
  if (!contact.address?.length) {
    const sites = (await listSites(ctx, tenantId)).filter((s) => s.address?.length).sort((a, b) => a.sortOrder - b.sortOrder);
    if (sites[0]) lines = [...(sites[0].address ?? []), sites[0].postcode].filter((l): l is string => Boolean(l && l.trim()));
  }
  return { contact, postalAddress: lines.length ? lines.join(", ") : null };
}

function stopUrlFor(deps: DispatchDeps, tenantId: string, patientId: string, messageId: string, purpose: CampaignPurpose, nowMs: number): string | null {
  if (!deps.linkSecret) return null;
  const token = signStopToken(
    {
      tenantId,
      patientId,
      channel: "email",
      purpose,
      messageId,
      ...(purpose === "service" ? { announce: true } : {}),
    },
    deps.linkSecret,
    nowMs,
  );
  return stopLinkUrl(deps.linkOrigin, token);
}

function valuesFor(sender: CampaignSender, firstName: string | null): CampaignValues {
  return {
    first_name: firstName,
    clinic_name: sender.contact.name,
    clinic_address: sender.postalAddress,
    clinic_phone: sender.contact.phone,
  };
}

export interface CampaignRunSummary {
  campaigns: number;
  written: number;
  sent: number;
  outbox: number;
  failed: number;
  skipped: number;
  finished: number;
  /** Campaigns waiting because the clinic has no postal address to show. */
  blockedNoAddress: number;
  /** True when the daily cap stopped this run. */
  capReached: boolean;
}

const empty = (): CampaignRunSummary => ({
  campaigns: 0,
  written: 0,
  sent: 0,
  outbox: 0,
  failed: 0,
  skipped: 0,
  finished: 0,
  blockedNoAddress: 0,
  capReached: false,
});

const ROUND = 40;

/**
 * Sends what is due of the clinic's campaigns (see the top of this file). The caller checks the platform switch;
 * the clinic's own setting is checked here (off → nothing, campaigns wait). `onlyCampaignId`: Send now.
 */
export async function runCampaigns(
  ctx: RepoContext,
  tenantId: string,
  deps: DispatchDeps,
  options: {
    actor?: PmsActor;
    budgetMs?: number;
    onlyCampaignId?: string;
    perRun?: number;
  } = {},
): Promise<CampaignRunSummary> {
  const actor = options.actor ?? SYSTEM_ACTOR;
  const out = empty();
  const settings = await getBulkEmailSettings(ctx, tenantId);
  if (!settings.enabled) return out;
  const started = pmsNowMs();
  const budget = options.budgetMs ?? 20_000;
  let room = Math.min(options.perRun ?? CAMPAIGN_EMAILS_PER_RUN, CAMPAIGN_EMAILS_PER_RUN);
  const today = ukToday(new Date(nowIso(ctx)));
  let capLeft = settings.dailyCap - (await campaignEmailsOn(ctx, tenantId, today));
  let sender: CampaignSender | null = null;
  const due = (await campaignsToRun(ctx, tenantId, nowIso(ctx))).filter((c) => !options.onlyCampaignId || c.id === options.onlyCampaignId);
  for (const summary of due) {
    if (pmsNowMs() - started > budget) break;
    sender ??= await campaignSender(ctx, tenantId);
    if (!sender.postalAddress) {
      out.blockedNoAddress++;
      continue;
    }
    const total = await startCampaign(ctx, tenantId, summary.id, actor);
    if (total === null) continue;
    out.campaigns++;
    const campaign = await getCampaign(ctx, tenantId, summary.id);
    if (!campaign) continue;
    for (;;) {
      if (room <= 0 || pmsNowMs() - started > budget) break;
      if (capLeft <= 0) {
        out.capReached = true;
        break;
      }
      const token = `cmp_${randomBytes(12).toString("base64url")}`;
      const claimed = await claimRecipients(ctx, tenantId, campaign.id, token, Math.min(ROUND, room, capLeft));
      if (!claimed.length) break;
      const r = await sendRound(ctx, tenantId, campaign, claimed, token, sender, deps, actor, today);
      out.written += r.written;
      out.sent += r.sent;
      out.outbox += r.outbox;
      out.failed += r.failed;
      out.skipped += r.skipped;
      room -= claimed.length;
      capLeft -= r.written;
    }
    if (await finishCampaign(ctx, tenantId, campaign.id, actor)) out.finished++;
  }
  return out;
}

async function sendRound(
  ctx: RepoContext,
  tenantId: string,
  campaign: Campaign,
  claimed: Awaited<ReturnType<typeof claimRecipients>>,
  token: string,
  sender: CampaignSender,
  deps: DispatchDeps,
  actor: PmsActor,
  today: string,
): Promise<{
  written: number;
  sent: number;
  outbox: number;
  failed: number;
  skipped: number;
}> {
  const now = nowIso(ctx);
  const nowMs = Date.parse(now);
  const provider = deps.providers.email;
  const outbox = provider.mode === "outbox";
  const [eligible, contacts] = await Promise.all([
    stillInAudience(
      ctx,
      tenantId,
      campaign.audience,
      campaign.purpose,
      now,
      claimed.map((c) => c.patientId),
    ),
    getMessagingContacts(
      ctx,
      tenantId,
      claimed.map((c) => c.patientId),
    ),
  ]);
  const kind = campaign.purpose === "marketing" ? "marketing" : "general";
  const queries: BatchQuery[] = [];
  const toSend: { recipientId: string; email: OutboundEmail }[] = [];
  let skipped = 0;
  let written = 0;
  let failedNoLink = 0;
  for (const r of claimed) {
    const contact = contacts.get(r.patientId);
    const address = eligible.get(r.patientId);
    let why: string | null = null;
    if (!contact) why = "archived";
    else if (!address)
      why =
        messageBlock(contact, "email", campaign.purpose, {
          automatic: true,
          kind,
        }) ?? "not_in_audience";
    else if (address !== r.addressKey) why = "address_changed";
    if (why || !contact || !address) {
      skipped++;
      queries.push(
        recipientUpdateQuery(ctx, tenantId, r.id, token, {
          status: "skipped",
          skipReason: why ?? "not_in_audience",
        }),
      );
      continue;
    }
    const messageId = pmsId(COMMS_ID_PREFIXES.message, ctx);
    const stopUrl = stopUrlFor(deps, tenantId, contact.id, messageId, campaign.purpose, nowMs);
    if (!stopUrl) {
      // No signing key (BETTER_AUTH_SECRET missing): no unsubscribe link or header can be built, and a bulk email
      // never goes without one (PECR) – recorded as failed, with the reason, nothing written or sent.
      failedNoLink++;
      queries.push(recipientUpdateQuery(ctx, tenantId, r.id, token, { status: "failed", skipReason: NO_UNSUBSCRIBE_LINK }));
      continue;
    }
    const rendered = renderCampaign({
      subject: campaign.subject,
      body: campaign.body,
      values: valuesFor(sender, greetingName(contact)),
      clinicName: sender.contact.name,
      postalAddress: sender.postalAddress as string,
      phone: sender.contact.phone,
      purpose: campaign.purpose,
      stopUrl,
    });
    const { query } = outboundInsertQuery(
      ctx,
      tenantId,
      {
        id: messageId,
        patientId: contact.id,
        channel: "email",
        purpose: campaign.purpose,
        kind,
        templateId: null,
        appointmentId: null,
        toAddress: contact.email as string,
        addressKey: r.addressKey,
        subject: rendered.subject,
        body: rendered.text,
        segments: null,
        status: outbox ? "outbox" : "queued",
        provider: provider.id,
      },
      actor,
    );
    queries.push(
      query,
      recipientUpdateQuery(ctx, tenantId, r.id, token, {
        status: outbox ? "outbox" : "processing",
        messageId,
        sentOn: today,
      }),
    );
    written++;
    if (!outbox) {
      toSend.push({
        recipientId: r.id,
        email: {
          messageId,
          to: contact.email as string,
          fromName: sender.contact.name,
          replyTo: sender.contact.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: rendered.headers,
        },
      });
    }
  }
  queries.push(
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.email_campaign.send",
      targetType: "pms_email_campaign",
      targetId: campaign.id,
      detail: {
        purpose: campaign.purpose,
        claimed: claimed.length,
        written,
        skipped,
        provider: provider.id,
      },
    }),
  );
  await writeWithAudit(ctx, queries, {
    foreignKey: "A patient of this campaign no longer exists in this clinic.",
  });

  const outcomes: { id: string; outcome: SendOutcome }[] = [];
  const recipientOutcomes: {
    recipientId: string;
    status: "sent" | "failed";
  }[] = [];
  let sent = 0;
  let failed = 0;
  for (const s of toSend) {
    let outcome: SendOutcome;
    try {
      outcome = await provider.send(s.email);
    } catch {
      outcome = { status: "failed", errorCode: PROVIDER_UNKNOWN };
    }
    outcomes.push({ id: s.email.messageId, outcome });
    if (outcome.status === "sent") {
      sent++;
      recipientOutcomes.push({ recipientId: s.recipientId, status: "sent" });
    } else {
      failed++;
      recipientOutcomes.push({ recipientId: s.recipientId, status: "failed" });
    }
  }
  await recordSendOutcomes(ctx, tenantId, outcomes, actor);
  await recordRecipientOutcomes(ctx, tenantId, token, recipientOutcomes);
  return { written, sent, outbox: outbox ? written : 0, failed: failed + failedNoLink, skipped };
}

export type TestSendResult = { ok: true; status: "sent" | "outbox" } | { ok: false; reason: "no_address" | "failed"; message: string };

/**
 * A test copy to the member's OWN address (never a patient's): subject "[Test] …", their first name in
 * {first_name}, the footer as patients will see it but without a working unsubscribe link. Nothing is stored in the
 * message log; an audit row records that a test copy went (no address in it). The outbox provider keeps nothing –
 * the screen says so.
 */
export async function sendCampaignTest(
  ctx: RepoContext,
  tenantId: string,
  campaign: Pick<Campaign, "id" | "subject" | "body" | "purpose">,
  member: { email: string; name: string },
  deps: DispatchDeps,
  actor: PmsActor,
): Promise<TestSendResult> {
  const sender = await campaignSender(ctx, tenantId);
  if (!sender.postalAddress) return { ok: false, reason: "no_address", message: "no_address" };
  const rendered = renderCampaign({
    subject: campaign.subject,
    body: campaign.body,
    values: valuesFor(sender, member.name.trim().split(/\s+/)[0] || null),
    clinicName: sender.contact.name,
    postalAddress: sender.postalAddress,
    phone: sender.contact.phone,
    purpose: campaign.purpose,
    stopUrl: null,
    subjectPrefix: "[Test] ",
  });
  const text = `${rendered.text}\n(Test copy: each patient's email has its own one-click unsubscribe link here.)`;
  const provider = deps.providers.email;
  await writeWithAudit(ctx, [
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.email_campaign.test_send",
      targetType: "pms_email_campaign",
      targetId: campaign.id,
      detail: { provider: provider.id },
    }),
  ]);
  if (provider.mode === "outbox") return { ok: true, status: "outbox" };
  let outcome: SendOutcome;
  try {
    outcome = await provider.send({
      messageId: `test_${randomBytes(8).toString("hex")}`,
      to: member.email,
      fromName: sender.contact.name,
      replyTo: sender.contact.email,
      subject: rendered.subject,
      text,
      html: rendered.html,
      headers: {},
    });
  } catch {
    outcome = { status: "failed", errorCode: PROVIDER_UNKNOWN };
  }
  return outcome.status === "sent" ? { ok: true, status: "sent" } : { ok: false, reason: "failed", message: "failed" };
}
