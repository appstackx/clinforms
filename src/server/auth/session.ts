/**
 * Server-side guards for the signed-in area and the server actions (Node runtime; the Edge middleware only
 * does an optimistic cookie check). Real checks, every request:
 *   no session                  → /login?next=<path>
 *   no two-step verification    → /two-factor
 *   no active clinic membership → /app/select-clinic
 * Mutations (server actions) re-read the session past the 5-minute cookie cache.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { appendAudit, type AuditEntryInput } from "../repos/audit";
import { hitRateLimit } from "../repos/rate-limits";
import { getAuth } from "./auth";
import { authSecret, safeNextPath } from "./config";
import type { Auth } from "./create-auth";
import { findMembership, type Membership } from "./membership";
import { isManager } from "./roles";

export type ServerSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export function requestHeaders(): Headers {
  return headers() as unknown as Headers;
}

/** The path of the current page, set by src/middleware.ts for /app routes. */
export function currentPath(): string {
  return safeNextPath(requestHeaders().get("x-clinforms-path"), "/app");
}

export async function getServerSession(options: { fresh?: boolean } = {}): Promise<ServerSession | null> {
  try {
    return await getAuth().api.getSession({
      headers: requestHeaders(),
      ...(options.fresh ? { query: { disableCookieCache: true } } : {}),
    });
  } catch {
    return null;
  }
}

export function activeOrganizationId(session: ServerSession): string | null {
  return (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
}

export function hasTwoFactor(session: ServerSession): boolean {
  return (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
}

/**
 * Signed in AND two-step verification on (else redirects). Always read from the database, not Better Auth's
 * 5-minute cookie cache: a session revoked elsewhere ("sign out other devices", password reset) must lose
 * access to /app at once.
 */
export async function requireSignedIn(options: { allowWithoutTwoFactor?: boolean } = {}): Promise<ServerSession> {
  const session = await getServerSession({ fresh: true });
  if (!session) redirect(`/login?next=${encodeURIComponent(currentPath())}`);
  if (!hasTwoFactor(session) && !options.allowWithoutTwoFactor) redirect("/two-factor");
  return session;
}

export interface AppContext {
  session: ServerSession;
  membership: Membership;
}

/** Signed in, two-step on, and a member of the active clinic (else redirects). */
export async function requireAppContext(): Promise<AppContext> {
  const session = await requireSignedIn();
  const orgId = activeOrganizationId(session);
  if (!orgId) redirect("/app/select-clinic");
  const membership = await findMembership(getDb(), orgId, session.user.id);
  if (!membership) redirect("/app/select-clinic");
  return { session, membership };
}

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** For server actions: a fresh session, two-step on, membership of the active clinic (and a manager role). */
export async function actionContext(options: { manage?: boolean } = {}): Promise<AppContext | { error: "signed_out" | "forbidden" | "no_clinic" }> {
  const session = await getServerSession({ fresh: true });
  if (!session) return { error: "signed_out" };
  if (!hasTwoFactor(session)) return { error: "forbidden" };
  const orgId = activeOrganizationId(session);
  if (!orgId) return { error: "no_clinic" };
  const membership = await findMembership(getDb(), orgId, session.user.id);
  if (!membership) return { error: "no_clinic" };
  if (options.manage && !isManager(membership.role)) return { error: "forbidden" };
  return { session, membership };
}

export async function auditAction(ctx: AppContext, entry: Omit<AuditEntryInput, "userId" | "sessionId">): Promise<void> {
  await appendAudit({ db: getDb() }, ctx.membership.tenantId, { ...entry, userId: ctx.session.user.id, sessionId: ctx.session.session.id });
}

/** The client's IP as Vercel (or the local server) reports it. */
export function clientIp(h: Headers = requestHeaders()): string {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim().slice(0, 64);
}

/**
 * A shared fixed-window limit (rate_limits table, every server instance). Subjects (IP addresses, emails) are
 * stored only as a keyed hash. Returns false when the limit is exceeded.
 */
export async function throttle(bucket: string, subject: string, max: number, windowMs: number): Promise<boolean> {
  const digest = createHmac("sha256", authSecret()).update(`${bucket}\n${subject.toLowerCase()}`).digest("base64url").slice(0, 32);
  try {
    const hit = await hitRateLimit({ db: getDb() }, `auth:${bucket}:${digest}`, windowMs);
    return hit.count <= max;
  } catch {
    return true; // never lock everyone out because the counter could not be written
  }
}
