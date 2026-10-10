/**
 * Resets two-step verification for a member who lost their phone AND their backup codes: removes the
 * authenticator secret and backup codes, signs them out everywhere and audits it. At their next sign-in
 * (password only) they must set two-step verification up again. DRY RUN unless --confirm.
 * Check the person's identity out of band first (docs/auth.md).
 *
 *   npm run admin:reset-two-factor -- --email person@clinic.example [--confirm] [--env preview|production] [--yes]
 */
import { resetTwoFactor } from "../../src/server/auth/platform";
import { getDb } from "../../src/server/db";
import { applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  applyTarget(target);
  const confirm = flag(args, "confirm");
  if (confirm) requireYesForProduction(target, args, "Resetting two-step verification");
  const result = await resetTwoFactor(getDb(), str(args, "email", true) as string, { confirm });
  console.log(`${result.dryRun ? "DRY RUN – nothing changed." : "Done."} Account ${result.userId}:`);
  console.log(`  two-step was on: ${result.hadTwoFactor ? "yes" : "no"}`);
  console.log(`  sessions ${result.dryRun ? "to revoke" : "revoked"}: ${result.sessionsRevoked}`);
  console.log(`  clinics: ${result.memberships.join(", ") || "none"}`);
  if (result.dryRun) console.log("Run again with --confirm to reset.");
});
