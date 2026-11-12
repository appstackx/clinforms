/**
 * The message run (GET /api/clinic-messages/cron): sends the planned appointment messages that are due, for every
 * clinic with the clinic system switched on. Authorised like the retention cron – `Authorization: Bearer
 * $CRON_SECRET`, refused when CRON_SECRET is unset (src/server/cron/auth.ts). Logs counts only.
 *
 * Schedule: on Vercel Pro every 15 minutes ("*\/15 * * * *"); Vercel Hobby allows one run a day, which suits only
 * "N days before at HH:MM" reminders at that hour (docs/clinic-system/comms.md). The cross-clinic read here is
 * the package list (which clinics to run for); everything after it is per clinic.
 */
import { packageIsOn } from "../../../modules/pms/core/entitlements";
import { cronAuthorized, cronSecretConfigured } from "../../cron/auth";
import type { RepoContext } from "../../repos/pms/context";
import { listEntitlementsByTenant } from "../../repos/pms/entitlements";
import { reconcileDiaryMessages } from "../diary/message-sync";
import { runAllDueMessages, type DispatchDeps, type RunSummary } from "./dispatch";
import { runCampaigns } from "./campaigns/send";
import { CommsConfigError } from "./providers";
import { pmsNow, pmsNowMs } from "../../../modules/pms/core/clock";

export interface CommsCronDeps {
  secret: string | undefined;
  /** Resolved lazily: an unauthorised call never touches the database. */
  ctx: () => RepoContext;
  dispatch: () => DispatchDeps;
  log?: (event: string, detail: Record<string, unknown>) => void;
  /** Total time for the run (default 45 s – the route's maxDuration is 60 s). */
  budgetMs?: number;
  /**
   * Bulk email (0146): true only when the platform switch CLINFORMS_BULK_EMAIL=on (the route reads it). Then each
   * clinic whose own bulk email setting is on also sends what is due of its campaigns, after its planned messages.
   */
  bulkEmail?: boolean;
  /** The campaign pass's own time (default 10 s, at most a third of the run's budget). */
  campaignBudgetMs?: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** Clinics whose clinic system is on (the one cross-clinic read of the run). */
export async function clinicsWithClinicSystem(ctx: RepoContext): Promise<string[]> {
  const byTenant = await listEntitlementsByTenant(ctx);
  const now = ctx.now ? ctx.now() : pmsNow();
  return Array.from(byTenant.entries())
    .filter(([, rows]) => packageIsOn("clinic", rows.find((r) => r.package === "clinic") ?? null, now))
    .map(([tenantId]) => tenantId)
    .sort();
}

export async function handleCommsCron(req: Request, deps: CommsCronDeps): Promise<Response> {
  const log = deps.log ?? ((event, detail) => console.info(JSON.stringify({ event, ...detail })));
  if (!cronSecretConfigured(deps.secret)) {
    log("cron.clinic_messages.refused", { reason: "not_configured" });
    return json(503, { ok: false, error: "Not configured." });
  }
  if (!cronAuthorized(req.headers.get("authorization"), deps.secret)) {
    log("cron.clinic_messages.refused", { reason: "unauthorized" });
    return json(401, { ok: false, error: "Unauthorized." });
  }
  let dispatch: DispatchDeps;
  try {
    dispatch = deps.dispatch();
  } catch (err) {
    log("cron.clinic_messages.refused", { reason: err instanceof CommsConfigError ? "provider_not_configured" : "error" });
    return json(503, { ok: false, error: "The message service is not configured." });
  }
  const started = pmsNowMs();
  const budget = deps.budgetMs ?? 45_000;
  const totals: Omit<RunSummary, "reasons"> & { clinics: number; failedClinics: number; campaignEmails?: number } = { clinics: 0, failedClinics: 0, claimed: 0, released: 0, sent: 0, outbox: 0, failed: 0, skipped: 0 };
  try {
    const ctx = deps.ctx();
    const clinics = await clinicsWithClinicSystem(ctx);
    // Pass 1: every clinic's planned messages (reminders, confirmations, notices) – these come first, always. With
    // bulk email on, pass 1 leaves the campaign pass its own time, so campaigns never starve reminders and reminders
    // never leave campaigns nothing.
    const campaignBudget = deps.bulkEmail ? Math.min(deps.campaignBudgetMs ?? 10_000, Math.floor(budget / 3)) : 0;
    const plannedBudget = budget - campaignBudget;
    for (const tenantId of clinics) {
      if (pmsNowMs() - started > plannedBudget) break;
      totals.clinics++;
      try {
        // First heal any diary write whose message sync failed (M9b – the same run, no other job).
        await reconcileDiaryMessages(ctx, tenantId);
        const r = await runAllDueMessages(ctx, tenantId, dispatch, { budgetMs: Math.max(1000, plannedBudget - (pmsNowMs() - started)) });
        totals.claimed += r.claimed;
        totals.released += r.released;
        totals.sent += r.sent;
        totals.outbox += r.outbox;
        totals.failed += r.failed;
        totals.skipped += r.skipped;
      } catch (err) {
        totals.failedClinics++;
        log("cron.clinic_messages.clinic_failed", { error: err instanceof Error ? err.name : "unknown" });
      }
    }
    // Pass 2 (bulk email, CLINFORMS_BULK_EMAIL=on): campaigns, with their own budget, after every clinic's planned
    // messages. A clinic whose campaign fails does not stop the others.
    if (deps.bulkEmail) {
      const passStarted = pmsNowMs();
      totals.campaignEmails = 0;
      for (const tenantId of clinics) {
        const left = campaignBudget - (pmsNowMs() - passStarted);
        if (left <= 0) break;
        try {
          const c = await runCampaigns(ctx, tenantId, dispatch, { budgetMs: Math.max(500, left) });
          totals.campaignEmails += c.written;
        } catch (err) {
          log("cron.clinic_messages.campaigns_failed", { error: err instanceof Error ? err.name : "unknown" });
        }
      }
    }
  } catch (err) {
    log("cron.clinic_messages.failed", { error: err instanceof Error ? err.name : "unknown" });
    return json(500, { ok: false, error: "Message run failed." });
  }
  log("cron.clinic_messages.done", { ...totals, ms: pmsNowMs() - started });
  return json(200, { ok: true, ...totals });
}
