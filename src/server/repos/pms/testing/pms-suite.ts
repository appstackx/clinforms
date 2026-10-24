/**
 * TESTS ONLY: the foundation's repository suite (packages, settings, directory, shared patient record), run
 * unchanged on node:sqlite, PGlite (src/server/repos/pms/pms-repos.test.ts) and D1 through the gateway
 * (workers/data-gateway/test/stack.test.ts). When the factory gives a query log, the suite ends with the
 * tenant-scope guard (every clinic-system statement names tenant_id).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import { listAudit } from "../../audit";
import { RepoInputError, type RepoContext } from "../../context";
import {
  bulkCreateAuthorisations,
  bulkCreateCases,
  countCases,
  createAuthorisation,
  createCase,
  getAuthorisation,
  getCase,
  listAuthorisations,
  listCasesForPatient,
  listExpiringAuthorisations,
  recordAuthorisationUsage,
  updateAuthorisation,
  updateCase,
} from "../cases";
import {
  createPractitioner,
  createRoom,
  createService,
  createSite,
  findPractitionerByUser,
  getSite,
  listPractitioners,
  listRooms,
  listServices,
  listSites,
  updatePractitioner,
  updateRoom,
  updateService,
  updateSite,
} from "../directory";
import { getEntitlement, getUsage, incrementUsage, isPackageOn, listEntitlements, listEntitlementsByTenant, setEntitlement } from "../entitlements";
import {
  bulkCreatePatients,
  countPatients,
  createPatient,
  getPatient,
  getPatientSummaries,
  searchPatients,
  setPatientLegalHold,
  setPatientStatus,
  touchPatientLastSeen,
  updatePatient,
} from "../patients";
import { createPriceList, listPriceListItems, priceFor, removePriceListItem, setPriceListItem, updatePriceList } from "../price-lists";
import { createReferrer, getReferrer, listReferrers, updateReferrer } from "../referrers";
import { getPmsSettings, setDemoClinic, updatePmsSettings } from "../settings";
import type { QueryLog } from "./guarded-db";
import { unscopedStatements } from "./guarded-db";

export interface PmsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  /** When given, the suite checks every recorded clinic-system statement names tenant_id. */
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_reception_01", sessionId: "sess_01" };
const ACTOR_B = { userId: "user_other_clinic", sessionId: "sess_b" };

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

