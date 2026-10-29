/**
 * Plumbing for the clinic's public pages and their server actions (src/app/(public-clinic)/clinics/[clinicId]/**):
 * the clinic behind the address (or the 404 page – an outsider cannot tell why: no clinic, no "clinic" package, or
 * both online booking and the portal switched off), the flows' dependencies (the app's own origin for links, never a
 * forged Host header; the client's address for the rate limits), and the patient portal's cookie – httpOnly,
 * SameSite=Lax, limited to the clinic's own path, holding a random secret of which only the hash is stored.
 * No staff cookie is read or needed here.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import { getDataCipher } from "../../crypto";
import { getDb } from "../../db";
import type { RepoContext } from "../../repos/context";
import { trustedClientIp } from "./human-check";
import { paddedMs } from "./timing";
import { commsLinkOrigin } from "../comms/links";
import type { FlowDeps } from "./booking";
import { PORTAL_COOKIE, readPortalSession, type PortalViewer } from "./portal-auth";
import { loadPublicClinic, type PublicClinic } from "./public-clinic";
import { pmsNow } from "../../../modules/pms/core/clock";

export function publicCtx(): RepoContext {
  return { db: getDb(), cipher: getDataCipher(), now: pmsNow };
}

/** The clinic of a public page, or the 404 page. */
export async function publicClinicOr404(clinicId: string, need?: "booking" | "portal"): Promise<PublicClinic> {
  const clinic = await loadPublicClinic(publicCtx(), clinicId);
  if (!clinic) notFound();
  if (need === "booking" && !clinic.settings.onlineBooking) notFound();
  if (need === "portal" && !clinic.settings.portal) notFound();
  return clinic;
}

/** The clinic of its device page (a form handed to a patient in the clinic): the package is enough. */
export async function deviceClinicOr404(clinicId: string): Promise<PublicClinic> {
  const clinic = await loadPublicClinic(publicCtx(), clinicId, { device: true });
  if (!clinic) notFound();
  return clinic;
}

/** The same lookup for server actions (null instead of the 404 page). */
export async function publicClinicFor(clinicId: unknown): Promise<PublicClinic | null> {
  if (typeof clinicId !== "string") return null;
  return loadPublicClinic(publicCtx(), clinicId);
}

export function flowDeps(over: Partial<FlowDeps> = {}): FlowDeps {
  const ip = trustedClientIp(headers());
  // minResponseMs (M10 M4): a public booking takes the same time whether or not it matched an existing patient.
  return { ctx: publicCtx(), now: pmsNow(), origin: commsLinkOrigin(), clientIp: ip === "local" ? "local" : ip, minResponseMs: 1500, ...over };
}

/** The signed-in patient of this clinic, or null. */
export async function portalViewer(clinic: PublicClinic): Promise<PortalViewer | null> {
  if (!clinic.settings.portal) return null;
  const value = cookies().get(PORTAL_COOKIE)?.value;
  return value ? readPortalSession(publicCtx(), clinic.tenantId, value) : null;
}

export function setPortalCookie(clinic: PublicClinic, value: string, expiresAt: string): void {
  cookies().set(PORTAL_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: clinicPublicPaths(clinic.tenantId).root,
    expires: new Date(expiresAt),
  });
}

export function clearPortalCookie(clinic: PublicClinic): void {
  cookies().set(PORTAL_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: clinicPublicPaths(clinic.tenantId).root, maxAge: 0 });
}

/** A path inside this clinic's portal (where a sign-in link may send the patient), else the portal's home. */
export function safePortalNext(clinic: PublicClinic, next: unknown): string {
  const portal = clinicPublicPaths(clinic.tenantId).portal;
  if (typeof next !== "string" || next.length > 300) return portal;
  if (!next.startsWith(`${portal}/`) || next.includes("//") || next.includes("\\") || /[^A-Za-z0-9/_\-.]/.test(next)) return portal;
  return next;
}

/**
 * Answers a public request no sooner than `minMs` after it started, so a request that matched a patient (more work,
 * an email) and one that did not take about the same time – no existence leak by timing.
 */
export async function evenTiming<T>(minMs: number, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await work();
  const left = paddedMs(minMs, Date.now() - started) - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  return result;
}

/**
 * M10 L7: the "manage this booking" secret, once its link has been opened, lives in this cookie (httpOnly,
 * SameSite=Lax, limited to /clinics/<clinic>/booking, until the link would expire) – not in the address bar.
 */
export const MANAGE_COOKIE = "clinic_manage";

export function setManageCookie(clinic: Pick<PublicClinic, "tenantId">, token: string, expiresAt: string | null): void {
  cookies().set(MANAGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: clinicPublicPaths(clinic.tenantId).manageCookiePath,
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  });
}

/** The manage secret this browser holds for the clinic, or null. */
export function manageTokenFromCookie(): string | null {
  return cookies().get(MANAGE_COOKIE)?.value ?? null;
}
