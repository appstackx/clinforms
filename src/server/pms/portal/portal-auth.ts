/**
 * Patient portal sign-in (separate from staff sign-in): a patient asks for a link with their email address; if it
 * is the address of an active patient of THIS clinic, a one-time link is emailed (through comms – outbox / test
 * providers only) to the address on the record. The answer is the same whether or not anything matched (never
 * reveals who is a patient), and the work done is the same shape either way.
 * The link opens a page with a button (so email scanners that open links do not use it up); pressing it uses the
 * link once and opens a session – a random cookie secret, of which only the hash is stored.
 */
import "server-only";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import { PORTAL_TIMINGS, sessionUsable } from "../../../modules/pms/portal/policy";
import { PortalSignInSchema } from "../../../modules/pms/portal/schemas";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { DbContext, RepoContext } from "../../repos/context";
import { nowIso } from "../../repos/context";
import { getPatientSummaries, searchPatients } from "../../repos/pms/patients";
import { countRecentSignInLinks, createSignInLink, ensurePortalAccount, getPortalSession, revokePortalSession, signInWithLink, touchPortalSession } from "../../repos/pms/portal/accounts";
import { patientActor, type FlowDeps } from "./booking";
import { verifyHumanCheck } from "./human-check";
import { sendPortalLinkEmail } from "./portal-mail";
import type { PublicClinic } from "./public-clinic";
import { publicLimits, tooManyMessage, type PublicLimit } from "./rate-limit";
import { hashSecret, isLinkToken, newSecret, sameHash } from "./tokens";
import { pmsNow } from "../../../modules/pms/core/clock";

/** The portal's cookie: one per clinic path (/clinics/<clinic id>), httpOnly, never sent elsewhere. */
export const PORTAL_COOKIE = "clinic_portal";

/** The same words whatever happened (matched, no match, account switched off, too many links). */
export const SIGN_IN_SENT = "If this email address is on our records, we have sent a sign-in link to it. It works once, for 15 minutes.";

export type SignInRequestOutcome = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** At most this many links per account per hour, and this many patients per request (shared email addresses). */
const LINKS_PER_HOUR = 3;
const MAX_MATCHES = 3;

