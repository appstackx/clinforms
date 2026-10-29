"use server";
/**
 * The clinic device page's one action: the patient sends the form handed to them. The device's secret comes from its
 * own cookie (never from the page); no staff session is read.
 */
import { cookies } from "next/headers";
import { DEVICE_COOKIE, submitOnDevice } from "@/server/pms/portal/device-flow";
import { deviceClinicOr404, publicCtx } from "@/server/pms/portal/public-page";

export async function deviceSubmitAction(clinicId: string, rev: number, form: FormData): Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const clinic = await deviceClinicOr404(String(clinicId));
  return submitOnDevice(publicCtx(), clinic.tenantId, cookies().get(DEVICE_COOKIE)?.value, Number(rev), form);
}
