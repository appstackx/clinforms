/**
 * Switches a clinic's package on or off: "reports" (ClinForms) or "clinic" (the clinic system). PREVIEW ONLY
 * unless --confirm; production also needs --yes (and Khuram's go – CLAUDE.md). Nothing is ever deleted: "off"
 * pauses the package (its screens are hidden and blocked). Audited in the clinic's trail ("ClinForms support")
 * and the platform's.
 *
 *   npm run admin:set-entitlement -- --slug riverside-demo --package clinic --on [--status trial]
 *     [--plan-code clinic-29] [--price-source list|founding|design_partner] [--note "…"]
 *     [--env preview|production] [--confirm] [--yes]
 *   npm run admin:set-entitlement -- --slug riverside-demo --package clinic --off [--status cancelled] --confirm
 *
 * The platform page (/app/platform → Packages) does the same with a button.
 */
import { getDb } from "../../src/server/db";
import { isEntitlementStatus, isPackageId, isPriceSource } from "../../src/modules/pms/core/entitlements";
import { setClinicEntitlement } from "../../src/server/pms/admin";
import { BRANDS } from "../../src/lib/brand";
import { CliError, applyTarget, brandAppUrl, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const pkg = str(args, "package", true) as string;
  if (!isPackageId(pkg)) throw new CliError("--package must be reports or clinic.");
  const on = flag(args, "on");
  const off = flag(args, "off");
  if (on === off) throw new CliError("Give exactly one of --on or --off.");
  const status = str(args, "status");
  if (status !== undefined && !isEntitlementStatus(status)) throw new CliError("--status must be active, trial, paused or cancelled.");
  const priceSource = str(args, "price-source");
  if (priceSource !== undefined && !isPriceSource(priceSource)) throw new CliError("--price-source must be list, founding or design_partner.");
  const confirm = flag(args, "confirm");
  if (confirm) requireYesForProduction(target, args, "Changing a clinic's package");
  applyTarget(target);
  const plan = await setClinicEntitlement(getDb(), {
    slug: str(args, "slug", true) as string,
    package: pkg,
    on,
    status,
    planCode: str(args, "plan-code") ?? null,
    priceSource: priceSource ?? null,
    note: str(args, "note") ?? null,
    confirm,
  });
  const word = (v: boolean) => (v ? "ON" : "OFF");
  console.log(`${plan.dryRun ? "PREVIEW – nothing changed." : "Done."} ${plan.clinicName} (${plan.tenantId}), package "${plan.package}":`);
  console.log(`  before: ${word(plan.before.on)} (${plan.before.status ?? "no row – the default"})`);
  console.log(`  after:  ${word(plan.after.on)} (${plan.after.status})`);
  if (plan.dryRun) console.log(`Run again with --confirm${target === "production" ? " --yes" : ""} to apply it.`);
  if (pkg === "clinic") {
    // Invitation and reset links follow the clinic package (docs/auth.md "Two brand hosts").
    try {
      const link = brandAppUrl(target, args, plan.after.on ? "clinic" : "clinforms");
      console.log(`  links ${plan.dryRun ? "would go" : "now go"} to: ${link.origin} (${BRANDS[link.brand].productName}); open invitations keep their link, which works on either host`);
    } catch {
      // no app origin known for this target (preview without --app-url): nothing to print
    }
  }
});
