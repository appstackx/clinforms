/**
 * Self-serve sign-up ("Start free trial", tracker l01) – the server logic, free of Next imports so the tests drive it
 * directly with real Better Auth on every database (self-signup.test.ts). Runbook: docs/auth.md §1b. Behind the switch
 * CLINFORMS_SELF_SIGNUP (src/lib/self-signup.ts): the pages and actions check it first; nothing here is reachable
 * while it is off.
 *
 *   start    the form → bot checks (honeypot, signed time stamp: minimum fill time, maximum age) → per-IP limits →
 *            field rules (clinic name, disposable domains) → per-address limit → then, ALWAYS the same answer:
 *              - no account for the address: a signup_requests row (token SHA-256, password's sign-in hash, terms and
 *                DPA versions, IP / user-agent keyed hashes) + the one-time link by email (24 hours);
 *              - an account already: a "you already have an account – sign in" email instead, nothing stored;
 *              - a platform administrator's address, a filled honeypot, a form filled too fast, or too many emails to
 *                the address today: nothing at all.
 *   confirm  the link + the password typed again (checked against the stored hash: only the person who chose it can
 *            finish – a stranger who signed up with someone else's address cannot hand them a clinic) → one-time claim
 *            → createClinic() with the brand (ClinDesk: Reports paused, as on the platform page) and the owner's
 *            invitation, never emailed → the owner's account (Better Auth sign-up, allowed by that invitation) →
 *            joins → acceptance recorded (signup_acceptances) and audited → the usual two-step set-up.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Kysely } from "kysely";
import type { BrandId } from "../../lib/brand";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ACCOUNT_ERRORS } from "../../lib/account-copy";
import {
  SIGNUP_CONFIRM_PATH,
  SIGNUP_COPY,
  SIGNUP_LIMITS,
  clinicNameProblem,
  dpaVersion,
  isDisposableEmail,
  normaliseSignupEmail,
  ownerNameProblem,
  slugBaseFromClinicName,
  termsVersion,
  tidyName,
} from "../../lib/self-signup";
import { cookieHeaderFromSetCookie } from "../auth/cookies";
import { brandOrigin, linkTarget, type BaseUrlSetting } from "../auth/config";
import type { Auth } from "../auth/create-auth";
import { createClinic } from "../auth/platform";
import { tenantSlugProblem } from "../auth/tenant";
import type { Database } from "../db/schema";
import { deliverEmail, signupConfirmEmail, signupExistingAccountEmail } from "../email";
import { logAuthEvent } from "../email/log";
import { appendAudit } from "../repos/audit";
import type { DbContext } from "../repos/context";
import { hitRateLimit } from "../repos/rate-limits";
import {
  claimSignupRequest,
  closeSignupRequest,
  completeSignupRequest,
  createSignupRequest,
  findSignupRequestByTokenHash,
  recordSignupAcceptance,
  releaseSignupClaim,
  setSignupTenant,
  type SignupRequest,
} from "../repos/signup";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A claim this old without a clinic is a crashed attempt: it may be taken over. */
const STALE_CLAIM_MS = 2 * 60_000;

export interface SignupDeps {
  db: Kysely<Database>;
  /** BETTER_AUTH_SECRET: keys the hashes, signs the form's time stamp and the owner's invitation. */
  secret: string;
  baseUrl: BaseUrlSetting;
  /** The brand of the host (trusted: one of the app's own origins – config.ts requestBrand). */
  brand: BrandId;
  /** The client's IP address (proxy header) and user agent. */
  ip: string;
  userAgent: string;
  isPlatformAdminEmail: (email: string) => boolean;
  now?: () => Date;
}

function nowOf(deps: { now?: () => Date }): Date {
  return deps.now ? deps.now() : new Date();
}

function dbCtx(deps: { db: Kysely<Database>; now?: () => Date }): DbContext {
  return deps.now ? { db: deps.db, now: deps.now } : { db: deps.db };
}

