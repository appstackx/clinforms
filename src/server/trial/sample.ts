/**
 * "Explore with sample data" (13/11/2026, docs/clinic-system/trial.md §Sample clinic) – a SEPARATE sample clinic with a
 * clearly marked fictional dataset, which the trial clinic's owner can switch to (Switch clinic).
 *
 * Why a separate clinic, not flagged sample records inside the real one: every report, export, invoice run, reminder
 * and count is scoped by clinic (tenant) already, so made-up patients can NEVER appear in the real clinic's reports,
 * exports, Healthcode checks or patient searches – nothing has to remember a "sample" flag, and removing it can never
 * touch a real record. The sample clinic reuses the demonstration clinic's seed (scripts/pms – Riverside's made-up
 * sites, practitioners and patients, drama-range phone numbers, @example.com addresses) and the demo-clinic flags
 * (banner "Demo clinic – made-up data only", a notice on every output).
 *
 * Its limits (abuse: it must never be a free second clinic): one per trial clinic (one conditional claim); the SAME
 * trial window as the real clinic (it ends with it – read-only afterwards like the trial – and paying for the real
 * clinic does not convert it); no Reports (no drafting – drafting costs money), no free texts and no reminder rules
 * (nothing is sent to anyone); no invitations of its own (only the owner is a member).
 */
import type { Kysely } from "kysely";
import { seedDemoClinic } from "../../../scripts/pms/seed-lib";
import { seedBilling } from "../../../scripts/pms/seed-billing";
import { seedDiary } from "../../../scripts/pms/seed-diary";
import { seedRecords } from "../../../scripts/pms/seed-records";
import { seedSetup } from "../../../scripts/pms/seed-setup";
import { SIGNUP_BRAND_KEY } from "../auth/brand-links";
import { authId } from "../auth/platform";
import { tenantSlugProblem } from "../auth/tenant";
import type { DataCipher } from "../crypto/envelope";
import { runBatch } from "../db/batch";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import { clinicAccessOf, getClinicPlan, setClinicDemoFlag, setClinicTrialWindow } from "../repos/clinic-plan";
import type { RepoContext } from "../repos/context";
import { setEntitlement } from "../repos/pms/entitlements";
import { claimSampleClinic, createSelfTrial, getSelfTrial, setSampleState, type SelfTrial } from "../repos/self-trial";

/** Patients in a sample clinic: enough to look real in the diary and reports, quick to create. */
export const SAMPLE_PATIENTS = 40;

export type SampleOutcome =
  | { status: "created"; sampleTenantId: string; organizationId: string }
  | { status: "exists"; sampleTenantId: string; organizationId: string | null }
  | { status: "busy" }
  | { status: "unavailable"; why: "no_trial" | "not_running" | "declined" | "not_owner" | "not_clinic_brand" };

/** The sample clinic's name: the real clinic's, marked – it always ends "(fictional)" (the demo-data rule). */
export function sampleClinicName(clinicName: string): string {
  const base = clinicName.replace(/\s*\(fictional\)\s*$/i, "").trim().slice(0, 120);
  return `${base} – sample clinic (fictional)`;
}

async function freeSampleSlug(db: Kysely<Database>, tenantId: string): Promise<string> {
  const base = `${tenantId.slice(0, 48).replace(/-+$/, "")}-sample`;
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (tenantSlugProblem(slug)) continue;
    const taken = await db.selectFrom("organization").select("id").where("slug", "=", slug).executeTakeFirst();
    const history = taken ? null : await db.selectFrom("audit_log").select("id").where("tenant_id", "=", slug).limit(1).executeTakeFirst();
    if (!taken && !history) return slug;
  }
  throw new Error("No free sample clinic id");
}

export interface SampleDeps {
  db: Kysely<Database>;
  cipher: DataCipher;
  now?: () => Date;
  /** Seed size (tests use fewer; at least 12 – the diary week needs 10). */
  patients?: number;
}

/**
 * Creates the trial clinic's sample clinic (or finishes one a crashed attempt left). The caller has checked the
 * member: signed in, two-step done, the OWNER of `tenantId` (re-checked here against the member table).
 */
