"use server";
/** Settings → Security: new backup codes, signed-in devices (sign one out, or all the others). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { getAuth } from "@/server/auth/auth";
import { authErrorMessage } from "@/server/auth/errors";
import { getServerSession, hasTwoFactor, requestHeaders, throttle, type ActionResult } from "@/server/auth/session";

export type BackupCodesResult = ActionResult<{ codes: string[] }>;

export async function regenerateBackupCodes(_prev: BackupCodesResult | null, form: FormData): Promise<BackupCodesResult> {
  const session = await getServerSession({ fresh: true });
  if (!session || !hasTwoFactor(session)) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  if (!(await throttle("backup-codes", session.user.id, 5, 15 * 60_000))) return { ok: false, error: ACCOUNT_ERRORS.tooManyAttempts };
  try {
    const result = await getAuth().api.generateBackupCodes({ body: { password: String(form.get("password") ?? "") }, headers: requestHeaders() });
    return { ok: true, codes: result.backupCodes };
  } catch (err) {
    return { ok: false, error: authErrorMessage(err, "backup_codes") };
  }
}

export async function revokeDevice(form: FormData): Promise<void> {
  const session = await getServerSession({ fresh: true });
  if (!session) redirect("/login");
  const id = String(form.get("sessionId") ?? "");
  const auth = getAuth();
  const sessions = await auth.api.listSessions({ headers: requestHeaders() });
  const target = sessions.find((s) => s.id === id);
  if (target) {
    await auth.api.revokeSession({ body: { token: target.token }, headers: requestHeaders() });
    if (target.id === session.session.id) redirect("/login");
  }
  revalidatePath("/app/settings/security");
}

export async function revokeOtherDevices(): Promise<void> {
  const session = await getServerSession({ fresh: true });
  if (!session) redirect("/login");
  await getAuth().api.revokeOtherSessions({ headers: requestHeaders() });
  revalidatePath("/app/settings/security");
}