/** A keyed hash (HMAC-SHA256 under the auth secret, per purpose): IPs, user agents, addresses – never stored plainly. */
export function keyedHash(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`clinforms:signup:${purpose}\n${value}`).digest("base64url").slice(0, 43);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

/* ------------------------------------------------------------------ the form's signed time stamp */

function stampMac(secret: string, brand: BrandId, issuedMs: number): string {
  return createHmac("sha256", secret).update(`clinforms:signup-form\n${brand}\n${issuedMs}`).digest("base64url").slice(0, 22);
}

/** The hidden time stamp the form carries: when the page was served, signed (a bot cannot forge an older one). */
export function issueFormStamp(secret: string, brand: BrandId, now: Date = new Date()): string {
  const ms = now.getTime();
  return `${ms}.${stampMac(secret, brand, ms)}`;
}

export type StampCheck = "ok" | "too_fast" | "expired";

export function checkFormStamp(secret: string, brand: BrandId, stamp: string, now: Date = new Date()): StampCheck {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{22})$/.exec(String(stamp ?? ""));
  if (!m) return "expired";
  const ms = Number(m[1]);
  const expected = Buffer.from(stampMac(secret, brand, ms));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "expired";
  const age = now.getTime() - ms;
  if (age < 0 || age > SIGNUP_LIMITS.maxFormAgeMs) return "expired";
  if (age < SIGNUP_LIMITS.minFillMs) return "too_fast";
  return "ok";
}

/* ------------------------------------------------------------------ start */

export interface StartSignupInput {
  clinicName: unknown;
  ownerName: unknown;
  email: unknown;
  password: unknown;
  confirm: unknown;
  /** The tick-box: "on" when ticked. */
  accept: unknown;
  /** Honeypot (hidden from people). */
  website: unknown;
  stamp: unknown;
}

export type StartSignupOutcome =
  /** The one answer the page gives whatever happened behind it (link sent, account exists, quietly dropped). */
  | { kind: "check_email" }
  | { kind: "invalid"; fieldErrors: Record<string, string> }
  | { kind: "expired" }
  | { kind: "rate_limited"; message: string };

/** What happened behind "check_email" – for tests and logs only, never shown. */
export type StartSignupDetail = "sent" | "existing_account" | "spam" | "too_fast" | "address_limit" | "platform_address" | "send_failed";

async function overLimit(ctx: DbContext, key: string, windowMs: number, max: number): Promise<boolean> {
  try {
    return (await hitRateLimit(ctx, key, windowMs)).count > max;
  } catch {
    return false; // never lock everyone out because a counter could not be written
  }
}

