/**
 * The self-serve free trial's emails (docs/clinic-system/trial.md) – WHEN and to WHOM; the words are in
 * src/server/email/trial-templates.ts. Sent by the EXISTING daily cron (/api/cron/retention → runTrialEmailSweep, after
 * the retention pass; no queue service) and, for the two that should not wait for the night, at once: "welcome" when
 * the owner's first sign-in starts the trial, "paid" when the first payment converts it (src/server/billing/notify.ts).
 *
 * Exactly once per clinic per email: every send is CLAIMED first (trial_email's primary key – a second run, a retried
 * request or the cron racing the request finds the row and does nothing); a send the provider refused may be retried
 * (at most 3 attempts); an email whose moment has passed is recorded as skipped, never sent late. Only clinics with a
 * self_trial row (self sign-up) – never their sample clinic, a closed clinic, or a clinic that has paid (it gets
 * "paid" only). 14/11/2026: the "deletion_warning" goes through sendTrialEmail too, but from the retention sweep
 * (./retention.ts), not this schedule. Days are UK calendar days (Europe/London). To the clinic's owners; the brand's sender (deliverEmail →
 * the clinic brand's own account for ClinDesk), tracking off as for every email.
 *
 * Never throws into the caller (a page, the webhook, the cron): failures are logged and counted.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Kysely } from "kysely";
import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME, type BrandId } from "../../lib/brand";
import { clinDeskBand, clinFormsTier } from "../../lib/billing/plans";
import { TRIAL_TIPS_KINDS, dueTrialEmails, londonDaysBetween, type TrialEmailKind } from "../../lib/trial";
import { clinicLinkBrand } from "../auth/brand-links";
import { baseUrlSetting, linkTarget } from "../auth/config";
import type { Database } from "../db/schema";
import { deliverEmail } from "../email";
import { logAuthEvent } from "../email/log";
import { trialEmail } from "../email/trial-templates";
import { readClinicPlan } from "../repos/clinic-plan";
import { readClinicSubscription } from "../repos/clinic-subscription";
import type { DbContext } from "../repos/context";
import { TRIAL_EMAIL_MAX_ATTEMPTS, claimTrialEmail, finishTrialEmail, listSelfTrials, listTrialEmails, readSelfTrial, type SelfTrial } from "../repos/self-trial";
import { trialReportAllowance } from "./allowance";

type Env = Readonly<Record<string, string | undefined>>;

export interface TrialEmailDeps {
  env?: Env;
  now?: () => Date;
}

export const STOP_TIPS_PATH = "/trial/stop-tips";

function secretOf(env: Env): string | null {
  const s = env.BETTER_AUTH_SECRET ?? "";
  return s.length >= 32 ? s : null;
}

function tipsMac(secret: string, tenantId: string): string {
  return createHmac("sha256", secret).update(`clinforms:trial-stop-tips\n${tenantId}`).digest("base64url").slice(0, 32);
}

/** The "stop these tips" link for a clinic (signed: only the clinic's own emails carry it). */
export function stopTipsUrl(origin: string, secret: string, tenantId: string): string {
  return `${origin}${STOP_TIPS_PATH}?c=${encodeURIComponent(tenantId)}&t=${tipsMac(secret, tenantId)}`;
}

