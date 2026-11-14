"use server";
/**
 * "Explore with sample data" (13/11/2026, self-serve free trial – src/server/trial/sample.ts): creates the trial
 * clinic's separate SAMPLE clinic (made-up data) and makes it the active clinic; or hides the offer. The OWNER of the
 * active clinic only (re-checked against the member table by createSampleClinic); signed in with two-step. Returns the
 * page to load next (the caller loads it in full, as a clinic switch does).
 */
import { getAuth } from "@/server/auth/auth";
import { actionContext, requestHeaders } from "@/server/auth/session";
import { landingPath } from "@/server/brand";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { createSampleClinic, declineSampleClinic } from "@/server/trial/sample";

export type SampleActionResult = { ok: true; next: string } | { ok: false; error: string };

export async function createSampleClinicAction(): Promise<SampleActionResult> {
  const ctx = await actionContext();
  if ("error" in ctx || ctx.membership.role !== "owner") return { ok: false, error: "Only the clinic's owner can create the sample clinic." };
  try {
    const r = await createSampleClinic({ db: getDb(), cipher: getDataCipher() }, { tenantId: ctx.membership.tenantId, userId: ctx.session.user.id });
    if (r.status === "busy") return { ok: false, error: "The sample clinic is being set up – try again in a minute." };
    if (r.status === "unavailable") return { ok: false, error: "The sample clinic is available during your free trial only." };
    if (!r.organizationId) return { ok: false, error: "Use Switch clinic to open the sample clinic." };
    await getAuth().api.setActiveOrganization({ body: { organizationId: r.organizationId }, headers: requestHeaders() });
    return { ok: true, next: landingPath() };
  } catch {
    return { ok: false, error: "The sample clinic could not be set up. Please try again in a few minutes." };
  }
}

export async function declineSampleClinicAction(): Promise<SampleActionResult> {
  const ctx = await actionContext();
  if ("error" in ctx || ctx.membership.role !== "owner") return { ok: false, error: "Only the clinic's owner can do this." };
  await declineSampleClinic(getDb(), ctx.membership.tenantId).catch(() => undefined);
  return { ok: true, next: "" };
}
