"use server";
/**
 * Platform page actions (ClinForms staff in CLINFORMS_PLATFORM_ADMINS only – re-checked on every call with a fresh
 * session; anyone else gets nothing done). Each action is audited under the "platform" pseudo-tenant.
 */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/account-copy";
import { platformActionAdmin } from "@/server/admin/guards";
import { PLATFORM_PATH, createClinicAsPlatform, markAccessRequest } from "@/server/admin/platform-console";
import { appOrigin, authSecret, baseUrlSetting } from "@/server/auth/config";
import { requestHeaders, type ActionResult } from "@/server/auth/session";
import { TenantSlugError } from "@/server/auth/tenant";
import { getDb } from "@/server/db";
import { logAuthEvent } from "@/server/email/log";
import { RepoInputError } from "@/server/repos/context";

export type CreateClinicResult = ActionResult<{
  clinicName: string;
  tenantId: string;
  inviteLink: string;
  expiresAt: string;
  emailSent: boolean;
}>;

export async function createClinicAction(_prev: CreateClinicResult | null, form: FormData): Promise<CreateClinicResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const retentionText = String(form.get("retentionDays") ?? "").trim();
  const retentionDays = retentionText === "" ? 365 : Number(retentionText);
  if (!Number.isInteger(retentionDays) || retentionDays < RETENTION_MIN_DAYS || retentionDays > RETENTION_MAX_DAYS) {
    return { ok: false, error: ACCOUNT_ERRORS.retentionRange };
  }
  try {
    const created = await createClinicAsPlatform(getDb(), admin, {
      name: String(form.get("name") ?? "").trim(),
      slug: String(form.get("slug") ?? "").trim().toLowerCase(),
      ownerEmail: String(form.get("ownerEmail") ?? ""),
      retentionDays,
      appOrigin: appOrigin(baseUrlSetting(), requestHeaders()),
      linkSecret: authSecret(),
    });
    revalidatePath(PLATFORM_PATH);
    return {
      ok: true,
      clinicName: String(form.get("name") ?? "").trim(),
      tenantId: created.tenantId,
      inviteLink: created.inviteLink,
      expiresAt: created.invitationExpiresAt,
      emailSent: created.email.status === "sent",
    };
  } catch (err) {
    if (err instanceof RepoInputError || err instanceof TenantSlugError) return { ok: false, error: err.message };
    logAuthEvent("platform.create_clinic_failed", { error: err instanceof Error ? err.name : "error" });
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
