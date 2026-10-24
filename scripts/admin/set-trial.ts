/**
 * A clinic's trial (10/2026; the same audited operations as the platform page, src/server/admin/clinic-plan.ts).
 *
 *   npm run admin:set-trial -- --slug blue-heart --days 3 [--start-on-first-sign-in | --start-now]   # set / restart
 *   npm run admin:set-trial -- --slug blue-heart --extend-days 3                                      # extend
 *   npm run admin:set-trial -- --slug blue-heart --convert-to-paid                                    # end: full account
 *   npm run admin:set-trial -- --slug blue-heart --end-now                                            # end at once
 *   npm run admin:set-trial -- --slug blue-heart --show                                               # read only
 *       [--env preview|production] [--yes]
 *
 * --days starts the trial when an owner first opens the clinic area (the default, = --start-on-first-sign-in) –
 * or at once when the clinic already has an owner (they have signed in) or with --start-now. While it runs the
 * clinic sees "Trial – N days left …"; afterwards nothing new can be created and existing records stay available.
 * Production changes need --yes (Khuram's go). Every change is written to the clinic's audit trail.
 */
import { endTrial, extendTrial, setTrial } from "../../src/server/admin/clinic-plan";
import { getDb, getDbKind } from "../../src/server/db";
import { clinicAccessOf, getClinicPlan, type ClinicPlan } from "../../src/server/repos/clinic-plan";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

export type TrialCommand =
  | { kind: "show" }
  | { kind: "set"; days: number; start: "first_sign_in" | "now" }
  | { kind: "extend"; days: number }
  | { kind: "paid" }
  | { kind: "end" };

function days(value: string | undefined, what: string): number {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n < 1 || n > 366) throw new CliError(`${what} must be a whole number of days, 1–366.`);
  return n;
}

/** The one thing the arguments ask for (exactly one of --days, --extend-days, --convert-to-paid, --end-now, --show). */
export function trialCommand(args: Map<string, string | true>): TrialCommand {
  const asked = ["days", "extend-days", "convert-to-paid", "end-now", "show"].filter((k) => args.has(k));
  if (asked.length !== 1) throw new CliError("Give exactly one of --days N, --extend-days N, --convert-to-paid, --end-now or --show.");
  if (flag(args, "start-now") && flag(args, "start-on-first-sign-in")) throw new CliError("Choose --start-now or --start-on-first-sign-in, not both.");
  switch (asked[0]) {
    case "days":
      return { kind: "set", days: days(str(args, "days"), "--days"), start: flag(args, "start-now") ? "now" : "first_sign_in" };
    case "extend-days":
      return { kind: "extend", days: days(str(args, "extend-days"), "--extend-days") };
    case "convert-to-paid":
      return { kind: "paid" };
    case "end-now":
      return { kind: "end" };
    default:
      return { kind: "show" };
  }
}

export function describePlan(plan: ClinicPlan | null, now = new Date()): string[] {
  if (!plan) return ["  no plan: no trial, default drafting limits"];
  const a = clinicAccessOf(plan, now);
  const state =
    a.state === "trial"
      ? a.pending
        ? `trial of ${a.daysLeft} days, starts when an owner first signs in`
        : `trial running, ${a.daysLeft} day(s) left, ends ${a.endsAt}`
      : a.state === "trial_ended"
        ? `trial ENDED ${a.endedAt} – nothing new can be created`
        : plan.status === "paid"
          ? `full account (trial converted ${plan.endedAt ?? ""})`
          : "no trial";
  return [
    `  state:            ${state}`,
    `  owner first seen: ${plan.ownerFirstSignInAt ?? "not yet"}`,
    `  drafting limits:  ${plan.livePerMinute ?? "default"} a minute, ${plan.livePerDay ?? "default"} a day`,
  ];
}

if (process.argv[1] && /set-trial\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const slug = (str(args, "slug", true) as string).trim();
    const command = trialCommand(args);
    if (command.kind !== "show") requireYesForProduction(target, args, "Changing a clinic's trial");
    const db = getDb();
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    const actor = { kind: "script" as const };
    if (command.kind === "set") {
      const r = await setTrial(db, actor, slug, { days: command.days, start: command.start });
      console.log(`Trial set for ${slug} on ${where}${r.startedNow ? " – the owner has already signed in, so it started now" : ""}.`);
    } else if (command.kind === "extend") {
      await extendTrial(db, actor, slug, command.days);
      console.log(`Trial of ${slug} extended by ${command.days} day(s) on ${where}.`);
    } else if (command.kind === "paid") {
      await endTrial(db, actor, slug, "paid");
      console.log(`Trial of ${slug} converted to a full account on ${where}.`);
    } else if (command.kind === "end") {
      await endTrial(db, actor, slug, "now");
      console.log(`Trial of ${slug} ended now on ${where}.`);
    } else {
      console.log(`Plan of ${slug} on ${where}:`);
    }
    for (const line of describePlan(await getClinicPlan({ db }, slug))) console.log(line);
  });
}
