/**
 * The Healthcode server layer (diagnosis codes HC10, the claims page's Healthcode tab HC12, Set-up cards HC06–HC09)
 * on node:sqlite and PGlite: permissions first, a whole-clinic rule for set-up, an issued insurer invoice moving from
 * "Needs review" to "Ready" as the clinic fills its set-up, one Site ID per file, the file button off, the export log
 * by batch. Fictional clinic, insurer and patient only. Run by `npm run test:db` and `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../db/testing/databases";
import type { RepoContext } from "../../repos/context";
import { createDraftInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { recordInvoiceExports } from "../../repos/pms/billing/exports";
import { createAuthorisation, createCase } from "../../repos/pms/cases";
import { createPractitioner, createService, createSite } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { createReferrer } from "../../repos/pms/referrers";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import type { SetupActor } from "../reporting/setup";
import { testActor } from "./access";
import { caseDiagnosisFor, healthcodeClaimsFor, invoiceHealthcodeFor, setCaseDiagnosisFor, setInvoiceDiagnosisFor } from "./healthcode";
import {
  healthcodeSettingsFor,
  insurerCodesFor,
  payerHealthcodeFor,
  practitionerInsurerNumbersFor,
  saveHealthcodeSettingsFor,
  saveInsurerCodesFor,
  savePayerHealthcodeFor,
  savePractitionerInsurerNumbersFor,
} from "./healthcode-setup";

const A = "riverside-hc";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`Healthcode server layer on ${label}`, () => {
    let db: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};
    let owner: ReturnType<typeof testActor>;
    let reception: ReturnType<typeof testActor>;
    let siteAdmin: ReturnType<typeof testActor>;
    const setup = (a: ReturnType<typeof testActor>) => ({ ...a, organizationId: `org_${A}` }) as unknown as SetupActor;

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date("2026-11-01T10:00:00.000Z") };
      owner = testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Olivia Owner (fictional)" });
      reception = testActor(ctx, A, "staff", { userId: "user_reception_01", name: "Rita Reception (fictional)" });
      id.site = (await createSite(ctx, A, { name: "Bletchley (fictional)" }, SEED)).id;
      id.site2 = (await createSite(ctx, A, { name: "Towcester (fictional)" }, SEED)).id;
      siteAdmin = testActor(ctx, A, "admin", { userId: "user_admin_02", name: "Sam Site (fictional)" }, { siteIds: [id.site] });
      id.prac = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01" }, SEED)).id;
      id.svc = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health (fictional)" }, SEED)).id;
      id.solicitor = (await createReferrer(ctx, A, { kind: "solicitor", name: "Harrow & Pike (fictional)" }, SEED)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19", postcode: "MK9 9ZZ" }, SEED)).id;
      id.case = (await createCase(ctx, A, { patientId: id.patient, title: "Lower back", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.insurer, membershipNumber: "NW-000123", siteId: id.site }, SEED)).id;
      id.auth = (await createAuthorisation(ctx, A, { caseId: id.case, referrerId: id.insurer, code: "NW-AUTH-0001", sessionsAuthorised: 6, validFrom: "2026-10-01", expiresOn: "2026-12-31" }, SEED)).id;
      const lines = [{ kind: "service" as const, serviceId: id.svc, practitionerId: id.prac, serviceOn: "2026-10-20", unitPricePence: 5500 }];
      const { invoice } = await createDraftInvoice(ctx, A, { patientId: id.patient, caseId: id.case, siteId: id.site, billTo: "payer", authorisationId: id.auth, lines }, SEED);
      const issued = await issueInvoice(ctx, A, invoice.id, invoice.rev, { issuedOn: "2026-10-28" }, SEED);
      assert.ok(issued.ok);
      id.invoice = invoice.id;
    });
    after(async () => {
      await db?.close();
    });

    it("HC10: diagnosis needs clinical.view; reception cannot read or set it; a bad code is refused in plain words", async () => {
      assert.equal((await caseDiagnosisFor(reception, id.patient, id.case)).ok, false);
      assert.equal((await setInvoiceDiagnosisFor(reception, id.invoice, "M54.5")).ok, false);
      const bad = await setCaseDiagnosisFor(owner, id.patient, id.case, "sore back");
      assert.ok(!bad.ok && /ICD-10/.test(bad.error));
      const set = await setCaseDiagnosisFor(owner, id.patient, id.case, "m545");
      assert.ok(set.ok && set.value.code === "M54.5");
      const read = await caseDiagnosisFor(owner, id.patient, id.case);
      assert.ok(read.ok && read.value.code === "M54.5" && read.value.canEdit);
      const panel = await invoiceHealthcodeFor(owner, id.invoice);
      assert.ok(panel.ok && panel.value && panel.value.caseDiagnosisCode === "M54.5" && panel.value.diagnosisCode === null && panel.value.canEditDiagnosis);
      const hidden = await invoiceHealthcodeFor(reception, id.invoice);
      assert.ok(hidden.ok && hidden.value && !hidden.value.showDiagnosis && hidden.value.caseDiagnosisCode === null);
      assert.equal((await caseDiagnosisFor(owner, id.patient, "case_nope")).ok, false);
    });

    it("HC12: the invoice needs review with plain reasons until the set-up is filled in, then it is ready", async () => {
      let v = await healthcodeClaimsFor(owner, { from: "2026-10-01", until: "2026-11-01" });
      assert.ok(v.ok);
      assert.deepEqual([v.value.ready.length, v.value.needsReview.length, v.value.fileEnabled], [0, 1, false]);
      assert.equal(v.value.fileNote, "Available once Healthcode file submission is switched on");
      const reasons = v.value.needsReview[0].issues.map((i) => i.message);
      assert.deepEqual(reasons, [
        "Add Northwell Health (fictional)'s Healthcode insurer identifier.",
        "Add the clinic's provider number with Northwell Health (fictional).",
        "Add the clinic's payee provider number.",
        "Add the clinic's Healthcode Site ID.",
        "Add Sarah Reid's provider number with Northwell Health (fictional).",
        "Add Northwell Health (fictional)'s treatment code for Follow-up.",
      ]);
      assert.equal(v.value.needsReview[0].patientName, "Daniel Brooks");

      // Set-up: whole clinic only; a referrer that is not an insurer has no Healthcode card.
      assert.equal((await savePayerHealthcodeFor(setup(siteAdmin), id.insurer, { insurerCode: "nwh" })).ok, false);
      assert.equal((await savePayerHealthcodeFor(setup(reception), id.insurer, { insurerCode: "nwh" })).ok, false);
      const solicitor = await payerHealthcodeFor(setup(owner), id.solicitor);
      assert.ok(solicitor.ok && solicitor.value === null);
      const badCode = await savePayerHealthcodeFor(setup(owner), id.insurer, { insurerCode: "n w h" });
      assert.ok(!badCode.ok && badCode.fieldErrors?.insurerCode);
      assert.ok((await savePayerHealthcodeFor(setup(owner), id.insurer, { insurerCode: "nwh", providerNumber: "PRV-DEMO-1", diagnosis: "default" })).ok);
      const card = await payerHealthcodeFor(setup(owner), id.insurer);
      assert.ok(card.ok && card.value?.details?.insurerCode === "nwh" && card.value.diagnosisDefault === false);
      assert.ok((await saveHealthcodeSettingsFor(setup(owner), { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1", sites: [{ siteId: id.site2, siteCode: "SITE-DEMO-2" }] })).ok);
      const settings = await healthcodeSettingsFor(setup(owner));
      assert.ok(settings.ok && settings.value.settings.sites[id.site2]?.siteCode === "SITE-DEMO-2" && settings.value.sites.length === 2);
      assert.equal((await saveHealthcodeSettingsFor(setup(owner), { sites: [{ siteId: "site_not_here", siteCode: "X1" }] })).ok, false);
      assert.ok((await savePractitionerInsurerNumbersFor(setup(owner), id.prac, [{ referrerId: id.insurer, providerNumber: "NW-PRAC-1" }])).ok);
      const nums = await practitionerInsurerNumbersFor(setup(owner), id.prac);
      assert.ok(nums.ok && nums.value?.insurers.length === 1 && nums.value.insurers[0].providerNumber === "NW-PRAC-1");
      assert.equal((await savePractitionerInsurerNumbersFor(setup(owner), id.prac, [{ referrerId: id.solicitor, providerNumber: "X1" }])).ok, false);
      assert.ok((await saveInsurerCodesFor(setup(owner), id.insurer, [{ serviceId: id.svc, iscCode: "ISC-DEMO-FU" }])).ok);
      const codes = await insurerCodesFor(setup(owner), id.insurer);
      assert.ok(codes.ok && codes.value.services[0].iscCode === "ISC-DEMO-FU");

      v = await healthcodeClaimsFor(owner, { from: "2026-10-01", until: "2026-11-01" });
      assert.ok(v.ok);
      assert.deepEqual([v.value.ready.length, v.value.needsReview.length, v.value.ready[0].siteCode, v.value.notes], [1, 0, "SITE-DEMO-1", []]);
      // A site-limited member of another site sees none of it; reception may look (billing.view).
      const other = testActor(ctx, A, "admin", { userId: "user_admin_03", name: "Tess (fictional)" }, { siteIds: [id.site2] });
      const otherView = await healthcodeClaimsFor(other, { from: "2026-10-01", until: "2026-11-01" });
      assert.ok(otherView.ok && otherView.value.ready.length === 0 && otherView.value.needsReview.length === 0);
      assert.ok((await healthcodeClaimsFor(reception, { from: "2026-10-01", until: "2026-11-01" })).ok);
      assert.equal((await healthcodeClaimsFor(owner, { from: "2026-11-01", until: "2026-10-01" })).ok, false);
    });

    it("HC12: the export log lists batches with their reference", async () => {
      const { batchRef } = await recordInvoiceExports(ctx, A, [id.invoice], "csv", SEED);
      const v = await healthcodeClaimsFor(owner, { from: "2026-10-01", until: "2026-11-01" });
      assert.ok(v.ok);
      assert.deepEqual(v.value.batches.map((b) => [b.batchRef, b.channelLabel, b.invoices]), [[batchRef, "Claims file (CSV)", 1]]);
      assert.match(v.value.batches[0].createdAt, /^2026-11-01T10:00:00/);
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(db.log.statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
