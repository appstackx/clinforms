/**
 * A form completed IN THE CLINIC on a clinic device, verified by staff (FORM-007 "tablet mode"):
 *
 * 1. Staff (patients.edit) press "Complete in the clinic" on a waiting copy (record → Forms). A hand-off starts
 *    (src/server/repos/pms/portal/handoffs.ts): the device gets a one-time secret in an httpOnly, SameSite=Strict
 *    cookie limited to the clinic's device page (`/clinics/<clinic>/device`) and goes there.
 * 2. The device page shows ONLY that form (the clinic's public header, no staff navigation, no other patient data –
 *    not even the patient's name). The patient fills it in and signs; the copy is sealed exactly as from the portal
 *    (the same submit), stored "unverified", and the hand-off is marked completed in the same batch.
 * 3. The device shows "Please hand the device back to a member of staff". Staff open the hand-off page (their own
 *    session; patients.edit) and confirm with THEIR PASSWORD – the patient holding the device cannot. The hand-off
 *    records who verified it and when; the audit row says so; a signed consent form then records consent on the
 *    record under that member. The signed copy (screen and PDF) shows "Completed in the clinic, verified by …".
 *
 * The device's browser may still hold a staff session (a reception PC): the device page itself links nowhere but
 * the hand-back step, which needs the password. Use the device's own guided-access / kiosk lock as well.
 */
import "server-only";
import { PORTAL_TIMINGS } from "../../../modules/pms/portal/policy";
import { clinicPublicPaths, STAFF_PORTAL_PATHS } from "../../../modules/pms/portal/paths";
import type { RepoContext } from "../../repos/context";
import { RepoInputError } from "../../repos/context";
import { getPatient } from "../../repos/pms/patients";
import { endHandoff, getHandoff, handoffForResponse, handoffUsable, startHandoff, verifyHandoff, type IntakeHandoff } from "../../repos/pms/portal/handoffs";
import { getIntakeResponse } from "../../repos/pms/portal/intake";
import { getAuth } from "../../auth/auth";
import { requestHeaders, throttle } from "../../auth/session";
import type { ClinicActor } from "../actor";
import { recordVerifiedConsent } from "./intake-service";
import { memberNames } from "./staff-names";
import { patientVisible } from "./staff-scope";
import { hashSecret, newSecret } from "./tokens";
import { pmsNowMs } from "../../../modules/pms/core/clock";

export { DEVICE_COOKIE } from "./device-flow";

export type DeviceResult<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; error: string };

const FORBIDDEN = "You do not have permission to do that.";

/** The repositories' clock (the clinic system's clock in the app; a test's clock in the suites). */
const nowMsOf = (ctx: RepoContext) => (ctx.now ? ctx.now().getTime() : pmsNowMs());
const GONE = "This form no longer exists in this clinic.";

/* ------------------------------------------------------------------------------------------------
 * Staff: start, read, verify, end
 * ----------------------------------------------------------------------------------------------*/

/** Starts a hand-off; answers the device's secret (for the cookie) and where the device goes. */
export async function startHandoffFor(actor: ClinicActor, patientId: string, responseId: string): Promise<DeviceResult<{ secret: string; expiresAt: string; path: string; cookiePath: string }>> {
  if (!actor.can("patients.edit")) return { ok: false, error: FORBIDDEN };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const ctx = actor.repo();
  const r = await getIntakeResponse(ctx, actor.tenantId, String(responseId));
  if (!r || r.patientId !== patientId) return { ok: false, error: GONE };
  if (r.kind === "outcome") return { ok: false, error: "Questionnaires are answered in the patient's portal." };
  if (r.status !== "requested") return { ok: false, error: "This form has already been completed or withdrawn." };
  const secret = newSecret();
  const expiresAt = new Date(nowMsOf(ctx) + PORTAL_TIMINGS.handoffMinutes * 60_000).toISOString();
  try {
    await startHandoff(ctx, actor.tenantId, { responseId: r.id, patientId, tokenHash: hashSecret(secret), expiresAt }, actor.actor);
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, error: err.message };
    throw err;
  }
  const paths = clinicPublicPaths(actor.tenantId);
  return { ok: true, value: { secret, expiresAt, path: paths.device, cookiePath: paths.device } };
}

export interface HandoffStaffView {
  handoff: IntakeHandoff;
  patientId: string;
  patientName: string;
  formName: string;
  verifiedByName: string | null;
  usable: boolean;
}