export async function createSampleClinic(deps: SampleDeps, input: { tenantId: string; userId: string }): Promise<SampleOutcome> {
  const now = deps.now ?? (() => new Date());
  const ctx: RepoContext = { db: deps.db, cipher: deps.cipher, now };
  const db = deps.db;
  const trial: SelfTrial | null = await getSelfTrial(ctx, input.tenantId);
  if (!trial || trial.sampleOf) return { status: "unavailable", why: "no_trial" };
  if (trial.brand !== "clinic") return { status: "unavailable", why: "not_clinic_brand" };
  if (trial.sampleState === "declined") return { status: "unavailable", why: "declined" };
  const org = await db.selectFrom("organization").select(["id", "name", "metadata"]).where("slug", "=", input.tenantId).executeTakeFirst();
  if (!org) return { status: "unavailable", why: "no_trial" };
  const owner = await db.selectFrom("member").select("id").where("organizationId", "=", org.id).where("userId", "=", input.userId).where("role", "=", "owner").executeTakeFirst();
  if (!owner) return { status: "unavailable", why: "not_owner" };
  const plan = await getClinicPlan(ctx, input.tenantId);
  const access = clinicAccessOf(plan, now());
  if (access.state !== "trial" || access.pending || !plan?.trialStartsAt || !plan.trialEndsAt || !plan.trialDays) return { status: "unavailable", why: "not_running" };
  if (trial.sampleState === "ready" && trial.sampleTenantId) {
    const s = await db.selectFrom("organization").select("id").where("slug", "=", trial.sampleTenantId).executeTakeFirst();
    return { status: "exists", sampleTenantId: trial.sampleTenantId, organizationId: s?.id ?? null };
  }

  // One claim: a resumed attempt keeps the id it claimed before.
  const slug = trial.sampleState === "creating" && trial.sampleTenantId ? trial.sampleTenantId : await freeSampleSlug(db, input.tenantId);
  if (!(await claimSampleClinic(ctx, input.tenantId, slug))) return { status: "busy" };

  // A failure below leaves the claim "creating": the next attempt after SAMPLE_CLAIM_STALE_MS takes it over and resumes
  // (each step adds only what is missing).
  {
    const at = now().toISOString();
    let sampleOrg = await db.selectFrom("organization").select("id").where("slug", "=", slug).executeTakeFirst();
    const brand = (() => {
      try {
        return org.metadata && (JSON.parse(org.metadata) as Record<string, unknown>)[SIGNUP_BRAND_KEY] === "clinic" ? "clinic" : null;
      } catch {
        return null;
      }
    })();
    if (!sampleOrg) {
      const organizationId = authId();
      await runBatch(db, [
        db.insertInto("organization").values({
          id: organizationId,
          name: sampleClinicName(org.name),
          slug,
          logo: null,
          createdAt: at,
          metadata: JSON.stringify({ ...(brand ? { [SIGNUP_BRAND_KEY]: brand } : {}), sampleOf: input.tenantId }),
        }),
        db.insertInto("clinic_profile").values({
          tenant_id: slug,
          organization_id: organizationId,
          display_name: sampleClinicName(org.name),
          legal_name: null,
          address_json: null,
          postcode: null,
          phone: null,
          email: null,
          retention_days: 30,
          drafting_enabled: 0,
          created_at: at,
          updated_at: at,
        }),
        db.insertInto("member").values({ id: authId(), organizationId, userId: input.userId, role: "owner", createdAt: at }),
      ]);
      sampleOrg = { id: organizationId };
      await appendAudit(ctx, slug, { userId: input.userId, action: "clinic.sample_created", targetType: "organization", targetId: organizationId, detail: { sampleOf: input.tenantId } });
      await appendAudit(ctx, input.tenantId, { userId: input.userId, action: "clinic.sample_created", targetType: "organization", targetId: organizationId, detail: { sample: slug } });
    }
    await createSelfTrial(ctx, slug, { brand: trial.brand, sampleOf: input.tenantId, emailKey: trial.emailKey, networkKey: trial.networkKey, reportsIncluded: 0, textsGranted: 0, repeatReason: null });
    await setClinicTrialWindow(ctx, slug, { days: plan.trialDays, startsAt: plan.trialStartsAt, endsAt: plan.trialEndsAt });
    await setClinicDemoFlag(ctx, slug, true);
    await setEntitlement(ctx, slug, "reports", { status: "paused", note: "Sample clinic: no Reports" }, { userId: input.userId, sessionId: null });
    // The made-up dataset (the clinic system on as "trial", the demo flag on its own settings): directory, patients,
    // cases; then set-up, a diary week, notes and invoices. No messages, portal or forms – nothing is ever sent.
    await seedDemoClinic(ctx, { tenantId: slug, markDemo: true, resume: true, patients: Math.max(12, deps.patients ?? SAMPLE_PATIENTS), seed: 2026, now: now() });
    await seedSetup(ctx, slug);
    await seedDiary(ctx, slug, { now: now() });
    await seedRecords(ctx, slug, { now: now() });
    await seedBilling(ctx, slug, { now: now() });
    await setSampleState(ctx, input.tenantId, "ready");
    return { status: "created", sampleTenantId: slug, organizationId: sampleOrg.id };
  }
}

/** "No thanks": the offer is not shown again (only while there is no sample). */
export async function declineSampleClinic(db: Kysely<Database>, tenantId: string, now?: () => Date): Promise<void> {
  await setSampleState(now ? { db, now } : { db }, tenantId, "declined");
}
