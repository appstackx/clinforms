/**
 * Bulk email – what the screens' pages and server actions call (tracker xt02). Rules, in this order:
 *
 *   1. the platform switch CLINFORMS_BULK_EMAIL=on (else: "not found" – the pages answer 404);
 *   2. the member: "messages.templates" (owners and admins by default) AND never reception (ClinForms role "staff") –
 *      reception cannot send marketing even if a clinic grants it the permission (a lock, here and in the pages);
 *      the clinic's setting (on/off, daily cap) is for owners and admins only;
 *   3. a member limited to some sites can only send to one of their sites (the site filter);
 *   4. the clinic's own setting must be on to draft, test or send (the page shows only the setting while it is off);
 *   5. ids from the request are read back from the member's own clinic.
 *
 * The patient record's marketing-email consent (the Messages tab) is here too: shown and changed (staff, audited,
 * with how the patient agreed) while the platform switch is on.
 */
import "server-only";
import {
  AudienceSchema,
  CAMPAIGN_COPY,
  CampaignInputSchema,
  BulkEmailSettingsInputSchema,
  bulkEmailSwitchOn,
  normaliseAudience,
  type AudienceFilters,
  type CampaignPurpose,
} from "../../../../modules/pms/comms/campaigns";
import { MarketingSourceSchema } from "../../../../modules/pms/core/schemas";
import { hitRateLimit } from "../../../repos/rate-limits";
import { nowIso } from "../../../repos/pms/context";
import {
  campaignReport,
  cancelCampaign,
  countAudience,
  createCampaign,
  getBulkEmailSettings,
  getCampaign,
  listCampaigns,
  scheduleCampaign,
  updateBulkEmailSettings,
  updateCampaign,
  type AudienceCount,
  type Campaign,
} from "../../../repos/pms/comms/campaigns";
import type { CampaignEditorView, CampaignRow, CampaignsHomeView, MarketingConsentView } from "../../../../modules/pms/comms/campaign-view";
export type { CampaignEditorView, CampaignRow, CampaignsHomeView, MarketingConsentView };
import { changeConsent, listConsentEvents } from "../../../repos/pms/comms/consent";
import { listSites } from "../../../repos/pms/directory";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, saveFailure, type Result } from "../../records/access";
import { dispatchDepsFromEnv, type DispatchDeps } from "../dispatch";
import { CommsConfigError, providerStatus } from "../providers";
import { campaignSender, runCampaigns, sendCampaignTest, type CampaignRunSummary } from "./send";
import type { CommsActor } from "../views";

export type CampaignActor = CommsActor & { role?: string };

type Env = Readonly<Record<string, string | undefined>>;

/** The platform switch (read per call, so a test can set it). */
export function bulkEmailAvailable(env: Env = process.env): boolean {
  return bulkEmailSwitchOn(env);
}

/** May this member work with bulk email (not the switch – see bulkEmailAvailable)? */
export function mayUseBulkEmail(actor: Pick<CampaignActor, "can" | "role">): boolean {
  return actor.role !== "staff" && actor.can("messages.templates");
}

/** May this member switch bulk email on or off and set the daily cap? */
export function mayManageBulkEmail(actor: Pick<CampaignActor, "can" | "role">): boolean {
  return (actor.role === "owner" || actor.role === "admin") && actor.can("messages.templates");
}

function gate(actor: CampaignActor) {
  if (!bulkEmailAvailable()) return notFound();
  if (!mayUseBulkEmail(actor)) return forbidden();
  return null;
}

export const SWITCHED_OFF = CAMPAIGN_COPY.off;
const NOT_CONFIGURED = "The email service is not set up correctly. Nothing was sent – ask the clinic owner.";

function depsOrNull(deps?: DispatchDeps): DispatchDeps | null {
  if (deps) return deps;
  try {
    return dispatchDepsFromEnv(process.env);
  } catch (err) {
    if (err instanceof CommsConfigError) return null;
    throw err;
  }
}

function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".") || "form";
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

/** A member limited to some sites sends only to one of them. */
function scopeProblem(actor: CampaignActor, audience: AudienceFilters): string | null {
  const scope = actor.siteIds ?? null;
  if (scope === null) return null;
  if (!audience.siteId || !scope.has(audience.siteId)) return "Choose one of your sites: you can only email patients of the sites you work at.";
  return null;
}

