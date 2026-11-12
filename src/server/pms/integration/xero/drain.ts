/**
 * POST /api/xero/drain – the scheduled send run for every clinic with Xero on and connected (a Cloudflare cron
 * Worker calls it every 5 minutes: Vercel Hobby crons run once a day). `Authorization: Bearer $CRON_SECRET`; refuses
 * everything without CRON_SECRET; 404 while CLINFORMS_XERO is off (as if the route did not exist).
 * Each clinic is worked on with its own id in every statement; a failure in one clinic never stops the others.
 * Clinics are taken in order of their last run (oldest first), so a long list never starves the clinics at its end.
 */
import "server-only";
import { cronAuthorized, cronSecretConfigured } from "../../../cron/auth";
import { xeroSwitchOn } from "../../../../modules/pms/integration/xero";
import type { RepoContext } from "../../../repos/pms/context";
import { clinicsToSend, markClinicRun } from "../../../repos/pms/integration/xero";
import type { XeroClient } from "./client";
import { sendForClinic } from "./sync";

export interface DrainDeps {
  env: Readonly<Record<string, string | undefined>>;
  ctx: () => RepoContext;
  client: () => XeroClient | null;
  budgetMs?: number;
  nowMs?: () => number;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handleXeroDrain(req: Request, deps: DrainDeps): Promise<Response> {
  const log = deps.log ?? ((event, detail) => console.info(JSON.stringify({ event, ...detail })));
  if (!xeroSwitchOn(deps.env)) return json(404, { ok: false, error: "Not found." });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const secret = deps.env.CRON_SECRET;
  if (!cronSecretConfigured(secret)) return json(503, { ok: false, error: "Not configured." });
  if (!cronAuthorized(req.headers.get("authorization"), secret)) {
    log("xero.drain.refused", { reason: "unauthorized" });
    return json(401, { ok: false, error: "Unauthorized." });
  }
  const client = deps.client();
  if (!client) return json(503, { ok: false, error: "The Xero app is not configured." });
  const clock = deps.nowMs ?? (() => Date.now());
  const started = clock();
  // Vercel stops the function at 60 s: no item starts after 33 s, no Xero call starts after 45 s (33 + 12).
  const budget = deps.budgetMs ?? 35_000;
  const totals = { clinics: 0, failedClinics: 0, sent: 0, blocked: 0, failed: 0, paused: 0 };
  const ctx = deps.ctx();
  for (const tenantId of await clinicsToSend(ctx)) {
    const left = budget - (clock() - started);
    if (left < 2000) break;
    totals.clinics++;
    try {
      // Taken oldest-run first, so every clinic gets its turn however long the list.
      await markClinicRun(ctx, tenantId);
      const r = await sendForClinic(ctx, tenantId, client, { budgetMs: Math.min(left - 2000, 15_000), graceMs: 12_000, nowMs: clock });
      totals.sent += r.done;
      totals.blocked += r.blocked;
      totals.failed += r.failed;
      if (r.paused) totals.paused++;
    } catch {
      totals.failedClinics++;
    }
  }
  log("xero.drain.done", totals);
  return json(200, { ok: true, ...totals });
}
