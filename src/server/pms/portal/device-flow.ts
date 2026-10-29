/**
 * The clinic DEVICE's side of a form handed to the patient in the clinic (FORM-007): what the device page shows for
 * the one-time secret in its cookie, and the patient's submit (the ordinary sealed submit of the copy + the hand-off
 * marked completed in the same batch). No staff session is needed or read. Staff side: ./clinic-device.ts.
 *
 * M10 H3: the device is PAIRED by the short code staff get on their own screen (`pairDeviceWithCode`) – a browser
 * that is not signed in; only then does it hold a secret. Attempts are limited per address and per clinic.
 */
import "server-only";
import type { IntakeResponse } from "../../../modules/pms/portal/types";
import type { RepoContext } from "../../repos/context";
import { findHandoffByToken, handoffCompletedQuery, handoffUsable, type IntakeHandoff } from "../../repos/pms/portal/handoffs";
import { getIntakeResponse } from "../../repos/pms/portal/intake";
import { answersFromForm, submitForm } from "./intake-service";
import { hashSecret, isLinkToken, newSecret } from "./tokens";
import { createHash } from "node:crypto";
import { normalisePairingCode } from "../../../modules/pms/portal/pairing-code";
import { pairDevice } from "../../repos/pms/portal/pairings";
import { getHandoff } from "../../repos/pms/portal/handoffs";
import { publicLimits, tooManyMessage, type PublicLimit } from "./rate-limit";
import { pmsNow } from "../../../modules/pms/core/clock";

/** The device's cookie (httpOnly, SameSite=Strict, limited to /clinics/<clinic>/device). */
export const DEVICE_COOKIE = "pms_device";

export type DeviceState =
  | { state: "none" }
  | { state: "open"; handoff: IntakeHandoff; response: IntakeResponse }
  | { state: "completed"; handoff: IntakeHandoff; requiresSignature: boolean }
  | { state: "finished" };

/** What the device page shows for the secret in its cookie. */
export async function deviceState(ctx: RepoContext, tenantId: string, secret: string | undefined): Promise<DeviceState> {
  if (!isLinkToken(secret)) return { state: "none" };
  const h = await findHandoffByToken(ctx, tenantId, hashSecret(secret));
  if (!h) return { state: "none" };
  if (h.status === "verified" || h.status === "ended") return { state: "finished" };
  if (h.status === "completed") {
    const r = await getIntakeResponse(ctx, tenantId, h.responseId);
    return { state: "completed", handoff: h, requiresSignature: Boolean(r?.requiresSignature) };
  }
  if (!handoffUsable(h, (ctx.now ? ctx.now() : pmsNow()).getTime())) return { state: "finished" };
  const response = await getIntakeResponse(ctx, tenantId, h.responseId);
  if (!response || response.status !== "requested" || response.patientId !== h.patientId) return { state: "finished" };
  return { state: "open", handoff: h, response };
}

/** The patient completes the form on the device: the ordinary sealed submit + the hand-off marked completed. */
export async function submitOnDevice(ctx: RepoContext, tenantId: string, secret: string | undefined, expectedRev: number, form: FormData): Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const s = await deviceState(ctx, tenantId, secret);
  if (s.state !== "open") return { ok: false, error: "This form can no longer be completed on this device. Please hand it back to a member of staff." };
  const { handoff, response } = s;
  const result = await submitForm(
    ctx,
    tenantId,
    response.id,
    expectedRev,
    { answers: answersFromForm(form, response.form), signatureName: String(form.get("signature") ?? ""), trust: "unverified" },
    { userId: null, sessionId: handoff.id },
    { alsoWrite: (writeId) => [handoffCompletedQuery(ctx, tenantId, handoff.id, response.id, writeId)], auditDetail: { via: "clinic_device", handoff: handoff.id } },
  );
  if (result.ok) return { ok: true };
  if (result.reason === "invalid") return { ok: false, error: "Please check the answers marked below.", fieldErrors: result.errors };
  return { ok: false, error: "This form has changed or was already sent. Please hand the device back to a member of staff." };
}

/** The stored form of a pairing code: SHA-256 of the clinic and the code (a code means nothing in another clinic). */
export function pairingCodeHash(tenantId: string, code: string): string {
  return createHash("sha256").update(`pms-device-pair:${tenantId}:${code}`, "utf8").digest("hex");
}

export const PAIR_REFUSED = "That code is not right, or it has expired or been used. Ask a member of staff for a new code.";

/**
 * The device types the code from the staff screen: limited per address and per clinic, then paired once. Answers the
 * device's new secret (for its cookie) and when it stops working.
 */
export async function pairDeviceWithCode(
  ctx: RepoContext,
  tenantId: string,
  input: unknown,
  opts: { clientIp: string | null; limitSecret?: string },
): Promise<{ ok: true; secret: string; expiresAt: string } | { ok: false; error: string }> {
  const checks: [PublicLimit, string | null][] = [];
  if (opts.clientIp) checks.push(["devicePairPerClient", opts.clientIp]);
  checks.push(["devicePairPerClinic", null]);
  const limited = await publicLimits(ctx, tenantId, checks, opts.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const code = normalisePairingCode(input);
  if (!code) return { ok: false, error: PAIR_REFUSED };
  const secret = newSecret();
  const handoffId = await pairDevice(ctx, tenantId, pairingCodeHash(tenantId, code), hashSecret(secret));
  if (!handoffId) return { ok: false, error: PAIR_REFUSED };
  const h = await getHandoff(ctx, tenantId, handoffId);
  if (!h) return { ok: false, error: PAIR_REFUSED };
  return { ok: true, secret, expiresAt: h.expiresAt };
}
