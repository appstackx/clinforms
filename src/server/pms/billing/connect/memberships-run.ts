/**
 * pk03: the daily membership run – every clinic with card payments on, each membership due today charged once
 * (./service.ts chargeMembership: invoice, then the saved card off-session; one per membership and month). Run by the
 * daily cron GET /api/cron/retention after the expiry sweep (Vercel Hobby has one daily cron). Our own scheduler,
 * not subscriptions at the provider: the invoice is the clinic system's own (numbering, VAT, takings, statements),
 * nothing is billed twice in two systems, and the provider's subscription product fee is not paid
 * (docs/clinic-system/card-payments.md "Memberships"). Logs counts only. Never throws. Has a time budget.
 * 14/11/2026 (release merge with the self-serve trial): a clinic whose self-serve trial ended without a plan is read-only
 * (src/server/trial/access.ts) – its memberships are not charged (counted as skipped), like the messages cron skips it.
 */
import { cardPaymentsReady } from "../../../../modules/pms/billing/card-payments";
import { ukToday } from "../../../../modules/pms/core/text";
import { pmsNow } from "../../../../modules/pms/core/clock";
import type { RepoContext } from "../../../repos/context";
import { clinicsWithCardPayments, dueMemberships, getCardSettings } from "../../../repos/pms/billing/card-payments";
import { chargeMembership, type CardDeps } from "./service";
import { trialWriteBlock } from "../../../trial/access";

export interface MembershipRunResult {
  clinics: number;
  charged: number;
  declined: number;
  skipped: number;
  failed: number;
  errors: number;
  stoppedEarly: boolean;
}

export async function runMembershipCharges(ctx: RepoContext, deps: CardDeps, options: { budgetMs?: number; nowMs?: () => number } = {}): Promise<MembershipRunResult> {
  const out: MembershipRunResult = { clinics: 0, charged: 0, declined: 0, skipped: 0, failed: 0, errors: 0, stoppedEarly: false };
  if (!deps.switchOn || !deps.config.ok) return out;
  const cfg = deps.config.config;
  const now = options.nowMs ?? (() => Date.now());
  const started = now();
  const budget = options.budgetMs ?? 20_000;
  const today = ukToday(ctx.now ? ctx.now() : pmsNow());
  for (const clinic of await clinicsWithCardPayments(ctx)) {
    const settings = await getCardSettings(ctx, clinic.tenantId);
    if (!settings.accountRef || !cardPaymentsReady({ enabled: settings.enabled, accountRef: settings.accountRef, status: settings.status, mode: settings.accountMode, keyMode: cfg.mode })) continue;
    if (await trialWriteBlock(ctx.db, clinic.tenantId, "clinic", ctx.now ? ctx.now() : pmsNow())) {
      out.skipped += 1;
      continue;
    }
    out.clinics += 1;
    const ready = { api: cfg.api, mode: cfg.mode, settings, account: settings.accountRef };
    for (const ms of await dueMemberships(ctx, clinic.tenantId, today)) {
      if (now() - started > budget) {
        out.stoppedEarly = true;
        return out;
      }
      try {
        const r = await chargeMembership(ctx, clinic.tenantId, ms, ready, today);
        out[r] += 1;
      } catch {
        out.errors += 1;
      }
    }
  }
  return out;
}

export async function membershipRunFromCron(ctx: () => RepoContext, deps: CardDeps, log: (event: string, detail: Record<string, unknown>) => void = (event, detail) => console.info(JSON.stringify({ event, ...detail }))): Promise<MembershipRunResult | null> {
  try {
    if (!deps.switchOn) return null;
    const r = await runMembershipCharges(ctx(), deps);
    log("cron.memberships.done", { ...r });
    return r;
  } catch (err) {
    log("cron.memberships.failed", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
}
