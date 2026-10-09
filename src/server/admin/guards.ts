/**
 * Request-bound guards for the platform page (/app/platform) and its server actions. Always a fresh session read
 * (past Better Auth's 5-minute cookie cache), so removing someone from CLINFORMS_PLATFORM_ADMINS or signing them
 * out takes effect at once. Everyone who is not a platform administrator gets the ordinary 404 page: the page
 * does not reveal that it exists.
 */
import "server-only";
import { notFound } from "next/navigation";
import { getServerSession } from "../auth/session";
import { platformAdminFromSession, type PlatformAdmin, type PlatformSessionLike } from "./platform-console";

async function currentPlatformAdmin(): Promise<PlatformAdmin | null> {
  const session = await getServerSession({ fresh: true });
  return platformAdminFromSession(session as unknown as PlatformSessionLike | null);
}

/** For the page: the administrator, or the 404 page. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await currentPlatformAdmin();
  if (!admin) notFound();
  return admin;
}

/** For server actions: the administrator, or null (the action then does nothing). */
export async function platformActionAdmin(): Promise<PlatformAdmin | null> {
  return currentPlatformAdmin();
}
