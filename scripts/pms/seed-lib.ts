/**
 * Loads the demonstration clinic's clinic-system data (scripts/pms/demo-data.ts) into an existing clinic, through
 * the repositories (validation, encryption, audit). Used by scripts/pms/seed-demo.ts and its test.
 *
 * Safety (contract §9): the clinic must be flagged as a demonstration clinic (pms_settings.is_demo) – or be
 * flaggable: its name ends "(fictional)" and it holds no patients, reports or forms yet – and must hold no
 * clinic-system patients (a second run is refused; locally `fresh` clears the clinic's clinic-system rows first).
 * `resume` (any database, also a server): a clinic whose clinic data was loaded completely (the audit row
 * "pms.demo.seed" for the clinic) is left as it is, so the module seeds (each idempotent) can finish a run that stopped
 * part-way. Nothing is deleted. A clinic with patients but no such row (stopped inside this step) is still refused.
 */
import type { Kysely } from "kysely";
import { ukToday } from "../../src/modules/pms/core/text";
import { PLATFORM_USER_ID } from "../../src/server/auth/create-auth";
import type { DataCipher } from "../../src/server/crypto/envelope";
import { runBatch } from "../../src/server/db/batch";
import type { Database } from "../../src/server/db/schema";
import { appendAudit } from "../../src/server/repos/audit";
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { bulkCreateAuthorisations, bulkCreateCases, type BulkAuthorisationInput } from "../../src/server/repos/pms/cases";
import { createPractitioner, createRoom, createService, createSite } from "../../src/server/repos/pms/directory";
import { setEntitlement } from "../../src/server/repos/pms/entitlements";
import { bulkCreatePatients, countPatients, touchPatientLastSeen } from "../../src/server/repos/pms/patients";
import { createPriceList, setPriceListItem } from "../../src/server/repos/pms/price-lists";
import { createReferrer } from "../../src/server/repos/pms/referrers";
import { getPmsSettings, setPmsDemoFlag } from "../../src/server/repos/pms/settings";
import { deletePmsQueries } from "../../src/server/pms/offboard";
import type { CaseInput } from "../../src/modules/pms/core/schemas";
import { PRACTITIONERS, PRICE_LISTS, REFERRERS, SERVICES, SITES, demoPatients } from "./demo-data";
import { pmsNow } from "../../src/modules/pms/core/clock";

export const SEED_ACTOR = { userId: PLATFORM_USER_ID, sessionId: null };

export interface SeedOptions {
  tenantId: string;
  /** Flag the clinic as a demonstration clinic first (only an empty clinic whose name ends "(fictional)"). */
  markDemo?: boolean;
  /** LOCAL ONLY: remove the clinic's clinic-system rows before seeding (the caller checks it is a local database). */
  fresh?: boolean;
  /** Leave a completely loaded clinic as it is (a second run then only finishes the module seeds). */
  resume?: boolean;
  patients?: number;
  seed?: number;
  now?: Date;
  log?: (line: string) => void;
}

export interface SeedSummary {
  tenantId: string;
  sites: number;
  rooms: number;
  practitioners: number;
  services: number;
  referrers: number;
  priceLists: number;
  patients: number;
  cases: number;
  authorisations: number;
}