export async function startSignup(raw: StartSignupInput, deps: SignupDeps): Promise<StartSignupOutcome & { detail?: StartSignupDetail }> {
  const quiet = (detail: StartSignupDetail) => {
    logAuthEvent("signup.start", { brand: deps.brand, outcome: detail });
    return { kind: "check_email" as const, detail };
  };
  const now = nowOf(deps);
  const ctx = dbCtx(deps);
  if (typeof raw.website === "string" && raw.website.trim() !== "") return quiet("spam");
  const stamp = checkFormStamp(deps.secret, deps.brand, String(raw.stamp ?? ""), now);
  if (stamp === "expired") return { kind: "expired" };
  if (stamp === "too_fast") return quiet("too_fast");

  const ipKey = keyedHash(deps.secret, "ip", deps.ip || "unknown");
  if (await overLimit(ctx, `signup:attempt:${ipKey}`, HOUR_MS, SIGNUP_LIMITS.attemptsPerIpPerHour)) {
    return { kind: "rate_limited", message: SIGNUP_COPY.tooManyAttempts };
  }

  const clinicName = tidyName(raw.clinicName);
  const ownerName = tidyName(raw.ownerName);
  const email = normaliseSignupEmail(raw.email);
  const password = typeof raw.password === "string" ? raw.password : "";
  const confirm = typeof raw.confirm === "string" ? raw.confirm : "";
  const fieldErrors: Record<string, string> = {};
  const clinicProblem = clinicNameProblem(clinicName);
  if (clinicProblem) fieldErrors.clinicName = clinicProblem;
  const ownerProblem = ownerNameProblem(ownerName);
  if (ownerProblem) fieldErrors.ownerName = ownerProblem;
  if (!email) fieldErrors.email = ACCOUNT_ERRORS.invalidEmail;
  else if (isDisposableEmail(email)) fieldErrors.email = SIGNUP_COPY.disposable;
  if (password.length < PASSWORD_MIN_LENGTH) fieldErrors.password = ACCOUNT_ERRORS.passwordTooShort;
  else if (password.length > PASSWORD_MAX_LENGTH) fieldErrors.password = ACCOUNT_ERRORS.passwordTooLong;
  else if (password !== confirm) fieldErrors.confirm = ACCOUNT_ERRORS.passwordMismatch;
  if (raw.accept !== "on" && raw.accept !== true && raw.accept !== "true") fieldErrors.accept = SIGNUP_COPY.mustAccept;
  if (Object.keys(fieldErrors).length > 0 || !email) return { kind: "invalid", fieldErrors };

  // Sign-ups per network per day (checked before anything about the address, so it cannot be used to probe one).
  if (await overLimit(ctx, `signup:ip-day:${ipKey}`, DAY_MS, SIGNUP_LIMITS.perIpPerDay)) {
    logAuthEvent("signup.refused", { brand: deps.brand, reason: "ip_daily_limit" });
    return { kind: "rate_limited", message: SIGNUP_COPY.tooManyFromNetwork };
  }
  if (await overLimit(ctx, "signup:all-day", DAY_MS, SIGNUP_LIMITS.allPerDay)) {
    logAuthEvent("signup.refused", { brand: deps.brand, reason: "global_daily_limit" });
    return { kind: "rate_limited", message: SIGNUP_COPY.tooManyFromNetwork };
  }
  const emailKey = keyedHash(deps.secret, "email", email);
  if (await overLimit(ctx, `signup:email-day:${emailKey}`, DAY_MS, SIGNUP_LIMITS.perEmailPerDay)) return quiet("address_limit");
  // A platform administrator's account only ever comes from a platform invitation (docs/auth.md §5).
  if (deps.isPlatformAdminEmail(email)) return quiet("platform_address");

  const { origin, brand } = linkTarget(deps.baseUrl, deps.brand);
  const existing = await deps.db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst();
  if (existing) {
    const sent = await deliverEmail(
      signupExistingAccountEmail({ to: { email }, brand, signInLink: `${origin}/login`, resetLink: `${origin}/reset-password` }),
    );
    return quiet(sent.status === "failed" ? "send_failed" : "existing_account");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SIGNUP_LIMITS.linkTtlMs).toISOString();
  const request = await createSignupRequest(ctx, {
    tokenHash: tokenHash(token),
    brand: deps.brand,
    clinicName,
    ownerName,
    email,
    passwordHash: await hashPassword(password),
    termsVersion: termsVersion(deps.brand),
    dpaVersion: dpaVersion(),
    ipHash: ipKey,
    uaHash: keyedHash(deps.secret, "ua", String(deps.userAgent ?? "").slice(0, 512)),
    expiresAt,
  });
  const link = `${origin}${SIGNUP_CONFIRM_PATH}?token=${encodeURIComponent(token)}`;
  const sent = await deliverEmail(signupConfirmEmail({ to: { email, name: ownerName }, brand, clinicName, link, expiresAt }));
  logAuthEvent("signup.requested", { brand: deps.brand, request: request.id, email: sent.status });
  return quiet(sent.status === "failed" ? "send_failed" : "sent");
}

/* ------------------------------------------------------------------ the link */

export type SignupLinkView =
  | { kind: "ok"; clinicName: string; email: string; brand: BrandId; expiresAt: string }
  | { kind: "invalid" }
  | { kind: "wrong_host"; brand: BrandId };

