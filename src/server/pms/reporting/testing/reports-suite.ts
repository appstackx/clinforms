/**
 * TESTS ONLY: the reports' server layer (src/server/pms/reporting/service.ts and today.ts) with the diary's and
 * billing's real reporting sources, run unchanged on node:sqlite and PGlite (../reports-service.test.ts) and on D1
 * through the gateway (workers/data-gateway/test/pms-reporting-stack.test.ts).
 *
 * FACT CHECKS: a small fictional clinic is seeded with known rows – appointments in every status (incl. in
 * treatment = arrived + treatment_started_at, a past booking not recorded, one still to come, blocked time, a
 * cancellation) over two sites, a rota and a closure, cases opened / closed, authorisations, issued / void / draft
 * invoices, credit notes, payments, a refund and a reversed payment – and every report's figures must equal the
 * values worked out by hand below (and billing's own aged debt). A member limited to site A must see nothing of
 * site B; a clinician with "own caseload" sees their own practitioner only; reception has no reports; CSV needs
 * "Export data" and is audited. Ends with the tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import { agedDebt as billingAgedDebt } from "../../../../modules/pms/billing/aging";
import { listAudit } from "../../../repos/audit";
import type { RepoContext } from "../../../repos/context";
import { debtInvoices } from "../../../repos/pms/billing/reports";
import { createAuthorisation, createCase } from "../../../repos/pms/cases";
import { createAvailability } from "../../../repos/pms/diary/availability";
import { bulkCreateDiaryItems } from "../../../repos/pms/diary/appointments";
import { createPractitioner, createRoom, createService, createSite } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { createReferrer } from "../../../repos/pms/referrers";
import { addClosure } from "../../../repos/pms/reporting/opening-hours";
import type { QueryLog } from "../../../repos/pms/testing/guarded-db";
import { unscopedStatements } from "../../../repos/pms/testing/guarded-db";
import { testActor } from "../../records/access";
import { reportCsvFor, reportPageFor, type ReportView } from "../service";
import { attendanceToday, authorisationsEndingSoon, utilisationTodayBySite } from "../today";

export interface ReportsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-rep";
const B = "harbour-rep";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };
const DAY = "2026-10-26"; // a Monday (GMT – the clocks went back on 25/10/2026)
const NOW = new Date(`${DAY}T11:45:00.000Z`);
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;
const plus = (hhmm: string, minutes: number) => {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + minutes;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** A stat card's value. */
function stat(view: ReportView, id: string): string {
  const s = view.stats.find((x) => x.id === id);
  assert.ok(s, `stat ${id}`);
  return s.value;
}
/** A table's rows as cells. */
function rows(view: ReportView, table: string): string[][] {
  const t = view.tables.find((x) => x.id === table);
  assert.ok(t, `table ${table}`);
  return t.rows.map((r) => r.cells);
}

