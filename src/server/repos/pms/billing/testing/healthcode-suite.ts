/**
 * TESTS ONLY: the Healthcode groundwork repository suite (../healthcode-repos.test.ts), run unchanged on node:sqlite
 * and PGlite. Fictional clinics and insurers only. Ends with the tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createReferrer } from "../../referrers";
import { createCase } from "../../cases";
import { createPatient } from "../../patients";
import { createDraftInvoice, getInvoice } from "../invoices";
import { unscopedStatements, type GuardedDb } from "../../testing/guarded-db";
import { runBatch } from "../../../../db/batch";
import { BILLING_CASCADE_DELETED_TABLES, HEALTHCODE_CASCADE_DELETED_TABLES } from "../../../../db/pms-schema/billing";
import { countPmsRows, deletePmsQueries } from "../../../../pms/offboard";
import { healthcodeForSite } from "../../../../../modules/pms/billing/healthcode";
import { createPractitioner, createService, createSite } from "../../directory";
import { billStatuses, caseDiagnoses, getHealthcodeSettings, setBillStatus, getPayerHealthcode, setCaseDiagnosis, setInvoiceDiagnosis, payerHealthcodes, practitionerInsurerNumbers, serviceCcsdCodes, serviceInsurerCodes, setPractitionerInsurerNumber, setServiceCcsdCode, setServiceInsurerCode, setClinicHealthcode, setPayerHealthcode, setSiteHealthcode } from "../healthcode";

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_admin_01", sessionId: "sess_01" };
const ACTOR_B = { userId: "user_other_clinic", sessionId: "sess_b" };

export function defineHealthcodeRepoSuite(label: string, factory: () => Promise<GuardedDb>): void {
  describe(`Healthcode repositories on ${label}`, () => {
    let suite: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date("2026-11-01T09:00:00.000Z") };
      id.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health Insurance (fictional)" }, ACTOR)).id;
      id.insurerB = (await createReferrer(ctx, B, { kind: "insurer", name: "Harbour Health (fictional)" }, ACTOR_B)).id;
      id.site1 = (await createSite(ctx, A, { name: "Bletchley (fictional)" }, ACTOR)).id;
      id.site2 = (await createSite(ctx, A, { name: "Towcester (fictional)" }, ACTOR)).id;
      id.prac = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01" }, ACTOR)).id;
      id.prac2 = (await createPractitioner(ctx, A, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02" }, ACTOR)).id;
      id.insurer2 = (await createReferrer(ctx, A, { kind: "insurer", name: "Meadowbank Health (fictional)" }, ACTOR)).id;
      id.ia = (await createService(ctx, A, { name: "Initial assessment", category: "initial", durationMinutes: 45 }, ACTOR)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up", category: "follow_up", durationMinutes: 30 }, ACTOR)).id;
      id.svcB = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30 }, ACTOR_B)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19" }, ACTOR)).id;
      id.case = (await createCase(ctx, A, { patientId: id.patient, title: "Lower back", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: id.insurer, membershipNumber: "NW-000123" }, ACTOR)).id;
      id.selfCase = (await createCase(ctx, A, { patientId: id.patient, title: "Knee", openedOn: "2026-10-01" }, ACTOR)).id;
      id.siteB = (await createSite(ctx, B, { name: "Harbour (fictional)" }, ACTOR_B)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("HC06 payer accounts: nothing set up reads as null; an audited upsert; clear a field; clinic B kept apart", async () => {
      assert.equal(await getPayerHealthcode(ctx, A, id.insurer), null);
      await setPayerHealthcode(ctx, A, id.insurer, { insurerCode: "nwh", providerNumber: "PRV-DEMO-001", diagnosisRequired: true }, ACTOR);
      let p = await getPayerHealthcode(ctx, A, id.insurer);
      assert.deepEqual([p?.rev, p?.insurerCode, p?.providerNumber, p?.diagnosisRequired], [1, "nwh", "PRV-DEMO-001", true]);
      await setPayerHealthcode(ctx, A, id.insurer, { insurerCode: "nwh", providerNumber: "", diagnosisRequired: null }, ACTOR);
      p = await getPayerHealthcode(ctx, A, id.insurer);
      assert.deepEqual([p?.rev, p?.providerNumber, p?.diagnosisRequired], [2, null, null]);
      const audit = (await listAudit(ctx, A, { limit: 20 })).filter((e) => e.action === "pms.payer_healthcode.set");
      assert.equal(audit.length, 2);
      assert.ok(!JSON.stringify(audit).includes("PRV-DEMO-001"), "the audit row never holds the number itself");
      // Clinic B: cannot write to A's payer account, sees none of A's rows.
      await assert.rejects(setPayerHealthcode(ctx, B, id.insurer, { insurerCode: "xx1" }, ACTOR_B), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await payerHealthcodes(ctx, B)).size, 0);
      await assert.rejects(setPayerHealthcode(ctx, A, id.insurer, { insurerCode: "not a code!" }, ACTOR), (e: unknown) => e instanceof RepoInputError);
    });

    it("HC07 Site ID and payee provider number: the clinic's, a site's own, blank = the clinic's again", async () => {
      const s0 = await getHealthcodeSettings(ctx, A);
      assert.deepEqual([s0.rev, s0.clinic.siteCode, Object.keys(s0.sites).length], [0, null, 0]);
      await setClinicHealthcode(ctx, A, { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1" }, ACTOR);
      await setSiteHealthcode(ctx, A, id.site2, { siteCode: "SITE-DEMO-2" }, ACTOR);
      let s = await getHealthcodeSettings(ctx, A);
      assert.equal(s.rev, 1);
      assert.deepEqual(healthcodeForSite(s, id.site1), { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1" });
      assert.deepEqual(healthcodeForSite(s, id.site2), { siteCode: "SITE-DEMO-2", payeeProviderNumber: "PAYEE-DEMO-1" });
      assert.deepEqual(healthcodeForSite(s, null), { siteCode: "SITE-DEMO-1", payeeProviderNumber: "PAYEE-DEMO-1" });
      await setSiteHealthcode(ctx, A, id.site2, { siteCode: "", payeeProviderNumber: "" }, ACTOR);
      s = await getHealthcodeSettings(ctx, A);
      assert.deepEqual(s.sites, {});
      // Another clinic's site is refused; clinic B sees nothing of A's.
      await assert.rejects(setSiteHealthcode(ctx, A, id.siteB, { siteCode: "X1" }, ACTOR), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await getHealthcodeSettings(ctx, B)).rev, 0);
      await assert.rejects(setClinicHealthcode(ctx, A, { siteCode: "bad code" }, ACTOR), (e: unknown) => e instanceof RepoInputError);
      const audit = await listAudit(ctx, A, { limit: 50 });
      assert.equal(audit.filter((e) => e.action === "pms.healthcode_settings.set").length, 1);
      assert.equal(audit.filter((e) => e.action === "pms.site_healthcode.set").length, 2);
    });

    it("HC08 practitioner numbers per insurer: set, change, clear; another clinic's practitioner refused", async () => {
      await setPractitionerInsurerNumber(ctx, A, id.prac, id.insurer, "NW-PRAC-DEMO-1", ACTOR);
      await setPractitionerInsurerNumber(ctx, A, id.prac, id.insurer2, "MB-DEMO-7", ACTOR);
      await setPractitionerInsurerNumber(ctx, A, id.prac2, id.insurer, "NW-PRAC-DEMO-2", ACTOR);
      await setPractitionerInsurerNumber(ctx, A, id.prac, id.insurer, "NW-PRAC-DEMO-1A", ACTOR);
      let all = await practitionerInsurerNumbers(ctx, A);
      assert.equal(all.size, 3);
      assert.equal(all.get(`${id.prac}|${id.insurer}`)?.providerNumber, "NW-PRAC-DEMO-1A");
      assert.equal((await practitionerInsurerNumbers(ctx, A, [id.prac2])).size, 1);
      await setPractitionerInsurerNumber(ctx, A, id.prac, id.insurer2, "", ACTOR);
      all = await practitionerInsurerNumbers(ctx, A);
      assert.equal(all.size, 2);
      await assert.rejects(setPractitionerInsurerNumber(ctx, B, id.prac, id.insurerB, "X1", ACTOR_B), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await practitionerInsurerNumbers(ctx, B)).size, 0);
      assert.equal((await listAudit(ctx, A, { limit: 100 })).filter((e) => e.action === "pms.practitioner_insurer_number.set").length, 5);
    });

    it("HC09 treatment codes: a CCSD code per service, an insurer code per service and insurer; clear removes", async () => {
      assert.equal((await serviceCcsdCodes(ctx, A)).size, 0);
      await setServiceCcsdCode(ctx, A, id.ia, "CCSD-DEMO-1", ACTOR);
      await setServiceCcsdCode(ctx, A, id.fu, "CCSD-DEMO-2", ACTOR);
      await setServiceCcsdCode(ctx, A, id.fu, null, ACTOR);
      assert.deepEqual(Array.from((await serviceCcsdCodes(ctx, A)).entries()), [[id.ia, "CCSD-DEMO-1"]]);
      await setServiceInsurerCode(ctx, A, id.ia, id.insurer, "ISC-DEMO-IA", ACTOR);
      await setServiceInsurerCode(ctx, A, id.fu, id.insurer, "ISC-DEMO-FU", ACTOR);
      await setServiceInsurerCode(ctx, A, id.fu, id.insurer2, "ISC-MB-FU", ACTOR);
      assert.equal((await serviceInsurerCodes(ctx, A)).size, 3);
      assert.equal((await serviceInsurerCodes(ctx, A, [id.insurer])).get(`${id.fu}|${id.insurer}`)?.iscCode, "ISC-DEMO-FU");
      await setServiceInsurerCode(ctx, A, id.fu, id.insurer2, " ", ACTOR);
      assert.equal((await serviceInsurerCodes(ctx, A)).size, 2);
      await assert.rejects(setServiceInsurerCode(ctx, A, id.svcB, id.insurer, "X1", ACTOR), (e: unknown) => e instanceof RepoInputError);
      await assert.rejects(setServiceCcsdCode(ctx, A, id.ia, "has space", ACTOR), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await serviceInsurerCodes(ctx, B)).size, 0);
    });

    it("HC10 diagnosis codes: a case's (encrypted, normalised) and an insurer invoice's own; a patient invoice refused", async () => {
      assert.equal((await caseDiagnoses(ctx, A, [id.case])).size, 0);
      assert.equal(await setCaseDiagnosis(ctx, A, id.case, "m545", ACTOR), "M54.5");
      assert.equal((await caseDiagnoses(ctx, A, [id.case, id.selfCase])).get(id.case), "M54.5");
      const raw = await ctx.db.selectFrom("pms_case_diagnosis").select("diagnosis_enc").where("tenant_id", "=", A).where("id", "=", id.case).executeTakeFirstOrThrow();
      assert.ok(raw.diagnosis_enc && !raw.diagnosis_enc.includes("M54"), "stored encrypted");
      await assert.rejects(setCaseDiagnosis(ctx, A, id.case, "back pain", ACTOR), (e: unknown) => e instanceof RepoInputError);
      await assert.rejects(setCaseDiagnosis(ctx, B, id.case, "M54.5", ACTOR_B), (e: unknown) => e instanceof RepoInputError);
      assert.equal((await caseDiagnoses(ctx, B, [id.case])).size, 0);
      assert.equal(await setCaseDiagnosis(ctx, A, id.case, "", ACTOR), null);
      assert.equal((await caseDiagnoses(ctx, A, [id.case])).size, 0);

      const { invoice } = await createDraftInvoice(ctx, A, { patientId: id.patient, caseId: id.case, billTo: "payer", lines: [{ kind: "item", description: "Follow-up (fictional)", unitPricePence: 4800 }] }, ACTOR);
      const r = await setInvoiceDiagnosis(ctx, A, invoice.id, "S934", ACTOR);
      assert.deepEqual(r, { ok: true, code: "S93.4" });
      const after1 = await getInvoice(ctx, A, invoice.id);
      assert.deepEqual([after1?.diagnosisCode, after1?.rev], ["S93.4", invoice.rev + 1]);
      assert.deepEqual(await setInvoiceDiagnosis(ctx, B, invoice.id, "S93.4", ACTOR_B), { ok: false, code: null });
      const { invoice: own } = await createDraftInvoice(ctx, A, { patientId: id.patient, caseId: id.selfCase, lines: [{ kind: "item", description: "Self-pay (fictional)", unitPricePence: 4800 }] }, ACTOR);
      assert.equal((await setInvoiceDiagnosis(ctx, A, own.id, "M54.5", ACTOR)).ok, false);
      const audit = await listAudit(ctx, A, { limit: 200 });
      assert.equal(audit.filter((e) => e.action === "pms.case_diagnosis.set").length, 2);
      assert.equal(audit.filter((e) => e.action === "pms.invoice.diagnosis_set").length, 1);
      assert.ok(!JSON.stringify(audit).includes("M54.5"), "no diagnosis in the audit trail");
      id.invoice = invoice.id;
    });

    it("HC13 bill status: set, change, clear – each change audited with the old and new status", async () => {
      assert.equal((await billStatuses(ctx, A, [id.invoice])).size, 0);
      await setBillStatus(ctx, A, id.invoice, "exported", ACTOR);
      await setBillStatus(ctx, A, id.invoice, "failed", ACTOR);
      assert.equal((await billStatuses(ctx, A, [id.invoice])).get(id.invoice), "failed");
      await setBillStatus(ctx, A, id.invoice, null, ACTOR);
      assert.equal((await billStatuses(ctx, A, [id.invoice])).size, 0);
      await assert.rejects(setBillStatus(ctx, A, id.invoice, "lost" as never, ACTOR), (e: unknown) => e instanceof RepoInputError);
      await assert.rejects(setBillStatus(ctx, B, id.invoice, "paid", ACTOR_B), (e: unknown) => e instanceof RepoInputError);
      const rows = (await listAudit(ctx, A, { limit: 200 })).filter((e) => e.action === "pms.invoice.bill_status");
      assert.deepEqual(rows.map((r) => r.detail).reverse(), [{ from: "none", to: "exported" }, { from: "exported", to: "failed" }, { from: "failed", to: "none" }]);
    });

    it("offboarding: the Healthcode rows go with their parents (ON DELETE CASCADE) – none is named, none is left", async () => {
      await setSiteHealthcode(ctx, A, id.site1, { siteCode: "SITE-DEMO-9" }, ACTOR);
      await setPractitionerInsurerNumber(ctx, A, id.prac, id.insurer2, "MB-DEMO-9", ACTOR);
      await setServiceCcsdCode(ctx, A, id.fu, "CCSD-DEMO-9", ACTOR);
      await setCaseDiagnosis(ctx, A, id.case, "M75.1", ACTOR);
      await setBillStatus(ctx, A, id.invoice, "paid", ACTOR);
      const before = await countPmsRows(suite.db, A);
      for (const t of HEALTHCODE_CASCADE_DELETED_TABLES) assert.ok((before[t] ?? 0) > 0, `${t} has rows to begin with`);
      const queries = deletePmsQueries(suite.db, A, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of BILLING_CASCADE_DELETED_TABLES) assert.ok(!named.some((sql) => sql.includes(`"${t}"`)), `${t} is not named`);
      await runBatch(suite.db, queries);
      const after = await countPmsRows(suite.db, A);
      assert.deepEqual(after, {}, "nothing of clinic A is left");
      assert.ok(Object.keys(await countPmsRows(suite.db, B)).length > 0, "clinic B untouched");
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
