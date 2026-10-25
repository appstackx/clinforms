/**
 * A clinic's package (25/10/2026; the same audited operation as the platform page, src/server/admin/clinic-package.ts).
 * Shows what it WOULD save unless --confirm is given (and --yes as well on production – Khuram's go).
 *
 *   npm run admin:set-package -- --slug blue-heart-clinics --package custom --price 300 --reports 500 --extra 1.50
 *   npm run admin:set-package -- --slug blue-heart-clinics --package trial --price 300 --reports 500 --extra none  # extra not agreed yet
 *   npm run admin:set-package -- --slug riverside --package practice                       # the price list's Practice
 *   npm run admin:set-package -- --slug riverside --package practice --founding-price 149   # fixed 12 months
 *       [--founding-until 2027-10-24] [--setup-fee 250 --setup-status due|paid|waived] [--starts 2026-10-01]
 *       [--notes "internal note"]
 *   npm run admin:set-package -- --slug riverside --remove
 *   npm run admin:set-package -- --slug riverside --show                                   # read only
 *       [--env preview|production] [--confirm] [--yes]
 *
 * Amounts are pounds ex VAT. A preset fills in what is not given (Custom has no defaults: --price, --reports and
 * --extra are required). Every change is written to the clinic's audit trail ("Package set by ClinForms").
 */
import { removePackage, setPackage } from "../../src/server/admin/clinic-package";
import { getDb, getDbKind } from "../../src/server/db";
import { getClinicPackage, type ClinicPackage, type PackageInput } from "../../src/server/repos/clinic-package";
import {
  PACKAGE_IDS,
  PACKAGE_PRESETS,
  SETUP_FEE_STATUSES,
  formatPence,
  isPackageId,
  packageLabel,
  parsePounds,
  reportsText,
  type SetupFeeStatus,
} from "../../src/lib/packages";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

export type PackageCommand = { kind: "show" } | { kind: "remove" } | { kind: "set"; input: PackageInput };

function pounds(args: Map<string, string | true>, key: string): number | null {
  const raw = str(args, key);
  if (raw === undefined) return null;
  const pence = parsePounds(raw);
  if (pence === null || Number.isNaN(pence)) throw new CliError(`--${key} must be an amount in pounds, e.g. 199 or 1.50.`);
  return pence;
}

/** What the arguments ask for (exactly one of --package, --remove, --show). */
export function packageCommand(args: Map<string, string | true>): PackageCommand {
  const asked = ["package", "remove", "show"].filter((k) => args.has(k));
  if (asked.length !== 1) throw new CliError("Give exactly one of --package <name>, --remove or --show.");
  if (asked[0] === "show") return { kind: "show" };
  if (asked[0] === "remove") return { kind: "remove" };
  const id = str(args, "package");
  if (!isPackageId(id)) throw new CliError(`--package must be one of ${PACKAGE_IDS.join(", ")}.`);
  const preset = PACKAGE_PRESETS[id];
  const price = pounds(args, "price") ?? preset.monthlyPricePence;
  // --extra none: the price of an extra report is not agreed yet (extra reports are counted and shown without a price).
  const extraUnset = str(args, "extra")?.trim().toLowerCase() === "none";
  const extra = extraUnset ? null : (pounds(args, "extra") ?? preset.extraReportPence);
  const reportsRaw = str(args, "reports");
  const reports = reportsRaw === undefined ? preset.reportsIncluded : Number(reportsRaw);
  if (price === null || (extra === null && !extraUnset) || reports === null)
    throw new CliError("A custom package needs --price, --reports and --extra (or --extra none while the extra price is not agreed).");
  if (!Number.isInteger(reports) || reports < 0) throw new CliError("--reports must be a whole number.");
  const status = str(args, "setup-status");
  if (status !== undefined && (SETUP_FEE_STATUSES as readonly string[]).indexOf(status) < 0) throw new CliError("--setup-status must be due, paid or waived.");
  return {
    kind: "set",
    input: {
      package: id,
      monthlyPricePence: price,
      reportsIncluded: reports,
      extraReportPence: extra,
      foundingPricePence: pounds(args, "founding-price"),
      foundingUntil: str(args, "founding-until") ?? null,
      setupFeePence: pounds(args, "setup-fee"),
      setupFeeStatus: (status as SetupFeeStatus | undefined) ?? null,
      startsOn: str(args, "starts") ?? null,
      notes: str(args, "notes") ?? null,
    },
  };
}

export function describePackage(p: ClinicPackage | PackageInput | null): string[] {
  if (!p) return ["  no package"];
  const lines = [
    `  package:          ${packageLabel(p.package)}`,
    `  price:            ${formatPence(p.monthlyPricePence)} a month (ex VAT)`,
    `  reports included: ${reportsText(p.reportsIncluded)} a month`,
    `  extra report:     ${p.extraReportPence === null || p.extraReportPence === undefined ? "not set yet (counted, no price)" : `${formatPence(p.extraReportPence)} each`}`,
  ];
  if (p.foundingPricePence !== null && p.foundingPricePence !== undefined)
    lines.push(`  founding price:   ${formatPence(p.foundingPricePence)} until ${p.foundingUntil ?? "12 months from the start"}`);
  if (p.setupFeePence !== null && p.setupFeePence !== undefined)
    lines.push(`  set-up fee:       ${formatPence(p.setupFeePence)} (${p.setupFeeStatus ?? "due"})`);
  lines.push(`  starts:           ${p.startsOn ?? "today"}`);
  if (p.notes) lines.push(`  notes:            ${p.notes}`);
  return lines;
}

if (process.argv[1] && /set-package\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const slug = (str(args, "slug", true) as string).trim();
    const command = packageCommand(args);
    const db = getDb();
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    const current = await getClinicPackage({ db }, slug);
    if (command.kind === "show") {
      console.log(`Package of ${slug} on ${where}:`);
      for (const line of describePackage(current)) console.log(line);
      return;
    }
    if (!flag(args, "confirm")) {
      console.log(`PREVIEW – nothing saved. ${slug} on ${where} now:`);
      for (const line of describePackage(current)) console.log(line);
      console.log(command.kind === "remove" ? "Would remove the package." : "Would save:");
      if (command.kind === "set") for (const line of describePackage(command.input)) console.log(line);
      console.log(`Run again with --confirm${target === "production" ? " --yes" : ""} to save it.`);
      return;
    }
    requireYesForProduction(target, args, "Changing a clinic's package");
    const actor = { kind: "script" as const };
    if (command.kind === "remove") {
      await removePackage(db, actor, slug);
      console.log(`Package of ${slug} removed on ${where}.`);
      return;
    }
    const saved = await setPackage(db, actor, slug, command.input);
    console.log(`Package of ${slug} saved on ${where}:`);
    for (const line of describePackage(saved)) console.log(line);
  });
}
