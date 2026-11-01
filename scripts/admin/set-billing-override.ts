/**
 * The billing override (docs/clinic-system/BILLING.md "Manual overrides"): ON = ClinForms staff manage the clinic's
 * packages by hand – the subscription is recorded but changes no package and puts no hold on the account; OFF = the
 * subscription drives the packages again (re-applied at once when payments are configured here, else at the next
 * payment event or with the platform page's "Re-read"). Manual package changes switch it on by themselves.
 *
 *   npm run admin:set-billing-override -- --slug <clinic id> --on [--note "design partner"] [--env preview|production] [--yes]
 *   npm run admin:set-billing-override -- --slug <clinic id> --off [--env …] [--yes]
 *   npm run admin:set-billing-override -- --slug <clinic id> --show
 */
import { setBillingOverride } from "../../src/server/admin/billing";
import { subscriptionPaymentsFromEnv } from "../../src/server/billing/payments";
import { syncSubscription } from "../../src/server/billing/sync";
import { getDb } from "../../src/server/db";
import { getClinicSubscription } from "../../src/server/repos/clinic-subscription";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const asked = (["on", "off", "show"] as const).filter((k) => flag(args, k));
  if (asked.length !== 1) throw new CliError("Give exactly one of --on, --off or --show.");
  const command = asked[0];
  const slug = (str(args, "slug", true) as string).trim();
  const target = resolveTarget(args);
  applyTarget(target);
  if (command !== "show") requireYesForProduction(target, args, "Changing a clinic's billing override");
  const db = getDb();
  if (command === "show") {
    const s = await getClinicSubscription({ db }, slug);
    console.log(s ? `${slug}: subscription ${s.subscriptionRef} (${s.mode}), ${s.state}, plan ${s.product ?? "?"} ${s.planKey ?? ""}; override ${s.override ? `ON (${s.overrideNote ?? "no note"})` : "off"}` : `${slug}: no subscription.`);
    return;
  }
  const r = await setBillingOverride(db, { kind: "script" }, slug, command === "on", str(args, "note") ?? null);
  console.log(`${r.changed ? "Done" : "Nothing to change"}: billing override for ${slug} is ${command === "on" ? "ON" : "off"}.`);
  if (command === "off") {
    const s = await getClinicSubscription({ db }, slug);
    const p = subscriptionPaymentsFromEnv();
    if (s && p.ok) {
      const res = await syncSubscription({ db }, p.payments, s.subscriptionRef, { forceApply: true });
      console.log(`  re-applied the subscription: ${res.status}${res.status === "synced" ? ` (${res.subscription.state})` : ""}`);
    } else {
      console.log("  the subscription is re-applied at its next payment event, or with \"Re-read\" on the platform page.");
    }
  }
});