export async function requestSignInLink(clinic: PublicClinic, raw: Record<string, unknown>, deps: FlowDeps): Promise<SignInRequestOutcome> {
  const { ctx, now } = deps;
  const tenantId = clinic.tenantId;
  if (!clinic.settings.portal) return { ok: false, error: "The patient portal is not open at the moment. Please contact the clinic." };
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { ok: true };
  const parsed = PortalSignInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please check the answers marked below.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const checks: [PublicLimit, string | null][] = [];
  if (deps.clientIp) checks.push(["signInPerClient", deps.clientIp]);
  checks.push(["signInPerEmail", d.email]);
  const limited = await publicLimits(ctx, tenantId, checks, deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const human = await verifyHumanCheck(deps.humanToken, deps.clientIp);
  if (!human.ok) return { ok: false, error: "Please complete the check that you are not a robot, then try again." };

  const candidates = (await searchPatients(ctx, tenantId, { q: d.email, status: "active", limit: 50 })).filter((p) => (p.email ?? "").toLowerCase() === d.email).slice(0, MAX_MATCHES);
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const actor = patientActor();
  for (const patient of candidates) {
    const account = await ensurePortalAccount(ctx, tenantId, patient.id, actor);
    if (account.status !== "active") continue;
    if ((await countRecentSignInLinks(ctx, tenantId, account.id, since)) >= LINKS_PER_HOUR) continue;
    await sendSignInLink(ctx, tenantId, account.id, patient.id, now, PORTAL_TIMINGS.signInLinkMinutes * 60_000, deps.origin, actor);
  }
  return { ok: true };
}

/**
 * Makes a one-time sign-in link for an account and emails it (comms). `lifetimeMs`: 15 minutes when the patient
 * asked; 72 hours when staff send a form or questionnaire. Only the link's hash is stored.
 */
export async function sendSignInLink(ctx: RepoContext, tenantId: string, accountId: string, patientId: string, now: Date, lifetimeMs: number, origin: string, actor: PmsActor, next?: string | null): Promise<boolean> {
  const secret = newSecret();
  const expiresAt = new Date(now.getTime() + lifetimeMs).toISOString();
  await createSignInLink(ctx, tenantId, accountId, hashSecret(secret), expiresAt, actor);
  const path = clinicPublicPaths(tenantId).signInLink(secret);
  const url = `${origin}${path}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return sendPortalLinkEmail(ctx, tenantId, patientId, url, expiresAt, now, actor);
}

export type CompleteSignIn = { ok: true; cookieValue: string; expiresAt: string } | { ok: false; error: string };

const LINK_INVALID = "This sign-in link has expired or has already been used. Ask for a new one below.";

/** Uses a one-time link; on success the caller sets the cookie value (path-limited to the clinic). */
export async function completeSignIn(clinic: PublicClinic, token: string, deps: FlowDeps): Promise<CompleteSignIn> {
  if (!clinic.settings.portal) return { ok: false, error: "The patient portal is not open at the moment." };
  if (!isLinkToken(token)) return { ok: false, error: LINK_INVALID };
  if (deps.clientIp) {
    const limited = await publicLimits(deps.ctx, clinic.tenantId, [["linkPerClient", deps.clientIp]], deps.limitSecret);
    if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  }
  const secret = newSecret();
  const expiresAt = new Date(deps.now.getTime() + PORTAL_TIMINGS.sessionHours * 3_600_000).toISOString();
  const result = await signInWithLink(deps.ctx, clinic.tenantId, hashSecret(token), hashSecret(secret), expiresAt);
  if (!result.ok) return { ok: false, error: LINK_INVALID };
  const patient = (await getPatientSummaries(deps.ctx, clinic.tenantId, [result.account.patientId])).get(result.account.patientId);
  if (!patient || patient.status !== "active") {
    await revokePortalSession(deps.ctx, clinic.tenantId, result.session.id);
    return { ok: false, error: LINK_INVALID };
  }
  return { ok: true, cookieValue: `${result.session.id}.${secret}`, expiresAt };
}

export interface PortalViewer {
  tenantId: string;
  sessionId: string;
  accountId: string;
  patientId: string;
  firstName: string;
  lastName: string;
  /** Who did it, for the audit rows of the patient's own writes. */
  actor: PmsActor;
}

/** The signed-in patient for a cookie value, or null (expired, idle, signed out, switched off, archived). */
export async function readPortalSession(ctx: DbContext & Partial<RepoContext>, tenantId: string, cookieValue: string | null | undefined, now: Date = pmsNow()): Promise<PortalViewer | null> {
  if (typeof cookieValue !== "string" || cookieValue.length > 200) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return null;
  const id = cookieValue.slice(0, dot);
  const secret = cookieValue.slice(dot + 1);
  if (!/^psn_[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || !isLinkToken(secret)) return null;
  const session = await getPortalSession(ctx, tenantId, id);
  if (!session || !sameHash(hashSecret(secret), session.tokenHash)) return null;
  if (session.accountStatus !== "active" || !sessionUsable(session, now.getTime())) return null;
  const patient = (await getPatientSummaries(ctx as RepoContext, tenantId, [session.patientId])).get(session.patientId);
  if (!patient || patient.status !== "active") return null;
  if (now.getTime() - Date.parse(session.lastSeenAt) > PORTAL_TIMINGS.touchEveryMinutes * 60_000) {
    await touchPortalSession({ db: ctx.db, now: () => now }, tenantId, id);
  }
  return {
    tenantId,
    sessionId: id,
    accountId: session.accountId,
    patientId: session.patientId,
    firstName: patient.preferredName || patient.firstName,
    lastName: patient.lastName,
    actor: patientActor(id),
  };
}

/** Signs the session out (the cookie is cleared by the caller). */
export async function signOutPortal(ctx: DbContext, tenantId: string, cookieValue: string | null | undefined): Promise<void> {
  if (typeof cookieValue !== "string") return;
  const id = cookieValue.split(".")[0];
  if (!/^psn_[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return;
  await revokePortalSession(ctx, tenantId, id);
}

/** "now" as the repositories write it (for callers that pass a fixed clock). */
export function clockIso(ctx: DbContext): string {
  return nowIso(ctx);
}
