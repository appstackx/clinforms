"use server";

/**
 * Server action behind the sandbox's "Complete referrer's report form" button.
 * Plays the part of the clinic system's server: it calls the Report API's POST /launch server-to-server
 * with the partner key (never sent to the browser) and returns the launch URL.
 *
 * - Patient, episode and clinician are looked up in the sandbox's own records; the browser only sends
 *   IDs, so it cannot launch with a made-up clinician.
 * - The Report API origin comes from the request headers (x-forwarded-host/host and
 *   x-forwarded-proto). The partner key is only ever sent to a trusted origin: the Vercel deployment
 *   itself, this server's own loopback port, or the origin of TM3_SIM_BASE_URL.
 * - On Vercel, VERCEL_AUTOMATION_BYPASS_SECRET (if enabled) is forwarded so preview protection does not
 *   block the call.
 *
 * Only imports from the module's browser-safe contract (paths, header names, types).
 *
 * Owner: sandbox agent.
 */
import { headers } from "next/headers";
import { HEADERS, reportApiPaths, type LaunchRequest } from "@/modules/medreport/api/contract";
import { PRODUCT } from "@/modules/medreport/config.public";
import { SIM_CLINICIANS, SIM_EPISODES, SIM_PATIENTS } from "@/sandbox/tm3-sim/fixtures";
import { getSandboxSecret } from "@/sandbox/tm3-sim/server-config";

export type LaunchReportResult =
  | { ok: true; launchUrl: string; expiresAt: string }
  | { ok: false; message: string };

const LAUNCH_TIMEOUT_MS = 15_000;

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function originFromEnv(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

/** The Report API origin for this request, or null if the host is not one we trust with the key. */
function reportApiOrigin(): string | null {
  const h = headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host")?.trim();
  if (!host) return null;
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return null;
  }
  const proto = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : isLoopback(url.hostname)
      ? "http"
      : "https";
  const origin = `${proto}://${url.host}`;

  // On Vercel a request only reaches this function through a domain attached to this project.
  if (process.env.VERCEL === "1") return origin;
  // Loopback only on this server's own port: a spoofed Host (e.g. localhost:6379) must not send the
  // partner key to another local service.
  if (isLoopback(url.hostname)) {
    const port = process.env.PORT?.trim();
    const given = url.port || (proto === "https" ? "443" : "80");
    return !port || given === port ? origin : null;
  }
  const configured = originFromEnv(process.env.TM3_SIM_BASE_URL);
  if (configured && new URL(configured).host === url.host) return configured;
  return null;
}

async function readProblemDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown; title?: unknown };
    if (typeof body.detail === "string" && body.detail) return body.detail;
    if (typeof body.title === "string" && body.title) return body.title;
  } catch {
    // not JSON
  }
  return null;
}

export async function launchReportAction(input: {
  patientId: string;
  episodeId: string;
  clinicianHcpc: string;
}): Promise<LaunchReportResult> {
  const patientId = typeof input?.patientId === "string" ? input.patientId : "";
  const episodeId = typeof input?.episodeId === "string" ? input.episodeId : "";
  const clinicianHcpc = typeof input?.clinicianHcpc === "string" ? input.clinicianHcpc : "";

  const patient = SIM_PATIENTS.find((p) => p.id === patientId);
  const episode = SIM_EPISODES.find((e) => e.id === episodeId && e.patient_id === patientId);
  if (!patient || !episode) {
    return { ok: false, message: "This patient has no episode of care to report on." };
  }
  const clinician = SIM_CLINICIANS.find((c) => c.hcpc === clinicianHcpc) ?? episode.primary_clinician;

  const partnerKey = getSandboxSecret("MEDREPORT_PARTNER_KEY");
  if (!partnerKey) {
    return { ok: false, message: "The partner key is not configured on this deployment (MEDREPORT_PARTNER_KEY)." };
  }
  const origin = reportApiOrigin();
  if (!origin) {
    return {
      ok: false,
      message: `Could not work out a trusted address for ${PRODUCT.name}. Set TM3_SIM_BASE_URL to this site's URL.`,
    };
  }

  const payload: LaunchRequest = {
    connectorId: "tm3-sim",
    patientId: patient.id,
    episodeId: episode.id,
    clinician: { name: clinician.name, hcpc: clinician.hcpc, ...(clinician.role ? { role: clinician.role } : {}) },
  };
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    [HEADERS.partnerKey]: partnerKey,
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) requestHeaders["x-vercel-protection-bypass"] = bypass;

  let res: Response;
  try {
    res = await fetch(`${origin}${reportApiPaths.launch()}`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(LAUNCH_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      message: timedOut
        ? `${PRODUCT.name} did not answer in time. Please try again.`
        : `Could not reach ${PRODUCT.name}. Please try again.`,
    };
  }

  if (!res.ok) {
    const detail = await readProblemDetail(res);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: detail ?? `${PRODUCT.name} refused the partner key.` };
    }
    if (res.status === 501) {
      return { ok: false, message: "Launching from the clinic system is not available on this deployment yet." };
    }
    return { ok: false, message: detail ?? `${PRODUCT.name} returned an error (${res.status}).` };
  }

  let body: { launchUrl?: unknown; expiresAt?: unknown };
  try {
    body = (await res.json()) as { launchUrl?: unknown; expiresAt?: unknown };
  } catch {
    return { ok: false, message: `${PRODUCT.name} sent an unexpected response.` };
  }
  if (typeof body.launchUrl !== "string" || typeof body.expiresAt !== "string") {
    return { ok: false, message: `${PRODUCT.name} sent an unexpected response.` };
  }
  try {
    const url = new URL(body.launchUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad protocol");
  } catch {
    return { ok: false, message: `${PRODUCT.name} sent an invalid launch link.` };
  }
  return { ok: true, launchUrl: body.launchUrl, expiresAt: body.expiresAt };
}