/** Whether a stop-tips link's signature is right for the clinic. */
export function checkStopTips(secret: string, tenantId: string, token: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(tenantId ?? "")) || !/^[A-Za-z0-9_-]{32}$/.test(String(token ?? ""))) return false;
  const a = Buffer.from(tipsMac(secret, tenantId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where the clinic's links go, and the brand the email speaks for (the existing brand logic + APP_ORIGIN). */
async function linkFor(db: Kysely<Database>, tenantId: string, env: Env, brandOverride?: BrandId): Promise<{ origin: string; brand: BrandId }> {
  const brand = brandOverride ?? (await clinicLinkBrand(db, tenantId));
  if (env.APP_ORIGIN) {
    try {
      return { origin: new URL(env.APP_ORIGIN).origin, brand };
    } catch {
      // fall through
    }
  }
  try {
    return linkTarget(baseUrlSetting(env), brand);
  } catch {
    return { origin: "https://clinforms.co.uk", brand: "clinforms" };
  }
}

/** The clinic's owners (name, address) and its name; null for an unknown or closed clinic. */
async function ownersOf(db: Kysely<Database>, tenantId: string): Promise<{ clinicName: string; owners: { userId: string; email: string; name: string | null }[] } | null> {
  const org = await db.selectFrom("organization").select(["id", "name", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (!org || (org.metadata && /"offboardedAt"/.test(org.metadata))) return null;
  const rows = await db
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .select(["user.id as userId", "user.email as email", "user.name as name"])
    .where("member.organizationId", "=", org.id)
    .where("member.role", "=", "owner")
    .execute();
  return { clinicName: org.name, owners: rows.map((r) => ({ userId: String(r.userId), email: String(r.email), name: r.name ? String(r.name) : null })) };
}

async function planNameOf(ctx: DbContext, tenantId: string): Promise<string | null> {
  try {
    const sub = await readClinicSubscription(ctx, tenantId);
    if (!sub?.product || !sub.planKey) return null;
    if (sub.product === "clinforms") {
      const tier = clinFormsTier(sub.planKey);
      return tier ? `${CLINFORMS_NAME} ${tier.label}` : null;
    }
    const band = clinDeskBand(sub.planKey);
    return band ? `${CLINIC_SYSTEM_NAME} ${band.label}${sub.reportsKey ? " with Reports" : ""}` : null;
  } catch {
    return null;
  }
}

export type TrialSendOutcome = "sent" | "failed" | "skipped" | "not_claimed" | "no_trial";

export interface SendOptions {
  /** "paid": the product bought decides the brand (13/11/2026 review) – ClinDesk plan → ClinDesk, ClinForms → ClinForms. */
  brand?: BrandId;
  /** "deletion_warning" (14/11/2026): the UK day the clinic will be deleted – src/server/trial/retention.ts. */
  deletionDay?: string;
}

/**
 * Claims and sends ONE trial email to the clinic's owners. "not_claimed": another run has it (or it went already).
 * The clinic's row is claimed first (the schedule), then each owner's own row (a send that failed for one owner is
 * retried for that owner only – never a second copy to an owner who got it). The trial's facts are re-read here, and
 * a trial email that is not "paid" is skipped if the clinic has paid meanwhile.
 */
export async function sendTrialEmail(db: Kysely<Database>, trial: SelfTrial, kind: TrialEmailKind, deps: TrialEmailDeps = {}, options: SendOptions = {}): Promise<TrialSendOutcome> {
  const env = deps.env ?? process.env;
  const now = deps.now ? deps.now() : new Date();
  const ctx: DbContext = { db, now: () => now };
  if (trial.sampleOf) return "no_trial";
  const clinic = await ownersOf(db, trial.tenantId);
  if (!clinic) {
    if (await claimTrialEmail(ctx, trial.tenantId, kind, "skipped")) return "skipped";
    return "not_claimed";
  }
  if (!(await claimTrialEmail(ctx, trial.tenantId, kind))) return "not_claimed";
  try {
    const [plan, fresh] = await Promise.all([readClinicPlan(ctx, trial.tenantId), readSelfTrial(ctx, trial.tenantId)]);
    // Paid meanwhile (a payment between the schedule and now): only "paid" goes.
    if (kind !== "paid" && (plan?.status === "paid" || fresh?.convertedAt)) {
      await finishTrialEmail(ctx, trial.tenantId, kind, { status: "skipped" });
      return "skipped";
    }
    if (TRIAL_TIPS_KINDS.has(kind) && fresh?.tipsOffAt) {
      await finishTrialEmail(ctx, trial.tenantId, kind, { status: "skipped" });
      return "skipped";
    }
    const [link, allowance] = await Promise.all([linkFor(db, trial.tenantId, env, kind === "paid" ? options.brand : undefined), trialReportAllowance(db, trial.tenantId).catch(() => null)]);
    const secret = secretOf(env);
    const planName = kind === "paid" ? await planNameOf(ctx, trial.tenantId) : null;
    let sent = 0;
    let failed = 0;
    for (const owner of clinic.owners) {
      if (!(await claimTrialEmail(ctx, trial.tenantId, kind, "claimed", owner.userId))) continue; // this owner has it
      const message = trialEmail({
        kind,
        to: { email: owner.email, name: owner.name },
        brand: link.brand,
        clinicName: clinic.clinicName,
        origin: link.origin,
        days: plan?.trialDays ?? 14,
        endsAt: plan?.trialEndsAt ?? null,
        reportsIncluded: allowance?.included ?? trial.reportsIncluded,
        reportsUsed: allowance?.used ?? 0,
        textsGranted: trial.textsGranted,
        stopTipsUrl: secret && TRIAL_TIPS_KINDS.has(kind) ? stopTipsUrl(link.origin, secret, trial.tenantId) : null,
        planName,
        daysToEnd: plan?.trialEndsAt ? londonDaysBetween(now, plan.trialEndsAt) : undefined,
        deletionDay: options.deletionDay ?? null,
      });
      const r = await deliverEmail(message).catch(() => ({ status: "failed" as const }));
      if (r.status === "sent") sent++;
      else if (r.status === "failed") failed++;
      await finishTrialEmail(ctx, trial.tenantId, kind, { status: r.status === "sent" ? "sent" : r.status === "failed" ? "failed" : "skipped", recipients: r.status === "sent" ? 1 : 0 }, owner.userId);
    }
    // Any owner failed: the clinic's row is "failed" (retried for those owners only); otherwise done.
    const status = failed > 0 ? "failed" : sent > 0 ? "sent" : clinic.owners.length === 0 ? "skipped" : "sent";
    await finishTrialEmail(ctx, trial.tenantId, kind, { status, recipients: sent });
    logAuthEvent("trial.email", { kind, status, recipients: sent });
    return failed > 0 ? "failed" : sent > 0 ? "sent" : "skipped";
  } catch (err) {
    await finishTrialEmail(ctx, trial.tenantId, kind, { status: "failed" }).catch(() => undefined);
    logAuthEvent("trial.email_failed", { kind, error: err instanceof Error ? err.name : "error" });
    return "failed";
  }
}

/** What the schedule needs, read for one clinic. */
async function factsOf(ctx: DbContext, trial: SelfTrial) {
  const [plan, rows] = await Promise.all([readClinicPlan(ctx, trial.tenantId), listTrialEmails(ctx, trial.tenantId)]);
  const done = new Set(rows.filter((r) => r.status !== "failed" || r.attempts >= TRIAL_EMAIL_MAX_ATTEMPTS).map((r) => r.kind));
  return {
    plan,
    facts: {
      startedAt: plan?.trialStartsAt ?? null,
      endsAt: plan?.trialEndsAt ?? null,
      paid: plan?.status === "paid" || Boolean(trial.convertedAt),
      convertedAt: trial.convertedAt ?? plan?.endedAt ?? null,
      tipsOff: Boolean(trial.tipsOffAt),
      done,
    },
  };
}

/**
 * Sends the emails due for ONE clinic now, at once (the welcome when the trial starts; "paid" when it converts). Only
 * `kind` – and only when the schedule says it is due. Never throws.
 */
export async function sendTrialEmailNow(db: Kysely<Database>, tenantId: string, kind: TrialEmailKind, deps: TrialEmailDeps = {}, options: SendOptions = {}): Promise<TrialSendOutcome> {
  try {
    const now = deps.now ? deps.now() : new Date();
    const ctx: DbContext = { db, now: () => now };
    const trial = await readSelfTrial(ctx, tenantId);
    if (!trial || trial.sampleOf) return "no_trial";
    const { facts } = await factsOf(ctx, trial);
    const due = dueTrialEmails(facts, now).find((d) => d.kind === kind);
    if (!due) return "not_claimed";
    if (due.action === "skip") return (await claimTrialEmail(ctx, tenantId, kind, "skipped")) ? "skipped" : "not_claimed";
    return await sendTrialEmail(db, trial, kind, deps, options);
  } catch (err) {
    logAuthEvent("trial.email_failed", { kind, error: err instanceof Error ? err.name : "error" });
    return "failed";
  }
}

export interface TrialSweepResult {
  clinics: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Clinics left for the next run (time budget). */
  deferred: number;
}

/**
 * The daily pass over every self-serve trial: the emails due (UK days), each claimed once. A time budget keeps the
 * cron inside its limit; what is left goes the next night (the windows allow it). Never throws.
 */
export async function runTrialEmailSweep(db: Kysely<Database>, deps: TrialEmailDeps & { budgetMs?: number } = {}): Promise<TrialSweepResult> {
  const out: TrialSweepResult = { clinics: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 };
  const started = Date.now();
  let trials: SelfTrial[];
  try {
    trials = await listSelfTrials({ db });
  } catch (err) {
    logAuthEvent("trial.sweep_failed", { error: err instanceof Error ? err.name : "error" });
    return out;
  }
  for (const trial of trials) {
    if (trial.deletedAt) continue; // 14/11/2026: deleted after an unpaid trial – nothing more goes
    if (deps.budgetMs !== undefined && Date.now() - started > deps.budgetMs) {
      out.deferred++;
      continue;
    }
    out.clinics++;
    try {
      const now = deps.now ? deps.now() : new Date();
      const ctx: DbContext = { db, now: () => now };
      const { facts } = await factsOf(ctx, trial);
      for (const d of dueTrialEmails(facts, now)) {
        if (d.action === "skip") {
          if (await claimTrialEmail(ctx, trial.tenantId, d.kind, "skipped")) out.skipped++;
          continue;
        }
        const r = await sendTrialEmail(db, trial, d.kind, deps);
        if (r === "sent") out.sent++;
        else if (r === "failed") out.failed++;
        else if (r === "skipped") out.skipped++;
      }
    } catch (err) {
      out.failed++;
      logAuthEvent("trial.sweep_clinic_failed", { error: err instanceof Error ? err.name : "error" });
    }
  }
  return out;
}
