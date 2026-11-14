/**
 * The platform page's view of self-serve free trials (/app/platform/trials, ClinForms staff only): every trial clinic
 * with its start, end and days left, free reports used, texts used, the abuse brake's decision, the sample clinic,
 * the emails sent and whether it converted. Ids, counts and dates only – the clinic's name for the staff's own page.
 * Cross-clinic read: the platform page only. Never throws for a missing table (before migration 0011: no rows).
 */
import type { Kysely } from "kysely";
import type { TrialEmailKind } from "../../lib/trial";
import type { Database } from "../db/schema";
import { clinicAccessOf, readClinicPlans } from "../repos/clinic-plan";
import { readClinicPackages } from "../repos/clinic-package";
import { listSelfTrials, listTrialEmails, type SelfTrial } from "../repos/self-trial";
import { countBillableReports } from "../repos/usage";

export type TrialRowState = "waiting" | "running" | "ended" | "converted";

export interface PlatformTrialRow {
  trial: SelfTrial;
  name: string;
  closed: boolean;
  state: TrialRowState;
  startedAt: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  reportsUsed: number;
  reportsIncluded: number;
  textsUsed: number;
  emails: { kind: TrialEmailKind; status: string }[];
}

async function textsUsed(db: Kysely<Database>, tenantId: string): Promise<number> {
  try {
    const rows = await db.selectFrom("pms_sms_credit_entries").select(["kind", "credits"]).where("tenant_id", "=", tenantId).where("kind", "in", ["debit", "reversal"]).execute();
    // A debit is negative, its reversal (a text not sent) positive: texts used = −(sum of both).
    return Math.max(0, rows.reduce((n, r) => n - Number(r.credits), 0));
  } catch {
    return 0;
  }
}

export async function listTrialsForPlatform(db: Kysely<Database>, now: Date = new Date()): Promise<PlatformTrialRow[]> {
  const trials = await listSelfTrials({ db });
  if (trials.length === 0) return [];
  const [plans, packages, orgs] = await Promise.all([
    readClinicPlans({ db }),
    readClinicPackages({ db }),
    db.selectFrom("organization").select(["slug", "name", "metadata"]).where("slug", "in", trials.map((t) => t.tenantId)).execute(),
  ]);
  const planOf = new Map(plans.map((p) => [p.tenantId, p] as const));
  const pkgOf = new Map(packages.map((p) => [p.tenantId, p] as const));
  const orgOf = new Map(orgs.map((o) => [o.slug, o] as const));
  const out: PlatformTrialRow[] = [];
  for (const trial of trials) {
    const plan = planOf.get(trial.tenantId) ?? null;
    const access = clinicAccessOf(plan, now);
    const converted = plan?.status === "paid" || Boolean(trial.convertedAt);
    const state: TrialRowState = converted ? "converted" : access.state === "trial_ended" ? "ended" : access.state === "trial" && !access.pending ? "running" : "waiting";
    const org = orgOf.get(trial.tenantId);
    const pkg = pkgOf.get(trial.tenantId);
    const [reportsUsed, texts, emails] = await Promise.all([
      countBillableReports({ db }, trial.tenantId).catch(() => 0),
      textsUsed(db, trial.tenantId),
      listTrialEmails({ db }, trial.tenantId).catch(() => []),
    ]);
    out.push({
      trial,
      name: org?.name ?? trial.tenantId,
      closed: Boolean(org?.metadata && /"offboardedAt"/.test(org.metadata)),
      state,
      startedAt: plan?.trialStartsAt ?? null,
      endsAt: plan?.trialEndsAt ?? null,
      daysLeft: access.state === "trial" && !access.pending ? access.daysLeft : null,
      reportsUsed,
      reportsIncluded: pkg?.package === "trial" ? pkg.reportsIncluded : trial.reportsIncluded,
      textsUsed: texts,
      emails: emails.map((e) => ({ kind: e.kind, status: e.status })),
    });
  }
  return out;
}
