/**
 * TESTS ONLY: packages and usage counters (migration 0007, 25/10/2026), run unchanged on every database: node:sqlite
 * and PGlite (src/server/usage/usage.test.ts), D1 through the in-process gateway Worker and real local D1
 * (workers/data-gateway/test/admin-stack.test.ts). Fictional clinics only.
 *
 * Khuram's rule (25/10/2026): a report counts towards the allowance ONCE – at its first successful live drafting
 * call, or at its first approval when nothing was drafted. Re-drafting, regenerating and re-approving never count
 * again (the calls and tokens still do); an amended version of an approved report never counts; failed calls cost
 * tokens but count no report.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { UsageEvent } from "../../../modules/medreport/api/deps";
import { PLATFORM_USER_ID } from "../../auth/create-auth";
import type { Database } from "../../db/schema";
import { removePackage, setPackage } from "../../admin/clinic-package";
import { PLATFORM_AUDIT_TENANT, type PlatformAdmin } from "../../admin/platform-console";
import { listAudit } from "../../repos/audit";
import { getClinicPackage, readClinicPackage, setClinicPackage } from "../../repos/clinic-package";
import { upsertClinicProfile } from "../../repos/clinic-profile";
import { setClinicDraftingLimits } from "../../repos/clinic-plan";
import { RepoInputError } from "../../repos/context";
import { purgeExpiredReports } from "../../repos/maintenance";
import {
  countCountedNotApproved,
  getUsageMonths,
  getUsageReport,
  newUsageEventId,
  purgeUsageEvents,
  readCountedNotApproved,
  readUsageMonths,
  recordUsageEvent,
  type UsageMonth,
} from "../../repos/usage";
import { isMissingUsageTable } from "../../repos/usage-period";
import { estimateCostMicroUsd } from "../pricing";
import { dbUsageRecorder } from "../recorder";
import { clinicPlanUsage, platformUsage, platformUsageCsv } from "../view";

export interface UsageSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  /** Drops the 0007 tables with the database's own handle (the gateway refuses DDL); absent = that test is skipped. */
  dropUsageTables?: () => Promise<void>;
}

const A = "usage-a-test";
const B = "usage-b-test";
const ADMIN: PlatformAdmin = { userId: "u-usage-admin", sessionId: "s-usage-admin", email: "ops@platform.example", name: "Ops" };
const USAGE = { inputTokens: 3000, outputTokens: 800, cacheReadInputTokens: 1000, cacheCreationInputTokens: 2000 };
const MODEL = "claude-sonnet-5-5";

async function clinic(db: Kysely<Database>, slug: string, at: string, name = `${slug} (fictional)`): Promise<void> {
  await db
    .insertInto("organization")
    .values({ id: `org-${slug}`, name, slug, logo: null, createdAt: at, metadata: null })
    .execute();
  await upsertClinicProfile({ db, now: () => new Date(at) }, slug, { organizationId: `org-${slug}`, displayName: name, draftingEnabled: true });
}

export interface UsageSuiteOptions {
  skip?: string | false;
  /** false: one connection (concurrent calls would only queue). */
  concurrency?: boolean;
}

