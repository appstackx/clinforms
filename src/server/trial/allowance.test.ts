/**
 * The Report API's free-report hold (src/modules/medreport/auth/clinic-access.ts holdTrialReport, called by POST /drafts
 * before a LIVE call): a free report reserved per report; 403 TRIAL_REPORTS_USED with "buy the Reports add-on" (ClinDesk)
 * or "choose a plan" (ClinForms) once none are left; a report that counted or holds one, and an AMENDMENT of a counted
 * report (review 13), are never refused; parallel drafts can never take more than the allowance (review 6, the real
 * reservation on every database: src/server/trial/testing/trial-suite.ts); an unreadable state refuses (fail closed).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdTrialReport } from "../../modules/medreport/auth/clinic-access";
import type { ClinicProfile, MedreportDeps } from "../../modules/medreport/api/deps";

const member = { via: "session", tenantId: "larkfield" } as never;

/** A clinic with `included` free reports, `used` counted, `counted` report ids, and an in-memory atomic reservation. */
function deps(trialReports: ClinicProfile["trialReports"], options: { counted?: (id: string) => boolean | Promise<boolean>; reserved?: Set<string>; failReserve?: boolean } = {}): MedreportDeps {
  const reserved = options.reserved ?? new Set<string>();
  return {
    clinicProfile: async () => ({ tenantId: "larkfield", displayName: "L", addressLines: [], retentionDays: 30, draftingEnabled: true, ...(trialReports ? { trialReports } : {}) }),
    usage: {
      record: async () => undefined,
      reportCounted: async (_t: string, id: string) => (options.counted ? options.counted(id) : false),
      reserveTrialReport: async (_t: string, key: string) => {
        if (options.failReserve) throw new Error("db down");
        if (reserved.has(key)) return "held" as const;
        if (!trialReports || reserved.size >= trialReports.included) return "full" as const;
        reserved.add(key);
        return "reserved" as const;
      },
      releaseTrialReport: async (_t: string, key: string) => void reserved.delete(key),
    },
  } as never;
}
const refused = (err: unknown) => (err as { status?: number; init?: { code?: string } }).status === 403 && (err as { init?: { code?: string } }).init?.code === "TRIAL_REPORTS_USED";

describe("free trial – 10 reports, then 'buy the Reports add-on'", () => {
  it("each new report reserves one; the 11th is refused; a reserved or counted one drafts again; a release gives it back", async () => {
    const reserved = new Set<string>();
    const d = deps({ included: 10, used: 0, addon: true }, { reserved });
    const holds = [];
    for (let i = 1; i <= 10; i++) holds.push(await holdTrialReport(member, d, { reportId: `rpt_${i}` }));
    assert.equal(reserved.size, 10);
    await assert.rejects(holdTrialReport(member, d, { reportId: "rpt_11" }), refused);
    assert.equal(await holdTrialReport(member, d, { reportId: "rpt_3" }), null, "holds one already: no second reservation");
    await holds[0]?.release();
    assert.ok(await holdTrialReport(member, d, { reportId: "rpt_11" }), "the released one is free again");
    await assert.rejects(holdTrialReport(member, d, {}), refused, "no report id: a reservation of its own – none left");
  });
  it("parallel drafts (review 6): never more than the allowance", async () => {
    const reserved = new Set<string>();
    const d = deps({ included: 10, used: 0, addon: true }, { reserved });
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => holdTrialReport(member, d, { reportId: `rpt_p${i}` })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
    assert.equal(results.filter((r) => r.status === "rejected" && refused(r.reason)).length, 15);
  });
  it("amendments of a counted report (review 13) and counted reports are never refused, also when all are used", async () => {
    const d = deps({ included: 10, used: 10, addon: true }, { counted: (id) => id === "rpt_old" });
    assert.equal(await holdTrialReport(member, d, { reportId: "rpt_new_version", amendsReportId: "rpt_old" }), null);
    assert.equal(await holdTrialReport(member, d, { reportId: "rpt_old" }), null);
    await assert.rejects(holdTrialReport(member, d, { reportId: "rpt_new" }), refused);
    await assert.rejects(holdTrialReport(member, d, { reportId: "rpt_new", amendsReportId: "rpt_unknown" }), refused, "an amends naming a report that never counted");
  });
  it("the words: the add-on for ClinDesk, a plan for ClinForms", async () => {
    const detail = async (addon: boolean) => {
      try {
        await holdTrialReport(member, deps({ included: 10, used: 12, addon }), { reportId: "rpt_x" });
      } catch (err) {
        return String((err as { init?: { detail?: string } }).init?.detail ?? "");
      }
      return "";
    };
    assert.match(await detail(true), /Buy the Reports add-on under Plan and billing/);
    assert.match(await detail(false), /Choose a plan under Plan and billing/);
  });
  it("never for the public demo or a clinic without the cap; a repeat trial (0 free) refused; fails closed", async () => {
    assert.equal(await holdTrialReport({ via: "demo", tenantId: "demo" } as never, deps({ included: 0, used: 5, addon: true }), {}), null);
    assert.equal(await holdTrialReport(member, deps(undefined), { reportId: "rpt_new" }), null);
    await assert.rejects(holdTrialReport(member, deps({ included: 0, used: 0, addon: true }), { reportId: "rpt_new" }), refused);
    await assert.rejects(holdTrialReport(member, deps({ included: 10, used: 0, addon: true }, { failReserve: true }), { reportId: "rpt_new" }), refused);
  });
});