/**
 * May the member see this campaign at all? A member limited to some sites sees only campaigns aimed at one of their
 * sites (not "every site", not another site's) – lists, the editor, test, schedule, send more and cancel alike.
 */
function campaignInScope(actor: CampaignActor, audience: AudienceFilters): boolean {
  const scope = actor.siteIds ?? null;
  return scope === null || (audience.siteId !== null && scope.has(audience.siteId));
}

/* ------------------------------------------------------------------------------------------------
 * Views
 * ----------------------------------------------------------------------------------------------*/

export async function campaignsHomeFor(actor: CampaignActor): Promise<Result<CampaignsHomeView>> {
  const g = gate(actor);
  if (g) return g;
  return attempt("comms.campaigns_home", async () => {
    const ctx = actor.repo();
    const [settings, campaigns] = await Promise.all([getBulkEmailSettings(ctx, actor.tenantId), listCampaigns(ctx, actor.tenantId, 100)]);
    const rows: CampaignRow[] = [];
    for (const c of campaigns.filter((x) => campaignInScope(actor, x.audience)))
      rows.push({
        ...c,
        report: c.status === "sending" || c.status === "sent" ? await campaignReport(ctx, actor.tenantId, c.id) : null,
      });
    return ok({
      settings,
      canManage: mayManageBulkEmail(actor),
      campaigns: rows,
      emailMode: providerStatus().email,
    });
  });
}

export async function campaignEditorFor(actor: CampaignActor, id: string | null): Promise<Result<CampaignEditorView>> {
  const g = gate(actor);
  if (g) return g;
  return attempt("comms.campaign_editor", async () => {
    const ctx = actor.repo();
    let campaign: Campaign | null = null;
    if (id) {
      if (!/^ecmp_[A-Za-z0-9]{10,40}$/.test(id)) return notFound();
      campaign = await getCampaign(ctx, actor.tenantId, id);
      if (!campaign || !campaignInScope(actor, campaign.audience)) return notFound();
    }
    const [sites, sender, settings, report] = await Promise.all([
      listSites(ctx, actor.tenantId),
      campaignSender(ctx, actor.tenantId),
      getBulkEmailSettings(ctx, actor.tenantId),
      campaign && campaign.status !== "draft" && campaign.status !== "scheduled" && campaign.status !== "cancelled" ? campaignReport(ctx, actor.tenantId, campaign.id) : Promise.resolve(null),
    ]);
    const scope = actor.siteIds ?? null;
    return ok({
      campaign,
      report,
      sites: sites.filter((s) => scope === null || scope.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
      siteLocked: scope !== null,
      sender: {
        name: sender.contact.name,
        postalAddress: sender.postalAddress,
        phone: sender.contact.phone,
      },
      settings,
      emailMode: providerStatus().email,
      memberEmail: actor.email,
      now: nowIso(ctx),
      canManage: mayManageBulkEmail(actor),
    });
  });
}

/** The live count for the editor. */
export async function audienceCountFor(actor: CampaignActor, purpose: unknown, audience: unknown): Promise<Result<AudienceCount>> {
  const g = gate(actor);
  if (g) return g;
  const p = purpose === "marketing" || purpose === "service" ? (purpose as CampaignPurpose) : null;
  const a = AudienceSchema.safeParse(audience ?? {});
  if (!p || !a.success) return fail("invalid", a.success ? "Choose what kind of email this is." : (a.error.issues[0]?.message ?? "Check the filters."));
  const filters = normaliseAudience(a.data);
  const scope = scopeProblem(actor, filters);
  if (scope) return fail("invalid", scope);
  return attempt("comms.campaign_count", async () => ok(await countAudience(actor.repo(), actor.tenantId, filters, p, nowIso(actor.repo()))));
}

/* ------------------------------------------------------------------------------------------------
 * Writes
 * ----------------------------------------------------------------------------------------------*/

export async function saveBulkEmailSettingsFor(actor: CampaignActor, rev: unknown, input: unknown): Promise<Result<{ rev: number; unscheduled: number }>> {
  if (!bulkEmailAvailable()) return notFound();
  if (!mayManageBulkEmail(actor)) return forbidden();
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) return fail("invalid", "Reload the page and try again.");
  const parsed = BulkEmailSettingsInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the settings.", { fieldErrors: fieldErrors(parsed.error.issues) });
  return attempt("comms.bulk_settings_save", async () => {
    const r = await updateBulkEmailSettings(actor.repo(), actor.tenantId, rev, parsed.data, actor.actor);
    return r.ok ? ok({ rev: r.rev, unscheduled: r.unscheduled ?? 0 }) : saveFailure(r);
  });
}