export function defineUsageSuite(label: string, factory: () => Promise<UsageSuiteDb>, options: UsageSuiteOptions = {}): void {
  describe(`packages and usage – ${label}`, { skip: options.skip }, () => {
    let t: UsageSuiteDb;
    // 25/10/2026 10:00 UTC = 11:00 BST? (BST ends 25/10/2026 01:00 UTC) → 10:00 GMT, October.
    let clock = Date.parse("2026-10-25T10:00:00.000Z");
    const now = () => new Date(clock);
    const ctx = () => ({ db: t.db, now });
    const rec = (tenant: string, event: UsageEvent, eventId?: string) => recordUsageEvent(ctx(), tenant, event, eventId ? { eventId } : {});
    const month = async (tenant: string, period = "2026-10"): Promise<UsageMonth> => {
      const [m] = await getUsageMonths(ctx(), tenant, [period]);
      assert.ok(m, `${tenant} has a row for ${period}`);
      return m;
    };
    const drafted = (reportId: string, extra: Partial<Extract<UsageEvent, { kind: "drafting_call" }>> = {}): UsageEvent => ({
      kind: "drafting_call",
      reportId,
      succeeded: true,
      model: MODEL,
      usage: USAGE,
      ...extra,
    });

    before(async () => {
      t = await factory();
      const at = now().toISOString();
      await clinic(t.db, A, at);
      await clinic(t.db, B, at, '=HYPERLINK("https://evil.example") clinic (fictional)');
    });
    after(async () => {
      await t?.close();
    });

    it("a report counts once, at its first live drafting: re-drafting and approving again never count again (calls and tokens do)", async () => {
      await rec(A, { kind: "report_started", reportId: "rpt_one" });
      await rec(A, drafted("rpt_one"));
      await rec(A, drafted("rpt_one"));
      await rec(A, drafted("rpt_one")); // regenerated answers
      await rec(A, { kind: "report_approved", reportId: "rpt_one" });
      await rec(A, { kind: "report_approved", reportId: "rpt_one" }); // approved again (a retried approval)
      const m = await month(A);
      assert.equal(m.reportsStarted, 1);
      assert.equal(m.reportsDrafted, 1);
      assert.equal(m.billableReports, 1);
      assert.equal(m.billableOnApproval, 0);
      assert.equal(m.reportsApproved, 1);
      assert.equal(m.draftingCalls, 3);
      assert.equal(m.inputTokens, 9000);
      assert.equal(m.outputTokens, 2400);
      assert.equal(m.cacheReadTokens, 3000);
      assert.equal(m.cacheWriteTokens, 6000);
      // 3 × (3000×2 + 800×10 + 1000×0.2 + 2000×2×1.25) micro-dollars = 3 × 19,200
      assert.equal(estimateCostMicroUsd(MODEL, USAGE), 19_200);
      assert.equal(m.costMicroUsd, 57_600);
      const row = await getUsageReport(ctx(), A, "rpt_one");
      assert.equal(row?.billable_via, "drafted");
      assert.equal(row?.billable_period, "2026-10");
      assert.equal(Number(row?.drafting_calls), 3);
      assert.equal(await countCountedNotApproved(ctx(), A, "2026-10"), 0);
    });

    it("a report approved without any drafting counts at its approval", async () => {
      await rec(A, { kind: "report_started", reportId: "rpt_records_only" });
      const before = await month(A);
      await rec(A, { kind: "report_approved", reportId: "rpt_records_only" });
      await rec(A, { kind: "report_approved", reportId: "rpt_records_only" });
      const m = await month(A);
      assert.equal(m.billableReports, before.billableReports + 1);
      assert.equal(m.billableOnApproval, before.billableOnApproval + 1);
      assert.equal(m.reportsApproved, before.reportsApproved + 1);
      assert.equal((await getUsageReport(ctx(), A, "rpt_records_only"))?.billable_via, "approved");
    });

    it("drafted but never approved still counts (drafting cost money) and shows as counted-not-approved", async () => {
      const before = await month(A);
      await rec(A, { kind: "report_started", reportId: "rpt_abandoned" });
      await rec(A, drafted("rpt_abandoned"));
      const m = await month(A);
      assert.equal(m.billableReports, before.billableReports + 1);
      assert.equal(await countCountedNotApproved(ctx(), A, "2026-10"), 1);
    });

    it("failed live calls cost tokens but count no report; the first successful call then counts it", async () => {
      const before = await month(A);
      await rec(A, drafted("rpt_failing", { succeeded: false, usage: { inputTokens: 500, outputTokens: 16000 } }));
      await rec(A, drafted("rpt_failing", { succeeded: false, usage: undefined }));
      let m = await month(A);
      assert.equal(m.failedCalls, before.failedCalls + 2);
      assert.equal(m.billableReports, before.billableReports);
      assert.equal(m.draftingCalls, before.draftingCalls);
      assert.equal(m.outputTokens, before.outputTokens + 16000);
      assert.equal(await getUsageReport(ctx(), A, "rpt_failing"), null, "a failed call makes no report row");
      await rec(A, drafted("rpt_failing"));
      m = await month(A);
      assert.equal(m.billableReports, before.billableReports + 1);
    });

    it("an amended version of an approved report never counts; an 'amendment' of an unapproved or unknown report does", async () => {
      const before = await month(A);
      await rec(A, { kind: "report_started", reportId: "rpt_one_v2", amendsReportId: "rpt_one" });
      await rec(A, drafted("rpt_one_v2", { amendsReportId: "rpt_one" }));
      await rec(A, { kind: "report_approved", reportId: "rpt_one_v2", amendsReportId: "rpt_one" });
      // A version 3 amends version 2: still the same report.
      await rec(A, { kind: "report_started", reportId: "rpt_one_v3", amendsReportId: "rpt_one_v2" });
      await rec(A, { kind: "report_approved", reportId: "rpt_one_v3", amendsReportId: "rpt_one_v2" });
      let m = await month(A);
      assert.equal(m.billableReports, before.billableReports);
      assert.equal(m.reportsStarted, before.reportsStarted);
      assert.equal(m.reportsApproved, before.reportsApproved);
      assert.equal(m.amendmentsApproved, before.amendmentsApproved + 2);
      assert.equal(m.draftingCalls, before.draftingCalls + 1, "the amendment's drafting call is still a call");
      assert.equal((await getUsageReport(ctx(), A, "rpt_one_v3"))?.root_report_id, "rpt_one");
      // rpt_abandoned was never approved: "amending" it is a new report. An unknown id too.
      await rec(A, drafted("rpt_fake_amend", { amendsReportId: "rpt_abandoned" }));
      await rec(A, { kind: "report_approved", reportId: "rpt_fake_amend_2", amendsReportId: "rpt_does_not_exist" });
      m = await month(A);
      assert.equal(m.billableReports, before.billableReports + 2);
      // Another clinic's approved report is not an approved report of this clinic.
      await rec(B, drafted("rpt_b_amends_a", { amendsReportId: "rpt_one" }));
      assert.equal((await month(B)).billableReports, 1);
      assert.equal((await getUsageReport(ctx(), B, "rpt_b_amends_a"))?.root_report_id, "rpt_b_amends_a");
    });

    it("a live drafting call without a report id counts as a report of its own", async () => {
      const before = await month(A);
      await rec(A, { kind: "drafting_call", succeeded: true, model: MODEL, usage: USAGE });
      await rec(A, { kind: "drafting_call", reportId: "not a valid id!", succeeded: true, model: MODEL, usage: USAGE });
      const m = await month(A);
      assert.equal(m.billableReports, before.billableReports + 2);
      assert.equal(m.draftingCalls, before.draftingCalls + 2);
    });

    it("retry-safe: the same event applied twice counts once (every counter, the report's calls included)", async () => {
      const before = await month(A);
      const id = newUsageEventId();
      await rec(A, drafted("rpt_retry"), id);
      await rec(A, drafted("rpt_retry"), id);
      const read = newUsageEventId();
      await rec(A, { kind: "form_read", read: true, liveCalls: 2, failedCalls: 0, model: MODEL, usage: USAGE }, read);
      await rec(A, { kind: "form_read", read: true, liveCalls: 2, failedCalls: 0, model: MODEL, usage: USAGE }, read);
      const m = await month(A);
      assert.equal(m.draftingCalls, before.draftingCalls + 1);
      assert.equal(m.billableReports, before.billableReports + 1);
      assert.equal(m.formsRead, before.formsRead + 1);
      assert.equal(m.readingCalls, before.readingCalls + 2);
      assert.equal(m.inputTokens, before.inputTokens + 6000);
      assert.equal(Number((await getUsageReport(ctx(), A, "rpt_retry"))?.drafting_calls), 1);
    });

    it(
      "atomic: concurrent drafting calls and approvals of the same reports count each report once",
      { skip: options.concurrency === false && "this dialect runs one connection" },
      async () => {
        const before = await month(A);
        await Promise.all([
          ...Array.from({ length: 12 }, () => rec(A, drafted("rpt_busy"))),
          ...Array.from({ length: 5 }, () => rec(A, { kind: "report_approved", reportId: "rpt_busy_approved" })),
        ]);
        const m = await month(A);
        assert.equal(m.billableReports, before.billableReports + 2);
        assert.equal(m.draftingCalls, before.draftingCalls + 12);
        assert.equal(m.reportsApproved, before.reportsApproved + 1);
        assert.equal(Number((await getUsageReport(ctx(), A, "rpt_busy"))?.drafting_calls), 12);
      },
    );

    it("form readings and question sets are counted; tenant isolation: one clinic's events never reach another", async () => {
      const beforeA = await month(A);
      const beforeB = await month(B);
      await rec(A, { kind: "form_read", read: true, liveCalls: 0, failedCalls: 0 });
      await rec(A, { kind: "form_read", read: false, liveCalls: 0, failedCalls: 1, model: MODEL, usage: { inputTokens: 100, outputTokens: 0 } });
      await rec(A, { kind: "question_set_created", formId: "frm_q1" });
      // The same report id in two clinics counts in each, separately.
      await rec(A, drafted("rpt_shared_id"));
      await rec(B, drafted("rpt_shared_id"));
      const a = await month(A);
      const b = await month(B);
      assert.equal(a.formsRead, beforeA.formsRead + 1);
      assert.equal(a.failedCalls, beforeA.failedCalls + 1);
      assert.equal(a.questionSets, beforeA.questionSets + 1);
      assert.equal(a.billableReports, beforeA.billableReports + 1);
      assert.equal(b.billableReports, beforeB.billableReports + 1);
      assert.equal(b.formsRead, 0);
      assert.equal(b.questionSets, 0);
      assert.deepEqual(
        (await getUsageMonths(ctx(), B, ["2026-10", "2026-09"])).map((m) => m.tenantId),
        [B],
      );
    });

    it("the month is the UK calendar month (00:30 BST on 1 October is October)", async () => {
      const saved = clock;
      clock = Date.parse("2026-09-30T23:30:00.000Z");
      const r = await rec(B, drafted("rpt_midnight"));
      clock = saved;
      assert.equal(r.period, "2026-10");
      assert.equal((await getUsageReport(ctx(), B, "rpt_midnight"))?.billable_period, "2026-10");
    });

    it("report retention deleting reports leaves the counters as they were", async () => {
      const before = await month(A);
      const at = now().toISOString();
      await t.db
        .insertInto("reports")
        .values({
          tenant_id: A,
          id: "rpt_one",
          rev: 1,
          status: "signed",
          form_id: null,
          template_id: "t",
          payload_enc: "v1.t1.x.y",
          created_at: at,
          updated_at: at,
          delete_after: "2026-10-01T00:00:00.000Z",
        })
        .execute();
      assert.equal(await purgeExpiredReports(ctx(), at), 1);
      assert.deepEqual(await month(A), before);
      assert.equal((await getUsageReport(ctx(), A, "rpt_one"))?.billable_via, "drafted");
      // And the report counted once already: drafting it again (a restored copy) still never counts again.
      await rec(A, drafted("rpt_one"));
      assert.equal((await month(A)).billableReports, before.billableReports);
    });

    it("packages: validated, audited (no notes in the audit), the current month measured against them, founding price until its date", async () => {
      await assert.rejects(
        setPackage(t.db, { kind: "platform", admin: ADMIN }, A, { package: "practice", monthlyPricePence: -1, reportsIncluded: 100, extraReportPence: 150 }),
        RepoInputError,
      );
      await assert.rejects(
        setPackage(t.db, { kind: "platform", admin: ADMIN }, "no-such-clinic", {
          package: "practice",
          monthlyPricePence: 19900,
          reportsIncluded: 100,
          extraReportPence: 150,
        }),
        RepoInputError,
      );
      await assert.rejects(
        setClinicPackage(ctx(), A, { package: "nope" as never, monthlyPricePence: 1, reportsIncluded: 1, extraReportPence: 1 }),
        RepoInputError,
      );
      await assert.rejects(
        setClinicPackage(ctx(), A, { package: "custom", monthlyPricePence: 1, reportsIncluded: 1, extraReportPence: 1, foundingUntil: "2027-01-01" }),
        RepoInputError,
      );
      await assert.rejects(
        setClinicPackage(ctx(), A, { package: "custom", monthlyPricePence: 1, reportsIncluded: 1, extraReportPence: 1, startsOn: "2026-02-30" }),
        RepoInputError,
      );
      const saved = await setPackage(
        t.db,
        { kind: "platform", admin: ADMIN },
        A,
        {
          package: "practice",
          monthlyPricePence: 19_900,
          reportsIncluded: 5,
          extraReportPence: 150,
          foundingPricePence: 14_900,
          setupFeePence: 25_000,
          startsOn: "2026-10-01",
          notes: "Internal: founding clinic (fictional)",
        },
        now(),
      );
      assert.equal(saved.foundingUntil, "2027-09-30", "12 months from the start, less a day");
      assert.equal(saved.setupFeeStatus, "due");
      let m = await month(A);
      assert.equal(m.package, "practice");
      assert.equal(m.planPricePence, 14_900, "the founding price applies this month");
      assert.equal(m.planReportsIncluded, 5);
      assert.equal(m.planExtraReportPence, 150);
      const clinicTrail = await listAudit({ db: t.db }, A, { action: "clinic.package_set" });
      assert.equal(clinicTrail.length, 1);
      assert.equal(clinicTrail[0].userId, PLATFORM_USER_ID);
      assert.equal((clinicTrail[0].detail as Record<string, unknown>).monthlyPricePence, 19_900);
      assert.equal((clinicTrail[0].detail as Record<string, unknown>).notesChanged, true);
      assert.doesNotMatch(JSON.stringify(clinicTrail[0].detail), /Internal: founding/);
      const platformTrail = await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT, { action: "platform.package_set" });
      assert.equal(platformTrail.length, 1);
      assert.equal(platformTrail[0].userId, ADMIN.userId);
      assert.doesNotMatch(JSON.stringify(platformTrail[0].detail), /Internal: founding/);
      // A later month: its first event copies the package; once the founding date has passed, the list price.
      const savedClock = clock;
      clock = Date.parse("2027-11-02T10:00:00.000Z");
      await rec(A, drafted("rpt_next_year"));
      m = await month(A, "2027-11");
      assert.equal(m.package, "practice");
      assert.equal(m.planPricePence, 19_900);
      clock = savedClock;
      // Script actor: audited under the clinic only.
      await setPackage(t.db, { kind: "script" }, B, { package: "custom", monthlyPricePence: 30_000, reportsIncluded: 500, extraReportPence: 100 }, now());
      assert.equal((await listAudit({ db: t.db }, B, { action: "clinic.package_set" })).length, 1);
      assert.equal((await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT, { action: "platform.package_set" })).length, 1);
    });

    it("the clinic's page: owners see package, allowance, extra and history; clinicians and staff only 'X of N'", async () => {
      const owner = await clinicPlanUsage(t.db, { tenantId: A, role: "owner" }, now());
      assert.equal(owner.kind, "manager");
      if (owner.kind !== "manager") return;
      const m = await month(A);
      assert.equal(owner.thisMonth.counted, m.billableReports);
      assert.equal(owner.thisMonth.included, 5);
      assert.equal(owner.thisMonth.extra, m.billableReports - 5);
      assert.equal(owner.thisMonth.extraChargePence, (m.billableReports - 5) * 150);
      assert.equal(owner.thisMonth.inProgress, await countCountedNotApproved(ctx(), A, "2026-10"));
      assert.equal(owner.package?.monthlyPricePence, 14_900);
      assert.equal(owner.package?.label, "Practice");
      assert.equal(owner.history.length, 6);
      assert.equal(owner.history[0].period, "2026-10");
      assert.equal(owner.history[1].counted, 0);
      assert.equal(owner.drafting.enabled, true);
      assert.equal(owner.drafting.ownLimits, false);
      await setClinicDraftingLimits(ctx(), A, { perMinute: 30, perDay: 1500 });
      const withLimits = await clinicPlanUsage(t.db, { tenantId: A, role: "admin" }, now());
      assert.ok(withLimits.kind === "manager" && withLimits.drafting.perDay === 1500 && withLimits.drafting.ownLimits);
      for (const role of ["clinician", "staff"]) {
        const view = await clinicPlanUsage(t.db, { tenantId: A, role }, now());
        assert.deepEqual(Object.keys(view).sort(), ["counted", "included", "kind", "period", "periodLabel"], role);
        assert.equal(view.kind, "member");
        assert.doesNotMatch(JSON.stringify(view), /Pence|price|token|cost/i, role);
      }
      // Never another clinic's numbers.
      const other = await clinicPlanUsage(t.db, { tenantId: B, role: "owner" }, now());
      assert.ok(other.kind === "manager" && other.thisMonth.counted === (await month(B)).billableReports && other.package?.id === "custom");
    });

    it("the platform page: every clinic's month with calls, tokens, cost and margin; totals; a formula-safe CSV", async () => {
      const usage = await platformUsage(t.db, "2026-10", 0.8, now());
      assert.equal(usage.available, true);
      const a = usage.rows.find((r) => r.tenantId === A);
      const b = usage.rows.find((r) => r.tenantId === B);
      assert.ok(a && b);
      const ma = await month(A);
      assert.equal(a.counted, ma.billableReports);
      assert.equal(a.extra, ma.billableReports - 5);
      assert.equal(a.pricePence, 14_900);
      assert.equal(a.costMicroUsd, ma.costMicroUsd);
      assert.equal(a.costPence, Math.round((ma.costMicroUsd / 1e6) * 0.8 * 100));
      assert.equal(a.marginPence, 14_900 + a.extraChargePence - a.costPence);
      assert.equal(a.countedNotApproved, await countCountedNotApproved(ctx(), A, "2026-10"));
      assert.equal(a.amendmentsApproved, ma.amendmentsApproved);
      assert.ok(a.amendmentsApproved >= 2, "the amended versions are shown, not counted");
      assert.equal(usage.totals.counted, a.counted + b.counted);
      assert.equal(usage.totals.inputTokens, a.inputTokens + b.inputTokens);
      const csv = platformUsageCsv(usage);
      const lines = csv.trim().split("\r\n");
      assert.equal(lines.length, 1 + usage.rows.length);
      const bLine = lines.find((l) => l.includes(B)) ?? "";
      assert.match(
        bLine,
        /,"'=HYPERLINK\(""https:\/\/evil\.example""\) clinic \(fictional\)",/,
        "a clinic name that looks like a formula is quoted and defused",
      );
      assert.ok(!lines.some((l) => /(^|,)[=+@]/.test(l)), "no cell starts with a formula character");
      // An empty month lists every open clinic with zeros.
      const empty = await platformUsage(t.db, "2026-01", 0.8, now());
      assert.ok(empty.rows.some((r) => r.tenantId === A && r.counted === 0 && r.package === null));
    });

    it("removing a package: audited; the current month no longer names one", async () => {
      await removePackage(t.db, { kind: "platform", admin: ADMIN }, B, now());
      assert.equal(await getClinicPackage(ctx(), B), null);
      assert.equal((await month(B)).package, null);
      assert.equal((await listAudit({ db: t.db }, B, { action: "clinic.package_removed" })).length, 1);
      await assert.rejects(removePackage(t.db, { kind: "platform", admin: ADMIN }, B, now()), RepoInputError);
    });

    it("the events ledger is purged after a week; the counters stay", async () => {
      const before = await month(A);
      const removed = await purgeUsageEvents(ctx(), new Date(clock + 8 * 86_400_000).toISOString());
      assert.ok(removed > 0);
      assert.deepEqual(await month(A), before);
      assert.equal(await purgeUsageEvents(ctx(), new Date(clock + 8 * 86_400_000).toISOString()), 0);
    });

    it("the host recorder: atomic events through the same path, never for another clinic", async () => {
      const recorder = dbUsageRecorder(() => t.db, { now });
      const before = await month(B);
      await recorder.record(B, { kind: "report_approved", reportId: "rpt_via_recorder" });
      assert.equal((await month(B)).billableReports, before.billableReports + 1);
      await assert.rejects(recorder.record("Not A Slug", { kind: "question_set_created", formId: "x" }));
    });

    it("before migration 0007 (deploy order): pages read 'no package, no usage', the recorder counts nothing and says so; strict reads stay loud", async (tc) => {
      if (!t.dropUsageTables) {
        tc.skip("the tables cannot be dropped through this path");
        return;
      }
      await t.dropUsageTables();
      assert.equal(await readClinicPackage(ctx(), A), null);
      assert.deepEqual(await readUsageMonths(ctx(), A, ["2026-10"]), []);
      assert.equal(await readCountedNotApproved(ctx(), A, "2026-10"), 0);
      assert.equal(await purgeUsageEvents(ctx(), now().toISOString()), 0);
      await dbUsageRecorder(() => t.db, { now }).record(A, drafted("rpt_after_drop"));
      const view = await clinicPlanUsage(t.db, { tenantId: A, role: "owner" }, now());
      assert.ok(view.kind === "manager" && view.package === null && view.thisMonth.counted === 0);
      assert.equal((await platformUsage(t.db, "2026-10", 0.8, now())).available, false);
      await assert.rejects(getClinicPackage(ctx(), A), (err) => isMissingUsageTable(err));
      await assert.rejects(rec(A, drafted("rpt_strict")), (err) => isMissingUsageTable(err));
    });
  });
}
