/**
 * Demonstration data for the clinic system: "Riverside Physiotherapy (fictional)" – 3 sites, 6 rooms,
 * 8 practitioners, appointment types and price lists, referrers and payers, 200 fictional patients with cases,
 * payers and treatment authorisations (scripts/pms/demo-data.ts), then the diary week (seed-diary.ts) and clinical
 * records (seed-records.ts). Switches the clinic's "clinic" package on.
 *
 * LOCAL (default: the current environment, e.g. node --env-file=.env.local → local SQLite; or a Postgres on this
 * machine – loopback DATABASE_URL with DATABASE_SSL=disable, e.g. the Docker test database – see isLoopbackPostgres):
 *   npm run pms:seed-demo                        # creates the clinic if missing (owner invitation link printed once)
 *   npm run pms:seed-demo -- --fresh             # replace the clinic's demonstration data (local databases only)
 *   npm run pms:seed-demo -- --resume            # finish a run that stopped part-way (any database; adds only what is missing)
 *   options: --slug riverside-demo --name "Riverside Physiotherapy (fictional)" --owner-email … --app-url http://localhost:3180
 *            --patients 200 --seed 2026
 *
 * SERVER DATABASES (refused unless every condition holds – contract §9):
 *   --env preview     needs --confirm; the clinic must exist and be a demonstration clinic
 *   --env production  needs --confirm --yes (and Khuram's go); the clinic must exist and be a demonstration clinic
 *   --mark-demo       flags an EMPTY clinic whose name ends "(fictional)" as a demonstration clinic first
 *   --resume          the clinic data loaded completely before (audit "pms.demo.seed"): keep it and finish the module
 *                     data (set-up, diary, records, billing, messages, portal, integration – each adds only what is
 *                     missing). Never deletes; --fresh stays local-only (clinical records are never cleared on a server).
 * Without --confirm on a server database it only checks and says what it would do.
 */
import { DEMO_CLINIC } from "./demo-data";
import { assertDemoClinic, seedDemoClinic } from "./seed-lib";
import { seedDemoModules } from "./seed-modules";
import { createClinic } from "../../src/server/auth/platform";
import { getDataCipher } from "../../src/server/crypto";
import { getDb, getDbKind } from "../../src/server/db";
import { CliError, applyTarget, brandAppUrl, flag, isLoopbackPostgres, parseArgs, requireYesForProduction, resolveTarget, runCli, str } from "../admin/cli";
import { pmsNow } from "../../src/modules/pms/core/clock";

void runCli(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  applyTarget(target);
  const slug = str(args, "slug") ?? DEMO_CLINIC.slug;
  const confirm = flag(args, "confirm");
  const fresh = flag(args, "fresh");
  const markDemo = flag(args, "mark-demo");
  const resume = flag(args, "resume");
  if (fresh && resume) throw new CliError("Choose either --fresh or --resume.");
  const patients = Number(str(args, "patients") ?? 200);
  const seed = Number(str(args, "seed") ?? 2026);
  if (!Number.isInteger(patients) || patients < 2 || patients > 2000) throw new CliError("--patients must be 2–2000.");
  if (!Number.isInteger(seed)) throw new CliError("--seed must be a whole number.");
  const local = target === "current" && (getDbKind() === "sqlite" || (getDbKind() === "postgres" && isLoopbackPostgres(process.env)));
  if (fresh && !local) throw new CliError("--fresh is for a local database only (local SQLite, or a Postgres on this machine with DATABASE_SSL=disable): clinical records are never cleared on a server.");
  if (target === "current" && !local) throw new CliError("Without --env this script only writes to a local database (SQLite, or a loopback Postgres with DATABASE_SSL=disable). Use --env preview|production for a server database.");
  if (!local) {
    if (target === "production") requireYesForProduction(target, args, "Loading demonstration data");
    const db = getDb();
    if (!confirm) {
      // Check only: the clinic exists and is (or may be flagged as) a demonstration clinic.
      const org = await db.selectFrom("organization").select("name").where("slug", "=", slug).executeTakeFirst();
      if (!org) throw new CliError(`No clinic "${slug}" on ${target}: create it first (npm run admin:create-clinic).`);
      console.log(`CHECK ONLY – nothing changed. ${org.name} (${slug}) on ${target}.`);
      console.log(`Run again with --confirm${target === "production" ? " --yes" : ""}${markDemo ? " --mark-demo" : ""}${resume ? " --resume" : ""} to ${resume ? "finish loading the" : `load ${patients}`} fictional ${resume ? "demonstration data" : "patients"}.`);
      return;
    }
  }
  const db = getDb();
  const existing = await db.selectFrom("organization").select("id").where("slug", "=", slug).executeTakeFirst();
  if (!existing) {
    if (!local) throw new CliError(`No clinic "${slug}" on ${target}: create it first (npm run admin:create-clinic).`);
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || secret.length < 32) throw new CliError("Set BETTER_AUTH_SECRET (32+ characters) in .env.local first: the owner's invitation link is signed with it.");
    // The demo clinic gets the clinic package: its owner's link goes to the clinic brand's host when this app serves
    // one (CLINFORMS_AUTH_ORIGINS, docs/auth.md "Two brand hosts"), else to the app's own origin as before.
    const link = brandAppUrl(target, args, "clinic", { ...process.env, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? "3180"}` });
    const created = await createClinic(db, {
      name: str(args, "name") ?? DEMO_CLINIC.name,
      slug,
      ownerEmail: str(args, "owner-email") ?? DEMO_CLINIC.ownerEmail,
      appOrigin: link.origin,
      brand: link.brand,
      linkSecret: secret,
    });
    console.log(`Created the clinic ${slug}. Owner invitation (shown once, expires ${created.invitationExpiresAt}):`);
    console.log(`  ${created.inviteLink}`);
    await assertDemoClinic(db, slug, { markDemo: true });
  }
  const summary = await seedDemoClinic(
    { db, cipher: getDataCipher(), now: pmsNow },
    { tenantId: slug, markDemo: markDemo || local, fresh, resume, patients, seed, log: (line) => console.log(`  ${line}`) },
  );
  // Module demonstration data (contract §9): set-up, the diary, clinical records for the seeded cases, billing,
  // messages, the portal and integration (scripts/pms/seed-modules.ts) – each adds only what is missing.
  await seedDemoModules({ db, cipher: getDataCipher(), now: pmsNow }, slug, { log: (line) => console.log(`  ${line}`) });
  console.log(`Done: ${summary.patients} patients, ${summary.cases} cases, ${summary.authorisations} authorisations in ${slug} (fictional data). The clinic system is on for this clinic.`);
});
