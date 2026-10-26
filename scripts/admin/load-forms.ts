/**
 * Onboarding: load a clinic's own referrer form templates into its forms library (10/2026; logic and rules in
 * src/server/admin/load-forms.ts). Files are stored encrypted for that clinic only; every map is a PROPOSAL – the
 * clinic's staff check and confirm each one once in their Studio. PREVIEW ONLY unless --confirm.
 *
 *   npm run admin:load-forms -- --slug blue-heart --dir ~/secure/blue-heart-templates --maps ~/secure/blue-heart-maps.json
 *       [--read-missing [--referrer "Provider name" --referrer-type mlc]]   # files without a map: layout-rules reading
 *       [--replace-proposed]   # corrected maps/conversions: replace the clinic's unconfirmed, unused forms of these templates
 *       [--restore-maps]       # with --replace-proposed: the rollback – earlier maps exactly as they were (e.g. maps-v1)
 *       [--confirm] [--env preview|production] [--yes]
 *
 * --replace-proposed (10/2026): per file REPLACE (the clinic's form for this template is still a proposal, unchanged
 * since ClinForms loaded it and never used by a report – it is replaced by a fresh proposal from this file and map),
 * LOAD (no form for this template yet), SKIP (already this file and this map; or no map for a form made from one) or
 * REFUSED (with the reason – e.g. the form was confirmed or used, a second file for the same template, or the form
 * changed while it was being replaced: it is kept untouched). Two runs at the same time never duplicate a form.
 * Rules: src/server/admin/load-forms.ts.
 *
 * --maps: JSON – {"<file name>": {title, referrer: {name, type}, fields: [FormField…], file?: {sha256}}, …}, the same
 * under "maps", or a list of maps each naming file.fileName. A map is checked against its file (SHA-256 when given,
 * every anchor's place and placeholder) and refused when it does not fit. The clinic id must exist and be open.
 * Production needs --confirm --yes and Khuram's go. Prints file names and counts only – never template wording.
 *
 * bh2 WE design 1–2: every map is checked by the map lint before anything is written (printed as rule@field ids:
 * "lint L5@F-12"; accepted findings as "accepted L5@F-28"); a map from the maps file with a finding is refused unless its
 * question accepts that rule (lintAccepted, with the reason). With --confirm the clinic's own rows (members, invitations,
 * plan, package, usage, settings, reports) are compared before and after: any change exits non-zero.
 * --restore-maps (with --replace-proposed): the rollback – the earlier maps as they were; their lint findings are listed,
 * not refused, and a pin to an earlier converter's output is accepted when every anchor fits this conversion.
 */
import fs from "node:fs";
import { loadClinicForms, parseMapsJson, type LoadFormsFileResult, type MapsJson } from "../../src/server/admin/load-forms";
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
  replaceProposed: boolean;
  /** --restore-maps (only present when given). */
  restoreMaps?: boolean;
  referrer?: { name: string; type: ReturnType<typeof ReferrerTypeSchema.parse> };
}

/** The status word printed per file; --replace-proposed says what would happen (REPLACE / LOAD / SKIP / REFUSED). */
export function statusLabel(status: LoadFormsFileResult["status"], replaceMode: boolean): string {
  if (!replaceMode) return status.toUpperCase();
  return { ready: "LOAD", loaded: "LOADED", replace: "REPLACE", replaced: "REPLACED", skipped: "SKIP", refused: "REFUSED" }[status];
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
  if (flag(args, "restore-maps") && !flag(args, "replace-proposed")) throw new CliError("--restore-maps goes with --replace-proposed (it restores earlier maps over forms nobody has touched).");
  return {
    slug,
    dir: dir.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"),
    mapsPath: mapsPath ? mapsPath.replace(/^~(?=$|\/)/, process.env.HOME ?? "~") : null,
    readMissing,
    confirm: flag(args, "confirm"),
    replaceProposed: flag(args, "replace-proposed"),
    ...(flag(args, "restore-maps") ? { restoreMaps: true } : {}),
    ...(name ? { referrer: { name, type: ReferrerTypeSchema.parse(type ?? "other") } } : {}),
  };
}

/** The lint findings of one file, as rule@field ids (never the form's wording). */
export function lintLine(f: Pick<LoadFormsFileResult, "lint">): string {
  if (!f.lint) return "";
  const parts = [f.lint.errors.length ? `lint ${f.lint.errors.join(" ")}` : "", f.lint.accepted.length ? `accepted ${f.lint.accepted.join(" ")}` : ""].filter(Boolean);
  return parts.length ? ` [${parts.join("; ")}]` : "";
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
      {
        tenantId: a.slug,
        dir: a.dir,
        maps,
        readMissing: a.readMissing,
        confirm: a.confirm,
        replaceProposed: a.replaceProposed,
        restore: a.restoreMaps === true,
        ...(a.referrer ? { defaultReferrer: a.referrer } : {}),
      },
    );
    const where = target === "current" ? `the ${getDbKind()} database` : target;
    console.log(`${result.dryRun ? "PREVIEW – nothing stored." : "Stored."}${result.replaceProposed ? " Replace mode." : ""}${result.restore ? " Restoring earlier maps." : ""} Clinic ${result.tenantId} on ${where}:`);
    // Security fix 24/10/2026: file names come from the clinic – control characters (terminal escapes) are shown as "?".
    const safe = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
    for (const f of result.files) {
      const what = f.questions !== undefined ? `${f.questions} questions (${f.fromRecords ?? 0} from the record, ${f.forStaff ?? 0} for staff), ${f.mergeFields ?? 0} merge codes, map from ${f.mapFrom}` : "";
      const conv = f.convertedFromRtf ? ` RTF ${((f.rtfBytes ?? 0) / 1048576).toFixed(1)} MB → Word ${((f.sizeBytes ?? 0) / 1024).toFixed(0)} KB,` : "";
      const replaces = f.replaces?.length ? ` – replaces ${f.replaces.join(", ")}` : "";
      console.log(`  ${statusLabel(f.status, result.replaceProposed).padEnd(8)} ${safe(f.file)}${conv ? ` –${conv}` : ""} ${what}${replaces}${lintLine(f)}${f.reason ? ` – ${safe(f.reason)}` : ""}`);
    }
    const counts = (s: string) => result.files.filter((f) => f.status === s).length;
    if (result.replaceProposed) {
      console.log(
        result.dryRun
          ? `  replace ${counts("replace")} · load ${counts("ready")} · skip ${counts("skipped")} · refused ${counts("refused")}`
          : `  replaced ${counts("replaced")} · loaded ${counts("loaded")} · skipped ${counts("skipped")} · refused ${counts("refused")}`,
      );
    } else {
      console.log(`  ready ${counts("ready")} · loaded ${counts("loaded")} · skipped ${counts("skipped")} · refused ${counts("refused")}`);
    }
    if (result.dryRun) console.log("Run again with --confirm to store them (proposed maps: the clinic's staff confirm each one).");
    if (result.invariants) {
      if (result.invariants.ok) console.log("  The clinic's members, invitations, plan, package, usage, settings and reports: unchanged.");
      else {
        console.error(`  CHANGED during the run (the tool never writes them – check at once): ${result.invariants.changed.join(", ")}`);
        process.exitCode = 1;
      }
    }
  });
}
