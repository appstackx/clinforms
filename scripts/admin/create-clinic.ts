/**
 * Creates a clinic (organization + clinic profile) and invites its owner. Prints the invitation link ONCE – send it
 * to the owner yourself. This command NEVER sends email (it runs on a laptop, and must not reach the owner through a
 * target's email settings by accident); to have the invitation emailed, create the clinic on the platform page
 * (/app/platform) instead.
 *
 *   npm run admin:create-clinic -- --name "Riverside Physiotherapy" --slug riverside --owner-email owner@example.com
 *       [--retention-days 365] [--env preview|production] [--app-url https://…] [--yes]
 *
 * Runbook: docs/auth.md.
 */
import { authSecret } from "../../src/server/auth/config";
import { createClinic } from "../../src/server/auth/platform";
import { getDb, getDbKind } from "../../src/server/db";
import { applyTarget, appUrl, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  applyTarget(target);
  requireYesForProduction(target, args, "Creating a clinic");
  const name = str(args, "name", true) as string;
  const slug = str(args, "slug", true) as string;
  const ownerEmail = str(args, "owner-email", true) as string;
  const retention = str(args, "retention-days");
  const origin = appUrl(target, args);
  const created = await createClinic(getDb(), {
    name,
    slug,
    ownerEmail,
    retentionDays: retention ? Number(retention) : undefined,
    appOrigin: origin,
    linkSecret: authSecret(), // the target app's BETTER_AUTH_SECRET: the link only works on that app
    sendEmail: false, // never from a script (see above)
  });
  console.log(`Clinic created on ${target === "current" ? `the ${getDbKind()} database` : target}.`);
  console.log(`  clinic id (tenant):  ${created.tenantId}`);
  console.log(`  organization id:     ${created.organizationId}`);
  console.log(`  owner invitation:    expires ${created.invitationExpiresAt}`);
  console.log("  email:               not sent (this command never sends email)");
  console.log("");
  console.log("Invitation link (shown once – send it to the owner yourself, and only to them):");
  console.log(`  ${created.inviteLink}`);
});
