/**
 * A DEMO clinic on / off (10/2026; the same audited operation as the platform page, src/server/admin/clinic-plan.ts
 * setDemoClinic). A demo clinic holds made-up data only and otherwise works like any customer's clinic – e.g.
 * ClinForms' own test clinic on production, where Khuram approves reports like a customer would:
 *
 * - every clinic page and Studio page shows the banner "Demo clinic – made-up data only";
 * - every output (preview, Word / PDF downloads, copied answers) carries a demonstration notice;
 * - members' signing details accept the made-up PH-DEMO-NN numbers (Sarah Reid PH-DEMO-01 …), and those approve.
 *   A real clinic refuses them – on the members page and at approval (403 DEMO_NUMBER_NOT_ALLOWED).
 *
 *   npm run admin:set-demo-clinic -- --slug <clinic id> --on      # make it a demo clinic
 *   npm run admin:set-demo-clinic -- --slug <clinic id> --off     # a real clinic again
 *   npm run admin:set-demo-clinic -- --slug <clinic id> --show    # read only
 *       [--env preview|production] [--yes]
 *
 * NEVER for a clinic with real patients. Production changes need --yes (Khuram's go) and migration 0008 applied there
 * first. Every change is written to the clinic's audit trail ("clinic.demo_on" / "clinic.demo_off", by ClinForms).
 */
import { setDemoClinic } from "../../src/server/admin/clinic-plan";
import { getDb, getDbKind } from "../../src/server/db";
import { getClinicPlan } from "../../src/server/repos/clinic-plan";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

export type DemoCommand = "on" | "off" | "show";

/** Exactly one of --on, --off, --show. */
export function demoCommand(args: Map<string, string | true>): DemoCommand {
  const asked = (["on", "off", "show"] as const).filter((k) => flag(args, k));
  if (asked.length !== 1) throw new CliError("Give exactly one of --on (make it a demo clinic), --off (a real clinic again) or --show.");
  return asked[0];
}

if (process.argv[1] && /set-demo-clinic\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const command = demoCommand(args);
    const slug = (str(args, "slug", true) as string).trim();
    const target = resolveTarget(args);
    applyTarget(target);
    if (command !== "show") requireYesForProduction(target, args, command === "on" ? "Making a demo clinic" : "Switching a demo clinic off");
    const db = getDb();
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    if (command === "show") {
      const plan = await getClinicPlan({ db }, slug);
      console.log(`${slug} on ${where}: ${plan?.demoClinic ? "a DEMO clinic (made-up data only)" : "a real clinic (not a demo clinic)"}.`);
      return;
    }
    const r = await setDemoClinic(db, { kind: "script" }, slug, command === "on");
    const state = r.demoClinic ? "a DEMO clinic (made-up data only)" : "a real clinic";
    console.log(`${r.changed ? "Done" : "Nothing to change"}: ${slug} on ${where} is ${state}.`);
    console.log(`  members with a made-up PH-DEMO number: ${r.membersWithDemoNumbers}`);
    if (!r.demoClinic && r.membersWithDemoNumbers > 0) {
      console.log("  note: those members cannot approve until an owner or administrator enters their HCPC number (Settings → Members).");
    }
  });
}