async function requireOn(actor: CampaignActor): Promise<boolean> {
  return (await getBulkEmailSettings(actor.repo(), actor.tenantId)).enabled;
}

/** Creates (id null) or changes a draft. */
export async function saveCampaignFor(actor: CampaignActor, id: string | null, rev: unknown, input: unknown): Promise<Result<{ id: string; rev: number }>> {
  const g = gate(actor);
  if (g) return g;
  const parsed = CampaignInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the email.", { fieldErrors: fieldErrors(parsed.error.issues) });
  const scope = scopeProblem(actor, normaliseAudience(parsed.data.audience));
  if (scope)
    return fail("invalid", scope, {
      fieldErrors: { "audience.siteId": scope },
    });
  return attempt("comms.campaign_save", async () => {
    if (!(await requireOn(actor))) return fail("invalid", SWITCHED_OFF);
    if (!id) return ok(await createCampaign(actor.repo(), actor.tenantId, parsed.data, actor.actor));
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1) return fail("invalid", "Reload the page and try again.");
    const r = await updateCampaign(actor.repo(), actor.tenantId, id, rev, parsed.data, actor.actor);
    if (r.ok) return ok({ id, rev: r.rev });
    if (r.reason === "not_found") return fail("conflict", "This email is no longer a draft – it can no longer be changed.");
    return saveFailure(r);
  });
}

async function draftOf(actor: CampaignActor, id: unknown): Promise<Campaign | null> {
  if (typeof id !== "string" || !/^ecmp_[A-Za-z0-9]{10,40}$/.test(id)) return null;
  const c = await getCampaign(actor.repo(), actor.tenantId, id);
  // Out of the member's site scope: as if it did not exist.
  return c && campaignInScope(actor, c.audience) ? c : null;
}