export function defineReportsServiceSuite(label: string, factory: () => Promise<ReportsSuiteDb>): void {
  describe(`reports server layer (M8) on ${label}`, () => {
    let suite: ReportsSuiteDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};
    const opts = { now: NOW };
    const owner = () => testActor(ctx, A, "owner", { userId: "user_owner_01", name: "Helen Ward" });
    const adminSiteA = (exceptions: Record<string, boolean> = {}) => testActor(ctx, A, "admin", { userId: "user_admin_01", name: "Sam Admin" }, { siteIds: [id.s1], exceptions });
    const clinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_01", name: "Priya Shah" });
    const unlinkedClinician = () => testActor(ctx, A, "clinician", { userId: "user_clin_09", name: "Nobody Linked" });
    const reception = () => testActor(ctx, A, "staff", { userId: "user_recep_01", name: "Jess Taylor" });
    const page = async (actor: ReturnType<typeof owner>, report: Parameters<typeof reportPageFor>[1], q: Record<string, string> = {}) => {
      const r = await reportPageFor(actor, report, q, opts);
      if (!r.ok) assert.fail(`${report}: ${r.error}`);
      return r.value.view;
    };
    let seq = 0;

    async function invoice(o: { id: string; site: string; patient: string; billTo: "patient" | "payer"; payerType: string; referrer?: string; issuedOn: string; dueOn: string; total: number; paid?: number; credited?: number; voided?: boolean; status?: "issued" | "draft" }) {
      const issued = (o.status ?? "issued") === "issued";
      await suite.db
        .insertInto("pms_invoices")
        .values({
          tenant_id: A,
          id: o.id,
          rev: 1,
          status: o.status ?? "issued",
          number_prefix: issued ? "INV" : null,
          number_seq: issued ? ++seq : null,
          patient_id: o.patient,
          bill_to: o.billTo,
          payer_type: o.payerType,
          payer_referrer_id: o.referrer ?? null,
          issued_on: issued ? o.issuedOn : null,
          due_on: issued ? o.dueOn : null,
          net_pence: o.total,
          vat_pence: 0,
          total_pence: o.total,
          paid_pence: o.paid ?? 0,
          credited_pence: o.credited ?? 0,
          prices_include_vat: 1,
          site_id: o.site,
          voided_at: o.voided ? at(o.issuedOn, "12:00") : null,
          created_at: at(o.issuedOn, "09:00"),
          updated_at: at(o.issuedOn, "09:00"),
        } as never)
        .execute();
    }
    async function creditNote(cid: string, invoiceId: string, kind: string, issuedOn: string, total: number) {
      await suite.db
        .insertInto("pms_credit_notes")
        .values({ tenant_id: A, id: cid, invoice_id: invoiceId, number_prefix: "CN", number_seq: ++seq, issued_on: issuedOn, net_pence: total, vat_pence: 0, total_pence: total, kind, created_at: at(issuedOn, "10:00"), updated_at: at(issuedOn, "10:00") } as never)
        .execute();
    }
    async function payment(pid: string, o: { site: string; patient?: string; referrer?: string; kind?: "payment" | "refund"; status?: "recorded" | "reversed"; on: string; amount: number }) {
      await suite.db
        .insertInto("pms_payments")
        .values({
          tenant_id: A,
          id: pid,
          kind: o.kind ?? "payment",
          status: o.status ?? "recorded",
          payer_kind: o.referrer ? "account" : "patient",
          patient_id: o.referrer ? null : (o.patient ?? null),
          payer_referrer_id: o.referrer ?? null,
          received_on: o.on,
          method: "card",
          amount_pence: o.amount,
          allocated_pence: 0,
          provider: "manual",
          reversed_at: o.status === "reversed" ? at(o.on, "12:00") : null,
          site_id: o.site,
          created_at: at(o.on, "09:00"),
          updated_at: at(o.on, "09:00"),
        } as never)
        .execute();
    }

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => NOW };
      id.s1 = (await createSite(ctx, A, { name: "Harbour Road (fictional)", code: "HAR" }, SEED)).id;
      id.s2 = (await createSite(ctx, A, { name: "Mill Lane (fictional)", code: "MIL" }, SEED)).id;
      id.r1 = (await createRoom(ctx, A, { siteId: id.s1, name: "Room 1" }, SEED)).id;
      id.r2 = (await createRoom(ctx, A, { siteId: id.s2, name: "Room 1" }, SEED)).id;
      id.p1 = (await createPractitioner(ctx, A, { displayName: "Priya Shah", registrationNumber: "PH-DEMO-01", defaultSiteId: id.s1, userId: "user_clin_01" }, SEED)).id;
      id.p2 = (await createPractitioner(ctx, A, { displayName: "Tom Hughes", registrationNumber: "PH-DEMO-02", defaultSiteId: id.s2 }, SEED)).id;
      id.fu = (await createService(ctx, A, { name: "Follow-up 30 min", code: "FU", category: "follow_up", durationMinutes: 30, defaultPricePence: 5500 }, SEED)).id;
      id.ia = (await createService(ctx, A, { name: "Initial assessment 45 min", code: "IA", category: "assessment", durationMinutes: 45, defaultPricePence: 7500 }, SEED)).id;
      id.ins1 = (await createReferrer(ctx, A, { kind: "insurer", name: "Bluewell Health (fictional)" }, SEED)).id;
      id.ins2 = (await createReferrer(ctx, A, { kind: "insurer", name: "Shieldcare Insurance (fictional)" }, SEED)).id;
      id.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart" }, SEED)).id;
      id.liam = (await createPatient(ctx, A, { firstName: "Liam", lastName: "O'Connor" }, SEED)).id;
      id.sarah = (await createPatient(ctx, A, { firstName: "Sarah", lastName: "Quinn" }, SEED)).id;

      // Rota: Priya at Harbour Road Mondays 09:00–13:00 (240 min), Tom at Mill Lane Mondays 09:00–12:00 (180 min).
      // Mill Lane is closed on Monday 12/10 (Set-up closure): the rota time that day does not count.
      await createAvailability(ctx, A, { practitionerId: id.p1, siteId: id.s1, roomId: id.r1, weekday: 1, startTime: "09:00", endTime: "13:00", validFrom: "2026-09-01" }, SEED);
      await createAvailability(ctx, A, { practitionerId: id.p2, siteId: id.s2, roomId: id.r2, weekday: 1, startTime: "09:00", endTime: "12:00", validFrom: "2026-09-01" }, SEED);
      await addClosure(ctx, A, { siteId: id.s2, startsOn: "2026-10-12", reason: "Staff training" }, SEED);

      // The diary (bulk, with their statuses – as an import would).
      const appt = (o: { site: string; prac: string; room: string; patient: string; date?: string; start: string; minutes?: number; status: string; service?: string }) => ({
        kind: "appointment" as const,
        siteId: o.site,
        practitionerId: o.prac,
        roomId: o.room,
        patientId: o.patient,
        serviceId: o.service ?? id.fu,
        startsAt: at(o.date ?? DAY, o.start),
        endsAt: at(o.date ?? DAY, plus(o.start, o.minutes ?? 30)),
        status: o.status as "booked",
        source: "staff" as const,
      });
      const s1 = { site: id.s1, prac: id.p1, room: id.r1, patient: id.megan };
      const s2 = { site: id.s2, prac: id.p2, room: id.r2, patient: id.liam };
      const ids = await bulkCreateDiaryItems(
        ctx,
        A,
        [
          appt({ ...s1, start: "09:00", status: "attended" }),
          appt({ ...s1, start: "09:30", status: "dna" }),
          appt({ ...s1, start: "10:00", status: "late_cancelled" }),
          appt({ ...s1, start: "10:30", status: "cancelled" }),
          appt({ ...s1, start: "11:00", status: "arrived" }), // in treatment (below)
          appt({ ...s1, start: "11:30", status: "booked" }), // past, not recorded
          appt({ ...s1, start: "12:00", status: "booked" }), // still to come
          appt({ ...s1, date: "2026-10-19", start: "09:00", status: "attended" }),
          appt({ ...s2, start: "09:00", minutes: 45, status: "attended", service: id.ia }),
          appt({ ...s2, start: "09:45", status: "dna" }),
          { kind: "block" as const, siteId: id.s1, practitionerId: id.p1, startsAt: at(DAY, "12:30"), endsAt: at(DAY, "13:00"), status: "booked" as const, blockKind: "admin" as const, title: "Admin" },
        ],
        SEED,
      );
      await suite.db.updateTable("pms_appointments").set({ treatment_started_at: at(DAY, "11:05") } as never).where("tenant_id", "=", A).where("id", "=", ids[4]).execute();
      // Another clinic, same day: never in A's figures.
      const bSite = (await createSite(ctx, B, { name: "Other clinic (fictional)" }, SEED)).id;
      const bPrac = (await createPractitioner(ctx, B, { displayName: "Other Person" }, SEED)).id;
      const bServ = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30 }, SEED)).id;
      const bPat = (await createPatient(ctx, B, { firstName: "Other", lastName: "Patient" }, SEED)).id;
      await bulkCreateDiaryItems(ctx, B, [{ kind: "appointment", siteId: bSite, practitionerId: bPrac, patientId: bPat, serviceId: bServ, startsAt: at(DAY, "09:00"), endsAt: at(DAY, "09:30"), status: "attended" }], SEED);

      // Cases: Priya opened one (open) and closed one in the period; Tom opened one in the period, one before.
      id.c1 = (await createCase(ctx, A, { patientId: id.megan, title: "Low back pain", openedOn: "2026-10-01", practitionerId: id.p1, siteId: id.s1, payerType: "self_pay" }, SEED)).id;
      id.c2 = (await createCase(ctx, A, { patientId: id.megan, title: "Neck pain", openedOn: "2026-09-01", practitionerId: id.p1, siteId: id.s1, payerType: "self_pay" }, SEED)).id;
      id.c3 = (await createCase(ctx, A, { patientId: id.liam, title: "Right ankle sprain", openedOn: "2026-10-10", practitionerId: id.p2, siteId: id.s2, payerType: "insurer", payerReferrerId: id.ins1 }, SEED)).id;
      id.c4 = (await createCase(ctx, A, { patientId: id.sarah, title: "Shoulder", openedOn: "2026-08-01", practitionerId: id.p2, siteId: id.s2, payerType: "insurer", payerReferrerId: id.ins2 }, SEED)).id;
      await suite.db.updateTable("pms_cases").set({ status: "closed", closed_on: "2026-10-20" } as never).where("tenant_id", "=", A).where("id", "=", id.c2).execute();
      // Authorisations: one sessions left and expiring in 10 days (Mill Lane), one healthy and one used up (Harbour Road).
      id.a1 = (await createAuthorisation(ctx, A, { caseId: id.c3, referrerId: id.ins1, code: "BW-1", sessionsAuthorised: 6, expiresOn: "2026-11-05" }, SEED)).id;
      id.a2 = (await createAuthorisation(ctx, A, { caseId: id.c1, referrerId: id.ins1, code: "BW-2", sessionsAuthorised: 10, expiresOn: "2027-01-01" }, SEED)).id;
      id.a3 = (await createAuthorisation(ctx, A, { caseId: id.c1, referrerId: id.ins2, code: "SC-3", sessionsAuthorised: 4 }, SEED)).id;
      for (const [aid, used] of [
        [id.a1, 5],
        [id.a2, 2],
        [id.a3, 4],
      ] as const)
        await suite.db.updateTable("pms_authorisations").set({ sessions_used: used } as never).where("tenant_id", "=", A).where("id", "=", aid).execute();

      // Billing (period: Last 6 weeks = 21/09–01/11/2026).
      await invoice({ id: "inv_i1", site: id.s1, patient: id.megan, billTo: "patient", payerType: "self_pay", issuedOn: "2026-10-05", dueOn: "2026-10-05", total: 5500, paid: 5500 });
      await invoice({ id: "inv_i2", site: id.s1, patient: id.liam, billTo: "payer", payerType: "insurer", referrer: id.ins1, issuedOn: "2026-09-25", dueOn: "2026-10-25", total: 15000, credited: 1000 });
      await invoice({ id: "inv_i3", site: id.s2, patient: id.sarah, billTo: "patient", payerType: "self_pay", issuedOn: "2026-08-01", dueOn: "2026-08-01", total: 7500 });
      await invoice({ id: "inv_i4", site: id.s1, patient: id.megan, billTo: "patient", payerType: "self_pay", issuedOn: "2026-10-20", dueOn: "2026-10-20", total: 6000, credited: 6000, voided: true });
      await invoice({ id: "inv_i5", site: id.s2, patient: id.sarah, billTo: "payer", payerType: "insurer", referrer: id.ins2, issuedOn: "2026-10-12", dueOn: "2026-11-11", total: 9000 });
      await invoice({ id: "inv_i6", site: id.s1, patient: id.megan, billTo: "patient", payerType: "self_pay", issuedOn: "2026-10-21", dueOn: "2026-10-21", total: 4000, status: "draft" });
      await creditNote("crn_c1", "inv_i2", "write_off", "2026-10-10", 1000);
      await creditNote("crn_c2", "inv_i4", "void", "2026-10-20", 6000);
      await payment("pay_p1", { site: id.s1, patient: id.megan, on: "2026-10-05", amount: 5500 });
      await payment("pay_p2", { site: id.s1, patient: id.megan, kind: "refund", on: "2026-10-06", amount: 500 });
      await payment("pay_p3", { site: id.s1, patient: id.megan, status: "reversed", on: "2026-10-07", amount: 9999 });
      await payment("pay_p4", { site: id.s2, referrer: id.ins1, on: "2026-10-15", amount: 2000 });
    });
    after(async () => {
      await suite?.close();
    });

    it("attendance: Completed and arrived / in treatment count as attended; booked = attended + DNA + late; blocks, cancellations, other clinics out", async () => {
      const v = await page(owner(), "attendance");
      // attended a1, a5 (in treatment), the 19/10 visit, Tom's; DNA 2; late 1 → booked 7.
      assert.deepEqual([stat(v, "attended"), stat(v, "dna"), stat(v, "late")], ["4", "2", "1"]);
      assert.equal(v.stats.find((s) => s.id === "attended")?.sub, "57.1% of booked");
      assert.equal(v.stats.find((s) => s.id === "dna")?.sub, "28.6% · target under 4.0%");
      const weeks = rows(v, "weeks");
      assert.equal(weeks.length, 6, "six weeks");
      assert.deepEqual(weeks[4], ["w/c 19/10/2026", "1", "1", "0", "0", "0.0%"]);
      assert.deepEqual(weeks[5], ["w/c 26/10/2026", "6", "3", "2", "1", "33.3%"]);
      assert.equal(v.chart?.bars[5].strong, true, "above the 4% target");
      assert.match(v.footnote ?? "", /1 past appointment is still marked booked/);
      assert.deepEqual(rows(v, "practitioners"), [
        ["Priya Shah", "5", "3", "1", "1", "20.0%"],
        ["Tom Hughes", "2", "1", "1", "0", "50.0%"],
      ]);
      // Service filter: the initial assessment (Tom's attended visit) is left out.
      const fu = await page(owner(), "attendance", { service: id.fu });
      assert.deepEqual([stat(fu, "attended"), stat(fu, "dna")], ["3", "2"]);
    });

    it("utilisation: booked (incl. DNA and late cancellations) ÷ rota time; the closure removes rota time; per practitioner and site", async () => {
      const v = await page(owner(), "utilisation");
      // Priya: 6 Mondays × 240 = 1440 rota min; booked 7 × 30 = 210 (a4 cancelled freed its slot, the block never counts).
      // Tom: 5 Mondays × 180 = 900 (closed 12/10); booked 45 + 30 = 75.
      assert.deepEqual(rows(v, "practitioners"), [
        ["Priya Shah", "24", "3.5", "15%", "Harbour Road (fictional)"],
        ["Tom Hughes", "15", "1.3", "8%", "Mill Lane (fictional)"],
      ]);
      assert.deepEqual([stat(v, "utilisation"), stat(v, "rota-hours"), stat(v, "unfilled-hours")], ["12%", "39", "34.3"]);
      assert.deepEqual(rows(v, "sites").map((r) => r[0]), ["Harbour Road (fictional)", "Mill Lane (fictional)"]);
    });

    it("caseload and authorisations from the record", async () => {
      const c = await page(owner(), "caseload");
      assert.deepEqual([stat(c, "open"), stat(c, "new"), stat(c, "discharged")], ["3", "2", "1"]);
      assert.deepEqual(rows(c, "practitioners"), [
        ["Tom Hughes", "2", "1", "0"],
        ["Priya Shah", "1", "1", "1"],
      ]);
      const a = await page(owner(), "authorisations");
      assert.deepEqual([stat(a, "active"), stat(a, "need-extension"), stat(a, "expiring")], ["3", "2", "1"]);
      assert.deepEqual(a.chart?.bars.map((b) => b.value), [1, 1, 0, 0, 1]);
      assert.deepEqual(
        rows(a, "authorisations").map((r) => [r[0], r[2], r[3]]),
        [
          ["Liam O'Connor", "5", "6"],
          ["Megan Hart", "4", "4"],
        ],
      );
    });

    it("revenue: issued invoices by issue date, void and drafts out; credits; payments less refunds, reversed out", async () => {
      const v = await page(owner(), "revenue");
      assert.deepEqual([stat(v, "invoiced"), stat(v, "collected"), stat(v, "insurer-share")], ["£295.00", "£70.00", "81%"]);
      assert.deepEqual(rows(v, "months"), [
        ["Sep 2026", "£0.00", "£150.00", "£0.00", "£150.00", "£0.00"],
        ["Oct 2026", "£55.00", "£90.00", "-£10.00", "£135.00", "£70.00"],
        ["Nov 2026", "£0.00", "£0.00", "£0.00", "£0.00", "£0.00"],
      ]);
    });

    it("debtors: what is owed today by age – the same totals and bands as billing's aged debt", async () => {
      const v = await page(owner(), "debtors");
      assert.deepEqual([stat(v, "owed"), stat(v, "over-60"), stat(v, "largest")], ["£305.00", "£75.00", "Bluewell Health (fictional)"]);
      assert.deepEqual(rows(v, "accounts"), [
        ["Bluewell Health (fictional)", "£0.00", "£140.00", "£0.00", "£0.00", "£0.00", "£140.00"],
        ["Shieldcare Insurance (fictional)", "£90.00", "£0.00", "£0.00", "£0.00", "£0.00", "£90.00"],
        ["Patients (all)", "£0.00", "£0.00", "£0.00", "£75.00", "£0.00", "£75.00"],
      ]);
      const billing = billingAgedDebt((await debtInvoices(ctx, A)).rows, DAY).totals;
      assert.deepEqual([billing.totalPence, billing.current, billing.d1_30, billing.d61_90], [30500, 9000, 14000, 7500], "billing's own aged debt agrees");
    });

    it("a member limited to Harbour Road sees nothing of Mill Lane – in any report, today's figures or the CSV", async () => {
      const admin = adminSiteA();
      const att = await page(admin, "attendance", { site: id.s2 });
      assert.deepEqual([stat(att, "attended"), stat(att, "dna"), stat(att, "late")], ["3", "1", "1"], "asking for Mill Lane is ignored");
      assert.deepEqual(rows(att, "practitioners").map((r) => r[0]), ["Priya Shah"]);
      const util = await page(admin, "utilisation");
      assert.deepEqual(rows(util, "practitioners").map((r) => r[0]), ["Priya Shah"]);
      assert.deepEqual(rows(util, "sites").map((r) => r[0]), ["Harbour Road (fictional)"]);
      const cl = await page(admin, "caseload");
      assert.deepEqual([stat(cl, "open"), stat(cl, "new"), stat(cl, "discharged")], ["1", "1", "1"]);
      const rev = await page(admin, "revenue");
      assert.deepEqual([stat(rev, "invoiced"), stat(rev, "collected")], ["£205.00", "£50.00"]);
      const debt = await page(admin, "debtors");
      assert.deepEqual(rows(debt, "accounts").map((r) => [r[0], r[6]]), [["Bluewell Health (fictional)", "£140.00"]]);
      const auth = await page(admin, "authorisations");
      assert.deepEqual([stat(auth, "active"), rows(auth, "authorisations").map((r) => r[0])], ["2", ["Megan Hart"]]);
      const today = await attendanceToday(admin, opts);
      assert.ok(today.ok);
      assert.deepEqual(today.value, { appointments: 5, done: 2, dna: 1, sites: 1 });
      const util2 = await utilisationTodayBySite(admin, opts);
      assert.ok(util2.ok);
      assert.deepEqual(util2.value.map((s) => [s.siteName, s.bookedMinutes, s.availableMinutes]), [["Harbour Road (fictional)", 180, 240]]);
      const soon = await authorisationsEndingSoon(admin, 5, opts);
      assert.ok(soon.ok);
      assert.deepEqual(soon.value.rows.map((r) => r.code), ["SC-3"]);
      // CSV: needs "Export data" (admins do not have it by default); with it, still Harbour Road only.
      assert.equal((await reportCsvFor(admin, "revenue", {}, opts)).ok, false);
      const csv = await reportCsvFor(adminSiteA({ "reports.export": true }), "attendance", { site: id.s2 }, opts);
      assert.ok(csv.ok);
      assert.doesNotMatch(csv.value.csv, /Tom Hughes|Mill Lane/);
      assert.match(csv.value.csv, /Priya Shah/);
    });

    it("own caseload: a clinician sees their own practitioner only, no finance reports; unlinked → says so; reception has none", async () => {
      const att = await page(clinician(), "attendance", { practitioner: id.p2 });
      assert.deepEqual([stat(att, "attended"), stat(att, "dna"), stat(att, "late")], ["3", "1", "1"], "Priya's own, whatever is asked");
      assert.equal(att.tables.some((t) => t.id === "practitioners"), false);
      const cl = await page(clinician(), "caseload");
      assert.equal(stat(cl, "open"), "1");
      for (const r of ["revenue", "debtors", "authorisations"] as const) assert.equal((await reportPageFor(clinician(), r, {}, opts)).ok, false, r);
      const none = await page(unlinkedClinician(), "attendance");
      assert.match(none.notice ?? "", /not linked to a practitioner/);
      assert.deepEqual(none.stats, []);
      for (const r of ["attendance", "utilisation", "caseload", "revenue", "debtors", "authorisations"] as const) assert.equal((await reportPageFor(reception(), r, {}, opts)).ok, false, `reception: ${r}`);
      assert.equal((await utilisationTodayBySite(reception(), opts)).ok, false);
    });

    it("CSV: the same figures, formula-safe, audited with ids and counts only", async () => {
      const r = await reportCsvFor(owner(), "debtors", {}, opts);
      assert.ok(r.ok);
      assert.match(r.value.fileName, /^debtors-riverside-rep-2026-10-26-to-2026-10-26\.csv$/);
      assert.match(r.value.csv, /Total,3,90,140,0,75,0,305/);
      const audit = await listAudit(ctx, A, { action: "pms.report.export" });
      assert.ok(audit.length >= 2);
      assert.equal(JSON.stringify(audit).includes("Bluewell"), false, "no names in the audit trail");
      // A cell that a spreadsheet would run as a formula is defused.
      await suite.db.updateTable("pms_referrers").set({ name: "=HYPERLINK(1)" } as never).where("tenant_id", "=", A).where("id", "=", id.ins2).execute();
      const bad = await reportCsvFor(owner(), "debtors", {}, opts);
      assert.ok(bad.ok);
      assert.match(bad.value.csv, /'=HYPERLINK\(1\)/);
      await suite.db.updateTable("pms_referrers").set({ name: "Shieldcare Insurance (fictional)" } as never).where("tenant_id", "=", A).where("id", "=", id.ins2).execute();
    });

    it("today (dashboard): appointments, done, DNA; utilisation by site against rota time", async () => {
      const t = await attendanceToday(owner(), opts);
      assert.ok(t.ok);
      // Today, not cancelled: a1, a2, a5, a6, a7 (Harbour Road) + Tom's two = 7; done = a1, a5, Tom's attended = 3.
      assert.deepEqual(t.value, { appointments: 7, done: 3, dna: 2, sites: 2 });
      const u = await utilisationTodayBySite(owner(), opts);
      assert.ok(u.ok);
      assert.deepEqual(u.value.map((s) => [s.siteName, s.bookedMinutes, s.availableMinutes]), [
        ["Harbour Road (fictional)", 180, 240],
        ["Mill Lane (fictional)", 75, 180],
      ]);
      const soon = await authorisationsEndingSoon(owner(), 1, opts);
      assert.ok(soon.ok);
      assert.deepEqual([soon.value.total, soon.value.rows.length, soon.value.rows[0].code], [2, 1, "BW-1"]);
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (suite.log) assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