async function count(db: Kysely<Database>, table: "reports" | "forms" | "pms_patients", tenantId: string): Promise<number> {
  const row = await db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tenantId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Checks the clinic may receive demonstration data (and flags it when asked and allowed). */
export async function assertDemoClinic(db: Kysely<Database>, tenantId: string, options: { markDemo?: boolean } = {}): Promise<{ name: string }> {
  const org = await db.selectFrom("organization").select(["name", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${tenantId}".`);
  if (org.metadata && /"offboardedAt"/.test(org.metadata)) throw new RepoInputError(`The clinic "${tenantId}" is closed.`);
  const settings = await getPmsSettings({ db }, tenantId);
  if (settings.isDemo) return { name: org.name };
  if (!options.markDemo) {
    throw new RepoInputError(`"${tenantId}" is not flagged as a demonstration clinic. Add --mark-demo (only for an empty clinic whose name ends "(fictional)").`);
  }
  if (!/\(fictional\)$/.test(org.name.trim())) throw new RepoInputError(`Refused: the clinic's name "${org.name}" does not end "(fictional)".`);
  const [patients, reports, forms] = await Promise.all([count(db, "pms_patients", tenantId), count(db, "reports", tenantId), count(db, "forms", tenantId)]);
  if (patients + reports + forms > 0) throw new RepoInputError("Refused: the clinic already holds data, so it cannot be flagged as a demonstration clinic.");
  await setPmsDemoFlag({ db }, tenantId, true, SEED_ACTOR);
  return { name: org.name };
}

export async function seedDemoClinic(ctx: RepoContext, options: SeedOptions): Promise<SeedSummary> {
  const { tenantId } = options;
  const log = options.log ?? (() => undefined);
  const db = ctx.db;
  const now = options.now ?? pmsNow();
  const today = ukToday(now);
  await assertDemoClinic(db, tenantId, { markDemo: options.markDemo });
  if (options.fresh) {
    // Keep the demo flag and the packages; everything else of the clinic system goes.
    const queries = deletePmsQueries(db, tenantId, { keep: ["pms_settings", "clinic_entitlements", "clinic_usage_counters"] });
    await runBatch(db, queries);
    log("Cleared the clinic's earlier demonstration data.");
  }
  if (options.fresh && options.resume) throw new RepoInputError("Choose either fresh or resume.");
  if ((await countPatients(ctx, tenantId, "any")) > 0) {
    if (options.resume) {
      const loaded = await db
        .selectFrom("audit_log")
        .select("detail_json")
        .where("tenant_id", "=", tenantId)
        .where("action", "=", "pms.demo.seed")
        .where("target_id", "=", tenantId)
        .orderBy("at", "desc")
        .limit(1)
        .executeTakeFirst();
      if (!loaded) throw new RepoInputError(`"${tenantId}" has clinic-system patients but its demonstration data was not loaded completely: it cannot be resumed.`);
      const d = JSON.parse(loaded.detail_json ?? "{}") as Partial<Omit<SeedSummary, "tenantId">>;
      log("Clinic data: loaded already – resuming with the module data.");
      return {
        tenantId,
        sites: Number(d.sites ?? 0),
        rooms: Number(d.rooms ?? 0),
        practitioners: Number(d.practitioners ?? 0),
        services: Number(d.services ?? 0),
        referrers: Number(d.referrers ?? 0),
        priceLists: Number(d.priceLists ?? 0),
        patients: Number(d.patients ?? 0),
        cases: Number(d.cases ?? 0),
        authorisations: Number(d.authorisations ?? 0),
      };
    }
    throw new RepoInputError(`"${tenantId}" already has clinic-system patients. Run again with --resume to finish the module data, or locally with --fresh to replace the demonstration data.`);
  }
  await setEntitlement(ctx, tenantId, "clinic", { status: "trial", priceSource: "design_partner", note: "Demonstration clinic (fictional data)" }, SEED_ACTOR);

  const siteIds: Record<string, string> = {};
  let rooms = 0;
  for (const s of SITES) {
    const { key, rooms: roomNames, ...input } = s;
    siteIds[key] = (await createSite(ctx, tenantId, input, SEED_ACTOR)).id;
    for (let i = 0; i < roomNames.length; i++) {
      await createRoom(ctx, tenantId, { siteId: siteIds[key], name: roomNames[i], sortOrder: i + 1 }, SEED_ACTOR);
      rooms++;
    }
  }
  const practitionerIds: string[] = [];
  for (const p of PRACTITIONERS) {
    const { site, ...input } = p;
    practitionerIds.push((await createPractitioner(ctx, tenantId, { ...input, defaultSiteId: siteIds[site] }, SEED_ACTOR)).id);
  }
  const serviceIds: Record<string, string> = {};
  for (const s of SERVICES) {
    const { key, ...input } = s;
    serviceIds[key] = (await createService(ctx, tenantId, input, SEED_ACTOR)).id;
  }
  const referrerIds: Record<string, string> = {};
  for (const r of REFERRERS) {
    const { key, prefix: _prefix, ...input } = r;
    void _prefix;
    referrerIds[key] = (await createReferrer(ctx, tenantId, input, SEED_ACTOR)).id;
  }
  const priceListIds: Record<string, string> = {};
  for (const pl of PRICE_LISTS) {
    const list = await createPriceList(ctx, tenantId, { name: pl.name, payerType: pl.payerType, referrerId: pl.referrer ? referrerIds[pl.referrer] : null, isDefault: pl.isDefault ?? false, validFrom: "2026-01-01", validTo: "2026-12-31" }, SEED_ACTOR);
    priceListIds[pl.key] = list.id;
    for (const [serviceKey, [pricePence, billingCode]] of Object.entries(pl.prices)) {
      await setPriceListItem(ctx, tenantId, { priceListId: list.id, serviceId: serviceIds[serviceKey], pricePence, billingCode: billingCode ?? null }, SEED_ACTOR);
    }
  }
  log(`Directory: ${SITES.length} sites, ${rooms} rooms, ${PRACTITIONERS.length} practitioners, ${SERVICES.length} appointment types, ${REFERRERS.length} referrers and payers, ${PRICE_LISTS.length} price lists.`);

  const people = demoPatients(options.patients ?? 200, options.seed ?? 2026, today);
  const created = await bulkCreatePatients(ctx, tenantId, people.map((p) => p.patient), SEED_ACTOR, { source: "demo-seed" });
  const patientIds = created.ids;
  log(`Patients: ${patientIds.length} (numbers ${created.firstNumber}–${created.lastNumber}).`);

  const caseInputs: CaseInput[] = [];
  const caseOwners: { patient: number; case: number }[] = [];
  people.forEach((person, pi) => {
    person.cases.forEach((c, ci) => {
      const { practitioner, site, payer, referrer, priceList, authorisation: _a, ...rest } = c;
      void _a;
      caseInputs.push({
        ...rest,
        patientId: patientIds[pi],
        practitionerId: practitionerIds[practitioner],
        siteId: siteIds[site],
        payerReferrerId: payer ? referrerIds[payer] : null,
        referrerId: referrer ? referrerIds[referrer] : null,
        priceListId: priceList ? priceListIds[priceList] : null,
      });
      caseOwners.push({ patient: pi, case: ci });
    });
  });
  const caseIds = await bulkCreateCases(ctx, tenantId, caseInputs, SEED_ACTOR, { source: "demo-seed" });
  const auths: BulkAuthorisationInput[] = [];
  caseOwners.forEach((owner, k) => {
    const a = people[owner.patient].cases[owner.case].authorisation;
    if (!a) return;
    const { issuer, sessionsUsed, ...rest } = a;
    auths.push({ ...rest, caseId: caseIds[k], patientId: patientIds[owner.patient], referrerId: issuer ? referrerIds[issuer] : null, sessionsUsed });
  });
  const authIds = await bulkCreateAuthorisations(ctx, tenantId, auths, SEED_ACTOR, { source: "demo-seed" });
  log(`Cases: ${caseIds.length}; treatment authorisations: ${authIds.length}.`);

  // "Last seen": the latest case activity (a derived column the diary keeps up to date later).
  for (let pi = 0; pi < people.length; pi++) {
    const latest = people[pi].cases
      .map((c) => (c.status === "open" ? c.openedOn : (c.closedOn ?? c.openedOn)))
      .sort()
      .pop();
    if (latest) await touchPatientLastSeen(ctx, tenantId, patientIds[pi], latest > today ? today : latest);
  }

  const summary: SeedSummary = {
    tenantId,
    sites: SITES.length,
    rooms,
    practitioners: PRACTITIONERS.length,
    services: SERVICES.length,
    referrers: REFERRERS.length,
    priceLists: PRICE_LISTS.length,
    patients: patientIds.length,
    cases: caseIds.length,
    authorisations: authIds.length,
  };
  const { tenantId: _t, ...counts } = summary;
  void _t;
  await appendAudit(ctx, tenantId, { userId: SEED_ACTOR.userId, action: "pms.demo.seed", targetType: "pms_settings", targetId: tenantId, detail: counts });
  return summary;
}
