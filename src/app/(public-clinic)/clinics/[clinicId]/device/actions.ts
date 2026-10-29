"use server";
/**
 * The clinic device page's actions: pair this browser with a form handed to the patient by the code from the staff
 * screen (M10 H3 – the device is never signed in as staff), and the patient's send. The device's secret lives only in
 * its own cookie (httpOnly, SameSite=Strict, limited to the device page); no staff session is read or set.
 */
import { cookies, headers } from "next/headers";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { trustedClientIp } from "@/server/pms/portal/human-check";
import { DEVICE_COOKIE, pairDeviceWithCode, submitOnDevice } from "@/server/pms/portal/device-flow";
import { deviceClinicOr404, publicCtx } from "@/server/pms/portal/public-page";

export async function devicePairAction(clinicId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clinic = await deviceClinicOr404(String(clinicId));
  const ip = trustedClientIp(headers());
  const r = await pairDeviceWithCode(publicCtx(), clinic.tenantId, typeof code === "string" ? code : "", { clientIp: ip });
  if (!r.ok) return r;
  cookies().set(DEVICE_COOKIE, r.secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: clinicPublicPaths(clinic.tenantId).device,
    expires: new Date(r.expiresAt),
  });
  return { ok: true };
}

export async function deviceSubmitAction(clinicId: string, rev: number, form: FormData): Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const clinic = await deviceClinicOr404(String(clinicId));
  return submitOnDevice(publicCtx(), clinic.tenantId, cookies().get(DEVICE_COOKIE)?.value, Number(rev), form);
}
