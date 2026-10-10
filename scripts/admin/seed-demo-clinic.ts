/**
 * Seeds (or checks) the demonstration clinic "Riverside Physiotherapy (fictional)" (riverside-demo): fictional profile,
 * an EXISTING account as its owner, the prepared insurer form maps + files + portal question set (confirmed and
 * attested with the environment's signing secret), and the fictional patient Rebecca Lane's DRAFT reports.
 * Logic and rules: src/server/admin/demo-clinic.ts. Runbook: docs/auth.md §5 "Demonstration clinic".
 *
 *   npm run admin:seed-demo-clinic -- --env local|preview|production --owner-email <existing account> \
 *       --maps-dir <…/insurers/maps> --pdf-dir <…/insurers> [--drafts-dir <…/insurers/drafts>] \
 *       [--app-url <origin for the signing check>] [--write-notes <file>] [--refresh-reports] [--slug <id>] [--confirm --yes]
 *
 * Dry run by default (reads and checks only). Writing needs --confirm AND --yes. `--env local` = this shell's
 * environment on local SQLite only (CLINFORMS_DB unset or sqlite); preview / production take their values from
 * ~/.config/appstackx/clinforms.secrets.env (never printed), including MEDREPORT_SIGNING_SECRET, and first check that
 * this secret is the one the deployment signs with (public GET /forms/samples) – a map attested with another secret
 * would open as unconfirmed. Production writes are the owner's call (CLAUDE.md).
 *
 * Insurer files and maps are third-party material: they are read from the given folders (gitignored demo-assets) and
 * stored only in the clinic's encrypted library – never printed, never committed.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, getDbKind } from "../../src/server/db";
import { DataCipher, keyringFromEnv } from "../../src/server/crypto/envelope";
import { checkSigningSecret, seedDemoClinic, type SeedStep } from "../../src/server/admin/demo-clinic";
import { readSecretsFile } from "../db/provision-gateway-secrets";
import { CliError, applyTarget, flag, parseArgs, resolveTarget, runCli, str, type Target } from "./cli";
import { DEMO_NOTES_FILE_NAME, demoPatientNotesJson } from "./demo-patient-import";

const FORM_FILE = /\.(pdf|docx)$/i;

function readJsonFolder(dir: string): Array<{ name: string; data: unknown }> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new CliError(`Not a folder: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((name) => {
      try {
        return { name, data: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown };
      } catch {
        throw new CliError(`${name} in ${dir} is not valid JSON.`);
      }
    });
}

function readFormFiles(dir: string): Array<{ fileName: string; bytes: Uint8Array }> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new CliError(`Not a folder: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((n) => FORM_FILE.test(n) && fs.statSync(path.join(dir, n)).isFile())
    .sort()
    .map((fileName) => ({ fileName, bytes: new Uint8Array(fs.readFileSync(path.join(dir, fileName))) }));
}

const SYMBOL: Record<SeedStep["status"], string> = { create: "+", update: "~", keep: "=", delete: "-", refuse: "!" };

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const envArg = str(args, "env");
  if (!envArg) throw new CliError("--env local|preview|production is required.");
  const local = envArg === "local";
  const target: Target = local ? "current" : resolveTarget(args);
  if (local) {
    const kind = (process.env.CLINFORMS_DB ?? "sqlite").trim() || "sqlite";
    if (kind !== "sqlite") throw new CliError(`--env local runs on local SQLite only (CLINFORMS_DB is ${kind}). Use --env preview|production for those databases.`);
  } else {
    applyTarget(target);
    // The signing secret the deployment attests form maps with – never the public demo constant.
    const prefix = target === "preview" ? "PREVIEW_" : "PRODUCTION_";
    const secret = readSecretsFile().get(`${prefix}MEDREPORT_SIGNING_SECRET`);
    if (!secret) throw new CliError(`No ${prefix}MEDREPORT_SIGNING_SECRET in the secrets file: the maps could not be attested for ${target}.`);
    process.env.MEDREPORT_SIGNING_SECRET = secret;
  }
  if (!local && !process.env.MEDREPORT_SIGNING_SECRET) throw new CliError("MEDREPORT_SIGNING_SECRET is not set.");
  if (local && !process.env.MEDREPORT_SIGNING_SECRET) {
    console.log("Note: MEDREPORT_SIGNING_SECRET is not set here – maps are attested with the public demo constant, as a local server without it would.");
  }

  const ownerEmail = str(args, "owner-email", true) as string;
  const mapsDir = path.resolve(str(args, "maps-dir", true) as string);
  const pdfDir = path.resolve(str(args, "pdf-dir", true) as string);
  const draftsDir = path.resolve(str(args, "drafts-dir") ?? path.join(mapsDir, "..", "drafts"));
  const confirm = flag(args, "confirm");
  if (confirm && !flag(args, "yes")) throw new CliError("Writing needs --confirm AND --yes.");
  const writeNotes = str(args, "write-notes");
  const slug = str(args, "slug");

  const maps = readJsonFolder(mapsDir);
  const files = readFormFiles(pdfDir);
  const drafts = fs.existsSync(draftsDir) ? readJsonFolder(draftsDir) : [];
  const notes = { fileName: DEMO_NOTES_FILE_NAME, content: demoPatientNotesJson() };
  console.log(`Inputs: ${maps.length} form maps, ${files.length} form files, ${drafts.length} answer files, notes ${DEMO_NOTES_FILE_NAME} (fictional).`);

  if (writeNotes) {
    const out = path.resolve(writeNotes);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, notes.content);
    console.log(`Wrote the fictional patient's notes (documented JSON import format) to ${out}`);
  }

  // The signing secret must be the deployment's (read-only public request).
  const appUrl = str(args, "app-url") ?? (target === "production" ? "https://clinforms.co.uk" : undefined);
  if (appUrl) {
    const check = await checkSigningSecret(appUrl);
    console.log(`Signing check against ${new URL(appUrl).origin}: ${check.result.toUpperCase()}${check.result === "unknown" ? ` (${check.reason})` : ""}`);
    if (check.result === "mismatch") throw new CliError("This environment's MEDREPORT_SIGNING_SECRET is not the one the app signs with: nothing written.");
    if (check.result === "unknown" && !local && !flag(args, "skip-signing-check")) {
      throw new CliError("Could not confirm the signing secret against the app (add --skip-signing-check only if you are sure).");
    }
  } else if (!local) {
    throw new CliError("--app-url is required for preview (the origin of a deployment using the preview database), for the signing check.");
  }

  const cipher = new DataCipher(keyringFromEnv());
  const result = await seedDemoClinic(getDb(), cipher, {
    ownerEmail,
    maps,
    files,
    drafts,
    notes,
    confirm,
    refreshReports: flag(args, "refresh-reports"),
    ...(slug ? { clinic: { slug } } : {}),
  });

  const where = target === "current" ? `the local ${getDbKind()} database` : target.toUpperCase();
  console.log(`${result.dryRun ? "DRY RUN – nothing written" : "Written"} on ${where}: clinic ${result.tenantId}${result.organizationId ? ` (organization ${result.organizationId})` : ""}`);
  for (const s of result.steps) console.log(`  ${SYMBOL[s.status]} ${s.kind.padEnd(7)} ${s.label}${s.detail ? ` – ${s.detail}` : ""}`);
  if (result.dryRun) console.log("Run again with --confirm --yes to write.");
  else console.log("The owner signs in, switches to the clinic and opens the Studio: the reports are drafts for the clinician to review.");
});
