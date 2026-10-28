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
import { runAllDueMessages, type DispatchDeps, type RunSummary } from "./dispatch";
import { CommsConfigError } from "./providers";

export interface CommsCronDeps {
  secret: string | undefined;
  /** Resolved lazily: an unauthorised call never touches the database. */
  ctx: () => RepoContext;
  dispatch: () => DispatchDeps;
  log?: (event: string, detail: Record<string, unknown>) => void;
  /** Total time for the run (default 45 s – the route's maxDuration is 60 s). */
  budgetMs?: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** Clinics whose clinic system is on (the one cross-clinic read of the run). */
export async function clinicsWithClinicSystem(ctx: RepoContext): Promise<string[]> {
  const byTenant = await listEntitlementsByTenant(ctx);
  const now = ctx.now ? ctx.now() : new Date();
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
  const started = Date.now();
  const budget = deps.budgetMs ?? 45_000;
  const totals: Omit<RunSummary, "reasons"> & { clinics: number; failedClinics: number } = { clinics: 0, failedClinics: 0, claimed: 0, released: 0, sent: 0, outbox: 0, failed: 0, skipped: 0 };
  try {
    const ctx = deps.ctx();
    for (const tenantId of await clinicsWithClinicSystem(ctx)) {
      if (Date.now() - started > budget) break;
      totals.clinics++;
      try {
        const r = await runAllDueMessages(ctx, tenantId, dispatch, { budgetMs: Math.max(1000, budget - (Date.now() - started)) });
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
  } catch (err) {
    log("cron.clinic_messages.failed", { error: err instanceof Error ? err.name : "unknown" });
    return json(500, { ok: false, error: "Message run failed." });
  }
  log("cron.clinic_messages.done", { ...totals, ms: Date.now() - started });
  return json(200, { ok: true, ...totals });
}