export function definePmsRepoSuite(label: string, factory: () => Promise<PmsSuiteDb>): void {
  describe(`clinic-system repositories on ${label}`, () => {
    let suite: PmsSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-24T09:00:00.000Z");
    const tick = (ms = 1000) => {
      clock += ms;
    };
    const ids: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
    });
    after(async () => {
      await suite?.close();
    });

    it("packages: no row = reports on, clinic off; switching writes the row and an audit entry", async () => {
      assert.equal(await isPackageOn(ctx, A, "reports"), true);
      assert.equal(await isPackageOn(ctx, A, "clinic"), false);
      const on = await setEntitlement(ctx, A, "clinic", { status: "trial", priceSource: "design_partner", note: "Demo (fictional)" }, ACTOR);
      assert.deepEqual([on.wasOn, on.isOn], [false, true]);
      assert.equal(await isPackageOn(ctx, A, "clinic"), true);
      assert.equal(await isPackageOn(ctx, B, "clinic"), false, "another clinic is unaffected");
      tick();
      const paused = await setEntitlement(ctx, A, "clinic", { status: "paused" }, ACTOR);
      assert.deepEqual([paused.wasOn, paused.isOn], [true, false]);
      tick();
      await setEntitlement(ctx, A, "clinic", { status: "active", endsAt: new Date(clock - 1000).toISOString() }, ACTOR);
      assert.equal(await isPackageOn(ctx, A, "clinic"), false, "an end in the past switches it off");
      await setEntitlement(ctx, A, "clinic", { status: "active" }, ACTOR);
      assert.equal(await isPackageOn(ctx, A, "clinic"), true);
      const row = await getEntitlement(ctx, A, "clinic");
      assert.equal(row?.status, "active");
      assert.equal(row?.endsAt, null);
      assert.equal(row?.updatedBy, ACTOR.userId);
      await setEntitlement(ctx, A, "reports", { status: "cancelled" }, ACTOR);
      assert.equal(await isPackageOn(ctx, A, "reports"), false);
      await setEntitlement(ctx, A, "reports", { status: "active" }, ACTOR);
      assert.deepEqual((await listEntitlements(ctx, A)).map((e) => e.package), ["clinic", "reports"]);
      const audit = await listAudit(ctx, A, { action: "clinic.package_change" });
      assert.equal(audit.length, 6);
      assert.deepEqual(audit[audit.length - 1].detail, { package: "clinic", status: "trial", from: "default_off", on: true });
      await rejects(setEntitlement(ctx, A, "clinic", { status: "on" as never }, ACTOR), /Status/);
      await rejects(setEntitlement(ctx, A, "nope" as never, { status: "active" }, ACTOR), /Unknown package/);
      suite.log?.pause(); // the platform page's one cross-clinic read
      const all = await listEntitlementsByTenant(ctx);
      suite.log?.resume();
      assert.equal(all.get(A)?.length, 2);
    });

    it("usage counters add up per clinic, month and metric", async () => {
      assert.equal(await incrementUsage(ctx, A, "forms_completed"), 1);
      assert.equal(await incrementUsage(ctx, A, "forms_completed", 4), 5);
      assert.equal(await incrementUsage(ctx, B, "forms_completed"), 1);
      assert.deepEqual(await getUsage(ctx, A, "2026-10"), { forms_completed: 5 });
      await rejects(incrementUsage(ctx, A, "Bad Metric"), /lower_snake_case/);
    });

    it("settings: defaults, an update within the limits, the demo flag", async () => {
      assert.deepEqual((({ retentionAdultYears, retentionChildUntilAge, isDemo }) => ({ retentionAdultYears, retentionChildUntilAge, isDemo }))(await getPmsSettings(ctx, A)), {
        retentionAdultYears: 8,
        retentionChildUntilAge: 25,
        isDemo: false,
      });
      const s = await updatePmsSettings(ctx, A, { retentionAdultYears: 10 }, ACTOR);
      assert.equal(s.retentionAdultYears, 10);
      assert.equal(s.retentionChildUntilAge, 25);
      await rejects(updatePmsSettings(ctx, A, { retentionAdultYears: 5 }, ACTOR), /retentionAdultYears/);
      assert.equal((await setDemoClinic(ctx, A, true, ACTOR)).isDemo, true);
      assert.equal((await getPmsSettings(ctx, A)).retentionAdultYears, 10, "the demo flag keeps the other settings");
      assert.equal((await getPmsSettings(ctx, B)).isDemo, false);
    });

    it("directory: sites, rooms, practitioners and services – scoped per clinic, never pointing across clinics", async () => {
      const site = await createSite(ctx, A, { name: "Bletchley (fictional)", code: "ble", postcode: "mk39zz", phone: "01632 960001" }, ACTOR);
      assert.equal(site.code, "BLE");
      assert.equal(site.postcode, "MK3 9ZZ");
      ids.site = site.id;
      await rejects(createSite(ctx, A, { name: "Bletchley (fictional)" }, ACTOR), /already exists/);
      const siteB = await createSite(ctx, B, { name: "Bletchley (fictional)" }, ACTOR_B);
      assert.ok(siteB.id, "the same name in another clinic is fine");
      ids.siteB = siteB.id;
      assert.equal(await getSite(ctx, B, site.id), null, "another clinic cannot read it");
      const room = await createRoom(ctx, A, { siteId: site.id, name: "Room 1" }, ACTOR);
      ids.room = room.id;
      await rejects(createRoom(ctx, B, { siteId: site.id, name: "Room 1" }, ACTOR_B), /site does not exist/);
      assert.equal((await updateRoom(ctx, A, room.id, { name: "Treatment room 1" }, ACTOR))?.name, "Treatment room 1");
      assert.equal(await updateRoom(ctx, B, room.id, { name: "x" }, ACTOR_B), null, "another clinic cannot change it");
      assert.equal((await updateSite(ctx, A, site.id, { active: false }, ACTOR))?.active, false);
      assert.equal((await listSites(ctx, A)).length, 0);
      assert.equal((await listSites(ctx, A, { includeInactive: true })).length, 1);
      await updateSite(ctx, A, site.id, { active: true }, ACTOR);
      assert.equal((await listRooms(ctx, A, { siteId: site.id })).length, 1);

      const prac = await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "ph-demo-01", userId: "user_sarah", defaultSiteId: site.id, colour: "#0D9488" }, ACTOR);
      assert.equal(prac.registrationNumber, "PH-DEMO-01");
      assert.equal(prac.profession, "physiotherapist");
      ids.prac = prac.id;
      assert.equal((await findPractitionerByUser(ctx, A, "user_sarah"))?.id, prac.id);
      assert.equal(await findPractitionerByUser(ctx, B, "user_sarah"), null);
      await rejects(createPractitioner(ctx, A, { displayName: "Twin", userId: "user_sarah" }, ACTOR), /already linked/);
      await rejects(createPractitioner(ctx, B, { displayName: "Cross", defaultSiteId: site.id }, ACTOR_B), /site does not exist/);
      assert.equal((await updatePractitioner(ctx, A, prac.id, { onlineBookable: true }, ACTOR))?.onlineBookable, true);
      assert.equal((await listPractitioners(ctx, A, { bookableOnly: true })).length, 1);

      const ia = await createService(ctx, A, { name: "Initial assessment", category: "initial", durationMinutes: 45, defaultPricePence: 6500 }, ACTOR);
      const fu = await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5000, onlineBookable: true }, ACTOR);
      ids.ia = ia.id;
      ids.fu = fu.id;
      await rejects(createService(ctx, A, { name: "Odd", durationMinutes: 33 }, ACTOR), /steps of 5/);
      assert.equal((await updateService(ctx, A, fu.id, { durationMinutes: 40 }, ACTOR))?.durationMinutes, 40);
      assert.deepEqual((await listServices(ctx, A, { onlineOnly: true })).map((s) => s.id), [fu.id]);
      assert.equal((await listServices(ctx, B)).length, 0);
    });

    it("referrers: notes encrypted at rest, revisions refuse stale edits, search by name", async () => {
      const ins = await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health Insurance (fictional)", phone: "01632 960100", notes: "Invoices monthly to the claims team" }, ACTOR);
      ids.insurer = ins.id;
      assert.equal(ins.notes, "Invoices monthly to the claims team");
      const raw = await ctx.db.selectFrom("pms_referrers").select("notes_enc").where("tenant_id", "=", A).where("id", "=", ins.id).executeTakeFirstOrThrow();
      assert.ok(raw.notes_enc?.startsWith("v1."), "ciphertext");
      assert.ok(!String(raw.notes_enc).includes("claims"), "no plaintext in the row");
      const mlc = await createReferrer(ctx, A, { kind: "mlc", name: "Meridian Medical Reporting (fictional)" }, ACTOR);
      ids.mlc = mlc.id;
      assert.deepEqual((await listReferrers(ctx, A, { q: "northwell" })).map((r) => r.id), [ins.id]);
      assert.equal((await listReferrers(ctx, A, { kind: "mlc" }))[0].notes, null, "lists never decrypt");
      const saved = await updateReferrer(ctx, A, ins.id, 1, { contactName: "Claims team" }, ACTOR);
      assert.deepEqual(saved.ok ? saved.rev : saved, 2);
      assert.deepEqual(await updateReferrer(ctx, A, ins.id, 1, { name: "Stale" }, ACTOR), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await updateReferrer(ctx, B, ins.id, 2, { name: "Other clinic" }, ACTOR_B), { ok: false, reason: "not_found" });
      assert.equal((await getReferrer(ctx, A, ins.id))?.contactName, "Claims team");
      assert.deepEqual((await listReferrers(ctx, A, { q: "claims" })).map((r) => r.id), [ins.id], "the contact name is searchable");
      assert.equal(await getReferrer(ctx, B, ins.id), null);
    });

    it("price lists: a payer's own list, then the default list, then the service's own price", async () => {
      const selfPay = await createPriceList(ctx, A, { name: "Self-pay 2026", payerType: "self_pay", isDefault: true }, ACTOR);
      const insurer = await createPriceList(ctx, A, { name: "Northwell 2026", payerType: "insurer", referrerId: ids.insurer }, ACTOR);
      ids.insurerList = insurer.id;
      await rejects(createPriceList(ctx, B, { name: "Cross", referrerId: ids.insurer }, ACTOR_B), /payer does not exist/);
      await rejects(createPriceList(ctx, A, { name: "Bad dates", validFrom: "2026-12-01", validTo: "2026-01-01" }, ACTOR), /end date/);
      await setPriceListItem(ctx, A, { priceListId: selfPay.id, serviceId: ids.fu, pricePence: 5200 }, ACTOR);
      const item = await setPriceListItem(ctx, A, { priceListId: insurer.id, serviceId: ids.fu, pricePence: 4800, billingCode: "fu-01" }, ACTOR);
      assert.equal(item.billingCode, "FU-01");
      const again = await setPriceListItem(ctx, A, { priceListId: insurer.id, serviceId: ids.fu, pricePence: 4900 }, ACTOR);
      assert.equal(again.id, item.id, "setting a price again replaces it");
      assert.deepEqual(await priceFor(ctx, A, ids.fu, insurer.id), { pricePence: 4900, source: "list" });
      assert.deepEqual(await priceFor(ctx, A, ids.fu, null), { pricePence: 5200, source: "default_list" });
      assert.deepEqual(await priceFor(ctx, A, ids.ia, insurer.id), { pricePence: 6500, source: "service" });
      await rejects(priceFor(ctx, B, ids.fu, null), /does not exist/);
      await rejects(setPriceListItem(ctx, B, { priceListId: insurer.id, serviceId: ids.fu, pricePence: 1 }, ACTOR_B), /does not exist/);
      assert.equal(await removePriceListItem(ctx, A, insurer.id, ids.fu, ACTOR), true);
      assert.equal((await listPriceListItems(ctx, A, insurer.id)).length, 0);
      assert.equal((await updatePriceList(ctx, A, insurer.id, { active: false }, ACTOR))?.active, false);
    });

    it("patients: numbers per clinic, plain demographics, encrypted alerts bound to their row", async () => {
      tick();
      const megan = await createPatient(
        ctx,
        A,
        {
          title: "Ms",
          firstName: "Megan",
          lastName: "Hart",
          dateOfBirth: "1991-11-22",
          sex: "female",
          phoneMobile: "07700 900123",
          email: "Megan.Hart@example.com",
          postcode: "mk3 9zz",
          consentTreatment: true,
          alerts: "Latex allergy",
          importRef: "sim-pat-001",
        },
        ACTOR,
      );
      ids.megan = megan.id;
      assert.equal(megan.patientNumber, 1);
      assert.equal(megan.email, "megan.hart@example.com");
      assert.equal(megan.postcode, "MK3 9ZZ");
      assert.equal(megan.alerts, "Latex allergy");
      assert.equal(megan.consentTreatmentAt, new Date(clock).toISOString());
      assert.equal(megan.reminderSms, true, "service reminders are on by default");
      assert.equal(megan.marketingEmail, false, "marketing is never pre-ticked");
      const daniel = await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19", phoneMobile: "+44 7700 900456" }, ACTOR);
      ids.daniel = daniel.id;
      assert.equal(daniel.patientNumber, 2);
      const other = await createPatient(ctx, B, { firstName: "Megan", lastName: "Hart" }, ACTOR_B);
      assert.equal(other.patientNumber, 1, "each clinic counts from 1");
      await rejects(createPatient(ctx, A, { firstName: "Dup", lastName: "Ref", importRef: "sim-pat-001" }, ACTOR), /import reference/);
      await rejects(createPatient(ctx, A, { firstName: "Future", lastName: "Baby", dateOfBirth: "2030-01-01" }, ACTOR), /date of birth/);
      await rejects(createPatient(ctx, A, { firstName: "No", lastName: "Source", marketingEmail: true }, ACTOR), /marketing/);
      await rejects(createPatient(ctx, A, { firstName: "Bad", lastName: "Phone", phoneMobile: "12" }, ACTOR), /phone/);

      const raw = await ctx.db.selectFrom("pms_patients").select(["alerts_enc", "search_name", "search_phone"]).where("tenant_id", "=", A).where("id", "=", megan.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.alerts_enc).includes("Latex"));
      assert.equal(raw.search_name, "megan hart");
      assert.equal(raw.search_phone, "07700900123");
      // A ciphertext moved to another patient's row no longer decrypts (AAD = clinic, table.column, row id).
      await ctx.db.updateTable("pms_patients").set({ notes_enc: raw.alerts_enc }).where("tenant_id", "=", A).where("id", "=", daniel.id).execute();
      await assert.rejects(getPatient(ctx, A, daniel.id), /Decryption failed/);
      await ctx.db.updateTable("pms_patients").set({ notes_enc: null }).where("tenant_id", "=", A).where("id", "=", daniel.id).execute();
      assert.equal(await getPatient(ctx, B, megan.id), null, "another clinic cannot read it");

      assert.deepEqual((await searchPatients(ctx, A, { q: "hart" })).map((p) => p.id), [megan.id]);
      assert.deepEqual((await searchPatients(ctx, A, { q: "MEG ha" })).map((p) => p.id), [megan.id]);
      assert.deepEqual((await searchPatients(ctx, A, { q: "22/11/1991" })).map((p) => p.id), [megan.id]);
      assert.deepEqual((await searchPatients(ctx, A, { q: "2" })).map((p) => p.id), [daniel.id], "patient number");
      assert.deepEqual((await searchPatients(ctx, A, { q: "07700 900456" })).map((p) => p.id), [daniel.id], "phone, +44 or 0");
      assert.deepEqual((await searchPatients(ctx, A, { q: "megan.hart@example.com" })).map((p) => p.id), [megan.id]);
      assert.equal((await searchPatients(ctx, A)).length, 2);
      assert.equal((await searchPatients(ctx, A))[0].hasAlerts, false, "Brooks first (by last name)");
      assert.equal((await getPatientSummaries(ctx, A, [megan.id, daniel.id, other.id])).size, 2, "summaries never cross clinics");
    });

    it("patients: revision-checked updates, consent times, archive, hold, last seen – never deleted", async () => {
      tick();
      const r1 = await updatePatient(ctx, A, ids.megan, 1, { phoneMobile: "07700 900124", preferredName: "Meg", marketingEmail: true, marketingConsentSource: "written" }, ACTOR);
      assert.ok(r1.ok);
      assert.deepEqual(await updatePatient(ctx, A, ids.megan, 1, { firstName: "Stale" }, ACTOR), { ok: false, reason: "conflict", currentRev: 2 });
      const p = await getPatient(ctx, A, ids.megan);
      assert.equal(p?.preferredName, "Meg");
      assert.equal(p?.marketingEmail, true);
      assert.equal(p?.marketingConsentSource, "written");
      assert.equal(p?.marketingConsentAt, new Date(clock).toISOString());
      assert.deepEqual((await searchPatients(ctx, A, { q: "meg" })).map((x) => x.id), [ids.megan], "preferred name searchable");
      assert.deepEqual((await searchPatients(ctx, A, { q: "07700900124" })).map((x) => x.id), [ids.megan]);
      tick();
      const r2 = await updatePatient(ctx, A, ids.megan, 2, { marketingEmail: false, alerts: null, consentTreatment: false }, ACTOR);
      assert.ok(r2.ok);
      const q = await getPatient(ctx, A, ids.megan);
      assert.equal(q?.marketingConsentAt, null, "withdrawn: the consent time goes");
      assert.equal(q?.marketingConsentSource, null);
      assert.equal(q?.alerts, null);
      assert.equal(q?.consentTreatmentAt, null);
      assert.deepEqual(await updatePatient(ctx, B, ids.megan, 3, { firstName: "X" }, ACTOR_B), { ok: false, reason: "not_found" });

      assert.equal(await setPatientStatus(ctx, A, ids.daniel, "archived", ACTOR), true);
      assert.equal(await setPatientStatus(ctx, A, ids.daniel, "archived", ACTOR), false, "no change, no audit row");
      assert.equal(await countPatients(ctx, A), 1);
      assert.equal(await countPatients(ctx, A, "any"), 2);
      assert.deepEqual((await searchPatients(ctx, A, { q: "brooks", status: "archived" })).map((x) => x.id), [ids.daniel]);
      assert.equal(await setPatientStatus(ctx, A, ids.daniel, "active", ACTOR), true);
      assert.equal(await setPatientLegalHold(ctx, A, ids.megan, true, ACTOR), true);
      assert.equal((await getPatient(ctx, A, ids.megan))?.legalHold, true);
      await touchPatientLastSeen(ctx, A, ids.megan, "2026-10-20");
      await touchPatientLastSeen(ctx, A, ids.megan, "2026-10-01");
      assert.equal((await getPatient(ctx, A, ids.megan))?.lastSeenOn, "2026-10-20", "never moves backwards");
      const labels = (await listAudit(ctx, A, { limit: 500 })).map((e) => e.action);
      for (const a of ["pms.patient.create", "pms.patient.update", "pms.patient.status", "pms.patient.legal_hold"]) assert.ok(labels.includes(a), a);
      assert.equal(labels.filter((a) => a === "pms.patient.status").length, 2);
    });

    it("patients in bulk: one audit row per batch, numbers continue", async () => {
      const inputs = Array.from({ length: 45 }, (_, i) => ({ firstName: `Bulk${i}`, lastName: "Patient (fictional)", importRef: `bulk-${i}` }));
      const result = await bulkCreatePatients(ctx, A, inputs, ACTOR, { source: "test" });
      assert.equal(result.ids.length, 45);
      assert.deepEqual([result.firstNumber, result.lastNumber], [3, 47]);
      const audit = await listAudit(ctx, A, { action: "pms.patient.bulk_create" });
      assert.deepEqual(audit.map((a) => a.detail?.count).sort(), [40, 5]);
      await rejects(bulkCreatePatients(ctx, A, [{ firstName: "Again", lastName: "Dup", importRef: "bulk-0" }], ACTOR), /import reference/);
      assert.equal(await countPatients(ctx, A), 47);
    });

    it("cases: a payer per case, closing dates, the patient's cases", async () => {
      tick();
      const c = await createCase(
        ctx,
        A,
        {
          patientId: ids.megan,
          title: "Neck pain after a road traffic accident",
          openedOn: "2026-03-18",
          practitionerId: ids.prac,
          siteId: ids.site,
          payerType: "mlc",
          payerReferrerId: ids.mlc,
          claimReference: "MMR/2291",
          injuryOn: "2026-03-12",
          referralReason: "Assessment and treatment after a rear-end collision",
        },
        ACTOR,
      );
      ids.case = c.id;
      assert.equal(c.referralReason, "Assessment and treatment after a rear-end collision");
      assert.equal(c.status, "open");
      const raw = await ctx.db.selectFrom("pms_cases").select("referral_reason_enc").where("tenant_id", "=", A).where("id", "=", c.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.referral_reason_enc).includes("collision"));
      await rejects(createCase(ctx, B, { patientId: ids.megan, title: "Cross", openedOn: "2026-10-01" }, ACTOR_B), /does not exist in this clinic/);
      await rejects(createCase(ctx, A, { patientId: ids.megan, title: "Bad", openedOn: "2026-10-01", payerReferrerId: "ref_unknown" }, ACTOR), /does not exist/);
      await rejects(createCase(ctx, A, { patientId: ids.megan, title: "Bad", openedOn: "2026-10-02", closedOn: "2026-10-01" }, ACTOR), /close before/);
      const ins = await createCase(ctx, A, { patientId: ids.daniel, title: "Lower back", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: ids.insurer, membershipNumber: "NW-000123", excessPence: 10000, priceListId: ids.insurerList }, ACTOR);
      ids.insCase = ins.id;
      const closed = await updateCase(ctx, A, ids.case, 1, { status: "discharged" }, ACTOR);
      assert.ok(closed.ok);
      assert.equal((await getCase(ctx, A, ids.case))?.closedOn, "2026-10-24", "closing without a date closes it today (UK)");
      const reopened = await updateCase(ctx, A, ids.case, 2, { status: "open" }, ACTOR);
      assert.ok(reopened.ok);
      assert.equal((await getCase(ctx, A, ids.case))?.closedOn, null);
      assert.deepEqual(await updateCase(ctx, A, ids.case, 1, { title: "Stale" }, ACTOR), { ok: false, reason: "conflict", currentRev: 3 });
      await rejects(updateCase(ctx, A, ids.case, 3, { closedOn: "2026-01-01" }, ACTOR), /close before/);
      assert.deepEqual((await listCasesForPatient(ctx, A, ids.megan)).map((x) => x.id), [ids.case]);
      assert.equal((await listCasesForPatient(ctx, B, ids.megan)).length, 0);
      assert.equal(await countCases(ctx, A), 2);
      const more = await bulkCreateCases(ctx, A, [{ patientId: ids.megan, title: "Right knee", openedOn: "2026-09-01", status: "closed", closedOn: "2026-09-30" }], ACTOR);
      assert.equal(more.length, 1);
      assert.equal(await countCases(ctx, A, "closed"), 1);
    });

    it("authorisations: sessions and value, never over the limit or below zero, tied to one case of one patient", async () => {
      const auth = await createAuthorisation(ctx, A, { caseId: ids.insCase, referrerId: ids.insurer, code: "NW-AUTH-0001", sessionsAuthorised: 2, valueAuthorisedPence: 10000, expiresOn: "2026-11-01", notes: "Phone authorisation" }, ACTOR);
      ids.auth = auth.id;
      assert.equal(auth.patientId, ids.daniel, "the patient comes from the case");
      assert.equal(auth.notes, "Phone authorisation");
      await rejects(createAuthorisation(ctx, A, { caseId: ids.insCase, code: "NW-AUTH-0001" }, ACTOR), /already has an authorisation/);
      await rejects(createAuthorisation(ctx, B, { caseId: ids.insCase, code: "X" }, ACTOR_B), /case does not exist/);
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: 1, valuePence: 4900 }, ACTOR, "appt_test_1"), { ok: true, sessionsUsed: 1, valueUsedPence: 4900 });
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: 1, valuePence: 5200 }, ACTOR), { ok: false, reason: "over_limit" }, "value");
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: 1, valuePence: 5100 }, ACTOR), { ok: true, sessionsUsed: 2, valueUsedPence: 10000 });
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: 1 }, ACTOR), { ok: false, reason: "over_limit" }, "sessions");
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: -3 }, ACTOR), { ok: false, reason: "over_limit" }, "below zero");
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: -1, valuePence: -5100 }, ACTOR), { ok: true, sessionsUsed: 1, valueUsedPence: 4900 });
      assert.deepEqual(await recordAuthorisationUsage(ctx, B, auth.id, { sessions: 1 }, ACTOR_B), { ok: false, reason: "not_found" });
      const cancelled = await updateAuthorisation(ctx, A, auth.id, (await getAuthorisation(ctx, A, auth.id))?.rev ?? 0, { status: "cancelled" }, ACTOR);
      assert.ok(cancelled.ok);
      assert.deepEqual(await recordAuthorisationUsage(ctx, A, auth.id, { sessions: 1 }, ACTOR), { ok: false, reason: "not_active" });
      // The database refuses an authorisation whose patient is not the case's patient.
      await assert.rejects(
        ctx.db
          .insertInto("pms_authorisations")
          .values({ tenant_id: A, id: "auth_mismatch", rev: 1, case_id: ids.insCase, patient_id: ids.megan, code: "X", created_at: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString() })
          .execute(),
      );
      const bulk = await bulkCreateAuthorisations(ctx, A, [{ caseId: ids.case, patientId: ids.megan, code: "MMR-1", sessionsAuthorised: 6, expiresOn: "2026-10-30" }], ACTOR);
      assert.equal(bulk.length, 1);
      assert.deepEqual((await listAuthorisations(ctx, A, { patientId: ids.daniel })).map((a) => a.id), [ids.auth]);
      assert.deepEqual((await listExpiringAuthorisations(ctx, A, { until: "2026-11-30" })).map((a) => a.code), ["MMR-1"], "cancelled ones are left out");
      assert.deepEqual((await listExpiringAuthorisations(ctx, A, { from: "2026-10-31", until: "2026-11-30" })).length, 0, "already expired by then");
    });

    it("every write was audited under its own clinic (ids and counts only)", async () => {
      const a = await listAudit(ctx, A, { limit: 500 });
      const codes = new Set(a.map((e) => e.action));
      for (const code of [
        "pms.site.create",
        "pms.site.update",
        "pms.room.create",
        "pms.room.update",
        "pms.practitioner.create",
        "pms.practitioner.update",
        "pms.service.create",
        "pms.service.update",
        "pms.referrer.create",
        "pms.referrer.update",
        "pms.price_list.create",
        "pms.price_list.update",
        "pms.price_list_item.set",
        "pms.price_list_item.remove",
        "pms.case.create",
        "pms.case.update",
        "pms.case.bulk_create",
        "pms.authorisation.create",
        "pms.authorisation.update",
        "pms.authorisation.usage",
        "pms.authorisation.bulk_create",
        "pms.settings.update",
      ]) {
        assert.ok(codes.has(code), code);
      }
      const text = JSON.stringify(a);
      for (const secret of ["Latex", "Megan", "Hart", "collision", "claims team", "Phone authorisation"]) assert.ok(!text.includes(secret), secret);
      assert.ok(a.every((e) => e.userId === ACTOR.userId));
      const b = await listAudit(ctx, B, { limit: 500 });
      assert.ok(b.every((e) => e.userId === ACTOR_B.userId), "the other clinic's trail holds only its own writes");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 100, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
      assert.ok(unscopedStatements(['select * from "pms_patients" where "id" = ?']).length === 1, "the guard itself catches a missing tenant");
      assert.ok(unscopedStatements(['insert into "pms_sites" ("id", "name") values (?, ?)']).length === 1);
    });
  });
}
