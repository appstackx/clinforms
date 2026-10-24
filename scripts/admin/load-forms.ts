/**
 * Onboarding: load a clinic's own referrer form templates into its forms library (10/2026; logic and rules in
 * src/server/admin/load-forms.ts). Files are stored encrypted for that clinic only; every map is a PROPOSAL – the
 * clinic's staff check and confirm each one once in their Studio. PREVIEW ONLY unless --confirm.
 *
 *   npm run admin:load-forms -- --slug blue-heart --dir ~/secure/blue-heart-templates --maps ~/secure/blue-heart-maps.json
 *       [--read-missing [--referrer "Provider name" --referrer-type mlc]]   # files without a map: layout-rules reading
 *       [--confirm] [--env preview|production] [--yes]
 *
 * --maps: JSON – {"<file name>": {title, referrer: {name, type}, fields: [FormField…], file?: {sha256}}, …}, the same
 * under "maps", or a list of maps each naming file.fileName. A map is checked against its file (SHA-256 when given,
 * every anchor's place and placeholder) and refused when it does not fit. The clinic id must exist and be open.
 * Production needs --confirm --yes and Khuram's go. Prints file names and counts only – never template wording.
 */
import fs from "node:fs";
import { loadClinicForms, parseMapsJson, type MapsJson } from "../../src/server/admin/load-forms";
import { getDataCipher } from "../../src/server/crypto";
import { getDb, getDbKind } from "../../src/server/db";
import { ReferrerTypeSchema } from "../../src/modules/medreport/core/schemas";
import { CliError, applyTarget, flag, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "./cli";

export interface LoadFormsArgs {
  slug: string;
  dir: string;
  mapsPath: string | null;
  readMissing: boolean;
  confirm: boolean;
  referrer?: { name: string; type: ReturnType<typeof ReferrerTypeSchema.parse> };
}

export function loadFormsArgs(args: Map<string, string | true>): LoadFormsArgs {
  const slug = (str(args, "slug", true) as string).trim();
  const dir = str(args, "dir", true) as string;
  const mapsPath = str(args, "maps") ?? null;
  const readMissing = flag(args, "read-missing");
  if (!mapsPath && !readMissing) throw new CliError("Give --maps <file.json>, or --read-missing to propose maps by reading the layout.");
  const name = str(args, "referrer");
  const type = str(args, "referrer-type");
  if (type && !ReferrerTypeSchema.safeParse(type).success) throw new CliError(`--referrer-type must be one of ${ReferrerTypeSchema.options.join(", ")}.`);
  return {
    slug,
    dir: dir.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"),
    mapsPath: mapsPath ? mapsPath.replace(/^~(?=$|\/)/, process.env.HOME ?? "~") : null,
    readMissing,
    confirm: flag(args, "confirm"),
    ...(name ? { referrer: { name, type: ReferrerTypeSchema.parse(type ?? "other") } } : {}),
  };
}

if (process.argv[1] && /load-forms\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const a = loadFormsArgs(args);
    if (a.confirm) requireYesForProduction(target, args, "Loading forms into a clinic");
    const maps: MapsJson = a.mapsPath ? parseMapsJson(fs.readFileSync(a.mapsPath, "utf8")) : {};
    const result = await loadClinicForms(
      { db: getDb(), cipher: getDataCipher() },
      { tenantId: a.slug, dir: a.dir, maps, readMissing: a.readMissing, confirm: a.confirm, ...(a.referrer ? { defaultReferrer: a.referrer } : {}) },
    );
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    console.log(`${result.dryRun ? "PREVIEW – nothing stored." : "Stored."} Clinic ${result.tenantId} on ${where}:`);
    // Security fix 24/10/2026: file names come from the clinic – control characters (terminal escapes) are shown as "?".
    const safe = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
    for (const f of result.files) {
      const what = f.questions !== undefined ? `${f.questions} questions (${f.fromRecords ?? 0} from the record, ${f.forStaff ?? 0} for staff), ${f.mergeFields ?? 0} merge codes, map from ${f.mapFrom}` : "";
      const conv = f.convertedFromRtf ? ` RTF ${((f.rtfBytes ?? 0) / 1048576).toFixed(1)} MB → Word ${((f.sizeBytes ?? 0) / 1024).toFixed(0)} KB,` : "";
      console.log(`  ${f.status.toUpperCase().padEnd(8)} ${safe(f.file)}${conv ? ` –${conv}` : ""} ${what}${f.reason ? ` – ${safe(f.reason)}` : ""}`);
    }
    const counts = (s: string) => result.files.filter((f) => f.status === s).length;
    console.log(`  ready ${counts("ready")} · loaded ${counts("loaded")} · skipped ${counts("skipped")} · refused ${counts("refused")}`);
    if (result.dryRun) console.log("Run again with --confirm to store them (proposed maps: the clinic's staff confirm each one).");
  });
}
