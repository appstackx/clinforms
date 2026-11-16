/**
 * Onboarding: add a portal question set to a clinic's forms library (16/11/2026; logic and rules in
 * src/server/admin/add-question-set.ts). For a referrer whose reports are typed into an online portal – there is no
 * file to load with admin:load-forms. Stored encrypted for that clinic only, as a PROPOSAL: the clinic's staff check
 * and confirm it once in their Studio. PREVIEW ONLY unless --confirm.
 *
 *   npm run admin:add-question-set -- --slug blue-heart --referrer "Provider name" --referrer-type case_manager \
 *       --questions ~/secure/provider-portal-questions.txt [--title "Provider – initial assessment (portal)"] \
 *       [--note "A note for the clinic's staff"] [--confirm] [--env preview|production] [--yes]
 *
 * --questions: a text file, one question per line, as the Studio's "Add portal questions" box takes them: "# Heading",
 * [date] / [yes/no] / [number] / [long] / [short] / [choice: A | B | C], [optional]. Keep a provider's own wording out
 * of git (use the gitignored demo-assets/). Production needs --confirm --yes and Khuram's go. Prints counts and the
 * parser's notes only.
 */
import fs from "node:fs";
import { addClinicQuestionSet } from "../../src/server/admin/add-question-set";
import { getDataCipher } from "../../src/server/crypto";
import { getDb, getDbKind } from "../../src/server/db";
import { ReferrerTypeSchema } from "../../src/modules/medreport/core/schemas";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

export interface AddQuestionSetArgs {
  slug: string;
  questionsPath: string;
  referrer: { name: string; type: ReturnType<typeof ReferrerTypeSchema.parse> };
  title: string | null;
  note: string | null;
  confirm: boolean;
}

export function addQuestionSetArgs(args: Map<string, string | true>): AddQuestionSetArgs {
  const slug = (str(args, "slug", true) as string).trim();
  const questionsPath = str(args, "questions", true) as string;
  const name = (str(args, "referrer", true) as string).trim();
  const type = ReferrerTypeSchema.safeParse(str(args, "referrer-type", true));
  if (!type.success) throw new CliError(`--referrer-type must be one of: ${ReferrerTypeSchema.options.join(", ")}.`);
  return { slug, questionsPath, referrer: { name, type: type.data }, title: (str(args, "title") as string | undefined)?.trim() || null, note: (str(args, "note") as string | undefined)?.trim() || null, confirm: flag(args, "confirm") };
}

if (process.argv[1] && /add-question-set\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const a = addQuestionSetArgs(args);
    if (a.confirm) requireYesForProduction(target, args, "Adding a question set to a clinic");
    if (!fs.existsSync(a.questionsPath) || !fs.statSync(a.questionsPath).isFile()) throw new CliError(`No file at ${a.questionsPath}.`);
    const result = await addClinicQuestionSet(
      { db: getDb(), cipher: getDataCipher() },
      { tenantId: a.slug, referrer: a.referrer, ...(a.title ? { title: a.title } : {}), questionsText: fs.readFileSync(a.questionsPath, "utf8"), ...(a.note ? { notes: [a.note] } : {}), confirm: a.confirm },
    );
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    console.log(`${result.dryRun ? "PREVIEW – nothing stored." : "Stored."} Clinic ${result.tenantId} on ${where}:`);
    console.log(`  ${result.status.toUpperCase().padEnd(8)} ${result.questions} questions under ${result.headings} headings (${result.fromRecords} from the record, ${result.forStaff} for staff)${result.formId ? ` – ${result.formId}` : ""}${result.reason ? ` – ${result.reason}` : ""}`);
    for (const e of result.errors) console.log(`  problem: ${e}`);
    for (const w of result.warnings) console.log(`  note: ${w}`);
    if (result.dryRun && result.status === "ready") console.log("Run again with --confirm to store it (a proposed map: the clinic's staff check and confirm it).");
    if (result.invariants) {
      if (result.invariants.ok) console.log("  The clinic's members, invitations, plan, package, usage, settings and reports: unchanged.");
      else {
        console.error(`  CHANGED during the run (the tool never writes them – check at once): ${result.invariants.changed.join(", ")}`);
        process.exitCode = 1;
      }
    }
    if (result.status === "refused") process.exitCode = 1;
  });
}
