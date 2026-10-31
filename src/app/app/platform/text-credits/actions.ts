"use server";
/**
 * Platform page – text credits (ClinForms staff in CLINFORMS_PLATFORM_ADMINS only, re-checked on every call with a
 * fresh session). The support adjustment: audited in the clinic's trail and the platform's.
 */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { platformActionAdmin } from "@/server/admin/guards";
import { adjustTextCreditsAsPlatform } from "@/server/admin/text-credits";
import { getDb } from "@/server/db";
import { RepoInputError } from "@/server/repos/context";

export type AdjustCreditsResult = { ok: true; message: string } | { ok: false; error: string };

export async function adjustTextCreditsAction(_prev: AdjustCreditsResult | null, form: FormData): Promise<AdjustCreditsResult> {
  const admin = await platformActionAdmin();
  if (!admin) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  const tenantId = String(form.get("tenantId") ?? "").trim().slice(0, 64);
  try {
    const r = await adjustTextCreditsAsPlatform(getDb(), admin, { tenantId, credits: String(form.get("credits") ?? "").trim(), reason: String(form.get("reason") ?? "") });
    revalidatePath("/app/platform/text-credits");
    return { ok: true, message: `Done. ${tenantId} now has ${r.balance.toLocaleString("en-GB")} text credits.` };
  } catch (err) {
    return { ok: false, error: err instanceof RepoInputError ? err.message.replace(/^Adjustment: [a-z]+: /, "") : "The adjustment could not be saved. Try again." };
  }
}
