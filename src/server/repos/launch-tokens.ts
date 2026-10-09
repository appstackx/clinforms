/**
 * `launch_token_uses` – single-use launch tokens across every server instance (replaces the in-memory
 * replay cache). claimLaunchToken() is one atomic INSERT … ON CONFLICT DO NOTHING RETURNING.
 */
import { RepoInputError, assertIso, nowIso, type RepoContext } from "./context";

const JTI = /^[A-Za-z0-9_.:-]{8,128}$/;

/** True the first time a jti is claimed, false on every later attempt (a replay). */
export async function claimLaunchToken(ctx: RepoContext, jti: string, expiresAt: string): Promise<boolean> {
  if (typeof jti !== "string" || !JTI.test(jti)) throw new RepoInputError("jti is not valid.");
  const expires = assertIso(expiresAt, "expiresAt");
  const row = await ctx.db
    .insertInto("launch_token_uses")
    .values({ jti, expires_at: expires })
    .onConflict((oc) => oc.column("jti").doNothing())
    .returning("jti")
    .executeTakeFirst();
  return row !== undefined;
}

/** Removes claims whose token has expired (the retention cron). Returns the number removed. */
export async function purgeExpiredLaunchTokens(ctx: RepoContext, now: string = nowIso(ctx)): Promise<number> {
  const result = await ctx.db.deleteFrom("launch_token_uses").where("expires_at", "<", assertIso(now, "now")).executeTakeFirst();
  return Number(result.numDeletedRows);
}