/** A test copy to the member's own address – at most 10 an hour per member. */
export async function testSendFor(actor: CampaignActor, id: unknown, deps?: DispatchDeps): Promise<Result<{ status: "sent" | "outbox"; to: string }>> {
  const g = gate(actor);
  if (g) return g;
  return attempt("comms.campaign_test", async () => {
    if (!(await requireOn(actor))) return fail("invalid", SWITCHED_OFF);
    const c = await draftOf(actor, id);
    if (!c) return notFound();
    const d = depsOrNull(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    const hit = await hitRateLimit(actor.repo(), `campaign-test:${actor.tenantId}:${actor.userId}`.slice(0, 200), 3_600_000);
    if (hit.count > 10) return fail("invalid", "That is 10 test copies this hour – please wait before sending another.");
    const r = await sendCampaignTest(actor.repo(), actor.tenantId, c, { email: actor.email, name: actor.name }, d, actor.actor);
    if (!r.ok) return fail("invalid", r.reason === "no_address" ? CAMPAIGN_COPY.noAddress : "The email service did not accept the test copy.");
    return ok({ status: r.status, to: actor.email });
  });
}

/** Schedules a draft (`sendAt` UTC ISO) or sends it now ("now": scheduled for now and the run started at once). */
export async function scheduleFor(actor: CampaignActor, id: unknown, rev: unknown, sendAt: unknown, deps?: DispatchDeps): Promise<Result<{ status: string; run: CampaignRunSummary | null }>> {
  const g = gate(actor);
  if (g) return g;
  return attempt<{ status: string; run: CampaignRunSummary | null }>("comms.campaign_schedule", async () => {
    if (!(await requireOn(actor))) return fail("invalid", SWITCHED_OFF);
    const c = await draftOf(actor, id);
    if (!c) return notFound();
    if (c.status !== "draft") return fail("conflict", "This email is no longer a draft.");
    if (typeof rev !== "number" || rev !== c.rev) return fail("conflict", "Someone changed this email – reload the page.");
    const scope = scopeProblem(actor, c.audience);
    if (scope) return fail("invalid", scope);
    const sender = await campaignSender(actor.repo(), actor.tenantId);
    if (!sender.postalAddress) return fail("invalid", CAMPAIGN_COPY.noAddress);
    const now = sendAt === "now";
    const at = now ? nowIso(actor.repo()) : typeof sendAt === "string" && Number.isFinite(Date.parse(sendAt)) ? new Date(sendAt).toISOString() : null;
    if (!at) return fail("invalid", "Choose when to send.");
    if (!now && Date.parse(at) < Date.parse(nowIso(actor.repo())) - 60_000) return fail("invalid", "Choose a time in the future (or Send now).");
    if (!(await scheduleCampaign(actor.repo(), actor.tenantId, c.id, c.rev, at, actor.actor))) return fail("conflict", "This email changed – reload the page.");
    if (!now) return ok({ status: "scheduled", run: null });
    const d = depsOrNull(deps);
    if (!d) return ok({ status: "scheduled", run: null });
    const run = await runCampaigns(actor.repo(), actor.tenantId, d, {
      actor: actor.actor,
      onlyCampaignId: c.id,
      budgetMs: 20_000,
    });
    return ok({ status: "sending", run });
  });
}

/** Sends more of a campaign that is sending (what the daily cap or a run's limit left) – owners/admins' "Send more now". */
export async function continueSendingFor(actor: CampaignActor, id: unknown, deps?: DispatchDeps): Promise<Result<CampaignRunSummary>> {
  const g = gate(actor);
  if (g) return g;
  if (!mayManageBulkEmail(actor)) return forbidden();
  return attempt("comms.campaign_continue", async () => {
    const c = await draftOf(actor, id);
    if (!c) return notFound();
    const d = depsOrNull(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    return ok(
      await runCampaigns(actor.repo(), actor.tenantId, d, {
        actor: actor.actor,
        onlyCampaignId: c.id,
        budgetMs: 20_000,
      }),
    );
  });
}

export async function cancelFor(actor: CampaignActor, id: unknown): Promise<Result<{ cancelled: true }>> {
  const g = gate(actor);
  if (g) return g;
  return attempt("comms.campaign_cancel", async () => {
    const c = await draftOf(actor, id);
    if (!c) return notFound();
    if (!(await cancelCampaign(actor.repo(), actor.tenantId, c.id, actor.actor))) return fail("conflict", "It has started sending – it can no longer be cancelled.");
    return ok({ cancelled: true });
  });
}

/* ------------------------------------------------------------------------------------------------
 * The patient's marketing-email consent (record → Messages tab)
 * ----------------------------------------------------------------------------------------------*/

export async function marketingConsentFor(actor: CampaignActor, patientId: string): Promise<Result<MarketingConsentView>> {
  if (!bulkEmailAvailable()) return notFound();
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.marketing_consent", async () => {
    const p = await patientInClinic(actor, patientId);
    if (!p) return notFound();
    const events = await listConsentEvents(actor.repo(), actor.tenantId, p.id, 200);
    const out = events.find((e) => e.channel === "email" && e.purpose === "marketing" && e.action === "opt_out") ?? null;
    return ok({
      patientId: p.id,
      agreed: p.marketingEmail,
      agreedAt: p.marketingEmail ? p.marketingConsentAt : null,
      how: p.marketingEmail ? p.marketingConsentSource : null,
      withdrawnAt: out?.createdAt ?? null,
      withdrawnHow: out?.source ?? null,
      canChange: actor.can("patients.edit"),
    });
  });
}

/** Staff record or withdraw the opt-in (how the patient agreed is required to record it). Audited, with the event. */
export async function setMarketingConsentFor(actor: CampaignActor, patientId: unknown, value: unknown, how: unknown): Promise<Result<{ changed: boolean }>> {
  if (!bulkEmailAvailable()) return notFound();
  if (!actor.can("messages.send") || !actor.can("patients.edit")) return forbidden();
  if (typeof value !== "boolean") return fail("invalid", "Choose yes or no.");
  const source = value ? MarketingSourceSchema.safeParse(how) : null;
  if (value && !source?.success)
    return fail("invalid", "Say how the patient agreed.", {
      fieldErrors: { how: "Say how the patient agreed." },
    });
  return attempt("comms.marketing_consent_set", async () => {
    const p = await patientInClinic(actor, patientId);
    if (!p) return notFound();
    const r = await changeConsent(
      actor.repo(),
      actor.tenantId,
      {
        patientId: p.id,
        channel: "email",
        purpose: "marketing",
        value,
        source: "staff",
        ...(value && source?.success ? { marketingConsentSource: source.data } : {}),
      },
      actor.actor,
    );
    return ok({ changed: r.changed });
  });
}
