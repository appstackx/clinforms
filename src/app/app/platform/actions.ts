"use server";
/**
 * Platform page actions (ClinForms staff in CLINFORMS_PLATFORM_ADMINS only – re-checked on every call with a fresh
 * session; anyone else gets nothing done). Each action is audited under the "platform" pseudo-tenant.
 */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, type InviteDelivery } from "@/lib/account-copy";
import { endTrial, extendTrial, setDraftingLimits, setTrial } from "@/server/admin/clinic-plan";
import { platformActionAdmin } from "@/server/admin/guards";
import { PLATFORM_PATH, createClinicAsPlatform, createOwnerResetLinkAsPlatform, markAccessRequest } from "@/server/admin/platform-console";
import { getAuth } from "@/server/auth/auth";
import { appOrigin, authSecret, baseUrlSetting } from "@/server/auth/config";
import { normaliseEmail } from "@/server/auth/platform";
import { requestHeaders, type ActionResult } from "@/server/auth/session";
import { TenantSlugError } from "@/server/auth/tenant";
import { getDb } from "@/server/db";
import { inviteDeliveryOf } from "@/server/email";
import { logAuthEvent } from "@/server/email/log";
import { RepoInputError } from "@/server/repos/context";

export type CreateClinicResult = ActionResult<{
  clinicName: string;
  tenantId: string;
  ownerEmail: string;
  inviteLink: string;
  expiresAt: string;
  delivery: InviteDelivery;
}>;

export async function createClinicAction(_prev: CreateClinicResult | null, form: FormData): Promise<CreateClinicResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const retentionText = String(form.get("retentionDays") ?? "").trim();
  const retentionDays = retentionText === "" ? 365 : Number(retentionText);
  if (!Number.isInteger(retentionDays) || retentionDays < RETENTION_MIN_DAYS || retentionDays > RETENTION_MAX_DAYS) {
    return { ok: false, error: ACCOUNT_ERRORS.retentionRange };
  }
  // The form offers "Email the invitation to the owner" only while email is set up ("emailChoice"). Security fix
  // 24/10/2026 (D4): the box is OFF by default – an owner's address may be a shared inbox, and whoever opens the
  // invitation first becomes the owner; tick it only for the owner's own mailbox.
  const sendEmail = !(form.get("emailChoice") === "1" && form.get("sendEmail") !== "on");
  try {
    const created = await createClinicAsPlatform(getDb(), admin, {
      name: String(form.get("name") ?? "").trim(),
      slug: String(form.get("slug") ?? "").trim().toLowerCase(),
      ownerEmail: String(form.get("ownerEmail") ?? ""),
      retentionDays,
      appOrigin: appOrigin(baseUrlSetting(), requestHeaders()),
      linkSecret: authSecret(),
      sendEmail,
    });
    revalidatePath(PLATFORM_PATH);
    return {
      ok: true,
      clinicName: String(form.get("name") ?? "").trim(),
      tenantId: created.tenantId,
      ownerEmail: normaliseEmail(String(form.get("ownerEmail") ?? "")),
      inviteLink: created.inviteLink,
      expiresAt: created.invitationExpiresAt,
      delivery: inviteDeliveryOf(created.email),
    };
  } catch (err) {
    if (err instanceof RepoInputError || err instanceof TenantSlugError) return { ok: false, error: err.message };
    logAuthEvent("platform.create_clinic_failed", { error: err instanceof Error ? err.name : "error" });
    return { ok: false, error: ACCOUNT_ERRORS.generic };
  }
}

export type OwnerResetResult = ActionResult<{ tenantId: string; ownerEmail: string; link: string; expiresAt: string }>;

/**
 * A one-time password reset link for a clinic owner who cannot use "Forgotten your password?" and has nobody in the
 * clinic to create one (e.g. its only owner, email off or not arriving). Never emailed: shown once on the page.
 */
export async function createOwnerResetLinkAction(_prev: OwnerResetResult | null, form: FormData): Promise<OwnerResetResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  try {
    const tenantId = String(form.get("tenantId") ?? "").trim();
    const ownerEmail = normaliseEmail(String(form.get("resetOwnerEmail") ?? ""));
    const created = await createOwnerResetLinkAsPlatform(getDb(), admin, {
      tenantId,
      ownerEmail,
      requestReset: (email) => getAuth().api.requestPasswordReset({ body: { email }, headers: requestHeaders() }),
    });
    revalidatePath(PLATFORM_PATH);
    return { ok: true, tenantId, ownerEmail, link: created.link, expiresAt: created.expiresAt };
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, error: err.message };
    logAuthEvent("platform.owner_reset_link_failed", { error: err instanceof Error ? err.name : "error" });
    return { ok: false, error: ACCOUNT_ERRORS.generic };
  }
}

