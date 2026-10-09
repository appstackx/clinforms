/**
 *   npm run admin:list-clinics -- [--env preview|production]
 */
import { listClinics } from "../../src/server/auth/platform";
import { getDb } from "../../src/server/db";
import { applyTarget, parseArgs, resolveTarget, runCli } from "./cli";

void runCli(async () => {
  const target = resolveTarget(parseArgs(process.argv.slice(2)));
  applyTarget(target);
  const clinics = await listClinics(getDb());
  if (clinics.length === 0) {
    console.log("No clinics.");
    return;
  }
  console.log(["clinic id".padEnd(28), "members", "owners", "invites", "retention", "created".padEnd(24), "status", "name"].join("  "));
  for (const c of clinics) {
    console.log(
      [
        c.tenantId.padEnd(28),
        String(c.members).padStart(7),
        String(c.owners).padStart(6),
        String(c.pendingInvitations).padStart(7),
        String(c.retentionDays ?? "-").padStart(9),
        c.createdAt.padEnd(24),
        (c.offboardedAt ? "offboarded" : "active").padEnd(6),
        c.name,
      ].join("  "),
    );
  }
});