/** The staff page of a hand-off (patients.edit; the patient must be in the member's sites). */
export async function handoffStaffViewFor(actor: ClinicActor, handoffId: string): Promise<DeviceResult<HandoffStaffView>> {
  if (!actor.can("patients.edit")) return { ok: false, error: FORBIDDEN };
  if (typeof handoffId !== "string" || !/^ihd_[0-9A-HJKMNP-TV-Z]{26}$/.test(handoffId)) return { ok: false, error: GONE };
  const ctx = actor.repo();
  const h = await getHandoff(ctx, actor.tenantId, handoffId);
  if (!h || !(await patientVisible(actor, h.patientId))) return { ok: false, error: GONE };
  const [patient, response] = await Promise.all([getPatient(ctx, actor.tenantId, h.patientId), getIntakeResponse(ctx, actor.tenantId, h.responseId)]);
  if (!patient || !response) return { ok: false, error: GONE };
  const names = h.verifiedBy ? await memberNames(ctx, actor.tenantId, [h.verifiedBy]) : new Map<string, string>();
  return {
    ok: true,
    value: {
      handoff: h,
      patientId: h.patientId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      formName: response.name,
      verifiedByName: h.verifiedBy ? (names.get(h.verifiedBy) ?? "a former member of staff") : null,
      usable: handoffUsable(h, nowMsOf(ctx)),
    },
  };
}

/**
 * Staff confirm a form completed on the device – with their password (the person holding the device cannot).
 * Then a signed consent form records consent on the record, under this member.
 */
export async function verifyHandoffFor(actor: ClinicActor, handoffId: string, password: string, check: PasswordCheck = checkStaffPassword): Promise<DeviceResult<{ patientId: string; responseId: string }>> {
  const view = await handoffStaffViewFor(actor, handoffId);
  if (!view.ok) return view;
  const h = view.value.handoff;
  if (h.status !== "completed") return { ok: false, error: h.status === "verified" ? "This form has already been verified." : "The patient has not finished this form on the device." };
  if (typeof password !== "string" || password.length === 0) return { ok: false, error: "Enter your password to confirm." };
  const checked = await check(actor, password);
  if (checked !== "ok") return { ok: false, error: checked === "throttled" ? "Too many attempts. Please wait a few minutes and try again." : "That password is not right." };
  const ctx = actor.repo();
  const done = await verifyHandoff(ctx, actor.tenantId, h.id, actor.actor);
  if (!done) return { ok: false, error: "This form has already been verified." };
  const response = await getIntakeResponse(ctx, actor.tenantId, h.responseId);
  const consent = response ? await recordVerifiedConsent(ctx, actor.tenantId, response, actor.actor) : null;
  return {
    ok: true,
    value: { patientId: h.patientId, responseId: h.responseId },
    message: consent === true ? "Verified. Consent is recorded on the patient's record." : "Verified – completed in the clinic.",
  };
}

/** Ends a hand-off without verifying it (open: the device stops showing the form; completed: stays unverified). */
export async function endHandoffFor(actor: ClinicActor, handoffId: string): Promise<DeviceResult<{ patientId: string }>> {
  const view = await handoffStaffViewFor(actor, handoffId);
  if (!view.ok) return view;
  const done = await endHandoff(actor.repo(), actor.tenantId, view.value.handoff.id, actor.actor);
  return done ? { ok: true, value: { patientId: view.value.patientId }, message: "Hand-off ended." } : { ok: false, error: "This hand-off has already ended." };
}

export type PasswordCheck = (actor: ClinicActor, password: string) => Promise<"ok" | "wrong" | "throttled">;

/** The signed-in member's own password, through the sign-in service (5 tries per 15 minutes per member). */
export async function checkStaffPassword(actor: ClinicActor, password: string): Promise<"ok" | "wrong" | "throttled"> {
  if (!(await throttle("handoff-verify", actor.userId, 5, 15 * 60_000))) return "throttled";
  try {
    const r = await getAuth().api.verifyPassword({ body: { password }, headers: requestHeaders() });
    return r && (r as { status?: boolean }).status === true ? "ok" : "wrong";
  } catch {
    return "wrong";
  }
}

/** "Completed in the clinic, verified by …" for a copy's signed view (and PDF), or null when not completed there. */
export async function clinicCompletionOf(ctx: RepoContext, tenantId: string, responseId: string): Promise<{ handoffId: string; status: "completed" | "verified" | "ended"; completedAt: string; verifiedAt: string | null; verifiedByName: string | null } | null> {
  const h = await handoffForResponse(ctx, tenantId, responseId);
  if (!h || !h.completedAt) return null;
  const names = h.verifiedBy ? await memberNames(ctx, tenantId, [h.verifiedBy]) : new Map<string, string>();
  return {
    handoffId: h.id,
    status: h.status === "verified" ? "verified" : h.status === "ended" ? "ended" : "completed",
    completedAt: h.completedAt,
    verifiedAt: h.verifiedAt,
    verifiedByName: h.verifiedBy ? (names.get(h.verifiedBy) ?? "a former member of staff") : null,
  };
}

/** Words for the signed copy's "From" line. */
export function clinicCompletionWords(c: NonNullable<Awaited<ReturnType<typeof clinicCompletionOf>>>, when: (iso: string) => string): string {
  if (c.status === "verified" && c.verifiedAt) return `Completed in the clinic, verified by ${c.verifiedByName} on ${when(c.verifiedAt)}`;
  if (c.status === "ended") return "Completed in the clinic – not verified by staff";
  return "Completed in the clinic – waiting for a member of staff to verify";
}

export const handoffStaffPath = (handoffId: string) => STAFF_PORTAL_PATHS.handoff(handoffId);

