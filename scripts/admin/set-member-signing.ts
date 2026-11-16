/**
 * Support: set a member's signing details for a clinic (16/11/2026; logic and rules in
 * src/server/admin/member-signing.ts – the same rules as the clinic's own Members page). PREVIEW unless --confirm.
 *
 *   npm run admin:set-member-signing -- --slug <clinic id> --member "Name as the clinic shows it" --hcpc PH123456 \
 *       [--no-sign] [--confirm] [--env preview|production] [--yes]
 *
 * Use the member's REAL registration number (check it on the HCPC's public register first): it is printed on every
 * form they approve. A made-up PH-DEMO number is accepted in a demo clinic only. Production needs --confirm --yes and
 * Khuram's go. Prints flags only – never the number.
 */
import { setMemberSigning } from "../../src/server/admin/member-signing";
import { getDb, getDbKind } from "../../src/server/db";
import { applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

export interface SetMemberSigningArgs {
  slug: string;
  member: string;
  hcpc: string;
  maySign: boolean;
  confirm: boolean;
}

export function setMemberSigningArgs(args: Map<string, string | true>): SetMemberSigningArgs {
  return {
    slug: (str(args, "slug", true) as string).trim(),
    member: (str(args, "member", true) as string).trim(),
    hcpc: (str(args, "hcpc", true) as string).trim(),
    maySign: !flag(args, "no-sign"),
    confirm: flag(args, "confirm"),
  };
}

if (process.argv[1] && /set-member-signing\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const a = setMemberSigningArgs(args);
    if (a.confirm) requireYesForProduction(target, args, "Setting a member's signing details");
    const r = await setMemberSigning({ db: getDb() }, { tenantId: a.slug, memberName: a.member, hcpcNumber: a.hcpc, maySign: a.maySign, confirm: a.confirm });
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    const say = (s: { hasHcpc: boolean; maySign: boolean }) => `${s.hasHcpc ? "number set" : "no number"}, ${s.maySign ? "may sign" : "does not sign"}`;
    console.log(`${r.dryRun ? "PREVIEW – nothing stored." : r.changed ? "Stored." : "Already so – nothing to store."} Clinic ${r.tenantId} on ${where}:`);
    console.log(`  ${r.member} (${r.role}): ${say(r.before)} → ${say(r.after)}${r.changed ? "" : " (no change)"}`);
    if (r.dryRun && r.changed) console.log("Run again with --confirm to store it.");
  });
}
