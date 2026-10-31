/**
 * Go-live clean-up for payments (docs/clinic-system/BILLING.md "Go-live"): forgets every clinic's TEST customer and
 * saved card, reverses text credit packs bought in test mode (with a recorded reason) and (with subscriptions) ends
 * subscriptions made in test mode, so nothing paid for in test mode counts once live billing is on. Idempotent. PREVIEW unless --confirm;
 * production also needs --yes (and Khuram's go – CLAUDE.md). Run it BEFORE deploying CLINDESK_BILLING_LIVE=1.
 *
 *   npm run admin:billing-go-live -- [--env preview|production] [--confirm] [--yes]
 */
import { goLiveTextCredits } from "../../src/server/admin/billing-go-live";
import { getDb } from "../../src/server/db";
import { applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli } from "./cli";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const confirm = flag(args, "confirm");
  if (confirm) requireYesForProduction(target, args, "The payments go-live clean-up");
  applyTarget(target);
  const db = getDb();
  const credits = await goLiveTextCredits(db, { confirm });
  console.log(`${confirm ? "Done." : "PREVIEW – nothing changed."} Payments go-live clean-up (${target}):`);
  if (!credits.available) console.log("  text credits: tables not on this database (migration 0143) – nothing to do");
  for (const c of credits.clinics) {
    console.log(`  ${c.tenantId}: test customer ${c.hadTestCustomer ? "cleared" : "none"}; ${c.testPurchases} test-mode pack(s); credits taken off ${confirm ? c.creditsTakenOff : `(up to) ${c.creditsToTakeOff}`}`);
  }
  if (!credits.clinics.length) console.log("  nothing to clean up");
  if (!confirm) console.log(`Run again with --confirm${target === "production" ? " --yes" : ""} to apply it.`);
});