/** Marks an access request as contacted (contacted=1) or back to not contacted (contacted=0). */
export async function setAccessRequestContactedAction(form: FormData): Promise<void> {
  const admin = await platformActionAdmin();
  if (!admin) return;
  try {
    await markAccessRequest({ db: getDb() }, admin, String(form.get("id") ?? ""), form.get("contacted") === "1");
  } catch {
    // unknown or malformed id: nothing to do
  }
  revalidatePath(PLATFORM_PATH);
}

/* ------------------------------------------------------------------------------------------------
 * Trials and drafting limits (10/2026) – every change audited (src/server/admin/clinic-plan.ts)
 * ----------------------------------------------------------------------------------------------*/

export type PlanActionResult = ActionResult<{ message: string }>;

const UK_DATE_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

function intField(form: FormData, name: string): number | null {
  const text = String(form.get(name) ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isInteger(n) ? n : NaN;
}

/** Runs a plan change for an administrator already checked by the action itself; errors become messages. */
async function runPlanChange(run: () => Promise<string>): Promise<PlanActionResult> {
  try {
    const message = await run();
    revalidatePath(PLATFORM_PATH);
    return { ok: true, message };
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, error: err.message };
    logAuthEvent("platform.plan_change_failed", { error: err instanceof Error ? err.name : "error" });
    return { ok: false, error: ACCOUNT_ERRORS.generic };
  }
}

/** Sets (or restarts) a trial: days, starting when the owner first signs in (default) or now. */
export async function setTrialAction(_prev: PlanActionResult | null, form: FormData): Promise<PlanActionResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  return runPlanChange(async () => {
    const tenantId = String(form.get("tenantId") ?? "").trim();
    const days = intField(form, "days") ?? 3;
    const start = form.get("start") === "now" ? "now" : "first_sign_in";
    const r = await setTrial(getDb(), { kind: "platform", admin }, tenantId, { days, start });
    if (!r.plan.trialEndsAt) return `${tenantId}: a ${days}-day trial starts when the owner first signs in.`;
    return `${tenantId}: the ${days}-day trial ${r.startedNow ? "started now (the owner has already signed in)" : "started now"} and ends ${UK_DATE_TIME.format(new Date(r.plan.trialEndsAt))}.`;
  });
}

/** Extend / convert / end now, by the button pressed ("what"). */
export async function changeTrialAction(_prev: PlanActionResult | null, form: FormData): Promise<PlanActionResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  return runPlanChange(async () => {
    const tenantId = String(form.get("tenantId") ?? "").trim();
    const what = String(form.get("what") ?? "");
    const actor = { kind: "platform" as const, admin };
    if (what === "extend") {
      const days = intField(form, "days");
      if (days === null || Number.isNaN(days)) throw new RepoInputError("Enter how many days to add.");
      const plan = await extendTrial(getDb(), actor, tenantId, days);
      return plan.trialEndsAt
        ? `${tenantId}: the trial now ends ${UK_DATE_TIME.format(new Date(plan.trialEndsAt))}.`
        : `${tenantId}: the trial is now ${plan.trialDays} days, starting when the owner first signs in.`;
    }
    if (what === "paid") {
      await endTrial(getDb(), actor, tenantId, "paid");
      return `${tenantId}: the trial was converted to a full account.`;
    }
    if (what === "end") {
      await endTrial(getDb(), actor, tenantId, "now");
      return `${tenantId}: the trial has ended. The clinic can still open and download its records, but cannot create anything new.`;
    }
    throw new RepoInputError("Choose what to do with the trial.");
  });
}

/** The clinic's own drafting limits; empty = the default. */
export async function setLimitsAction(_prev: PlanActionResult | null, form: FormData): Promise<PlanActionResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  return runPlanChange(async () => {
    const tenantId = String(form.get("tenantId") ?? "").trim();
    const reset = form.get("what") === "default";
    const perMinute = reset ? null : intField(form, "perMinute");
    const perDay = reset ? null : intField(form, "perDay");
    if (Number.isNaN(perMinute) || Number.isNaN(perDay)) throw new RepoInputError("Limits are whole numbers (leave empty for the default).");
    const plan = await setDraftingLimits(getDb(), { kind: "platform", admin }, tenantId, { perMinute, perDay });
    const text = (v: number | null, unit: string) => (v === null ? `the default a ${unit}` : `${v.toLocaleString("en-GB")} a ${unit}`);
    return `${tenantId}: drafting limits are ${text(plan.livePerMinute, "minute")} and ${text(plan.livePerDay, "day")}.`;
  });
}
