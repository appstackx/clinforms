/**
 * A clinic's own drafting limits (10/2026; the same audited operation as the platform page). They replace the
 * deployment's defaults (CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE / _PER_DAY) for that clinic only.
 *
 *   npm run admin:set-limits -- --slug blue-heart --per-minute 30 --per-day 1500
 *   npm run admin:set-limits -- --slug blue-heart --default                    # back to the defaults
 *       [--env preview|production] [--yes]
 *
 * A limit left out is set back to the default. Production changes need --yes (Khuram's go).
 */
import { setDraftingLimits } from "../../src/server/admin/clinic-plan";
import { getDb, getDbKind } from "../../src/server/db";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";
import { describePlan } from "./set-trial";

export function limitsFromArgs(args: Map<string, string | true>): { perMinute: number | null; perDay: number | null } {
  const reset = flag(args, "default");
  const minute = str(args, "per-minute");
  const day = str(args, "per-day");
  if (reset && (minute || day)) throw new CliError("--default cannot be combined with --per-minute / --per-day.");
  if (!reset && !minute && !day) throw new CliError("Give --per-minute N and/or --per-day N, or --default.");
  const num = (v: string | undefined, what: string) => {
    if (v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new CliError(`${what} must be a whole number of at least 1.`);
    return n;
  };
  return { perMinute: num(minute, "--per-minute"), perDay: num(day, "--per-day") };
}

if (process.argv[1] && /set-limits\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const slug = (str(args, "slug", true) as string).trim();
    const limits = limitsFromArgs(args);
    requireYesForProduction(target, args, "Changing a clinic's drafting limits");
    const plan = await setDraftingLimits(getDb(), { kind: "script" }, slug, limits);
    console.log(`Drafting limits of ${slug} saved on ${target === "current" ? `the ${getDbKind()} database` : target}:`);
    for (const line of describePlan(plan)) console.log(line);
  });
}
