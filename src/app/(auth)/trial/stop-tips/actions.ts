"use server";
/**
 * "Stop these tips emails" – the button on /trial/stop-tips (13/11/2026, docs/clinic-system/trial.md). A POST from the
 * page (opening the emailed link changes nothing: mail scanners open links); checked again here against the link's
 * signature. Only the tips-type trial emails stop (welcome, tips) – the emails about the account itself still go.
 */
import { authSecret } from "@/server/auth/config";
import { getDb } from "@/server/db";
import { setTrialTipsOff } from "@/server/repos/self-trial";
import { checkStopTips } from "@/server/trial/emails";

export type StopTipsState = { status: "idle" } | { status: "done" } | { status: "error" };

export async function stopTipsAction(_prev: StopTipsState, form: FormData): Promise<StopTipsState> {
  const tenantId = String(form.get("c") ?? "").slice(0, 80);
  const token = String(form.get("t") ?? "").slice(0, 80);
  try {
    if (!checkStopTips(authSecret(), tenantId, token)) return { status: "error" };
    await setTrialTipsOff({ db: getDb() }, tenantId);
    return { status: "done" };
  } catch {
    return { status: "error" };
  }
}
