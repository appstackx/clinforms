"use server";
/** Settings → API keys (owners and administrators): create (shown once) and revoke. */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { actionContext, auditAction, type ActionResult } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { RepoInputError } from "@/server/repos/context";
import { createPartnerKey, revokePartnerKey } from "@/server/repos/partner-keys";

export type CreateKeyResult = ActionResult<{ key: string; name: string }>;

export async function createApiKey(_prev: CreateKeyResult | null, form: FormData): Promise<CreateKeyResult> {
  const ctx = await actionContext({ manage: true });
  if ("error" in ctx) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const name = String(form.get("name") ?? "").trim();
  try {
    const created = await createPartnerKey({ db: getDb() }, ctx.membership.tenantId, { name, createdBy: ctx.session.user.id });
    await auditAction(ctx, { action: "api_key.create", targetType: "partner_key", targetId: created.id, detail: { last4: created.last4 } });
    revalidatePath("/app/settings/api-keys");
    return { ok: true, key: created.key, name: created.name };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? "Give the key a name of up to 80 characters." : ACCOUNT_ERRORS.generic };
  }
}

export async function revokeApiKey(form: FormData): Promise<void> {
  const ctx = await actionContext({ manage: true });
  if ("error" in ctx) return;
  const id = String(form.get("id") ?? "");
  try {
    if (await revokePartnerKey({ db: getDb() }, ctx.membership.tenantId, id)) {
      await auditAction(ctx, { action: "api_key.revoke", targetType: "partner_key", targetId: id });
    }
  } catch {
    // unknown id: nothing to do
  }
  revalidatePath("/app/settings/api-keys");
}
