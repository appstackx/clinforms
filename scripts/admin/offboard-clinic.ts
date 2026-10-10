/**
 * Offboards a clinic: exports its data DECRYPTED to a folder outside the repository (0700 / files 0600),
 * checks the export, then deletes the clinic's data, revokes its API keys, removes its members (deleting the
 * accounts that belong to no other clinic) and writes an audit row. DRY RUN unless --confirm.
 *
 *   npm run admin:offboard-clinic -- --slug riverside                     # dry run: counts only
 *   npm run admin:offboard-clinic -- --slug riverside --confirm [--export-dir ~/secure/riverside]
 *       [--release-slug] [--env preview|production] [--yes]
 *
 * The organization row stays as a tombstone (so the clinic id is never reused) unless --release-slug.
 * Runbook: docs/auth.md.
 */
import { offboardClinic } from "../../src/server/auth/platform";
import { getDataCipher } from "../../src/server/crypto";
import { getDb } from "../../src/server/db";
import { applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, safeExportDir, str } from "./cli";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  applyTarget(target);
  const slug = str(args, "slug", true) as string;
  const confirm = flag(args, "confirm");
  if (confirm) requireYesForProduction(target, args, "Offboarding a clinic");
  const exportDir = confirm ? safeExportDir(str(args, "export-dir"), slug) : undefined;
  const result = await offboardClinic(getDb(), confirm ? getDataCipher() : null, { slug, confirm, exportDir, releaseSlug: flag(args, "release-slug") });
  console.log(`${result.dryRun ? "DRY RUN – nothing changed." : "Offboarded."} Clinic ${result.tenantId} (${result.organizationId}):`);
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`  accounts deleted ${result.usersToDelete} (members of no other clinic)`);
  console.log(`  accounts kept    ${result.usersKept} (also members elsewhere)`);
  if (!result.dryRun) {
    console.log(`Export: ${result.exportDir} (${result.exportFiles.length} files). It holds decrypted patient data: keep it encrypted, delete it when no longer needed.`);
  } else {
    console.log("Run again with --confirm to export and delete.");
  }
});
