"use server";
/** Settings → Clinic: the clinic profile written into referrer forms (owners and administrators only). */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/account-copy";
import { getAuth } from "@/server/auth/auth";
import { authErrorMessage } from "@/server/auth/errors";
import { actionContext, auditAction, requestHeaders, type ActionResult } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getClinicProfile, upsertClinicProfile } from "@/server/repos/clinic-profile";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

function text(form: FormData, name: string, max: number): string | null {
  const value = String(form.get(name) ?? "").trim();
  if (!value) return null;
  if (value.length > max) throw new Error(`too_long:${name}`);
  return value;
}

export async function saveClinicProfile(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await actionContext({ manage: true });
  if ("error" in ctx) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  let input;
  try {
    const displayName = text(form, "displayName", 200);
    if (!displayName) return { ok: false, error: "Enter the clinic's name." };
    const addressLines = String(form.get("address") ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (addressLines.length > 8 || addressLines.some((l) => l.length > 200)) return { ok: false, error: "Use up to 8 address lines of up to 200 characters." };
    const postcode = text(form, "postcode", 16);
    if (postcode && !POSTCODE.test(postcode)) return { ok: false, error: "Enter a UK postcode, for example MK9 2FZ." };
    const email = text(form, "email", 254);
    if (email && !EMAIL.test(email)) return { ok: false, error: ACCOUNT_ERRORS.invalidEmail };
    const phone = text(form, "phone", 40);
    if (phone && !/^[0-9 +()-]{6,40}$/.test(phone)) return { ok: false, error: "Enter a phone number using digits, spaces and + ( ) -." };
    const retentionDays = Number(form.get("retentionDays"));
    if (!Number.isInteger(retentionDays) || retentionDays < RETENTION_MIN_DAYS || retentionDays > RETENTION_MAX_DAYS) {
      return { ok: false, error: ACCOUNT_ERRORS.retentionRange };
    }
    input = {
      displayName,
      legalName: text(form, "legalName", 200),
      address: addressLines.length ? addressLines : null,
      postcode: postcode ? postcode.toUpperCase() : null,
      phone,
      email: email ? email.toLowerCase() : null,
      retentionDays,
    };
  } catch {
    return { ok: false, error: "One of the fields is too long." };
  }
  const db = getDb();
  const tenantId = ctx.membership.tenantId;
  const current = await getClinicProfile({ db }, tenantId);
  try {
    await upsertClinicProfile({ db }, tenantId, {
      ...input,
      organizationId: ctx.membership.organizationId,
      draftingEnabled: current?.draftingEnabled ?? false,
    });
    if (input.displayName !== ctx.membership.clinicName) {
      // Keep the clinic's name in the account (shown in invitations and the clinic picker) in step.
      await getAuth().api.updateOrganization({
        body: { data: { name: input.displayName }, organizationId: ctx.membership.organizationId },
        headers: requestHeaders(),
      });
    }
  } catch (err) {
    return { ok: false, error: authErrorMessage(err, "clinic_profile") };
  }
  const changed = current
    ? (
        [
          ["displayName", current.displayName, input.displayName],
          ["legalName", current.legalName, input.legalName],
          ["address", JSON.stringify(current.address), JSON.stringify(input.address)],
          ["postcode", current.postcode, input.postcode],
          ["phone", current.phone, input.phone],
          ["email", current.email, input.email],
          ["retentionDays", current.retentionDays, input.retentionDays],
        ] as const
      )
        .filter(([, a, b]) => a !== b)
        .map(([k]) => k)
    : ["created"];
  await auditAction(ctx, { action: "clinic.update", targetType: "clinic", targetId: tenantId, detail: { fields: changed } });
  revalidatePath("/app", "layout");
  return { ok: true };
}
