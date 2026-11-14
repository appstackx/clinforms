/**
 * Gives a clinic created by self sign-up its free trial (docs/clinic-system/trial.md) – called by the sign-up's last
 * step (src/server/signup/self-signup.ts finishSignup), so only while CLINFORMS_SELF_SIGNUP is on. Every step is
 * idempotent: a retried sign-up (the same link after a failure) finishes what is missing and never gives twice.
 *
 *   1. the trial record (self_trial) with the abuse decision: a repeat (same address, a busy network or domain) still
 *      gets the trial, but no free reports or texts;
 *   2. the clinic's plan: a trial of CLINFORMS_TRIAL_DAYS starting at the owner's first sign-in, and the trial's own
 *      drafting limits (the backstop against endless re-drafting);
 *   3. the packages: ClinDesk clinics get the clinic system and Reports as "trial" (on, no end – after the trial the
 *      records stay readable, ./access.ts makes them read-only); ClinForms clinics keep Reports (their default);
 *   4. the free reports: a "Trial" package with that many reports included (drafting stops there – ./allowance.ts);
 *   5. the free texts (ClinDesk only – texts are a clinic-system feature): one ledger adjustment labelled as trial
 *      credits, keyed so it is made once;
 *   6. audit "clinic.trial_self_serve" (what was given, never an address).
 *
 * Pure server code over a database handle (no Next imports).
 */
import { createHmac } from "node:crypto";
import type { Kysely } from "kysely";
import type { BrandId } from "../../lib/brand";
import { TRIAL_LIMITS, canonicalTrialEmail, ownEmailDomain, trialDays, trialNetworkOf, trialReports, trialTexts } from "../../lib/trial";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { getClinicPackage, setClinicPackage } from "../repos/clinic-package";
import { getClinicPlan, setClinicDraftingLimits, setClinicTrial } from "../repos/clinic-plan";
import type { DbContext } from "../repos/context";
import { adjustSmsCredits } from "../repos/pms/comms/credits";
import { getEntitlement, setEntitlement } from "../repos/pms/entitlements";
import {
  countAllowanceTrialsByDomain,
  countAllowanceTrialsByNetwork,
  countTrialsByEmailKey,
  createSelfTrial,
  getSelfTrial,
  type RepeatReason,
  type SelfTrial,
} from "../repos/self-trial";

type Env = Readonly<Record<string, string | undefined>>;

const DAY_MS = 86_400_000;

/** The ledger's label for the free texts (shown to the clinic on Text credits). */
export const TRIAL_TEXTS_REASON = "Trial credits – free test texts for your trial";

export interface TrialKeys {
  emailKey: string;
  networkKey: string;
  domainKey: string | null;
}

function keyed(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`clinforms:trial:${purpose}\n${value}`).digest("base64url").slice(0, 43);
}

/** The keyed hashes the abuse brake compares (never the address, the IP or the domain themselves). */
export function trialKeys(secret: string, email: string, ip: string): TrialKeys {
  const domain = ownEmailDomain(email);
  return {
    emailKey: keyed(secret, "email", canonicalTrialEmail(email)),
    networkKey: keyed(secret, "network", trialNetworkOf(ip)),
    domainKey: domain ? keyed(secret, "domain", domain) : null,
  };
}

/** Whether this trial is a repeat (and why): checked in this order – address, network, domain. */
export async function repeatReasonFor(ctx: DbContext, keys: TrialKeys): Promise<RepeatReason | null> {
  const since = new Date((ctx.now ? ctx.now() : new Date()).getTime() - 30 * DAY_MS).toISOString();
  if ((await countTrialsByEmailKey(ctx, keys.emailKey)) > 0) return "email";
  if ((await countAllowanceTrialsByNetwork(ctx, keys.networkKey, since)) >= TRIAL_LIMITS.perNetwork30Days) return "network";
  if (keys.domainKey && (await countAllowanceTrialsByDomain(ctx, keys.domainKey, since)) >= TRIAL_LIMITS.perDomain30Days) return "domain";
  return null;
}

export interface StartTrialInput {
  tenantId: string;
  brand: BrandId;
  /** The owner (audit rows name them). */
  userId: string;
  email: string;
  ip: string;
  secret: string;
}

export interface StartTrialResult {
  trial: SelfTrial;
  /** False when the trial existed already (a retried sign-up). */
  created: boolean;
}

export async function startSelfServeTrial(db: Kysely<Database>, input: StartTrialInput, opts: { env?: Env; now?: () => Date } = {}): Promise<StartTrialResult> {
  const env = opts.env ?? process.env;
  const ctx: DbContext = opts.now ? { db, now: opts.now } : { db };
  const actor = { userId: input.userId, sessionId: null };
  let trial = await getSelfTrial(ctx, input.tenantId);
  let created = false;
  if (!trial) {
    const keys = trialKeys(input.secret, input.email, input.ip);
    const repeat = await repeatReasonFor(ctx, keys);
    const r = await createSelfTrial(ctx, input.tenantId, {
      brand: input.brand,
      ...keys,
      reportsIncluded: repeat ? 0 : trialReports(env),
      textsGranted: repeat || input.brand !== "clinic" ? 0 : trialTexts(env),
      repeatReason: repeat,
    });
    trial = r.trial;
    created = r.created;
  }

  // 2. The plan: a trial waiting for the owner's first sign-in (only if none was set – a retry keeps a started one).
  const plan = await getClinicPlan(ctx, input.tenantId);
  if (!plan || (plan.status === "standard" && plan.trialDays === null)) {
    await setClinicTrial(ctx, input.tenantId, { days: trialDays(env), startOnFirstSignIn: true });
  }
  const limits = await getClinicPlan(ctx, input.tenantId);
  if (limits && limits.livePerMinute === null && limits.livePerDay === null) {
    await setClinicDraftingLimits(ctx, input.tenantId, { perMinute: TRIAL_LIMITS.draftingPerMinute, perDay: TRIAL_LIMITS.draftingPerDay });
  }

  // 3. The packages (ClinDesk): the clinic system and Reports on as "trial", no end.
  if (input.brand === "clinic") {
    for (const pkg of ["clinic", "reports"] as const) {
      const e = await getEntitlement(ctx, input.tenantId, pkg);
      if (!e || e.status === "paused") {
        await setEntitlement(ctx, input.tenantId, pkg, { status: "trial", priceSource: "list", note: "Self-serve free trial" }, actor);
      }
    }
  }

  // 4. The free reports (the trial's allowance; drafting stops there).
  if (!(await getClinicPackage(ctx, input.tenantId))) {
    await setClinicPackage(ctx, input.tenantId, {
      package: "trial",
      monthlyPricePence: 0,
      reportsIncluded: trial.reportsIncluded,
      extraReportPence: null,
      notes: "Self-serve free trial.",
    });
  }

  // 5. The free texts, once (the ledger's unique event reference makes a second grant a "duplicate").
  if (trial.textsGranted > 0) {
    await adjustSmsCredits(ctx, input.tenantId, { credits: trial.textsGranted, reason: TRIAL_TEXTS_REASON }, actor, { trial: true }, { requestId: `trial-texts-${input.tenantId}` });
  }

  // 6. Audit (once).
  if (created) {
    await appendAudit(ctx, input.tenantId, {
      userId: input.userId,
      action: "clinic.trial_self_serve",
      targetType: "clinic",
      targetId: input.tenantId,
      detail: { days: trialDays(env), reports: trial.reportsIncluded, texts: trial.textsGranted, ...(trial.repeatReason ? { repeat: trial.repeatReason } : {}) },
    });
  }
  return { trial, created };
}