/** What the confirmation page shows for a token (nothing is changed). */
export async function viewSignupLink(db: Kysely<Database>, token: string, hostBrand: BrandId, now: Date = new Date()): Promise<SignupLinkView> {
  const request = await usableRequest(db, token, now);
  if (!request) return { kind: "invalid" };
  if (request.brand !== hostBrand) return { kind: "wrong_host", brand: request.brand };
  return { kind: "ok", clinicName: request.clinicName, email: request.email, brand: request.brand, expiresAt: request.expiresAt };
}

/** A request that can still be finished: known, not completed, and unexpired (or claimed before it expired). */
async function usableRequest(db: Kysely<Database>, token: string, now: Date): Promise<SignupRequest | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token ?? ""))) return null;
  const request = await findSignupRequestByTokenHash({ db }, tokenHash(token));
  if (!request || request.completedAt || !request.passwordHash) return null;
  if (!request.claimedAt && Date.parse(request.expiresAt) <= now.getTime()) return null;
  return request;
}

/* ------------------------------------------------------------------ confirm */

export interface ConfirmSignupDeps {
  db: Kysely<Database>;
  auth: Auth;
  secret: string;
  baseUrl: BaseUrlSetting;
  /** The brand of the host the link was opened on (trusted). */
  brand: BrandId;
  /** The request's headers (Better Auth reads the client's address and origin from them). */
  headers: Headers;
  isPlatformAdminEmail: (email: string) => boolean;
  now?: () => Date;
}

export type ConfirmSignupOutcome =
  | { kind: "created"; tenantId: string; userId: string; acceptanceId: string; brand: BrandId; cookie: string }
  | { kind: "invalid" }
  | { kind: "wrong_password" }
  | { kind: "too_many" }
  | { kind: "busy" }
  | { kind: "existing_account" }
  | { kind: "failed" };

/** A free clinic id from the clinic's name: the name itself, else with a short random suffix. */
export async function pickTenantSlug(db: Kysely<Database>, clinicName: string): Promise<string> {
  let base = slugBaseFromClinicName(clinicName);
  if (base.length < 3) base = base ? `clinic-${base}` : "clinic";
  const suffix = () => {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    return Array.from(randomBytes(4), (b) => alphabet[b % alphabet.length]).join("");
  };
  const candidates = [base, ...Array.from({ length: 6 }, () => `${base}-${suffix()}`)];
  for (const slug of candidates) {
    if (tenantSlugProblem(slug)) continue;
    const taken = await db.selectFrom("organization").select("id").where("slug", "=", slug).executeTakeFirst();
    if (taken) continue;
    const history = await db.selectFrom("audit_log").select("id").where("tenant_id", "=", slug).limit(1).executeTakeFirst();
    if (history) continue;
    return slug;
  }
  throw new Error("No free clinic id");
}

export async function confirmSignup(input: { token: unknown; password: unknown }, deps: ConfirmSignupDeps): Promise<ConfirmSignupOutcome> {
  const now = nowOf(deps);
  const ctx = dbCtx(deps);
  const token = String(input.token ?? "");
  const password = typeof input.password === "string" ? input.password : "";
  let request = await usableRequest(deps.db, token, now);
  if (!request || request.brand !== deps.brand) return { kind: "invalid" };
  if (await overLimit(ctx, `signup:confirm:${request.id}`, 15 * 60_000, SIGNUP_LIMITS.confirmAttemptsPerLink)) return { kind: "too_many" };
  if (!password || password.length > PASSWORD_MAX_LENGTH || !(await verifyPassword({ hash: request.passwordHash as string, password }))) {
    return { kind: "wrong_password" };
  }
  const email = request.email;
  if (deps.isPlatformAdminEmail(email)) {
    await closeSignupRequest(ctx, request.id);
    return { kind: "invalid" };
  }
  const existingUser = await deps.db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst();
  if (existingUser) {
    // An account was made for this address meanwhile (e.g. an invitation): never a second one.
    await closeSignupRequest(ctx, request.id);
    return { kind: "existing_account" };
  }

  // One-time claim. A claim already held: someone is finishing it right now – or a crashed attempt left it (stale).
  if (!request.claimedAt) {
    if (!(await claimSignupRequest(ctx, request.id))) return { kind: "busy" };
  } else if (!request.tenantId) {
    if (now.getTime() - Date.parse(request.claimedAt) < STALE_CLAIM_MS) return { kind: "busy" };
    await releaseSignupClaim(ctx, request.id);
    if (!(await claimSignupRequest(ctx, request.id))) return { kind: "busy" };
  }
  request = { ...request, claimedAt: request.claimedAt ?? now.toISOString() };

  // The clinic and its owner invitation (or, resuming after a failure, the ones already made).
  let tenantId = request.tenantId;
  let organizationId: string;
  if (!tenantId) {
    try {
      const slug = await pickTenantSlug(deps.db, request.clinicName);
      const created = await createClinic(deps.db, {
        name: request.clinicName,
        slug,
        ownerEmail: email,
        appOrigin: brandOrigin(deps.baseUrl, request.brand),
        brand: request.brand,
        linkSecret: deps.secret,
        sendEmail: false, // the person is right here: they join at once, no invitation email
        now,
      });
      tenantId = created.tenantId;
      organizationId = created.organizationId;
      await setSignupTenant(ctx, request.id, tenantId);
    } catch (err) {
      logAuthEvent("signup.clinic_failed", { error: err instanceof Error ? err.name : "error" });
      await releaseSignupClaim(ctx, request.id);
      return { kind: "failed" };
    }
  } else {
    const org = await deps.db.selectFrom("organization").select("id").where("slug", "=", tenantId).executeTakeFirst();
    if (!org) return { kind: "failed" };
    organizationId = org.id;
  }
  const invitation = await deps.db
    .selectFrom("invitation")
    .select("id")
    .where("organizationId", "=", organizationId)
    .where("email", "=", email)
    .where("status", "=", "pending")
    .where("role", "=", "owner")
    .executeTakeFirst();
  if (!invitation) {
    logAuthEvent("signup.no_invitation", { tenant: tenantId });
    return { kind: "failed" };
  }

  // The owner's account (Better Auth's sign-up – the HTTP route stays switched off; the invite-only hook lets it
  // through because the clinic's owner invitation is open) and the membership.
  let cookie: string;
  let userId: string;
  try {
    const signUp = await deps.auth.api.signUpEmail({ body: { email, password, name: request.ownerName }, headers: deps.headers, returnHeaders: true });
    cookie = cookieHeaderFromSetCookie(signUp.headers);
    userId = (signUp.response as { user: { id: string } }).user.id;
    const asOwner = new Headers(deps.headers);
    asOwner.set("cookie", cookie);
    await deps.auth.api.acceptInvitation({ body: { invitationId: invitation.id }, headers: asOwner });
    // Refresh the cached session (it was cached before the membership existed).
    await deps.auth.api.getSession({ headers: asOwner, query: { disableCookieCache: true } });
  } catch (err) {
    logAuthEvent("signup.account_failed", { tenant: tenantId, error: err instanceof Error ? err.name : "error" });
    return { kind: "failed" };
  }

  const acceptance = await recordSignupAcceptance(ctx, {
    tenantId,
    userId,
    signupId: request.id,
    brand: request.brand,
    termsVersion: request.termsVersion,
    dpaVersion: request.dpaVersion,
    acceptedAt: request.createdAt,
    ipHash: request.ipHash,
    uaHash: request.uaHash,
  });
  await completeSignupRequest(ctx, request.id);
  await appendAudit(ctx, tenantId, {
    userId,
    action: "clinic.self_signup",
    targetType: "organization",
    targetId: organizationId,
    detail: { brand: request.brand, termsVersion: request.termsVersion, dpaVersion: request.dpaVersion, acceptance: acceptance.id },
  });
  logAuthEvent("signup.completed", { brand: request.brand, tenant: tenantId });
  return { kind: "created", tenantId, userId, acceptanceId: acceptance.id, brand: request.brand, cookie };
}
